/*
 * pane/index.tsx — entry of Pannello: startPane($), called by hooks/index.ts at session
 * start, registers /az and opens the «Azure» pane; registerPane(on) answers /az and draws
 * the dashboard (dashboard.tsx) from state. Buttons carry
 * the contract's keys (contract.ts keyFor); their onPress only updates the `ui` atom:
 * Raccolta hears the presses itself. The pane never imports collect/.
 */
import type { EngineInterface, On } from 'claude-code'

import { PANE, PANE_TITLE } from '../contract'
import { drawDashboard } from './dashboard'

/** Called by hooks/index.ts at session start (one session.start per module): registers /az and opens the pane. */
export async function startPane($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'az', description: 'Mostra le risorse Azure del progetto in un pannello' })
  void $.ui.open({ id: PANE, title: PANE_TITLE })
}

export const registerPane = (on: On): void => {
  on('command.run', { command: 'az' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: 'Pannello Azure aperto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawDashboard($, e))
}
