// SPDX-License-Identifier: Apache-2.0
import { createClient, serverPrefix, canDelete, filterDatasets, formatBytes, title } from './catalogue.js'

const prefix = serverPrefix(location.pathname)
const client = createClient({ prefix })
const $ = id => document.getElementById(id)
const state = { items: [], publications: [], session: null, selectedId: null, detail: null, generation: 0, loadController: null, detailController: null, deleting: false, preparingDelete: false, pending: null, lastUpdate: null, loaded: false }
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
const localTime = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' })
const kindNames = { forecast: 'Prévision', analysis: 'Analyse', harmonic: 'Harmonique' }
const trashPath = 'M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7m4-7v7'

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') element.className = value
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else if (key === 'disabled') element.disabled = Boolean(value)
    else element.setAttribute(key, String(value))
  }
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null) element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return element
}
function trashIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', trashPath); svg.append(path)
  return svg
}
function date(value) { return value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : 'Non renseigné' }
function plural(count, singular, multiple = singular + 's') { return `${count} ${count === 1 ? singular : multiple}` }
function badge(inventory) {
  const status = inventory?.status
  return node('span', { class: `badge ${status === 'verified' ? 'verified' : status === 'unverified' ? 'unverified' : 'unknown'}` }, status === 'verified' ? 'Vérifié' : status === 'unverified' ? 'Non vérifié' : 'Non renseigné')
}
function setConnection(text, mode = '') { $('connection-state').textContent = text; $('connection-state').className = `connection-state ${mode}` }
function notice(message) { $('notice').textContent = message || ''; $('notice').hidden = !message }
let toastTimer
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500) }
function permissions() {
  const writable = canDelete(state.session)
  $('access-level').textContent = writable ? 'Lecture & suppression' : 'Lecture seule'
  $('login-link').textContent = state.session?.status === 'loggedIn' ? 'Session Signal K' : 'Se connecter'
  for (const button of document.querySelectorAll('[data-delete]')) {
    button.disabled = !writable || state.deleting
    button.title = writable ? 'Supprimer ce dataset et toutes ses versions' : 'Un compte autorisé en écriture est nécessaire pour supprimer'
  }
}
function summary() {
  $('dataset-count').textContent = state.loaded ? state.items.length : '—'
  const knownSizes = state.items.filter(d => Number.isFinite(d.size) && d.size >= 0)
  $('total-bytes').textContent = state.loaded ? formatBytes(knownSizes.reduce((sum, d) => sum + d.size, 0)) : '—'
  const unknown = state.items.length - knownSizes.length
  $('volume-note').textContent = unknown ? `${plural(unknown, 'taille inconnue', 'tailles inconnues')}` : 'Fichiers d’origine dans le catalogue'
  $('verified-count').textContent = state.loaded ? state.items.filter(d => d.inventory?.status === 'verified').length : '—'
  const value = $('format').value
  const formats = [...new Set(state.items.map(d => d.format).filter(Boolean))].sort()
  $('format').replaceChildren(node('option', { value: '' }, 'Tous les formats'), ...formats.map(format => node('option', { value: format }, format.toUpperCase())))
  $('format').value = formats.includes(value) ? value : ''
}
function renderList() {
  const visible = filterDatasets(state.items, { search: $('search').value, format: $('format').value, inventory: $('inventory').value })
  $('result-count').textContent = state.loaded ? (visible.length === state.items.length ? `${plural(visible.length, 'jeu de données', 'jeux de données')} dans le catalogue` : `${visible.length} sur ${plural(state.items.length, 'jeu de données', 'jeux de données')}`) : 'Chargement du catalogue…'
  $('dataset-rows').replaceChildren(...visible.map(item => {
    const open = () => selectDataset(item.id, true)
    const name = node('button', { type: 'button', class: 'dataset-title', 'aria-pressed': item.id === state.selectedId ? 'true' : 'false', onclick: open }, title(item))
    const labels = node('div', { class: 'row-labels' }, item.model ? node('span', { class: 'model-tag' }, item.model) : null, node('span', { class: 'format-tag' }, (item.format || 'format inconnu').toUpperCase()))
    const nameCell = node('td', {}, name, node('span', { class: 'dataset-producer' }, item.producer || 'Producteur non renseigné'), labels)
    const cycle = node('td', { class: 'cycle-column date-cell' }, date(item.run))
    const files = node('td', { class: 'file-count' }, Number.isFinite(item.assetCount) ? plural(item.assetCount, 'fichier') : '—', node('small', {}, formatBytes(item.size)))
    const remove = node('button', { class: 'icon-button', type: 'button', 'data-delete': item.id, 'aria-label': `Supprimer ${title(item)}`, onclick: () => openDelete(item.id, remove) }, trashIcon())
    return node('tr', { class: item.id === state.selectedId ? 'selected' : '', 'data-id': item.id, onclick: event => { if (!event.target.closest('button,a')) open() } }, nameCell, cycle, files, node('td', { class: 'inventory-column' }, badge(item.inventory)), node('td', {}, remove))
  }))
  const filtered = Boolean($('search').value || $('format').value || $('inventory').value)
  $('list-empty').hidden = !state.loaded || visible.length > 0
  $('clear-filters').hidden = !filtered
  $('empty-title').textContent = filtered ? 'Aucun dataset ne correspond' : 'Le catalogue est vide'
  $('empty-description').textContent = filtered ? 'Essayez un autre nom, format ou état d’inventaire.' : 'Les prochaines acquisitions publiées apparaîtront ici.'
  permissions()
}
let publicationTimer, publicationController
function stopPublicationMonitoring() {
  clearTimeout(publicationTimer)
  publicationController?.abort()
}
function renderPublications() {
  const labels = { pending: 'En attente / à reprendre', receiving: 'Réception en cours', ready: 'Reçu · en attente de publication' }
  $('publication-count').hidden = !state.publications.length
  $('publication-count').textContent = plural(state.publications.length, 'acquisition')
  $('publication-rows').replaceChildren(...state.publications.map(publication => {
    const { declaration, progress } = publication
    const known = progress.totalBytes !== null
    const card = node('article', { class: 'publication-card', 'data-publication': publication.id },
      node('strong', {}, title({ ...declaration.metadata, id: publication.id })),
      node('span', { class: 'badge unverified' }, labels[publication.state]),
      node('p', { class: 'small muted' }, `${declaration.producer} · ${(declaration.format || '').toUpperCase()} · ${progress.assetsCompleted}/${progress.assetsTotal} fichiers terminés`),
      node('p', { class: 'small publication-bytes' }, `${formatBytes(progress.bytesReceived)} reçus${known ? ` sur ${formatBytes(progress.totalBytes)}` : ' · taille totale inconnue'}`),
      node('progress', { max: known ? progress.totalBytes || 1 : undefined, value: known ? progress.bytesReceived : undefined, 'aria-label': 'Progression de la réception' }),
      node('code', { class: 'small muted' }, publication.id))
    return card
  }))
}
async function monitorPublications() {
  stopPublicationMonitoring()
  const controller = new AbortController(); publicationController = controller
  if (!canDelete(state.session)) {
    state.publications = []; renderPublications()
    $('publications-note').textContent = 'Le suivi des acquisitions nécessite un compte autorisé en écriture.'
    return
  }
  async function refresh() {
    let repeat = true
    try {
      if (document.hidden) return
      const previous = state.publications
      const current = await client.publications(controller.signal)
      if (controller.signal.aborted) return
      state.publications = current; renderPublications()
      $('publications-note').textContent = current.length ? 'Suivi automatique. Ces contenus ne sont pas encore utilisables par les consommateurs.' : 'Aucune acquisition en cours. Suivi automatique actif.'
      if (previous.some(p => !current.some(c => c.id === p.id))) {
        // Disappearance may be commit or abort: reconcile the complete catalogue.
        if (!state.deleting && !$('delete-dialog').open) { await load(); return }
      }
    } catch (error) {
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(error.status)) {
        state.publications = []; renderPublications(); repeat = false
      }
      if ([401, 403].includes(error.status)) { state.session = null; permissions() }
      $('publications-note').textContent = error.status === 404 ? 'Le suivi nécessite Forecast Dataset Provider 0.1.1 ou plus récent.' : `Suivi indisponible : ${error.message} Les éventuelles valeurs affichées ne sont plus à jour.`
    } finally {
      if (repeat && !controller.signal.aborted) publicationTimer = setTimeout(refresh, state.publications.length ? 2000 : 5000)
    }
  }
  await refresh()
}
function metadata(entries) {
  const list = node('dl', { class: 'metadata' })
  for (const [label, value] of entries) list.append(node('dt', {}, label), node('dd', {}, value ?? 'Non renseigné'))
  return list
}
function jsonSection(label, value, help) {
  if (value === undefined || value === null) return null
  return node('details', {}, node('summary', {}, label), help ? node('p', { class: 'metadata-section' }, help) : null, node('pre', {}, JSON.stringify(value, null, 2)))
}
function clearDetail() {
  state.detailController?.abort(); state.detail = null; state.selectedId = null
  $('detail-title').textContent = 'Choisissez un dataset'; $('detail-format').hidden = true; $('detail-panel').setAttribute('aria-busy', 'false')
  $('detail-content').replaceChildren(node('p', { class: 'muted detail-placeholder' }, 'Sélectionnez une ligne pour consulter les métadonnées, les fichiers et l’inventaire disponibles.'))
}
function renderDetail(detail) {
  $('detail-title').textContent = title(detail)
  $('detail-format').textContent = (detail.format || '—').toUpperCase(); $('detail-format').hidden = false
  const verified = detail.inventory?.status === 'verified'
  const base = [
    ['Modèle', detail.model], ['Type de données', kindNames[detail.kind] || detail.kind],
    ['Cycle du modèle', `${date(detail.run)}${detail.run ? ' UTC' : ''}`], ['Publication', `${date(detail.createdAt)}${detail.createdAt ? ' UTC' : ''}`],
    ['Producteur', detail.producer], ['Fichiers', `${plural(detail.assets?.length ?? detail.assetCount ?? 0, 'fichier')} · ${formatBytes(detail.size)}`]
  ]
  if (detail.forecast) base.push(['Période annoncée', `${date(detail.forecast.from)} → ${date(detail.forecast.to)} UTC`])
  if (detail.bounds) base.push(['Emprise annoncée', `O ${detail.bounds[0]}° · S ${detail.bounds[1]}°\nE ${detail.bounds[2]}° · N ${detail.bounds[3]}°`])
  const assets = node('details', {}, node('summary', {}, `Fichiers d’origine (${detail.assets?.length ?? 0})`))
  const assetList = node('div', { class: 'assets' })
  for (const asset of detail.assets || []) {
    const href = client.assetHref(detail.id, detail.version, asset.id)
    assetList.append(node('div', { class: 'asset' }, node('div', { class: 'asset-info' }, node('span', { class: 'asset-name' }, asset.id), node('span', { class: 'asset-meta' }, `${formatBytes(asset.size)} · ${asset.mediaType || 'type non renseigné'}`), node('span', { class: 'asset-meta', title: asset.sha256 }, `SHA-256 · ${asset.sha256 || 'non renseigné'}`)), href ? node('a', { href, download: asset.id, title: `Télécharger ${asset.id}`, 'aria-label': `Télécharger ${asset.id}` }, '↓') : null))
  }
  assets.append(assetList)
  const identity = node('details', {}, node('summary', {}, 'Identité et version'), metadata([
    ['Identifiant', node('code', {}, detail.id)], ['Version du contenu', node('code', {}, detail.version)],
    ['Révision des métadonnées', detail.metadataRevision], ['État', detail.state], ['Contrat', detail.contractVersion]
  ]))
  let inventorySection = null
  if (verified) {
    const output = node('div')
    const button = node('button', { class: 'button secondary', type: 'button', onclick: async () => {
      button.disabled = true; output.replaceChildren(node('p', { class: 'metadata-section' }, 'Chargement de l’inventaire…'))
      try {
        const inventory = await client.inventory(detail.id, detail.version, state.detailController.signal)
        output.replaceChildren(node('pre', {}, JSON.stringify(inventory, null, 2)))
      } catch (error) { if (error.name !== 'AbortError') output.replaceChildren(node('p', { class: 'metadata-section' }, error.message)); button.disabled = false }
    } }, 'Charger l’inventaire')
    inventorySection = node('details', {}, node('summary', {}, 'Inventaire vérifié et index'), node('p', { class: 'metadata-section' }, 'L’inventaire précise les métadonnées réellement vérifiées. L’index peut être volumineux.'), button, output)
  }
  const remove = node('button', { class: 'button', type: 'button', 'data-delete': detail.id, onclick: () => openDelete(detail.id, remove) }, trashIcon(), 'Supprimer le dataset')
  const deleteHelp = canDelete(state.session) ? 'Supprime le dataset et toutes ses versions dans le catalogue.' : 'La suppression nécessite un compte Signal K autorisé en écriture.'
  const sections = [
    detail.description ? node('p', { class: 'detail-description' }, detail.description) : node('p', { class: 'detail-description' }, 'Contenu publié dans le catalogue de prévisions.'),
    node('div', { class: 'detail-summary' }, badge(detail.inventory), node('span', { class: 'small muted' }, verified ? 'Inventaire disponible' : 'Métadonnées déclarées')),
    node('p', { class: 'inventory-note' }, verified ? 'Les champs vérifiés sont décrits dans l’inventaire. Les autres informations restent déclaratives.' : 'Un contenu complet peut être disponible avant son indexation. Sa couverture et ses champs ne sont pas encore vérifiés.'),
    metadata(base), assets,
    jsonSection('Champs disponibles', detail.fields), jsonSection('Grille', detail.grid),
    jsonSection('Métadonnées déclarées', detail.declared, 'Informations fournies à la publication, avant une éventuelle vérification.'),
    jsonSection('Paramètres demandés', detail.requested, 'Choix demandés à l’acquisition ; ils ne prouvent pas la couverture réelle.'),
    jsonSection('Provenance', detail.provenance), inventorySection, identity,
    jsonSection('Toutes les métadonnées · JSON', detail),
    node('div', { class: 'delete-section' }, remove, node('p', {}, deleteHelp))
  ]
  $('detail-content').replaceChildren(...sections.filter(section => section !== null))
  permissions()
}
async function selectDataset(id, focus = false) {
  const item = state.items.find(d => d.id === id)
  if (!item) return
  state.detailController?.abort()
  const controller = new AbortController(); state.detailController = controller
  state.selectedId = id; state.detail = null; renderList()
  $('detail-title').textContent = title(item); $('detail-format').hidden = true; $('detail-panel').setAttribute('aria-busy', 'true')
  $('detail-content').replaceChildren(node('p', { class: 'muted detail-placeholder' }, 'Lecture des métadonnées…'))
  if (focus && matchMedia('(max-width: 860px)').matches) $('detail-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  try {
    const detail = await client.detail(id, item.version, controller.signal)
    if (controller.signal.aborted) return
    state.detail = detail; renderDetail(detail)
    if (focus) $('detail-title').focus({ preventScroll: true })
  } catch (error) {
    if (!controller.signal.aborted) $('detail-content').replaceChildren(node('p', { class: 'detail-description' }, error.message), node('button', { class: 'button secondary', type: 'button', onclick: () => selectDataset(id) }, 'Réessayer'))
  } finally { if (!controller.signal.aborted) $('detail-panel').setAttribute('aria-busy', 'false') }
}
async function load() {
  if (state.deleting) return
  stopPublicationMonitoring()
  state.loadController?.abort()
  const controller = new AbortController(); state.loadController = controller
  const generation = ++state.generation
  $('refresh').disabled = true; setConnection('Lecture du catalogue…'); notice('')
  try {
    const results = await Promise.allSettled([
      client.session(controller.signal), client.list({ signal: controller.signal, onProgress: count => { if (generation === state.generation) $('result-count').textContent = `${plural(count, 'dataset lu', 'datasets lus')}…` } })
    ])
    if (controller.signal.aborted) return
    state.session = results[0].status === 'fulfilled' ? results[0].value : null
    if (results[1].status === 'rejected') throw results[1].reason
    state.items = results[1].value; state.loaded = true; state.lastUpdate = new Date()
    $('last-update').textContent = `Mis à jour à ${localTime.format(state.lastUpdate)}`
    summary(); renderList(); permissions(); setConnection('Catalogue connecté', 'ready')
    await monitorPublications()
    if (controller.signal.aborted) return
    if (results[0].status === 'rejected') notice('Les droits de la session n’ont pas pu être vérifiés. La consultation reste disponible.')
    const selected = state.items.some(d => d.id === state.selectedId) ? state.selectedId : state.items[0]?.id
    if (selected) await selectDataset(selected)
    else clearDetail()
  } catch (error) {
    if (!controller.signal.aborted) {
      permissions(); renderList(); notice(error.message + (state.lastUpdate ? ' La dernière liste chargée reste affichée.' : '')); setConnection('Catalogue indisponible', 'error')
      if (!state.loaded) { $('result-count').textContent = 'Aucune donnée chargée'; $('list-empty').hidden = false; $('empty-title').textContent = 'Le catalogue n’est pas accessible'; $('empty-description').textContent = 'Vérifiez votre connexion à Signal K et que Forecast Dataset Provider est activé.' }
    }
  } finally { if (generation === state.generation) $('refresh').disabled = false }
}
let deleteOpener
async function openDelete(id, opener) {
  if (!canDelete(state.session) || state.deleting || state.preparingDelete) return
  state.preparingDelete = true
  opener.disabled = true
  try {
    // Inspect the latest head for confirmation, even if the list is older.
    const detail = await client.detail(id)
    state.pending = detail; deleteOpener = opener
    $('delete-name').textContent = title(detail); $('delete-id').textContent = detail.id
    $('delete-summary').textContent = `${detail.model || detail.format} · ${plural(detail.assets?.length ?? detail.assetCount ?? 0, 'fichier')} · ${formatBytes(detail.size)}`
    $('delete-error').hidden = true; $('delete-confirm').disabled = false
    $('delete-dialog').showModal()
  } catch (error) { notice(error.message); if (error.status === 404) load() }
  finally { state.preparingDelete = false; permissions() }
}
function closeDelete() {
  if (state.deleting) return
  $('delete-dialog').close(); state.pending = null
  if (deleteOpener?.isConnected) deleteOpener.focus(); else $('refresh').focus()
}
async function confirmDelete(event) {
  event.preventDefault()
  const expected = state.pending
  if (!expected || state.deleting || !canDelete(state.session)) return
  state.deleting = true; permissions(); $('delete-cancel').disabled = true; $('delete-confirm').disabled = true; $('delete-confirm').textContent = 'Suppression…'; $('delete-error').hidden = true; $('refresh').disabled = true
  try {
    const result = await client.remove(expected)
    state.items = state.items.filter(d => d.id !== expected.id)
    if (state.selectedId === expected.id) clearDetail()
    summary(); renderList()
    state.deleting = false; closeDelete()
    toast(result.alreadyDeleted ? 'Ce dataset a déjà été supprimé.' : 'Dataset supprimé du catalogue.')
    await load()
  } catch (error) {
    $('delete-error').textContent = error.message; $('delete-error').hidden = false
    if ([401, 403].includes(error.status)) { state.session = null; permissions() }
  } finally {
    state.deleting = false; permissions(); $('delete-cancel').disabled = false; $('delete-confirm').disabled = !canDelete(state.session); $('delete-confirm').textContent = 'Supprimer le dataset'; $('refresh').disabled = false
  }
}
$('login-link').href = prefix + '/admin/#/login'
$('refresh').addEventListener('click', load)
$('search').addEventListener('input', renderList)
for (const id of ['format', 'inventory']) $(id).addEventListener('change', renderList)
$('clear-filters').addEventListener('click', () => { $('search').value = ''; $('format').value = ''; $('inventory').value = ''; renderList(); $('search').focus() })
$('delete-cancel').addEventListener('click', closeDelete)
$('delete-form').addEventListener('submit', confirmDelete)
$('delete-dialog').addEventListener('cancel', event => { if (state.deleting) event.preventDefault(); else { event.preventDefault(); closeDelete() } })
addEventListener('pagehide', stopPublicationMonitoring)
load()
