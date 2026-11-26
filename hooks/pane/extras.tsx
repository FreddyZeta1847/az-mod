/*
 * pane/extras.tsx — the cruscotto's boxes for costs, warnings and activities (direction C,
 * «Costi, attività e avvisi»): the month's cost with last month and the bar by type plus the
 * «Aggiorna costi» button, «Da guardare» (only when it has rows), and «Attività recenti» with
 * «da Claude». Plain builders like `picker`: dashboard.tsx resolves the elements and places
 * them; each returns null when it has nothing to say. On the terminal (no Svg) the same
 * information is text. The cost of one row is `rowCost`.
 */
import type { Elements } from 'claude-code'

import type { AzCache, AzCard, AzEvent, AzStatus, Ms } from '../../types'

import { isByClaude, keyFor, watchList } from '../contract'
import type { Handlers } from './interactions'
import { costBar, dot } from './svg'
import { C, STATUS, activityText, ago, money, nameFromId, typeStyle, WARNING_TEXT } from './theme'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type SvgEl = Elements['desktop']['Svg'] | undefined

const ACTIVITY_SHOWN = 8
const BAR_WIDTH = 300

const mark = (Text: Els['Text'], Svg: SvgEl, s: AzStatus, size = 8) => (Svg
  ? <Svg source={dot(s, size)} alt={STATUS[s].label} width={size} height={size} />
  : <Text color={STATUS[s].color}>●</Text>)

/** The month's cost by type of the cards given, most expensive first. */
const costByType = (cards: AzCard[]): { label: string; color: string; value: number }[] => {
  const by = new Map<string, { label: string; color: string; value: number }>()
  for (const c of cards) {
    const t = typeStyle(c.type)
    const old = by.get(t.label) ?? { label: t.label, color: t.color, value: 0 }
    by.set(t.label, { ...old, value: old.value + (c.cost?.month ?? 0) })
  }
  return [...by.values()].filter(x => x.value > 0).sort((a, b) => b.value - a.value)
}

/** This month and last month of the cards shown (taken-out and hidden resources are not the project's cost). */
const totalOf = (cards: AzCard[]): { month: number; prevMonth: number | null } => {
  const withPrev = cards.filter(c => c.cost?.prevMonth != null)
  return {
    month: cards.reduce((s, c) => s + (c.cost?.month ?? 0), 0),
    prevMonth: withPrev.length === 0 ? null : withPrev.reduce((s, c) => s + (c.cost?.prevMonth ?? 0), 0),
  }
}

export const costBox = ({ Box, Text, Button }: Els, Svg: SvgEl, act: Handlers, cache: AzCache, cards: AzCard[], isBusy: boolean, now: Ms) => {
  const cost = cache.cost
  const parts = costByType(cards)
  const total = totalOf(cards)
  const error = cache.errors.cost
  const when = cache.costAt === undefined ? 'costi mai letti' : `costi aggiornati ${ago(now, cache.costAt)}`
  return (
    <Box key="costs" flexDirection="column" gap={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
      {cost === undefined
        ? <Text bold color={C.text}>Costo del mese: non ancora letto</Text>
        : (
          // the month so far beside the whole of last month: no percentage, which would read as a saving on the 5th
          <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Text bold color={C.text}>Costo del mese {money(total.month, cost.currency)}</Text>
            <Text color={C.faint}>{total.prevMonth === null ? 'mese scorso: nessun costo' : `mese scorso ${money(total.prevMonth, cost.currency)}`}</Text>
          </Box>
        )}
      {cost !== undefined && Svg ? <Svg source={costBar(parts, BAR_WIDTH, 14)} alt="Costo del mese per tipo di risorsa" width={BAR_WIDTH} height={14} /> : null}
      {cost === undefined ? null : (
        <Box flexDirection={Svg ? 'row' : 'column'} flexWrap="wrap" gap={Svg ? 1 : 0}>
          {parts.map(p => (
            <Box key={`cost-${p.label}`} flexDirection="row" gap={1}>
              <Text color={p.color}>{p.label}</Text>
              <Text color={C.muted}>{money(p.value, cost.currency)}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Text color={error ? STATUS.failed.color : C.faint}>{error ? `Costi non letti: ${error.message}` : when}</Text>
        <Button key={keyFor('refresh-cost')} label={isBusy ? 'Leggo i costi…' : 'Aggiorna costi'} plain onPress={act.press} />
      </Box>
    </Box>
  )
}

export const watchBox = ({ Box, Text }: Els, Svg: SvgEl, cards: AzCard[]) => {
  const { rows, more } = watchList(cards)
  if (rows.length === 0) return null
  return (
    <Box key="watch" flexDirection="column" borderStyle="round" borderColor={STATUS.failed.color} backgroundColor={C.surface} paddingX={1}>
      <Text bold color={STATUS.failed.color}>Da guardare · {rows.length + more}</Text>
      {rows.map(r => (
        <Box key={`watch-${r.id}-${r.warning}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {mark(Text, Svg, r.warning === 'revision-failed' ? 'failed' : 'busy')}
          <Text color={C.text}>{r.name}: {WARNING_TEXT[r.warning].cause}</Text>
          <Text color={C.faint}>— {WARNING_TEXT[r.warning].action}</Text>
        </Box>
      ))}
      {more > 0 ? <Text color={C.faint}>+{more} {more === 1 ? 'altro' : 'altri'}</Text> : null}
    </Box>
  )
}

export const activityBox = ({ Box, Text }: Els, Svg: SvgEl, cache: AzCache, events: AzEvent[], now: Ms) => {
  const error = cache.errors.activity
  if (cache.activityAt === undefined && error === undefined) return null
  const shown = cache.activity.slice(0, ACTIVITY_SHOWN)
  return (
    <Box key="activity" flexDirection="column" borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
      <Text bold color={C.text}>Attività recenti</Text>
      {error ? <Text color={STATUS.failed.color}>Attività non lette: {error.message}</Text> : null}
      {shown.length === 0 && error === undefined ? <Text color={C.faint}>Nessuna modifica negli ultimi 7 giorni.</Text> : null}
      {shown.map(a => (
        <Box key={`act-${a.at}-${a.resourceId}-${a.op}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {mark(Text, Svg, a.status.toLowerCase() === 'failed' ? 'failed' : 'ok')}
          <Text color={C.faint}>{ago(now, a.at)}</Text>
          <Text color={C.text}>{cache.resources[a.resourceId]?.name ?? nameFromId(a.resourceId)} {activityText(a.op, a.status)}</Text>
          {isByClaude(a, events) ? <Text color="#a78bfa">· da Claude</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

/** The month's cost at the end of a row: «12,30 €», «—» when free, nothing before the first read. */
export const rowCost = (card: AzCard, currency: string): string =>
  card.cost === undefined ? '' : card.cost.month > 0 ? money(card.cost.month, currency) : '—'
