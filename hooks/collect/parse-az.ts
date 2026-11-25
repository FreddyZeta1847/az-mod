/*
 * parse-az.ts — what the hook understands of one az command, without ever keeping its
 * text: command group, verb, name (-n/--name), resource group (-g/--resource-group) and
 * ids (--ids), each kept only when it is a clean token. A chain, a pipe, a newline, a
 * backtick or any $ makes the command 'unclear' (nothing kept); no az word gives null.
 */
import { WRITE_VERBS } from '../contract'
import type { AzEvent } from '../../types'

/** A name or group as Azure allows it, compared lowercased (Azure names are case-insensitive). */
const CLEAN = /^[a-z0-9][a-z0-9._()-]{0,89}$/
const CLEAN_ID = /^\/subscriptions\/[^\s"'`$;|&<>]+$/
const WORD = /^[a-z0-9-]+$/
const UNCLEAR = /[;|&\n\r`$]/

const unquote = (t: string): string => t.replace(/^["']|["']$/g, '')

/** Splits on blanks, keeping a quoted run as one token. */
const tokenize = (command: string): string[] => command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []

/** `--name=x` → ['--name', 'x']; other tokens as they are. */
const splitEquals = (tokens: string[]): string[] =>
  tokens.flatMap(t => (/^--?[a-z-]+=/.test(t) ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t]))

const valueAfter = (args: string[], flags: string[]): string | undefined => {
  const i = args.findIndex(a => flags.includes(a))
  const v = i < 0 ? undefined : args[i + 1]
  return v === undefined ? undefined : unquote(v)
}

const idsAfter = (args: string[]): string[] => {
  const i = args.indexOf('--ids')
  if (i < 0) return []
  const out: string[] = []
  for (const t of args.slice(i + 1)) {
    if (t.startsWith('-')) break
    out.push(unquote(t).toLowerCase())
  }
  return out.filter(id => CLEAN_ID.test(id))
}

export const parseAz = (command: string, now: number, sessionId: string): AzEvent | 'unclear' | null => {
  const tokens = tokenize(command)
  const azAt = tokens.indexOf('az')
  if (azAt < 0) return null
  if (UNCLEAR.test(command)) return 'unclear'
  const args = splitEquals(tokens.slice(azAt + 1))
  const firstFlag = args.findIndex(a => a.startsWith('-'))
  const words = firstFlag < 0 ? args : args.slice(0, firstFlag)
  // `grep -rn az hooks/`: the word az alone, no az command after it
  if (words.length === 0 || !words.every(w => WORD.test(w))) return null
  const verb = words[words.length - 1] as string
  const event: AzEvent = {
    at: now, sessionId, cmdGroup: words.slice(0, -1).join(' '), verb, isWrite: WRITE_VERBS.includes(verb), exit: 0,
  }
  const name = valueAfter(args, ['-n', '--name'])
  const group = valueAfter(args, ['-g', '--resource-group'])
  const ids = idsAfter(args)
  if (name !== undefined && CLEAN.test(name.toLowerCase())) event.name = name.toLowerCase()
  if (group !== undefined && CLEAN.test(group.toLowerCase())) event.group = group.toLowerCase()
  if (ids.length > 0) event.ids = ids
  return event
}
