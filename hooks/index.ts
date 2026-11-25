/*
 * index.ts — the hooks module of az-mod: wires Raccolta (collect/) and Pannello (pane/).
 * The two parts never call each other: the pane draws from state and its button keys,
 * Raccolta hooks ui.press / ui.input on the pane and writes state (see contract.ts).
 */
import type { Register } from 'claude-code'

import { registerCollect } from './collect/index'
import { registerPane } from './pane/index'

export const register: Register = on => {
  registerCollect(on)
  registerPane(on)
}
