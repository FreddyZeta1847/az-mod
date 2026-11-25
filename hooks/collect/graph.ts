/*
 * graph.ts — reads a project's resources from Azure Resource Graph (one `az rest` query
 * for all its groups and included ids, following $skipToken pages) and one resource with
 * `az resource show`, and turns each row into a card. Only named fields are asked for —
 * never `properties` whole (Container App env values are plaintext there) — and each fact
 * comes only from FACTS_BY_TYPE of the row's type, through the secret filter.
 * The query body travels in a file under the data dir (`--body @<file>`).
 */
import type { EngineInterface } from 'claude-code'

import { runAz } from './az'
import type { AzRun } from './az'
import { cleanValue } from './secrets'
import { dataDir } from './store'
import { AUTO_CREATED_GROUPS, AUTO_CREATED_TYPES, FACTS_BY_TYPE, groupIdOf } from '../contract'
import type { GraphRow } from '../fixtures/azure'
import type { AzCard, AzFactKey, AzFacts, AzId, AzRules, AzStatus, AzWarning } from '../../types'

const GRAPH_URL = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01'
const C0 = 'properties.template.containers[0]'

/** Each GraphRow column and the KQL that fills it (the fixture's GraphRow is the contract). */
const COLUMNS: Record<keyof GraphRow, string> = {
  id: 'tolower(id)', name: 'name', type: 'tolower(type)', resourceGroup: 'resourceGroup', location: 'location',
  kind: 'kind', sku: 'tostring(sku.name)',
  runningStatus: 'tostring(properties.runningStatus)', state: 'tostring(properties.state)',
  provisioningState: 'tostring(properties.provisioningState)',
  latestRevisionName: 'tostring(properties.latestRevisionName)', latestReadyRevisionName: 'tostring(properties.latestReadyRevisionName)',
  url: 'tostring(coalesce(properties.configuration.ingress.fqdn, properties.defaultHostName, properties.loginServer))',
  image: `tostring(${C0}.image)`, cpu: `toreal(${C0}.resources.cpu)`, memory: `tostring(${C0}.resources.memory)`,
  minReplicas: 'toint(properties.template.scale.minReplicas)', maxReplicas: 'toint(properties.template.scale.maxReplicas)',
  revisionMode: 'tostring(properties.configuration.activeRevisionsMode)',
  ingressExternal: 'tobool(properties.configuration.ingress.external)', traffic: 'tostring(properties.configuration.ingress.traffic)',
  runtime: 'tostring(properties.siteConfig.linuxFxVersion)', alwaysOn: 'tobool(properties.siteConfig.alwaysOn)',
  httpsOnly: 'tobool(properties.httpsOnly)', publicNetworkAccess: 'tostring(properties.publicNetworkAccess)',
  customDomains: 'tostring(properties.customDomains)', repositoryUrl: 'tostring(properties.repositoryUrl)',
  branch: 'tostring(properties.branch)', redundancy: "tostring(split(sku.name, '_')[1])",
  accessTier: 'tostring(properties.accessTier)', minTls: 'tostring(properties.minimumTlsVersion)',
  softDelete: 'tobool(properties.enableSoftDelete)', purgeProtection: 'tobool(properties.enablePurgeProtection)',
  maxSizeBytes: 'tolong(properties.maxSizeBytes)', freeTier: 'tobool(properties.enableFreeTier)',
  adminUser: 'tobool(properties.adminUserEnabled)',
  environmentId: 'tolower(tostring(properties.managedEnvironmentId))', serverFarmId: 'tolower(tostring(properties.serverFarmId))',
  registryServer: 'tostring(properties.configuration.registries[0].server)',
  identityIds: 'bag_keys(identity.userAssignedIdentities)',
}

/** The same named fields for `az resource show --query` (JMESPath; ids and types lowercased in rowToCard). */
export const SHOW_QUERY = `{${[
  'id:id', 'name:name', 'type:type', 'resourceGroup:resourceGroup', 'location:location', 'kind:kind', 'sku:sku.name',
  'runningStatus:properties.runningStatus', 'state:properties.state', 'provisioningState:properties.provisioningState',
  'latestRevisionName:properties.latestRevisionName', 'latestReadyRevisionName:properties.latestReadyRevisionName',
  'url:properties.configuration.ingress.fqdn', 'image:properties.template.containers[0].image',
  'cpu:properties.template.containers[0].resources.cpu', 'memory:properties.template.containers[0].resources.memory',
  'minReplicas:properties.template.scale.minReplicas', 'maxReplicas:properties.template.scale.maxReplicas',
  'revisionMode:properties.configuration.activeRevisionsMode', 'ingressExternal:properties.configuration.ingress.external',
  'runtime:properties.siteConfig.linuxFxVersion', 'alwaysOn:properties.siteConfig.alwaysOn', 'httpsOnly:properties.httpsOnly',
  'publicNetworkAccess:properties.publicNetworkAccess', 'repositoryUrl:properties.repositoryUrl', 'branch:properties.branch',
  'accessTier:properties.accessTier', 'minTls:properties.minimumTlsVersion', 'softDelete:properties.enableSoftDelete',
  'purgeProtection:properties.enablePurgeProtection', 'maxSizeBytes:properties.maxSizeBytes', 'adminUser:properties.adminUserEnabled',
  'environmentId:properties.managedEnvironmentId', 'serverFarmId:properties.serverFarmId',
  'registryServer:properties.configuration.registries[0].server',
].join(',')}}`

