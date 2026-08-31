// A personal alarm threshold is PRIVATE. This proves its breaches stay that
// way — in storage, in the read path, and in the acknowledge path.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// 42c9e19a added "personal alarm audit logging & console" by writing each
// personal breach into the SHARED alarm_events table, tagging it by putting
// 'PERSONAL:<userId>' into the `source` column:
//
//     INSERT IGNORE INTO alarm_events (..., source, ...)
//     VALUES (..., 'PERSONAL:' + u.id, ...)
//
// `source` is declared ENUM('edge','cloud') NOT NULL DEFAULT 'cloud'
// (schema.sql, migrate-v50). The value does not fit. Because the statement was
// INSERT IGNORE, MySQL downgraded the truncation ERROR to a warning and stored
// the ENUM's empty error member instead of rejecting the row. Two failures:
//
//  1. The console reads it back with
//         rows.filter(r => r.source === 'PERSONAL:' + userId)
//     which can never match ''. The personal history was permanently empty —
//     the feature could not work at all, in any deployment.
//
//  2. Much worse, the row still landed in alarm_events, indistinguishable from
//     a real organization alarm. A threshold whose entire purpose is that it
//     "does not change the device's official alarm state that others see" then:
//       · appeared in /admin/alarms for the whole organization,
//       · counted toward the sidebar badge and the open-alarm totals,
//       · went into exported CSV/PDF reports, and
//       · being severity CRITICAL with acknowledged_at and cleared_at NULL,
//         was picked up by escalationFunc — which re-alerted one person's
//         private early-warning threshold to their entire department.
//
// The fix is a separate table (migrate-v59), so "not visible to anyone else"
// holds by construction rather than depending on every present and future
// org-wide query remembering to exclude these rows.
//
// Run from the repo root: node e2e/proofs/test-personal-alarm-privacy.mjs

import { readFileSync, readdirSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '')

const gen = strip(read('backend/node-red/generate-nodered-backend.mjs'))
const flows = JSON.parse(read('backend/node-red/flows.nodered-backend.json'))

// ── 1. Storage: never the shared table, never the ENUM column ─────────────
t('no personal event is written into the shared alarm_events table',
  !/INSERT[^;]{0,400}?INTO alarm_events[^;]{0,400}?PERSONAL:/i.test(gen),
  'a personal breach in alarm_events is visible to the whole org and escalates')

t("nothing writes 'PERSONAL:' into any column",
  !/'PERSONAL:'/.test(gen),
  "source is ENUM('edge','cloud'); INSERT IGNORE stored '' and the tag vanished")

t('personal breaches go to their own table',
  /INSERT IGNORE INTO personal_alarm_events/.test(gen))

// ── 2. The table exists, with the columns the code writes ─────────────────
const sqlDir = new URL('backend/sql/', root)
const allSql = readdirSync(sqlDir).filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(f, sqlDir), 'utf8')).join('\n')

t('a migration creates personal_alarm_events',
  /CREATE TABLE IF NOT EXISTS personal_alarm_events/i.test(allSql))
