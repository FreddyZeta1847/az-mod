/*
 * pane/dashboard.test.tsx — tests of the az-mod pane drawing (tasks G1, G2): the SVG
 * builders stay plain images with a size; the demo project, an empty project, an expired
 * login, stale data and the terminal draw what they should; and every seeded state draws
 * on desktop and terminal without the surface refusing the tree.
 */
import { expect, test } from 'claude-code/testing'

import { DEMO_SUITE_ROWS } from '../fixtures/azure'
import { cache, DEMO, demoState, NOW, PANE, rules, seed } from './seed'
import { dot, statusDonut, typeIcon } from './svg'

const SURFACES = ['desktop', 'terminal'] as const

test('every svg has width and height and no script', async ($, on) => {
  const sources = [dot('ok'), dot('failed', 8), typeIcon('ca', '#4cc9f0', 16),
    statusDonut({ ok: 12, busy: 0, failed: 1, stopped: 0, unknown: 0 }, 132),
    statusDonut({ ok: 0, busy: 0, failed: 0, stopped: 0, unknown: 0 }, 132)]
  for (const s of sources) {
    expect(/^<svg [^>]*width="\d+" height="\d+"/.test(s)).toBe(true)
    expect(/<script|<style|<title|on[a-z]+=/i.test(s)).toBe(false)
  }

  seed(on, demoState())
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBeGreaterThan(13)
  for (const s of svgs) {
    expect(typeof s.props.width).toBe('number')
    expect(typeof s.props.height).toBe('number')
    expect(s.props.isInteractive).toBeUndefined()
  }
  await ui.unmount()
})

test('demo suite drawn', async ($, on) => {
  seed(on, demoState())
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^demo-suite$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rg-demo-suite · Demo/ })).toBeDefined()
  for (const r of DEMO_SUITE_ROWS) expect(await ui.find({ key: `open-${r.name}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Container Apps$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /13 risorse · aggiornato 30 s fa/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Piano: Basic$/ })).toBeDefined() // acrdemosuite's key fact
  expect(await ui.find({ key: 'update' })).toBeDefined()
  expect(await ui.find({ key: 'scan' })).toBeDefined()
  await ui.unmount()
})

test('empty project', async ($, on) => {
  seed(on, { ...demoState(), rules: rules({ groups: {} }), cache: cache({ groups: {}, resources: {} }) })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Nessun gruppo rg-demo-suite in Demo/ })).toBeDefined()
    expect(await ui.find({ key: 'add' })).toBeDefined()
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('login expired banner', async ($, on) => {
  seed(on, { ...demoState(), health: { az: 'login', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'ok' } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /az login/ })).toBeDefined()
  // the snapshot stays visible under the banner
  expect(await ui.find({ key: 'open-app-control' })).toBeDefined()
  await ui.unmount()
})

test('stale data label', async ($, on) => {
  seed(on, { ...demoState(), cache: cache({ stateAt: NOW - 15 * 60_000 }) })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /non aggiornati da 15 min/ })).toBeDefined()
  await ui.unmount()
})

test('terminal has no Svg', async ($, on) => {
  seed(on, demoState())
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^demo-suite$/ })).toBeDefined()
  for (const r of DEMO_SUITE_ROWS) expect(await ui.find({ key: `open-${r.name}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Attiva$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Problema$/ })).toBeDefined()
  await ui.unmount()
})

const STATES: Record<string, Record<string, unknown>> = {
  nothing: {},
  demo: demoState(),
  empty: { ...demoState(), cache: cache({ groups: {}, resources: {} }) },
  missing: { ...demoState(), health: { az: 'missing', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'ok' } },
  broken: { ...demoState(), health: { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'broken' } },
  readOnly: { ...demoState(), health: { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'read-only' } },
  conflict: { ...demoState(), project: { key: 'demo-suite-a1b2c3', mainRoot: '/work/demo-suite', remote: null, conflict: 'other-repo' } },
  adopted: { ...demoState(), autoAdded: { groupId: DEMO, count: 13 } },
  suggested: { ...demoState(), suggestions: [{ id: '/subscriptions/x/resourcegroups/rg-demo-suite-old', kind: 'group', origin: 'scan', reason: 'similar-group', name: 'rg-demo-suite-old', count: 1 }] },
  busy: { ...demoState(), busy: { scan: true, update: true, cost: false, ids: [] } },
  hidden: { ...demoState(), rules: rules({ excludes: { [DEMO_SUITE_ROWS[0]?.id as string]: { at: NOW } } }) },
  failedRead: { ...demoState(), cache: cache({ errors: { state: { at: NOW, code: 'network', message: 'rete non raggiungibile' } } }) },
}

test('validate passes on every state', async ($, on) => {
  let current: Record<string, unknown> = {}
  seed(on, () => current)
  for (const [name, state] of Object.entries(STATES)) {
    current = state
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const drawn = await ui.drawn().catch((err: unknown) => `${name}/${surface}: ${String(err)}`)
      expect(typeof drawn === 'string' ? drawn : 'ok').toBe('ok')
      await ui.unmount()
    }
  }
})
