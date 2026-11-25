/*
 * index.ts — the hooks module of az-mod: wires Raccolta (collect/) and Pannello (pane/).
 * The two parts never call each other: the pane draws from state and its button keys,
 * Raccolta hooks ui.press / ui.input on the pane and writes state (see contract.ts).
 * The engine takes one unmatched session.start per module, so it lives here and starts
 * both parts: Raccolta first (it boots in the background), then the pane.
 */
import type { Register } from 'claude-code'

import { registerCollect, startCollect } from './collect/index'
import { registerPane, startPane } from './pane/index'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startCollect($)
    await startPane($)
    return started
  })
  registerCollect(on)
  registerPane(on)
}
