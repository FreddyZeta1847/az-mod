/*
 * pane/index.tsx — entry of Pannello: registerPane(on) registers /az, opens the «Azure»
 * pane at session start and draws the dashboard (dashboard.tsx) from state. Buttons carry
 * the contract's keys (contract.ts keyFor); their onPress only updates the `ui` atom:
 * Raccolta hears the presses itself. The pane never imports collect/.
 */
import type { On } from 'claude-code'

import { PANE, PANE_TITLE } from '../contract'
import { drawDashboard } from './dashboard'

export const registerPane = (on: On): void => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'az', description: 'Mostra le risorse Azure del progetto in un pannello' })
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    return started
  })

  on('command.run', { command: 'az' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: 'Pannello Azure aperto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawDashboard($, e))
}
