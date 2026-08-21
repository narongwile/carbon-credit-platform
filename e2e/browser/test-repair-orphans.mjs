import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8'));
  await fn({}, env, { warn: () => {}, send: () => {} }, globalCtx, mysql, jwt, {}, {});
}
const supToken = jwt.sign({ userId: 'u1', role: 'superadmin', name: 'superadmin' }, 'dev-secret-change-me');

async function call(file, payload, params = {}, query = {}) {
  const body = fs.readFileSync(`${SP}/${file}`, 'utf8');
  const msg = { req: { headers: { authorization: `Bearer ${supToken}` }, params, query }, payload };
  let resolveSend;
  const sent = new Promise((r) => { resolveSend = r; });
  const n = { warn: () => {}, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', body);
  return (await fn(msg, env, n, globalCtx)) || sent;
}

const control = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub' });
const tenant = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub_org_eternity' });
const count = async (p, t) => Number((await p.query(`SELECT COUNT(*) AS n FROM ${t} WHERE node_id='tr-orphan'`))[0][0].n);

console.log('BEFORE — control readings:', await count(control, 'readings'), '| control alarm_events:', await count(control, 'alarm_events'), '| tenant readings:', await count(tenant, 'readings'));

console.log('\n--- DRY RUN (the default: must report, must NOT move) ---');
{
  const r = await call('nodesRepairFunc.body.js', { nodeIds: ['tr-orphan'] });
  console.log(JSON.stringify(r.payload, null, 2));
  console.log('PASS dryRun defaulted true:', r.payload.dryRun === true);
  console.log('PASS found the stranded rows:', r.payload.total === 4);
  console.log('PASS nothing actually moved:', (await count(control, 'readings')) === 3 && (await count(tenant, 'readings')) === 1);
}

console.log('\n--- REAL RUN (dryRun:false) ---');
{
  const r = await call('nodesRepairFunc.body.js', { nodeIds: ['tr-orphan'], dryRun: false });
  console.log(JSON.stringify(r.payload, null, 2));
  const cR = await count(control, 'readings'), tR = await count(tenant, 'readings'), cE = await count(control, 'alarm_events'), tE = await count(tenant, 'alarm_events');
  console.log('AFTER — control readings:', cR, '| control alarm_events:', cE, '| tenant readings:', tR, '| tenant alarm_events:', tE);
  console.log('PASS control is now empty of this device:', cR === 0 && cE === 0);
  console.log('PASS tenant has the full merged history (3 orphans + 1 live = 4):', tR === 4);
  console.log('PASS alarm_event relocated too:', tE === 1);
  const [ev] = await tenant.query("SELECT org_id FROM alarm_events WHERE node_id='tr-orphan'");
  console.log('PASS relocated alarm_event org_id corrected to org-eternity (was org-1):', ev[0]?.org_id === 'org-eternity');
}

console.log('\n--- the chart endpoint now returns the WHOLE history, no gap ---');
{
  const r = await call('readingsGetFunc.body.js', {}, { id: 'tr-orphan' }, { sinceMin: '2000', paramKey: 'Hz' });
  const vals = (r.payload || []).map((x) => Number(x.value)).sort();
  console.log('values:', vals);
  console.log('PASS superadmin now sees all 4 points (pre-move history + live):', vals.length === 4);
}

console.log('\n--- re-running the repair is a safe no-op ---');
{
  const r = await call('nodesRepairFunc.body.js', { nodeIds: ['tr-orphan'], dryRun: false });
  console.log('total found on rerun:', r.payload.total, '| repaired:', r.payload.results[0].repaired);
  console.log('PASS idempotent (nothing left to move):', r.payload.total === 0);
}

console.log('\n--- a device that legitimately lives in the control DB is left alone ---');
{
  await control.query("DELETE FROM nodes WHERE id='tr-control'");
  await control.query("INSERT INTO nodes (id,org_id,domain,name,mqtt_prefix,status) VALUES ('tr-control','org-1','transformer','C','t/x/y/c','active')");
  const r = await call('nodesRepairFunc.body.js', { nodeIds: ['tr-control'], dryRun: false });
  console.log(JSON.stringify(r.payload.results[0]));
  console.log('PASS correctly refuses to touch a control-DB device:', r.payload.results[0].repaired === false);
  await control.query("DELETE FROM nodes WHERE id='tr-control'");
}

await control.end(); await tenant.end();
await store.pool.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
console.log('\ndone.');
