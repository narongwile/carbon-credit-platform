import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const initBody = fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8');

const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
const node = { warn: () => {}, send: () => {} };
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', initBody);
  await fn({}, env, node, globalCtx, mysql, jwt, {}, {});
}

const supToken = jwt.sign({ userId: 'u1', role: 'superadmin', name: 'superadmin' }, 'dev-secret-change-me');

async function callSendStyle(bodySrc, msg) {
  let resolveSend;
  const sent = new Promise((res) => { resolveSend = res; });
  const sendingNode = { warn: () => {}, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', bodySrc);
  const syncResult = await fn(msg, env, sendingNode, globalCtx);
  return syncResult || sent;
}

function reqMsg(params, payload) {
  return { req: { headers: { authorization: `Bearer ${supToken}` }, params, query: {} }, payload: payload || {} };
}

console.log('--- BEFORE move: rule/events/photos should resolve fine from org-1 (control pool) ---');
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/getRuleFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  console.log('GET rule before move:', r.statusCode ?? 200, JSON.stringify(r.payload));
}
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/getEventsFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  console.log('GET events before move: count =', Array.isArray(r.payload) ? r.payload.length : r.payload);
}
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/nodePhotosListFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  console.log('GET photos before move:', JSON.stringify(r.payload?.photos?.map((p) => p.caption)));
}

console.log('\n--- MOVE tr-cachetest from org-1 to org-eternity ---');
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/nodesMoveFunc.body.js`, 'utf8'), reqMsg({}, { nodeIds: ['tr-cachetest'], targetOrgId: 'org-eternity' }));
  console.log('move result:', JSON.stringify(r.payload));
}

console.log('\n--- AFTER move: rule/events/photos must resolve from the NEW org (org-eternity), not 404/empty from stale control-pool lookups ---');
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/getRuleFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  console.log('GET rule after move:', r.statusCode ?? 200, JSON.stringify(r.payload));
  console.log('PASS rule found post-move (not 404):', (r.statusCode ?? 200) === 200 && r.payload?.oilTemp?.warn === 70);
}
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/getEventsFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  const n = Array.isArray(r.payload) ? r.payload.length : 0;
  console.log('GET events after move: count =', n);
  console.log('PASS alarm event found post-move (this is what backs "Active Alarms"):', n === 1);
}
{
  // This is the exact photo-caching bug: without the nodeOrgCache
  // invalidation fix, this would still be served from org-1 (control pool)
  // where the row no longer exists (moveNodeToOrg deleted it there) —
  // returning an EMPTY list even though the photo genuinely still exists,
  // just relocated to org-eternity's own database.
  const r = await callSendStyle(fs.readFileSync(`${SP}/nodePhotosListFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }));
  console.log('GET photos after move:', JSON.stringify(r.payload?.photos?.map((p) => p.caption)));
  console.log('PASS photo still found post-move (nodeOrgCache invalidated, not stale):', r.payload?.photos?.length === 1 && r.payload.photos[0].caption === 'before move');
}

console.log('\n--- PUT rule after move: must land in the NEW org db, not write a stray row into a random pool ---');
{
  const r = await callSendStyle(fs.readFileSync(`${SP}/putRuleFunc.body.js`, 'utf8'), reqMsg({ id: 'tr-cachetest' }, { rule: { domain: 'transformer', oilTemp: { warn: 80 } }, updatedBy: 'test' }));
  console.log('PUT rule result:', JSON.stringify(r.payload));
  const eternity = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub_org_eternity' });
  const [rows] = await eternity.query('SELECT org_id, rule_json FROM alarm_rules WHERE node_id=?', ['tr-cachetest']);
  console.log('eternity DB alarm_rules after PUT:', JSON.stringify(rows));
  const parsedRule = typeof rows[0]?.rule_json === 'string' ? JSON.parse(rows[0].rule_json) : rows[0]?.rule_json;
  console.log('PASS PUT landed in org-eternity with correct org_id (not org-1, not blank):', rows.length === 1 && rows[0].org_id === 'org-eternity' && parsedRule?.oilTemp?.warn === 80);
  const control = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub' });
  const [stray] = await control.query('SELECT COUNT(*) AS n FROM alarm_rules WHERE node_id=? AND org_id=?', ['tr-cachetest', '']);
  console.log('PASS no stray empty-org_id row left in control DB:', Number(stray[0].n) === 0);
  await eternity.end(); await control.end();
}

await store.pool.end();
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
console.log('\ndone.');
