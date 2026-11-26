/*
 * hook.ts — the hooks on Bash and PowerShell calls only (a hook that may match a tool turns
 * off its move to the background and its live output, so no other tool is matched): the call
 * runs untouched (never denied, never rewritten, its output never read). `tool.run` notes when
 * the command really starts (after the permission step, so the wait for an approval is not
 * counted); afterwards `tool.call`, without holding the call, parses the command (parse-az.ts
 * keeps only clean tokens, never the text) and actions.ts logs it, refreshes what a write
 * changed, or proposes a resource of another group. An unclear az command (chains, variables)
 * triggers an Update of the project.
 */
import type { EngineInterface, MatchedHook, On } from 'claude-code'

import { afterAzCommand } from './actions'
import { parseAz } from './parse-az'

const SHELLS = { tool: ['Bash', 'PowerShell'] } as const
type CallHook = MatchedHook<'tool.call', typeof SHELLS>
type RunHook = MatchedHook<'tool.run', typeof SHELLS>

/** When each running shell call started, by its call id: read and forgotten when the call ends. */
const runStarts = new Map<string, number>()

async function onShellRun($: EngineInterface, e: Parameters<RunHook>[1], next: Parameters<RunHook>[2]) {
  runStarts.set(e.tool_use_id, await $.clock.now())
  return next(e)
}

async function onShellCall($: EngineInterface, e: Parameters<CallHook>[1], next: Parameters<CallHook>[2]) {
  const ran = await next(e)
  const startedAt = runStarts.get(e.tool_use_id)
  runStarts.delete(e.tool_use_id)
  const parsed = parseAz(typeof e.command === 'string' ? e.command : '', await $.clock.now(), await $.session.id())
  if (parsed !== null) {
    if (parsed !== 'unclear') {
      parsed.exit = ran.deny === undefined && ran.isError !== true ? 0 : 1
      if (startedAt !== undefined) parsed.startedAt = startedAt
    }
    void afterAzCommand($, parsed)
  }
  return ran
}

export const registerHook = (on: On): void => {
  on('tool.call', SHELLS, onShellCall)
  on('tool.run', SHELLS, onShellRun)
}
