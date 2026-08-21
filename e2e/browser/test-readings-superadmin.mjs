import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
const node = { warn: () => {}, send: () => {} };
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8'));
  await fn({}, env, node, globalCtx, mysql, jwt, {}, {});
}
const body = fs.readFileSync(`${SP}/readingsGetFunc.body.js`, 'utf8');

async function readingsAs(claims) {
  const token = jwt.sign(claims, 'dev-secret-change-me');
  const msg = { req: { headers: { authorization: `Bearer ${token}` }, params: { id: 'tr-splittest' }, query: { sinceMin: '600', paramKey: 'Hz' } } };
  let resolveSend;
  const sent = new Promise((r) => { resolveSend = r; });
  const n = { warn: () => {}, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', body);
  const sync = await fn(msg, env, n, globalCtx);
  return sync || sent;
}

console.log('Seeded: CONTROL db has 2 stale rows (49.95/49.96), TENANT db has 3 live rows (50.01/50.02/50.03)\n');

console.log('--- as the org admin (orgId=org-eternity) ---');
{
  const r = await readingsAs({ userId: 'u2', role: 'admin', orgId: 'org-eternity' });
  const vals = (r.payload || []).map((x) => Number(x.value));
  console.log('values:', vals);
  console.log('PASS admin sees the LIVE tenant data:', vals.includes(50.03));
}

console.log('\n--- as the SUPERADMIN (no orgId — the reported bug) ---');
{
  const r = await readingsAs({ userId: 'u1', role: 'superadmin', name: 'superadmin' });
  const vals = (r.payload || []).map((x) => Number(x.value));
  console.log('values:', vals);
  console.log('PASS superadmin sees the SAME live tenant data, not the stale control rows:', vals.includes(50.03));
  console.log('PASS superadmin is NOT reading the stale control-db rows:', !vals.includes(49.95) && !vals.includes(49.96));
}

await store.pool.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
console.log('\ndone.');
