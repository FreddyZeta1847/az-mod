/*
 * pane/theme.ts — the single color system and the Italian labels of the az-mod pane
 * (direction C «cruscotto», from design/bozze/data.ts): surface colors, the status
 * colors (used only for status), one hue per resource type, fact labels, and the small
 * text helpers that turn a card's facts and times into what a row shows, plus the words of
 * amounts, warnings («Da guardare») and activities.
 */
import type { AzCard, AzFactKey, AzStatus, AzWarning, Ms } from '../../types'

import { FACTS_BY_TYPE } from '../contract'

export const C = {
  bg: '#0f1220', surface: '#161a2b', surface2: '#1d2238', border: '#2a2f3d',
  text: '#e6e9f2', muted: '#9aa3b8', faint: '#6b7489',
}

export const STATUS: Record<AzStatus, { color: string; label: string }> = {
  ok: { color: '#3ddc97', label: 'Attiva' },
  busy: { color: '#ffb547', label: 'In aggiornamento' },
  failed: { color: '#ff5d73', label: 'Problema' },
  stopped: { color: '#8b93a7', label: 'Ferma' },
  unknown: { color: '#6b7489', label: 'Sconosciuto' },
}
export const STATUS_ORDER: AzStatus[] = ['ok', 'busy', 'failed', 'stopped', 'unknown']

/** Icon shapes; one per family of types (svg.ts draws them). */
export type TypeKey = 'ca' | 'env' | 'acr' | 'ai' | 'srch' | 'bing' | 'kv' | 'st' | 'id' | 'log' | 'web' | 'db' | 'other'

// Hues never green, amber or red: those belong to status.
const TYPES: Record<string, { label: string; color: string; glyph: TypeKey }> = {
  'microsoft.app/containerapps': { label: 'Container Apps', color: '#4cc9f0', glyph: 'ca' },
  'microsoft.app/managedenvironments': { label: 'Ambienti', color: '#7c8cff', glyph: 'env' },
  'microsoft.containerregistry/registries': { label: 'Registry', color: '#5b9bff', glyph: 'acr' },
  'microsoft.cognitiveservices/accounts': { label: 'Foundry', color: '#a48bff', glyph: 'ai' },
  'microsoft.cognitiveservices/accounts/projects': { label: 'Foundry', color: '#a48bff', glyph: 'ai' },
  'microsoft.search/searchservices': { label: 'AI Search', color: '#38bdf8', glyph: 'srch' },
  'microsoft.bing/accounts': { label: 'Bing', color: '#e879f9', glyph: 'bing' },
  'microsoft.keyvault/vaults': { label: 'Key Vault', color: '#f472b6', glyph: 'kv' },
  'microsoft.storage/storageaccounts': { label: 'Storage', color: '#2dd4bf', glyph: 'st' },
  'microsoft.managedidentity/userassignedidentities': { label: 'Identità', color: '#c792ea', glyph: 'id' },
  'microsoft.operationalinsights/workspaces': { label: 'Log Analytics', color: '#94a3b8', glyph: 'log' },
  'microsoft.web/sites': { label: 'Web App', color: '#818cf8', glyph: 'web' },
  'microsoft.web/staticsites': { label: 'Static Web App', color: '#22d3ee', glyph: 'web' },
  'microsoft.sql/servers/databases': { label: 'Database SQL', color: '#c4b5fd', glyph: 'db' },
  'microsoft.documentdb/databaseaccounts': { label: 'Cosmos DB', color: '#f0abfc', glyph: 'db' },
}
const OTHER = { label: 'Altro', color: '#64748b', glyph: 'other' as TypeKey }
/** Group order in the pane: the table's order, then «Altro». */
export const TYPE_ORDER: string[] = [...new Set(Object.values(TYPES).map(t => t.label)), OTHER.label]

export const typeStyle = (armType: string): { label: string; color: string; glyph: TypeKey } =>
  TYPES[armType.toLowerCase()] ?? OTHER

export const FACT_LABELS: Record<AzFactKey, string> = {
  sku: 'Piano', kind: 'Tipo', url: 'Indirizzo', runtime: 'Linguaggio', alwaysOn: 'Always On',
  httpsOnly: 'Solo HTTPS', publicAccess: 'Accesso pubblico', customDomains: 'Domini',
  revisionMode: 'Revisioni', ingress: 'Ingresso', traffic: 'Traffico', latestRevision: 'Ultima revisione',
  latestRevisionReady: 'Ultima revisione partita', image: 'Immagine', cpu: 'CPU', memoryGi: 'Memoria (Gi)',
  minReplicas: 'Repliche min', maxReplicas: 'Repliche max', repositoryUrl: 'Repository', branch: 'Ramo',
  redundancy: 'Ridondanza', accessTier: 'Livello', minTls: 'TLS minimo', softDelete: 'Soft delete',
  purgeProtection: 'Protezione eliminazione', maxSizeBytes: 'Dimensione max', freeTier: 'Livello gratuito',
  adminUser: 'Utente admin', models: 'Modelli', lastBuildStatus: 'Ultima build', lastBuildAt: 'Ora build',
}

