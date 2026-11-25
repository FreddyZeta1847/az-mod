/*
 * collect/index.ts — entry of Raccolta: registerCollect(on) wires the az hook, the
 * scanner, the Azure reader and the refresh loop; collectActions implements AzActions.
 * STUB written by the main session: the Raccolta child replaces it (tasks C–F).
 */
import type { On } from 'claude-code'

import type { AzActions } from '../contract'

export const registerCollect = (_on: On): void => {}

const noop = async (): Promise<void> => {}

export const collectActions: AzActions = {
  scan: noop, update: noop, refreshOne: noop, refreshCost: noop, openCard: noop,
  include: noop, exclude: noop, restore: noop, addGroup: noop, removeGroup: noop,
  accept: noop, dismiss: noop, resetRules: noop,
  search: async () => [],
}
