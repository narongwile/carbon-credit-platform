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
