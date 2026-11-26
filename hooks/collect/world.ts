/*
 * world.ts — test helper of Raccolta (not loaded by the mod): mocks the world beneath the
 * mod for its *.test.ts files, like hooks/acceptance.test.ts but configurable.
 * az answers come from fixtures/azure.ts (or an override), files live in a Map, the clock
 * is mocked, the project folder is /work/demo-suite (git answers "not a repo" unless
 * overridden), the pane is placed. Every state write and file write is recorded.
 * File paths are compared drive-less with forward slashes (see norm).
 * Usage: `const w = startWorld(on, { files, az, git }); await w.start($)`.
 */
import type { On, ProcessRunResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { azAnswer } from '../fixtures/azure'
import type { AzAutoAdded, AzBusy, AzCache, AzEvent, AzHealth, AzProject, AzRules, AzSuggestion } from '../../types'

export const ROOT = '/work/demo-suite'
export const NOW = 1_764_000_000_000

export type Seen = {
  project?: AzProject | null; rules?: AzRules | null; cache?: AzCache | null; events?: AzEvent[]
  autoAdded?: AzAutoAdded; suggestions?: AzSuggestion[]; found?: AzSuggestion[]; busy?: AzBusy; health?: AzHealth
}
export type WorldOptions = {
  files?: Record<string, string>
  /** Answers an az call first; undefined falls back to the fixtures. */
  az?: (argv: string[]) => ProcessRunResult | 'missing' | undefined
  /** Answers a git call; undefined means "not a git repository". */
  git?: (argv: string[]) => ProcessRunResult | undefined
  placed?: boolean
  /** What a tool call answers beneath the mod (default: an empty result). */
  toolResult?: object
  /** Every tool call ends in error (a failed or denied command). */
  toolFails?: boolean
}
export type World = {
  files: Map<string, string>; runs: string[][]; seen: Seen; written: string[]; clock: MockClock
  start: ($: Engine) => Promise<void>
  waitFor: (check: () => boolean, ms?: number) => Promise<void>
  pause: (ms: number) => Promise<void>
  idle: () => boolean
}

export const result = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** The engine resolves '/data/x' to 'C:\data\x' on Windows: the world keys files by a drive-less, slash form. */
export const norm = (path: string): string => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const unshape = (v: unknown): unknown =>
  v !== null && typeof v === 'object' && 'shape' in v ? (v as unknown as { value: unknown }).value : v

const pause = (ms: number): Promise<void> =>
  new Promise(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(resolve, ms))

const waitFor = async (check: () => boolean, ms = 4000): Promise<void> => {
  for (let i = 0; i < ms / 25; i++) {
    if (check()) return
    await pause(25)
  }
  throw new Error('timed out waiting for the mod')
}

export const startWorld = (on: On, options: WorldOptions = {}): World => {
  const files = new Map(Object.entries(options.files ?? {}).map(([k, v]) => [norm(k), v]))
  const seen: Seen = {}
  const w: World = {
    files, runs: [], seen, written: [], clock: mock.clock(on, { now: NOW }),
    start: async $ => {
      await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
      await waitFor(() => Object.keys(seen.cache?.resources ?? {}).length > 0 && seen.rules != null && w.idle())
    },
    waitFor, pause,
    idle: () => {
      const b = seen.busy
      return b === undefined || (!b.scan && !b.update && !b.cost && b.ids.length === 0)
    },
  }
  on('session.id', () => ({ value: 's1' }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    if (argv[0] === 'git') return { value: options.git?.(argv) ?? result(128, '', 'fatal: not a git repository') }
    const over = options.az?.(argv)
    if (over === 'missing') return { deny: 'spawn az ENOENT' }
    if (over !== undefined) return { value: over }
    if (argv[1] === 'rest') {
      const body = argv.find(a => a.startsWith('@'))?.slice(1)
      const text = body === undefined ? undefined : files.get(norm(body))
      if (text === undefined || !text.toLowerCase().includes('rg-demo-suite')) {
        return { value: result(1, '', 'ERROR: the Resource Graph query does not name the project group') }
      }
    }
    return { value: azAnswer(argv) }
  })
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data' } }))
  on('session.root', () => ({ value: ROOT }))
  on('vcs.detect', () => null)
  on('fs.exists', (_$, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', (_$, e) => (files.has(norm(e.path)) ? { value: files.get(norm(e.path)) as string } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_$, e) => { files.set(norm(e.path), e.text); w.written.push(e.text); return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [{ id: 'az-mod', title: 'Azure', isShown: true, isFocused: false, isPlaced: options.placed ?? true }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'az' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // the command itself answers at tool.run (after the permission step), as in a session
  on('tool.run', () => (options.toolFails === true ? { result: options.toolResult ?? {}, isError: true } : { result: options.toolResult ?? {} }))
  on('state.set', ($, e, next) => {
    const change = e as unknown as { plugin: string; key: string; value: unknown }
    if (change.plugin === 'az-mod') {
      (seen as Record<string, unknown>)[change.key] = unshape(change.value)
      w.written.push(JSON.stringify(change.value))
    }
    return next(e)
  })
  return w
}
