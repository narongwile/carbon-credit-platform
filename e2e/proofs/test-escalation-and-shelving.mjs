// Guards the escalation sweep and ISA-18.2 maintenance shelving.
//
// THE BUGS THIS LOCKS OUT
// -----------------------
// 1. The escalation sweep threw on its FIRST org, every tick.
//
//    9e445d5f added a per-org policy lookup and named its result the same as
//    the module-level default:
//
//        const ESCALATE_MIN = Number(env.get('ESCALATE_AFTER_MIN') || 15);
//        for (const __org of ...) {
//          let orgEscalateMin = ESCALATE_MIN;      // <-- reads the INNER one
//          ...
//          const ESCALATE_MIN = orgEscalateMin;    // <-- same block
//
//    `const` is block-scoped and hoisted into a temporal dead zone, so the
//    seeding line resolves to the SHADOW, not the outer default, and throws
//        ReferenceError: Cannot access 'ESCALATE_MIN' before initialization
//    on the first iteration. No tier ever fired for any org. The trailing
//    .catch turned a total feature outage into one node.error line a minute,
//    and eslint only reported it as "outer ESCALATE_MIN assigned but never
//    used" — because every in-loop reference resolved to the shadow.
//
// 2. A parameter-scoped maintenance shelf did not silence escalations.
//
//    notify's shelf check matches
//        s.paramKey === 'all' || s.paramKey === e.paramKey
//    but the escalation payload carried no paramKey at all. Shelving ONE
//    parameter therefore suppressed the first alert and let the escalation
//    through at CRITICAL minutes later — the nuisance alarm the operator
//    believed they had silenced, arriving louder.
//
// 3. The escalation-policy "Test" button could not fail. It resolved a pool,
//    never queried it, and always returned "Escalation matrix policy verified"
//    — including for an org with escalation disabled and no channel to
//    escalate through.
//
// Run from the repo root: node e2e/proofs/test-escalation-and-shelving.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const flows = JSON.parse(readFileSync(new URL('backend/node-red/flows.nodered-backend.json', root), 'utf8'))
const byId = (id) => flows.find((n) => n.id === id)

// ── 1. The sweep must actually RUN ────────────────────────────────────────
// Executed, not pattern-matched: a shadowing/TDZ bug is invisible to a regex
// and fatal at runtime, which is exactly why it shipped.
{
  const esc = byId('escalate')
  if (!esc) {
    t('escalate handler present', false)
  } else {
    const calls = []
    const env = { get: (k) => (k === 'ESCALATE_AFTER_MIN' ? '15' : undefined) }
    const node = { send: (m) => calls.push(m), error: (m) => calls.push({ __err: m }), warn: () => {}, log: () => {} }
    // One org, one unacknowledged CRITICAL, no stored policy.
    const row = {
      id: 'ev1', node_id: 'tr-001', org_id: 'org-1', department_id: null,
      param_key: 'oilTemp', param_label: 'Oil Temperature', kind: 'threshold',
      value: 95, unit: '°C', threshold: 85, raised_at: new Date(0).toISOString(),
    }
    let tierQueries = 0
    const pool = {
      query: async (sql) => {
        if (/platform_settings/.test(sql)) return [[]]           // no org policy
        if (/FROM alarm_events/.test(sql)) { tierQueries++; return [tierQueries === 1 ? [row] : []] }
        if (/UPDATE alarm_events/.test(sql)) return [{ affectedRows: 1 }]
        return [[]]
      },
      escape: (v) => `'${v}'`,
    }
    const globalCtx = { get: (k) => ({ pool, resolvePool: () => pool, sweepOrgs: async () => ['org-1'] }[k]) }

    let threw = null
    try {
      new Function('env', 'node', 'global', 'msg', esc.func)(env, node, globalCtx, {})
    } catch (e) { threw = e }
    await new Promise((r) => setTimeout(r, 250))

    const errs = calls.filter((c) => c && c.__err)
    t('the escalation sweep runs without throwing',
      !threw && errs.length === 0,
      threw ? String(threw.message) : (errs[0] ? String(errs[0].__err) : ''))

    const sent = calls.filter((c) => c && c.payload)
    t('an unacknowledged CRITICAL past the timeout produces an escalation',
      sent.length > 0, `${sent.length} sent`)

    // ── 2. and it must carry paramKey, or a param shelf cannot match ──────
    t('the escalation payload carries paramKey for the maintenance-shelf check',
      sent.length > 0 && sent.every((m) => m.payload.paramKey === 'oilTemp'),
      sent.length ? `paramKey=${JSON.stringify(sent[0].payload.paramKey)}` : 'nothing sent')

    t('the escalation payload carries nodeId and orgId the shelf check needs',
      sent.length > 0 && sent.every((m) => m.payload.nodeId === 'tr-001' && m.payload.orgId === 'org-1'))

    // The tier labels state elapsed time, never a recipient tier that does not
    // exist — escalate wires only to notify, and nothing reads escalationLevel.
    for (const role of ['Dept Lead', 'Duty Engineer', 'Executive Admin', 'to Leadership']) {
      t(`escalation text does not name a "${role}" recipient`, !esc.func.includes(role))
    }
    t('escalate still wires only to notify',
      JSON.stringify(esc.wires) === '[["notify"]]')
  }
}

