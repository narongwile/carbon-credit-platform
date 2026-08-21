import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
import jwt from '/home/user/carbon-credit-platform/backend/node_modules/jsonwebtoken/index.js';

const SP = './screenshots';
const initBody = fs.readFileSync(`${SP}/initFunc.body.js`, 'utf8');
const moveFnBody = fs.readFileSync(`${SP}/nodesMoveFunc.body.js`, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// Real store, exactly what Node-RED's flow-global context is: a plain object
// with get/set, shared across every function node in the flow.
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const ENV = {
  TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306',
  DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub',
};
const env = { get: (k) => ENV[k] };
const node = { warn: (m) => console.log('  [warn]', m), send: () => {} };

// Run the ACTUAL generated init function body — same execution shape
// Node-RED gives it (msg/env/node/global in scope). It only opens the
// control pool and registers helpers onto global; no MQTT/timers, confirmed
// by inspection before writing this test.
{
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', 'mysql', 'jwt', 'nodemailer', 'CryptoJS', initBody);
  await fn({}, env, node, globalCtx, mysql, jwt, {}, {});
}
console.log('init ran. helpers registered:', ['pool', 'resolvePool', 'moveNodeToOrg', 'auditLog'].map((k) => `${k}=${!!globalCtx.get(k)}`).join(' '));

// Real JWT, same shape loginFunc mints (role + userId claims), verified by
// the real guard() the same way an actual HTTP request would be.
const token = jwt.sign({ userId: 'u1', role: 'superadmin', name: 'superadmin' }, 'dev-secret-change-me');

// Run the ACTUAL generated nodesMoveFunc body — POST /api/nodes/move,
// {nodeIds:['tr-111','tr-221'], targetOrgId:'org-eternity'}, as superadmin.
async function runMove(nodeIds, targetOrgId) {
  const msg = {
    req: { headers: { authorization: `Bearer ${token}` }, params: {}, query: {} },
    payload: { nodeIds, targetOrgId },
  };
  // Fire-and-forget shape (like migrationsRunFunc): the guard-failure path
  // returns msg synchronously, but the success path kicks off an un-awaited
  // inner async IIFE and resolves the outer call to null/undefined — the
  // real result arrives later via node.send(msg). Wait for that instead of
  // the function call's own return value.
  let resolveSend;
  const sent = new Promise((res) => { resolveSend = res; });
  const sendingNode = { warn: node.warn, send: (m) => resolveSend(m) };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', moveFnBody);
  const syncResult = await fn(msg, env, sendingNode, globalCtx);
  if (syncResult) return syncResult; // guard failed, returned immediately
  return sent;
}

console.log('\n--- Move tr-111 + tr-221 (merged pair) from org-1 to org-eternity ---');
const result = await runMove(['tr-111', 'tr-221'], 'org-eternity');
console.log('statusCode:', result.statusCode, '(expect undefined = 200)');
console.log(JSON.stringify(result.payload, null, 2));

// --- Independent verification: query the real databases directly, not
// through any of the code under test. ---
const control = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub' });
const eternity = mysql.createPool({ host: '127.0.0.1', user: 'admin', password: 'iothub.2026', database: 'iothub_org_eternity' });

console.log('\n--- Verification (independent queries, bypassing the code under test) ---');
{
  const [rows] = await control.query('SELECT id, org_id, department_id, site_id, merge_into, status FROM nodes WHERE id IN (?)', [['tr-111', 'tr-221']]);
  console.log('control DB nodes rows:', rows);
  console.log('PASS control nodes.org_id = org-eternity:', rows.every((r) => r.org_id === 'org-eternity'));
  console.log('PASS control department_id/site_id cleared:', rows.every((r) => r.department_id === null && r.site_id === null));
  console.log('PASS merge_into relationship preserved (tr-221 -> tr-111):', rows.find((r) => r.id === 'tr-221')?.merge_into === 'tr-111');
}
{
  const [rows] = await control.query('SELECT COUNT(*) AS n FROM readings WHERE node_id=?', ['tr-111']);
  console.log('PASS readings REMOVED from old (control) DB:', rows[0].n === 0);
}
{
  const [rows] = await control.query('SELECT COUNT(*) AS n FROM node_departments WHERE node_id=?', ['tr-111']);
  console.log('PASS node_departments (old-org grant) DROPPED, not carried:', rows[0].n === 0);
}
{
  const [rows] = await eternity.query('SELECT id, org_id, status FROM nodes WHERE id IN (?)', [['tr-111', 'tr-221']]);
  console.log('eternity DB nodes mirror rows:', rows);
  console.log('PASS both nodes mirrored into eternity DB:', rows.length === 2);
}
{
  const [rows] = await eternity.query('SELECT node_id, param_key, value FROM readings WHERE node_id=?', ['tr-111']);
  console.log('eternity DB readings:', rows);
  console.log('PASS readings actually moved (2 rows, real values):', rows.length === 2 && rows.some((r) => r.param_key === 'oilTemp' && Number(r.value) === 63.4));
}
{
  const [rows] = await eternity.query('SELECT node_id, org_id FROM alarm_rules WHERE node_id=?', ['tr-111']);
  console.log('eternity DB alarm_rules:', rows);
  console.log('PASS alarm_rules moved with org_id corrected to org-eternity:', rows.length === 1 && rows[0].org_id === 'org-eternity');
}
{
  const [rows] = await eternity.query('SELECT id, node_id, org_id, department_id FROM alarm_events WHERE node_id=?', ['tr-111']);
  console.log('eternity DB alarm_events:', rows);
  console.log('PASS alarm_events moved, org_id corrected, department_id cleared:', rows.length === 1 && rows[0].org_id === 'org-eternity' && rows[0].department_id === null);
}
{
  const [rows] = await eternity.query('SELECT node_id, online, last_sample FROM device_presence WHERE node_id=?', ['tr-111']);
  console.log('eternity device_presence:', rows);
  console.log('PASS device_presence moved with JSON last_sample intact:', rows.length === 1 && rows[0].last_sample?.oilTemp === 63.4);
}
{
  const [rows] = await eternity.query('SELECT node_id, org_id, rule_json, debounce_json FROM alarm_rules WHERE node_id=?', ['tr-111']);
  console.log('eternity alarm_rules:', JSON.stringify(rows));
  console.log('PASS alarm_rules moved, org_id corrected, JSON columns intact:', rows.length === 1 && rows[0].org_id === 'org-eternity' && rows[0].rule_json?.oilTemp?.warn === 70 && rows[0].debounce_json?.door_state?.min_duration_s === 30);
}
{
  const [rows] = await eternity.query('SELECT node_id, kind, caption, annotations FROM node_photos WHERE node_id=?', ['tr-111']);
  console.log('eternity node_photos:', JSON.stringify(rows));
  console.log('PASS node_photos moved with JSON annotations intact:', rows.length === 1 && rows[0].annotations?.[0]?.label === 'hot spot');
}
{
  const [rows] = await eternity.query('SELECT id, node_id, department_id, name FROM documents WHERE node_id=?', ['tr-111']);
  console.log('eternity documents:', rows);
  console.log('PASS documents moved (department_id carried as-is, no FK to enforce):', rows.length === 1);
}
{
  const [rows] = await eternity.query('SELECT * FROM node_departments WHERE node_id=?', ['tr-111']);
  console.log('PASS node_departments NOT copied into new org either:', rows.length === 0);
}
{
  const [rows] = await control.query('SELECT COUNT(*) AS n FROM node_photos WHERE node_id=?', ['tr-111']);
  console.log('PASS node_photos REMOVED from old (control) DB:', rows[0].n === 0);
}

await control.end();
await eternity.end();
// Give the deliberately-unawaited auditLog() fire-and-forget write (see
// generate-nodered-backend.mjs's auditLog — intentional, not a bug) a moment
// to actually land before closing the pool out from under it; otherwise this
// harness itself (not the code under test) produces a spurious "connection
// is in closed state" warning that has nothing to do with the move logic.
await new Promise((r) => setTimeout(r, 200));
for (const p of Object.values(store.orgPools || {})) { try { await p.end(); } catch {} }
try { await store.pool.end(); } catch {}
console.log('\ndone.');
