/*
 * pane/interactions.test.tsx — tests of the az-mod pane's presses (task H1): every drawn
 * Button key parses (contract.ts parseKey) to the Raccolta action it stands for, or to null
 * for the pane's own toggles; opening and closing a row writes `ui.openCard`; the toggles
 * flip their `ui` flag; every press stamps `ui.lastInputAt`; the «+ Aggiungi» picker opens,
 * draws Raccolta's results from `found` and closes. Raccolta's own reaction to a key is
 * covered by the acceptance test «pane buttons reach Raccolta» once both parts are merged.
 */
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { AzCard, AzSuggestion, AzUi } from '../../types'
import { parseKey } from '../contract'
import { DEMO_SUITE_ROWS, gid } from '../fixtures/azure'
import { cache, DEMO, demoCards, demoState, idOf, NOW, PANE, rules, seed } from './seed'

const OTHER = gid('rg-demo-suite-data')
const SUGGESTED = gid('rg-demo-suite-old')
const EXCLUDED = idOf('log-demo-suite')
const FOUND_ID = gid('rg-other') + '/providers/microsoft.app/containerapps/other-api'
const FOUND: AzSuggestion[] = [
  { id: FOUND_ID, kind: 'resource', origin: 'scan', reason: 'named-in-files', name: 'other-api', type: 'microsoft.app/containerapps' },
  { id: SUGGESTED, kind: 'group', origin: 'scan', reason: 'similar-group', name: 'rg-demo-suite-old', count: 1 },
]

/** A state where every button of the pane is drawn. */
const richState = (): Record<string, unknown> => {
  const cards = demoCards()
  const watcher = `${DEMO}/providers/microsoft.network/networkwatchers/nw-demo`
  cards[watcher] = { ...(cards[idOf('kv-demo-suite')] as AzCard), id: watcher, name: 'nw-demo', type: 'microsoft.network/networkwatchers', autoCreated: true }
  return {
    ...demoState(),
    rules: rules({ groups: { [DEMO]: { at: NOW }, [OTHER]: { at: NOW } }, excludes: { [EXCLUDED]: { at: NOW } } }),
    cache: cache({ resources: cards, groups: { [DEMO]: { name: 'rg-demo-suite' }, [OTHER]: { name: 'rg-demo-suite-data' } } }),
    autoAdded: { groupId: DEMO, count: 13 },
    suggestions: [{ id: SUGGESTED, kind: 'group', origin: 'scan', reason: 'similar-group', name: 'rg-demo-suite-old', count: 1 }],
    health: { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'broken' },
  }
}

/** Records every write of the pane's `ui` atom. */
const watchUi = (on: On): AzUi[] => {
  const writes: AzUi[] = []
  on('state.set', ($, e, next) => {
    const change = e as unknown as { plugin: string; key: string; value: { value: AzUi } }
    if (change.plugin === 'az-mod' && change.key === 'ui') writes.push(change.value.value)
    return next(e)
  })
  return writes
}

/** What each key must ask Raccolta for (null: a pane-only key). */
const EXPECTED: Record<string, ReturnType<typeof parseKey>> = {
  'update': { action: 'update' },
  'scan': { action: 'scan' },
  'undo-auto': { action: 'undo-auto' },
  'reset-rules': { action: 'reset-rules' },
  'refresh-cost': { action: 'refresh-cost' },
  [`accept-${SUGGESTED}`]: { action: 'accept', arg: SUGGESTED },
  [`dismiss-${SUGGESTED}`]: { action: 'dismiss', arg: SUGGESTED },
  [`remove-group-${OTHER}`]: { action: 'remove-group', arg: OTHER },
  [`remove-group-${DEMO}`]: { action: 'remove-group', arg: DEMO },
  [`refresh-${idOf('app-control')}`]: { action: 'refresh', arg: idOf('app-control') },
  [`exclude-${idOf('app-control')}`]: { action: 'exclude', arg: idOf('app-control') },
  // app-flow is failed, so its row is open by itself and draws its buttons too
  [`refresh-${idOf('app-flow')}`]: { action: 'refresh', arg: idOf('app-flow') },
  [`exclude-${idOf('app-flow')}`]: { action: 'exclude', arg: idOf('app-flow') },
  [`copy-${idOf('app-flow')}`]: null,
  [`restore-${EXCLUDED}`]: { action: 'restore', arg: EXCLUDED },
  [`add-${FOUND_ID}`]: { action: 'add', arg: FOUND_ID },
  [`add-group-${SUGGESTED}`]: { action: 'add-group', arg: SUGGESTED },
  ...Object.fromEntries(DEMO_SUITE_ROWS.filter(r => r.id !== EXCLUDED).map(r => [`open-${r.id}`, { action: 'open', arg: r.id }])),
  'toggle-add': null, 'show-hidden': null, 'show-auto': null, 'close-picker': null, [`copy-${idOf('app-control')}`]: null,
}

