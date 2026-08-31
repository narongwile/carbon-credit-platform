// Proves the Alarms console's time range actually selects data — on both the
// admin and the customer page, and at both ends of the wire.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// Both views filtered client-side with:
//
//     if (Number.isFinite(ts) && range.start > 0) {
//       if (a.acknowledged  && (ts < start || ts > end)) return false
//       if (!a.acknowledged && (from || to) && (ts < start || ts > end)) return false
//     }
//
// Two independent defects:
//
//  1. A quick range leaves `from`/`to` EMPTY — it sets `quick` instead. So for
//     an unacknowledged alarm the second condition was never true and the row
//     was always kept. `showAcked` defaults to false, i.e. the table shows
//     exactly the unacknowledged rows, so in the DEFAULT view the whole
//     QUICK RANGES column was a no-op: choosing "Last 1 hour" still listed
//     alarms from weeks ago.
//
//  2. `range.start > 0` skipped the entire check when only "To" was filled,
//     because an absent "From" falls back to start = 0. A lone upper bound
//     ("everything before yesterday") was ignored.
//
// And a third, upstream: the range was only ever a filter over rows already
// fetched, while GET /api/orgs/:orgId/alarms returned `ORDER BY raised_at DESC
// LIMIT 300`. So even with the filter fixed, "Last 30 days" could not show
// more than the newest 300 events — on a busy org often under two days of
// history. The range has to be part of the QUERY, which is what from/to do.
//
// Run from the repo root: node e2e/proofs/test-alarms-time-range.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)

// Strip comments before matching. Several of the assertions below are NEGATIVE
// ("the old broken form is gone"), and the fix deliberately quotes that old
// form in a comment explaining what went wrong — so testing the raw text would
// fail on the very explanation of the fix. Comments are prose; this proof is
// about code.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p) => strip(readFileSync(new URL(p, root), 'utf8'))

const VIEWS = [
  ['AlarmsManagementView (admin/alarms)', 'frontend-next/src/components/AlarmsManagementView.tsx', 'timestamp', 'acknowledged'],
  ['CustomerAlarmsView (customer/alarms)', 'frontend-next/src/components/CustomerAlarmsView.tsx', 'raisedAt', 'acknowledgedAt'],
]

// ── 1. The client-side filter is unconditional ────────────────────────────
for (const [label, path, tsField, ackField] of VIEWS) {
  const src = read(path)

  t(`${label}: applies the range to every row, not only acknowledged ones`,
    new RegExp(`if \\(Number\\.isFinite\\(ts\\) && \\(ts < range\\.start \\|\\| ts > range\\.end\\)\\) return false`).test(src),
    'the range must gate all rows with one comparison')

  // The exact shapes of the two old defects must be gone.
  t(`${label}: no longer gates the range behind "range.start > 0"`,
    !/Number\.isFinite\(ts\) && range\.start > 0/.test(src),
    'that guard dropped the check whenever only "To" was set')

  t(`${label}: no longer requires from/to for an unacknowledged row`,
    !new RegExp(`!a\\.${ackField} && \\(from \\|\\| to\\)`).test(src),
    'quick ranges leave from/to empty, so this made them a no-op')

  // Guard against the filter being deleted outright rather than fixed.
  t(`${label}: still reads the row's own timestamp (${tsField})`,
    new RegExp(`new Date\\(a\\.${tsField}\\)\\.getTime\\(\\)`).test(src))

  // ── 2. The range reaches the fetch ──────────────────────────────────────
  t(`${label}: passes the range into useOrgAlarms as fromMs/toMs`,
    /fromMs:\s*range\.start > 0 \? range\.start : undefined/.test(src) &&
    /toMs:\s*Number\.isFinite\(range\.end\) \? range\.end : undefined/.test(src),
    'a filter over the newest-N page cannot reach older events in a wider range')

  // ── 3. A relative window advances, but not every render ─────────────────
  // range.start is now a fetch input. Recomputing Date.now() on every render
  // would give useOrgAlarms' load callback a new identity every render, so its
  // effect would refetch forever. The minute bucket is what makes a moving
  // window safe to depend on.
  t(`${label}: a relative window is quantised, not raw Date.now()`,
    /nowMinute \* 60_000 - hrs \* 3600_000/.test(src) && /Math\.floor\(Date\.now\(\) \/ 60_000\)/.test(src),
    'raw Date.now() in the memo would refetch on every render')

  t(`${label}: the quantised clock is a dependency of the range memo`,
    /\}, \[quick, from, to, nowMinute\]\)/.test(src))

  // ── 4. A half-typed datetime must not poison the query ──────────────────
  // fromDisplayInput returns NaN for an incomplete datetime-local value.
  // Passing that on would send from=NaN and, before the guard, produce a
  // start of NaN whose comparisons are all false — silently unfiltered.
  t(`${label}: an unparseable datetime falls back instead of yielding NaN`,
    /Number\.isFinite\(s\) \? s : 0/.test(src) && /Number\.isFinite\(e\) \? e : Infinity/.test(src))
}

