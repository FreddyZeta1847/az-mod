/*
 * pane/firstuse.test.tsx — regression tests of the pane for what the first-use test on
 * real Azure showed («Raccolta e pannello», 2026-11-25), numbered with the collect side's
 * u… tests: u6, one resource is «1 risorsa», never «1 risorse».
 */
import { expect, test } from 'claude-code/testing'

import { cache, DEMO, demoCards, demoState, idOf, PANE, seed } from './seed'
import type { AzCard } from '../../types'

test('u6 one resource is written in the singular', async ($, on) => {
  const one = idOf('app-control')
  seed(on, { ...demoState(), cache: cache({ resources: { [one]: demoCards()[one] as AzCard } }), autoAdded: { groupId: DEMO, count: 1 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^1 risorsa · aggiornato/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(1 risorsa\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 risorse/ })).toBeUndefined()
  await ui.unmount()
})
