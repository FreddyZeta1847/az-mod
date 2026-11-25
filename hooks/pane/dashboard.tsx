/*
 * pane/dashboard.tsx — draws the az-mod pane, direction C «cruscotto»: header (project,
 * group · subscription, Update, Scan, + Aggiungi), banners (az login/missing, rules
 * read-only/broken, name conflict, stale data, group adopted by itself with «Annulla»),
 * suggestions, the status donut with its legend, the resources grouped by type (one row
 * each, opening on two columns of facts), then «Nascoste» and the Azure-created count.
 * Reads Raccolta's state atoms and writes only `ui` (through interactions.tsx).
 * The terminal has no Svg: there the same tree draws dots as colored «●» text and no donut.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { AzCard, AzStatus, AzSuggestion, AzUi } from '../../types'

import { isHidden, keyFor } from '../contract'
import { handlers, picker } from './interactions'

// The engine reads an atom only when it is declared in the file that reads it, so these
// mirror hooks/contract.ts exactly (same ref, initial and shape): keep them in step.
const projectAtom = atom({ plugin: 'az-mod', key: 'project' } as const, null, { shape: 'project-1' })
const rulesAtom = atom({ plugin: 'az-mod', key: 'rules' } as const, null, { shape: 'rules-1' })
const cacheAtom = atom({ plugin: 'az-mod', key: 'cache' } as const, null, { shape: 'cache-1' })
const suggestionsAtom = atom({ plugin: 'az-mod', key: 'suggestions' } as const, [], { shape: 'suggestions-1' })
const autoAddedAtom = atom({ plugin: 'az-mod', key: 'autoAdded' } as const, null, { shape: 'autoAdded-1' })
const busyAtom = atom({ plugin: 'az-mod', key: 'busy' } as const,
  { scan: false, update: false, cost: false, ids: [] }, { shape: 'busy-1' })
const healthAtom = atom({ plugin: 'az-mod', key: 'health' } as const,
  { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'ok' }, { shape: 'health-1' })
const foundAtom = atom({ plugin: 'az-mod', key: 'found' } as const, [], { shape: 'found-1' })
const uiAtom = atom({ plugin: 'az-mod', key: 'ui' } as const,
  { lastInputAt: 0, openCard: null, closed: [], showAuto: false, showHidden: false, isAdding: false }, { shape: 'ui-1' })
import { dot, statusDonut, typeIcon } from './svg'
import { C, FACT_LABELS, STATUS, STATUS_ORDER, TYPE_ORDER, ago, factsOf, keyFact, nameFromId, resourceCount, typeStyle } from './theme'

const STALE_MS = 10 * 60_000

const REASONS: Record<AzSuggestion['reason'], string> = {
  'same-repo': 'stesso repository GitHub',
  'similar-group': 'nome simile al progetto',
  'image-name': 'immagine col nome del progetto',
  'named-in-files': 'citata nei file del progetto',
  'used-by': 'usata da',
  'claude-wrote': 'Claude l\'ha appena modificata',
}
const reasonText = (s: AzSuggestion): string => `${REASONS[s.reason]}${s.reasonArg ? ` ${s.reasonArg}` : ''}`

const portalUrl = (id: string): string => `https://portal.azure.com/#resource${id}/overview`

const countByStatus = (cards: AzCard[]): Record<AzStatus, number> => {
  const n: Record<AzStatus, number> = { ok: 0, busy: 0, failed: 0, stopped: 0, unknown: 0 }
  for (const c of cards) n[c.status]++
  return n
}

/** Visible cards grouped by type label, in TYPE_ORDER, names sorted inside a group. */
const byType = (cards: AzCard[]): [string, AzCard[]][] => {
  const groups = new Map<string, AzCard[]>()
  for (const c of cards) groups.set(typeStyle(c.type).label, [...(groups.get(typeStyle(c.type).label) ?? []), c])
  return TYPE_ORDER.filter(t => groups.has(t)).map(t => [t, (groups.get(t) ?? []).sort((a, b) => a.name.localeCompare(b.name))])
}