for (const col of ['user_id', 'node_id', 'param_key', 'severity', 'raised_at', 'acknowledged_at']) {
  t(`personal_alarm_events declares ${col}`,
    new RegExp(`personal_alarm_events[\\s\\S]{0,1200}?\\b${col}\\b`, 'i').test(allSql))
}
// The rows the broken INSERT already wrote must be cleaned up, or they keep
// inflating every org's console and escalating strangers' private thresholds.
t('the migration removes the rows the broken INSERT already wrote',
  /DELETE FROM alarm_events WHERE id LIKE 'pevt/i.test(allSql))

// ── 3. Read path: scoped server-side, never by a client parameter ─────────
const evNode = flows.find((n) => n.id === 'personalevents_fn')
if (!evNode) {
  t('GET /api/nodes/:id/personal-events exists', false)
} else {
  const fn = evNode.func
  t('personal-events reads the user from the verified session, not the request',
    /const uid=\(msg\.auth&&msg\.auth\.userId\)\|\|''/.test(fn) &&
    !/req\.query\.user|req\.params\.userId|payload\.userId/.test(fn),
    'whose events these are must not be a request parameter')
  t('personal-events filters by user_id in SQL',
    /FROM personal_alarm_events WHERE user_id=\? AND node_id=\?/.test(fn) &&
    /\[uid,id\]/.test(fn),
    'a client-side "only mine" filter is not a privacy boundary')
  t('personal-events refuses an unauthenticated caller',
    /if\(!uid\)[\s\S]{0,80}statusCode=401/.test(fn))
  t('personal-events is bounded',
    /LIMIT 200/.test(fn))
}

// ── 4. Acknowledge path is scoped the same way ────────────────────────────
const ackNode = flows.find((n) => n.id === 'personaleventack_fn')
if (!ackNode) {
  t('POST /api/nodes/:id/personal-events/:eventId/ack exists', false)
} else {
  const fn = ackNode.func
  t('acknowledging a personal event requires it to be YOURS',
    /UPDATE personal_alarm_events SET[\s\S]{0,200}?WHERE id=\? AND user_id=\? AND node_id=\?/.test(fn),
    'without user_id in the WHERE, guessing an id acknowledges someone else’s alarm')
  t('acknowledge refuses an unauthenticated caller',
    /if\(!uid\)[\s\S]{0,80}statusCode=401/.test(fn))
  t('acknowledge reports a miss instead of claiming success',
    /if\(!r\.affectedRows\)[\s\S]{0,80}statusCode=404/.test(fn))
}

// ── 5. Both endpoints are registered under a policy ───────────────────────
t('both personal-event endpoints are registered',
  /endpoint\('personalevents', 'get', '\/api\/nodes\/:id\/personal-events'[^)]*'node'\)/.test(gen) &&
  /endpoint\('personaleventack', 'post', '\/api\/nodes\/:id\/personal-events\/:eventId\/ack'[^)]*'node'\)/.test(gen),
  "policy 'node' enforces node.org_id === claims.orgId plus per-domain access")

// ── 6. The console uses the scoped endpoint, not a client-side filter ─────
const settings = strip(read('frontend-next/src/components/device/MyAlertSettings.tsx'))
t('the console calls the scoped endpoint',
  /api\.myPersonalEvents\(nodeId\)/.test(settings))
t('the console no longer filters org events by a source prefix',
  !/startsWith\('PERSONAL'\)/.test(settings) && !/'PERSONAL:' \+/.test(settings),
  'that fallback would also have shown OTHER users’ personal breaches')
t('the console acknowledges through the personal endpoint',
  /api\.ackMyPersonalEvent\(nodeId, evtId/.test(settings),
  'api.ackEvent writes alarm_events and has no user_id scope')

// ── 7. Escalation labels must not name recipients that do not exist ───────
// The three-tier cadence (ESCALATE_MIN / x2 / x4) is real and an improvement
// on the old single escalation. The ROUTING is not: all three node.send()
// calls go to the same `notify` node, nothing reads escalationLevel, and the
// platform has no dept-lead / duty-engineer / executive recipient concept.
{
  const esc = flows.find((n) => n.id === 'escalate')
  const notify = flows.find((n) => n.id === 'notify')
  t('escalate still wires only to notify',
    JSON.stringify(esc?.wires) === '[["notify"]]',
    'if per-tier routing is ever added, this assertion is the place to revisit')
  t('nothing consumes escalationLevel, so tier labels must not promise routing',
    !/escalationLevel/.test(notify?.func || ''))
  for (const role of ['Dept Lead', 'Duty Engineer', 'Executive Admin', 'to Leadership']) {
    t(`escalation text does not name a "${role}" recipient tier`,
      !(esc?.func || '').includes(role),
      'this string is delivered to an engineer who acts on it')
  }
  t('escalation labels state the elapsed time instead',
    /unacknowledged ' \+ ESCALATE_MIN/.test(esc?.func || ''))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
