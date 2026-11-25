/*
 * keys.test.ts — tests of Raccolta's ui.press / ui.input wiring on the real az-mod pane:
 * a press of a contract key reaches the matching action, typing in the search Input
 * fills the `found` state. They need Pannello's pane, so they stay red on the Raccolta
 * branch alone and turn green once the two parts are merged (like the pane acceptance
 * tests). The whole mod runs over world.ts.
 */
import { expect, test } from 'claude-code/testing'

import { startWorld } from './world'

const PANE = {
  plugin: 'az-mod', component: 'Pane', requestId: 'az-mod', surface: 'desktop',
  props: { title: 'Azure', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('pressing scan in the pane re-reads the resource list', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  const ui = await $.ui.mount(PANE)
  w.runs.length = 0
  await ui.press({ key: 'scan' })
  await w.waitFor(() => w.runs.some(a => a[1] === 'resource' && a[2] === 'list'))
  await ui.unmount()
})

test('typing in the search fills found', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'toggle-add' })
  await ui.input({ key: 'add-search', text: 'task', kind: 'change' })
  await w.waitFor(() => (w.seen.found ?? []).length > 0)
  expect((w.seen.found ?? []).some(s => s.name === 'tasklist')).toBe(true)
  await ui.unmount()
})
