/*
 * azure.test.ts — tests of the Azure reading side of Raccolta: az error classes (az.ts),
 * the Resource Graph query and the cards built from its rows (graph.ts, secrets.ts),
 * one resource read directly, and the refresh rhythm (refresh.ts).
 * Pure functions are called directly; reads through az run the whole mod over world.ts.
 */
import { expect, test } from 'claude-code/testing'

import { classifyError } from './az'
import { buildQuery, markGone, nextPage, rowToCard } from './graph'
import { backoffMs, cacheForSubscription, intervalFor, shouldRefresh } from './refresh'
import { isSecretLike } from './secrets'
import { norm, NOW, result, startWorld } from './world'
import { DEMO_SUITE_ROWS, GRAPH_DEMO_SUITE, gid, SECRET_VALUE, SUB } from '../fixtures/azure'
import type { GraphRow } from '../fixtures/azure'
import type { AzCache, AzCard } from '../../types'

const rowOf = (name: string): GraphRow => DEMO_SUITE_ROWS.find(r => r.name === name) as GraphRow
const DEMO = gid('rg-demo-suite')

// ---------------------------------------------------------------- E1 az runner

test('az missing', async ($, on) => {
  const w = startWorld(on, { az: () => 'missing' })
  await $.session.start({ cwd: '/work/demo-suite', surface: 'desktop', isInteractive: true })
  await w.waitFor(() => w.seen.health?.az === 'missing')
  await w.pause(100)
  expect(w.runs.filter(a => a[0] === 'az').length).toBeLessThan(3)
})

test('login expired', async ($, on) => {
  expect(classifyError("ERROR: AADSTS70043: The refresh token has expired. Please run 'az login'", 7).code).toBe('login')
  const w = startWorld(on, { az: () => result(1, '', "ERROR: Please run 'az login' to setup account.") })
  await $.session.start({ cwd: '/work/demo-suite', surface: 'desktop', isInteractive: true })
  await w.waitFor(() => w.seen.health?.az === 'login')
})

test('throttled with Retry-After', async () => {
  const e = classifyError('ERROR: (429) Too many requests. Retry-After: 30', 1000)
  expect(e.code).toBe('throttled')
  expect(e.retryAt).toBe(31_000)
  expect(classifyError('getaddrinfo ENOTFOUND management.azure.com', 0).code).toBe('network')
  expect(classifyError('(AuthorizationFailed) no access', 0).code).toBe('forbidden')
  expect(classifyError('something odd', 0).code).toBe('other')
})

test('error message never carries stdout', async () => {
  const e = classifyError(`first line\n${SECRET_VALUE}`, 0)
  expect(e.message).toBe('first line')
  expect(classifyError('x'.repeat(500), 0).message.length).toBe(200)
})

// ---------------------------------------------------------------- E2 graph and cards

test('demo suite gives 13 cards', async () => {
  // groups travel as full ids, subscription included (review round 2, g2)
  const q = buildQuery([gid('rg-demo-suite')], ['/subscriptions/0/resourcegroups/rg-x/providers/a/b/c'])
  expect(q.includes(`'${gid('rg-demo-suite')}'`)).toBe(true)
  expect(/\bproperties\b(?!\.)/.test(q)).toBe(false)
  for (const column of Object.keys(rowOf('app-control')).filter(k => k !== 'env')) expect(q.includes(`['${column}'] =`)).toBe(true)
  const cards = DEMO_SUITE_ROWS.map(r => rowToCard(r, NOW, 'group'))
  expect(cards.length).toBe(13)
  expect(cards.every(c => c.id === c.id.toLowerCase() && c.type === c.type.toLowerCase())).toBe(true)
  const control = cards.find(c => c.name === 'app-control') as AzCard
  expect(control.status).toBe('ok')
  expect(control.facts.cpu).toBe(1)
  expect(control.facts.memoryGi).toBe(2)
  expect(control.facts.ingress).toBe('external')
  expect(control.uses.length).toBe(2)
})

test('app-flow is failed', async () => {
  const card = rowToCard(rowOf('app-flow'), NOW, 'group')
  expect(card.status).toBe('failed')
  expect(card.facts.latestRevisionReady).toBe(false)
  expect(card.warnings).toEqual(['revision-failed'])
})

test('env values never reach a card', async () => {
  const text = JSON.stringify(DEMO_SUITE_ROWS.map(r => rowToCard(r, NOW, 'group')))
  expect(text.includes(SECRET_VALUE)).toBe(false)
  expect(text.includes('DB_PASSWORD')).toBe(false)
  expect(isSecretLike('DefaultEndpointsProtocol=https;AccountKey=abc')).toBe(true)
  expect(isSecretLike('https://x.blob.core.windows.net/c?sv=1&sig=abc')).toBe(true)
  expect(isSecretLike('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x')).toBe(true)
  expect(isSecretLike('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlq')).toBe(true)
  expect(isSecretLike('acrdemosuite.azurecr.io/app-control:abc1234')).toBe(false)
  const leaky = rowToCard({ ...rowOf('app-control'), url: 'Server=x;Password=hunter2' }, NOW, 'group')
  expect(leaky.facts.url).toBeUndefined()
})

