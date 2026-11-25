/*
 * rules-ops.ts — the pure rule changes behind the pane's buttons (accept, include,
 * exclude, restore, add/remove group, dismiss — «Annulla» on the auto-added group is a
 * dismiss) and the ranking of the «+ Aggiungi» search. Each returns new rules with
 * updatedAt set; actions.ts saves them through saveRules.
 */
import { groupIdOf } from '../contract'
import type { ScanRow } from './scan'
import type { AzGroupId, AzId, AzRules, AzSuggestion } from '../../types'

type Part = 'groups' | 'includes' | 'excludes' | 'dismissed'

const edit = (rules: AzRules, now: number, add: Partial<Record<Part, string>>, drop: Partial<Record<Part, string[]>>): AzRules => {
  const next: AzRules = {
    ...rules, groups: { ...rules.groups }, includes: { ...rules.includes }, excludes: { ...rules.excludes },
    dismissed: { ...rules.dismissed }, updatedAt: now,
  }
  for (const [part, ids] of Object.entries(drop) as Array<[Part, string[]]>) for (const id of ids) delete next[part][id]
  for (const [part, id] of Object.entries(add) as Array<[Part, string]>) next[part][id] = { at: now }
  return next
}

/** A group id has no '/providers/' part. */
export const isGroupId = (id: string): boolean => !id.includes('/providers/')

export const includeIn = (r: AzRules, id: AzId, now: number): AzRules =>
  edit(r, now, { includes: id }, { excludes: [id], dismissed: [id] })
export const excludeIn = (r: AzRules, id: AzId, now: number): AzRules => edit(r, now, { excludes: id }, {})
export const restoreIn = (r: AzRules, id: AzId, now: number): AzRules => edit(r, now, {}, { excludes: [id] })
export const addGroupTo = (r: AzRules, g: AzGroupId, now: number): AzRules => edit(r, now, { groups: g }, { dismissed: [g] })
export const removeGroupFrom = (r: AzRules, g: AzGroupId, now: number): AzRules => edit(r, now, {}, { groups: [g] })
/** «No» to a proposal; on a claimed group (the auto-added one) it also takes the group out. */
export const dismissIn = (r: AzRules, id: string, now: number): AzRules => edit(r, now, { dismissed: id }, { groups: [id] })

export const acceptInto = (r: AzRules, s: AzSuggestion, now: number): AzRules =>
  s.kind === 'group' || isGroupId(s.id) ? addGroupTo(r, s.id, now) : includeIn(r, s.id, now)

const SEARCH_LIMIT = 20

/** Resources and groups matching the text, not already in the project; touched by the hook first, then named after the key. */
export const rankSearch = (list: ScanRow[], text: string, ctx: { key: string; touched: string[]; rules: AzRules | null }): AzSuggestion[] => {
  const q = text.trim().toLowerCase()
  const r = ctx.rules
  const inProject = (id: string): boolean =>
    r !== null && (id in r.includes || groupIdOf(id) in r.groups || (isGroupId(id) && id in r.groups))
  const score = (s: AzSuggestion): number =>
    (ctx.touched.includes(s.name) ? 2 : 0) + (s.name.toLowerCase().includes(ctx.key) ? 1 : 0)
  const groups = new Map<string, AzSuggestion>()
  const resources: AzSuggestion[] = []
  for (const row of list) {
    const g = groupIdOf(row.id)
    const prev = groups.get(g)
    if (prev !== undefined) prev.count = (prev.count ?? 0) + 1
    else groups.set(g, { id: g, kind: 'group', origin: 'scan', reason: 'similar-group', name: row.resourceGroup, count: 1 })
    resources.push({ id: row.id.toLowerCase(), kind: 'resource', origin: 'scan', reason: ctx.touched.includes(row.name) ? 'claude-wrote' : 'similar-group',
      name: row.name, type: row.type.toLowerCase() })
  }
  return [...resources, ...groups.values()]
    .filter(s => !inProject(s.id) && (q === '' || s.name.toLowerCase().includes(q)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, SEARCH_LIMIT)
}
