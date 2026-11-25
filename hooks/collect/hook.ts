/*
 * hook.ts — the tool.call hook on Bash and PowerShell: the call runs untouched (never
 * denied, never rewritten, its output never read); afterwards, without holding the call,
 * the command is parsed (parse-az.ts keeps only clean tokens, never the text) and
 * actions.ts logs it, refreshes what a write changed, or proposes a resource of another
 * group. An unclear az command (chains, variables) triggers an Update of the project.
 */
import type { EngineInterface, HookOf, On } from 'claude-code'

import { afterAzCommand } from './actions'
import { parseAz } from './parse-az'

type ToolHook = HookOf<'tool.call'>

async function onShellCall($: EngineInterface, e: Parameters<ToolHook>[1], next: Parameters<ToolHook>[2]) {
  const ran = await next(e)
  if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return ran
  const command = 'command' in e && typeof e.command === 'string' ? e.command : ''
  const parsed = parseAz(command, await $.clock.now(), await $.session.id())
  if (parsed !== null) {
    if (parsed !== 'unclear') parsed.exit = ran.deny === undefined && ran.isError !== true ? 0 : 1
    void afterAzCommand($, parsed)
  }
  return ran
}

export const registerHook = (on: On): void => {
  on('tool.call', onShellCall)
}
