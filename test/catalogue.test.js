import { test } from 'node:test'
import assert from 'node:assert/strict'
import { API, createClient, canDelete, filterDatasets, formatBytes, serverPrefix } from '../public/catalogue.js'

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
const dataset = n => ({ id: id(n), name: `Dataset ${n}`, version: 'a'.repeat(64), metadataRevision: 1, model: 'GFS', format: 'grib2', producer: 'downloader', inventory: { status: 'unverified' } })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

test('publication monitoring uses a separate authenticated endpoint and preserves unknown totals', async () => {
  const publication = { id: id(8), datasetId: id(9), state: 'receiving', declaration: { producer: 'receiver' }, progress: { bytesReceived: 123, totalBytes: null } }
  const client = createClient({ prefix: '/proxy', fetchImpl: async (url, options) => {
    assert.equal(url, '/proxy' + API + '/publications')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.cache, 'no-store')
    return json({ [publication.id]: publication })
  } })
  assert.deepEqual(await client.publications(), [publication])
  const invalid = createClient({ fetchImpl: async () => json({ [publication.id]: { ...publication, progress: { bytesReceived: 123, totalBytes: 12 } } }) })
  await assert.rejects(invalid.publications(), /suivi invalide/)
})

test('lists all pages without filtering out other forecast formats or kinds', async () => {
  const requests = []
  const client = createClient({ fetchImpl: async (url, options) => {
    requests.push({ url, options })
    if (url === API + '/status') return json({ contractVersion: '0.1', datasets: 101 })
    const offset = Number(new URL(url, 'http://local').searchParams.get('offset'))
    return json(Object.fromEntries(Array.from({ length: offset ? 1 : 100 }, (_, i) => { const item = dataset(i + offset); if (offset) { item.format = 'zarr'; item.kind = 'analysis' }; return [item.id, item] })))
  } })
  const items = await client.list()
  assert.equal(items.length, 101)
  assert.equal(items[100].format, 'zarr')
  assert.ok(requests.some(r => r.url.includes('offset=100')))
  assert.ok(requests.every(r => r.options.credentials === 'same-origin' && r.options.cache === 'no-store' && r.options.redirect === 'error'))
  assert.ok(requests.every(r => !r.url.includes('format=') && !r.options.headers.Authorization))
})

test('a changing paginated listing rejects duplicates instead of claiming completeness', async () => {
  const first = Array.from({ length: 100 }, (_, i) => dataset(i))
  const client = createClient({ fetchImpl: async url => url.endsWith('/status') ? json({ contractVersion: '0.1' }) : json(Object.fromEntries(first.map(d => [d.id, d]))) })
  await assert.rejects(client.list(), /changé pendant la lecture/)
})

test('detail reads are version bound and validate returned identity', async () => {
  const item = dataset(1)
  let request
  const client = createClient({ fetchImpl: async url => { request = url; return json(item) } })
  assert.deepEqual(await client.detail(item.id, item.version), item)
  assert.ok(request.endsWith(`/versions/${item.version}`))
  const wrong = createClient({ fetchImpl: async () => json(dataset(2)) })
  await assert.rejects(wrong.detail(item.id), /ne correspond pas/)
})

test('deletion rechecks the head, then deletes only the confirmed dataset', async () => {
  const item = dataset(1), requests = []
  const client = createClient({ fetchImpl: async (url, options) => { requests.push({ url, method: options.method || 'GET' }); return options.method === 'DELETE' ? new Response(null, { status: 204 }) : json(item) } })
  assert.deepEqual(await client.remove(item), { alreadyDeleted: false })
  assert.deepEqual(requests, [{ url: `${API}/datasets/${item.id}`, method: 'GET' }, { url: `${API}/datasets/${item.id}`, method: 'DELETE' }])
})

test('a changed head or metadata revision prevents deletion', async () => {
  for (const current of [{ ...dataset(1), version: 'b'.repeat(64) }, { ...dataset(1), metadataRevision: 2 }]) {
    let writes = 0
    const client = createClient({ fetchImpl: async (_url, options) => { if (options.method === 'DELETE') writes++; return json(current) } })
    await assert.rejects(client.remove(dataset(1)), error => error.status === 412)
    assert.equal(writes, 0)
  }
})

test('busy datasets preserve the 409 conflict; no forced deletion is sent', async () => {
  const requests = []
  const client = createClient({ fetchImpl: async (url, options) => { requests.push(url); return options.method === 'DELETE' ? json({ code: 'DATASET_BUSY' }, 409) : json(dataset(1)) } })
  await assert.rejects(client.remove(dataset(1)), error => error.status === 409 && /utilisé/.test(error.message))
  assert.ok(requests.every(url => !url.includes('?')))
})

test('a dataset already removed by another client is treated as absent', async () => {
  const client = createClient({ fetchImpl: async () => json({ code: 'DATASET_NOT_FOUND' }, 404) })
  assert.deepEqual(await client.remove(dataset(1)), { alreadyDeleted: true })
})

test('authentication and readonly UI permissions match Signal K access levels', async () => {
  assert.equal(canDelete({ userLevel: 'admin' }), true)
  assert.equal(canDelete({ userLevel: 'readwrite' }), true)
  assert.equal(canDelete({ userLevel: 'readonly' }), false)
  assert.equal(canDelete(null), false)
  assert.equal(canDelete({ authenticationRequired: false }), true)
  const client = createClient({ fetchImpl: async () => new Response('Unauthorized', { status: 401 }) })
  await assert.rejects(client.list(), error => error.status === 401 && /session/.test(error.message))
})

test('paths honor reverse proxy prefixes and reject unsafe resource identities', async () => {
  assert.equal(serverPrefix('/proxy/signalk-forecast-dataset-browser/index.html'), '/proxy')
  assert.equal(serverPrefix('/signalk-forecast-dataset-browser/'), '')
  const client = createClient({ prefix: '/proxy', fetchImpl: async url => { assert.equal(url, '/proxy/skServer/loginStatus'); return json({}) } })
  await client.session()
  await assert.rejects(client.detail('../outside'), /invalide/)
  assert.equal(client.assetHref(dataset(1).id, dataset(1).version, '../asset'), null)
  assert.ok(client.assetHref(dataset(1).id, dataset(1).version, 'wind').startsWith('/proxy/plugins/'))
})

test('search and filters use available metadata; missing sizes remain unknown', () => {
  const records = [dataset(1), { ...dataset(2), model: 'AROME', format: 'zarr', inventory: { status: 'verified' } }]
  assert.equal(filterDatasets(records, { search: 'dataset gfs' }).length, 1)
  assert.equal(filterDatasets(records, { format: 'zarr', inventory: 'verified' }).length, 1)
  assert.equal(formatBytes(undefined), '—')
  assert.equal(formatBytes(0), '0 o')
  assert.equal(formatBytes(1024), '1 Kio')
})

test('a generic server 404 must not be reported as a successful deletion', async () => {
  const client = createClient({ fetchImpl: async () => new Response('Not found', { status: 404 }) })
  await assert.rejects(client.remove(dataset(1)), error => error.status === 404 && error.code === undefined)
})
