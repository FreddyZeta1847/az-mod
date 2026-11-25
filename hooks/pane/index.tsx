/*
 * pane/index.tsx — entry of Pannello: registerPane(on, actions) registers /az, opens the
 * «Azure» pane at session start and draws the dashboard (dashboard.tsx) from state,
 * calling only the AzActions it is given; it never imports collect/.
 */
import type { On } from 'claude-code'

import { PANE, PANE_TITLE, type AzActions } from '../contract'
import { drawDashboard } from './dashboard'

// `_actions` stays for the contract's signature: presses reach Raccolta by Button key (see interactions.tsx).
export const registerPane = (on: On, _actions: AzActions): void => {
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
