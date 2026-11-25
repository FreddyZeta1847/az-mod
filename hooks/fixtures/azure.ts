/*
 * fixtures/azure.ts — invented Azure answers for the az-mod tests (the repository is
 * public: no real subscription, group or resource name ever appears here).
 * - GraphRow: the exact columns Raccolta's Resource Graph query projects (and the
 *   `resource show --query` of one resource returns). Raccolta must use these names.
 * - DEMO_SUITE_ROWS: 13 resources of project "demo-suite", mirroring a real mix
 *   (3 Container Apps, one with a failed latest revision; each Container App row also
 *   carries an `env` column with a secret, as if a careless query leaked it: it must
 *   never reach a card, a file or the state).
 * - RESOURCE_LIST: what `az resource list` answers for the whole subscription.
 * - COST_DEMO_SUITE: the Cost Management answer (this month and last month by resource).
 * - ACTIVITY_DEMO_SUITE: the activity log of the week, real changes among noise.
 * - azAnswer(argv): a process.run answer for every az call the mod is allowed to make.
 * Owned by the main session; the children read it and never edit it.
 */
import type { ProcessRunResult } from 'claude-code'

export const SUB = { id: '00000000-0000-0000-0000-000000000000', name: 'Demo' }
export const SECRET_NAME = 'DB_PASSWORD'
export const SECRET_VALUE = 's3cr3t-value-never-stored'

const P = `/subscriptions/${SUB.id}/resourcegroups`
export const rid = (group: string, provider: string, name: string): string =>
  `${P}/${group}/providers/${provider}/${name}`.toLowerCase()
export const gid = (group: string): string => `${P}/${group}`.toLowerCase()

/** One Resource Graph row, as Raccolta's query projects it. Absent columns are null. */
export type GraphRow = {
  id: string; name: string; type: string; resourceGroup: string; location: string
  kind: string | null; sku: string | null
  runningStatus: string | null; state: string | null; provisioningState: string | null
  latestRevisionName: string | null; latestReadyRevisionName: string | null
  url: string | null; image: string | null; cpu: number | null; memory: string | null
  minReplicas: number | null; maxReplicas: number | null; revisionMode: string | null
  ingressExternal: boolean | null; traffic: string | null
  runtime: string | null; alwaysOn: boolean | null; httpsOnly: boolean | null
  publicNetworkAccess: string | null; customDomains: string | null
  repositoryUrl: string | null; branch: string | null
  redundancy: string | null; accessTier: string | null; minTls: string | null
  softDelete: boolean | null; purgeProtection: boolean | null
  maxSizeBytes: number | null; freeTier: boolean | null; adminUser: boolean | null
  environmentId: string | null; serverFarmId: string | null; registryServer: string | null
  identityIds: string[] | null
}

const EMPTY: Omit<GraphRow, 'id' | 'name' | 'type' | 'resourceGroup' | 'location'> = {
  kind: null, sku: null, runningStatus: null, state: null, provisioningState: 'Succeeded',
  latestRevisionName: null, latestReadyRevisionName: null, url: null, image: null, cpu: null, memory: null,
  minReplicas: null, maxReplicas: null, revisionMode: null, ingressExternal: null, traffic: null,
  runtime: null, alwaysOn: null, httpsOnly: null, publicNetworkAccess: null, customDomains: null,
  repositoryUrl: null, branch: null, redundancy: null, accessTier: null, minTls: null,
  softDelete: null, purgeProtection: null, maxSizeBytes: null, freeTier: null, adminUser: null,
  environmentId: null, serverFarmId: null, registryServer: null, identityIds: null,
}

const G = 'rg-demo-suite'
const ENV_ID = rid(G, 'microsoft.app/managedenvironments', 'cae-demo-suite')
const IDENTITY_ID = rid(G, 'microsoft.managedidentity/userassignedidentities', 'id-demo-suite-apps')
const row = (provider: string, name: string, over: Partial<GraphRow>): GraphRow => ({
  ...EMPTY, id: rid(G, provider, name), name, type: provider, resourceGroup: G, location: 'westeurope', ...over,
})
const app = (name: string, rev: number, ready: number, over: Partial<GraphRow> = {}): GraphRow & { env: unknown } => ({
  ...row('microsoft.app/containerapps', name, {
    runningStatus: 'Running', latestRevisionName: `${name}--000000${rev}`, latestReadyRevisionName: `${name}--000000${ready}`,
    url: `${name}.demo-env.westeurope.azurecontainerapps.io`, image: `acrdemosuite.azurecr.io/${name}:abc1234`,
    cpu: 1, memory: '2Gi', minReplicas: 1, maxReplicas: 1, revisionMode: 'Single', ingressExternal: true,
    traffic: `100% ${name}--000000${ready}`, environmentId: ENV_ID, registryServer: 'acrdemosuite.azurecr.io',
    identityIds: [IDENTITY_ID], ...over,
  }),
  env: [{ name: SECRET_NAME, value: SECRET_VALUE }],
})

