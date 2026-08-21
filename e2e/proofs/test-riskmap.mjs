// Run from the repo root: node e2e/proofs/test-riskmap.mjs
// Extracts the REAL generated notify handler out of the built flow, same
// reasoning as test-emailguard.mjs.
import fs from 'node:fs';
const flows = JSON.parse(fs.readFileSync('backend/node-red/flows.nodered-backend.json', 'utf8'));
const flowNode = flows.find((f) => f.type === 'function' && f.name && f.name.startsWith('notify ('));
if (!flowNode) { console.error('FAIL could not find the notify function node — run `node backend/node-red/generate-nodered-backend.mjs` first'); process.exit(1); }
const body = flowNode.func;

let sentSubject = null, sentText = null;
const pool = { query: async () => [[]] };
const globals = {
  pool,
  resolvePool: () => pool,
  mailConfig: async () => ({ transport: null, from: 'x@y.com' }), // no transport -> won't actually send, we just want __riskText/__catText computed without throwing
  notifyConfig: async () => ({}),
};

async function call(paramKey, severity) {
  sentSubject = null; sentText = null;
  const msg = { payload: { nodeId: 'TR-1', orgId: 'org-1', departmentId: null, paramKey, paramLabel: paramKey === 'VoltAN' ? 'Phase A-N Voltage — Over-voltage' : paramKey, severity, kind: 'threshold', value: 255, threshold: 253, unit: 'V', time: new Date().toISOString() } };
  const node = { send: () => {}, warn: () => {}, error: (e) => console.log('  [node.error]', e) };
  const env = { get: () => '' };
  const global = { get: (k) => globals[k] };
  // Capture the __riskText/__catText by intercepting right before the emailPlain text is built —
  // simplest: just run the function and grep its thrown/console output isn't available, so instead
  // wrap: replace 'const text =' assembly point is internal; easiest is to eval and inspect via a
  // sentinel — append a return of text/subject for this test.
  const wrapped = body.replace(
    "const subject = 'ONEOPS '",
    "global.get('__capture')(text, __catText, __riskText); const subject = 'ONEOPS '"
  );
  globals.__capture = (text, cat, risk) => { sentText = text; sentSubject = cat + ' | ' + risk; };
  const fn = new Function('msg', 'node', 'env', 'global', wrapped);
  try { await fn(msg, node, env, global); } catch (e) { console.log('  [throw]', e.message); }
  await new Promise((r) => setTimeout(r, 50));
}

let pass = 0, fail = 0;
const t = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); cond ? pass++ : fail++; };

await call('VoltAN', 'CRITICAL');
t('VoltAN CRITICAL resolves a REAL risk description, not the generic fallback',
  sentSubject && !sentSubject.includes('Parameter limit breached'), `got: ${sentSubject}`);
t('VoltAN risk text mentions equipment damage AND brownout (direction-neutral but specific)',
  sentSubject && sentSubject.includes('equipment damage') && sentSubject.includes('trip/brownout'), `got: ${sentSubject}`);
t('category is Voltage', sentSubject && sentSubject.startsWith('Voltage |'), `got: ${sentSubject}`);

await call('VoltUnbalanceAN', 'WARNING');
t('VoltUnbalanceAN WARNING resolves a real, phase-specific message',
  sentSubject && sentSubject.includes('Phase A voltage unbalance high'), `got: ${sentSubject}`);

await call('someTrulyUnknownKey', 'WARNING');
t('a genuinely unknown key still falls back gracefully (no throw, no blank)',
  sentSubject && sentSubject.includes('Warning threshold reached'), `got: ${sentSubject}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
