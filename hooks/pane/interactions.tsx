/*
 * pane/interactions.tsx — what every press in the az-mod pane does to the pane's own
 * `ui` atom: every press stamps `ui.lastInputAt` (Raccolta slows the refresh after 30 min
 * without input); rows open and close (`openCard`); toggles show «Nascoste», the
 * Azure-created resources and the «+ Aggiungi» picker. The Azure side of a press
 * (update, scan, include…) is Raccolta's: it hooks the press by the Button's key, since
 * the engine refuses `$` passed to an AzActions method (contract under review: the keys
 * here are the ones fixed in plan H1 — update, scan, open-<name>, refresh-<name>,
 * exclude-<id>, restore-<id>, remove-<groupId>, accept-<id>, dismiss-<id>, undo-auto,
 * reset-rules, add, add-search, add-<id>).
 * Usage: `const act = handlers($, setUi)` inside a ui.render hook, then `onPress={act.press}`
 * (never name it `h`: JSX compiles to the global `h`).
 */
import type { Elements, EngineInterface, UiPressArgument } from 'claude-code'

import type { AzId, AzSuggestion, AzUi } from '../../types'

import { C } from './theme'

type Flag = 'showAuto' | 'showHidden' | 'isAdding'

/** `setUi` changes the `ui` atom and stamps `lastInputAt` (it lives where the atom is declared). */
export function handlers($: EngineInterface, setUi: (change: (u: AzUi) => Partial<AzUi>) => Promise<void>) {
  return {
    /** A press whose work is Raccolta's: here it only stamps the input time. */
    press: async (): Promise<void> => setUi(() => ({})),
    toggle: (flag: Flag) => async (): Promise<void> => setUi(u => ({ [flag]: !u[flag] })),
    /** Opens a row or closes the open one. */
    toggleCard: (id: AzId) => async (): Promise<void> => setUi(u => ({ openCard: u.openCard === id ? null : id })),
    copy: (text: string) => async (press: UiPressArgument): Promise<void> => {
      await setUi(() => ({}))
      await $.ui.copy({ text, surface: press.surface })
    },
    /** A picked result: the picker closes (Raccolta adds it, by the button's key). */
    add: async (): Promise<void> => setUi(() => ({ isAdding: false })),
    search: async (): Promise<void> => setUi(() => ({})),
  }
}
export type Handlers = ReturnType<typeof handlers>

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>
/** The «+ Aggiungi» picker: search field, one button per result, close. */
export const picker = ({ Box, Text, Button, Input }: Els, act: Handlers, found: AzSuggestion[]) => (
  <Box key="picker" flexDirection="column" gap={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
    <Input key="add-search" label="Cerca" placeholder="nome di una risorsa o di un gruppo" submitLabel="cerca" autoFocus onSubmit={act.search} />
    {found.map(s => (
      <Box key={`found-${s.id}`} flexDirection="row" gap={1} alignItems="center">
        <Button key={`add-${s.id}`} label={`+ ${s.name}`} plain onPress={act.add} />
        <Text color={C.faint}>{s.kind === 'group' ? `gruppo${s.count === undefined ? '' : ` · ${s.count} risorse`}` : (s.type ?? '')}</Text>
      </Box>
    ))}
    <Button key="add-close" label="Chiudi" plain onPress={act.toggle('isAdding')} />
  </Box>
)
