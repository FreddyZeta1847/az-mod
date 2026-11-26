/*
 * hook.ts — the hooks on Bash and PowerShell calls (any other tool passes on at once): the call runs untouched
 * (never denied, never rewritten, its output never read). `tool.run` notes when the command
 * really starts (after the permission step, so the wait for an approval is not counted);
 * afterwards `tool.call`, without holding the call, parses the command (parse-az.ts keeps only
 * clean tokens, never the text) and actions.ts logs it, refreshes what a write changed, or
 * proposes a resource of another group. An unclear az command (chains, variables) triggers an
 * Update of the project.
 */
import type { EngineInterface, HookOf, On } from 'claude-code'

import { afterAzCommand } from './actions'
import { parseAz } from './parse-az'

type ToolHook = HookOf<'tool.call'>
type RunHook = HookOf<'tool.run'>

/** When each running shell call started, by its call id: read and forgotten when the call ends. */
const runStarts = new Map<string, number>()

const callId = (e: unknown): string => String((e as { tool_use_id?: unknown }).tool_use_id ?? '')

const isShell = (tool: string): boolean => tool === 'Bash' || tool === 'PowerShell'

async function onShellRun($: EngineInterface, e: Parameters<RunHook>[1], next: Parameters<RunHook>[2]) {
  // any other tool goes on at once: no engine call for it
  if (!isShell(e.tool)) return next(e)
  runStarts.set(callId(e), await $.clock.now())
  return next(e)
}

async function onShellCall($: EngineInterface, e: Parameters<ToolHook>[1], next: Parameters<ToolHook>[2]) {
  const ran = await next(e)
  if (!isShell(e.tool)) return ran
  const startedAt = runStarts.get(callId(e))
  runStarts.delete(callId(e))
  const command = 'command' in e && typeof e.command === 'string' ? e.command : ''
  const parsed = parseAz(command, await $.clock.now(), await $.session.id())
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
  on('tool.call', onShellCall)
  on('tool.run', onShellRun)
}
