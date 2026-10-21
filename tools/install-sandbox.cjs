// Install/update only this browser inside the explicitly selected sandbox.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash, createHmac } = require('node:crypto')
const root = '/home/node/.signalk', name = 'signalk-forecast-dataset-browser'
const archive = process.argv[2], base = 'http://127.0.0.1:3000'
assert.equal(process.env.SIGNALK_CONTAINER_ID, 'signalk-sandbox')
assert.ok(archive && path.isAbsolute(archive) && path.relative(root, archive).startsWith('local-packages/') && !path.relative(root, archive).includes('..'))
assert.ok(fs.existsSync(archive))
const destination = path.join(root, 'node_modules', name)
const configFile = path.join(root, 'plugin-config-data', name + '.json')
const updating = fs.existsSync(destination)
const markerFile = path.join(root, 'local-packages/forecast-browser-install-backup.json')
if (updating) {
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'package.json'))).name, name)
  assert.ok(fs.existsSync(configFile) && fs.existsSync(markerFile), 'Updates require this helper’s previous installation backup')
} else assert.ok(!fs.existsSync(configFile), 'Existing orphan browser configuration must be preserved explicitly')
const security = JSON.parse(fs.readFileSync(path.join(root, 'security.json')))
const admin = security.users.find(u => u.type === 'admin')
assert.ok(admin)
const secret = security.secretKey || fs.readFileSync(path.join(root, 'security-secret.key'), 'utf8').trim()
const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const p = Buffer.from(JSON.stringify({ id: admin.username, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')
const auth = { Authorization: `Bearer ${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}` }
const get = async route => {
  const response = await fetch(base + route, { headers: auth })
  assert.equal(response.status, 200, route)
  return response.json()
}
const atomic = (file, value) => {
  const previous = fs.existsSync(file) ? fs.statSync(file) : null
  fs.writeFileSync(file + '.browser.tmp', JSON.stringify(value, null, 2) + '\n', { mode: previous ? previous.mode & 0o777 : 0o600 })
  fs.chownSync(file + '.browser.tmp', previous?.uid ?? 1000, previous?.gid ?? 1000)
  fs.renameSync(file + '.browser.tmp', file)
}
async function main() {
  assert.equal((await get('/plugins/signalk-forecast-dataset-provider/status')).contractVersion, '0.1')
  const ids = []
  for (let offset = 0; ; offset += 100) {
    const page = Object.keys(await get(`/plugins/signalk-forecast-dataset-provider/datasets?limit=100&offset=${offset}`))
    ids.push(...page)
    if (page.length < 100) break
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(root, 'local-packages', `forecast-browser-before-install-${stamp}`)
  fs.mkdirSync(backup, { mode: 0o700 })
  for (const file of ['package.json', 'package-lock.json', 'node_modules/.package-lock.json']) if (fs.existsSync(path.join(root, file))) fs.copyFileSync(path.join(root, file), path.join(backup, file.replaceAll('/', '-')))
  const configDir = path.join(root, 'plugin-config-data')
  const hashes = Object.fromEntries(fs.readdirSync(configDir).filter(f => f.endsWith('.json')).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(configDir, f))).digest('hex')]))
  fs.writeFileSync(path.join(backup, 'baseline.json'), JSON.stringify({ hashes, datasetIds: ids.sort() }))
  const staging = path.join(root, 'node_modules', `.forecast-browser-install-${stamp}`)
  fs.mkdirSync(staging)
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '-C', staging])
  const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json')))
  assert.equal(pkg.name, name)
  assert.equal(pkg.version, '0.1.0')
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length)
  assert.ok(fs.existsSync(path.join(staging, 'public/app.js')))
  execFileSync('chown', ['-R', 'node:node', staging])
  const oldPackage = path.join(root, 'node_modules', '.forecast-browser-previous')
  if (updating) {
    assert.ok(!fs.existsSync(oldPackage))
    execFileSync('tar', ['-czf', path.join(backup, 'previous-plugin.tgz'), '-C', destination, '.'])
    fs.renameSync(destination, oldPackage)
  }
  fs.renameSync(staging, destination)
  const relative = path.relative(root, archive)
  const packages = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  packages.dependencies ??= {}
  packages.dependencies[name] = `file:${relative}`
  atomic(path.join(root, 'package.json'), packages)
  const entry = { version: pkg.version, resolved: `file:${relative}`, integrity: `sha512-${createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`, license: pkg.license, engines: pkg.engines }
  for (const file of ['package-lock.json', 'node_modules/.package-lock.json']) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) continue
    const lock = JSON.parse(fs.readFileSync(full))
    lock.packages[`node_modules/${name}`] = entry
    if (lock.packages['']) { lock.packages[''].dependencies ??= {}; lock.packages[''].dependencies[name] = `file:${relative}` }
    atomic(full, lock)
  }
  if (!updating) atomic(configFile, { enabled: true, enableDebug: false, enableLogging: false, configuration: {} })
  const initialBackup = updating ? (JSON.parse(fs.readFileSync(markerFile)).initialBackup || JSON.parse(fs.readFileSync(markerFile)).backup) : backup
  atomic(markerFile, { backup, initialBackup, version: pkg.version })
  if (updating) fs.rmSync(oldPackage, { recursive: true })
  console.log(`Installed ${name} ${pkg.version}; no existing packages re-resolved. Backup: ${backup}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
