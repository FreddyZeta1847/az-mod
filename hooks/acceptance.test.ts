/*
 * acceptance.test.ts — the acceptance tests of stage «Raccolta e pannello»: what must be
 * true for the two parts to be finished. Written by the main session before the children
 * start; the children never edit this file.
 * The world beneath the mod is mocked: az answers from fixtures/azure.ts (the Resource
 * Graph body file must name the project group), files in memory, a mocked clock, the
 * project folder /work/demo-suite (not a git repo), the pane placed. The test's $ has no
 * state noun, so the world records every state write (and every file write) beneath the mod.
 * Raccolta: first open adopts exactly rg-demo-suite · no secret ever leaves the hook ·
 * a write command refreshes its resource. Pannello: the pane draws the project (desktop
 * and terminal) · the pane buttons reach Raccolta (needs both parts merged).
 */
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { azAnswer, DEMO_SUITE_ROWS, gid, SECRET_NAME, SECRET_VALUE, SUB } from './fixtures/azure'
import type { AzAutoAdded, AzBusy, AzCache, AzCard, AzEvent, AzProject, AzRules, AzSuggestion, AzUi } from '../types'

const ROOT = '/work/demo-suite'
const NOW = 1_764_000_000_000
const COMMAND_SECRET = 'hunter2-from-command'
const DEMO = gid('rg-demo-suite')
const idOf = (name: string): string => DEMO_SUITE_ROWS.find(r => r.name === name)?.id as string

type Seen = {
  rules?: AzRules | null; cache?: AzCache | null; events?: AzEvent[]; autoAdded?: AzAutoAdded
  suggestions?: AzSuggestion[]; busy?: AzBusy; ui?: AzUi; [key: string]: unknown
}
/** Everything the mod did beneath it: last value per state key, and every payload ever written. */
type World = { files: Map<string, string>; runs: string[][]; seen: Seen; written: string[] }

const unshape = (v: unknown): unknown =>
  v !== null && typeof v === 'object' && 'shape' in v ? (v as unknown as { value: unknown }).value : v

