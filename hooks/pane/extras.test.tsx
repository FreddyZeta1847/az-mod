/*
 * pane/extras.test.tsx — tests of the cruscotto's new parts (letter D of «Costi, attività e
 * avvisi»): the drawing pieces (cost bar, amounts, warning and activity texts), then the three
 * boxes (costs, «Da guardare», recent activity) and the cost on each row, on desktop and terminal.
 */
import { expect, test } from 'claude-code/testing'

import { WARNING_ORDER } from '../contract'
import { costBar } from './svg'
import { activityText, money, WARNING_TEXT } from './theme'

// ---------------------------------------------------------------- D1 pieces

test('the cost bar is a plain image with a size', async () => {
  const s = costBar([{ color: '#4cc9f0', value: 30 }, { color: '#a78bfa', value: 10 }, { color: '#000', value: 0 }], 300, 14)
  expect(/^<svg [^>]*width="300" height="14"/.test(s)).toBe(true)
  expect(/<script|<style|<title|on[a-z]+=/i.test(s)).toBe(false)
  expect((s.match(/<rect /g) ?? []).length).toBe(2)
  expect(/^<svg [^>]*width="300" height="14"/.test(costBar([], 300, 14))).toBe(true)
})

test('amounts carry their currency', async () => {
  expect(money(12.3, 'EUR')).toBe('12,30 €')
  expect(money(0, 'EUR')).toBe('0,00 €')
  expect(money(1234.5, 'USD')).toBe('1234,50 USD')
})

test('every warning has a cause and an action', async () => {
  for (const w of WARNING_ORDER) {
    expect(WARNING_TEXT[w].cause.length).toBeGreaterThan(5)
    expect(WARNING_TEXT[w].action.length).toBeGreaterThan(5)
  }
})

test('activities read as plain words', async () => {
  expect(activityText('microsoft.app/containerapps/write', 'Succeeded')).toBe('creata o modificata')
  expect(activityText('microsoft.storage/storageaccounts/delete', 'Succeeded')).toBe('cancellata')
  expect(activityText('microsoft.app/containerapps/revisions/restart/action', 'Succeeded')).toBe('riavviata')
  expect(activityText('microsoft.web/sites/stop/action', 'Succeeded')).toBe('fermata')
  expect(activityText('microsoft.storage/storageaccounts/delete', 'Failed')).toBe('cancellazione non riuscita')
})
