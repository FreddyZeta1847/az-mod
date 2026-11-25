/*
 * pane/svg.ts — SVG markup for the az-mod pane (from design/bozze/svg.ts): type icons,
 * the status dot, the status donut and the cost bar. Every builder returns a whole <svg> with explicit
 * width/height; nothing here is interactive (interactive SVGs made the pane's scroll
 * bounce), so no <style>, <title> hover or script: the numbers live in the legend.
 */
import type { AzStatus } from '../../types'

import { C, STATUS, STATUS_ORDER, type TypeKey } from './theme'

const wrap = (w: number, h: number, body: string, vb = `0 0 ${w} ${h}`): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`

const GLYPH: Record<TypeKey, string> = {
  ca: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 12l7.8-4.5M12 12v9M12 12L4.2 7.5"/>',
  env: '<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 2.5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
  acr: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
  ai: '<path d="M12 3l2.2 6.3L20.5 12l-6.3 2.2L12 20.5l-2.2-6.3L3.5 12l6.3-2.7z"/>',
  srch: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  bing: '<path d="M7 3v15l5 3 6-4-6-3"/>',
  kv: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  st: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  id: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  log: '<path d="M5 6h14M5 10h10M5 14h14M5 18h8"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M9 13h6"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
}

export const typeIcon = (glyph: TypeKey, color: string, size = 16): string =>
  wrap(size, size, `<g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH[glyph]}</g>`, '0 0 24 24')

export const dot = (s: AzStatus, size = 10): string =>
  wrap(size, size, `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${STATUS[s].color}"/>`)

/** Donut of resources by status, total in the middle. An image, never interactive. */
export const statusDonut = (counts: Record<AzStatus, number>, size = 132): string => {
  const total = STATUS_ORDER.reduce((a, s) => a + counts[s], 0)
  let offset = 25
  const slices = total === 0 ? '' : STATUS_ORDER.filter(s => counts[s] > 0).map(s => {
    const len = (counts[s] / total) * 100
    const gap = len >= 100 ? 0 : 0.8
    const arc = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${STATUS[s].color}" stroke-width="4.5" stroke-dasharray="${len - gap} ${100 - len + gap}" stroke-dashoffset="${offset}"/>`
    offset -= len
    return arc
  }).join('')
  const font = 'font-family="Segoe UI, sans-serif"'
  return wrap(size, size, `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${C.border}" stroke-width="4.5"/>${slices}<text x="21" y="22.5" text-anchor="middle" font-size="8" font-weight="600" fill="${C.text}" ${font}>${total}</text><text x="21" y="28" text-anchor="middle" font-size="3.2" fill="${C.muted}" ${font}>risorse</text>`, '0 0 42 42')
}

/** The month's cost by type, one segment per part (zero parts left out). An image, never interactive. */
export const costBar = (parts: { color: string; value: number }[], width = 300, height = 14): string => {
  const shown = parts.filter(p => p.value > 0)
  const total = shown.reduce((a, p) => a + p.value, 0)
  let x = 0
  const rects = shown.map(p => {
    const w = (p.value / total) * width
    const rect = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(w - 2, 1).toFixed(1)}" height="${height}" rx="3" fill="${p.color}"/>`
    x += w
    return rect
  }).join('')
  return wrap(width, height, rects || `<rect x="0" y="0" width="${width}" height="${height}" rx="3" fill="${C.border}"/>`)
}
