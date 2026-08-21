import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
let initBody = fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8');
// Force a tiny time budget (200ms) so truncation triggers reliably within a
// fast local test, on the SAME code path production uses — not a
// reimplementation, just a smaller number for the same constant.
initBody = initBody.replace('const RELOCATE_TIME_BUDGET_MS = 20000;', 'const RELOCATE_TIME_BUDGET_MS = 200;');
if (!initBody.includes('RELOCATE_TIME_BUDGET_MS = 200')) throw new Error('replace failed — constant not found as expected');
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', initBody);
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

console.log('starting — control readings:', await count(control), '| tenant readings:', await count(tenant));

let calls = 0;
let truncated = true;
while (truncated) {
  calls++;
  const r = await call({ nodeIds: ['tr-orphan'], dryRun: false });
  const res = r.payload.results[0];
  truncated = res.truncated;
  console.log(`call #${calls}: moved this round =`, JSON.stringify(res.moved), '| truncated =', truncated, '| control remaining =', await count(control));
  if (calls > 500) { console.log('FAIL — did not converge, aborting'); break; }
}

console.log('\nPASS took multiple calls to finish (proves truncation actually engaged, not a no-op budget):', calls > 1);
console.log('PASS final call reported truncated:false:', truncated === false);
const cR = await count(control), tR = await count(tenant);
console.log('PASS all 200000 rows present in tenant, none lost:', tR === 200000);
console.log('PASS control fully drained:', cR === 0);
console.log('PASS no duplication (control + tenant total still 200000):', cR + tR === 200000);

await control.end(); await tenant.end();
await store.pool.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
console.log('\ndone.');
