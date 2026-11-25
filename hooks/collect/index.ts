/*
 * collect/index.ts — entry of Raccolta: startCollect($), called by hooks/index.ts at session
 * start, boots the project (identity, saved rules and photo, Scan on a first open, the
 * refresh timer); registerCollect(on) hooks Claude's az commands and listens to its own
 * pane: a press of a contract key
 * (contract.ts parseKey) runs the matching action, typing in SEARCH_INPUT fills `found`.
 * The pane's own handlers run first (next), then Raccolta acts without holding the press.
 */
import type { EngineInterface, HookOf, On } from 'claude-code'

import { boot, onPaneKey, search } from './actions'
import { registerHook } from './hook'
import { PANE, PLUGIN, SEARCH_INPUT } from '../contract'

type Press = HookOf<'ui.press'>
type Input = HookOf<'ui.input'>

/** Called by hooks/index.ts at session start (one session.start per module): boots without holding the start. */
export async function startCollect($: EngineInterface): Promise<void> {
  void boot($)
}

async function onPanePress($: EngineInterface, e: Parameters<Press>[1], next: Parameters<Press>[2]) {
  const r = await next(e)
  if (e.plugin === PLUGIN) void onPaneKey($, e.element)
  return r
}

async function onPaneInput($: EngineInterface, e: Parameters<Input>[1], next: Parameters<Input>[2]) {
  const r = await next(e)
  if (e.plugin === PLUGIN && e.element === SEARCH_INPUT) void search($, e.value)
  return r
}

export const registerCollect = (on: On): void => {
  registerHook(on)
  on('ui.press', { component: 'Pane', requestId: PANE }, onPanePress)
  on('ui.input', { component: 'Pane', requestId: PANE }, onPaneInput)
}