const SAFE_GROUP = /^[A-Za-z0-9._()-]+$/
const SAFE_ID = /^\/subscriptions\/[a-z0-9/._()-]+$/
const list = (xs: string[]): string => xs.map(x => `'${x}'`).join(', ')

export const buildQuery = (groups: string[], ids: AzId[]): string => {
  const g = groups.filter(x => SAFE_GROUP.test(x))
  const i = ids.filter(x => SAFE_ID.test(x))
  const where = [g.length > 0 ? `resourceGroup in~ (${list(g)})` : '', i.length > 0 ? `tolower(id) in (${list(i)})` : '']
    .filter(Boolean).join(' or ')
  const project = Object.entries(COLUMNS).map(([k, v]) => `${k} = ${v}`).join(', ')
  return `resources | where ${where || 'false'} | project ${project}`
}

export const nextPage = (answer: unknown): string | undefined => {
  const t = (answer as { $skipToken?: unknown } | null)?.$skipToken
  return typeof t === 'string' && t !== '' ? t : undefined
}

// ---------------------------------------------------------------- rows → cards

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const BUSY = /^(creating|updating|deleting|inprogress|accepted|provisioning|scaling|activating)$/i

const revisionFailed = (r: GraphRow): boolean =>
  str(r.latestRevisionName) !== null && str(r.latestReadyRevisionName) !== null && r.latestRevisionName !== r.latestReadyRevisionName

const statusOf = (r: GraphRow): AzStatus => {
  const run = str(r.runningStatus) ?? str(r.state)
  const prov = str(r.provisioningState)
  if (prov !== null && /^failed$/i.test(prov)) return 'failed'
  if (prov !== null && BUSY.test(prov)) return 'busy'
  if (revisionFailed(r)) return 'failed'
  if (run !== null && /stopped|disabled/i.test(run)) return 'stopped'
  if (run !== null && /running|ready|online|active/i.test(run)) return 'ok'
  return prov !== null && /^succeeded$/i.test(prov) ? 'ok' : 'unknown'
}

/** Where each fact comes from in a row. */
const FACT_SOURCE: Partial<Record<AzFactKey, (r: GraphRow) => unknown>> = {
  sku: r => r.sku, kind: r => r.kind, url: r => r.url, runtime: r => r.runtime, alwaysOn: r => r.alwaysOn,
  httpsOnly: r => r.httpsOnly, publicAccess: r => r.publicNetworkAccess, customDomains: r => r.customDomains,
  revisionMode: r => r.revisionMode, traffic: r => r.traffic, latestRevision: r => r.latestRevisionName,
  latestRevisionReady: r => (str(r.latestRevisionName) !== null && str(r.latestReadyRevisionName) !== null ? !revisionFailed(r) : null),
  ingress: r => (r.ingressExternal === null || r.ingressExternal === undefined ? null : r.ingressExternal ? 'external' : 'internal'),
  image: r => r.image, cpu: r => r.cpu, memoryGi: r => (str(r.memory) === null ? null : parseFloat(r.memory as string)),
  minReplicas: r => r.minReplicas, maxReplicas: r => r.maxReplicas, repositoryUrl: r => r.repositoryUrl, branch: r => r.branch,
  redundancy: r => r.redundancy, accessTier: r => r.accessTier, minTls: r => r.minTls, softDelete: r => r.softDelete,
  purgeProtection: r => r.purgeProtection, maxSizeBytes: r => r.maxSizeBytes, freeTier: r => r.freeTier, adminUser: r => r.adminUser,
}

const factsOf = (r: GraphRow, type: string): AzFacts => {
  const facts: AzFacts = {}
  for (const key of FACTS_BY_TYPE[type] ?? []) {
    const v = cleanValue(FACT_SOURCE[key]?.(r))
    if (v !== undefined) facts[key] = v
  }
  return facts
}

const warningsOf = (r: GraphRow, type: string, status: AzStatus): AzWarning[] => {
  const w: AzWarning[] = []
  if (revisionFailed(r)) w.push('revision-failed')
  if (status === 'stopped' && (type === 'microsoft.app/containerapps' || type === 'microsoft.web/sites')) w.push('app-stopped')
  if (type === 'microsoft.containerregistry/registries' && r.adminUser === true) w.push('registry-admin')
  if (type === 'microsoft.keyvault/vaults' && (r.softDelete === false || r.purgeProtection === false)) w.push('kv-protection-off')
  return w
}