export const DEMO_SUITE_ROWS: GraphRow[] = [
  app('app-control', 2, 2),
  app('app-flow', 7, 6, { cpu: 2, memory: '4Gi' }),
  app('app-match', 3, 3, { minReplicas: 0, cpu: 0.5, memory: '1Gi', ingressExternal: false }),
  row('microsoft.app/managedenvironments', 'cae-demo-suite', { provisioningState: 'Succeeded' }),
  row('microsoft.containerregistry/registries', 'acrdemosuite', { sku: 'Basic', adminUser: true, publicNetworkAccess: 'Enabled', url: 'acrdemosuite.azurecr.io' }),
  row('microsoft.cognitiveservices/accounts', 'demo-suite-foundry', { kind: 'AIServices', sku: 'S0', publicNetworkAccess: 'Enabled' }),
  row('microsoft.cognitiveservices/accounts/projects', 'demo-suite-foundry/DemoSuite', {}),
  row('microsoft.search/searchservices', 'demo-suite-search', { sku: 'free' }),
  row('microsoft.bing/accounts', 'bing-demo-suite', { kind: 'Bing.GroundingCustomSearch', sku: 'G2', location: 'global' }),
  row('microsoft.keyvault/vaults', 'kv-demo-suite', { sku: 'standard', softDelete: true, purgeProtection: true, publicNetworkAccess: 'Enabled' }),
  row('microsoft.storage/storageaccounts', 'stdemosuite', { kind: 'StorageV2', sku: 'Standard_LRS', redundancy: 'LRS', accessTier: 'Hot', minTls: 'TLS1_2', publicNetworkAccess: 'Enabled' }),
  row('microsoft.managedidentity/userassignedidentities', 'id-demo-suite-apps', {}),
  row('microsoft.operationalinsights/workspaces', 'log-demo-suite', { sku: 'PerGB2018' }),
]

/** `az rest` Resource Graph answer: one page with all demo-suite rows. */
export const GRAPH_DEMO_SUITE = { totalRecords: DEMO_SUITE_ROWS.length, count: DEMO_SUITE_ROWS.length, data: DEMO_SUITE_ROWS }

export type ListRow = { id: string; name: string; type: string; resourceGroup: string }
const list = (group: string, provider: string, name: string): ListRow =>
  ({ id: rid(group, provider, name), name, type: provider, resourceGroup: group })

/** `az resource list` for the whole subscription: demo-suite plus other projects and Azure noise. */
export const RESOURCE_LIST: ListRow[] = [
  ...DEMO_SUITE_ROWS.map(r => ({ id: r.id, name: r.name, type: r.type, resourceGroup: r.resourceGroup })),
  list('rg_Bottega-Web', 'microsoft.web/staticsites', 'bottega-web-app'),
  list('rg-tasklist', 'microsoft.web/sites', 'tasklist'),
  list('rg-tasklist', 'microsoft.web/serverfarms', 'plan-tasklist'),
  list('rg-tasklist', 'microsoft.storage/storageaccounts', 'sttasklist'),
  list('rg-demo-suite-old', 'microsoft.web/sites', 'demo-suite-legacy'),
  list('Default-Web-NorthEurope', 'microsoft.web/sites', 'oldshop'),
  list('Default-Web-NorthEurope', 'microsoft.web/serverfarms', 'oldshopplan'),
  list('Default-Web-NorthEurope', 'microsoft.insights/components', 'oldshop-insights'),
  list('Default-Web-NorthEurope', 'microsoft.alertsmanagement/smartdetectoralertrules', 'failure anomalies - oldshop'),
  list('NetworkWatcherRG', 'microsoft.network/networkwatchers', 'networkwatcher_westeurope'),
  list('rg-other', 'microsoft.app/containerapps', 'other-api'),
]