// ── 5. api.orgAlarms serialises the range ─────────────────────────────────
const apiSrc = read('frontend-next/src/lib/api.ts')
t('api.orgAlarms accepts a range and builds a query string',
  /opts\?: \{ open\?: boolean; fromMs\?: number; toMs\?: number; limit\?: number; severity\?: 'WARNING' \| 'CRITICAL'; unacked\?: boolean \}/.test(apiSrc))
t('api.orgAlarms keeps ?open=1 working for the badge/notification callers',
  /if \(opts\?\.open\) qs\.set\('open', '1'\)/.test(apiSrc))
t('api.orgAlarms refuses non-finite bounds',
  /Number\.isFinite\(opts\?\.fromMs\)/.test(apiSrc) && /Number\.isFinite\(opts\?\.toMs\)/.test(apiSrc),
  'Infinity/NaN would reach the server as the literal strings "Infinity"/"NaN"')

// ── 6. useOrgAlarms refetches when the range changes ──────────────────────
const hookSrc = read('frontend-next/src/lib/useOrgAlarms.ts')
t('useOrgAlarms forwards the range to the API',
  /api\.orgAlarms\(orgId, \{ open, fromMs, toMs, limit, severity, unacked \}\)/.test(hookSrc))
t('useOrgAlarms makes the range part of load()’s identity',
  /\}, \[orgId, open, fromMs, toMs, limit, severity, unacked\]\)/.test(hookSrc),
  'without this the range changes but the data never refetches')

