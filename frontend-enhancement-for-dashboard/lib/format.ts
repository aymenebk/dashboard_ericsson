import type { Condition } from './types'

// Days in the data are UTC midnights: always format them in UTC so that a day never shifts.
export const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const fmtDayShort = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })
export const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
export const fmtPct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`)

export const CONDITION_LABEL: Record<Condition, string> = { critical: 'Critical', medium: 'Medium', good: 'Good', no_data: 'No measurement' }
export const CONDITION_COLOR: Record<Condition, string> = { critical: '#eb3129', medium: '#f3a009', good: '#16a05a', no_data: '#9a9b96' }
export const CONDITION_TEXT: Record<Condition, string> = { critical: 'text-[#b84940]', medium: 'text-[#c98a0a]', good: 'text-[#2d9361]', no_data: 'text-[#8a8b86]' }
export const CONDITION_BG: Record<Condition, string> = { critical: 'bg-[#b84940]', medium: 'bg-[#d8a22d]', good: 'bg-[#2d9361]', no_data: 'bg-[#9a9b96]' }

/** conic-gradient from [value, color] pairs; values are turned into shares of their sum. */
export function conic(parts: [number, string][]) {
  const sum = parts.reduce((a, [v]) => a + v, 0)
  if (sum <= 0) return 'conic-gradient(#e8e8e4 0 100%)'
  let at = 0
  const stops = parts.filter(([v]) => v > 0).map(([v, c]) => { const from = at; at += (v / sum) * 100; return `${c} ${from}% ${at}%` })
  return `conic-gradient(${stops.join(', ')})`
}

export const today = () => new Date().toISOString().slice(0, 10)

/** The reason a site/link has no measurement. It comes from the backend (the failure recorded in the import); one place so every screen says the same thing. */
export const noMeasurementText = (reason: string | null | undefined) => reason || 'No reason reported'