/**
 * Cost Management answer for demo-suite (the test clock is in November 2025): this month for
 * every Container App and the storage, last month for two of them; app-match costs more than
 * 1.5 × last month (a cost spike). Everything else is free (no row).
 */
const COST_ROW = (cost: number, month: '2025-11' | '2025-10', name: string): unknown[] =>
  [cost, `${month}-01T00:00:00`, (DEMO_SUITE_ROWS.find(r => r.name === name) as GraphRow).id, 'EUR']
export const COST_DEMO_SUITE = {
  properties: {
    columns: ['Cost', 'BillingMonth', 'ResourceId', 'Currency'].map(name => ({ name, type: 'String' })),
    rows: [
      COST_ROW(30, '2025-11', 'app-control'), COST_ROW(28, '2025-10', 'app-control'),
      COST_ROW(12, '2025-11', 'app-flow'),
      COST_ROW(40, '2025-11', 'app-match'), COST_ROW(20, '2025-10', 'app-match'),
      COST_ROW(1.5, '2025-11', 'stdemosuite'),
    ],
    nextLink: null,
  },
}

/**
 * `az monitor activity-log list` answer for demo-suite (the test clock is 2025-11-24 16:00 UTC):
 * three real changes (one in two events, Started then Succeeded) among automatic noise.
 * After the filter: app-match restarted, app-control written, the storage deleted-and-failed.
 */
const ACT = (op: string, status: string, at: string, name: string, cid: string): unknown => ({
  op, status, at: `2025-11-24T${at}:00Z`, id: (DEMO_SUITE_ROWS.find(r => r.name === name) as GraphRow).id, cid,
})
export const ACTIVITY_DEMO_SUITE = [
  ACT('Microsoft.App/containerApps/revisions/restart/action', 'Succeeded', '15:58', 'app-match', 'a1'),
  ACT('Microsoft.App/containerApps/getAuthToken/action', 'Succeeded', '15:50', 'app-control', 'n1'),
  ACT('Microsoft.App/containerApps/write', 'Succeeded', '15:40', 'app-control', 'a2'),
  ACT('Microsoft.App/containerApps/write', 'Started', '15:39', 'app-control', 'a2'),
  ACT('Microsoft.Storage/storageAccounts/listKeys/action', 'Succeeded', '15:30', 'stdemosuite', 'n2'),
  ACT('Microsoft.Storage/storageAccounts/delete', 'Failed', '12:00', 'stdemosuite', 'a3'),
  ACT('Microsoft.Advisor/recommendations/available/action', 'Active', '09:00', 'kv-demo-suite', 'n3'),
]

/** Static site of the bottega-web project: its repository matches that project's git remote. */
export const BOTTEGA_REMOTE = 'https://github.com/example/bottega-web'

const ok = (value: unknown): ProcessRunResult =>
  ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const fail = (stderr: string): ProcessRunResult =>
  ({ exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** A process.run answer for every az call az-mod is allowed to make, over the demo data. */
export const azAnswer = (argv: readonly string[]): ProcessRunResult => {
  const [cmd, a, b] = argv
  if (cmd !== 'az') return fail(`not az: ${cmd}`)
  if (a === 'version') return ok({ 'azure-cli': '2.81.0' })
  if (a === 'account' && b === 'show') return ok({ id: SUB.id, name: SUB.name })
  // The query body travels in a file (`--body @<path>`): the test world checks it names the group.
  if (a === 'rest' && argv.some(x => x.includes('Microsoft.ResourceGraph/resources'))) return ok(GRAPH_DEMO_SUITE)
  if (a === 'rest' && argv.some(x => x.includes('Microsoft.CostManagement/query'))) return ok(COST_DEMO_SUITE)
  if (a === 'monitor' && b === 'activity-log') return ok(ACTIVITY_DEMO_SUITE)
  if (a === 'resource' && b === 'list') return ok(RESOURCE_LIST)
  if (a === 'resource' && b === 'show') {
    const id = argv[argv.indexOf('--ids') + 1]?.toLowerCase()
    const found = DEMO_SUITE_ROWS.find(r => r.id === id)
    return found ? ok(found) : fail(`(ResourceNotFound) The Resource '${id}' was not found.`)
  }
  return fail(`unexpected az call: ${argv.slice(1, 3).join(' ')}`)
}
