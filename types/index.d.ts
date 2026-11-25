/*
 * types/index.d.ts — the data contract of az-mod shared by Raccolta (hooks/collect) and
 * Pannello (hooks/pane): persisted rules and cache shapes, in-memory hook events and
 * suggestions, and the $.state values the pane reads. Owned by the main session; the two
 * parts never edit it. Rules shapes are one-way (changing them means migrating files).
 */

export type Ms = number
/** Lowercase full ARM id: /subscriptions/<guid>/resourcegroups/<rg>/providers/<ns>/<type>/<name>[/<child>/<name>]. */
export type AzId = string
/** Lowercase /subscriptions/<guid>/resourcegroups/<rg>. */
export type AzGroupId = string
export type Mark = { at: Ms }

/** CLAUDE_PLUGIN_DATA/projects/<key>.rules.json — one-way: migrate on change. */
export type AzRules = {
  schemaVersion: 1
  project: { key: string; mainRoot: string; remote: string | null }
  groups: Record<AzGroupId, Mark>
  includes: Record<AzId, Mark>
  excludes: Record<AzId, Mark>
  dismissed: Record<string, Mark>
  updatedAt: Ms
}

export type AzStatus = 'ok' | 'stopped' | 'busy' | 'failed' | 'unknown'
export type AzReadKind = 'state' | 'metrics' | 'cost' | 'activity'
export type AzWarning = 'app-stopped' | 'revision-failed' | 'build-not-ready' | 'public-access'
  | 'registry-admin' | 'kv-protection-off' | 'cost-spike'
export type AzFactKey = 'sku' | 'kind' | 'url' | 'runtime' | 'alwaysOn' | 'httpsOnly' | 'publicAccess'
  | 'customDomains' | 'revisionMode' | 'ingress' | 'traffic' | 'latestRevision' | 'latestRevisionReady'
  | 'image' | 'cpu' | 'memoryGi' | 'minReplicas' | 'maxReplicas' | 'repositoryUrl' | 'branch'
  | 'redundancy' | 'accessTier' | 'minTls' | 'softDelete' | 'purgeProtection' | 'maxSizeBytes'
  | 'freeTier' | 'adminUser' | 'models' | 'lastBuildStatus' | 'lastBuildAt'
/** Strings ≤ 256 chars, lists joined with ", ", every value through the secret filter. */
export type AzFacts = Partial<Record<AzFactKey, string | number | boolean>>
export type AzCost = { month: number; prevMonth: number | null }
export type AzCard = {
  id: AzId
  name: string
  type: string
  group: string
  location: string
  status: AzStatus
  autoCreated: boolean
  via: 'group' | 'include'
  facts: AzFacts
  uses: AzId[]
  warnings: AzWarning[]
  cost?: AzCost
  stateAt: Ms
  detailAt?: Ms
  goneAt?: Ms
}
export type AzActivity = { at: Ms; op: string; status: string; resourceId: AzId }
export type AzError = {
  at: Ms
  code: 'login' | 'throttled' | 'network' | 'forbidden' | 'other'
  message: string
  retryAt?: Ms
}
/** CLAUDE_PLUGIN_DATA/projects/<key>.cache.json — discardable. */
export type AzCache = {
  schemaVersion: 1
  projectKey: string
  subscription: { id: string; name: string }
  stateAt?: Ms
  metricsAt?: Ms
  costAt?: Ms
  activityAt?: Ms
  lease?: { by: string; until: Ms }
  groups: Record<AzGroupId, { name: string; goneAt?: Ms }>
  resources: Record<AzId, AzCard>
  cost?: { currency: string; month: number; prevMonth: number | null }
  activity: AzActivity[]
  errors: Partial<Record<AzReadKind, AzError>>
}

/** In memory only: what the hook understood of one az command. Never its text. */
export type AzEvent = {
  at: Ms
  sessionId: string
  cmdGroup: string
  verb: string
  isWrite: boolean
  resourceType?: string
  name?: string
  group?: string
  ids?: AzId[]
  exit: number
}
export type AzSuggestion = {
  id: string
  kind: 'resource' | 'group'
  origin: 'scan' | 'hook' | 'related'
  reason: 'same-repo' | 'similar-group' | 'image-name' | 'named-in-files' | 'used-by' | 'claude-wrote'
  reasonArg?: string
  name: string
  type?: string
  count?: number
}
export type AzProject = { key: string; mainRoot: string; remote: string | null; conflict?: 'other-repo' }
export type AzBusy = { scan: boolean; update: boolean; cost: boolean; ids: AzId[] }
export type AzHealth = {
  az: 'ok' | 'login' | 'missing'
  isLeaseHolder: boolean
  nextAutoAt: Ms | null
  rulesMode: 'ok' | 'read-only' | 'broken'
  /** The last failed read of Azure, cleared by a good one: shown when there is no photo yet. */
  error?: AzError
}
/** `closed`: rows the user closed this session (a failed row is open unless listed here). */
export type AzUi = { lastInputAt: Ms; openCard: AzId | null; closed: AzId[]; showAuto: boolean; showHidden: boolean; isAdding: boolean }
export type AzAutoAdded = { groupId: AzGroupId; count: number } | null

declare module 'claude-code' {
  interface PluginState {
    'az-mod': {
      project: Shaped<AzProject | null>
      rules: Shaped<AzRules | null>
      cache: Shaped<AzCache | null>
      events: Shaped<AzEvent[]>
      suggestions: Shaped<AzSuggestion[]>
      /** Results of the «+ Aggiungi» search, written by Raccolta on ui.input of the search Input. */
      found: Shaped<AzSuggestion[]>
      autoAdded: Shaped<AzAutoAdded>
      busy: Shaped<AzBusy>
      health: Shaped<AzHealth>
      ui: Shaped<AzUi>
    }
  }
}