const usesOf = (r: GraphRow): AzId[] =>
  [str(r.environmentId), str(r.serverFarmId), ...(Array.isArray(r.identityIds) ? r.identityIds : [])]
    .filter((x): x is string => typeof x === 'string' && x.startsWith('/subscriptions/'))
    .map(x => x.toLowerCase())

export const rowToCard = (r: GraphRow, now: number, via: AzCard['via']): AzCard => {
  const type = String(r.type).toLowerCase()
  const status = statusOf(r)
  const group = String(r.resourceGroup)
  return {
    id: String(r.id).toLowerCase(), name: String(r.name), type, group, location: String(r.location ?? ''),
    status, via, facts: factsOf(r, type), uses: usesOf(r), warnings: warningsOf(r, type, status),
    autoCreated: AUTO_CREATED_TYPES.includes(type) || AUTO_CREATED_GROUPS.some(g => g.test(group.toLowerCase())),
    stateAt: now,
  }
}

/** A registry used by name (its login server) becomes a `uses` id when that registry is among the cards. */
const linkRegistries = (cards: Record<AzId, AzCard>, rows: GraphRow[]): void => {
  const byServer = new Map(Object.values(cards).filter(c => typeof c.facts.url === 'string' && c.type.endsWith('/registries'))
    .map(c => [String(c.facts.url).toLowerCase(), c.id]))
  for (const r of rows) {
    const reg = byServer.get(String(r.registryServer ?? '').toLowerCase())
    const card = cards[String(r.id).toLowerCase()]
    if (reg !== undefined && card !== undefined && !card.uses.includes(reg)) card.uses.push(reg)
  }
}

type Scope = Pick<AzRules, 'groups' | 'includes'>
const inScope = (card: AzCard, scope: Scope): boolean => groupIdOf(card.id) in scope.groups || card.id in scope.includes

/** New cards, plus the previous ones still in scope that Azure no longer lists, kept with `goneAt`. */
export const markGone = (prev: Record<AzId, AzCard>, next: Record<AzId, AzCard>, now: number, scope: Scope): Record<AzId, AzCard> => {
  const out = { ...next }
  for (const [id, card] of Object.entries(prev)) {
    if (!(id in out) && inScope(card, scope)) out[id] = { ...card, goneAt: card.goneAt ?? now }
  }
  return out
}

const viaOf = (id: AzId, scope: Scope): AzCard['via'] => (groupIdOf(id) in scope.groups ? 'group' : 'include')

// ---------------------------------------------------------------- reads

async function graphPage($: EngineInterface, bodyPath: string, query: string, subId: string, skipToken?: string): Promise<AzRun> {
  const options = skipToken === undefined ? { $top: 1000 } : { $top: 1000, $skipToken: skipToken }
  await $.fs.write(bodyPath, JSON.stringify({ subscriptions: [subId], query, options }))
  return runAz($, ['rest', '--method', 'post', '--url', GRAPH_URL, '--body', `@${bodyPath}`])
}

/** Runs one Resource Graph query over every page. */
export async function graphRows($: EngineInterface, query: string, subId: string, maxPages = 20):
  Promise<{ ok: true; rows: GraphRow[] } | Extract<AzRun, { ok: false }>> {
  const bodyPath = `${await dataDir($)}/graph-query.json`
  const rows: GraphRow[] = []
  let token: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const r = await graphPage($, bodyPath, query, subId, token)
    if (!r.ok) return r
    const data = (r.json as { data?: unknown }).data
    if (Array.isArray(data)) rows.push(...(data as GraphRow[]))
    token = nextPage(r.json)
    if (token === undefined) break
  }
  return { ok: true, rows }
}

const groupName = (g: string): string => g.slice(g.lastIndexOf('/') + 1)

export async function readProject($: EngineInterface, rules: Scope, subId: string):
  Promise<{ ok: true; cards: Record<AzId, AzCard> } | Extract<AzRun, { ok: false }>> {
  const r = await graphRows($, buildQuery(Object.keys(rules.groups).map(groupName), Object.keys(rules.includes)), subId)
  if (!r.ok) return r
  const now = await $.clock.now()
  const cards: Record<AzId, AzCard> = {}
  for (const row of r.rows) {
    const card = rowToCard(row, now, 'group')
    cards[card.id] = { ...card, via: viaOf(card.id, rules) }
  }
  linkRegistries(cards, r.rows)
  return { ok: true, cards }
}

export type OneRead = { ok: true; card: AzCard } | { ok: true; gone: true } | Extract<AzRun, { ok: false }>

export async function readOne($: EngineInterface, id: AzId, scope: Scope): Promise<OneRead> {
  const r = await runAz($, ['resource', 'show', '--ids', id, '--query', SHOW_QUERY])
  if (!r.ok) return /ResourceNotFound|was not found/i.test(r.error.message) ? { ok: true, gone: true } : r
  const card = rowToCard(r.json as GraphRow, await $.clock.now(), 'group')
  return { ok: true, card: { ...card, via: viaOf(card.id, scope) } }
}
