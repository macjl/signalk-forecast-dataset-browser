import { test, expect } from '@playwright/test'
const api = '/plugins/signalk-forecast-dataset-provider'
const version = 'a'.repeat(64)
const fixtures = () => [
  { id: '11111111-1111-4111-8111-111111111111', name: 'GFS · Méditerranée', model: 'GFS', format: 'grib2', kind: 'forecast', producer: 'signalk-grib-downloader', run: '2026-10-21T06:00:00Z', createdAt: '2026-10-21T11:14:59Z', inventory: { status: 'unverified' }, size: 46476556, assetCount: 2 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'AROME · Golfe du Lion', model: 'AROME', format: 'grib2', kind: 'forecast', producer: 'weather-receiver', run: '2026-10-21T09:00:00Z', createdAt: '2026-10-21T12:14:59Z', inventory: { status: 'verified' }, size: 10485760, assetCount: 1, bounds: [2, 41, 7, 45], forecast: { from: '2026-10-21T09:00:00Z', to: '2026-10-23T09:00:00Z' }, fields: [{ parameter: 'eastward_wind' }] },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Courants · Atlantique', model: 'TEST', format: 'zarr', kind: 'analysis', producer: 'ocean-receiver', createdAt: '2026-10-21T12:00:00Z', inventory: { status: 'unverified' }, size: 2048, assetCount: 1 }
].map(d => ({ ...d, version, contractVersion: '0.1', state: 'complete', metadataRevision: 1, declared: { model: d.model }, requested: { source: d.name, hours: 48 }, provenance: { channel: 'internet' }, assets: Array.from({ length: d.assetCount }, (_, i) => ({ id: `part-${i}`, size: 512, mediaType: 'application/octet-stream', sha256: 'b'.repeat(64) })) }))
async function setup(page, { role = 'admin' } = {}) {
  const records = new Map(fixtures().map(d => [d.id, d]))
  const state = { deletes: [], deleteStatus: 204, changed: false, listError: 0, publications: {}, publicationStatus: 200, publicationRequests: 0 }
  await page.route('**/skServer/loginStatus', route => route.fulfill({ json: { status: 'loggedIn', authenticationRequired: true, userLevel: role, username: 'sandbox' } }))
  await page.route('**/plugins/signalk-forecast-dataset-provider/**', route => {
    const request = route.request(), url = new URL(request.url())
    const json = (data, status = 200) => route.fulfill({ status, json: data })
    if (url.pathname === api + '/status') return json({ contractVersion: '0.1', datasets: records.size })
    if (url.pathname === api + '/datasets') return state.listError ? json({ message: 'Unavailable' }, state.listError) : json(Object.fromEntries(records))
    if (url.pathname === api + '/publications') { state.publicationRequests++; return json(state.publications, state.publicationStatus) }
    const id = url.pathname.slice((api + '/datasets/').length).split('/')[0]
    if (!records.has(id)) return json({ code: 'DATASET_NOT_FOUND' }, 404)
    if (request.method() === 'DELETE') {
      state.deletes.push(id)
      if (state.deleteStatus !== 204) return json({ code: 'DATASET_BUSY' }, state.deleteStatus)
      records.delete(id); return route.fulfill({ status: 204 })
    }
    if (url.pathname.endsWith('/index')) return json({ metadata: { fields: [{ parameter: 'eastward_wind' }] }, index: { messages: [] } })
    return json({ ...records.get(id), ...(state.changed ? { version: 'c'.repeat(64) } : {}) })
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/signalk-forecast-dataset-browser/')
  await expect(page.locator('#dataset-count')).toHaveText('3')
  await expect(page.locator('#detail-panel')).toHaveAttribute('aria-busy', 'false')
  return { state, records, errors }
}

test('lists datasets, filters metadata and reads details and inventory', async ({ page }) => {
  const { errors } = await setup(page)
  await expect(page.locator('#dataset-rows tr')).toHaveCount(3)
  await expect(page.locator('#detail-title')).toHaveText('GFS · Méditerranée')
  expect(await page.locator('#detail-content').evaluate(element => [...element.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => n.textContent))).toEqual([])
  await page.locator('#search').fill('AROME')
  await expect(page.locator('#dataset-rows tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'AROME · Golfe du Lion', exact: true }).click()
  await expect(page.locator('#detail-content')).toContainText('Emprise annoncée')
  await expect(page.locator('#detail-content')).toContainText('Période annoncée')
  await page.getByText('Inventaire vérifié et index', { exact: true }).click()
  await page.getByRole('button', { name: 'Charger l’inventaire', exact: true }).click()
  await expect(page.locator('#detail-content')).toContainText('eastward_wind')
  await page.locator('#search').fill('')
  await page.locator('#format').selectOption('zarr')
  await expect(page.locator('#dataset-rows tr')).toHaveCount(1)
  await expect(page.locator('#dataset-rows')).toContainText('Courants')
  expect(errors).toEqual([])
})

test('cancel is harmless; confirmed deletion removes only the chosen dataset', async ({ page }) => {
  const { state, records } = await setup(page)
  await page.locator('#dataset-rows [data-delete]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#delete-id')).toHaveText('11111111-1111-4111-8111-111111111111')
  await expect(page.getByRole('dialog')).toContainText('toutes ses versions')
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  expect(state.deletes).toEqual([])
  expect(records.size).toBe(3)
  await page.locator('#dataset-rows [data-delete]').first().click()
  await page.locator('#delete-confirm').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('#dataset-count')).toHaveText('2')
  expect(state.deletes).toEqual(['11111111-1111-4111-8111-111111111111'])
  expect(records.has('22222222-2222-4222-8222-222222222222')).toBe(true)
})

test('readonly session can inspect metadata but cannot delete', async ({ page }) => {
  const { state } = await setup(page, { role: 'readonly' })
  await expect(page.locator('#access-level')).toHaveText('Lecture seule')
  for (const button of await page.locator('[data-delete]').all()) await expect(button).toBeDisabled()
  await page.getByRole('button', { name: 'AROME · Golfe du Lion', exact: true }).click()
  await expect(page.locator('#detail-content')).toContainText('weather-receiver')
  expect(state.deletes).toEqual([])
  expect(state.publicationRequests).toBe(0)
  await expect(page.locator('#publications-note')).toContainText('compte autorisé en écriture')
})

test('live acquisition stays separate, uses indeterminate progress and reconciles after commit', async ({ page }) => {
  const { state, records, errors } = await setup(page)
  const id = '44444444-4444-4444-8444-444444444444'
  const datasetId = '55555555-5555-4555-8555-555555555555'
  state.publications = { [id]: { id, datasetId, state: 'receiving', declaration: { producer: 'receiver', format: 'grib2', metadata: { name: '<img src=x onerror="window.injected=true">' } }, progress: { bytesReceived: 1024, totalBytes: null, assetsCompleted: 0, assetsTotal: 2 } } }
  await page.locator('#refresh').click()
  const card = page.locator(`[data-publication="${id}"]`)
  await expect(card).toContainText('Réception en cours')
  await expect(card).toContainText('taille totale inconnue')
  await expect(card.locator('progress')).not.toHaveAttribute('value')
  await expect(card.locator('img')).toHaveCount(0)
  await expect(page.locator('#dataset-count')).toHaveText('3')
  state.publications[id].state = 'ready'
  state.publications[id].progress = { bytesReceived: 2048, totalBytes: 2048, assetsCompleted: 2, assetsTotal: 2 }
  await expect(card).toContainText('en attente de publication')
  await expect(card.locator('progress')).toHaveAttribute('value', '2048')
  await expect(page.locator('#dataset-count')).toHaveText('3')
  records.set(datasetId, { ...fixtures()[0], id: datasetId, name: 'Nouvelle acquisition publiée' })
  state.publications = {}
  await expect(page.locator('#dataset-count')).toHaveText('4')
  await expect(card).toHaveCount(0)
  expect(errors).toEqual([])
})

test('older providers and expired monitoring permissions leave published consultation usable', async ({ page }) => {
  const { state } = await setup(page)
  state.publicationStatus = 404
  await page.locator('#refresh').click()
  await expect(page.locator('#publications-note')).toContainText('0.1.1')
  await expect(page.locator('#dataset-count')).toHaveText('3')
  state.publicationStatus = 403
  await page.locator('#refresh').click()
  await expect(page.locator('#publications-note')).toContainText('droits nécessaires')
  await expect(page.locator('[data-publication]')).toHaveCount(0)
  await expect(page.locator('#access-level')).toHaveText('Lecture seule')
})

test('busy conflict keeps the dataset and the confirmation open for retry', async ({ page }) => {
  const { state, records } = await setup(page)
  state.deleteStatus = 409
  await page.locator('#dataset-rows [data-delete]').first().click()
  await page.locator('#delete-confirm').click()
  await expect(page.locator('#delete-error')).toContainText('utilisé par une lecture')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(records.size).toBe(3)
  state.deleteStatus = 204
  await page.locator('#delete-confirm').click()
  await expect(page.locator('#dataset-count')).toHaveText('2')
})

test('changed content aborts deletion and keeps the selected dataset intact', async ({ page }) => {
  const { state, records } = await setup(page)
  await page.locator('#dataset-rows [data-delete]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  state.changed = true
  await page.locator('#delete-confirm').click()
  await expect(page.locator('#delete-error')).toContainText('a changé depuis la confirmation')
  expect(state.deletes).toEqual([])
  expect(records.size).toBe(3)
})

test('permission denial during deletion preserves data and disables another write', async ({ page }) => {
  const { state } = await setup(page)
  state.deleteStatus = 403
  await page.locator('#dataset-rows [data-delete]').first().click()
  await page.locator('#delete-confirm').click()
  await expect(page.locator('#delete-error')).toContainText('droits nécessaires')
  await expect(page.locator('#delete-confirm')).toBeDisabled()
  await page.locator('#delete-cancel').click()
  await expect(page.locator('#dataset-count')).toHaveText('3')
})

test('server metadata is rendered as text, including names in the confirmation', async ({ page }) => {
  const { records } = await setup(page)
  records.get('11111111-1111-4111-8111-111111111111').name = '<img src=x onerror="window.injected=true">'
  await page.locator('#refresh').click()
  await expect(page.locator('#dataset-rows')).toContainText('<img src=x')
  await page.locator('#dataset-rows [data-delete]').first().click()
  await expect(page.locator('#delete-name')).toContainText('<img src=x')
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
  await expect(page.locator('#delete-name img')).toHaveCount(0)
})

test('unavailable catalogue keeps the last loaded list and reports the error', async ({ page }) => {
  const { state } = await setup(page)
  state.listError = 503
  await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('dernière liste chargée')
  await expect(page.locator('#dataset-rows tr')).toHaveCount(3)
})

test('mobile layout fits the viewport and selection exposes full metadata', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { errors } = await setup(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'AROME · Golfe du Lion', exact: true }).click()
  await expect(page.locator('#detail-title')).toBeFocused()
  await expect(page.locator('#detail-content')).toContainText('Emprise annoncée')
  expect(errors).toEqual([])
})

test('anonymous visitors see a login link and no enabled deletion controls', async ({ page }) => {
  await page.route('**/skServer/loginStatus', route => route.fulfill({ json: { status: 'notLoggedIn', authenticationRequired: true } }))
  await page.route('**/plugins/signalk-forecast-dataset-provider/**', route => route.fulfill({ status: 401, body: 'Unauthorized' }))
  await page.goto('/signalk-forecast-dataset-browser/')
  await expect(page.locator('#notice')).toContainText('connexion est nécessaire')
  await expect(page.locator('#login-link')).toHaveText('Se connecter')
  await expect(page.locator('#dataset-rows tr')).toHaveCount(0)
})
