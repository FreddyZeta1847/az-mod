/*
 * scan.ts — the scanner: from the subscription's resource list it finds the project's
 * *sure* group (its normalized name is exactly rg-<key>, and no other group normalizes to
 * the same name) and the *probable* resources and groups, each with its reason: a group
 * with a similar name, a static site built from the same repository, a container image
 * named after the project, a resource named in the project's files. Anything already
 * claimed, excluded or dismissed is never proposed again.
 * scanCandidates is pure; projectFiles($, root) reads README.md and the workflow names.
 */
import type { EngineInterface } from 'claude-code'

import { stripUserinfo } from './project'
import { readText } from './store'
import { expectedGroup, groupIdOf, normalizeName } from '../contract'
import type { ListRow } from '../fixtures/azure'
import type { AzGroupId, AzProject, AzRules, AzSuggestion } from '../../types'

/** A resource list row, with the two named fields one Resource Graph query adds when it can. */
export type ScanRow = ListRow & { repositoryUrl?: string | null; image?: string | null }
export type ProjectFiles = { names: string[]; text: string }

const FILES_LIMIT = 64 * 1024
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text: string, name: string): boolean =>
  name.length >= 3 && new RegExp(`(^|[^a-z0-9-])${escape(name.toLowerCase())}([^a-z0-9-]|$)`).test(text)

/** 'acr.azurecr.io/team/app-x:tag' → 'team/app-x'. */
const imageRepo = (image: string): string => image.replace(/^[^/]*\//, '').replace(/[:@].*$/, '').toLowerCase()

const groupsOf = (list: ScanRow[]): Map<AzGroupId, { name: string; count: number }> => {
  const out = new Map<AzGroupId, { name: string; count: number }>()
  for (const r of list) {
    const g = groupIdOf(r.id)
    out.set(g, { name: r.resourceGroup, count: (out.get(g)?.count ?? 0) + 1 })
  }
  return out
}

const isKnown = (id: string, rules: AzRules | null): boolean =>
  rules !== null && (id in rules.groups || id in rules.includes || id in rules.excludes || id in rules.dismissed)

const resource = (r: ScanRow, reason: AzSuggestion['reason'], reasonArg?: string): AzSuggestion => ({
  id: r.id.toLowerCase(), kind: 'resource', origin: 'scan', reason, name: r.name, type: r.type.toLowerCase(),
  ...(reasonArg === undefined ? {} : { reasonArg }),
})

export const scanCandidates = (p: AzProject, key: string, list: ScanRow[], files: ProjectFiles, rules: AzRules | null):
  { sure: AzGroupId | null; probable: AzSuggestion[] } => {
  const groups = groupsOf(list)
  const exact = [...groups].filter(([, g]) => normalizeName(g.name) === expectedGroup(key)).map(([id]) => id)
  const sure = exact.length === 1 ? exact[0] as AzGroupId : null
  const claimed = (id: string): boolean => groupIdOf(id) === sure || (rules !== null && groupIdOf(id) in rules.groups)
  const out = new Map<string, AzSuggestion>()
  const offer = (s: AzSuggestion): void => {
    if (!out.has(s.id) && s.id !== sure && !isKnown(s.id, rules) && !(s.kind === 'resource' && claimed(s.id))) out.set(s.id, s)
  }
  for (const [id, g] of groups) {
    if (id !== sure && normalizeName(g.name).includes(key)) {
      offer({ id, kind: 'group', origin: 'scan', reason: 'similar-group', name: g.name, count: g.count })
    }
  }
  const remote = p.remote === null ? null : stripUserinfo(p.remote).toLowerCase()
  const text = `${files.text}\n${files.names.join('\n')}`.toLowerCase()
  for (const r of list) {
    if (remote !== null && typeof r.repositoryUrl === 'string' && stripUserinfo(r.repositoryUrl).toLowerCase() === remote) {
      offer(resource(r, 'same-repo', p.remote ?? undefined))
    }
    if (typeof r.image === 'string' && imageRepo(r.image).includes(key)) offer(resource(r, 'image-name', imageRepo(r.image)))
    if (mentions(text, r.name)) offer(resource(r, 'named-in-files'))
  }
  return { sure, probable: [...out.values()] }
}

export async function projectFiles($: EngineInterface, root: string): Promise<ProjectFiles> {
  const text = ((await readText($, `${root}/README.md`)) ?? '').slice(0, FILES_LIMIT)
  let names: string[] = []
  try {
    names = (await $.fs.list(`${root}/.github/workflows`)).map(e => e.name)
  } catch { /* no workflows folder */ }
  return { names, text }
}
