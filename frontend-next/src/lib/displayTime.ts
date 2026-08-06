// ---------------------------------------------------------------------------
// Display timezone for anything timestamped.
// ---------------------------------------------------------------------------
// Charts formatted their axis with t.getHours(), which is the BROWSER's zone.
// The readings are physically Thai-time events — MySQL runs with
// --default-time-zone=+07:00 and the pool is opened with timezone: DB_TZ — so an
// operator on a laptop set to UTC (or travelling) read every chart seven hours
// off, with nothing on screen to say so.
//
// Fixed to one zone rather than the viewer's, and configurable rather than
// hardcoded to Bangkok: NEXT_PUBLIC_DISPLAY_TZ mirrors the backend's DISPLAY_TZ,
// which notify() already uses to stamp alert messages. Both ends then agree on
// what "14:05" means.
export const DISPLAY_TZ = process.env.NEXT_PUBLIC_DISPLAY_TZ || 'Asia/Bangkok'

const hm = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
})
const full = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

const asDate = (v: string | number | Date): Date | null => {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "14:05" in the display zone — chart axes and compact labels. */
export function fmtHM(v: string | number | Date): string {
  const d = asDate(v)
  return d ? hm.format(d) : '—'
}

/** "02/08/2026, 14:05:09" in the display zone. */
export function fmtDateTime(v: string | number | Date): string {
  const d = asDate(v)
  return d ? full.format(d) : '—'
}

/** "06/08" in the display zone — the axis tick once a window spans days. */
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TZ, day: '2-digit', month: '2-digit',
})
export function fmtDayMonth(v: string | number | Date): string {
  const d = asDate(v)
  return d ? dayMonth.format(d) : '—'
}

// --- <input type="datetime-local"> in the DISPLAY zone -----------------------
// A datetime-local input is always the BROWSER's wall clock. Every label on a
// chart is pinned to DISPLAY_TZ, so leaving the picker on browser time means an
// operator on a UTC laptop asks for 08:00 and gets back rows labelled 15:00 —
// the range and the axis disagreeing about what the same number means. These
// two convert both ways against DISPLAY_TZ instead, so "08:00" in the picker is
// the same 08:00 the axis prints.

/** How far DISPLAY_TZ's wall clock is ahead of UTC at a given instant, in ms. */
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})
function tzOffsetMs(utcMs: number): number {
  const p = partsFmt.formatToParts(new Date(utcMs))
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - utcMs
}

/** Instant → "YYYY-MM-DDTHH:mm" as DISPLAY_TZ wall time, for an input's value. */
export function toDisplayInput(ms: number): string {
  return new Date(ms + tzOffsetMs(ms)).toISOString().slice(0, 16)
}

/** "YYYY-MM-DDTHH:mm" read as DISPLAY_TZ wall time → instant (ms). */
export function fromDisplayInput(s: string): number {
  const wall = Date.parse(`${s}${s.length === 16 ? ':00' : ''}Z`)
  if (Number.isNaN(wall)) return NaN
  // The offset depends on the instant, which is what we are solving for — one
  // correction is exact for a fixed-offset zone, and a second settles the hour
  // either side of a DST change if DISPLAY_TZ is ever set to a zone with one.
  let guess = wall - tzOffsetMs(wall)
  guess = wall - tzOffsetMs(guess)
  return guess
}

/** e.g. "Asia/Bangkok" — shown next to a time so nobody has to guess the zone. */
export const DISPLAY_TZ_LABEL = DISPLAY_TZ.split('/').pop()?.replace(/_/g, ' ') ?? DISPLAY_TZ
