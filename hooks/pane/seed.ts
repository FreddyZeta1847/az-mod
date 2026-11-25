/*
 * pane/seed.ts — test helpers of Pannello (used only by the pane's *.test.tsx): the
 * mounted Pane request, invented demo-suite state built from fixtures/azure.ts, a
 * `state.get` seed that answers Raccolta's keys, and a fake AzActions that records
 * every call instead of touching Azure. The pane itself never imports this file.
 */
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

import type { AzActions } from '../contract'
import { DEMO_SUITE_ROWS, gid, SUB } from '../fixtures/azure'
import type { AzCache, AzCard, AzProject, AzRules, AzSuggestion } from '../../types'

export const NOW = 1_764_000_000_000
export const ROOT = '/work/demo-suite'
export const DEMO = gid('rg-demo-suite')
export const idOf = (name: string): string => DEMO_SUITE_ROWS.find(r => r.name === name)?.id as string

export const PANE = {
  plugin: 'az-mod',
  component: 'Pane',
  requestId: 'az-mod',
  props: { title: 'Azure', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

export const demoCards = (): Record<string, AzCard> => Object.fromEntries(DEMO_SUITE_ROWS.map(r => [r.id, {
  id: r.id, name: r.name, type: r.type, group: r.resourceGroup, location: r.location,
  status: r.name === 'app-flow' ? 'failed' : 'ok', autoCreated: false, via: 'group',
  facts: r.sku === null ? {} : { sku: r.sku }, uses: [], warnings: [], stateAt: NOW - 30_000,
} satisfies AzCard]))

export const project: AzProject = { key: 'demo-suite', mainRoot: ROOT, remote: null }
export const rules = (over: Partial<AzRules> = {}): AzRules => ({
  schemaVersion: 1, project, groups: { [DEMO]: { at: NOW - 60_000 } }, includes: {}, excludes: {}, dismissed: {}, updatedAt: NOW - 60_000, ...over,
})
export const cache = (over: Partial<AzCache> = {}): AzCache => ({
  schemaVersion: 1, projectKey: 'demo-suite', subscription: SUB, stateAt: NOW - 30_000,
  groups: { [DEMO]: { name: 'rg-demo-suite' } }, resources: demoCards(), activity: [], errors: {}, ...over,
})

/**
 * Answers `state.get` for az-mod keys from `values` (or what the function returns now);
 * keys absent there go to the engine (the pane's own `ui`). One call per test: a hook registers once.
 */
export const seed = (on: On, values: Record<string, unknown> | (() => Record<string, unknown>)): void => {
  mock.clock(on, { now: NOW })
  on('state.get', ($, e, next) => {
    const all = typeof values === 'function' ? values() : values
    const value = e.plugin === 'az-mod' && e.key in all ? all[e.key] : undefined
    return value === undefined ? next(e) : { value: { value: { shape: `${e.key}-1`, value }, version: 1 } }
  })
}

export const demoState = (): Record<string, unknown> => ({ project, rules: rules(), cache: cache() })

export type Call = [keyof AzActions, unknown?]
/** A Raccolta that only records: every action resolves at once; search answers `found`. */
export const recorder = (found: AzSuggestion[] = []): { actions: AzActions; calls: Call[] } => {
  const calls: Call[] = []
  const rec = (name: keyof AzActions) => async (_$: unknown, arg?: unknown): Promise<void> => { calls.push(arg === undefined ? [name] : [name, arg]) }
  const actions: AzActions = {
    scan: rec('scan'), update: rec('update'), refreshOne: rec('refreshOne'), refreshCost: rec('refreshCost'),
    openCard: rec('openCard'), include: rec('include'), exclude: rec('exclude'), restore: rec('restore'),
    addGroup: rec('addGroup'), removeGroup: rec('removeGroup'), accept: rec('accept'), dismiss: rec('dismiss'),
    resetRules: rec('resetRules'),
    search: async (_$, text) => { calls.push(['search', text]); return found },
  }
  return { actions, calls }
}