test('every drawn key asks Raccolta for the right action', async ($, on) => {
  seed(on, { ...richState(), found: FOUND, ui: { lastInputAt: 0, openCard: idOf('app-control'), closed: [], showAuto: false, showHidden: true, isAdding: true } })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const buttons = await ui.findAll({ type: 'Button' })
    const drawn = buttons.map(b => b.key as string)
    expect(Object.keys(EXPECTED).filter(k => !drawn.includes(k))).toEqual([]) // every key is drawn
    for (const key of drawn) {
      expect([key, parseKey(key)]).toEqual([key, key in EXPECTED ? EXPECTED[key] : 'a key the test does not know'])
    }
    expect((await ui.find({ key: 'add-search' }))?.type).toBe('Input')
    await ui.unmount()
  }
})

test('a row opens with its details and closes', async ($, on) => {
  seed(on, demoState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: `open-${idOf('app-control')}` })
  expect(writes.at(-1)?.openCard).toBe(idOf('app-control'))
  expect((await ui.find({ key: `open-${idOf('app-control')}` }))?.text).toBe('▾ app-control')
  expect(await ui.find({ text: /Apri nel portale/ })).toBeDefined()
  for (const key of [`copy-${idOf('app-control')}`, `refresh-${idOf('app-control')}`, `exclude-${idOf('app-control')}`]) {
    expect(await ui.find({ key })).toBeDefined()
  }

  await ui.press({ key: `open-${idOf('app-control')}` })
  expect(writes.at(-1)?.openCard).toBeNull()
  // app-control's details are gone (app-flow, failed, keeps its own open)
  expect((await ui.find({ key: `open-${idOf('app-control')}` }))?.text).toBe('▸ app-control')
  expect(await ui.find({ key: `refresh-${idOf('app-control')}` })).toBeUndefined()
  await ui.unmount()
})

test('a failed row opens by itself, and stays closed once closed', async ($, on) => {
  seed(on, demoState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // app-flow is failed: open without a press, an ok row stays closed
  expect((await ui.find({ key: `open-${idOf('app-flow')}` }))?.text).toBe('▾ app-flow')
  expect((await ui.find({ key: `open-${idOf('app-control')}` }))?.text).toBe('▸ app-control')
  expect(await ui.find({ key: `refresh-${idOf('app-flow')}` })).toBeDefined()

  await ui.press({ key: `open-${idOf('app-flow')}` })
  expect(writes.at(-1)?.closed).toContain(idOf('app-flow'))
  expect((await ui.find({ key: `open-${idOf('app-flow')}` }))?.text).toBe('▸ app-flow')

  await ui.press({ key: `open-${idOf('app-flow')}` })
  expect(writes.at(-1)?.closed).not.toContain(idOf('app-flow'))
  expect((await ui.find({ key: `open-${idOf('app-flow')}` }))?.text).toBe('▾ app-flow')
  await ui.unmount()
})

test('toggles show hidden and Azure-created resources', async ($, on) => {
  seed(on, richState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: `open-${DEMO}/providers/microsoft.network/networkwatchers/nw-demo` })).toBeUndefined()

  await ui.press({ key: 'show-auto' })
  expect(writes.at(-1)?.showAuto).toBe(true)
  expect(await ui.find({ key: `open-${DEMO}/providers/microsoft.network/networkwatchers/nw-demo` })).toBeDefined()

  await ui.press({ key: 'show-hidden' })
  expect(writes.at(-1)?.showHidden).toBe(true)
  expect(await ui.find({ key: `restore-${EXCLUDED}` })).toBeDefined()
  await ui.unmount()
})

test('the add picker opens, searches and closes', async ($, on) => {
  seed(on, demoState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'toggle-add' })
  expect(writes.at(-1)?.isAdding).toBe(true)
  expect((await ui.find({ key: 'add-search' }))?.type).toBe('Input')
  await ui.input({ key: 'add-search', text: 'demo' })
  await ui.press({ key: 'close-picker' })
  expect(writes.at(-1)?.isAdding).toBe(false)
  expect(await ui.find({ key: 'add-search' })).toBeUndefined()
  await ui.unmount()
})

test('every press updates lastInputAt', async ($, on) => {
  seed(on, richState())
  const writes = watchUi(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'show-hidden' }) // shows the restore buttons
  await ui.press({ key: `open-${idOf('app-control')}` }) // shows the row's buttons
  for (const key of ['update', 'scan', 'undo-auto', 'reset-rules', `accept-${SUGGESTED}`, `dismiss-${SUGGESTED}`,
    `remove-group-${OTHER}`, `restore-${EXCLUDED}`, `copy-${idOf('app-control')}`, `refresh-${idOf('app-control')}`, `exclude-${idOf('app-control')}`, 'show-auto']) {
    const before = writes.length
    await ui.press({ key })
    expect(writes.length).toBe(before + 1)
    expect(writes.at(-1)?.lastInputAt).toBe(NOW)
  }
  await ui.unmount()
})
