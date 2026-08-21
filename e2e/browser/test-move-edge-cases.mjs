import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const initBody = fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8');
const moveFnBody = fs.readFileSync(`${SP}/nodesMoveFunc.body.js`, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
const node = { warn: (m) => console.log('  [warn]', m), send: () => {} };
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', initBody);
  await fn({}, env, node, globalCtx, mysql, jwt, {}, {});
}
const token = jwt.sign({ userId: 'u1', role: 'superadmin', name: 'superadmin' }, 'dev-secret-change-me');
async function runMove(nodeIds, targetOrgId) {
  const msg = { req: { headers: { authorization: `Bearer ${token}` }, params: {}, query: {} }, payload: { nodeIds, targetOrgId } };
  let resolveSend;
  const sent = new Promise((res) => { resolveSend = res; });
  const sendingNode = { warn: node.warn, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', moveFnBody);
  const syncResult = await fn(msg, env, sendingNode, globalCtx);
  return syncResult || sent;
}

const control = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub' });

console.log('--- Case A: same-pool move (org-1 -> org-2, both control-pool) ---');
{
  await control.query("DELETE FROM nodes WHERE id='tr-samepool'");
  await control.query("DELETE FROM alarm_rules WHERE node_id='tr-samepool'");
  await control.query("INSERT INTO nodes (id,org_id,domain,name,mqtt_prefix,status) VALUES ('tr-samepool','org-1','transformer','SP','telemetry/org-1/eternity/tr-samepool','active')");
  await control.query("INSERT INTO alarm_rules (node_id,org_id,domain,rule_json) VALUES ('tr-samepool','org-1','transformer',JSON_OBJECT('oilTemp',JSON_OBJECT('warn',70)))");
  const r = await runMove(['tr-samepool'], 'org-2');
  console.log('result:', JSON.stringify(r.payload));
  const [[n]] = await control.query("SELECT org_id FROM nodes WHERE id='tr-samepool'");
  console.log('PASS node moved to org-2 (still control DB, one UPDATE):', n.org_id === 'org-2');
  const [[ar]] = await control.query("SELECT org_id FROM alarm_rules WHERE node_id='tr-samepool'");
  console.log('PASS alarm_rules.org_id corrected in place (no copy needed):', ar.org_id === 'org-2');
  const [rows] = await control.query("SELECT COUNT(*) AS n FROM alarm_rules WHERE node_id='tr-samepool'");
  console.log('PASS exactly one alarm_rules row (no duplicate from a copy path):', Number(rows[0].n) === 1);
}

console.log('\n--- Case B: moving to the SAME org is a safe no-op ---');
{
  const r = await runMove(['tr-samepool'], 'org-2');
  console.log('result:', JSON.stringify(r.payload));
  console.log('PASS reports moved:false, ok:true:', r.payload.results[0].ok === true && r.payload.results[0].moved === false);
}

console.log('\n--- Case C: target org does not exist ---');
{
  const r = await runMove(['tr-samepool'], 'org-does-not-exist');
  console.log('result:', JSON.stringify(r.payload));
  console.log('PASS reports ok:false with a clear error, nothing thrown:', r.payload.results[0].ok === false && /does not exist|suspended/.test(r.payload.results[0].error));
}

console.log('\n--- Case D: moving a secondary feed WITHOUT its primary is refused up front ---');
{
  await control.query("DELETE FROM nodes WHERE id IN ('tr-primary','tr-secondary')");
  await control.query("INSERT INTO nodes (id,org_id,domain,name,mqtt_prefix,status,merge_into) VALUES ('tr-primary','org-1','transformer','P','telemetry/org-1/eternity/tr-primary','active',NULL)");
  await control.query("INSERT INTO nodes (id,org_id,domain,name,mqtt_prefix,status,merge_into) VALUES ('tr-secondary','org-1','transformer','S','telemetry/org-1/eternity/tr-secondary','active','tr-primary')");
  const r = await runMove(['tr-secondary'], 'org-2');
  console.log('statusCode:', r.statusCode, '| error:', r.payload.error);
  console.log('PASS refused (400) with an actionable message, nothing moved:', r.statusCode === 400 && /tr-primary/.test(r.payload.error));
  const [[n]] = await control.query("SELECT org_id FROM nodes WHERE id='tr-secondary'");
  console.log('PASS tr-secondary untouched (still org-1):', n.org_id === 'org-1');
}

console.log('\n--- Case E: moving BOTH together succeeds ---');
{
  const r = await runMove(['tr-primary', 'tr-secondary'], 'org-2');
  console.log('result:', JSON.stringify(r.payload));
  console.log('PASS both moved together:', r.payload.ok === true);
}

console.log('\n--- Case F: unknown node id ---');
{
  const r = await runMove(['does-not-exist-xyz'], 'org-2');
  console.log('statusCode:', r.statusCode, '| error:', r.payload.error);
  console.log('PASS 404 with the missing id named:', r.statusCode === 404 && /does-not-exist-xyz/.test(r.payload.error));
}

console.log('\n--- Case G: a PENDING device is refused (this endpoint is for active devices only) ---');
{
  await control.query("DELETE FROM nodes WHERE id='tr-pending-test'");
  await control.query("INSERT INTO nodes (id,org_id,domain,name,mqtt_prefix,status) VALUES ('tr-pending-test','org-1','transformer','PT','telemetry/org-1/eternity/tr-pending-test','pending')");
  const r = await runMove(['tr-pending-test'], 'org-2');
  console.log('result:', JSON.stringify(r.payload));
  console.log('PASS refused, points at approve instead:', r.payload.results[0].ok === false && /pending/.test(r.payload.results[0].error));
}

await control.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
try { await store.pool.end(); } catch {}
console.log('\ndone.');