test('unknown fact dropped', async () => {
  const card = rowToCard({ ...rowOf('kv-demo-suite'), image: 'should-not-show', cpu: 4 }, NOW, 'group')
  expect(card.facts).toEqual({ sku: 'standard', softDelete: true, purgeProtection: true, publicAccess: 'Enabled' })
  const long = rowToCard({ ...rowOf('app-control'), image: 'ab-'.repeat(100) }, NOW, 'group')
  expect(String(long.facts.image).length).toBe(256)
})

test('gone resource', async () => {
  const prev = Object.fromEntries(DEMO_SUITE_ROWS.map(r => [r.id, rowToCard(r, NOW - 1000, 'group')]))
  const next = Object.fromEntries(DEMO_SUITE_ROWS.slice(1).map(r => [r.id, rowToCard(r, NOW, 'group')]))
  const merged = markGone(prev, next, NOW, { groups: { [DEMO]: { at: 1 } }, includes: {} })
  const control = merged[rowOf('app-control').id]
  expect(control?.goneAt).toBe(NOW)
  expect(Object.keys(merged).length).toBe(13)
  expect(Object.keys(markGone(prev, next, NOW, { groups: {}, includes: {} })).length).toBe(12)
})

test('paged answer', async ($, on) => {
  expect(nextPage({ data: [], $skipToken: 'tok' })).toBe('tok')
  expect(nextPage(GRAPH_DEMO_SUITE)).toBeUndefined()
  const half = 7
  const bodies: string[] = []
  const w = startWorld(on, {
    az: a => {
      if (a[1] !== 'rest') return undefined
      const body = w.files.get(norm(a.find(x => x.startsWith('@'))?.slice(1) ?? '')) ?? ''
      bodies.push(body)
      return result(0, JSON.stringify(body.includes('p2')
        ? { data: DEMO_SUITE_ROWS.slice(half) }
        : { data: DEMO_SUITE_ROWS.slice(0, half), $skipToken: 'p2' }))
    },
  })
  await w.start($)
  expect(Object.keys(w.seen.cache?.resources ?? {}).length).toBe(13)
  expect(bodies.filter(b => b.includes('p2')).length).toBe(1)
})

// ---------------------------------------------------------------- E3 one resource

test('refresh one updates only that card', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  const before = w.seen.cache as AzCache
  w.runs.length = 0
  await $.tool.call({ tool: 'Bash', command: 'az containerapp restart -n app-match -g rg-demo-suite' })
  await w.waitFor(() => w.runs.some(a => a[2] === 'show') && w.idle())
  const after = w.seen.cache as AzCache
  const changed = Object.keys(after.resources).filter(id => JSON.stringify(after.resources[id]) !== JSON.stringify(before.resources[id]))
  expect(changed.every(id => id === rowOf('app-match').id)).toBe(true)
  expect(w.runs.filter(a => a[0] === 'az').map(a => a.slice(1, 3).join(' '))).toEqual(['resource show'])
})

// ---------------------------------------------------------------- E4 rhythm

const base = { now: NOW, placed: true, lastInputAt: NOW, stateAt: NOW - 120_000, backoffUntil: 0, isLoginStopped: false }

test('refreshes every 2 min when placed', async () => {
  expect(shouldRefresh(base)).toBe(true)
  expect(shouldRefresh({ ...base, stateAt: NOW - 60_000 })).toBe(false)
  expect(shouldRefresh({ ...base, stateAt: undefined })).toBe(true)
})

test('nothing when the pane is closed', async () => {
  expect(shouldRefresh({ ...base, placed: false })).toBe(false)
})

test('idle after 30 min', async () => {
  expect(intervalFor(NOW, NOW - 1_800_001)).toBe(600_000)
  expect(intervalFor(NOW, NOW - 60_000)).toBe(120_000)
  expect(shouldRefresh({ ...base, lastInputAt: NOW - 1_800_001 })).toBe(false)
})

test('backs off', async () => {
  expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([2, 4, 8, 16, 30, 30].map(m => m * 60_000))
  expect(shouldRefresh({ ...base, backoffUntil: NOW + 1 })).toBe(false)
})

test('login stops the loop', async () => {
  expect(shouldRefresh({ ...base, isLoginStopped: true })).toBe(false)
})

test('subscription changed', async () => {
  const old: AzCache = { schemaVersion: 1, projectKey: 'demo-suite', subscription: { id: 'other', name: 'Old' },
    groups: {}, resources: { x: rowToCard(rowOf('app-control'), 1, 'group') }, activity: [], errors: {} }
  const fresh = cacheForSubscription(old, SUB, 'demo-suite')
  expect(fresh.subscription).toEqual(SUB)
  expect(Object.keys(fresh.resources).length).toBe(0)
  expect(cacheForSubscription({ ...old, subscription: SUB }, SUB, 'demo-suite').resources).toEqual(old.resources)
})

test('the loop reads Azure again after 2 min with the pane placed', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  w.runs.length = 0
  await w.clock.advance(150_000)
  await w.waitFor(() => w.runs.some(a => a[1] === 'rest'))
})
