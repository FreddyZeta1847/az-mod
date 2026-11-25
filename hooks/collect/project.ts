/*
 * project.ts — which project this session is in: the repository's main folder (also from
 * a worktree), its git remote without user or token, and the key that names the rules
 * file (the main folder's name through normalizeName, like the group rg-<key>).
 * Pure helpers (mainRootFrom, projectFrom, stripUserinfo) plus resolveProject($).
 */
import type { EngineInterface } from 'claude-code'

import { hash6 } from './store'
import { normalizeName } from '../contract'
import type { AzProject } from '../../types'

/** Last segment of a path written with / or \. */
export const basename = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

const dirname = (path: string): string => path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

/** The engine's main root first, else the folder holding git's common dir, else the session root. */
export const mainRootFrom = (x: { root: string; vcsMainRoot: string | null; commonDir: string | null }): string =>
  x.vcsMainRoot ?? (x.commonDir !== null ? dirname(x.commonDir) : x.root)

/** The key is the folder's normalized name; a name with no latin letter or digit gets `p-<hash6(mainRoot)>`. */
export const projectFrom = (mainRoot: string, remote: string | null): AzProject =>
  ({ key: normalizeName(basename(mainRoot)) || `p-${hash6(mainRoot)}`, mainRoot, remote })

/**
 * One spelling per repository: 'https://u:token@GitHub.com/x/y.git' → 'https://github.com/x/y';
 * ssh forms ('git@host:x/y', 'ssh://git@host/x/y') → 'https://host/x/y', so a clone over ssh
 * matches the https address Azure keeps.
 */
export const stripUserinfo = (url: string): string => {
  const trimmed = url.trim().replace(/\.git$/, '')
  const scp = /^[^@/:\s]+@([^:/\s]+):(?!\/)(.+)$/.exec(trimmed)
  if (scp !== null) return `https://${(scp[1] as string).toLowerCase()}/${scp[2] as string}`
  const ssh = /^ssh:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed)
  if (ssh !== null) return `https://${(ssh[1] as string).toLowerCase()}/${ssh[2] as string}`
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/]*@)?([^/]+)(.*)$/i.exec(trimmed)
  if (m === null) return trimmed
  const [, scheme = '', host = '', rest = ''] = m
  return `${scheme.toLowerCase()}${host.toLowerCase()}${rest}`
}

async function gitLine($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
    const line = r.stdout.trim().split(/\r?\n/)[0] ?? ''
    return r.exitCode === 0 && line !== '' ? line : null
  } catch {
    return null
  }
}

export async function resolveProject($: EngineInterface): Promise<AzProject> {
  const root = await $.session.root()
  let vcsMainRoot: string | null = null
  try {
    vcsMainRoot = (await $.vcs.detect({ path: root }))?.mainRoot ?? null
  } catch { /* no working copy: fall back to git, then to the folder */ }
  const commonDir = vcsMainRoot === null
    ? await gitLine($, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    : null
  const mainRoot = mainRootFrom({ root, vcsMainRoot, commonDir })
  const remote = await gitLine($, mainRoot, ['remote', 'get-url', 'origin'])
  return projectFrom(mainRoot, remote === null ? null : stripUserinfo(remote))
}
