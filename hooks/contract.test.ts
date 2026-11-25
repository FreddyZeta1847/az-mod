/*
 * contract.test.ts — tests of the shared helpers in contract.ts: name normalization,
 * group id of a resource, "hidden" and "done by Claude". Pure functions, no engine mocks.
 */
import { expect, test } from 'claude-code/testing'

import { expectedGroup, groupIdOf, isByClaude, isHidden, normalizeName } from './contract'
import type { AzActivity, AzCard, AzEvent, AzRules } from '../types'

const SUB = '/subscriptions/00000000-0000-0000-0000-000000000000'
const ID_A = `${SUB}/resourcegroups/rg-demo-suite/providers/microsoft.app/containerapps/app-control`
const ID_B = `${SUB}/resourcegroups/rg-demo-suite/providers/microsoft.app/containerapps/app-flow`

const card = (over: Partial<AzCard> = {}): AzCard => ({
  id: ID_A, name: 'app-control', type: 'microsoft.app/containerapps', group: 'rg-demo-suite', location: 'westeurope',
  status: 'ok', autoCreated: false, via: 'group', facts: {}, uses: [], warnings: [], stateAt: 0, ...over,
})
const rules = (over: Partial<AzRules> = {}): AzRules => ({
  schemaVersion: 1, project: { key: 'demo-suite', mainRoot: '/work/demo-suite', remote: null },
  groups: {}, includes: {}, excludes: {}, dismissed: {}, updatedAt: 0, ...over,
})
const event = (at: number, ids: string[]): AzEvent => ({
  at, sessionId: 's1', cmdGroup: 'containerapp', verb: 'update', isWrite: true, ids, exit: 0,
})

test('normalizeName makes folder and group names comparable', async () => {
  expect(normalizeName("L'Atelier")).toBe('l-atelier')
  expect(normalizeName('Green House')).toBe('green-house')
  expect(normalizeName('--a__b--')).toBe('a-b')
  expect(normalizeName('rg_SomeProj')).toBe('rg-someproj')
  expect(normalizeName('demo-two')).toBe('demo-two')
  expect(expectedGroup('l-atelier')).toBe('rg-l-atelier')
})

test('groupIdOf cuts a resource id at its group', async () => {
  expect(groupIdOf(`${SUB}/resourcegroups/rg-x/providers/microsoft.web/sites/a`)).toBe(`${SUB}/resourcegroups/rg-x`)
  expect(groupIdOf(`${SUB}/resourceGroups/RG-X/providers/Microsoft.Web/sites/A`)).toBe(`${SUB}/resourcegroups/rg-x`)
})

test('isHidden: excluded or auto-created cards are hidden', async () => {
  expect(isHidden(card(), rules(), false)).toBe(false)
  expect(isHidden(card(), rules({ excludes: { [ID_A]: { at: 1 } } }), false)).toBe(true)
  expect(isHidden(card({ autoCreated: true }), rules(), false)).toBe(true)
  expect(isHidden(card({ autoCreated: true }), rules(), true)).toBe(false)
})

test('isByClaude matches an activity to a recent hook event on the same resource', async () => {
  const activity: AzActivity = { at: 200_000, op: 'update', status: 'Succeeded', resourceId: ID_A }
  expect(isByClaude(activity, [event(140_000, [ID_A])])).toBe(true)
  expect(isByClaude(activity, [event(20_000, [ID_A])])).toBe(false)
  expect(isByClaude(activity, [event(140_000, [ID_B])])).toBe(false)
})
