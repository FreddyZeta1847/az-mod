/*
 * hook.test.ts — tests of the az command parser (parse-az.ts) and of the tool.call hook
 * (hook.ts): only clean tokens are kept, chains and variables become 'unclear', the call
 * itself is never changed, reads only log, writes refresh or propose once.
 * The hook tests run the whole mod over world.ts.
 */
import { expect, test } from 'claude-code/testing'

import { parseAz } from './parse-az'
import { startWorld } from './world'
import { DEMO_SUITE_ROWS, gid } from '../fixtures/azure'
import type { AzEvent } from '../../types'

const ev = (command: string): AzEvent => {
  const r = parseAz(command, 5, 's1')
  if (r === null || r === 'unclear') throw new Error(`not an event: ${String(r)}`)
  return r
}
const idOf = (name: string): string => DEMO_SUITE_ROWS.find(r => r.name === name)?.id as string
const shows = (runs: string[][], id: string): boolean =>
  runs.some(a => a[1] === 'resource' && a[2] === 'show' && a.includes(id))

// ---------------------------------------------------------------- D1 parser

test('a write command gives group, verb, name and group', async () => {
  const e = ev('az containerapp update -n app-match -g rg-demo-suite')
  expect(e).toEqual({ at: 5, sessionId: 's1', cmdGroup: 'containerapp', verb: 'update', isWrite: true,
    name: 'app-match', group: 'rg-demo-suite', exit: 0 })
  expect(ev('az containerapp revision restart --name app-flow --resource-group rg-demo-suite').cmdGroup).toBe('containerapp revision')
  expect(ev('az webapp show --name=tasklist').name).toBe('tasklist')
})

test('a read command has no name', async () => {
  const e = ev('az account show')
  expect(e.verb).toBe('show')
  expect(e.isWrite).toBe(false)
  expect(e.name).toBeUndefined()
})

test('settings values are never kept', async () => {
  const e = ev('az x set -n app-a --settings A=B "C=D E"')
  expect(JSON.stringify(e).includes('A=B')).toBe(false)
  expect(JSON.stringify(e).includes('C=D')).toBe(false)
  expect(ev('az webapp show -n "Bad Name" -g rg_Mixed').name).toBeUndefined()
  expect(ev('az resource show --ids /subscriptions/0/resourceGroups/RG-X/providers/a/b/c').ids)
    .toEqual(['/subscriptions/0/resourcegroups/rg-x/providers/a/b/c'])
})

test('chains are unclear', async () => {
  expect(parseAz('az a b; az c d', 0, 's1')).toBe('unclear')
  expect(parseAz('az a b && echo ok', 0, 's1')).toBe('unclear')
  expect(parseAz('az a b | jq .', 0, 's1')).toBe('unclear')
  expect(parseAz('az a b\naz c d', 0, 's1')).toBe('unclear')
  expect(parseAz('az webapp show -n `whoami`', 0, 's1')).toBe('unclear')
})

test('variables are unclear', async () => {
  expect(parseAz("$n = 'x'; az webapp show -n $n", 0, 's1')).toBe('unclear')
  expect(parseAz('az webapp show -n $(cat f)', 0, 's1')).toBe('unclear')
})

test('no az word gives null', async () => {
  expect(parseAz('echo hi', 0, 's1')).toBeNull()
  expect(parseAz('git commit -m "lazy"', 0, 's1')).toBeNull()
})

// ---------------------------------------------------------------- D2 hook

test('hook never changes the call', async ($, on) => {
  const w = startWorld(on, { toolResult: { text: 'done', isError: false } })
  await w.start($)
  const ran = await $.tool.call({ tool: 'Bash', command: 'az containerapp update -n app-match -g rg-demo-suite' })
  expect(ran.deny).toBeUndefined()
  expect((ran as { result?: { text?: string } }).result?.text).toBe('done')
})

test('read command only logs', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  w.runs.length = 0
  await $.tool.call({ tool: 'Bash', command: 'az containerapp show -n app-match -g rg-demo-suite' })
  await w.waitFor(() => (w.seen.events ?? []).length === 1)
  await w.pause(100)
  expect(w.runs.filter(a => a[0] === 'az').length).toBe(0)
})

test('write in claimed group refreshes one', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  w.runs.length = 0
  await $.tool.call({ tool: 'PowerShell', command: 'az containerapp restart -n app-flow -g rg-demo-suite' })
  await w.waitFor(() => shows(w.runs, idOf('app-flow')))
  const events = w.seen.events ?? []
  expect(events[events.length - 1]?.ids).toEqual([idOf('app-flow')])
  expect(w.runs.some(a => a[1] === 'rest')).toBe(false)
})

test('write in other group suggests once', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  await $.tool.call({ tool: 'Bash', command: 'az webapp restart -n tasklist -g rg-tasklist' })
  await w.waitFor(() => (w.seen.suggestions ?? []).some(s => s.origin === 'hook'))
  const s = (w.seen.suggestions ?? []).filter(x => x.origin === 'hook')
  expect(s.length).toBe(1)
  expect(s[0]?.reason).toBe('claude-wrote')
  expect(s[0]?.name).toBe('tasklist')
  await $.tool.call({ tool: 'Bash', command: 'az webapp restart -n tasklist -g rg-tasklist' })
  await w.pause(100)
  expect((w.seen.suggestions ?? []).filter(x => x.origin === 'hook').length).toBe(1)
})

test('dismissed resource is not suggested', async ($, on) => {
  const tasklist = `${gid('rg-tasklist')}/providers/microsoft.web/sites/tasklist`
  const saved = { schemaVersion: 1, project: { key: 'demo-suite', mainRoot: '/work/demo-suite', remote: null },
    groups: { [gid('rg-demo-suite')]: { at: 1 } }, includes: {}, excludes: {}, dismissed: { [tasklist]: { at: 1 } }, updatedAt: 1 }
  const w = startWorld(on, { files: { '/data/projects/demo-suite.rules.json': JSON.stringify(saved) } })
  await $.session.start({ cwd: '/work/demo-suite', surface: 'desktop', isInteractive: true })
  await w.waitFor(() => w.seen.rules != null)
  await $.tool.call({ tool: 'Bash', command: 'az webapp restart -n tasklist -g rg-tasklist' })
  await w.waitFor(() => (w.seen.events ?? []).length === 1)
  await w.pause(200)
  expect((w.seen.suggestions ?? []).some(x => x.origin === 'hook')).toBe(false)
})

test('unclear triggers update', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  w.runs.length = 0
  await $.tool.call({ tool: 'Bash', command: 'az group list | jq length' })
  await w.waitFor(() => w.runs.some(a => a[1] === 'rest'))
  expect((w.seen.events ?? []).length).toBe(0)
})

test('n3 the start of a command is taken when it runs, not while it waits for an approval', async ($, on) => {
  const w = startWorld(on)
  // beneath the mod: the permission step, where the person takes 20 minutes to approve
  on('tool.check', async (_$, e, next) => {
    await w.clock.advance(20 * 60_000)
    return next(e)
  })
  await w.start($)
  await $.tool.call({ tool: 'Bash', command: 'az containerapp update -n app-match -g rg-demo-suite' })
  await w.waitFor(() => (w.seen.events ?? []).some(e => e.verb === 'update'))
  const event = (w.seen.events ?? []).find(e => e.verb === 'update') as AzEvent
  expect(event.startedAt).toBeDefined()
  // started after the approval: close to its end, not 20 minutes before it
  expect(event.at - (event.startedAt ?? 0) < 60_000).toBe(true)
})