// ── 7. The endpoint filters in SQL and is bounded ─────────────────────────
const flows = JSON.parse(read('backend/node-red/flows.nodered-backend.json'))
const node = flows.find((n) => n.id === 'orgalarms_fn')
if (!node) {
  t('orgalarms endpoint present in the generated flow', false)
} else {
  const fn = node.func
  t('endpoint filters raised_at by from/to in SQL',
    /AND e\.raised_at >= \?/.test(fn) && /AND e\.raised_at <= \?/.test(fn))
  t('endpoint binds the bounds as Date objects, not formatted strings',
    /args\.push\(new Date\(fromMs\)\)/.test(fn) && /args\.push\(new Date\(toMs\)\)/.test(fn),
    'both pools set timezone: __DBTZ, so a Date needs no format agreement')
  t('endpoint rejects a non-positive / non-numeric bound',
    /Number\.isFinite\(n\)&&n>0 \? n : null/.test(fn))

  // The old code applied LIMIT 300 only for admins (`if(!acc)`), leaving the
  // NON-admin path — the one that then filters in JS — completely unbounded.
  t('endpoint bounds the query for BOTH admin and non-admin callers',
    !/if\(!acc\) sql \+= " LIMIT 300";/.test(fn) && /sql \+= acc \? \(" LIMIT "/.test(fn),
    'the less-privileged caller used to run the unbounded query')
  t('endpoint caps a caller-supplied limit',
    /MAX_ROWS=2000/.test(fn) && /Math\.min\(Math\.floor\(limit\), MAX_ROWS\)/.test(fn))
  t('endpoint scans wider than the page for a non-admin, whose rows are filtered after the query',
    /limit \* 10/.test(fn),
    'limiting to exactly `limit` would under-fill a user who sees part of the org')
  t('endpoint still slices the visible set to the requested limit',
    /\.slice\(0,limit\)/.test(fn))
}

// ── 7b. The severity / Show-Acknowledged controls ─────────────────────────
// These sit beside the range picker and narrow the same list, so they carry
// the same hazard: applied client-side over a capped page, "CRITICAL" across a
// wide range filters the newest N rows and silently omits an older CRITICAL
// that the range does cover — the exact row the operator opened the console
// for. On the admin console they are query parameters.
{
  const adminSrc = read('frontend-next/src/components/AlarmsManagementView.tsx')

  t('admin console pushes the severity filter into the query',
    /severity: filter === 'all' \? undefined : filter/.test(adminSrc))
  t('admin console pushes Show-Acknowledged into the query',
    /unacked: !showAcked/.test(adminSrc))

  // INFO is unreachable: alarm_events.severity is ENUM('WARNING','CRITICAL')
  // and nothing in the worker, Node-RED or the mock set writes another value,
  // so the button could only ever render an empty table.
  t('admin console no longer offers the unreachable INFO filter',
    !/'all', 'CRITICAL', 'WARNING', 'INFO'/.test(adminSrc) &&
    /\['all', 'CRITICAL', 'WARNING'\] as const/.test(adminSrc))
  t("admin console's filter state cannot hold INFO either",
    !/useState<'all' \| 'CRITICAL' \| 'WARNING' \| 'INFO'>/.test(adminSrc))

  // Header badges must not follow the severity/ack narrowing, or choosing
  // CRITICAL hides the Warning badge — on screen that is indistinguishable
  // from "there are no warnings".
  t('admin header badges read a source that is range-scoped but not severity-scoped',
    /const \{ alarms: badgeAlarms \} = useOrgAlarms/.test(adminSrc) &&
    /const critCount = inRange\.filter/.test(adminSrc))
  t('the badge source is not narrowed by the severity buttons',
    !/badgeAlarms[\s\S]{0,400}?severity: filter/.test(adminSrc))

  // The customer view deliberately keeps these client-side; assert that too,
  // so the difference is a recorded decision rather than an oversight.
  const custSrc = read('frontend-next/src/components/CustomerAlarmsView.tsx')
  t('customer view keeps severity/ack client-side (its stat cards need the un-narrowed set)',
    !/severity: severity === 'all'/.test(custSrc) && !/unacked: !showAcked/.test(custSrc))
  t('customer view never offered INFO',
    /useState<'all' \| 'CRITICAL' \| 'WARNING'>/.test(custSrc))
}

// ── 7c. Endpoint support for severity / unacked ───────────────────────────
if (node) {
  const fn = node.func
  t('endpoint narrows by severity in SQL',
    /AND e\.severity=\?/.test(fn) && /args\.push\(severity\)/.test(fn))
  t('endpoint whitelists severity instead of interpolating it',
    /sevRaw==='WARNING'\|\|sevRaw==='CRITICAL'/.test(fn),
    'the column is an ENUM, so any other value is a caller error')
  t('endpoint narrows by unacked in SQL',
    /AND e\.acknowledged_at IS NULL/.test(fn))
  // `open` means unacknowledged AND uncleared. The console's toggle means
  // only the first, so reusing `open` would hide a cleared-but-unacknowledged
  // alarm the toggle currently shows.
  t('unacked is a separate parameter from open, not an alias',
    /const unackedOnly=!!q\.unacked/.test(fn) && /if\(unackedOnly && !openOnly\)/.test(fn))
}

// ── 8. Behavioural check of the range maths ───────────────────────────────
// Re-implements only the two lines under test, then asserts the cases the old
// code got wrong.
{
  const QUICK = { 'Last 1 hour': 1, 'Last 24 hours': 24, 'All time': null }
  const mkRange = (quick, from, to, nowMinute) => {
    if (from || to) {
      const s = from !== null ? from : NaN
      const e = to !== null ? to : NaN
      return { start: Number.isFinite(s) ? s : 0, end: Number.isFinite(e) ? e : Infinity }
    }
    const hrs = QUICK[quick] ?? null
    return hrs === null ? { start: 0, end: Infinity } : { start: nowMinute * 60_000 - hrs * 3600_000, end: Infinity }
  }
  const keep = (ts, r) => !(Number.isFinite(ts) && (ts < r.start || ts > r.end))

  const NOW = 1_700_000_000_000
  const nowMinute = Math.floor(NOW / 60_000)
  const hoursAgo = (h) => NOW - h * 3600_000

  // The headline case: a quick range on an UNACKNOWLEDGED alarm.
  const r1h = mkRange('Last 1 hour', null, null, nowMinute)
  t('behaviour: "Last 1 hour" hides an alarm raised 3 hours ago',
    !keep(hoursAgo(3), r1h))
  t('behaviour: "Last 1 hour" keeps an alarm raised 10 minutes ago',
    keep(NOW - 10 * 60_000, r1h))

  // A lone upper bound.
  const rTo = mkRange('Last 24 hours', null, hoursAgo(48), nowMinute)
  t('behaviour: a "To"-only absolute range hides anything after it',
    !keep(hoursAgo(1), rTo))
  t('behaviour: a "To"-only absolute range keeps anything before it',
    keep(hoursAgo(72), rTo))

  // A closed window.
  const rBoth = mkRange('Last 24 hours', hoursAgo(72), hoursAgo(48), nowMinute)
  t('behaviour: a closed absolute range excludes both sides',
    !keep(hoursAgo(96), rBoth) && !keep(hoursAgo(24), rBoth) && keep(hoursAgo(60), rBoth))

  // All time stays a no-op.
  const rAll = mkRange('All time', null, null, nowMinute)
  t('behaviour: "All time" filters nothing',
    keep(hoursAgo(24 * 365), rAll) && keep(NOW, rAll))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
