/*
 * contract.ts — the runtime half of the az-mod contract, shared by Raccolta (collect/)
 * and Pannello (pane/): state atoms, constants (fact keys per type, Azure auto-created
 * types, write verbs), the AzActions interface the pane calls, and small pure helpers.
 * Owned by the main session; the two parts import it and never edit it.
 * (Revised 25/11: the AzActions interface became the button-key contract below.)
 */
import { atom } from 'claude-code'

import type { AzActivity, AzCard, AzEvent, AzFactKey, AzGroupId, AzId, AzRules } from '../types'

export const PLUGIN = 'az-mod'
export const PANE = 'az-mod'
export const PANE_TITLE = 'Azure'

// State: Raccolta writes every key but `ui`; the pane writes only `ui`.
export const projectAtom = atom({ plugin: 'az-mod', key: 'project' } as const, null, { shape: 'project-1' })
export const rulesAtom = atom({ plugin: 'az-mod', key: 'rules' } as const, null, { shape: 'rules-1' })
export const cacheAtom = atom({ plugin: 'az-mod', key: 'cache' } as const, null, { shape: 'cache-1' })
export const eventsAtom = atom({ plugin: 'az-mod', key: 'events' } as const, [], { shape: 'events-1' })
export const suggestionsAtom = atom({ plugin: 'az-mod', key: 'suggestions' } as const, [], { shape: 'suggestions-1' })
export const autoAddedAtom = atom({ plugin: 'az-mod', key: 'autoAdded' } as const, null, { shape: 'autoAdded-1' })
export const busyAtom = atom({ plugin: 'az-mod', key: 'busy' } as const,
  { scan: false, update: false, cost: false, ids: [] }, { shape: 'busy-1' })
export const healthAtom = atom({ plugin: 'az-mod', key: 'health' } as const,
  { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'ok' }, { shape: 'health-1' })
export const foundAtom = atom({ plugin: 'az-mod', key: 'found' } as const, [], { shape: 'found-1' })
export const uiAtom = atom({ plugin: 'az-mod', key: 'ui' } as const,
  { isVisible: false, lastInputAt: 0, openCard: null, showAuto: false, showHidden: false, isAdding: false }, { shape: 'ui-1' })

/** Which facts each resource type shows (keys of lowercase ARM types). Raccolta reads them, the pane labels them. */
export const FACTS_BY_TYPE: Record<string, AzFactKey[]> = {
  'microsoft.app/containerapps': ['url', 'image', 'cpu', 'memoryGi', 'minReplicas', 'maxReplicas', 'revisionMode', 'ingress', 'traffic', 'latestRevision', 'latestRevisionReady'],
  'microsoft.web/sites': ['url', 'runtime', 'sku', 'alwaysOn', 'httpsOnly', 'publicAccess', 'customDomains'],
  'microsoft.web/staticsites': ['url', 'sku', 'repositoryUrl', 'branch', 'customDomains'],
  'microsoft.storage/storageaccounts': ['sku', 'kind', 'redundancy', 'accessTier', 'publicAccess', 'minTls'],
  'microsoft.keyvault/vaults': ['sku', 'softDelete', 'purgeProtection', 'publicAccess'],
  'microsoft.sql/servers/databases': ['sku', 'maxSizeBytes', 'freeTier'],
  'microsoft.documentdb/databaseaccounts': ['kind', 'freeTier'],
  'microsoft.cognitiveservices/accounts': ['kind', 'sku', 'publicAccess'],
  'microsoft.containerregistry/registries': ['sku', 'adminUser', 'publicAccess', 'url'],
}

/** Resource types Azure creates by itself: kept by the scanner, hidden in the view. */
export const AUTO_CREATED_TYPES: string[] = [
  'microsoft.alertsmanagement/smartdetectoralertrules',
  'microsoft.insights/actiongroups',
  'microsoft.network/networkwatchers',
  'microsoft.web/certificates',
  'microsoft.app/managedenvironments/managedcertificates',
]
export const AUTO_CREATED_GROUPS: RegExp[] = [/^networkwatcherrg$/, /^defaultresourcegroup-/]

/** az verbs that change Azure: after one, the hook refreshes the resource or proposes it. */
export const WRITE_VERBS: string[] = [
  'create', 'update', 'set', 'delete', 'deploy', 'up', 'start', 'stop', 'restart', 'assign', 'add', 'remove', 'import',
]

/*
 * How the pane talks to Raccolta: the button keys ARE the contract. The engine refuses to
 * pass $ to a method it cannot follow (e.g. actions.update($)), so the pane never calls
 * Raccolta. The pane draws Buttons with these keys (their onPress only updates the `ui`
 * atom); Raccolta hooks `ui.press` / `ui.input` on its own pane and acts on `parseKey`.
 * Search: the pane draws an Input keyed SEARCH_INPUT; Raccolta answers in `foundAtom`.
 */
export type PaneAction =
  | 'update' | 'scan' | 'refresh-cost' | 'reset-rules' | 'undo-auto'
  | 'open' | 'refresh' | 'add' | 'exclude' | 'restore' | 'accept' | 'dismiss' | 'add-group' | 'remove-group'
/** Keys with no argument: the key is the action. */
const PLAIN_ACTIONS: PaneAction[] = ['update', 'scan', 'refresh-cost', 'reset-rules', 'undo-auto']
/** Keys `<action>-<arg>`: open takes a resource name, refresh/add/exclude/restore an AzId, accept/dismiss a suggestion id, add-group/remove-group an AzGroupId. Longest prefix first. */
const ARG_ACTIONS: PaneAction[] = ['remove-group', 'add-group', 'open', 'refresh', 'add', 'exclude', 'restore', 'accept', 'dismiss']
export const SEARCH_INPUT = 'add-search'

export const keyFor = (action: PaneAction, arg?: string): string => (arg === undefined ? action : `${action}-${arg}`)

/** The Raccolta action a pressed key asks for; null for the pane's own keys (toggles) or unknown ones. */
export const parseKey = (key: string): { action: PaneAction; arg?: string } | null => {
  if (PLAIN_ACTIONS.includes(key as PaneAction)) return { action: key as PaneAction }
  const action = ARG_ACTIONS.find(a => key.startsWith(`${a}-`) && key.length > a.length + 1)
  return action ? { action, arg: key.slice(action.length + 1) } : null
}

/** Lowercase; every run of non [a-z0-9] becomes one '-'; no '-' at the ends. */
export const normalizeName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const expectedGroup = (key: string): string => `rg-${key}`

/** '/subscriptions/x/resourceGroups/RG/providers/…' → '/subscriptions/x/resourcegroups/rg'. */
export const groupIdOf = (id: AzId): AzGroupId => {
  const m = /^(\/subscriptions\/[^/]+\/resourcegroups\/[^/]+)/i.exec(id)
  return (m?.[1] ?? id).toLowerCase()
}

export const isHidden = (card: AzCard, rules: AzRules, showAuto: boolean): boolean =>
  card.id in rules.excludes || (card.autoCreated && !showAuto)

/** An activity is "by Claude" when a hook event touched the same resource within windowMs before it. */
export const isByClaude = (a: AzActivity, events: AzEvent[], windowMs = 120_000): boolean =>
  events.some(e => (e.ids ?? []).includes(a.resourceId) && e.at <= a.at && a.at - e.at <= windowMs)
