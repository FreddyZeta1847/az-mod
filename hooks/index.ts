/*
 * index.ts — the hooks module of az-mod: wires Raccolta (collect/) and Pannello (pane/).
 * The pane receives Raccolta's actions here and never imports collect/ itself.
 */
import type { Register } from 'claude-code'

import { collectActions, registerCollect } from './collect/index'
import { registerPane } from './pane/index'

export const register: Register = on => {
  registerCollect(on)
  registerPane(on, collectActions)
}