export async function drawDashboard($: EngineInterface, e: RenderInput<'Pane'>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button, Link } = els
  const Svg = 'Svg' in els ? els.Svg : undefined
  const [project, rules, cache, suggestions, autoAdded, busy, health, ui, now, found] = await Promise.all([
    read($, projectAtom), read($, rulesAtom), read($, cacheAtom), read($, suggestionsAtom), read($, autoAddedAtom),
    read($, busyAtom), read($, healthAtom), read($, uiAtom), $.clock.now(), read($, foundAtom),
  ])
  const setUi = async (change: (u: AzUi) => Partial<AzUi>): Promise<void> => {
    const at = await $.clock.now()
    await update($, uiAtom, u => ({ ...u, ...change(u), lastInputAt: at }))
  }
  const act = handlers($, setUi)

  const key = project?.key ?? '…'
  const groupNames = Object.keys(rules?.groups ?? {}).map(g => cache?.groups[g]?.name ?? nameFromId(g))
  const all = Object.values(cache?.resources ?? {})
  const visible = all.filter(c => !rules || !isHidden(c, rules, ui.showAuto))
  const autoCount = all.filter(c => c.autoCreated && !(rules && c.id in rules.excludes)).length
  const hiddenIds = Object.keys(rules?.excludes ?? {})

  // ---- small pieces
  const statusMark = (s: AzStatus, size = 10) => Svg
    ? <Svg source={dot(s, size)} alt={STATUS[s].label} width={size} height={size} />
    : <Text color={STATUS[s].color}>●</Text>
  const icon = (armType: string, size = 16) => {
    const t = typeStyle(armType)
    return Svg ? <Svg source={typeIcon(t.glyph, t.color, size)} alt={t.label} width={size} height={size} /> : null
  }
  const banner = (k: string, color: string, text: string, extra?: RenderChildren) => (
    <Box key={k} flexDirection="column" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color}>{text}</Text>
      {extra ?? null}
    </Box>
  )

  // ---- header
  const header = (
    <Box key="header" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
      <Box flexDirection="column">
        <Text bold color={C.text}>{key}</Text>
        <Text color={C.faint}>{[groupNames.join(', ') || 'nessun gruppo', cache?.subscription.name].filter(Boolean).join(' · ')}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Button key={keyFor('update')} label={busy.update ? 'Aggiorno…' : 'Update'} variant="primary" onPress={act.press} />
        <Button key={keyFor('scan')} label={busy.scan ? 'Cerco…' : 'Scan'} onPress={act.press} />
        <Button key="toggle-add" label="+ Aggiungi" onPress={act.toggle('isAdding')} />
      </Box>
    </Box>
  )

  // ---- banners
  const banners: RenderChildren[] = []
  if (health.az === 'login') banners.push(banner('b-login', STATUS.failed.color, 'Login di Azure scaduto: lancia «az login» nel terminale, poi premi Update.'))
  if (health.az === 'missing') banners.push(banner('b-missing', STATUS.failed.color, 'Azure CLI non trovata: installala (comando «az») e riapri il pannello.'))
  if (health.rulesMode === 'read-only') banners.push(banner('b-ro', STATUS.busy.color, 'Le regole di questo progetto vengono da una versione più nuova della mod: le mostro ma non le modifico.'))
  if (health.rulesMode === 'broken') {
    banners.push(banner('b-broken', STATUS.failed.color, 'Le regole di questo progetto sono rovinate, anche la copia di riserva.',
      <Button key={keyFor('reset-rules')} label="Riparti da zero (salvo il file rotto)" onPress={act.press} />))
  }
  if (project?.conflict === 'other-repo') banners.push(banner('b-conflict', STATUS.busy.color, `Un altro repository usa già il nome «${key}»: questo progetto ha un file di regole a parte.`))
  const stateAt = cache?.stateAt
  if (stateAt !== undefined && (now - stateAt > STALE_MS || cache?.errors.state)) {
    banners.push(banner('b-stale', STATUS.busy.color, `Dati non aggiornati da ${Math.floor((now - stateAt) / 60_000)} min${cache?.errors.state ? ` · ${cache.errors.state.message}` : ''}`))
  }
  // no photo yet and the first read failed: say so, instead of an empty project
  if (cache === null && health.error && health.az === 'ok') {
    banners.push(banner('b-noread', STATUS.failed.color, `Non riesco a leggere Azure: ${health.error.message}. Premi Update per riprovare.`))
  }
  if (autoAdded) {
    const name = cache?.groups[autoAdded.groupId]?.name ?? nameFromId(autoAdded.groupId)
    banners.push(
      <Box key="b-auto" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Text color={C.muted}>Uso {name} ({resourceCount(autoAdded.count)})</Text>
        <Button key={keyFor('undo-auto')} label="Annulla" plain onPress={act.press} />
      </Box>,
    )
  }

  // ---- suggestions
  const chips = suggestions.length === 0 ? null : (
    <Box key="suggestions" flexDirection="column" gap={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
      <Text bold color={C.text}>Forse del progetto</Text>
      {suggestions.map(s => (
        <Box key={`sg-${s.id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text color={C.text}>{s.name}</Text>
          <Text color={C.faint}>{reasonText(s)}</Text>
          <Button key={keyFor('accept', s.id)} label="Aggiungi" plain onPress={act.press} />
          <Button key={keyFor('dismiss', s.id)} label="No" plain onPress={act.press} />
        </Box>
      ))}
    </Box>
  )

  // ---- summary: donut + legend
  const counts = countByStatus(visible)
  const updated = stateAt === undefined ? 'mai aggiornato' : `aggiornato ${ago(now, stateAt)}`
  const legend = STATUS_ORDER.filter(s => counts[s] > 0)
  const summary = visible.length === 0 ? null : (
    <Box key="summary" flexDirection="row" gap={2} alignItems="center" borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
      {Svg ? <Svg source={statusDonut(counts, 132)} alt="Risorse per stato" width={132} height={132} /> : null}
      <Box flexDirection="column" gap={Svg ? 1 : 0} flexGrow={1}>
        {legend.map(s => (
          <Box key={`leg-${s}`} flexDirection="row" gap={1} alignItems="center">
            {statusMark(s)}
            <Text color={C.text}>{STATUS[s].label}</Text>
            <Text color={C.faint}>{counts[s]}</Text>
          </Box>
        ))}
        <Text color={C.faint}>{resourceCount(visible.length)} · {updated}</Text>
      </Box>
    </Box>
  )

  // ---- rows
  const facts = (c: AzCard) => (
    <Box key={`facts-${c.id}`} flexDirection="row" flexWrap="wrap" paddingLeft={3} paddingTop={1}>
      {[...factsOf(c).map(([k, v]) => [FACT_LABELS[k], v]), ['Regione', c.location], ['Gruppo', c.group]].map(([k, v]) => (
        <Box key={`f-${c.id}-${k}`} width="50%" flexDirection="column" paddingBottom={1}>
          <Text color={C.faint}>{k}</Text>
          <Text color={C.text}>{v}</Text>
        </Box>
      ))}
      <Box width="100%" flexDirection="row" gap={2} flexWrap="wrap">
        <Link href={portalUrl(c.id)} label="Apri nel portale" />
        <Button key={`copy-${c.id}`} label="Copia nome" plain onPress={act.copy(c.name)} />
        <Button key={keyFor('refresh', c.id)} label={busy.ids.includes(c.id) ? 'Aggiorno…' : 'Aggiorna'} plain onPress={act.press} />
        <Button key={keyFor('exclude', c.id)} label="× Togli dal progetto" plain onPress={act.press} />
      </Box>
    </Box>
  )
  const row = (c: AzCard) => {
    // a failed row is open by itself until the user closes it (decision «Quali informazioni in più mostrare»)
    const isOpen = ui.openCard === c.id || (c.status === 'failed' && !(ui.closed ?? []).includes(c.id))
    return (
      <Box key={`row-${c.id}`} flexDirection="column" paddingX={1} backgroundColor={isOpen ? C.surface2 : C.bg} hover={{ backgroundColor: C.surface2 }}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          {statusMark(busy.ids.includes(c.id) ? 'busy' : c.status)}
          <Button key={keyFor('open', c.id)} label={`${isOpen ? '▾' : '▸'} ${c.name}`} plain onPress={act.toggleCard(c.id, isOpen)} />
          <Box flexGrow={1}>
            <Text color={c.status === 'failed' ? STATUS.failed.color : C.muted} wrap="truncate-end">{keyFact(c)}</Text>
          </Box>
        </Box>
        {isOpen ? facts(c) : null}
      </Box>
    )
  }
  const resources = byType(visible).map(([label, list]) => (
    <Box key={`type-${label}`} flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={1}>
        {icon(list[0]?.type ?? '')}
        <Text bold color={typeStyle(list[0]?.type ?? '').color}>{label}</Text>
        <Text color={C.faint}>{list.length}</Text>
      </Box>
      {list.map(row)}
    </Box>
  ))

  // ---- empty project
  // «Nessun gruppo» only after Azure answered: without a photo nothing is known yet
  const empty = all.length > 0 || !rules || cache === null ? null : (
    <Box key="empty" flexDirection="column" gap={1} padding={1}>
      <Text color={C.muted}>Nessun gruppo rg-{key} in {cache?.subscription.name ?? 'questa sottoscrizione'}.</Text>
      <Text color={C.faint}>Premi «+ Aggiungi» per scegliere un gruppo o una risorsa, oppure Scan per cercare indizi.</Text>
    </Box>
  )

  // ---- footer: groups, hidden, Azure-created
  // one group too: a group adopted by mistake must be removable
  const groupsLine = groupNames.length === 0 ? null : (
    <Box key="groups" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <Text color={C.faint}>Gruppi:</Text>
      {Object.keys(rules?.groups ?? {}).map((g, i) => (
        <Box key={`grp-${g}`} flexDirection="row" alignItems="center">
          <Text color={C.muted}>{groupNames[i]}</Text>
          <Button key={keyFor('remove-group', g)} label="×" plain onPress={act.press} />
        </Box>
      ))}
    </Box>
  )
  const footer = (
    <Box key="footer" flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        {hiddenIds.length > 0 ? <Button key="show-hidden" label={`Nascoste (${hiddenIds.length})`} plain onPress={act.toggle('showHidden')} /> : null}
        {autoCount > 0 ? <Button key="show-auto" label={ui.showAuto ? `Nascondi le ${autoCount} create da Azure` : `+${autoCount} create da Azure (mostra)`} plain onPress={act.toggle('showAuto')} /> : null}
      </Box>
      {ui.showHidden ? hiddenIds.map(id => (
        <Box key={`hid-${id}`} flexDirection="row" gap={1} alignItems="center">
          <Text color={C.faint}>{cache?.resources[id]?.name ?? nameFromId(id)}</Text>
          <Button key={keyFor('restore', id)} label="Ripristina" plain onPress={act.press} />
        </Box>
      )) : null}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1} padding={1} backgroundColor={C.bg}>
      {header}
      {banners}
      {ui.isAdding ? picker(els, act, found) : null}
      {chips}
      {summary}
      {empty}
      {resources}
      {groupsLine}
      {footer}
    </Box>
  )
}
