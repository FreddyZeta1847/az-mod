/*
 * pane/extras.test.tsx — tests of the cruscotto's new parts (letter D of «Costi, attività e
 * avvisi»): the drawing pieces (cost bar, amounts, warning and activity texts), then the three
 * boxes (costs, «Da guardare», recent activity) and the cost on each row, on desktop and terminal.
 */
import { expect, test } from 'claude-code/testing'

import { result, startWorld } from '../collect/world'
import { WARNING_ORDER } from '../contract'
import { cache, demoCards, demoState, idOf, NOW, PANE, rules, seed } from './seed'
import { costBar } from './svg'
import { activityText, money, WARNING_TEXT } from './theme'
import type { AzActivity, AzCache, AzCard, AzEvent } from '../../types'

// ---------------------------------------------------------------- D1 pieces

test('the cost bar is a plain image with a size', async () => {
  const s = costBar([{ color: '#4cc9f0', value: 30 }, { color: '#a78bfa', value: 10 }, { color: '#000', value: 0 }], 300, 14)
  expect(/^<svg [^>]*width="300" height="14"/.test(s)).toBe(true)
  expect(/<script|<style|<title|on[a-z]+=/i.test(s)).toBe(false)
  expect((s.match(/<rect /g) ?? []).length).toBe(2)
  expect(/^<svg [^>]*width="300" height="14"/.test(costBar([], 300, 14))).toBe(true)
})

test('amounts carry their currency', async () => {
  expect(money(12.3, 'EUR')).toBe('12,30 €')
  expect(money(0, 'EUR')).toBe('0,00 €')
  expect(money(1234.5, 'USD')).toBe('1234,50 USD')
})

test('every warning has a cause and an action', async () => {
  for (const w of WARNING_ORDER) {
    expect(WARNING_TEXT[w].cause.length).toBeGreaterThan(5)
    expect(WARNING_TEXT[w].action.length).toBeGreaterThan(5)
  }
})

test('activities read as plain words', async () => {
  expect(activityText('microsoft.app/containerapps/write', 'Succeeded')).toBe('creata o modificata')
  expect(activityText('microsoft.storage/storageaccounts/delete', 'Succeeded')).toBe('cancellata')
  expect(activityText('microsoft.app/containerapps/revisions/restart/action', 'Succeeded')).toBe('riavviata')
  expect(activityText('microsoft.web/sites/stop/action', 'Succeeded')).toBe('fermata')
  expect(activityText('microsoft.storage/storageaccounts/delete', 'Failed')).toBe('cancellazione non riuscita')
})

// ---------------------------------------------------------------- D2 boxes

const SURFACES = ['desktop', 'terminal'] as const
/** demo cards with this month's costs (app-match spends twice last month: a cost spike). */
const costed = (): Record<string, AzCard> => {
  const cards = demoCards()
  for (const c of Object.values(cards)) c.cost = { month: 0, prevMonth: null }
  const set = (name: string, month: number, prevMonth: number | null): void => {
    cards[idOf(name)] = { ...(cards[idOf(name)] as AzCard), cost: { month, prevMonth } }
  }
  set('app-control', 30, 28)
  set('app-match', 40, 20)
  set('stdemosuite', 1.5, null)
  // the seed cards carry no warnings: app-flow gets the one its failed revision would have
  cards[idOf('app-flow')] = { ...(cards[idOf('app-flow')] as AzCard), warnings: ['revision-failed'] }
  return cards
}
const withCosts = (over: Partial<AzCache> = {}): AzCache =>
  cache({ resources: costed(), cost: { currency: 'EUR', month: 71.5, prevMonth: 48 }, costAt: NOW - 3_600_000, ...over })
const act = (name: string, op: string, status: string, minutesAgo: number): AzActivity =>
  ({ at: NOW - minutesAgo * 60_000, op, status, resourceId: idOf(name) })

test('cost box with costs, without, with an error', async ($, on) => {
  let current: Record<string, unknown> = {}
  seed(on, () => current)
  for (const surface of SURFACES) {
    current = { ...demoState(), cache: withCosts() }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Costo del mese 71,50 €$/ })).toBeDefined()
    // k9: month-to-date against a whole month gives no honest percentage: the two amounts, side by side
    expect(await ui.find({ type: 'Text', text: /^mese scorso 48,00 €$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Container Apps$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /costi aggiornati 1 h fa/ })).toBeDefined()
    expect(await ui.find({ key: 'refresh-cost' })).toBeDefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(s => s.props.alt === 'Costo del mese per tipo di risorsa')).toBe(true)
    await ui.unmount()
    current = demoState()
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /non ancora letto/ })).toBeDefined()
    expect(await ui.find({ key: 'refresh-cost' })).toBeDefined()
    await ui.unmount()
    current = { ...demoState(), cache: withCosts({ errors: { cost: { at: NOW, code: 'throttled', message: 'Too many requests' } } }) }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Costi non letti: Too many requests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Costo del mese 71,50 €$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('another currency is written as its code', async ($, on) => {
  seed(on, { ...demoState(), cache: withCosts({ cost: { currency: 'USD', month: 71.5, prevMonth: 48 } }) })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Costo del mese 71,50 USD$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /€/ })).toBeUndefined()
  await ui.unmount()
})

