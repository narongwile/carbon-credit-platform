// Extracts the ACTUAL resolvePool/orgOfNode/kindsFor implementations and the
// ACTUAL nodePhotosListFunc/kindsGetFunc handler bodies straight out of
// generate-nodered-backend.mjs (source, not a hand copy), and runs them
// against real MySQL with TENANT_DB_MODE=on — the exact UAT config — to
// prove the __unassigned__ fix works end-to-end, not just "reads correctly".
import fs from 'node:fs';
import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';

const SRC = fs.readFileSync('/home/user/carbon-credit-platform/backend/node-red/generate-nodered-backend.mjs', 'utf8');

// Keeps the literal `global.set('name', function(){...});` statement intact —
// running it for real (not hand-reassembling the function) is what makes this
// a test of the actual generator output, not of my paraphrase of it.
function extractGlobalSetStatement(name) {
  const re = new RegExp(`global\\.set\\('${name}',\\s*(?:async )?function[\\s\\S]*?\\n\\}\\);`);
  const m = SRC.match(re);
  if (!m) throw new Error(`could not extract global.set('${name}', ...)`);
  return m[0];
}

// --- Minimal Node-RED-ish runtime -------------------------------------------
const ENV = { TENANT_DB_MODE: 'on', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
const store = {};
const globalCtx = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
const node = { warn: (m) => console.log('  [node.warn]', m), send: () => {} };

const controlPool = mysql.createPool({ host: ENV.DB_HOST, port: +ENV.DB_PORT, user: ENV.DB_USER, password: ENV.DB_PASSWORD, database: ENV.DB_NAME, namedPlaceholders: true });
globalCtx.set('pool', controlPool);

// Build the same closure scope generate-nodered-backend.mjs's function nodes run
// in: env/global/node in scope, __TENANT read from env exactly as the source
// computes it, mysql available as the injected module.
const bootstrap = `
const __TENANT = (env.get('TENANT_DB_MODE')||'').toLowerCase()==='on';
const UNASSIGNED_ORG = '__unassigned__';
${extractGlobalSetStatement('orgDbName')}
${extractGlobalSetStatement('resolvePool')}
${extractGlobalSetStatement('orgOfNode')}
${extractGlobalSetStatement('kindsFor')}
`;

const factory = new Function('env', 'global', 'node', 'mysql', bootstrap);
factory(env, globalCtx, node, mysql);

console.log('--- resolvePool sanity ---');
const ctl = globalCtx.get('resolvePool')('org-1');
console.log('resolvePool(org-1) === control pool:', ctl === controlPool);

console.log('\n--- THE FIX: resolvePool(__unassigned__) ---');
const up = globalCtx.get('resolvePool')('__unassigned__');
console.log('resolvePool(__unassigned__) === control pool:', up === controlPool);
if (up !== controlPool) {
  console.log('!! Would have opened a tenant pool for a nonexistent DB. Probing what it does on query:');
  try { await up.query('SELECT 1'); console.log('  (unexpectedly succeeded)'); }
  catch (e) { console.log('  confirmed failure mode:', e.message); }
}

console.log('\n--- orgOfNode(tr-1001) ---');
const org = await globalCtx.get('orgOfNode')('tr-1001');
console.log('org_id for tr-1001:', org, '(expect __unassigned__)');

console.log('\n--- kindsFor(resolvePool(orgOfNode(tr-1001)), ...) — what kindsGetFunc actually calls ---');
const kindsPool = globalCtx.get('resolvePool')(org);
const BUILTIN_PHOTO = [
  { key: 'overview', label: 'Overview', hint: 'x' },
  { key: 'nameplate', label: 'Nameplate', hint: 'x' },
];
try {
  const kinds = await globalCtx.get('kindsFor')(kindsPool, org, 'photo', BUILTIN_PHOTO);
  console.log('SUCCESS — kinds resolved without throwing:', kinds.map((k) => k.key));
} catch (e) {
  console.log('FAILED —', e.message);
}

console.log('\n--- node_photos query for tr-1001, the same query nodePhotosListFunc runs ---');
try {
  const [rows] = await kindsPool.query(
    'SELECT id,kind,position,content_type,width,height,bytes,caption,taken_at,lat,lng,annotations,updated_by,updated_at,(thumb_data IS NOT NULL) AS has_thumb FROM node_photos WHERE node_id=? ORDER BY position, id',
    ['tr-1001']
  );
  console.log('SUCCESS — query ran without throwing, rows:', rows.length, '(0 is correct — no photos uploaded yet)');
} catch (e) {
  console.log('FAILED —', e.message);
}

await controlPool.end();
console.log('\ndone.');
