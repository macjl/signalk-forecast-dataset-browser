// SPDX-License-Identifier: Apache-2.0
export const API = '/plugins/signalk-forecast-dataset-provider'
const ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const VERSION = /^[a-f\d]{64}$/

export function serverPrefix(pathname) {
  return /^(.*)\/signalk-forecast-dataset-browser(?:\/|$)/.exec(pathname)?.[1] ?? ''
}
export function canDelete(session) {
  return session?.authenticationRequired === false || ['admin', 'readwrite'].includes(session?.userLevel)
}
export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—'
  const units = ['o', 'Kio', 'Mio', 'Gio', 'Tio']
  const exponent = value ? Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)) : 0
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: exponent ? 1 : 0 }).format(value / 1024 ** exponent)} ${units[exponent]}`
}
export function title(dataset) { return dataset.name || dataset.model || dataset.id || 'Dataset' }
export function filterDatasets(items, { search = '', format = '', inventory = '' } = {}) {
  const terms = search.toLocaleLowerCase('fr').trim().split(/\s+/).filter(Boolean)
  return items.filter(item => (!format || item.format === format)
    && (!inventory || item.inventory?.status === inventory)
    && terms.every(term => [item.id, item.name, item.model, item.producer, item.format, item.kind].join(' ').toLocaleLowerCase('fr').includes(term)))
}
export class CatalogueError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export function createClient({ prefix = '', fetchImpl = globalThis.fetch } = {}) {
  function datasetPath(id) {
    if (!ID.test(id)) throw new Error('Identifiant de dataset invalide.')
    return `${API}/datasets/${id}`
  }
  async function request(route, options = {}) {
    const response = await fetchImpl(prefix + route, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...options.headers }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    if (!response.ok) {
      let body = {}
      try { body = await response.json() } catch { /* non-JSON authentication response */ }
      const messages = {
        401: 'Votre session Signal K a expiré ou une connexion est nécessaire.',
        403: 'Votre compte ne dispose pas des droits nécessaires.',
        404: 'Ce dataset n’est plus disponible, ou le catalogue est désactivé.',
        409: 'Ce dataset est utilisé par une lecture ou une publication. Réessayez dans un instant.',
        503: 'Le catalogue démarre ou est temporairement indisponible.'
      }
      throw new CatalogueError(response.status, body.code, messages[response.status] || body.message || `Le catalogue a renvoyé une erreur HTTP ${response.status}.`)
    }
    return response.status === 204 ? null : response.json()
  }
  async function detail(id, version, signal) {
    let route = datasetPath(id)
    if (version) {
      if (!VERSION.test(version)) throw new Error('Version de contenu invalide.')
      route += `/versions/${version}`
    }
    const result = await request(route, { signal })
    if (!result || result.id !== id || !VERSION.test(result.version) || (version && result.version !== version)) throw new Error('La réponse du catalogue ne correspond pas au dataset demandé.')
    return result
  }
  return {
    session: signal => request('/skServer/loginStatus', { signal }),
    async publications(signal) {
      const entries = await request(API + '/publications', { signal })
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Réponse de publications invalide.')
      return Object.entries(entries).map(([id, publication]) => {
        if (!ID.test(id) || publication?.id !== id || !ID.test(publication.datasetId)
          || !['pending', 'receiving', 'ready'].includes(publication.state)
          || !publication.declaration || !publication.progress
          || !Number.isSafeInteger(publication.progress.bytesReceived) || publication.progress.bytesReceived < 0
          || !(publication.progress.totalBytes === null || (Number.isSafeInteger(publication.progress.totalBytes) && publication.progress.totalBytes >= publication.progress.bytesReceived))) throw new Error('Une publication possède un suivi invalide.')
        return publication
      })
    },
    async list({ signal, onProgress = () => {} } = {}) {
      const status = await request(API + '/status', { signal })
      if (status.contractVersion !== '0.1') throw new Error('Cette webapp nécessite le contrat 0.1 de Forecast Dataset Provider.')
      const items = new Map()
      for (let offset = 0; ; offset += 100) {
        const page = await request(`${API}/datasets?limit=100&offset=${offset}&sort=createdAt`, { signal })
        if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('Réponse de catalogue invalide.')
        const entries = Object.entries(page)
        for (const [id, item] of entries) {
          if (!ID.test(id) || item?.id !== id || !VERSION.test(item.version)) throw new Error('Un dataset du catalogue possède une identité invalide.')
          if (items.has(id)) throw new Error('Le catalogue a changé pendant la lecture. Actualisez la liste.')
          items.set(id, item)
        }
        onProgress(items.size)
        if (entries.length < 100) return [...items.values()]
      }
    },
    detail,
    async remove(expected, signal) {
      // Contract 0.1 has no conditional DELETE. Recheck the head before deleting
      // to reject a confirmation made against content that has already changed.
      try {
        const current = await detail(expected.id, undefined, signal)
        if (current.version !== expected.version || current.metadataRevision !== expected.metadataRevision) throw new CatalogueError(412, 'DATASET_CHANGED', 'Le dataset a changé depuis la confirmation. Annulez, actualisez sa fiche puis recommencez.')
        await request(datasetPath(expected.id), { method: 'DELETE', signal })
        return { alreadyDeleted: false }
      } catch (error) {
        if (error.status === 404 && error.code === 'DATASET_NOT_FOUND') return { alreadyDeleted: true }
        throw error
      }
    },
    inventory: (id, version, signal) => {
      if (!VERSION.test(version)) throw new Error('Version de contenu invalide.')
      return request(`${datasetPath(id)}/versions/${version}/index`, { signal })
    },
    assetHref(id, version, assetId) {
      if (!VERSION.test(version) || typeof assetId !== 'string' || !/^[A-Za-z\d][A-Za-z\d_-]{0,127}$/.test(assetId)) return null
      return `${prefix}${datasetPath(id)}/versions/${version}/assets/${assetId}`
    }
  }
}
