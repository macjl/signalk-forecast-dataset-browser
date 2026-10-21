// Actual browser verification against the selected sandbox. Tokens stay in memory.
const { chromium } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const base = 'http://127.0.0.1:3000', name = 'signalk-forecast-dataset-browser'
const api = '/plugins/signalk-forecast-dataset-provider'
const credentials = JSON.parse(execFileSync('docker', ['exec', 'signalk-sandbox', 'node', '-e', `
  const fs = require('fs'), c = require('crypto'), assert = require('assert/strict');
  assert.equal(process.env.SIGNALK_CONTAINER_ID, 'signalk-sandbox');
  const root = '/home/node/.signalk', security = JSON.parse(fs.readFileSync(root+'/security.json'));
  const admin = security.users.find(u=>u.type==='admin'); assert.ok(admin);
  const secret = security.secretKey || fs.readFileSync(root+'/security-secret.key','utf8').trim();
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({id:admin.username,exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
  const token = h+'.'+p+'.'+c.createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
  const readonly = fs.readFileSync(root+'/plugin-config-data/signalk-grib-weather-provider/catalogue-token','utf8').trim();
  process.stdout.write(JSON.stringify({admin:token,readonly}));
`], { encoding: 'utf8' }))
const headers = { Authorization: `Bearer ${credentials.admin}` }
const publications = new Set(), datasets = new Set()
const screenshots = path.resolve(__dirname, '../docs/screenshots')
async function call(route, options = {}) {
  const { json, headers: extra = {}, ...rest } = options
  return fetch(base + route, { ...rest, headers: { ...headers, ...extra, ...(json ? { 'Content-Type': 'application/json' } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}), signal: AbortSignal.timeout(20000) })
}
async function get(route) {
  const response = await call(route)
  assert.equal(response.status, 200, route)
  return response.json()
}
async function listing() {
  const records = {}
  for (let offset = 0; ; offset += 100) {
    const page = await get(`${api}/datasets?limit=100&offset=${offset}`)
    Object.assign(records, page)
    if (Object.keys(page).length < 100) return records
  }
}
async function main() {
  for (let i = 0; ; i++) {
    try { assert.equal((await get(api + '/status')).contractVersion, '0.1'); break } catch (error) {
      if (i >= 40) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  const initial = await listing(), initialIds = Object.keys(initial).sort()
  const apps = await get('/signalk/v1/apps/list')
  assert.ok(JSON.stringify(apps).includes(name), 'Browser must appear in Signal K Webapps')
  const browser = await chromium.launch({ headless: true, ...(process.env.FORECAST_BROWSER_EXECUTABLE ? { executablePath: process.env.FORECAST_BROWSER_EXECUTABLE } : {}) })
  const errors = [], deletes = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'fr-FR' })
    await context.addCookies([{ name: 'JAUTHENTICATION', value: credentials.admin, url: base, httpOnly: true }])
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname) })
    await page.goto(base + '/' + name + '/')
    await page.waitForFunction(count => document.getElementById('dataset-count').textContent === String(count), initialIds.length)
    if (initialIds.length) {
      await page.waitForFunction(() => document.getElementById('detail-panel').getAttribute('aria-busy') === 'false' && document.querySelector('#detail-content .metadata'))
      const visibleId = await page.locator('#dataset-rows tr').first().getAttribute('data-id')
      assert.ok(initial[visibleId])
      assert.ok((await page.locator('#detail-title').textContent()).length)
      await page.getByText(`Fichiers d’origine (${initial[visibleId].assetCount})`, { exact: true }).click()
      assert.equal(await page.locator('.asset').count(), initial[visibleId].assetCount)
      await page.getByText(`Fichiers d’origine (${initial[visibleId].assetCount})`, { exact: true }).click()
    }
    const fixtureName = 'Vérification browser · ' + randomUUID().slice(0, 8)
    const bytes = Buffer.from(JSON.stringify({ purpose: 'browser verification only' }))
    let response = await call(api + '/publications', { method: 'POST', json: { kind: 'analysis', format: 'json', producer: 'forecast-browser-verification', metadata: { name: fixtureName, model: 'TEST', description: 'Synthetic browser deletion verification; not a forecast.' }, assets: [{ id: 'manifest', size: bytes.length, mediaType: 'application/json' }] } })
    assert.equal(response.status, 201)
    const stage = await response.json(); publications.add(stage.id)
    response = await call(`${api}/publications/${stage.id}/assets/manifest`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })
    assert.equal(response.status, 201)
    response = await call(`${api}/publications/${stage.id}/commit`, { method: 'POST' })
    assert.equal(response.status, 201)
    const dataset = await response.json(); datasets.add(dataset.id); publications.delete(stage.id)
    await page.locator('#refresh').click()
    const row = page.locator(`tr[data-id="${dataset.id}"]`)
    await row.waitFor()
    await row.locator('[data-delete]').click()
    await page.locator('#delete-dialog').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#delete-id').textContent(), dataset.id)
    await page.locator('#delete-cancel').click()
    assert.equal((await call(`${api}/datasets/${dataset.id}`)).status, 200)
    assert.deepEqual(deletes, [])
    await row.locator('[data-delete]').click()
    await page.locator('#delete-dialog').waitFor({ state: 'visible' })
    const removal = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === `${api}/datasets/${dataset.id}`)
    await page.locator('#delete-confirm').click()
    assert.equal((await removal).status(), 204)
    datasets.delete(dataset.id)
    await page.locator('#delete-dialog').waitFor({ state: 'hidden' })
    await row.waitFor({ state: 'detached' })
    assert.equal((await call(`${api}/datasets/${dataset.id}`)).status, 404)
    assert.deepEqual(deletes, [`${api}/datasets/${dataset.id}`])
    assert.deepEqual(Object.keys(await listing()).sort(), initialIds)
    await page.waitForFunction(count => document.getElementById('dataset-count').textContent === String(count), initialIds.length)
    await page.waitForFunction(() => document.getElementById('detail-panel').getAttribute('aria-busy') === 'false')
    await page.waitForFunction(() => getComputedStyle(document.getElementById('toast')).opacity === '0')
    fs.mkdirSync(screenshots, { recursive: true })
    await page.screenshot({ path: path.join(screenshots, 'catalogue-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page should not overflow')
    await page.screenshot({ path: path.join(screenshots, 'catalogue-mobile.png'), fullPage: true })
    const readonlyContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' })
    await readonlyContext.addCookies([{ name: 'JAUTHENTICATION', value: credentials.readonly, url: base, httpOnly: true }])
    const readonlyPage = await readonlyContext.newPage()
    readonlyPage.on('pageerror', error => errors.push(error.message))
    await readonlyPage.goto(base + '/' + name + '/')
    await readonlyPage.waitForFunction(count => document.getElementById('dataset-count').textContent === String(count), initialIds.length)
    await readonlyPage.waitForFunction(() => document.getElementById('access-level').textContent === 'Lecture seule')
    for (const button of await readonlyPage.locator('[data-delete]').all()) assert.equal(await button.isDisabled(), true)
    assert.deepEqual(errors, [])
    const preserved = JSON.parse(execFileSync('docker', ['exec', 'signalk-sandbox', 'node', '-e', `
      const fs=require('fs'),path=require('path'),c=require('crypto'),assert=require('assert/strict');
      const root='/home/node/.signalk', name='${name}';
      const marker=JSON.parse(fs.readFileSync(root+'/local-packages/forecast-browser-install-backup.json'));
      const baseline=JSON.parse(fs.readFileSync(marker.backup+'/baseline.json'));
      for(const [file,hash] of Object.entries(baseline.hashes)) assert.equal(c.createHash('sha256').update(fs.readFileSync(path.join(root,'plugin-config-data',file))).digest('hex'),hash,file);
      const before=JSON.parse(fs.readFileSync(marker.backup+'/package.json'));
      const after=JSON.parse(fs.readFileSync(root+'/package.json'));
      for(const [dependency,value] of Object.entries(before.dependencies)) if(dependency!==name) assert.equal(after.dependencies[dependency],value,dependency);
      console.log(JSON.stringify({configurations:Object.keys(baseline.hashes).length,dependencies:Object.keys(before.dependencies).filter(dependency=>dependency!==name).length}));
    `], { encoding: 'utf8' }))
    console.log(JSON.stringify({ result: 'PASS', webapp: name, realDatasetsPreserved: initialIds.length, syntheticDatasetDeleted: dataset.id, cancelledDeletion: 'no effect', readonlyControls: 'disabled', desktopAndMobile: 'verified', browserErrors: errors.length, preserved }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  for (const id of publications) await call(`${api}/publications/${id}`, { method: 'DELETE' }).catch(() => {})
  for (const id of datasets) await call(`${api}/datasets/${id}`, { method: 'DELETE' }).catch(() => {})
})
