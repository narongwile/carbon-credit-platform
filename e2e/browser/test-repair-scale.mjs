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

async function call(payload) {
  const body = fs.readFileSync(`${SP}/nodesRepairFunc.body.js`, 'utf8');
  const msg = { req: { headers: { authorization: `Bearer ${supToken}` }, params: {}, query: {} }, payload };
  let resolveSend;
  const sent = new Promise((r) => { resolveSend = r; });
  const n = { warn: () => {}, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', body);
  return (await fn(msg, env, n, globalCtx)) || sent;
}

const control = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub' });
const tenant = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub_org_eternity' });
const count = async (p) => Number((await p.query("SELECT COUNT(*) AS n FROM readings WHERE node_id='tr-orphan'"))[0][0].n);

console.log('BEFORE — control readings:', await count(control), '| tenant readings:', await count(tenant));

console.log('\n--- dry run (5500 rows, spans 5 full batches + 1 partial of 500) ---');
{
  const t0 = Date.now();
  const r = await call({ nodeIds: ['tr-orphan'] });
  console.log('elapsed:', Date.now() - t0, 'ms | found:', JSON.stringify(r.payload.results[0].found));
  console.log('PASS found all 5500, nothing moved yet:', r.payload.results[0].total === 5500 && (await count(control)) === 5500);
}

console.log('\n--- real run — this is what timed out at 504 before batching ---');
{
  const t0 = Date.now();
  const r = await call({ nodeIds: ['tr-orphan'], dryRun: false });
  const elapsed = Date.now() - t0;
  console.log('elapsed:', elapsed, 'ms');
  console.log(JSON.stringify(r.payload.results[0]));
  const cR = await count(control), tR = await count(tenant);
  console.log('control readings after:', cR, '| tenant readings after:', tR);
  console.log('PASS all 5500 rows moved, none lost, none duplicated:', cR === 0 && tR === 5500);
  console.log('PASS completed comfortably under a 60s gateway timeout:', elapsed < 30000);
}

console.log('\n--- re-run is a clean no-op ---');
{
  const r = await call({ nodeIds: ['tr-orphan'], dryRun: false });
  console.log('total on rerun:', r.payload.total);
  console.log('PASS idempotent:', r.payload.total === 0);
}

console.log('\n--- spot-check: values preserved exactly, not corrupted by batching ---');
{
  const [rows] = await tenant.query("SELECT value FROM readings WHERE node_id='tr-orphan' ORDER BY taken_at LIMIT 3");
  console.log('first 3 values after move:', rows.map((r) => Number(r.value)));
  const [rowsControl] = await control.query("SELECT COUNT(*) AS n FROM readings WHERE node_id='tr-orphan'");
  console.log('PASS control fully drained:', Number(rowsControl[0].n) === 0);
}

await control.end(); await tenant.end();
await store.pool.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
console.log('\ndone.');