/** On Windows the engine resolves '/data/x' to 'C:\data\x' before the fs hooks: compare paths in one form. */
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const world = (on: On): World => {
  const w: World = { files: new Map(), runs: [], seen: {}, written: [] }
  const result = (exitCode: number, stdout: string, stderr: string) =>
    ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's1' }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    if (argv[0] === 'git') return { value: result(128, '', 'fatal: not a git repository') }
    if (argv[1] === 'rest') {
      const body = argv.find(a => a.startsWith('@'))?.slice(1)
      const text = body === undefined ? undefined : w.files.get(norm(body))
      if (text === undefined || !text.toLowerCase().includes('rg-demo-suite')) {
        return { value: result(1, '', 'ERROR: the Resource Graph query does not name the project group') }
      }
    }
    return { value: azAnswer(argv) }
  })
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data' } }))
  on('session.root', () => ({ value: ROOT }))
  on('vcs.detect', () => null)
  on('fs.exists', (_$, e) => ({ value: w.files.has(norm(e.path)) }))
  on('fs.read', (_$, e) => (w.files.has(norm(e.path)) ? { value: w.files.get(norm(e.path)) as string } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_$, e) => { w.files.set(norm(e.path), e.text); w.written.push(e.text); return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [{ id: 'az-mod', title: 'Azure', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'az' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('state.set', ($, e, next) => {
    const change = e as unknown as { plugin: string; key: string; value: unknown }
    if (change.plugin === 'az-mod') {
      w.seen[change.key] = unshape(change.value)
      w.written.push(JSON.stringify(change.value))
    }
    return next(e)
  })
  return w
}

// The test's $ has no clock (the mocked one answers the mod): wait with the runner's own timer.
const pause = (ms: number): Promise<void> =>
  new Promise(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(resolve, ms))

const waitFor = async (check: () => boolean, ms = 4000): Promise<void> => {
  for (let i = 0; i < ms / 25; i++) {
    if (check()) return
    await pause(25)
  }
  throw new Error('timed out waiting for the mod')
}

const idle = (w: World): boolean => {
  const b = w.seen.busy
  return b === undefined || (!b.scan && !b.update && !b.cost && b.ids.length === 0)
}

/** Session start, then wait until the first scan and read have landed and nothing is busy. */
const start = async ($: Engine, w: World): Promise<void> => {
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await waitFor(() => Object.keys(w.seen.cache?.resources ?? {}).length > 0 &&
    w.seen.rules != null && w.seen.autoAdded != null && idle(w))
}

const noSecretIn = (texts: string[]): void => {
  const all = texts.join('\n')
  expect(all.includes(SECRET_NAME)).toBe(false)
  expect(all.includes(COMMAND_SECRET)).toBe(false)
  expect(all.includes(SECRET_VALUE)).toBe(false)
}

// ---------------------------------------------------------------- Raccolta

test('first open adopts exactly rg-demo-suite', async ($, on) => {
  const w = world(on)
  await start($, w)

  expect(Object.keys(w.seen.rules?.groups ?? {})).toEqual([DEMO])
  expect(w.seen.autoAdded).toEqual({ groupId: DEMO, count: 13 })
  const cards = Object.values(w.seen.cache?.resources ?? {})
  expect(cards.length).toBe(13)
  expect(cards.find(c => c.name === 'app-flow')?.status).toBe('failed')
  expect(w.seen.cache?.subscription.id).toBe(SUB.id)
  // a similar group is only proposed, never adopted
  const old = (w.seen.suggestions ?? []).find(s => s.id === gid('rg-demo-suite-old'))
  expect(old?.reason).toBe('similar-group')
})

test('no secret ever leaves the hook', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.runs.length = 0

  await $.tool.call({ tool: 'Bash', command: `az webapp config appsettings set -n app-control -g rg-demo-suite --settings ${SECRET_NAME}=${COMMAND_SECRET}` })
  // the hook refreshes app-control directly: the read that would carry its env values
  await waitFor(() => w.runs.some(a => a[1] === 'resource' && a[2] === 'show' && a.includes(idOf('app-control'))))
  await waitFor(() => idle(w))

  noSecretIn(w.written)
  noSecretIn(w.runs.map(a => a.join(' ')))
  expect((w.seen.events ?? []).length).toBeGreaterThan(0)
})

test('a write command refreshes its resource', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.runs.length = 0

  await $.tool.call({ tool: 'PowerShell', command: 'az containerapp update -n app-match -g rg-demo-suite' })
  await waitFor(() => w.runs.some(a => a[1] === 'resource' && a[2] === 'show' && a.includes(idOf('app-match'))))

  const events = w.seen.events ?? []
  expect(events[events.length - 1]?.isWrite).toBe(true)
  expect(events[events.length - 1]?.name).toBe('app-match')
})

// ---------------------------------------------------------------- Pannello

const PANE = {
  plugin: 'az-mod',
  component: 'Pane',
  requestId: 'az-mod',
  props: { title: 'Azure', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const demoCards = (): Record<string, AzCard> => Object.fromEntries(DEMO_SUITE_ROWS.map(r => [r.id, {
  id: r.id, name: r.name, type: r.type, group: r.resourceGroup, location: r.location,
  status: r.name === 'app-flow' ? 'failed' : 'ok', autoCreated: false, via: 'group', facts: {}, uses: [], warnings: [], stateAt: NOW - 30_000,
} satisfies AzCard]))

const SEEDS: Record<string, unknown> = {
  project: { key: 'demo-suite', mainRoot: ROOT, remote: null } satisfies AzProject,
  rules: { schemaVersion: 1, project: { key: 'demo-suite', mainRoot: ROOT, remote: null }, groups: { [DEMO]: { at: NOW - 60_000 } }, includes: {}, excludes: {}, dismissed: {}, updatedAt: NOW - 60_000 } satisfies AzRules,
  cache: { schemaVersion: 1, projectKey: 'demo-suite', subscription: SUB, stateAt: NOW - 30_000, groups: { [DEMO]: { name: 'rg-demo-suite' } }, resources: demoCards(), activity: [], errors: {} } satisfies AzCache,
}

/** Seeds Raccolta's keys for a pane-only test; a key the mod writes stops being seeded. */
const seed = (on: On, w: World): void => {
  on('state.get', ($, e, next) => {
    const value = e.plugin === 'az-mod' && !(e.key in w.seen) ? SEEDS[e.key] : undefined
    return value === undefined ? next(e) : { value: { value: { shape: `${e.key}-1`, value }, version: 1 } }
  })
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** A row shows a resource's full name as its last word (after «▸ » or «▾ » when it is a button). */
const nameAtEnd = (name: string): RegExp => new RegExp(`(^|[\\s▸▾])${escape(name)}$`)

test('pane draws the project', async ($, on) => {
  const w = world(on)
  seed(on, w)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^demo-suite$/ })).toBeDefined()
    for (const r of DEMO_SUITE_ROWS) {
      expect(await ui.find({ text: nameAtEnd(r.name) })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Attiva/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Problema/ })).toBeDefined()
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'desktop') expect(svgs.some(s => s.props.alt === 'Risorse per stato')).toBe(true)
    else expect(svgs.length).toBe(0)
    await ui.unmount()
  }
})

test('pane buttons reach Raccolta', async ($, on) => {
  const w = world(on)
  await start($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Update re-reads the project from Resource Graph
  w.runs.length = 0
  await ui.press({ key: 'update' })
  await waitFor(() => w.runs.some(a => a[1] === 'rest'))
  await waitFor(() => idle(w))

  // Scan always re-reads the subscription's resource list (plan F2)
  w.runs.length = 0
  await ui.press({ key: 'scan' })
  await waitFor(() => w.runs.some(a => a[1] === 'resource' && a[2] === 'list'))
  await waitFor(() => idle(w))

  // opening a row records it in the pane's own state and shows its details
  await ui.press({ key: 'open-app-control' })
  await waitFor(() => w.seen.ui?.openCard === idOf('app-control'))
  expect(await ui.find({ text: /Apri nel portale/ })).toBeDefined()
  await ui.unmount()
})
