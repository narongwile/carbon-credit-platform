// Proves a firmware-raised alarm reaches the operator.
//
// The Alarm List's "External Fault/Event" (animals, lightning, a grid
// incident) is not a threshold the cloud computes from a reading — it is an
// event the device reports, published on P/alarm/{sid} as
// {edge:true, severity, sid, value}.
//
// That path used to dead-end: the handler wrote edge_alarm_log and its flow
// node had no downstream wire ([[]]). Nothing reads edge_alarm_log — no
// endpoint selects from it, no page renders it — so the fault never reached
// the alarm list, never notified anyone, and never escalated.
//
// Runs the REAL generated handler extracted from the built flow against a
// stub pool, so this breaks if the deployed behaviour changes.
//
// Run from the repo root: node e2e/proofs/test-edge-alarm-surfaces.mjs
import fs from 'node:fs';

const flows = JSON.parse(fs.readFileSync('backend/node-red/flows.nodered-backend.json', 'utf8'));
const node = flows.find((f) => f.type === 'function' && f.name && f.name.startsWith('edge alarm persist'));
if (!node) { console.error('FAIL could not find the edge alarm node — regenerate the flow first'); process.exit(1); }

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

/** Drives the real handler. `openAlarm` simulates an already-firing alarm. */
async function run({ severity = 'WARNING', openAlarm = false, value = 1 } = {}) {
  const queries = [];
  const sent = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM alarm_rules/.test(sql)) {
        return [[{ rule_json: JSON.stringify({ dwellMin: 5, params: [
          { key: 'externalFault', label: 'External Fault / Event', unit: '', direction: 'high', warn: 1, critical: 2 },
        ] }) }]];
      }
      if (/FROM alarm_events/.test(sql)) return [openAlarm ? [{ 1: 1 }] : []];
      if (/FROM nodes/.test(sql)) return [[{ department_id: 'dep-1' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const globals = {
    pool,
    resolvePool: () => pool,
    orgOfNode: async () => 'org-1',
  };
  const msg = { payload: { nodeId: 'tr-221', paramKey: 'externalFault', severity, value, ts: Date.UTC(2026, 0, 1) } };
  const nodeApi = { send: (m) => sent.push(m), warn: () => {}, error: (e) => console.log('  [node.error]', e) };
  const fn = new Function('msg', 'node', 'global', node.func);
  fn(msg, nodeApi, { get: (k) => globals[k] });
  await new Promise((r) => setTimeout(r, 60));
  return { queries, sent };
}

// ---- 1. an external fault reaches alarm_events AND the notifier ----
{
  const { queries, sent } = await run({ severity: 'WARNING' });
  const wroteLog = queries.some((q) => /INSERT INTO edge_alarm_log/.test(q.sql));
  const wroteEvent = queries.some((q) => /INSERT IGNORE INTO alarm_events/.test(q.sql));
  t('still recorded in edge_alarm_log (provenance kept)', wroteLog);
  t('now ALSO written to alarm_events, where the UI and escalation scan look', wroteEvent);
  t('a message is emitted downstream to the notifier', sent.length === 1, `${sent.length} sent`);

  const ev = sent[0]?.payload ?? {};
  t('the emitted event is tagged source=edge', ev.source === 'edge', `source=${ev.source}`);
  t('severity is carried through as WARNING', ev.severity === 'WARNING', `severity=${ev.severity}`);
  t('it carries the rule label, not the bare key',
    ev.paramLabel === 'External Fault / Event', `label=${ev.paramLabel}`);

  const insert = queries.find((q) => /INSERT IGNORE INTO alarm_events/.test(q.sql));
  t("alarm_events row is stored with source 'edge'", /'edge'/.test(insert.sql));
  t('the threshold comes from the rule (warn=1 for a WARNING)',
    insert.params.includes(1), `params=${JSON.stringify(insert.params)}`);
}

// ---- 2. Notice maps onto WARNING, per the Alarm List ----
{
  const { sent } = await run({ severity: 'NOTICE' });
  t('an unrecognised severity is treated as WARNING, not dropped',
    sent[0]?.payload?.severity === 'WARNING', `severity=${sent[0]?.payload?.severity}`);
}

// ---- 3. CRITICAL is preserved ----
{
  const { sent } = await run({ severity: 'CRITICAL' });
  t('CRITICAL stays CRITICAL', sent[0]?.payload?.severity === 'CRITICAL');
}

// ---- 4. no notification storm while the same alarm is already open ----
{
  const { queries, sent } = await run({ severity: 'WARNING', openAlarm: true });
  t('an already-open alarm is not raised again', sent.length === 0, `${sent.length} sent`);
  t('and no duplicate alarm_events row is written',
    !queries.some((q) => /INSERT IGNORE INTO alarm_events/.test(q.sql)));
  t('but the edge_alarm_log entry is still recorded',
    queries.some((q) => /INSERT INTO edge_alarm_log/.test(q.sql)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