// ── 3. A disabled org policy stops the sweep ──────────────────────────────
{
  const esc = byId('escalate')
  const calls = []
  const env = { get: () => '15' }
  const node = { send: (m) => calls.push(m), error: () => {}, warn: () => {}, log: () => {} }
  const pool = {
    query: async (sql) => {
      if (/platform_settings/.test(sql)) return [[{ sval: JSON.stringify({ enabled: false, timeoutMins: 15 }) }]]
      if (/FROM alarm_events/.test(sql)) return [[{ id: 'x', node_id: 'n', org_id: 'o', param_key: 'k', param_label: 'l', kind: 'threshold', value: 1, threshold: 0, raised_at: new Date(0).toISOString() }]]
      return [[]]
    },
    escape: (v) => `'${v}'`,
  }
  const globalCtx = { get: (k) => ({ pool, resolvePool: () => pool, sweepOrgs: async () => ['org-1'] }[k]) }
  new Function('env', 'node', 'global', 'msg', esc.func)(env, node, globalCtx, {})
  await new Promise((r) => setTimeout(r, 250))
  t('an org that turned escalation OFF gets no escalation',
    calls.filter((c) => c && c.payload).length === 0)
}

// ── 4. Shelving is enforced where alarms are DELIVERED ────────────────────
// A shelf that only lives in a settings table and a UI list is decorative.
{
  const notify = byId('notify')
  t('notify checks the maintenance shelf before delivering',
    /maintenance_shelving/.test(notify?.func || ''))
  t('the shelf match honours both whole-device and per-parameter scope',
    /s\.paramKey === 'all' \|\| s\.paramKey === e\.paramKey/.test(notify?.func || ''))
  t('an expired shelf stops suppressing',
    /new Date\(s\.expiresAt\)\.getTime\(\) > nowMs/.test(notify?.func || ''),
    'a shelf with no expiry check silences the asset forever')
  t('a shelved alarm is still recorded, only its delivery is suppressed',
    /Alarms remain logged for audit/.test(notify?.func || ''))
}

// ── 5. The policy "Test" button must be able to fail ──────────────────────
{
  const fn = byId('escpolicytest_fn')?.func || ''
  t('the escalation-policy test reads the stored policy',
    /SELECT sval FROM platform_settings WHERE skey=\?/.test(fn) && /escalation_policy\./.test(fn),
    'it used to resolve a pool, never query, and always return ok')
  t('the test reports a disabled policy as a problem',
    /escalation is turned OFF/.test(fn))
  t('the test reports having nowhere to deliver',
    /no enabled notification channel/.test(fn),
    'escalation reuses the org channels, so zero channels means it escalates into nothing')
  t('the test can return ok:false',
    /ok: problems\.length === 0/.test(fn),
    'a verification that cannot fail verifies nothing')
  t('the test says where the timeout came from',
    /platform default \(ESCALATE_AFTER_MIN\)/.test(fn))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