export const factText = (v: string | number | boolean): string =>
  typeof v === 'boolean' ? (v ? 'sì' : 'no') : String(v)

/** The facts a card has, in its type's order (unknown types: in the card's order). */
export const factsOf = (card: AzCard): [AzFactKey, string][] => {
  const order = FACTS_BY_TYPE[card.type.toLowerCase()] ?? (Object.keys(card.facts) as AzFactKey[])
  return order.flatMap(k => (card.facts[k] === undefined ? [] : [[k, factText(card.facts[k] as string)] as [AzFactKey, string]]))
}

/** One line for a closed row: the type's first fact with its label, «sparita», or «—». */
export const keyFact = (card: AzCard): string => {
  if (card.goneAt !== undefined) return 'sparita da Azure'
  const first = factsOf(card)[0]
  return first ? `${FACT_LABELS[first[0]]}: ${first[1]}` : '—'
}

/** «40 s fa», «12 min fa», «3 h fa», «2 giorni fa». */
/** «1 risorsa», «3 risorse». */
export const resourceCount = (n: number): string => (n === 1 ? '1 risorsa' : `${n} risorse`)

export const ago = (now: Ms, at: Ms): string => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s} s fa`
  if (s < 3600) return `${Math.floor(s / 60)} min fa`
  if (s < 86_400) return `${Math.floor(s / 3600)} h fa`
  return `${Math.floor(s / 86_400)} giorni fa`
}

/** Last segment(s) after the type: a child keeps «parent/child». */
export const nameFromId = (id: string): string => {
  const m = /\/providers\/[^/]+\/[^/]+\/(.+)$/.exec(id)
  return (m?.[1] ?? id.split('/').pop() ?? id).split('/').filter((_, i) => i % 2 === 0).join('/')
}

/** «12,30 €» for euros, «12,30 USD» for any other currency. */
export const money = (n: number, currency: string): string =>
  `${n.toFixed(2).replace('.', ',')} ${currency === 'EUR' ? '€' : currency}`

export const WARNING_TEXT: Record<AzWarning, { cause: string; action: string }> = {
  'revision-failed': { cause: "l'ultima revisione non è partita", action: 'guarda i log della revisione nel portale' },
  'app-stopped': { cause: "l'app è ferma", action: 'riavviala dal portale o chiedilo a Claude' },
  'cost-spike': { cause: 'costa più di 1,5 volte il mese scorso', action: 'controlla repliche e piano' },
  'kv-protection-off': { cause: 'Key Vault senza protezione dalla cancellazione', action: 'attiva soft delete e protezione' },
  'registry-admin': { cause: "utente admin del registry attivo", action: "usa un'identità gestita e spegni l'admin" },
  'public-access': { cause: 'accesso pubblico attivo', action: "limita l'accesso dalla rete" },
  'build-not-ready': { cause: "l'ultima build non è pronta", action: 'guarda la build su GitHub' },
}

/** [operation, words when it worked, words when it failed]: the first match wins. */
const ACTIVITY_WORDS: [RegExp, string, string][] = [
  [/\/delete$/, 'cancellata', 'cancellazione non riuscita'],
  [/\/restart\/action$/, 'riavviata', 'riavvio non riuscito'],
  [/\/stop\/action$/, 'fermata', 'arresto non riuscito'],
  [/\/start\/action$/, 'avviata', 'avvio non riuscito'],
  [/\/deploy\/action$/, 'pubblicata', 'pubblicazione non riuscita'],
  [/\/activate\/action$/, 'revisione attivata', 'attivazione non riuscita'],
  [/\/write$/, 'creata o modificata', 'modifica non riuscita'],
]

export const activityText = (op: string, status: string): string => {
  const words = ACTIVITY_WORDS.find(([re]) => re.test(op.toLowerCase()))
  const failed = status.toLowerCase() === 'failed'
  return words === undefined ? (failed ? 'operazione non riuscita' : 'operazione') : failed ? words[2] : words[1]
}