test('Da guardare only with rows, at most four', async ($, on) => {
  let current: Record<string, unknown> = {}
  seed(on, () => current)
  current = { ...demoState(), cache: withCosts() }
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // app-flow: revision failed (first), app-match: cost spike
  expect(await ui.find({ type: 'Text', text: /^Da guardare · 2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /app-flow: l'ultima revisione non è partita/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /app-match: costa più di 1,5 volte il mese scorso/ })).toBeDefined()
  await ui.unmount()
  const many = Object.fromEntries(Object.entries(demoCards()).map(([id, c]) => [id, { ...c, status: 'ok' as const, warnings: ['registry-admin' as const] }]))
  current = { ...demoState(), cache: cache({ resources: many }) }
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.findAll({ type: 'Text', text: /utente admin del registry attivo/ })).toHaveLength(4)
  expect(await term.find({ type: 'Text', text: /^\+9 altri$/ })).toBeDefined()
  await term.unmount()
  const quiet = Object.fromEntries(Object.entries(demoCards()).map(([id, c]) => [id, { ...c, status: 'ok' as const, warnings: [] }]))
  current = { ...demoState(), cache: cache({ resources: quiet }) }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Da guardare/ })).toBeUndefined()
  await ui.unmount()
})

test('recent activity with da Claude', async ($, on) => {
  // k4: the hook stamps the event when az returns, after Azure logged the change (10 min ago)
  const events: AzEvent[] = [{ at: NOW - 9 * 60_000, sessionId: 's1', cmdGroup: 'containerapp', verb: 'restart', isWrite: true, ids: [idOf('app-match')], exit: 0 }]
  let current: Record<string, unknown> = {}
  seed(on, () => current)
  for (const surface of SURFACES) {
    current = { ...demoState(), events, cache: withCosts({ activityAt: NOW - 60_000, activity: [
      act('app-match', 'microsoft.app/containerapps/revisions/restart/action', 'Succeeded', 10),
      act('stdemosuite', 'microsoft.storage/storageaccounts/delete', 'Failed', 300),
    ] }) }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Attività recenti$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^app-match riavviata$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^stdemosuite cancellazione non riuscita$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /da Claude/ })).toHaveLength(1)
    await ui.unmount()
    current = { ...demoState(), cache: withCosts({ activityAt: NOW - 60_000, activity: [] }) }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Nessuna modifica negli ultimi 7 giorni/ })).toBeDefined()
    await ui.unmount()
  }
})

test('each row shows its cost', async ($, on) => {
  seed(on, { ...demoState(), cache: withCosts() })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^40,00 €$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1,50 €$/ })).toBeDefined()
  await ui.unmount()
})

test('k5 the month total counts only the resources of the project shown', async ($, on) => {
  const hidden = idOf('stdemosuite')
  const cards = costed()
  cards[hidden] = { ...(cards[hidden] as AzCard), cost: { month: 250, prevMonth: 200 } }
  // the storage is taken out of the project: Azure still bills it in the group, the box does not count it
  seed(on, { ...demoState(), rules: rules({ excludes: { [hidden]: { at: NOW } } }), cache: withCosts({ resources: cards, cost: { currency: 'EUR', month: 320, prevMonth: 248 } }) })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Costo del mese 70,00 €$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^mese scorso 48,00 €$/ })).toBeDefined()
  await ui.unmount()
})

test('k11 the cost button waits while Azure is throttling', async ($, on) => {
  const isCost = (a: string[]): boolean => a[1] === 'rest' && a.some(x => x.includes('Microsoft.CostManagement/query'))
  const w = startWorld(on, { az: a => (isCost(a) ? result(1, '', 'ERROR: (429) Too many requests. Retry-After: 600') : undefined) })
  await w.start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh-cost' })
  await w.waitFor(() => w.seen.cache?.errors.cost !== undefined && w.idle())
  const calls = w.runs.filter(isCost).length
  await ui.press({ key: 'refresh-cost' })
  await ui.press({ key: 'refresh-cost' })
  await w.pause(50)
  expect(w.runs.filter(isCost).length).toBe(calls)
  await ui.unmount()
})

test('the cost button reaches Raccolta', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  const costCalls = (): number => w.runs.filter(a => a[1] === 'rest' && a.some(x => x.includes('Microsoft.CostManagement/query'))).length
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh-cost' })
  await w.waitFor(() => costCalls() === 1 && w.seen.cache?.cost !== undefined)
  await ui.unmount()
})

test('validate passes on every new state', async ($, on) => {
  let current: Record<string, unknown> = {}
  seed(on, () => current)
  const states: Record<string, Record<string, unknown>> = {
    costs: { ...demoState(), cache: withCosts() },
    errors: { ...demoState(), cache: withCosts({ errors: { cost: { at: NOW, code: 'other', message: 'no' }, activity: { at: NOW, code: 'network', message: 'no' } } }) },
    activity: { ...demoState(), cache: withCosts({ activityAt: NOW, activity: [act('app-control', 'microsoft.app/containerapps/write', 'Succeeded', 3)] }) },
    'no costs': demoState(),
  }
  for (const [name, state] of Object.entries(states)) {
    current = state
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const drawn = await ui.drawn().catch((err: unknown) => `${name}/${surface}: ${String(err)}`)
      expect(typeof drawn === 'string' ? drawn : 'ok').toBe('ok')
      await ui.unmount()
    }
  }
})
