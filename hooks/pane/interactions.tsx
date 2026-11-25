/*
 * pane/interactions.tsx — what every press in the az-mod pane does to the pane's own
 * `ui` atom: every press stamps `ui.lastInputAt` (Raccolta slows the refresh after 30 min
 * without input); rows open and close (`openCard`); toggles show «Nascoste», the
 * Azure-created resources and the «+ Aggiungi» picker. The Azure side of a press
 * (update, scan, add…) is Raccolta's: it hooks `ui.press` and reads the Button's key with
 * contract.ts `parseKey`, so every Raccolta key here comes from `keyFor`. Pane-only keys
 * (`show-auto`, `show-hidden`, `toggle-add`, `close-picker`, `copy-<id>`) parse to null.
 * The picker's Input is SEARCH_INPUT; Raccolta answers it in the `found` state key.
 * Usage: `const act = handlers($, setUi)` inside a ui.render hook, then `onPress={act.press}`
 * (never name it `h`: JSX compiles to the global `h`).
 */
import type { Elements, EngineInterface, UiPressArgument } from 'claude-code'

import type { AzId, AzSuggestion, AzUi } from '../../types'

import { keyFor, SEARCH_INPUT } from '../contract'
import { C, resourceCount } from './theme'

type Flag = 'showAuto' | 'showHidden' | 'isAdding'

/** `setUi` changes the `ui` atom and stamps `lastInputAt` (it lives where the atom is declared). */
export function handlers($: EngineInterface, setUi: (change: (u: AzUi) => Partial<AzUi>) => Promise<void>) {
  return {
    /** A press whose work is Raccolta's: here it only stamps the input time. */
    press: async (): Promise<void> => setUi(() => ({})),
    toggle: (flag: Flag) => async (): Promise<void> => setUi(u => ({ [flag]: !u[flag] })),
    /** Opens a row or closes the open one. */
    toggleCard: (id: AzId, isOpen: boolean) => async (): Promise<void> => setUi(u => {
      const others = (u.closed ?? []).filter(x => x !== id)
      return isOpen
        ? { openCard: u.openCard === id ? null : u.openCard, closed: [...others, id] }
        : { openCard: id, closed: others }
    }),
    copy: (text: string) => async (press: UiPressArgument): Promise<void> => {
      await setUi(() => ({}))
      await $.ui.copy({ text, surface: press.surface })
    },
    /** A picked result: the picker closes (Raccolta adds it, by the button's key). */
    add: async (): Promise<void> => setUi(() => ({ isAdding: false })),
  }
}
export type Handlers = ReturnType<typeof handlers>

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>
/** The «+ Aggiungi» picker: search field, one button per result, close. */
export const picker = ({ Box, Text, Button, Input }: Els, act: Handlers, found: AzSuggestion[]) => (
  <Box key="picker" flexDirection="column" gap={1} borderStyle="round" borderColor={C.border} backgroundColor={C.surface} padding={1}>
    <Input key={SEARCH_INPUT} label="Cerca" placeholder="nome di una risorsa o di un gruppo" submitLabel="cerca" autoFocus onSubmit={act.press} />
    {found.map(s => (
      <Box key={`found-${s.id}`} flexDirection="row" gap={1} alignItems="center">
        <Button key={s.kind === 'group' ? keyFor('add-group', s.id) : keyFor('add', s.id)} label={`+ ${s.name}`} plain onPress={act.add} />
        <Text color={C.faint}>{s.kind === 'group' ? `gruppo${s.count === undefined ? '' : ` · ${resourceCount(s.count)}`}` : (s.type ?? '')}</Text>
      </Box>
    ))}
    <Button key="close-picker" label="Chiudi" plain onPress={act.toggle('isAdding')} />
  </Box>
)
