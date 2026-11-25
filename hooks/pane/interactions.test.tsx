/*
 * pane/interactions.test.tsx — tests of the az-mod pane's presses (task H1): every key
 * fixed in plan H1 is drawn; opening and closing a row writes `ui.openCard`; the toggles
 * flip their `ui` flag; every press stamps `ui.lastInputAt`; the «+ Aggiungi» picker opens,
 * takes a search and closes. Raccolta's side of each press is not here: the contract for it
 * is under review (the engine refuses `$` passed to an AzActions method).
 */
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { AzUi } from '../../types'
import { DEMO_SUITE_ROWS, gid } from '../fixtures/azure'
import { cache, DEMO, demoCards, demoState, idOf, NOW, PANE, rules, seed } from './seed'

const OTHER = gid('rg-demo-suite-data')
const SUGGESTED = gid('rg-demo-suite-old')
const EXCLUDED = idOf('log-demo-suite')

/** A state where every button of the pane is drawn. */
const richState = (): Record<string, unknown> => {
  const cards = demoCards()
  const watcher = `${DEMO}/providers/microsoft.network/networkwatchers/nw-demo`
  cards[watcher] = { ...(cards[idOf('kv-demo-suite')] as never), id: watcher, name: 'nw-demo', type: 'microsoft.network/networkwatchers', autoCreated: true }
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

test('every key of plan H1 is drawn', async ($, on) => {
  seed(on, richState())
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const missing: string[] = []
    for (const key of ['update', 'scan', 'add', 'undo-auto', 'reset-rules', `accept-${SUGGESTED}`, `dismiss-${SUGGESTED}`,
      `remove-${OTHER}`, 'hidden', 'show-auto', ...DEMO_SUITE_ROWS.filter(r => r.id !== EXCLUDED).map(r => `open-${r.name}`)]) {
      if ((await ui.find({ key }))?.type !== 'Button') missing.push(`${surface}:${key}`)
    }
    expect(missing).toEqual([])
    await ui.unmount()
  }
})

test('a row opens with its details and closes', async ($, on) => {
  seed(on, demoState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'open-app-control' })
  expect(writes.at(-1)?.openCard).toBe(idOf('app-control'))
  expect((await ui.find({ key: 'open-app-control' }))?.text).toBe('▾ app-control')
  expect(await ui.find({ text: /Apri nel portale/ })).toBeDefined()
  for (const key of ['copy-app-control', 'refresh-app-control', `exclude-${idOf('app-control')}`]) {
    expect(await ui.find({ key })).toBeDefined()
  }

  await ui.press({ key: 'open-app-control' })
  expect(writes.at(-1)?.openCard).toBeNull()
  expect(await ui.find({ text: /Apri nel portale/ })).toBeUndefined()
  await ui.unmount()
})

test('toggles show hidden and Azure-created resources', async ($, on) => {
  seed(on, richState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'open-nw-demo' })).toBeUndefined()

  await ui.press({ key: 'show-auto' })
  expect(writes.at(-1)?.showAuto).toBe(true)
  expect(await ui.find({ key: 'open-nw-demo' })).toBeDefined()

  await ui.press({ key: 'hidden' })
  expect(writes.at(-1)?.showHidden).toBe(true)
  expect(await ui.find({ key: `restore-${EXCLUDED}` })).toBeDefined()
  await ui.unmount()
})

test('the add picker opens, searches and closes', async ($, on) => {
  seed(on, demoState())
  const writes = watchUi(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'add' })
  expect(writes.at(-1)?.isAdding).toBe(true)
  expect((await ui.find({ key: 'add-search' }))?.type).toBe('Input')
  await ui.input({ key: 'add-search', text: 'demo' })
  await ui.press({ key: 'add-close' })
  expect(writes.at(-1)?.isAdding).toBe(false)
  expect(await ui.find({ key: 'add-search' })).toBeUndefined()
  await ui.unmount()
})

test('every press updates lastInputAt', async ($, on) => {
  seed(on, richState())
  const writes = watchUi(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'hidden' }) // shows the restore buttons
  await ui.press({ key: 'open-app-control' }) // shows the row's buttons
  for (const key of ['update', 'scan', 'undo-auto', 'reset-rules', `accept-${SUGGESTED}`, `dismiss-${SUGGESTED}`,
    `remove-${OTHER}`, `restore-${EXCLUDED}`, 'copy-app-control', 'refresh-app-control', `exclude-${idOf('app-control')}`, 'show-auto']) {
    const before = writes.length
    await ui.press({ key })
    expect(writes.length).toBe(before + 1)
    expect(writes.at(-1)?.lastInputAt).toBe(NOW)
  }
  await ui.unmount()
})
