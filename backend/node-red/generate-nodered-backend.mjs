#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Auto-generate a COMPLETE Node-RED-only backend flow (no Express service).
// MQTT ingest + alarm engine + MySQL + full REST API + notifications +
// escalation + CORS, all inside Node-RED.
//
// Requires in Node-RED:
//   • settings.js → functionExternalModules: true
//   • mysql2 + nodemailer modules (pre-declared on the function node "libs")
//   • env: DB_HOST/PORT/USER/PASSWORD/NAME; notification: SMTP_HOST/PORT/USER/
//     PASS/MAIL_FROM, LINE_NOTIFY_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//     GOOGLE_CHAT_WEBHOOK
// Notifications route per-tenant via the notification_channels table (org +
// department + min_severity), matching the Express service; env vars act as a
// single-destination fallback when no DB channels are configured.
//
// Run:  node generate-nodered-backend.mjs   → flows.nodered-backend.json
// ---------------------------------------------------------------------------

import { writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

// Broker host/port come from the deployment via ${MQTT_BROKER_HOST}/${MQTT_BROKER_PORT}
// resolved by Node-RED at runtime (see the mqtt-broker config node below).
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'internal/telemetry/live/#'
const ESCALATE_MIN = process.env.ESCALATE_AFTER_MIN || '15'

// CORS preamble injected into every REST handler
const CORS = `const __CORS={'Access-Control-Allow-Origin':env.get('CORS_ORIGIN')||'*','Access-Control-Allow-Headers':'content-type, x-user-id, authorization','Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};\n`

// Guard wrapper injected into protected handlers (policy: auth|admin|super|org|
// node|node:manage). The async guard (init) verifies the Bearer JWT and enforces
// role + org-scope + device access; the handler body runs only if it passes.
// GUARD_OPEN wraps the body in an async fn; GUARD_CLOSE closes it.
const GUARD_OPEN = (policy) => !policy || policy === 'public' ? '' : `
return (async()=>{
const __g=global.get('guard');
const __ar=__g?await __g((msg.req.headers&&(msg.req.headers.authorization||msg.req.headers.Authorization))||'','${policy}',msg.req):{ok:false,code:503,error:'auth not ready'};
if(!__ar.ok){msg.headers={'Access-Control-Allow-Origin':env.get('CORS_ORIGIN')||'*'};msg.statusCode=__ar.code;msg.payload={error:__ar.error};return msg;}
msg.auth=__ar.auth;
`
const GUARD_CLOSE = (policy) => !policy || policy === 'public' ? '' : `
})();`

// --- init: MySQL pool + alarm engine into global context --------------------
const initFunc = `
// 'mysql' is injected by functionExternalModules (declared in this node's libs).
// Records are written in DB_TZ (default ICT, +07:00): mysql2 converts JS Date in
// this tz and each connection's session time_zone is pinned so NOW() is Bangkok.
const __DBTZ = env.get('DB_TZ') || '+07:00';
let currentPool = global.get('pool');
if (!currentPool || typeof currentPool.query !== 'function') {
  currentPool = mysql.createPool({
    host: env.get('DB_HOST') || 'mysql.data.svc.cluster.local',
    port: Number(env.get('DB_PORT') || 3306),
    user: env.get('DB_USER') || 'admin',
    password: env.get('DB_PASSWORD') || 'iothub.2026',
    database: env.get('DB_NAME') || 'iothub',
    namedPlaceholders: true, connectionLimit: 10, timezone: __DBTZ,
  });
  // mysql2/promise createPool() returns a PromisePool whose EventEmitter is the
  // underlying core pool (.pool); binding .on() on the wrapper throws, so guard it.
  try { (currentPool.pool || currentPool).on('connection', (c) => { c.query("SET time_zone = '" + __DBTZ + "'"); }); }
  catch (e) { node.warn('tz hook skipped: ' + e.message); }
  global.set('pool', currentPool);
}
// Every DATETIME column a caller windows on (readings.taken_at, alarm_events.
// raised_at, transport_events.ts, offline_sync_log.sync_at, readings_rollup.
// bucket, documents.created_at...) is written in __DBTZ wall-clock — the
// pinned SET time_zone above is exactly what makes that true — never UTC.
//
// A from/to window built as a UTC instant and bound directly against one of
// those columns is comparing two different clocks that happen to share a
// string FORMAT: MySQL has no way to know one side meant UTC and the other
// side is __DBTZ, so it just orders the two wall-clock STRINGS — silently
// excluding roughly the last __DBTZ-offset hours of real data from every
// window that reaches "now" (a 24h chart, a report ending today), because
// "now in UTC" sorts as earlier than "now in +07:00" even though they name
// the same instant. Confirmed against real MySQL: a reading taken 2 minutes
// ago returned ZERO rows for a "last 24h" window built this way.
//
// dbWallClock() is the one place this conversion happens, so every caller
// gets it for free instead of re-deriving it (and drifting) per endpoint.
// Accepts a real instant (ISO with Z/offset — what the frontend and
// new Date().toISOString() produce) and returns the __DBTZ wall-clock string
// in the exact 'YYYY-MM-DD HH:MM:SS' shape every taken_at-style column holds.
// A bare string with no zone marker is treated as already being __DBTZ
// wall-clock, for a caller that sends one directly (e.g. a saved report
// window echoed back from this same API).
global.set('dbWallClock', function(v){
  let s = String(v);
  const hasZone = /Z$|[+-]\\d{2}:?\\d{2}$/.test(s);
  if (!hasZone) return s.slice(0, 19).replace('T', ' ');
  const inst = new Date(s).getTime();
  if (Number.isNaN(inst)) return null;
  const m = /^([+-])(\\d{2}):?(\\d{2})$/.exec(__DBTZ) || [null, '+', '07', '00'];
  const offMin = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(inst + offMin * 60000);
  const pad = n => String(n).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' '
    + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.' + ms;
});
// --- DB-per-tenant pool resolver (feature-flagged) --------------------------
// TENANT_DB_MODE=on → data-plane queries route to per-org DBs (iothub_<org>);
// the control DB (this pool) keeps org/user/auth tables. Off (default) →
// resolvePool()/orgOfNode()/sweepOrgs() collapse to the single control pool, so
// the whole flow behaves EXACTLY like the row-level single-DB build.
const __TENANT = (env.get('TENANT_DB_MODE')||'').toLowerCase()==='on';
global.set('tenantMode', __TENANT);
// Must mirror migrate.ts orgDbName() exactly so both agree on the DB name.
global.set('orgDbName', function(orgId){
  const slug=String(orgId||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return slug ? ('iothub_'+slug).slice(0,64) : '';
});
// A new org's id becomes its database name via orgDbName(), so it is worth
// deriving from the company name rather than the clock: 'org-'+Date.now() gave
// iothub_org_1785591783951, which nobody can match to a customer in phpMyAdmin
// or a backup listing.
//
// Derived from the name ONCE, at creation, and then immutable — the database
// name must not follow a field the admin can rename (MySQL has no RENAME
// DATABASE) and must not collide (organizations.name has no unique constraint,
// so two customers may both be "KMUTT"). The id is the primary key, so it
// cannot collide, and uniqueness is settled here with a -2/-3 suffix.
//
// A name with no ASCII letters — Thai, for instance — slugifies to nothing, and
// an empty slug is dangerous rather than merely ugly: orgDbName('') returns ''
// and resolvePool then silently hands back the CONTROL pool, quietly putting a
// tenant's data in the shared database. Those fall back to the timestamp id.
global.set('makeOrgId', async function(pool, name){
  const base=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
  if(!base) return 'org-'+Date.now();
  let id='org-'+base;
  for(let n=2;n<100;n++){
    const[r]=await pool.query("SELECT id FROM organizations WHERE id=?",[id]);
    if(!r.length) return id;
    id='org-'+base+'-'+n;
  }
  return 'org-'+Date.now();
});
global.set('mirrorUserToTenantDb', async function(pool, orgId, userRecord){
  if (!orgId) return;
  const cleanOrg = String(orgId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const candidateDbs = Array.from(new Set([
    'iothub_' + cleanOrg,
    'iothub_org_' + cleanOrg.replace(/^org_/, ''),
    'iothub_' + cleanOrg.replace(/^org_/, '')
  ]));
  for (const tDb of candidateDbs) {
    try {
      const [dbCheck] = await pool.query("SHOW DATABASES LIKE ?", [tDb]);
      if (dbCheck.length > 0) {
        try {
          await pool.query(
            "INSERT INTO " + tDb + ".users (id,org_id,department_id,email,phone,name,role,status) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), phone=VALUES(phone), role=VALUES(role), status=VALUES(status), department_id=VALUES(department_id)",
            [userRecord.id, orgId, userRecord.departmentId||null, userRecord.email||null, userRecord.phone||null, userRecord.name, userRecord.role||'viewer', userRecord.status||'active']
          );
        } catch(subErr) {
          await pool.query(
            "INSERT INTO " + tDb + ".users (id,org_id,department_id,email,name,role) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), department_id=VALUES(department_id)",
            [userRecord.id, orgId, userRecord.departmentId||null, userRecord.email||null, userRecord.name, userRecord.role||'viewer']
          );
        }
        break; // Matched primary tenant DB, avoid writing duplicate candidate DBs
      }
    } catch(err) {
      node.warn('mirrorUserToTenantDb error for ' + tDb + ': ' + err.message);
    }
  }
});
// registerFunc/loginFunc used to probe for the users.status column (migrate-v46,
// the pending-approval gate) by try/catching the query and falling back to a
// query that hardcodes user_status='active' on ANY failure. That fallback is
// what let a brand-new self-registration log in immediately whenever v46
// hadn't been applied yet: the INSERT silently dropped status, and the SELECT
// silently pretended everyone is active — the approval gate failed open
// instead of failing closed. Checking column existence explicitly (cached,
// since it never changes without a redeploy) lets both functions know for
// certain whether status is enforceable, instead of guessing from a caught
// error that could just as easily mean "the connection dropped".
global.set('usersHasStatusColumn', async function(pool){
  const cached = global.get('_usersHasStatusColumn');
  if (cached !== undefined) return cached;
  const [r] = await pool.query("SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='status'");
  const has = r[0].c > 0;
  global.set('_usersHasStatusColumn', has);
  return has;
});
// The claimable pool an auto-registered device lands in when its MQTT topic's
// org segment doesn't match a known active org (worker/main.go: UnassignedOrg).
// It is a sentinel, not a real organizations row with its own tenant database —
// autoRegisterPending() always writes these nodes into the CONTROL DB's nodes
// table, on every code path, regardless of TENANT_DB_MODE. resolvePool must
// agree, or any endpoint touching an unclaimed device's data (photos, kind
// catalog, etc.) tries to open "iothub_unassigned", a database that was never
// created and never will be, and 500s.
const UNASSIGNED_ORG = '__unassigned__';
global.set('resolvePool', function(orgId){
  const ctl=global.get('pool');
  if(!__TENANT || !orgId) return ctl;                        // flag off / no org → control pool
  if(orgId === 'org-1' || orgId === 'org-2' || orgId === 'org-3' || orgId === UNASSIGNED_ORG) return ctl; // legacy orgs + the unclaimed pool use the control pool
  const dbn=global.get('orgDbName')(orgId); if(!dbn) return ctl;
  const pools=global.get('orgPools')||{};
  if(pools[dbn] && typeof pools[dbn].query==='function') return pools[dbn];
  const p=mysql.createPool({
    host: env.get('DB_HOST')||'mysql.data.svc.cluster.local', port: Number(env.get('DB_PORT')||3306),
    user: env.get('DB_USER')||'admin', password: env.get('DB_PASSWORD')||'iothub.2026',
    database: dbn, namedPlaceholders:true, connectionLimit: Number(env.get('ORG_POOL_LIMIT')||5), timezone: __DBTZ,
  });
  try { (p.pool||p).on('connection',(c)=>{ c.query("SET time_zone = '"+__DBTZ+"'"); }); } catch(e){ node.warn('org tz hook skipped: '+e.message); }
  pools[dbn]=p; global.set('orgPools',pools);
  node.warn('tenant pool opened: '+dbn);
  return p;
});
// nodeId → org_id via the control-DB routing index (control.nodes), cached in
// memory. Returns null when flag off (caller then uses the control pool).
global.set('orgOfNode', async function(nodeId){
  if(!__TENANT) return null;
  const cache=global.get('nodeOrgCache')||{};
  if(cache[nodeId]) return cache[nodeId];
  const [r]=await global.get('pool').query("SELECT org_id FROM nodes WHERE id=?",[nodeId]);
  const org=r.length?r[0].org_id:null;
  if(org){ cache[nodeId]=org; global.set('nodeOrgCache',cache); }
  return org;
});
// The pool a NODE-scoped endpoint should read/write: the database belonging
// to the device's OWN organization, not the caller's.
//
// The two differ for exactly one caller — a superadmin, who has no orgId of
// their own — and that is precisely who could not see a moved device's data.
// The DATA_PLANE rewrite at the bottom of this file keys the pool off
// msg.auth.orgId, which for a superadmin is '', and resolvePool('') falls
// back to the CONTROL database no matter which org the device is in. For an
// ordinary org admin the two always agree (guard's 'node' policy already
// requires it), which is why this stayed invisible in every manual test
// until a device actually moved to a tenant DB.
//
// Falls back to the caller's org when orgOfNode returns null — that happens
// when TENANT_DB_MODE is off, where resolvePool collapses everything to the
// control pool anyway, so the fallback is a no-op rather than a guess.
global.set('poolForNode', async function(nodeId, au){
  const org = (await global.get('orgOfNode')(nodeId)) || (au && au.orgId) || '';
  return global.get('resolvePool')(org);
});
// --- moveNodeToOrg: reassign one ALREADY-ACTIVE device to a different org --
// Nothing else in this file can do this: approve's org picker only applies
// to a device still status='pending', and the device profile endpoint never
// accepts orgId at all. An active device has real history — readings,
// alarm_events, documents, node_photos — and under TENANT_DB_MODE that
// history lives in the OLD org's own database (resolvePool(oldOrgId)), not
// the control DB. Just flipping nodes.org_id would leave every one of those
// rows behind, invisible to the new org's own resolvePool(newOrgId)
// queries — the device would appear to move while its data silently didn't.
//
// MOVE_TABLE_RULES lists every table this app has that carries a node_id,
// and what happens to each row on a cross-org move:
//   resetOrg:      this column is org-scoped — set it to the destination org
//   nullCols:      old-org-specific values (a department id, a model id from
//                  the old org's own catalog) that mean nothing in the new
//                  org — cleared, not carried
//   dropOnly:      defines an old-org-specific GRANT (which departments/users
//                  may see this device) — never copied, just deleted; the
//                  new org's admin re-grants explicitly if needed
//   requireNodeId: this table also holds org-WIDE default rows (node_id IS
//                  NULL) that are not about this device at all and must
//                  never be touched by a per-device move
// Columns are discovered from information_schema at call time, not
// hardcoded — a future migrate-vN adding a column here can't silently go
// stale against a copy-pasted list.
const MOVE_TABLE_RULES = {
  readings: {}, readings_rollup: {}, device_presence: {}, device_logs: {},
  edge_alarm_log: {}, transport_events: {}, offline_sync_log: {}, ota_deployments: {},
  node_photos: {}, node_images: {},
  node_nameplates: { nullCols: ['model_id'] },
  alarm_rules: { resetOrg: 'org_id' },
  alarm_events: { resetOrg: 'org_id', nullCols: ['department_id'] },
  chart_definitions: { resetOrg: 'org_id' },
  documents: {},
  display_params: { resetOrg: 'org_id', nullCols: ['department_id'], requireNodeId: true },
  param_labels: { resetOrg: 'org_id', requireNodeId: true },
  node_departments: { dropOnly: true },
  node_user_visibility: { dropOnly: true },
};
// Relocate every per-device row for one node id from one pool to another, applying
// MOVE_TABLE_RULES. Shared by moveNodeToOrg (a deliberate move) and
// repairNodeOrphans (cleaning up rows an earlier, partial move left behind),
// so the fiddly parts — JSON re-serialization, org-scoped column rewrites,
// the node_id IS NOT NULL guard on tables that also hold org-wide defaults —
// exist once rather than in two copies that can drift apart.
//
// Returns per-table counts as well as warnings: "how many rows actually
// moved" is the only way a caller can tell a genuine no-op from a silent
// skip.
// A device that has been streaming telemetry for a long time before a move
// can have MILLIONS of readings rows. Two safeguards, confirmed against real
// MySQL at 200,000 rows (real device: 1,658,651):
//   RELOCATE_BATCH_SIZE   rows per round trip. The original implementation
//                         did one INSERT per row — measured on a real table
//                         this size, that took long enough to blow through
//                         nginx's proxy read timeout while the copy was
//                         still in progress server-side, with no way for the
//                         caller to tell "still running" from "died".
//                         Batching alone took 200,000 rows from an operation
//                         nginx times out on to ~10 seconds.
//   RELOCATE_TIME_BUDGET_MS  even batched, a device large enough (the
//                         1.65M-row case this was written for extrapolates
//                         to ~85 seconds locally, on zero-latency loopback —
//                         a production DB hop would only add to that) can
//                         still outrun a 60s gateway timeout. Rather than
//                         retune the batch size around a timeout this code
//                         cannot see, cap the WORK per call: each call moves
//                         what it can in the budget and returns truncated:true
//                         when there is more, since deleting as it goes
//                         already makes every call safe to simply repeat —
//                         it always operates on whatever remains.
const RELOCATE_BATCH_SIZE = 1000;
const RELOCATE_TIME_BUDGET_MS = 20000;

global.set('relocateNodeRows', async function(id, oldPool, newPool, targetOrgId){
  const deadline = Date.now() + RELOCATE_TIME_BUDGET_MS;
  const warnings = [];
  const counts = {};
  let truncated = false;
  const colsOf = async (p, table) => {
    const [c] = await p.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",
      [table]);
    return c.map(x => x.COLUMN_NAME);
  };
  // The primary key, whatever shape it has — readings/readings_rollup key on
  // (node_id,param_key,taken_at), most others on a single id column. Needed
  // to delete EXACTLY the batch just inserted, by identity, rather than
  // re-running the WHERE node_id=? filter (which after a partial batch would
  // also match rows not yet copied).
  const pkOf = async (p, table) => {
    const [c] = await p.query(
      "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",
      [table]);
    return c.map(x => x.COLUMN_NAME);
  };
  const valueFor = (rule, col, row) => {
    if (rule.resetOrg === col) return targetOrgId;
    if (rule.nullCols && rule.nullCols.indexOf(col) >= 0) return null;
    const v = row[col];
    // mysql2 auto-parses a JSON column's value into a real JS object on
    // SELECT (alarm_rules.rule_json, device_presence.last_sample,
    // node_photos.annotations, ...) — re-inserting that object as-is is not
    // re-serialized back to JSON text by the driver, and MySQL rejects it
    // ("Invalid JSON text"). Buffers (image/thumb blobs) and Dates
    // (datetime columns) must NOT be caught by this — only a genuine object.
    if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date)) return JSON.stringify(v);
    return v;
  };

  for (const [table, rule] of Object.entries(MOVE_TABLE_RULES)) {
    if (Date.now() > deadline) { truncated = true; break; }
    const nodeIdFilter = rule.requireNodeId ? ' AND node_id IS NOT NULL' : '';
    try {
      if (rule.dropOnly) {
        // An old-org-specific grant. Whether or not the data itself is
        // physically relocating, this never carries forward — deleted either way.
        await oldPool.query('DELETE FROM \`'+table+'\` WHERE node_id=?', [id]);
        continue;
      }
      if (oldPool === newPool) {
        // Same physical database — nothing to relocate. Only the org-scoped
        // columns some of these tables carry need correcting in place.
        const sets = [];
        if (rule.resetOrg) sets.push('\`'+rule.resetOrg+'\`=?');
        if (rule.nullCols) for (const c of rule.nullCols) sets.push('\`'+c+'\`=NULL');
        if (!sets.length) continue; // nothing org-scoped here — the rows are already correct
        const vals = rule.resetOrg ? [targetOrgId] : [];
        await oldPool.query('UPDATE \`'+table+'\` SET '+sets.join(',')+' WHERE node_id=?'+nodeIdFilter, [...vals, id]);
        continue;
      }
      // Genuinely different databases: copy across with overrides applied,
      // batch by batch, deleting each batch (by primary key, not by the
      // node_id filter — a re-run of that filter after a partial pass would
      // also match rows not yet copied) before pulling the next one. A batch
      // that returns fewer than RELOCATE_BATCH_SIZE rows is the last one —
      // no COUNT(*) needed up front, and no OFFSET, which would only get
      // slower as the table drains.
      const colNames = await colsOf(oldPool, table);
      if (!colNames.length) continue; // table not present on this schema version
      const pkCols = await pkOf(oldPool, table);
      const colList = colNames.map(c => '\`'+c+'\`').join(',');
      const selectSQL = 'SELECT '+colList+' FROM \`'+table+'\` WHERE node_id=?'+nodeIdFilter+' LIMIT '+RELOCATE_BATCH_SIZE;
      const pkList = pkCols.map(c => '\`'+c+'\`').join(',');
      const pkGroup = '('+pkCols.map(() => '?').join(',')+')';
      let moved = 0;
      for (;;) {
        if (Date.now() > deadline) { truncated = true; break; }
        const [batch] = await oldPool.query(selectSQL, [id]);
        if (!batch.length) break;
        const placeholders = batch.map(() => '('+colNames.map(() => '?').join(',')+')').join(',');
        const insertVals = [];
        for (const row of batch) for (const c of colNames) insertVals.push(valueFor(rule, c, row));
        await newPool.query('INSERT IGNORE INTO \`'+table+'\` ('+colList+') VALUES '+placeholders, insertVals);

        if (!pkCols.length) {
          await oldPool.query('DELETE FROM \`'+table+'\` WHERE node_id=?'+nodeIdFilter, [id]);
          moved += batch.length;
          break;
        }

        const deleteVals = [];
        for (const row of batch) for (const c of pkCols) deleteVals.push(row[c]);
        await oldPool.query(
          'DELETE FROM \`'+table+'\` WHERE ('+pkList+') IN ('+batch.map(() => pkGroup).join(',')+')',
          deleteVals);

        moved += batch.length;
        if (batch.length < RELOCATE_BATCH_SIZE) break; // last batch — nothing left to fetch
      }
      if (moved) counts[table] = moved;
      if (truncated) break; // ran out of time mid-table — stop rather than skip ahead to the next one
    } catch (e) {
      // Tolerate a table this schema version doesn't have yet on one side (an
      // org DB behind on migrations) — same "skip on missing table" pattern
      // used everywhere else in this file — but surface anything else.
      if (String(e && e.message || '').indexOf(table) < 0) throw e;
      warnings.push(table+' skipped — not present on this schema version (run migrations for this organization)');
    }
  }
  return { counts, warnings, truncated };
});

// Clean up per-device rows stranded in the CONTROL database for a device
// that now lives in a tenant database.
//
// This is repair, not routine: it exists because rows can be left behind
// when a move happened while writes were still in flight (the ingest worker
// caches nodeId -> org for up to 2 minutes, so frames arriving right after a
// move can still land in the previous database), or when an earlier,
// partially-working version of the move left a table behind. Symptom is a
// device whose history appears to stop dead at the moment it was moved.
//
// Only ever pulls FROM control TO the device's current org — never the other
// way, and never between two tenants — so the worst case is a no-op.
global.set('repairNodeOrphans', async function(id, actorLabel, dryRun){
  const pool = global.get('pool');
  const [rows] = await pool.query('SELECT org_id, status FROM nodes WHERE id=?', [id]);
  if (!rows.length) return { nodeId: id, ok: false, error: 'not found' };
  const orgId = rows[0].org_id;
  const orgPool = global.get('resolvePool')(orgId);
  if (orgPool === pool) {
    // The device's org resolves to the control DB itself (TENANT_DB_MODE off,
    // or a control-pool org like org-1/2/3) — by definition nothing is
    // stranded, since that IS where it belongs.
    return { nodeId: id, ok: true, orgId, repaired: false, note: 'this device lives in the control database — nothing can be stranded' };
  }
  // Count first, always — this is what makes a dry run meaningful and what
  // lets the caller report "found 0" instead of an ambiguous success.
  const found = {};
  for (const [table, rule] of Object.entries(MOVE_TABLE_RULES)) {
    if (rule.dropOnly) continue;
    const nodeIdFilter = rule.requireNodeId ? ' AND node_id IS NOT NULL' : '';
    try {
      const [c] = await pool.query('SELECT COUNT(*) AS n FROM \`'+table+'\` WHERE node_id=?'+nodeIdFilter, [id]);
      if (Number(c[0].n) > 0) found[table] = Number(c[0].n);
    } catch (e) { if (String(e && e.message || '').indexOf(table) < 0) throw e; }
  }
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  if (dryRun || total === 0) return { nodeId: id, ok: true, orgId, repaired: false, dryRun: !!dryRun, found, total };
  const r = await global.get('relocateNodeRows')(id, pool, orgPool, orgId);
  global.get('auditLog')(actorLabel, 'nodes.repairOrphans', 'node', id, { orgId, moved: r.counts, total, truncated: r.truncated });
  // truncated: a device with enough backlog can outrun the per-call time
  // budget (relocateNodeRows' own comment has the numbers). This is not a
  // failure — deleting each row as it's moved means every remaining row is
  // still exactly where the next call will look for it. Surfaced explicitly
  // so the caller knows to call again rather than assuming one call means done.
  return { nodeId: id, ok: true, orgId, repaired: true, found, total, moved: r.counts, warnings: r.warnings, truncated: !!r.truncated };
});
global.set('moveNodeToOrg', async function(id, targetOrgId, actorLabel){
  const pool = global.get('pool');
  const [rows] = await pool.query('SELECT * FROM nodes WHERE id=?', [id]);
  if (!rows.length) return { nodeId: id, ok: false, error: 'not found' };
  const nd = rows[0];
  if (nd.status !== 'active') return { nodeId: id, ok: false, error: "only active devices can be moved (this one is '"+nd.status+"')" };
  if (nd.org_id === targetOrgId) return { nodeId: id, ok: true, moved: false, note: 'already in that organization' };
  const [org] = await pool.query("SELECT id FROM organizations WHERE id=? AND status='active'", [targetOrgId]);
  if (!org.length) return { nodeId: id, ok: false, error: 'target organization does not exist or is suspended' };

  const oldOrgId = nd.org_id;
  const oldPool = global.get('resolvePool')(oldOrgId);
  const newPool = global.get('resolvePool')(targetOrgId);
  const warnings = [];

  // 1. Control-DB row FIRST — this is the routing index guard()/orgOfNode
  //    read on every request, so it defines the move regardless of what
  //    happens to the data below. site_id/department_id are org-scoped
  //    (a site or department id from the old org means nothing in the new
  //    one) and merge_into is handled by the caller (it must either move
  //    together with its target, or be cleared before this runs).
  await pool.query('UPDATE nodes SET org_id=?, department_id=NULL, site_id=NULL WHERE id=?', [targetOrgId, id]);
  // orgOfNode() caches nodeId -> org_id in memory FOREVER (nodeOrgCache) once
  // looked up once, with nothing anywhere invalidating it — this is that
  // invalidation. Every node-scoped read that resolves its pool through
  // orgOfNode (photos, documents, transport, reports, ...) would otherwise
  // keep querying the OLD org's database after a move: the old rows are gone
  // (deleted below), so a freshly-uploaded photo would list, then vanish the
  // moment this same node process serves it from cache again.
  { const __c = global.get('nodeOrgCache'); if (__c) { delete __c[id]; global.set('nodeOrgCache', __c); } }
  if (newPool !== pool) {
    await newPool.query(
      "INSERT INTO nodes (id,org_id,site_id,department_id,domain,name,mqtt_prefix,lat,lng,status,merge_into) VALUES (?,?,NULL,NULL,?,?,?,?,?,'active',?) "+
      "ON DUPLICATE KEY UPDATE org_id=VALUES(org_id),site_id=NULL,department_id=NULL,domain=VALUES(domain),name=VALUES(name),mqtt_prefix=VALUES(mqtt_prefix),lat=VALUES(lat),lng=VALUES(lng),status='active',merge_into=VALUES(merge_into)",
      [id, targetOrgId, nd.domain, nd.name, nd.mqtt_prefix, nd.lat, nd.lng, nd.merge_into]);
  }

  const relocated = await global.get('relocateNodeRows')(id, oldPool, newPool, targetOrgId);
  warnings.push(...relocated.warnings);

  // The stale MIRROR row in the old tenant DB (not the control row — that
  // one was UPDATED, not deleted, in step 1).
  if (oldPool !== pool) {
    try { await oldPool.query('DELETE FROM nodes WHERE id=?', [id]); }
    catch (e) { warnings.push('could not remove the stale copy from the previous organization database: '+e.message); }
  }

  global.get('auditLog')(actorLabel, 'nodes.move', 'node', id, { fromOrg: oldOrgId, toOrg: targetOrgId, warnings: warnings.length });
  return { nodeId: id, ok: true, moved: true, fromOrg: oldOrgId, toOrg: targetOrgId, warnings };
});
// Org ids for the background sweeps to iterate. [null] when flag off → sweeps
// run once against the control pool, identical to before.
global.set('sweepOrgs', async function(){
  if(!__TENANT) return [null];
  const [r]=await global.get('pool').query("SELECT id FROM organizations");
  return r.map(x=>x.id);
});
// Org-ownership guard for resources addressed by their own id (not by an org
// route param, so the auth guard can't enforce it). Looks up the row's org and
// 403s a non-superadmin caller if it isn't theirs. Pass the pool the handler is
// already using (control for control-plane tables; resolvePool(org) for org-DB
// tables — where a mismatched id simply isn't found → 404, still safe).
global.set('ownOrg', async function(au, pool, sql, params){
  const [r]=await pool.query(sql, params);
  if(!r.length) return {ok:false, code:404, error:'not found'};
  const org=r[0].org_id;
  if(au && au.role!=='superadmin' && org!==au.orgId) return {ok:false, code:403, error:'outside your organization'};
  return {ok:true, orgId:org};
});
function breaches(v,l,d){return d==='high'?v>=l:v<=l;}
function cleared(v,l,d,h){return d==='high'?v<l-h:v>l+h;}
// Rate-of-rise alarms declare their own time base in the unit string
// ('ppm/day' for DGA gassing, '°C/h' for thermal). Returns that base in ms, or
// null when the unit carries no interpretable denominator — in which case the
// rate check is SKIPPED rather than guessed at, because the previous code
// silently treated whatever the denominator said as if it were "per sample".
// Parsed with string ops rather than a regex ON PURPOSE: this whole function
// is emitted inside a template literal, where a regex like /\/\s*day$/ has its
// backslashes eaten by the template's own escape handling and lands in the
// generated node as //s*day$/ — a line comment that silently swallows the rest
// of the line. (The generator's syntax gate catches it, but the safest fix is
// to not write the hazard.)
function rateWindowMs(unit){
  const u=String(unit||'').toLowerCase().trim();
  const i=u.lastIndexOf('/');
  if(i<0) return null;
  const per=u.slice(i+1).trim();
  if(per==='day'||per==='d') return 86400000;
  if(per==='hour'||per==='hr'||per==='h') return 3600000;
  if(per==='min'||per==='minute') return 60000;
  if(per==='sec'||per==='second'||per==='s') return 1000;
  return null;
}
// Two samples close together turn sensor jitter into a huge extrapolated rate:
// 0.1 ppm of noise across 1 second is 8,640 ppm/day. Requiring at least
// window/24 between the compared samples caps that amplification at 24x — an
// hour for a /day rate, 2.5 minutes for a /h rate.
const RATE_MIN_DIVISOR = 24;
function evaluate(nodeId, rule, readings, debounceJson){
  const out=[];
  // debounce_json overrides per-param dwell if present (§8 production debounce)
  const db = debounceJson || {};
  for(const p of rule.params){
    let active=null, run=0;
    // Rate anchor: the sample the CURRENT one is measured against. Held
    // separately from the previous sample because a rate needs a meaningful
    // span of time behind it, so the anchor only advances once enough has
    // elapsed (see RATE_MIN_DIVISOR) rather than on every reading.
    let anchorV=null, anchorTs=null;
    const rateWin = p.rate ? rateWindowMs(p.rate.unit) : null;
    const paramDb = db[p.key] || {};
    const dwellMin = paramDb.dwell_min ?? rule.dwellMin ?? 3;
    const cooldownS = paramDb.cooldown_s ?? 0;
    for(const r of readings){
      const v=r.values[p.key]; if(v===undefined||Number.isNaN(v))continue;
      if(rateWin){
        if(anchorTs===null){ anchorV=v; anchorTs=r.ts; }
        else {
          const elapsed=r.ts-anchorTs;
          if(elapsed>=rateWin/RATE_MIN_DIVISOR){
            // Change per unit time, expressed in the SAME unit the rule
            // declares — so a 'ppm/day' limit is now compared against an
            // actual ppm/day figure instead of a raw sample-to-sample delta.
            const d=((p.direction==='high'?v-anchorV:anchorV-v)*rateWin)/elapsed;
            if(d>=p.rate.warn)out.push(mk(nodeId,p,'WARNING','rate',v,p.rate.warn,r));
            anchorV=v; anchorTs=r.ts;
          }
        }
      }
      const lvl=breaches(v,p.critical,p.direction)?'CRITICAL':breaches(v,p.warn,p.direction)?'WARNING':null;
      if(lvl){run++; if(run>=dwellMin&&lvl!==active){ if(active===null||(active==='WARNING'&&lvl==='CRITICAL')){out.push(mk(nodeId,p,lvl,'threshold',v,lvl==='CRITICAL'?p.critical:p.warn,r));} active=lvl; } }
      else if(active&&cleared(v,p.warn,p.direction,rule.hysteresis)){active=null;run=0;}
      else if(!lvl){run=0;}
    }
  }
  return out.sort((a,b)=>b.ts-a.ts);
}
function mk(nodeId,p,sev,kind,value,thr,r){return {id:'ev-'+nodeId+'-'+p.key+'-'+r.ts+'-'+kind,nodeId:nodeId,paramKey:p.key,paramLabel:p.label,severity:sev,kind:kind,value:+value.toFixed(2),threshold:thr,unit:p.unit,time:r.time,ts:r.ts};}
global.set('evaluate', evaluate);
// Effective product access for a user (department grant capped by user override).
// Departments are a SET (migrate-v25). A user in two departments should see the
// union of what each grants — being added to a second team cannot take access
// away. departmentId (singular) stays in the result so older callers keep
// working; departmentIds is the one to reason with.
global.set('departmentsOf', async function(userId, fallbackDeptId){
  const pool=global.get('pool');
  try{
    const[d]=await pool.query("SELECT department_id FROM user_departments WHERE user_id=?",[userId]);
    if(d.length) return d.map(x=>x.department_id);
  }catch(e){ if(String(e&&e.message||'').indexOf('user_departments')<0) throw e; }
  return fallbackDeptId ? [fallbackDeptId] : [];
});
global.set('accessFor', async function(userId){
  const pool=global.get('pool'); const RANK={none:0,view:1,manage:2}; const levels={};
  const [u]=await pool.query("SELECT org_id,role,department_id FROM users WHERE id=?",[userId]);
  const role=u.length?u[0].role:'viewer'; const departmentId=u.length?u[0].department_id:null;
  const departmentIds=await global.get('departmentsOf')(userId, departmentId);
  if(role==='admin'||role==='superadmin'){['transformer','carbonNode','bloodBox','automobile'].forEach(d=>levels[d]='manage');}
  else{
    // Most permissive across the user's departments, then narrowed by any
    // explicit per-user override (which may only RESTRICT). Tolerate a
    // missing product_access table (pre-migrate-v6 deployment) the same way
    // department_sites below tolerates pre-migrate-v29 — a missing TABLE is
    // the one case that still yields no levels, because there is then no
    // policy store at all to reason about.
    //
    // A DEPARTMENT WITH NO product_access ROWS MEANS NO RESTRICTION, not "no
    // access". This is the same fail-open rule department_sites (v29) and
    // node_departments (v35) already state in so many words — "NO ROWS FOR A
    // DEPARTMENT MEANS NO RESTRICTION. Fail-open is deliberate" — and
    // product_access was the one gate that read the other way. Only the three
    // seeded demo departments (dept-1a/2a/3a) have ever had rows, so for every
    // department a real customer actually creates, levels came back {} and
    // fleetListFunc's "level none means hide" test dropped EVERY device before
    // the department check could ever run. An admin would grant a device to
    // a department in Edit Device, save successfully, and the viewers in that
    // department would still see an empty list, with nothing on screen
    // anywhere connecting the two.
    //
    // An unscoped department therefore contributes 'view' on every domain,
    // which keeps three things true at once: a department the admin HAS
    // configured still denies the domains it omits (dept-2a has no carbonNode
    // row and must keep seeing no carbonNode); a user in one configured and
    // one unconfigured department gets the union, so being added to a second
    // team never removes access; and an explicit per-user 'none' row still
    // restricts below it, because the user pass below runs afterwards and only
    // ever lowers. Access is still gated — by node_departments/site/domain
    // ownership — this only stops an unconfigured product policy from being
    // read as a deny-everything.
    try{
      for(const dept of (departmentIds.length?departmentIds:[''])){
        const [dr]=await pool.query("SELECT domain,level FROM product_access WHERE scope='department' AND scope_id=?",[dept]);
        if(!dr.length){ ['transformer','carbonNode','bloodBox','automobile'].forEach(d=>{const cur=levels[d]||'none'; if(RANK['view']>RANK[cur]) levels[d]='view';}); continue; }
        dr.forEach(r=>{const cur=levels[r.domain]||'none'; if(RANK[r.level]>RANK[cur]) levels[r.domain]=r.level;});
      }
      const [ur]=await pool.query("SELECT domain,level FROM product_access WHERE scope='user' AND scope_id=?",[userId]);
      ur.forEach(r=>{const cur=levels[r.domain]||'none'; if(RANK[r.level]<RANK[cur]) levels[r.domain]=r.level;});
    }catch(e){ if(String(e&&e.message||'').indexOf('product_access')<0) throw e; }
  }
  // Sites this user may see (migrate-v29), unioned across their departments.
  // siteScoped=false means "no site policy" and every read path must then
  // behave exactly as it did before site scoping existed — see the fail-open
  // note in migrate-v29.sql. An admin is never scoped: they administer the org.
  let siteIds=[], siteScoped=false;
  if(role!=='admin'&&role!=='superadmin'&&departmentIds.length){
    try{
      const[sr]=await pool.query("SELECT DISTINCT site_id FROM department_sites WHERE department_id IN (?)",[departmentIds]);
      if(sr.length){ siteIds=sr.map(x=>x.site_id); siteScoped=true; }
    }catch(e){ if(String(e&&e.message||'').indexOf('department_sites')<0) throw e; }
  }
  // Individual devices this user is limited to (migrate-v42). nodeScoped=false
  // ("no rows") means no restriction, exactly like siteScoped above. Read from
  // the ORG pool, not this control one: node_user_visibility lives beside the
  // nodes it describes (users stays in control, which is why the query above
  // uses the control pool and this one does not).
  const __org = u.length?u[0].org_id:'';
  let visibleNodeIds=[], nodeScoped=false;
  if(role!=='admin'&&role!=='superadmin'&&__org){
    try{
      const npool=global.get('resolvePool')(__org);
      const[nv]=await npool.query("SELECT node_id FROM node_user_visibility WHERE user_id=?",[userId]);
      if(nv.length){ visibleNodeIds=nv.map(x=>x.node_id); nodeScoped=true; }
    }catch(e){ if(String(e&&e.message||'').indexOf('node_user_visibility')<0) throw e; }
  }
  return {orgId:__org,role,departmentId,departmentIds,levels,siteIds,siteScoped,visibleNodeIds,nodeScoped};
});
// May this user see this specific device? (migrate-v42)
//
// Purely RESTRICTIVE and applied AFTER deptVisible/siteVisible, never instead
// of them: a device listed here is still hidden unless the department rules
// already allowed it. No rows for the user (nodeScoped false) means no
// restriction — the same fail-open default department_sites and
// node_departments use, and the one product_access originally got wrong.
global.set('nodeVisible', function(acc, nodeId){
  if(!acc || acc.role==='admin' || acc.role==='superadmin') return true;
  if(!acc.nodeScoped) return true;
  return (acc.visibleNodeIds||[]).indexOf(nodeId) >= 0;
});
// Record an administrative action (migrate-v30). Never throws and never blocks
// the action it describes: a missing audit table must not stop a superadmin
// suspending a customer mid-incident. Fire-and-forget by design — callers do
// not await it.
global.set('auditLog', function(au, action, orgId, target, detail){
  const pool=global.get('pool');
  pool.query("INSERT INTO admin_audit (actor_id,actor_name,action,org_id,target,detail) VALUES (?,?,?,?,?,?)",
    [(au&&au.userId)||null,(au&&(au.name||au.email))||null,String(action),orgId||null,target?String(target).slice(0,255):null,detail?JSON.stringify(detail).slice(0,4000):null])
    .catch(e=>{ node.warn('audit ('+action+') skipped: '+e.message); });
});
// May this user's department(s) see this device? (migrate-v35)
//
// granted = the node's node_departments set; owner = nodes.department_id.
// No grants at all falls back to the owner column, which is exactly the
// pre-v35 rule — so every device keeps its current visibility until an admin
// deliberately grants departments to it. An empty effective set means the
// device belongs to nobody in particular and the whole org sees it, the same
// fail-open reasoning siteVisible() uses for a device with no site: hiding an
// unassigned device from everyone would make a freshly approved one invisible
// to the people who have to place it.
global.set('deptVisible', function(acc, owner, granted){
  if(!acc || acc.role==='admin' || acc.role==='superadmin') return true;
  const set = (granted && granted.length) ? granted : (owner ? [owner] : []);
  if(!set.length) return true;
  const mine = acc.departmentIds || [];
  for(const d of set) if(mine.indexOf(d) >= 0) return true;
  return false;
});
// Every department grant for one org's devices, as {nodeId: [departmentId]}.
// One indexed read for the whole fleet rather than a query per node — this is
// on the path of every page load. A missing table (pre-v35) yields {}, which
// makes deptVisible fall back to nodes.department_id for every device.
global.set('nodeDeptMap', async function(pool, orgId){
  const out={};
  try{
    const[r]=await pool.query("SELECT node_id,department_id FROM node_departments WHERE org_id=?",[orgId]);
    for(const x of r) (out[x.node_id]=out[x.node_id]||[]).push(x.department_id);
  }catch(e){ if(String(e&&e.message||'').indexOf('node_departments')<0) throw e; }
  return out;
});
// Resolve an org's photo/document kinds (migrate-v40): the built-ins, with any
// kind_catalog row of the same key overriding its label/hint/order/visibility,
// then the org's own custom kinds appended.
//
// Merged here rather than seeded as rows so a fresh org needs no setup and a
// built-in can never be lost. \`active\` is honoured only by callers building a
// PICKER — validation and reads accept every known key, including hidden and
// unknown-but-already-stored ones, because a kind that was legitimate when the
// photo was taken does not stop being the truth about that photo.
global.set('kindsFor', async function(pool, orgId, scope, builtins){
  const byKey={}; const order=[];
  for(let i=0;i<builtins.length;i++){ const b=builtins[i]; byKey[b.key]={...b, position:i, active:1, builtin:true}; order.push(b.key); }
  try{
    const[r]=await pool.query("SELECT kind_key,label,hint,position,active FROM kind_catalog WHERE org_id=? AND scope=? ORDER BY position, id",[orgId,scope]);
    for(const x of r){
      if(byKey[x.kind_key]){
        // An override of a built-in: only the fields the admin actually set.
        const b=byKey[x.kind_key];
        if(x.label) b.label=x.label;
        if(x.hint!==null&&x.hint!==undefined) b.hint=x.hint;
        b.position=x.position; b.active=Number(x.active)?1:0;
      }else{
        byKey[x.kind_key]={ key:x.kind_key, label:x.label||x.kind_key, hint:x.hint||'', position:x.position, active:Number(x.active)?1:0, builtin:false };
        order.push(x.kind_key);
      }
    }
  }catch(e){ if(String(e&&e.message||'').indexOf('kind_catalog')<0) throw e; }
  return order.map(k=>byKey[k]).sort((a,b)=>a.position-b.position);
});
// Is a device at a site this user may see?
//
// A device with NO site is visible to everyone in the org. It is unassigned, not
// somebody else's: hiding it would make every freshly auto-registered device
// invisible to the very people who need to approve and place it, and an admin
// who has not finished assigning sites would watch their fleet disappear.
global.set('siteVisible', function(acc, siteId){
  if(!acc || !acc.siteScoped) return true;
  if(!siteId) return true;
  return acc.siteIds.indexOf(siteId) >= 0;
});
// 'jwt' is injected. Async guard: JWT + role + org-scope + device (node) access.
global.set('guard', async function(authHeader, policy, req){
  if(policy==='public') return {ok:true,auth:null};
  let claims;
  // Bearer header is the norm; a ?token= query param is the fallback for contexts
  // that cannot set headers — e.g. an <img src> loading a protected floor-plan image.
  try{ const tok=((authHeader||'').replace(/^Bearer /,''))||(req&&req.query&&req.query.token)||''; if(!tok) return {ok:false,code:401,error:'authentication required'};
       claims=jwt.verify(tok, env.get('JWT_SECRET')||'dev-secret-change-me'); }
  catch(e){ return {ok:false,code:401,error:'invalid token'}; }
  if(policy==='super' && claims.role!=='superadmin') return {ok:false,code:403,error:'superadmin only'};
  if(policy==='admin' && claims.role!=='admin' && claims.role!=='superadmin') return {ok:false,code:403,error:'admin only'};
  if(claims.role!=='superadmin' && claims.orgId){ const pool=global.get('pool'); const [orgCheck]=await pool.query("SELECT status FROM organizations WHERE id=?",[claims.orgId]); if(!orgCheck.length || orgCheck[0].status==='suspended') return {ok:false,code:403,error:'organization is suspended'}; }
  const oid=(req.params&&req.params.orgId)||(policy==='org'&&req.query&&req.query.orgId);
  if(claims.role!=='superadmin' && oid && oid!==claims.orgId) return {ok:false,code:403,error:'outside your organization'};
  if((policy==='node'||policy==='node:manage'||policy==='event:view'||policy==='event:manage') && claims.role!=='superadmin'){
    const pool=global.get('resolvePool')(claims.orgId); const isEvent=policy.indexOf('event:')===0; const needManage=(policy==='node:manage'||policy==='event:manage');
    let nm;
    if(isEvent) nm=(await pool.query("SELECT n.id AS node_id,n.org_id,n.domain,n.department_id,n.site_id FROM alarm_events e JOIN nodes n ON n.id=e.node_id WHERE e.id=?",[req.params.id]))[0];
    else nm=(await pool.query("SELECT org_id,domain,department_id,site_id FROM nodes WHERE id=?",[req.params.id]))[0];
    if(!nm.length) return {ok:false,code:404,error:'not found'};
    const node=nm[0];
    if(node.org_id!==claims.orgId) return {ok:false,code:403,error:'no access to this device'};
    if(claims.role!=='admin'){
      const acc=await global.get('accessFor')(claims.userId);
      const lvl=acc.levels[node.domain]||'none';
      if(lvl==='none') return {ok:false,code:403,error:'no access to this device'};
      if(needManage && lvl!=='manage') return {ok:false,code:403,error:'manage required'};
      // deptVisible, not a bare compare against node.department_id: a device
      // can now be granted to a SET of departments (node_departments, v35),
      // and acc.departmentIds is itself a set (a user can belong to several).
      // With no grants this is identical to the old single-column check.
      let __granted=[];
      try{ const[g]=await pool.query("SELECT department_id FROM node_departments WHERE node_id=?",[isEvent?node.node_id||req.params.id:req.params.id]); __granted=g.map(x=>x.department_id); }
      catch(e){ if(String(e&&e.message||'').indexOf('node_departments')<0) throw e; }
      if(!global.get('deptVisible')(acc, node.department_id, __granted)) return {ok:false,code:403,error:'no access to this device'};
      // Site scoping is enforced HERE, not only in the fleet list: this guard is
      // the single gate in front of every per-device endpoint (readings, events,
      // rule, documents, report, photo, latest), so filtering the list alone
      // would hide a device from the UI while leaving its data one guessed id
      // away. Filtering only in the frontend is security theatre.
      if(!global.get('siteVisible')(acc, node.site_id)) return {ok:false,code:403,error:'no access to this site'};
      // Per-user device restriction (v42), enforced HERE for the same reason
      // site scoping is: this guard is the single gate in front of every
      // per-device endpoint, so restricting the list alone would leave the
      // data one guessed id away.
      if(!global.get('nodeVisible')(acc, isEvent?(node.node_id||req.params.id):req.params.id)) return {ok:false,code:403,error:'no access to this device'};
    }
  }
  return {ok:true, auth:claims};
});
// --- Platform email config (DB-backed, superadmin-managed) ------------------
// SMTP settings live in platform_settings (control DB). The password is stored
// crypto-js AES encrypted; the key derives from SETTINGS_KEY (or JWT_SECRET). All
// senders (forgot/welcome/report/alarm) go through mailConfig() so a superadmin
// can change the sender/SMTP from the UI without redeploying. Falls back to the
// SMTP_* / MAIL_FROM env vars when the DB has none.
// Secrets are encrypted at rest with crypto-js AES. crypto-js is a real npm
// package so it installs cleanly as a functionExternalModule — unlike node:crypto,
// which Node-RED can't resolve as an external module (it tries to npm-install it),
// and which also can't live in functionGlobalContext (circular-reference error).
const __MAILKEY = env.get('SETTINGS_KEY') || env.get('JWT_SECRET') || 'dev-secret-change-me';
global.set('encryptSecret', function(plain){
  if(!plain) return '';
  return 'v2:' + CryptoJS.AES.encrypt(String(plain), __MAILKEY).toString();
});
global.set('decryptSecret', function(enc){
  try{
    const s = String(enc||'');
    if(s.slice(0,3)==='v2:') return CryptoJS.AES.decrypt(s.slice(3), __MAILKEY).toString(CryptoJS.enc.Utf8);
    if(s.slice(0,3)==='v1:') return '';   // legacy node:crypto blob → unreadable here, treat as unset
    return s;                             // plaintext / empty
  }catch(e){ node.warn('decryptSecret failed: '+e.message); return ''; }
});
// Returns { transport|null, from, frontendUrl }. Cached 60s; invalidated on save.
global.set('mailConfig', async function(){
  const cached = global.get('__mailCfg');
  if(cached && Date.now() < cached.exp) return cached.val;
  const pool = global.get('pool'); const m = {};
  try{ const [r] = await pool.query("SELECT skey,sval FROM platform_settings"); for(const x of r) m[x.skey]=x.sval; }
  catch(e){ /* table missing → pure env fallback */ }
  const host = m['smtp.host'] || env.get('SMTP_HOST') || '';
  const from = m['smtp.from'] || env.get('MAIL_FROM') || 'alerts@oneops.local';
  const frontendUrl = m['app.frontendUrl'] || env.get('FRONTEND_URL') || 'http://localhost:3000';
  let transport = null;
  if(host){
    const user = m['smtp.user'] || env.get('SMTP_USER') || '';
    const pass = m['smtp.pass'] ? global.get('decryptSecret')(m['smtp.pass']) : (env.get('SMTP_PASS') || '');
    const port = Number(m['smtp.port'] || env.get('SMTP_PORT') || 587);
    transport = nodemailer.createTransport({ host, port, secure: port===465, auth: user ? { user, pass } : undefined });
  }
  const val = { transport, from, frontendUrl };
  global.set('__mailCfg', { val, exp: Date.now()+60000 });
  return val;
});
// Notification channel tokens (Telegram/LINE/Google Chat), same DB-backed pattern
// as mailConfig: platform_settings (tokens encrypted) with env fallback, 60s cache.
global.set('notifyConfig', async function(){
  const cached = global.get('__notifyCfg');
  if(cached && Date.now() < cached.exp) return cached.val;
  const pool = global.get('pool'); const m = {};
  try{ const [r] = await pool.query("SELECT skey,sval FROM platform_settings WHERE skey LIKE 'notify.%'"); for(const x of r) m[x.skey]=x.sval; }
  catch(e){ /* table missing → env fallback */ }
  const dec = global.get('decryptSecret');
  const val = {
    telegramToken: m['notify.telegramToken'] ? dec(m['notify.telegramToken']) : (env.get('TELEGRAM_BOT_TOKEN')||''),
    telegramChatId: m['notify.telegramChatId'] || env.get('TELEGRAM_CHAT_ID') || '',
    lineToken: m['notify.lineToken'] ? dec(m['notify.lineToken']) : (env.get('LINE_NOTIFY_TOKEN')||''),
    googleChatWebhook: m['notify.googleChatWebhook'] ? dec(m['notify.googleChatWebhook']) : (env.get('GOOGLE_CHAT_WEBHOOK')||''),
  };
  global.set('__notifyCfg', { val, exp: Date.now()+60000 });
  return val;
});

// Notify Org Admins when a new user self-registers and is pending approval
global.set('notifyAdminNewUser', async function(pool, orgId, newUser){
  try {
    const [admins] = await pool.query("SELECT email, name FROM users WHERE org_id=? AND role='admin' AND email IS NOT NULL", [orgId]);
    const mc = await global.get('mailConfig')();
    const nc = await global.get('notifyConfig')();
    const frontendUrl = mc.frontendUrl || 'https://iiotplatform.thermexpertise.com';
    const approveUrl = (frontendUrl.replace(/\\/+$/,'') + '/admin/users/?tab=users');
    
    const subject = '🔔 [Action Required] New User Registration Pending Approval: ' + newUser.name;
    const text = 'Hello Admin,\\n\\nA new user has registered for organization "' + orgId + '" and is pending your approval:\\n\\n' +
      '• Name: ' + newUser.name + '\\n' +
      '• Email: ' + newUser.email + '\\n' +
      '• Phone: ' + (newUser.phone || '—') + '\\n' +
      '• Role Requested: Viewer\\n\\n' +
      'Please sign in to approve this user and assign them to departments:\\n' +
      approveUrl + '\\n\\n' +
      'Thanks,\\nONEOPS System';

    const html = '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">' +
      '<h2 style="color: #6366f1; margin-top: 0;">🔔 New User Registration Pending Approval</h2>' +
      '<p>A new user has registered for organization <strong style="color: #a5b4fc;">' + orgId + '</strong> and requires admin review:</p>' +
      '<table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #1e293b; border-radius: 8px; overflow: hidden;">' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8; width: 140px;">Name</td><td style="padding: 10px 16px; font-weight: bold; color: #ffffff;">' + newUser.name + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Email</td><td style="padding: 10px 16px; color: #ffffff;">' + newUser.email + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Phone</td><td style="padding: 10px 16px; color: #ffffff;">' + (newUser.phone || '—') + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Requested Role</td><td style="padding: 10px 16px; color: #4ade80;">Viewer</td></tr>' +
      '</table>' +
      '<p style="margin: 24px 0 12px;"><a href="' + approveUrl + '" style="background: #6366f1; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block;">Review & Approve in User Management →</a></p>' +
      '<p style="font-size: 12px; color: #64748b; margin-top: 24px;">ONEOPS Industrial Platform</p>' +
      '</div>';

    if (mc.transport && admins.length) {
      for (const adm of admins) {
        if (adm.email) await mc.transport.sendMail({ from: mc.from, to: adm.email, subject, text, html }).catch(()=>{});
      }
    }

    const tgToken = nc && nc.telegramToken;
    const tgChat = nc && nc.telegramChatId;
    if (tgToken && tgChat) {
      const tgMsg = '🔔 <b>New User Pending Approval</b>\\n' +
        'Organization: <code>' + orgId + '</code>\\n' +
        'Name: <b>' + newUser.name + '</b>\\n' +
        'Email: <code>' + newUser.email + '</code>\\n' +
        'Phone: ' + (newUser.phone || '—') + '\\n\\n' +
        '<a href=\"' + approveUrl + '\">Open User Management to Approve</a>';
      await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: tgMsg, parse_mode: 'HTML' })
      }).catch(()=>{});
    }
  } catch (err) {
    node.warn('notifyAdminNewUser failed: ' + err.message);
  }
});

// Notify the new User themselves that their account was created and is
// waiting on an admin to approve it — companion to notifyAdminNewUser, which
// only reaches the org's admins. Without this, a self-registered (or
// admin-created-as-pending) user has no way to know their signup even
// worked until someone tells them out of band.
global.set('notifyUserPendingApproval', async function(pool, orgId, newUser){
  try {
    if (!newUser || !newUser.email) return;
    const mc = await global.get('mailConfig')();

    const subject = '⏳ Your ONEOPS account is pending approval';
    const text = 'Hello ' + newUser.name + ',\\n\\n' +
      'Thanks for registering for organization "' + orgId + '".\\n\\n' +
      'Your account has been created but is not active yet — an administrator ' +
      'needs to review and approve it before you can sign in. You will receive ' +
      'another email as soon as your account is activated.\\n\\n' +
      '• Name: ' + newUser.name + '\\n' +
      '• Email: ' + newUser.email + '\\n\\n' +
      'No action is needed from you right now.\\n\\n' +
      'Best regards,\\nONEOPS System';

    const html = '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">' +
      '<h2 style="color: #fbbf24; margin-top: 0;">⏳ Your Account is Pending Approval</h2>' +
      '<p>Hello <strong>' + newUser.name + '</strong>,</p>' +
      '<p>Thanks for registering for organization <strong style="color: #a5b4fc;">' + orgId + '</strong>. Your account has been created but is not active yet — an administrator needs to review and approve it before you can sign in.</p>' +
      '<table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #1e293b; border-radius: 8px; overflow: hidden;">' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8; width: 140px;">Name</td><td style="padding: 10px 16px; font-weight: bold; color: #ffffff;">' + newUser.name + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Email</td><td style="padding: 10px 16px; color: #ffffff;">' + newUser.email + '</td></tr>' +
      '</table>' +
      '<p>You will receive another email as soon as your account is activated. No action is needed from you right now.</p>' +
      '<p style="font-size: 12px; color: #64748b; margin-top: 24px;">ONEOPS Industrial Platform</p>' +
      '</div>';

    if (mc.transport) {
      await mc.transport.sendMail({ from: mc.from, to: newUser.email, subject, text, html }).catch(()=>{});
    }
  } catch (err) {
    node.warn('notifyUserPendingApproval failed: ' + err.message);
  }
});

// Notify User when their account is activated/approved by Admin or created manually
global.set('notifyUserActivated', async function(pool, orgId, user, deptNames){
  try {
    if (!user || !user.email) return;
    const mc = await global.get('mailConfig')();
    const nc = await global.get('notifyConfig')();
    const frontendUrl = mc.frontendUrl || 'https://iiotplatform.thermexpertise.com';
    const loginUrl = (frontendUrl.replace(/\\/+$/,'') + '/');
    
    const subject = '🎉 Welcome to ONEOPS — Your Account is Active!';
    const text = 'Hello ' + user.name + ',\\n\\n' +
      'Your account for organization "' + orgId + '" has been activated!\\n\\n' +
      '• Role: ' + (user.role || 'viewer') + '\\n' +
      '• Department: ' + (deptNames || 'General') + '\\n' +
      '• Login Portal: ' + loginUrl + '\\n' +
      '• Username / Email: ' + (user.email || user.username) + '\\n\\n' +
      'You can now sign in to view your organization dashboard and devices.\\n\\n' +
      'Best regards,\\n' + orgId + ' Administration Team';

    const html = '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">' +
      '<h2 style="color: #4ade80; margin-top: 0;">🎉 Welcome! Your Account is Active</h2>' +
      '<p>Hello <strong>' + user.name + '</strong>,</p>' +
      '<p>Your account for organization <strong style="color: #a5b4fc;">' + orgId + '</strong> has been approved and activated by an administrator.</p>' +
      '<table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #1e293b; border-radius: 8px; overflow: hidden;">' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8; width: 140px;">Role</td><td style="padding: 10px 16px; font-weight: bold; color: #ffffff;">' + (user.role || 'viewer') + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Department</td><td style="padding: 10px 16px; color: #ffffff;">' + (deptNames || 'General') + '</td></tr>' +
      '<tr><td style="padding: 10px 16px; color: #94a3b8;">Sign-in ID</td><td style="padding: 10px 16px; color: #ffffff;">' + (user.email || user.username) + '</td></tr>' +
      '</table>' +
      '<p style="margin: 24px 0 12px;"><a href="' + loginUrl + '" style="background: #4ade80; color: #0f172a; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block;">Sign In to Dashboard →</a></p>' +
      '<p style="font-size: 12px; color: #64748b; margin-top: 24px;">ONEOPS Industrial Platform</p>' +
      '</div>';

    if (mc.transport && user.email) {
      await mc.transport.sendMail({ from: mc.from, to: user.email, subject, text, html }).catch(()=>{});
    }

    const tgToken = nc && nc.telegramToken;
    const tgChat = nc && nc.telegramChatId;
    if (tgToken && tgChat) {
      const tgMsg = '🎉 <b>User Account Activated</b>\\n' +
        'Organization: <code>' + orgId + '</code>\\n' +
        'User: <b>' + user.name + '</b> (' + (user.email || '') + ')\\n' +
        'Role: ' + (user.role || 'viewer') + '\\n' +
        'Department: ' + (deptNames || 'General');
      await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: tgMsg, parse_mode: 'HTML' })
      }).catch(()=>{});
    }
  } catch (err) {
    node.warn('notifyUserActivated failed: ' + err.message);
  }
});

// Domain -> platform id, mirroring frontend-next/src/lib/entitlements.ts's
// DOMAIN_TO_PLATFORM exactly. org_entitlements.platform stores the platform
// id (e.g. 'eternityTransformers'), not the domain string alarm_rules/nodes
// key on (e.g. 'transformer') — the two only look alike for bloodBox/automobile.
const __DOMAIN_TO_PLATFORM={transformer:'eternityTransformers',carbonNode:'refrigerationDataLogger',bloodBox:'bloodBox',automobile:'automobile'};
// Was the org actually SOLD this product? guard()'s 'admin' policy already
// proves org membership + role, but never entitlement — an admin role passes
// straight through guard()'s node-scoped product_access/department/site
// checks too (see guard()'s 'if(claims.role!=='admin')' branch), so nothing
// upstream of this stops an admin from writing (and apply-to-fleet-ing)
// alarm thresholds for a domain their org never licensed. The org-scoped
// default endpoints (orgRuleFunc/orgRuleGetFunc) are the ones actually
// reachable with no per-device anchor at all — unlike the per-node rule
// endpoints, whose domain always comes from an existing nodes row, not a
// caller-supplied string — so that is where this gate is applied. Superadmin
// bypasses: they are the one who GRANTS entitlements (entPutFunc, policy
// 'super'), the same exemption guard() already gives them everywhere else.
global.set('domainEntitled', async function(claims, orgId, domain){
  if (claims && claims.role === 'superadmin') return true;
  const platform = __DOMAIN_TO_PLATFORM[domain];
  if (!platform) return true; // unrecognized domain string: not this gate's job to reject it
  const pool = global.get('pool'); // org_entitlements is control-plane only, never per-tenant
  const [r] = await pool.query("SELECT 1 FROM org_entitlements WHERE org_id=? AND platform=? LIMIT 1", [orgId, platform]);
  return r.length > 0;
});

node.warn('ONEOPS Node-RED backend: pool + engine + auth guard ready');
`

// Login: verify bcrypt password → issue JWT (userId/orgId/role).
const loginFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
const ip=((msg.req.headers['x-forwarded-for']||'').split(',')[0].trim())||(msg.req.ip)||'unknown';
const rl=global.get('loginRL')||{}; const max=Number(env.get('LOGIN_MAX_ATTEMPTS')||10); const win=Number(env.get('LOGIN_WINDOW_MIN')||15)*60000; const now=Date.now(); const rec=rl[ip];
if(rec && now<rec.resetAt && rec.n>=max){msg.headers=__CORS;msg.statusCode=429;msg.payload={error:'too many login attempts — try again later'};return msg;}

(async()=>{
  const ident=String(b.email||b.username||'').trim();
  if(!ident || !b.password){
    msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'Please enter username/email and password'};
    node.send(msg);return;
  }

  // Detect organization scope from request payload or Host header subdomain
  const hostHeader = (msg.req.headers['host'] || '').split(':')[0].toLowerCase();
  const hostParts = hostHeader.split('.');
  let hostOrg = null;
  const genericHosts = ['iiotplatform', 'www', 'app', 'dashboard', 'localhost', 'nodered', 'argocd', 'grafana', 'emqx', 'pma', 'api', 'admin'];
  if (hostParts.length >= 2 && !genericHosts.includes(hostParts[0]) && !/^\\d+$/.test(hostParts[0])) {
    hostOrg = hostParts[0];
  }
  const reqOrg = b.orgId || hostOrg;
  let canonicalReqOrg = null;
  if (reqOrg) {
    const cleanReq = String(reqOrg).replace(/^org-/, '');
    const altReq = String(reqOrg).startsWith('org-') ? cleanReq : ('org-' + cleanReq);
    try {
      const [oc] = await pool.query(
        "SELECT id FROM organizations WHERE id=? OR id=? OR id=? ORDER BY CASE WHEN id=? THEN 1 WHEN id=? THEN 2 ELSE 3 END LIMIT 1",
        [reqOrg, altReq, cleanReq, reqOrg, altReq]
      );
      canonicalReqOrg = oc.length ? oc[0].id : reqOrg;
    } catch(e) { canonicalReqOrg = reqOrg; }
  }

  let u = [];
  const hasStatusCol = await global.get('usersHasStatusColumn')(pool);
  const statusSel = hasStatusCol ? "COALESCE(u.status,'active') AS user_status" : "'active' AS user_status";
  try {
    let userQuery = "SELECT u.id,u.org_id,u.role,u.name,u.email,u.password_hash," + statusSel + ",o.status FROM users u LEFT JOIN organizations o ON u.org_id=o.id WHERE (u.email=? OR u.username=? OR u.id=?)";
    let userArgs = [ident, ident, ident];
    if (canonicalReqOrg) {
      userQuery += " AND (u.org_id=? OR u.role='superadmin')";
      userArgs.push(canonicalReqOrg);
    }
    userQuery += " ORDER BY (u.email=?) DESC, (u.username=?) DESC LIMIT 1";
    userArgs.push(ident, ident);
    const [rows] = await pool.query(userQuery, userArgs);
    u = rows;
  } catch(colErr) {
    try {
      let userQuery = "SELECT u.id,u.org_id,u.role,u.name,u.email,u.password_hash,'active' AS user_status,o.status FROM users u LEFT JOIN organizations o ON u.org_id=o.id WHERE (u.email=? OR u.id=?)";
      let userArgs = [ident, ident];
      if (canonicalReqOrg) {
        userQuery += " AND (u.org_id=? OR u.role='superadmin')";
        userArgs.push(canonicalReqOrg);
      }
      userQuery += " LIMIT 1";
      const [rows] = await pool.query(userQuery, userArgs);
      u = rows;
    } catch(err2) {
      const [rows] = await pool.query("SELECT id,org_id,role,name,email,password_hash,'active' AS user_status FROM users WHERE email=? OR id=? LIMIT 1", [ident, ident]);
      u = rows;
    }
  }

  if(!u.length || !u[0].password_hash || !(await bcrypt.compare(b.password||'', u[0].password_hash))){
    rl[ip]=(!rec||now>rec.resetAt)?{n:1,resetAt:now+win}:{n:rec.n+1,resetAt:rec.resetAt};
    global.set('loginRL',rl);
    msg.headers=__CORS;msg.statusCode=401;
    msg.payload={error: canonicalReqOrg ? ('Invalid credentials or account does not belong to organization ' + canonicalReqOrg) : 'Invalid credentials'};
    node.send(msg);return;
  }
  if(u[0].status==='suspended'){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'Organization is suspended'};node.send(msg);return;}
  if(u[0].user_status==='pending'){
    msg.headers=__CORS;msg.statusCode=403;
    msg.payload={error:'Your account is pending administrator approval. Please wait for an administrator to activate your account.'};
    node.send(msg);return;
  }
  if(u[0].user_status==='rejected'||u[0].user_status==='disabled'){
    msg.headers=__CORS;msg.statusCode=403;
    msg.payload={error:'Your account is disabled or was not approved.'};
    node.send(msg);return;
  }
  delete rl[ip]; global.set('loginRL',rl);
  const claims={userId:u[0].id,orgId:u[0].org_id||'',role:u[0].role||'viewer'};
  const token=jwt.sign(claims, env.get('JWT_SECRET')||'dev-secret-change-me', {expiresIn: env.get('JWT_TTL')||'12h'});
  msg.headers=__CORS; msg.payload={token, user:{id:claims.userId,orgId:claims.orgId,role:claims.role,name:u[0].name||u[0].email||u[0].id,email:u[0].email||''}}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const registerFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.name||!b.email||!b.password){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'missing fields'};return msg;}
(async()=>{
  let orgId = null, role = 'admin', deptId = null, userStatus = 'active';
  const phone = b.phone ? b.phone.replace(/[^0-9+]/g, '') : '';

  // Extract host-derived subdomain org if present
  const hostHeader = (msg.req.headers['host'] || '').split(':')[0].toLowerCase();
  const hostParts = hostHeader.split('.');
  let hostOrg = null;
  const genericHosts = ['iiotplatform', 'www', 'app', 'dashboard', 'localhost', 'nodered', 'argocd', 'grafana', 'emqx', 'pma', 'api', 'admin'];
  if (hostParts.length >= 2 && !genericHosts.includes(hostParts[0]) && !/^\\d+$/.test(hostParts[0])) {
    hostOrg = hostParts[0];
  }
  const targetOrg = b.orgId || hostOrg;

  // 1. Check existing accounts in users table for duplicates
  const dupQ = []; const dupArgs = [];
  if (b.email) { dupQ.push("LOWER(email)=LOWER(?)"); dupArgs.push(b.email.trim()); }
  if (phone) { dupQ.push("(phone IS NOT NULL AND phone=? AND phone<>'')"); dupArgs.push(phone); }
  if (b.name) { dupQ.push("LOWER(name)=LOWER(?)"); dupArgs.push(b.name.trim()); }
  if (dupQ.length) {
    const [dups] = await pool.query("SELECT email, phone, name FROM users WHERE " + dupQ.join(" OR "), dupArgs);
    if (dups.length > 0) {
      const match = dups[0];
      msg.headers = __CORS; msg.statusCode = 409;
      if (match.email && b.email && match.email.toLowerCase() === b.email.trim().toLowerCase()) {
        msg.payload = { error: 'An account with this email address already exists. Please sign in or reset your password.' };
      } else if (match.phone && phone && match.phone === phone) {
        msg.payload = { error: 'An account with this phone number already exists.' };
      } else {
        msg.payload = { error: 'An account with this name already exists. Please use a distinct username/name.' };
      }
      node.send(msg); return;
    }
  }

  // 2. Search employee directory
  const searchQ = []; const searchArgs = [];
  if (b.email) { searchQ.push("email=?"); searchArgs.push(b.email); }
  if (phone) { searchQ.push("phone=?"); searchArgs.push(phone); }
  if (b.name) { searchQ.push("name=?"); searchArgs.push(b.name); }
  if (searchQ.length) {
    const [matches] = await pool.query("SELECT * FROM org_directory WHERE " + searchQ.join(" OR "), searchArgs);
    if (matches.length > 0) {
      let best = matches.find(m => m.email && m.email.toLowerCase() === b.email.toLowerCase());
      if (!best && phone) best = matches.find(m => m.phone === phone);
      if (!best && b.name) best = matches.find(m => m.name && m.name.toLowerCase() === b.name.toLowerCase());
      if (best) { orgId = best.org_id; deptId = best.department_id; role = 'viewer'; userStatus = 'pending'; }
    }
  }

  // If explicit orgId/subdomain was provided (joining specific org as Viewer)
  if (!orgId && targetOrg) {
    const cleanTarget = String(targetOrg).replace(/^org-/, '');
    const altTarget = String(targetOrg).startsWith('org-') ? cleanTarget : ('org-' + cleanTarget);
    const [orgCheck] = await pool.query(
      "SELECT id FROM organizations WHERE id=? OR id=? OR id=? ORDER BY CASE WHEN id=? THEN 1 WHEN id=? THEN 2 ELSE 3 END LIMIT 1",
      [targetOrg, altTarget, cleanTarget, targetOrg, altTarget]
    );
    if (orgCheck.length > 0) {
      orgId = orgCheck[0].id;
      role = 'viewer';
      userStatus = 'pending'; // Requires Admin approval before login
    }
  }

  let provisioned=null;
  if (!orgId) {
    const orgName = (b.orgName || ((b.name || 'New') + ' Organization'));
    orgId = await global.get('makeOrgId')(pool, orgName);
    await pool.query("INSERT INTO organizations (id, name, status) VALUES (?, ?, 'active')", [orgId, orgName]);
    await pool.query("INSERT INTO org_entitlements (org_id, platform) VALUES (?, 'eternityTransformers') ON DUPLICATE KEY UPDATE platform=platform", [orgId]);
    role = 'admin';
    userStatus = 'active';
    const murl=env.get('MIGRATE_URL');
    if(murl){ 
      try{ 
        const rr=await fetch(murl.replace(/\\/+$/,'')+'/migrate/org/'+encodeURIComponent(orgId),{method:'POST'}); 
        provisioned=rr.ok?await rr.json():{error:'migrate HTTP '+rr.status}; 
        if(!rr.ok) node.warn('self-register org migrate '+orgId+': HTTP '+rr.status); 
        else if (provisioned && provisioned.ok) {
          const tenantDb = provisioned.db || ('iothub_' + orgId.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
          try {
            await pool.query("INSERT IGNORE INTO " + tenantDb + ".nodes (id, org_id, site_id, department_id, domain, name, mqtt_prefix, lat, lng, status, first_seen) SELECT id, ?, site_id, department_id, domain, name, mqtt_prefix, lat, lng, status, first_seen FROM iothub.nodes WHERE id LIKE 'tr-%'", [orgId]);
            await pool.query("INSERT IGNORE INTO " + tenantDb + ".alarm_rules (node_id, org_id, domain, rule_json, updated_by, updated_at) SELECT node_id, ?, domain, rule_json, updated_by, updated_at FROM iothub.alarm_rules WHERE node_id LIKE 'tr-%'", [orgId]);
            await pool.query("INSERT IGNORE INTO " + tenantDb + ".readings SELECT * FROM iothub.readings WHERE node_id LIKE 'tr-%' AND taken_at > NOW() - INTERVAL 7 DAY");
            await pool.query("INSERT IGNORE INTO " + tenantDb + ".alarm_events (id, node_id, org_id, department_id, param_key, param_label, severity, kind, value, threshold, unit, raised_at, acknowledged_at, acknowledged_by, event_problem_id, notified, escalated, cleared_at) SELECT id, node_id, ?, department_id, param_key, param_label, severity, kind, value, threshold, unit, raised_at, acknowledged_at, acknowledged_by, event_problem_id, notified, escalated, cleared_at FROM iothub.alarm_events WHERE node_id LIKE 'tr-%'", [orgId]);
          } catch (copyErr) {
            node.warn('Failed to copy sample devices to ' + tenantDb + ': ' + copyErr.message);
          }
        }
      }catch(e){ 
        node.warn('self-register org migrate trigger failed for '+orgId+': '+e.message); 
        provisioned={error:e.message}; 
      } 
    }
  }

  const hasStatusCol = await global.get('usersHasStatusColumn')(pool);
  if (!hasStatusCol && userStatus === 'pending') {
    // Can't persist "pending" without the column that enforces it — creating
    // the account anyway would silently grant access nobody approved.
    msg.headers=__CORS; msg.statusCode=503;
    msg.payload={error:'Registration approval needs migrate-v46 — ask your platform administrator to run the migration, then try registering again.'};
    node.send(msg); return;
  }

  const hash = await bcrypt.hash(b.password, 10);
  const userId = 'u-'+Date.now();
  if (hasStatusCol) {
    await pool.query("INSERT INTO users (id,org_id,department_id,email,phone,name,role,status,password_hash) VALUES (?,?,?,?,?,?,?,?,?)", [userId, orgId, deptId, b.email, phone||null, b.name, role, userStatus, hash]);
  } else {
    await pool.query("INSERT INTO users (id,org_id,department_id,email,phone,name,role,password_hash) VALUES (?,?,?,?,?,?,?,?)", [userId, orgId, deptId, b.email, phone||null, b.name, role, hash]);
  }

  // If user is pending approval, notify the Organization's Admin(s) via Email & Telegram,
  // and let the new user themselves know their signup is waiting on approval.
  if (userStatus === 'pending') {
    global.get('notifyAdminNewUser')(pool, orgId, { name: b.name, email: b.email, phone });
    global.get('notifyUserPendingApproval')(pool, orgId, { name: b.name, email: b.email });
  }

  // Always mirror user into tenant DB if tenant DB exists
  await global.get('mirrorUserToTenantDb')(pool, orgId, { id: userId, departmentId: deptId, email: b.email, phone, name: b.name, role, status: userStatus, passwordHash: hash });

  msg.headers=__CORS;
  msg.payload={
    ok: true,
    pending: userStatus === 'pending',
    userId,
    orgId,
    role,
    provisioned,
    message: userStatus === 'pending'
      ? 'Registration submitted! Your account is pending administrator approval before you can sign in.'
      : 'Account created successfully!'
  };
  node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const forgotFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.email){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'missing email'};return msg;}
(async()=>{
  const [users] = await pool.query("SELECT id, name FROM users WHERE email=?", [b.email]);
  if(users.length) {
    const u = users[0];
    // Use jwt (already an injected lib) to mint a signed, unguessable token —
    // avoids the Node-RED functionExternalModules gotcha where 'crypto' can pull
    // the deprecated npm stub instead of the built-in. jti keeps it unique.
    const token = jwt.sign({ uid: u.id, k: 'pwreset' }, env.get('JWT_SECRET')||'dev-secret-change-me', { expiresIn: '1h', jwtid: String(Date.now()) + Math.random().toString(36).slice(2) });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?,?,?)", [u.id, token, expiresAt]);
    try {
      const mc = await global.get('mailConfig')();
      if (mc.transport) {
        const resetUrl = (mc.frontendUrl || 'https://iiotplatform.27.254.143.144.nip.io:30443').replace(/\\/+$/, '') + '/reset?token=' + token;
        const text = 'Hello ' + u.name + ',\\n\\nYou requested a password reset. Please click the link below to set a new password:\\n\\n' + resetUrl + '\\n\\nIf you did not request this, please ignore this email.\\n\\nThanks,\\nAdmin';
        await mc.transport.sendMail({ from: mc.from, to: b.email, subject: 'Password Reset Request', text });
        node.warn('Forgot password email sent to ' + b.email);
      } else {
        node.warn("Forgot password: SMTP not configured, token generated but email not sent");
      }
    } catch (mailErr) {
      node.error('Forgot password sendMail failed: ' + mailErr.message);
    }
  }
  msg.headers=__CORS; msg.payload={ok:true, message:'recovery email sent if account exists'}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const resetFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.token||!b.password){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'missing token or password'};return msg;}
(async()=>{
  const [resets] = await pool.query("SELECT user_id FROM password_resets WHERE token=? AND used=0 AND expires_at > NOW()", [b.token]);
  if(!resets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'invalid or expired token'};node.send(msg);return;}
  const userId = resets[0].user_id;
  const hash = await bcrypt.hash(b.password, 10);
  await pool.query("UPDATE users SET password_hash=? WHERE id=?", [hash, userId]);
  await pool.query("UPDATE password_resets SET used=1 WHERE token=?", [b.token]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const passwordFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{}; const uid=(msg.auth&&msg.auth.userId)||'';
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'authentication required'};return msg;}
(async()=>{
  const [u] = await pool.query("SELECT password_hash FROM users WHERE id=?", [uid]);
  if(!u.length||!(await bcrypt.compare(b.currentPassword||'', u[0].password_hash))){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'invalid current password'};node.send(msg);return;}
  const hash = await bcrypt.hash(b.newPassword, 10);
  await pool.query("UPDATE users SET password_hash=? WHERE id=?", [hash, uid]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const floorplanGetFunc = CORS + `const pool=global.get('pool');
(async()=>{
  const [rows] = await pool.query("SELECT prefs FROM user_prefs WHERE user_id=?", [msg.req.params.orgId+'_floorplans']);
  msg.headers=__CORS; msg.payload = rows.length ? JSON.parse(rows[0].prefs||'{}') : {}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const floorplanPutFunc = CORS + `const pool=global.get('pool');
(async()=>{
  await pool.query("INSERT INTO user_prefs (user_id, prefs) VALUES (?, ?) ON DUPLICATE KEY UPDATE prefs=?", [msg.req.params.orgId+'_floorplans', JSON.stringify(msg.payload||{}), JSON.stringify(msg.payload||{})]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Floor-plan image upload: store the layout image BYTES in the floorplans table
// and return its served path (persistent, unlike the previous ephemeral blob URL).
const fpImagePostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const floorId=msg.req.params.floorId; const b=msg.payload||{};
if(!b.dataBase64){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'dataBase64 required'};return msg;}
(async()=>{
  const ct = b.contentType || 'image/png';
  const buf = Buffer.from(String(b.dataBase64).replace(/^data:[^,]+,/,''), 'base64');
  const url = '/api/orgs/'+encodeURIComponent(orgId)+'/floorplans/'+encodeURIComponent(floorId)+'/image';
  await pool.query("INSERT INTO floorplans (org_id, floor_id, image_url, image_data, content_type) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE image_url=VALUES(image_url), image_data=VALUES(image_data), content_type=VALUES(content_type)", [orgId, floorId, url, buf, ct]);
  msg.headers=__CORS; msg.payload={ ok:true, url: url+'?v='+Date.now() }; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Serve the stored floor-plan image. Org-scoped: the guard verifies a JWT (from
// the Authorization header OR a ?token= query param, since an <img> tag can't set
// headers) and that :orgId matches the caller's org — so a floor plan never leaks
// across organizations. Returns the raw bytes + content-type.
const fpImageGetFunc = `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId; const floorId=msg.req.params.floorId;
(async()=>{
  const [rows] = await pool.query("SELECT image_data, content_type, site_id FROM floorplans WHERE org_id=? AND floor_id=?", [orgId, floorId]);
  if(!rows.length || !rows[0].image_data){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  // Filtering the site picker is not enough: the image is a plain URL and a
  // floor id is guessable, so the bytes have to be gated too.
  if(au.role!=='superadmin' && au.role!=='admin'){
    const acc=await global.get('accessFor')(au.userId);
    if(!global.get('siteVisible')(acc, rows[0].site_id)){ msg.statusCode=403; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='no access to this site'; node.send(msg); return; }
  }
  msg.statusCode=200;
  msg.headers={ 'Content-Type': rows[0].content_type||'image/png', 'Cache-Control':'public, max-age=300', 'Access-Control-Allow-Origin':'*' };
  msg.payload = rows[0].image_data;   // Buffer (LONGBLOB) → binary response
  node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

// GET /api/orgs/:orgId/logo — the stored bytes. Same shape as the floor-plan
// image endpoint: an <img> cannot set an Authorization header, so the guard also
// accepts ?token= and enforces that :orgId matches the caller's org.
const orgLogoGetFunc = `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{
  let rows=[];
  try {
    const cleanId = String(orgId||'').replace(/^org-/, '');
    const altId = String(orgId||'').startsWith('org-') ? cleanId : ('org-' + cleanId);
    const[r]=await pool.query("SELECT image_data, content_type FROM org_logos WHERE org_id=? OR org_id=? ORDER BY CASE WHEN org_id=? THEN 1 ELSE 2 END LIMIT 1",[orgId, altId, orgId]);
    rows=r;
  }
  catch(e){ if(String(e&&e.message||'').indexOf('org_logos')<0) throw e; }
  if(!rows.length || !rows[0].image_data){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  msg.statusCode=200;
  msg.headers={ 'Content-Type': rows[0].content_type||'image/png', 'Cache-Control':'public, max-age=300', 'Access-Control-Allow-Origin':'*' };
  msg.payload = rows[0].image_data;
  node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

// GET /api/public/orgs/:orgId/logo — the same bytes as orgLogoGetFunc, but
// reachable with NO token. The login page has to show a customer's logo
// before that customer has signed in, so nothing in this request can require
// auth — there is no session yet to require it of. Deliberately its OWN
// route (not a policy change on the existing /api/orgs/:orgId/logo) so the
// authenticated endpoint's guarantees are untouched for every other caller.
//
// This does mean: given an org id, anyone can now fetch that org's logo
// image without logging in. Two things keep that acceptable —
//   1. It returns ONLY image bytes. Not the org's name, status, user count,
//      or anything else brandingPutFunc/orgLogoGetFunc could reveal — a
//      logo confirms "an org with this id exists and picked a logo",
//      nothing more.
//   2. 404 is returned identically whether the org id does not exist or the
//      org exists but never uploaded a logo — so this cannot be used to
//      enumerate which ids ARE customers, only (for an id already known,
//      e.g. from a link the customer was given) whether it has a logo set.
const orgLogoPublicFunc = `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{
  let rows=[];
  try {
    const cleanId = String(orgId||'').replace(/^org-/, '');
    const altId = String(orgId||'').startsWith('org-') ? cleanId : ('org-' + cleanId);
    const[r]=await pool.query("SELECT image_data, content_type FROM org_logos WHERE org_id=? OR org_id=? ORDER BY CASE WHEN org_id=? THEN 1 ELSE 2 END LIMIT 1",[orgId, altId, orgId]);
    rows=r;
  }
  catch(e){ if(String(e&&e.message||'').indexOf('org_logos')<0) throw e; }
  if(!rows.length || !rows[0].image_data){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  msg.statusCode=200;
  msg.headers={ 'Content-Type': rows[0].content_type||'image/png', 'Cache-Control':'public, max-age=300', 'Access-Control-Allow-Origin':'*' };
  msg.payload = rows[0].image_data;
  node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

// Per-company branding logo (org-admin scoped). Mirrors the Express
// PUT /orgs/:id/branding so the static frontend can persist a logo on prod.
// Partial update: only the fields present in the body are written, so saving a
// logo cannot blank the name and vice versa. Covers logoUrl, name (the label
// shown beside the sidebar logo instead of "ONEOPS") and the factory lat/lng —
// also registered as PUT /orgs/:id/location, which the Settings page has been
// calling since migrate-v11 without any handler behind it (silent 404).
const brandingPutFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
(async()=>{
  const sets=[], vals=[]; const orgId=msg.req.params.orgId;
  // The page sends the image as a base64 data: URL. It used to go straight into
  // organizations.logo_url (TEXT, 64 KB) — base64 of anything realistic exceeds
  // that, and STRICT_TRANS_TABLES turns the overflow into ER_DATA_TOO_LONG, so
  // the whole save 500'd. Decode it into org_logos and keep only the served path
  // in the column, which also keeps SELECT * FROM organizations small: that
  // query runs on every page load to hydrate the sidebar brand.
  if (typeof b.logoUrl==='string') {
    if (b.logoUrl.startsWith('data:')) {
      const m=/^data:([^;,]+)[^,]*,/.exec(b.logoUrl);
      const ct=(m&&m[1])||'image/png';
      const buf=Buffer.from(b.logoUrl.slice(b.logoUrl.indexOf(',')+1),'base64');
      if(!buf.length){ msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'logo image is empty'}; node.send(msg); return; }
      if(buf.length>5*1024*1024){ msg.headers=__CORS; msg.statusCode=413; msg.payload={error:'logo too large (max 5 MB)'}; node.send(msg); return; }
      try {
        await pool.query("INSERT INTO org_logos (org_id,image_data,content_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE image_data=VALUES(image_data),content_type=VALUES(content_type)",[orgId,buf,ct]);
      } catch(e) {
        if(String(e&&e.message||'').indexOf('org_logos')<0) throw e;
        msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'logo storage needs migrate-v24 — run the migration first'}; node.send(msg); return;
      }
      // ?v= busts the browser cache; the path itself never changes.
      sets.push('logo_url=?'); vals.push('/api/orgs/'+encodeURIComponent(orgId)+'/logo?v='+Date.now());
    } else if (b.logoUrl==='') {
      try { await pool.query("DELETE FROM org_logos WHERE org_id=?",[orgId]); } catch(e){ node.warn('logo delete skipped for '+orgId+': '+e.message); }
      sets.push('logo_url=?'); vals.push(null);
    } else {
      // Already a plain URL (externally hosted) — store as given.
      sets.push('logo_url=?'); vals.push(b.logoUrl);
    }
  }
  if (typeof b.name==='string' && b.name.trim()) { sets.push('name=?'); vals.push(b.name.trim().slice(0,120)); }
  if (b.lat!==undefined) { sets.push('lat=?'); vals.push(b.lat===null?null:Number(b.lat)); }
  if (b.lng!==undefined) { sets.push('lng=?'); vals.push(b.lng===null?null:Number(b.lng)); }
  if (!sets.length){ msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'nothing to update'}; node.send(msg); return; }
  // An org admin can only rebrand their own org; superadmin can touch any.
  const au=msg.auth||{};
  if (au.role!=='superadmin' && au.orgId && au.orgId!==msg.req.params.orgId){ msg.headers=__CORS; msg.statusCode=403; msg.payload={error:'forbidden'}; node.send(msg); return; }
  vals.push(msg.req.params.orgId);
  await pool.query("UPDATE organizations SET "+sets.join(',')+" WHERE id=?", vals);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const aiQueryFunc = CORS + `
msg.headers=__CORS; msg.payload={
  answer: "Based on the telemetry data, there are 2 critical anomalies in the BloodBOX units located in Floor 3. The refrigeration systems are showing elevated temperatures above 8°C. I recommend immediate maintenance on BBX-03 and BBX-04.",
  sources: ["bbx-telemetry", "fleet-events"]
}; return msg;`

// On-demand report: a real readings summary (avg/min/max per node+param) for the
// caller's org, scoped by ?scope=org|department|device &scopeId= &domain= &days=.
// Mirrors the scheduled report-cron aggregation.
//
// Registered policy is 'auth' (any signed-in user), not 'node' — this endpoint
// covers a whole SET of devices, which the single-device 'node' check in
// guard() does not fit. That meant nothing enforced org, department or product
// access here at all: scope=device trusted scopeId as ANY node id with no
// org_id check, so a viewer in one org could read another org's telemetry by
// guessing/knowing a node id — confirmed against real MySQL: an org-A viewer's
// request for org-B's device returned org-B's actual reading. scope=department
// had the matching same-org hole — scopeId was never checked against the
// caller's OWN departments, so one department's viewer could pull another
// department's data in the same org. Fixed on both axes below.
const reportsDownloadFunc = CORS + `const au=msg.auth||{}; const q=msg.req.query||{};
const orgId = au.role==='superadmin' ? (q.orgId||au.orgId) : (au.orgId||'');
const pool = global.get('resolvePool')(orgId);
const days = Math.max(1, Math.min(365, Number(q.days)||30));
const scope=q.scope||'org'; const scopeId=q.scopeId||''; const domain=q.domain||'';
(async()=>{ try{
  let nodeIds=[];
  // scope=device: verify the id actually belongs to THIS org before trusting
  // it — an unqualified "nodeIds=[scopeId]" is exactly what let one org read
  // another's telemetry by guessing a node id.
  if(scope==='device' && scopeId){
    const[dn]=await pool.query("SELECT id FROM nodes WHERE id=? AND org_id=? AND status='active'",[scopeId,orgId]);
    nodeIds=dn.map(n=>n.id);
  } else {
    let sql="SELECT id FROM nodes WHERE org_id=? AND status='active'"; const a=[orgId];
    // scope=department: for a non-admin/superadmin caller, scopeId must be one
    // of THEIR OWN departments — otherwise one department's viewer could
    // request another department's id and read data node_departments and
    // deptVisible would never have shown them.
    if(scope==='department' && scopeId){
      if(au.role!=='admin' && au.role!=='superadmin'){
        const acc0=await global.get('accessFor')(au.userId);
        if((acc0.departmentIds||[]).indexOf(scopeId)<0){ msg.headers=__CORS; msg.statusCode=403; msg.payload={error:'not your department'}; node.send(msg); return; }
      }
      sql+=" AND department_id=?"; a.push(scopeId);
    }
    if(domain){ sql+=" AND domain=?"; a.push(domain); }
    const[ns]=await pool.query(sql,a); nodeIds=ns.map(n=>n.id);
  }
  // Whatever the scope resolved to, a non-admin/superadmin viewer must not
  // walk away with more than they could already see on the fleet list — the
  // same domain-level + department-grant + site check fleetListFunc applies.
  // Filtering only client-side (the frontend already only ever REQUESTS a
  // scope the viewer can see) is not a defence: this is the server enforcing
  // it against a caller who can set scope/scopeId to anything directly.
  if(nodeIds.length && au.role!=='admin' && au.role!=='superadmin'){
    const acc=await global.get('accessFor')(au.userId);
    const[rows]=await pool.query("SELECT id,domain,department_id,site_id FROM nodes WHERE id IN (?)",[nodeIds]);
    const grants=await global.get('nodeDeptMap')(pool, orgId);
    nodeIds=rows.filter(n=>{
      const lvl=acc.levels[n.domain]||'none'; if(lvl==='none') return false;
      if(!global.get('deptVisible')(acc,n.department_id,grants[n.id])) return false;
      if(!global.get('siteVisible')(acc,n.site_id)) return false;
      if(!global.get('nodeVisible')(acc,n.id)) return false;
      return true;
    }).map(n=>n.id);
  }
  let csv='node_id,param_key,samples,avg,min,max\\n';
  if(nodeIds.length){
    const[rows]=await pool.query("SELECT node_id,param_key,COUNT(*) n,AVG(value) a,MIN(value) mn,MAX(value) mx FROM readings WHERE node_id IN (?) AND taken_at>(NOW(3)-INTERVAL ? DAY) GROUP BY node_id,param_key ORDER BY node_id,param_key",[nodeIds,days]);
    for(const r of rows) csv += r.node_id+','+r.param_key+','+r.n+','+Number(r.a).toFixed(2)+','+Number(r.mn).toFixed(2)+','+Number(r.mx).toFixed(2)+'\\n';
  }
  msg.headers={...__CORS, 'Content-Type':'text/csv', 'Content-Disposition':'attachment; filename=\"oneops-report.csv\"'};
  msg.payload=csv; node.send(msg);
}catch(e){ msg.headers=__CORS; msg.statusCode=500; msg.payload={error:e.message}; node.send(msg); } })(); return null;`

const ingestFunc = `
const __H = { 'Access-Control-Allow-Origin': '*' };
const __http = !!(msg.req && msg.res);   // only HTTP-origin msgs get a response (out 3)

// In the new decoupled architecture, DB insertion and Alarm evaluation
// are handled by the Golang Worker (see backend/worker). Node-RED now only acts
// as a real-time WebSocket broadcaster; the Go worker publishes enriched
// payloads to 'internal/telemetry/live/#'. DB-per-tenant routing for the hot
// path therefore lives in the worker, not here (see docs/DB-PER-TENANT.md).

if (!msg.payload) return null;

// Pass payload to WebSocket (output 2)
node.send([null, msg, __http ? msg : null, null]);

if (__http) {
  msg.headers = __H;
  msg.payload = { status: 'delegated to worker or broadcasted' };
  node.send([msg, null, null, null]);
}
return null;`


const stormBatchFunc = `
const e = msg.payload;
if (!e || !e.paramKey || !e.severity) return null;

const batchKey = 'alarm_batch_' + e.nodeId;
const timerKey = 'alarm_timer_' + e.nodeId;

let batch = global.get(batchKey) || [];
batch.push(e);
global.set(batchKey, batch);

if (!global.get(timerKey)) {
  const t = setTimeout(() => {
    const finalBatch = global.get(batchKey) || [];
    global.set(batchKey, []);
    global.set(timerKey, null);
    if (finalBatch.length > 0) {
      node.send({ payload: finalBatch });
    }
  }, 10000);
  global.set(timerKey, t);
}
return null;
`

const notifyFunc = `
const alarms = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
if (!alarms || !alarms.length) return null;
const e = alarms[0];
if (!e.severity || !e.paramKey) return null; // Safety guard: ignore raw telemetry

const pool = global.get('resolvePool')(e.orgId);
const controlPool = global.get('pool') || pool;
const __TZ=env.get('DISPLAY_TZ')||'Asia/Bangkok';

const formatTime = (ts) => {
  try{ return new Date(ts).toLocaleString('en-GB',{timeZone:__TZ,hour12:false})+' ('+__TZ+')'; }catch(_){ return String(ts); }
};

// Domain-aware category & condition risk insight from industrial spec
const __RISK_MAP = {
  oilTemp: { cat: 'Thermal & Oil', critRisk: 'Winding/insulation damage risk (>90°C)', warnRisk: 'Top oil temperature high (>85°C)' },
  Oiltemp: { cat: 'Thermal & Oil', critRisk: 'Winding/insulation damage risk (>90°C)', warnRisk: 'Top oil temperature high (>85°C)' },
  windingTemp: { cat: 'Thermal & Oil', critRisk: 'Winding/hot-spot insulation risk (>110°C)', warnRisk: 'Winding temp high (>95°C)' },
  hydrogen: { cat: 'DGA Gas', critRisk: 'Corona discharge or partial arcing under oil (>300 ppm or rapid rate-of-rise)', warnRisk: 'Dissolved hydrogen elevated (>100 ppm)' },
  H2: { cat: 'DGA Gas', critRisk: 'Corona discharge or partial arcing under oil (>300 ppm or rapid rate-of-rise)', warnRisk: 'Dissolved hydrogen elevated (>100 ppm)' },
  moisture: { cat: 'Insulation', critRisk: 'Dielectric breakdown risk & bubble formation (>35 ppm)', warnRisk: 'Oil moisture elevated (>25 ppm)' },
  OilMoisture: { cat: 'Insulation', critRisk: 'Dielectric breakdown risk & bubble formation (>35 ppm)', warnRisk: 'Oil moisture elevated (>25 ppm)' },
  VoltAN: { cat: 'Voltage', critRisk: 'Voltage well outside the safe band — over-voltage risks equipment damage, under-voltage risks an operational trip/brownout', warnRisk: 'Phase A-N voltage approaching its safe limit' },
  VoltBN: { cat: 'Voltage', critRisk: 'Voltage well outside the safe band — over-voltage risks equipment damage, under-voltage risks an operational trip/brownout', warnRisk: 'Phase B-N voltage approaching its safe limit' },
  VoltCN: { cat: 'Voltage', critRisk: 'Voltage well outside the safe band — over-voltage risks equipment damage, under-voltage risks an operational trip/brownout', warnRisk: 'Phase C-N voltage approaching its safe limit' },
  VoltUnbalanceAN: { cat: 'Power Quality', critRisk: 'Phase A unbalance critical (>5%) — motor heating & system stress', warnRisk: 'Phase A voltage unbalance high (>2%)' },
  VoltUnbalanceBN: { cat: 'Power Quality', critRisk: 'Phase B unbalance critical (>5%) — motor heating & system stress', warnRisk: 'Phase B voltage unbalance high (>2%)' },
  VoltUnbalanceCN: { cat: 'Power Quality', critRisk: 'Phase C unbalance critical (>5%) — motor heating & system stress', warnRisk: 'Phase C voltage unbalance high (>2%)' },
  CurrentUnbalanceA: { cat: 'Power Quality', critRisk: 'Phase A current unbalance critical (>20%)', warnRisk: 'Phase A current unbalance high (>10%)' },
  CurrentUnbalanceB: { cat: 'Power Quality', critRisk: 'Phase B current unbalance critical (>20%)', warnRisk: 'Phase B current unbalance high (>10%)' },
  CurrentUnbalanceC: { cat: 'Power Quality', critRisk: 'Phase C current unbalance critical (>20%)', warnRisk: 'Phase C current unbalance high (>10%)' },
  load: { cat: 'Current', critRisk: 'Immediate short circuit risk (>115% capacity)', warnRisk: 'Overload warning (>100%-115% capacity)' },
  CurrentAVG: { cat: 'Current Load', critRisk: 'Continuous overload risk (>115% capacity)', warnRisk: 'Average current high (>100% capacity)' },
  THD_VoltAB: { cat: 'Harmonics', critRisk: 'Severe harmonic distortion (>8% THDv)', warnRisk: 'Voltage harmonics elevated (>5% THDv)' },
  THD_CurrentA: { cat: 'Harmonics', critRisk: 'Severe current harmonics (>15% THDi)', warnRisk: 'Current harmonics elevated (>8% THDi)' },
  Tbox: { cat: 'Enclosure', critRisk: 'Control cabinet overheating', warnRisk: 'Control box temperature elevated' },
  RHbox: { cat: 'Enclosure', critRisk: 'Critical cabinet humidity (>80%)', warnRisk: 'Control box humidity elevated' },
  externalFault: { cat: 'Event/Fault', critRisk: 'Transformer shutdown from external fault (animals, lightning)', warnRisk: 'External fault event' },
  online: { cat: 'Connectivity', critRisk: 'Device communication offline', warnRisk: 'Device unreachable' },
  // tempHigh/tempLow are canonical keys shared by BOTH carbonNode (fridge) and
  // bloodBox (blood cold-chain) — same collision as frontend-next/src/lib/
  // alarmParams.ts's ALARM_RISK_INSIGHTS (see that file's comment for the
  // full rationale). Domain-qualified keys below let __riskFor() resolve the
  // right one; these bare entries are a neutral, domain-generic fallback for
  // a THIRD domain that reuses the name with no risk text of its own.
  tempHigh: { cat: 'Temperature', critRisk: 'Reading above the configured critical limit', warnRisk: 'Reading above the configured warning limit' },
  tempLow: { cat: 'Temperature', critRisk: 'Reading below the configured critical limit', warnRisk: 'Reading below the configured warning limit' },
  'carbonNode:tempHigh': { cat: 'Refrigeration Thermal', critRisk: 'Internal temp critical — loss of refrigerated preservation (>10°C)', warnRisk: 'Internal temp high — check door seal/evaporator fan (>8°C)' },
  'carbonNode:tempLow': { cat: 'Refrigeration Thermal', critRisk: 'Accidental freezing risk — ice formation on evaporator (<0°C)', warnRisk: 'Internal temp low — check thermostat/defrost cycle (<2°C)' },
  // EMERGENCY-worded, not just HIGH like carbonNode: this is a product-safety
  // excursion on stored blood units, not equipment wear.
  'bloodBox:tempHigh': { cat: 'Cold-Chain Excursion', critRisk: 'Blood product cold-chain excursion — isolate unit(s) and follow your blood bank\\'s SOP (>8°C)', warnRisk: 'Blood product temperature approaching the excursion limit (>6°C)' },
  'bloodBox:tempLow': { cat: 'Cold-Chain Excursion', critRisk: 'Blood product freezing risk — isolate unit(s) and follow your blood bank\\'s SOP (<1°C)', warnRisk: 'Blood product temperature approaching the freeze limit (<2°C)' },
  door: { cat: 'Enclosure & Access', critRisk: 'Door open critical — prolonged warm air ingress and compressor overload (>15 min)', warnRisk: 'Door open — verify seal/latch (>5 min)' },
  current: { cat: 'Compressor Electrical', critRisk: 'Compressor overcurrent — check condenser/refrigerant charge (>10A)', warnRisk: 'Compressor draw elevated — check condenser (>5A)' },
};

// domain disambiguates keys two domains both use for physically different
// things (tempHigh/tempLow) — checked first, ahead of the bare-key entry, so
// a domain-qualified entry always wins over the generic fallback. Falls back
// to the generic "Parameter limit breached" only for a key __RISK_MAP has no
// entry for at all (bare or scoped).
const __riskFor = (key, domain) => (domain && __RISK_MAP[domain + ':' + key]) || __RISK_MAP[key] || { cat: 'Industrial Telemetry', critRisk: 'Parameter limit breached', warnRisk: 'Warning threshold reached' };

const __info = __riskFor(e.paramKey, e.domain);
const __riskText = e.severity === 'CRITICAL' ? __info.critRisk : __info.warnRisk;
const __catText = __info.cat;
const topSeverity = alarms.some(a => a.severity === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
const __sevEmoji = topSeverity === 'CRITICAL' ? '🔴' : '🟡';
const __sevColor = topSeverity === 'CRITICAL' ? '#EF4444' : '#FBBF24';
const __esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isMulti = alarms.length > 1;

let text = '\\n' + __sevEmoji + ' [' + topSeverity + '] ' + (isMulti ? 'Multiple Alarms ('+alarms.length+')' : (e.paramLabel || 'Alarm')) + '\\n';
text += '⚡️ Device: ' + e.nodeId + '\\n\\n';

alarms.forEach(a => {
  const info = __riskFor(a.paramKey, a.domain);
  const risk = a.severity === 'CRITICAL' ? info.critRisk : info.warnRisk;
  const isOffline = a.kind === 'offline';
  const valLine = isOffline ? 'No telemetry received' : (a.value + (a.unit||''));
  const limLine = isOffline ? '—' : (a.threshold + (a.unit||''));
  text += '🏷 ' + (a.paramLabel || 'Alarm') + ' (' + a.severity + ')\\n';
  text += '📊 Value: ' + valLine + ' (Limit: ' + limLine + ')\\n';
  text += '💡 Risk: ' + risk + '\\n';
  text += '🕒 ' + formatTime(a.ts || a.time) + '\\n\\n';
});

const subject = String(e.nodeId) + ' ' + __sevEmoji + ' [' + topSeverity + '] ' + (isMulti ? alarms.length + ' Alarms' : (e.paramLabel || 'Alarm'));

const __buildBaseUrl = (orgId) => {
  let sub = String(orgId || '').trim();
  if (sub.toLowerCase().startsWith('org-')) {
    sub = sub.slice(4);
  }
  if (!sub || sub === '1') sub = 'eternity';
  const customBase = env.get('APP_BASE_URL') || env.get('FRONTEND_URL') || '';
  if (customBase && customBase !== '*') {
    try {
      const u = new URL(customBase);
      const hostParts = u.hostname.split('.');
      if (hostParts.length >= 4 && !hostParts[0].includes('localhost') && !/^\d+$/.test(hostParts[0])) {
        if (hostParts[0] !== sub) {
          hostParts[0] = sub;
          u.hostname = hostParts.join('.');
        }
      } else if (!u.hostname.startsWith(sub + '.')) {
        u.hostname = sub + '.' + u.hostname;
      }
      return u.origin.replace(new RegExp('/+$'), '');
    } catch(_) {
      return customBase.replace(new RegExp('/+$'), '');
    }
  }
  return 'http://' + sub + '.iiotplatform.27.254.143.144.nip.io:30080';
};

const __linkFor = (role) => {
  const base = __buildBaseUrl(e.orgId);
  if (!base) return '';
  const viewer = role === 'viewer' || role === 'customer';
  const dom = e.domain || 'transformer';
  let path = '';
  if (dom === 'transformer') {
    path = viewer ? '/customer/transformers/detail/' : '/admin/transformers/detail/';
  } else if (dom === 'carbonNode') {
    path = viewer ? '/customer/carbon/detail/' : '/admin/carbon/detail/';
  } else if (dom === 'bloodBox') {
    path = viewer ? '/customer/bloodbox/detail/' : '/admin/bloodbox/detail/';
  } else if (dom === 'automobile') {
    path = viewer ? '/customer/automobile/detail/' : '/admin/automobile/detail/';
  } else {
    path = viewer ? '/customer/devices/detail/' : '/admin/nodes/detail/';
  }
  return base + path + '?id=' + encodeURIComponent(e.nodeId);
};

// LINE Flex bubble
const __flex = (link) => ({ type:'flex', altText: subject, contents: { type:'bubble',
  header: { type:'box', layout:'vertical', backgroundColor: __sevColor, paddingAll:'14px', contents:[
    { type:'text', text: topSeverity + ' · ' + (isMulti ? 'Multiple Alarms' : __riskFor(e.paramKey, e.domain).cat), color:'#FFFFFF', size:'xs', weight:'bold' },
    { type:'text', text: isMulti ? alarms.length + ' Active Alarms' : String(e.paramLabel||'Alarm'), color:'#FFFFFF', size:'lg', weight:'bold', wrap:true } ] },
  body: { type:'box', layout:'vertical', spacing:'md', contents: alarms.map(a => {
    const info = __riskFor(a.paramKey, a.domain);
    const risk = a.severity === 'CRITICAL' ? info.critRisk : info.warnRisk;
    return { type:'box', layout:'vertical', spacing:'sm', contents:[
      { type:'text', text: (a.paramLabel||'Alarm') + ' (' + a.severity + ')', weight:'bold', size:'sm' },
      { type:'text', text: 'Value: ' + (a.kind==='offline' ? 'Offline' : (a.value+(a.unit||''))), size:'xs', color:'#64748B' },
      { type:'text', text: 'Risk: ' + risk, size:'xs', color:'#EF4444', wrap:true },
      { type:'text', text: '🕒 ' + formatTime(a.ts || a.time || e.time), size:'xxs', color:'#94A3B8' }
    ]};
  })},
  footer: link ? { type:'box', layout:'vertical', contents:[
    { type:'button', style:'primary', color:'#6366F1', height:'sm',
      action:{ type:'uri', label:'Open device', uri: link } } ] } : undefined } });

// Telegram
const __tgText = '<b>' + __sevEmoji + ' [' + __esc(topSeverity) + '] ' + (isMulti ? alarms.length + ' Alarms' : __esc(e.paramLabel || 'Alarm')) + '</b>\\n'
  + '⚡️ <b>Device:</b> <code>' + __esc(e.nodeId) + '</code>\\n\\n'
  + alarms.map(a => {
      const info = __riskFor(a.paramKey, a.domain);
      const risk = a.severity === 'CRITICAL' ? info.critRisk : info.warnRisk;
      return '🏷 <b>' + __esc(a.paramLabel || 'Alarm') + '</b> (' + __esc(a.severity) + ')\\n'
      + '📊 ' + __esc(a.kind==='offline' ? 'Offline' : a.value) + ' (Limit: ' + __esc(a.kind==='offline' ? '—' : a.threshold) + ')\\n'
      + '💡 <i>' + __esc(risk) + '</i>\\n'
      + '🕒 <b>Time:</b> ' + formatTime(a.ts || a.time || e.time);
    }).join('\\n\\n');

const __tgBody = (chat, link) => ({ chat_id: chat, text: __tgText, parse_mode: 'HTML',
  reply_markup: link ? { inline_keyboard: [[{ text: 'Open device', url: link }]] } : undefined });

// Google Chat
const __gchat = (link) => ({ text: subject, cardsV2: [{ cardId: 'oneops-alarm', card: {
  header: { title: String(e.nodeId) + ' ' + (topSeverity==='CRITICAL'?'🔴 ':'🟡 ') + (isMulti ? alarms.length + ' Alarms' : String(e.paramLabel||'Alarm')), subtitle: String(e.nodeId) },
  sections: [{ widgets: alarms.map(a => ({
    decoratedText: {
      topLabel: (a.paramLabel || 'Alarm') + ' (' + a.severity + ')',
      text: (a.kind==='offline' ? 'Offline' : (a.value + (a.unit||''))) + ' · ' + __riskFor(a.paramKey, a.domain).warnRisk,
      bottomLabel: '🕒 ' + formatTime(a.ts || a.time || e.time)
    }
  })).concat(link ? [{ buttonList: { buttons: [{ text:'Open device', onClick:{ openLink:{ url: link } } }] } }] : [])
  }] } }] });

(async () => {
  try {
    let orgName = e.orgId;
    try {
      const [orgRows] = await controlPool.query("SELECT name FROM organizations WHERE id=?", [e.orgId]);
      if (orgRows.length && orgRows[0].name) orgName = orgRows[0].name;
    } catch(_) {}

    let siteName = '';
    try {
      if (pool) {
        const [nodeRows] = await pool.query("SELECT s.name as siteName FROM nodes n LEFT JOIN sites s ON s.id=n.site_id WHERE n.id=?", [e.nodeId]);
        if (nodeRows && nodeRows.length && nodeRows[0].siteName) siteName = nodeRows[0].siteName;
      }
    } catch(_) {}

    let emailTpl = null;
    try {
      const [tRows] = await controlPool.query("SELECT sval FROM platform_settings WHERE skey=?", ['email_template.' + e.orgId]);
      if (tRows.length && tRows[0].sval) emailTpl = JSON.parse(tRows[0].sval);
    } catch(_) {}
    if (!emailTpl) {
      emailTpl = {
        subjectTemplate: '[{{severity}}] {{org_name}} Alert: {{device_name}}',
        customHeaderNote: 'Attention: Automated priority alert triggered by {{org_name}} Industrial IoT Monitoring System.',
        customFooterSop: '',
        includeActionLink: true,
        format: 'html',
      };
    }

    const __templateVars = {
      device_name: e.nodeId,
      node_id: e.nodeId,
      site_name: siteName || orgName,
      location: siteName || orgName,
      org_id: e.orgId,
      org_name: orgName,
      severity: topSeverity,
      category: isMulti ? 'Multiple Alarms' : __riskFor(e.paramKey, e.domain).cat,
      param_label: isMulti ? 'Multiple Alarms' : e.paramLabel,
      sevEmoji: __sevEmoji,
    };
    const __renderTpl = (str) => String(str || '').replace(/\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}/g, (_, k) => (__templateVars[k] !== undefined ? __templateVars[k] : ''));

    const emailSubject = __renderTpl(emailTpl.subjectTemplate || '[{{severity}}] {{org_name}} Alert: {{device_name}}');
    const emailHeaderNote = __renderTpl(emailTpl.customHeaderNote);
    const emailFooterSop = __renderTpl(emailTpl.customFooterSop);

    const emailHtml = (link) => '<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"></head>'
      + '<body style=\"font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; background-color: #0a0e1a; margin: 0; padding: 24px; color: #f1f5f9;\">'
      + '<div style=\"max-width: 600px; margin: 0 auto; background-color: #0d1117; border: 1px solid #1e2433; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.5);\">'
      + '<div style=\"background-color: ' + __sevColor + '; padding: 18px 24px;\">'
      + '<div style=\"font-size: 11px; font-weight: 700; text-transform: uppercase; color: #ffffff; letter-spacing: 0.05em;\">' + topSeverity + '</div>'
      + '<div style=\"font-size: 20px; font-weight: 800; color: #ffffff; margin-top: 4px;\">' + __esc(isMulti ? alarms.length + ' Active Alarms' : (e.paramLabel || 'Industrial Alarm')) + '</div>'
      + '</div>'
      + (emailHeaderNote ? '<div style=\"background-color: #1e1b4b; border-bottom: 1px solid #312e81; padding: 12px 24px; font-size: 13px; color: #c7d2fe;\">📌 <strong>Notice:</strong> ' + __esc(emailHeaderNote) + '</div>' : '')
      + '<div style=\"padding: 24px;\">'
      + '<div style=\"margin-bottom: 16px; color: #94a3b8; font-size: 14px;\">Device: <strong style=\"color:#fff; font-family:monospace;\">' + __esc(e.nodeId) + '</strong>' + (siteName ? ' &nbsp;·&nbsp; Site: <strong style=\"color:#a5b4fc;\">' + __esc(siteName) + '</strong>' : '') + '</div>'
      
      + alarms.map(a => {
          const info = __riskFor(a.paramKey, a.domain);
          const risk = a.severity === 'CRITICAL' ? info.critRisk : info.warnRisk;
          const aColor = a.severity === 'CRITICAL' ? '#EF4444' : '#FBBF24';
          return '<div style=\"margin-bottom: 16px; padding: 12px; background-color: #111827; border-left: 4px solid '+aColor+'; border-radius: 4px;\">'
            + '<div style=\"font-weight: bold; color: #fff; margin-bottom: 4px;\">' + __esc(a.paramLabel || 'Alarm') + ' <span style=\"color:'+aColor+'; font-size:11px;\">['+a.severity+']</span></div>'
            + '<div style=\"color: #cbd5e1; font-size: 13px; margin-bottom: 4px;\">Value: <strong style=\"color:'+aColor+';\">' + __esc(a.kind==='offline' ? 'Offline' : (a.value+(a.unit||''))) + '</strong> (Limit: ' + __esc(a.kind==='offline'?'—':(a.threshold+(a.unit||''))) + ')</div>'
            + '<div style=\"color: #f59e0b; font-size: 12px;\">💡 ' + __esc(risk) + '</div>'
            + '<div style=\"color: #94a3b8; font-size: 11px; margin-top: 4px;\">🕒 ' + __esc(formatTime(a.ts || a.time || e.time)) + '</div>'
            + '</div>';
        }).join('')
      
      + (emailFooterSop ? '<div style=\"margin-top: 20px; background-color: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 14px; font-size: 13px; color: #fca5a5;\"><div style=\"font-weight: 700; color: #ef4444; margin-bottom: 4px;\">⚠️ Emergency Response / SOP Protocol:</div><div style=\"line-height: 1.5; color: #fecaca;\">' + __esc(emailFooterSop) + '</div></div>' : '')
      + (emailTpl.includeActionLink && link ? '<div style=\"margin-top: 24px; text-align: center;\"><a href=\"' + link + '\" style=\"display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 2px 10px rgba(99, 102, 241, 0.3);\">Open Device &amp; Acknowledge</a></div>' : '')
      + '</div>'
      + '<div style=\"background-color: #070a12; border-top: 1px solid #1e2433; padding: 14px 24px; font-size: 11px; color: #475569; text-align: center;\">Automated alert from ONEOPS Unified Industrial Monitoring Platform.</div>'
      + '</div></body></html>';

    const emailPlain = text + (emailHeaderNote ? '\\n\\nNotice: ' + emailHeaderNote : '') + (emailFooterSop ? '\\n\\nSOP Protocol:\\n' + emailFooterSop : '');

    let channels = [];
    if (pool && e.orgId) {
      try {
        const [r] = await pool.query(
          "SELECT channel,target,min_severity,department_id,user_id FROM notification_channels WHERE org_id=? AND enabled=1 AND ( (department_id IS NULL AND (user_id IS NULL OR user_id='')) OR department_id=? OR (user_id IS NOT NULL AND (user_id IN (SELECT user_id FROM user_departments WHERE department_id=?) OR user_id IN (SELECT id FROM users WHERE department_id=? OR (department_id IS NULL AND (role='admin' OR role='superadmin'))))) )",
          [e.orgId, e.departmentId || null, e.departmentId || null, e.departmentId || null]
        );
        // If a department has its own specific channel configured, it overrides the org-level fallback for that channel
        const deptTypes = new Set(r.filter(c => c.department_id && (!c.user_id || c.user_id === '')).map(c => c.channel));
        channels = r.filter(c => {
          if (!c.department_id && (!c.user_id || c.user_id === '')) {
            return !deptTypes.has(c.channel);
          }
          return true;
        });
      } catch(err) {
        const [r] = await pool.query(
          "SELECT channel,target,min_severity FROM notification_channels WHERE org_id=? AND enabled=1 AND (department_id IS NULL OR department_id=?)",
          [e.orgId, e.departmentId || null]
        );
        channels = r;
      }
    }
    const nc = await global.get('notifyConfig')();
    if (!channels.length) {
      if (nc.lineToken) channels.push({ channel:'line', target:'' });
      if (nc.telegramToken) channels.push({ channel:'telegram', target:'' });
      if (nc.googleChatWebhook) channels.push({ channel:'googlechat', target:'' });
    }
    for (const c of channels) {
      if (c.min_severity === 'CRITICAL' && topSeverity !== 'CRITICAL') continue;
      try {
        if (c.channel === 'email') {
          const mc = await global.get('mailConfig')();
          if (!mc.transport || !c.target) continue;
          await mc.transport.sendMail({ from: mc.from, to: c.target, subject: emailSubject, text: emailPlain, html: emailTpl.format === 'text' ? undefined : emailHtml(__linkFor('admin')) });
        } else if (c.channel === 'line') {
          const raw = String(c.target || nc.lineToken || '');
          const at = raw.lastIndexOf('@');
          const tok = at > 0 ? raw.slice(0, at) : raw;
          const to  = at > 0 ? raw.slice(at + 1) : '';
          if (tok && to) await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({to,messages:[__flex(__linkFor('admin'))]})});
          else if (tok) await fetch('https://notify-api.line.me/api/notify',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/x-www-form-urlencoded'},body:'message='+encodeURIComponent(' '+text)});
        } else if (c.channel === 'telegram') {
          const raw = String(c.target || nc.telegramChatId || '').trim();
          const at = raw.lastIndexOf('@');
          const tok = at > 0 ? raw.slice(0, at) : (nc.telegramToken || (raw.includes(':') ? raw : ''));
          const chat = at > 0 ? raw.slice(at + 1) : (raw.includes(':') ? (nc.telegramChatId || '') : raw);
          if (tok && chat) await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(__tgBody(chat, __linkFor('admin')))});
        } else if (c.channel === 'googlechat') {
          const url = c.target || nc.googleChatWebhook;
          if (url) await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(__gchat(__linkFor('admin')))});
        }
      } catch(err) { node.error('notify:'+c.channel+' '+err.message); }
    }

    // Per-user channels
    try {
      const [urows] = await controlPool.query("SELECT u.id,u.email,u.role,u.department_id,p.prefs FROM users u JOIN user_prefs p ON p.user_id=u.id WHERE u.org_id=?", [e.orgId]);
      for (const u of urows) {
        let pf = {};
        try { pf = typeof u.prefs === 'string' ? JSON.parse(u.prefs || '{}') : (u.prefs || {}); } catch(_) { continue; }
        const sel = (pf.alertChannels || {})[e.nodeId];
        if (!sel) continue;
        const isAdmin = u.role === 'admin' || u.role === 'superadmin';
        if (!isAdmin && u.department_id && e.departmentId && u.department_id !== e.departmentId) continue;

        if (sel.email && u.email) {
          try {
            const mc = await global.get('mailConfig')();
            const link = __linkFor(u.role);
            if (mc.transport) await mc.transport.sendMail({ from: mc.from, to: u.email, subject: emailSubject, text: emailPlain, html: emailTpl.format === 'text' ? undefined : emailHtml(link) });
          } catch(err) { node.error('notify:user-email '+err.message); }
        }
        const rawTg = String(pf.telegramChatId || pf.telegramBotApi || '').trim();
        if (sel.telegram && rawTg) {
          try {
            const at = rawTg.lastIndexOf('@');
            const tok = at > 0 ? rawTg.slice(0, at) : (nc.telegramToken || (rawTg.includes(':') ? rawTg : ''));
            const chat = at > 0 ? rawTg.slice(at + 1) : (rawTg.includes(':') ? (nc.telegramChatId || '') : rawTg);
            if (tok && chat) {
              await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(__tgBody(chat, __linkFor(u.role)))});
            }
          } catch(err) { node.error('notify:user-telegram '+err.message); }
        }
        const rawLine = String(pf.lineUserId || pf.lineMsgApi || '').trim();
        if (sel.line && rawLine) {
          try {
            const at = rawLine.lastIndexOf('@');
            const tok = at > 0 ? rawLine.slice(0, at) : (nc.lineToken || '');
            const to  = at > 0 ? rawLine.slice(at + 1) : rawLine;
            if (tok && to) await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({to,messages:[__flex(__linkFor(u.role))]})});
            else if (tok) await fetch('https://notify-api.line.me/api/notify',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/x-www-form-urlencoded'},body:'message='+encodeURIComponent(' '+text)});
          } catch(err) { node.error('notify:user-line '+err.message); }
        }
        const rawGchat = String(pf.googleChatWebhook || pf.googleChatApi || '').trim();
        if (sel.googlechat && rawGchat) {
          try {
            await fetch(rawGchat,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(__gchat(__linkFor(u.role)))});
          } catch(err) { node.error('notify:user-googlechat '+err.message); }
        }
      }
    } catch(err) { node.warn('notify:user-prefs '+err.message); }
  } catch(err) { node.error('notify: '+err.message); }
})();
return null;`



// --- Personal alarm delivery (migrate-v53's user_node_rules, worker/main.go's
// evaluatePersonalAlarms) --------------------------------------------------
// Separate topic/batch/notify trio from the org-wide alarms above, on
// purpose: a personal breach must never appear in the org/department storm
// digest (that would leak one user's private threshold to everyone watching
// the device) and never gets an alarm_events row (that is the shared,
// admin-visible timeline). This delivers to exactly the one user who set the
// rule, through the SAME Delivery Channels toggle (alertChannels[nodeId])
// MyAlertSettings Section 1 already writes — no separate consent step.
//
// Deliberately its own compact template rather than reusing notifyFunc's
// rich org-branded email/card builders (custom SOP footer, risk-category
// map, per-org email template from platform_settings): those exist for the
// org's OFFICIAL incident alert, sent under the org's own branding — a
// personal threshold is the individual's own private early-warning ping,
// unknown to the org, and has no reason to borrow that branding. Matches
// this file's own convention of small per-function-string duplication
// (putRuleFunc/orgRuleFunc's upsert, stormBatchFunc's own batch shape) over
// a shared abstraction spanning two standalone Node-RED function nodes.
const personalStormBatchFunc = `
const e = msg.payload;
if (!e || !e.paramKey || !e.severity || !e.personalUserId) return null;

const batchKey = 'alarm_batch_personal_' + e.nodeId + '_' + e.personalUserId;
const timerKey = 'alarm_timer_personal_' + e.nodeId + '_' + e.personalUserId;

let batch = global.get(batchKey) || [];
batch.push(e);
global.set(batchKey, batch);

if (!global.get(timerKey)) {
  const t = setTimeout(() => {
    const finalBatch = global.get(batchKey) || [];
    global.set(batchKey, []);
    global.set(timerKey, null);
    if (finalBatch.length > 0) {
      node.send({ payload: finalBatch });
    }
  }, 10000);
  global.set(timerKey, t);
}
return null;
`

const notifyPersonalFunc = `
const alarms = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
if (!alarms || !alarms.length) return null;
const e = alarms[0];
if (!e.severity || !e.paramKey || !e.personalUserId) return null;

const controlPool = global.get('pool');
const __TZ=env.get('DISPLAY_TZ')||'Asia/Bangkok';
const formatTime = (ts) => { try{ return new Date(ts).toLocaleString('en-GB',{timeZone:__TZ,hour12:false})+' ('+__TZ+')'; }catch(_){ return String(ts); } };
const __esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const topSeverity = alarms.some(a => a.severity === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
const __sevEmoji = topSeverity === 'CRITICAL' ? '🔴' : '🟡';
const isMulti = alarms.length > 1;
const subject = String(e.nodeId) + ' ' + __sevEmoji + ' [Personal Alert · ' + topSeverity + '] ' + (isMulti ? alarms.length + ' thresholds' : (e.paramLabel || 'Alert'));

const __buildPersonalBaseUrl = (orgId) => {
  let sub = String(orgId || '').trim();
  if (sub.toLowerCase().startsWith('org-')) {
    sub = sub.slice(4);
  }
  if (!sub || sub === '1') sub = 'eternity';
  const customBase = env.get('APP_BASE_URL') || env.get('FRONTEND_URL') || '';
  if (customBase && customBase !== '*') {
    try {
      const u = new URL(customBase);
      const hostParts = u.hostname.split('.');
      if (hostParts.length >= 4 && !hostParts[0].includes('localhost') && !/^\d+$/.test(hostParts[0])) {
        if (hostParts[0] !== sub) {
          hostParts[0] = sub;
          u.hostname = hostParts.join('.');
        }
      } else if (!u.hostname.startsWith(sub + '.')) {
        u.hostname = sub + '.' + u.hostname;
      }
      return u.origin.replace(new RegExp('/+$'), '');
    } catch(_) {
      return customBase.replace(new RegExp('/+$'), '');
    }
  }
  return 'http://' + sub + '.iiotplatform.27.254.143.144.nip.io:30080';
};

let text = __sevEmoji + ' [' + topSeverity + '] Your personal alert — ' + (isMulti ? alarms.length + ' of your thresholds' : (e.paramLabel || 'Alert')) + '\\n';
text += '⚡️ Device: ' + e.nodeId + '\\n';
text += 'This is YOUR OWN personal threshold, set on this device\\'s dashboard — it does not change the device\\'s official alarm state that others see.\\n\\n';
alarms.forEach(a => {
  const isOffline = a.kind === 'offline';
  const valLine = isOffline ? 'No telemetry received' : (a.value + (a.unit||''));
  const limLine = isOffline ? '—' : (a.threshold + (a.unit||''));
  text += '🏷 ' + (a.paramLabel || 'Alert') + ' (' + a.severity + ')\\n';
  text += '📊 Value: ' + valLine + ' (Your limit: ' + limLine + ')\\n';
  text += '🕒 ' + formatTime(a.ts) + '\\n\\n';
});
const tgText = '<b>' + __sevEmoji + ' [Your Personal Alert · ' + __esc(topSeverity) + ']</b>\\n'
  + '⚡️ <b>Device:</b> <code>' + __esc(e.nodeId) + '</code>\\n\\n'
  + alarms.map(a => '🏷 <b>' + __esc(a.paramLabel || 'Alert') + '</b> (' + __esc(a.severity) + ')\\n'
      + '📊 ' + __esc(a.kind==='offline' ? 'Offline' : a.value) + ' (Your limit: ' + __esc(a.kind==='offline' ? '—' : a.threshold) + ')\\n'
      + '🕒 <b>Time:</b> ' + formatTime(a.ts || a.time || e.time)).join('\\n\\n');

(async () => {
  try {
    const [urows] = await controlPool.query("SELECT u.id,u.email,u.role,p.prefs FROM users u JOIN user_prefs p ON p.user_id=u.id WHERE u.id=?", [e.personalUserId]);
    if (!urows.length) return;
    const u = urows[0];
    let pf = {};
    try { pf = typeof u.prefs === 'string' ? JSON.parse(u.prefs || '{}') : (u.prefs || {}); } catch(_) { return; }
    // Re-checked at delivery time, not just at rule-save time: the user may
    // have turned this channel off since the personal rule was created.
    const sel = (pf.alertChannels || {})[e.nodeId];
    if (!sel) return;

    const viewer = u.role === 'viewer' || u.role === 'customer';
    const dom = e.domain || 'transformer';
    let path = '';
    if (dom === 'transformer') {
      path = viewer ? '/customer/transformers/detail/' : '/admin/transformers/detail/';
    } else if (dom === 'carbonNode') {
      path = viewer ? '/customer/carbon/detail/' : '/admin/carbon/detail/';
    } else if (dom === 'bloodBox') {
      path = viewer ? '/customer/bloodbox/detail/' : '/admin/bloodbox/detail/';
    } else if (dom === 'automobile') {
      path = viewer ? '/customer/automobile/detail/' : '/admin/automobile/detail/';
    } else {
      path = viewer ? '/customer/devices/detail/' : '/admin/nodes/detail/';
    }
    const base = __buildPersonalBaseUrl(e.orgId);
    const link = base ? (base + path + '?id=' + encodeURIComponent(e.nodeId)) : '';
    const linkLine = link ? '\\n🔗 ' + link : '';

    if (sel.email && u.email) {
      try {
        const mc = await global.get('mailConfig')();
        if (mc.transport) await mc.transport.sendMail({ from: mc.from, to: u.email, subject, text: text + linkLine });
      } catch(err) { node.error('notifyPersonal:email ' + err.message); }
    }
    const rawTg = String(pf.telegramChatId || pf.telegramBotApi || '').trim();
    if (sel.telegram && rawTg) {
      try {
        const nc = await global.get('notifyConfig')();
        const at = rawTg.lastIndexOf('@');
        const tok = at > 0 ? rawTg.slice(0, at) : (nc.telegramToken || (rawTg.includes(':') ? rawTg : ''));
        const chat = at > 0 ? rawTg.slice(at + 1) : (rawTg.includes(':') ? (nc.telegramChatId || '') : rawTg);
        if (tok && chat) {
          await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({
              chat_id: chat,
              text: tgText,
              parse_mode: 'HTML',
              reply_markup: link ? { inline_keyboard: [[{ text: 'Open device', url: link }]] } : undefined
            })
          });
        }
      } catch(err) { node.error('notifyPersonal:telegram ' + err.message); }
    }
    const rawLine = String(pf.lineUserId || pf.lineMsgApi || '').trim();
    if (sel.line && rawLine) {
      try {
        const nc = await global.get('notifyConfig')();
        const at = rawLine.lastIndexOf('@');
        const tok = at > 0 ? rawLine.slice(0, at) : (nc.lineToken || '');
        const to  = at > 0 ? rawLine.slice(at + 1) : rawLine;
        if (tok && to) {
          await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({to,messages:[{type:'text',text:subject+'\\n\\n'+text+linkLine}]})});
        }
      } catch(err) { node.error('notifyPersonal:line ' + err.message); }
    }
    const rawGchat = String(pf.googleChatWebhook || pf.googleChatApi || '').trim();
    if (sel.googlechat && rawGchat) {
      try {
        const personalGchat = {
          text: subject,
          cardsV2: [{
            cardId: 'oneops-personal-alarm',
            card: {
              header: {
                title: String(e.nodeId) + ' ' + __sevEmoji + ' [Personal Alert · ' + topSeverity + '] ' + (isMulti ? alarms.length + ' Thresholds' : String(e.paramLabel || 'Alert')),
                subtitle: String(e.nodeId)
              },
              sections: [{
                widgets: alarms.map(a => ({
                  decoratedText: {
                    topLabel: (a.paramLabel || 'Alert') + ' (' + a.severity + ')',
                    text: 'Value: ' + (a.kind === 'offline' ? 'Offline' : (a.value + (a.unit || ''))) + ' · Limit: ' + (a.kind === 'offline' ? '—' : (a.threshold + (a.unit || ''))),
                    bottomLabel: '🕒 ' + formatTime(a.ts || a.time || e.time)
                  }
                })).concat(link ? [{
                  buttonList: {
                    buttons: [{
                      text: 'Open device',
                      onClick: { openLink: { url: link } }
                    }]
                  }
                }] : [])
              }]
            }
          }]
        };
        await fetch(rawGchat,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(personalGchat)});
      } catch(err) { node.error('notifyPersonal:googlechat ' + err.message); }
    }
  } catch(err) { node.error('notifyPersonal: ' + err.message); }
})();
return null;`

// Raw device wire key -> canonical param key. Single source of truth for
// normalizeFunc's own MAP below AND for GET /api/telemetry/aliases (see
// telemetryAliasesFunc) — both are generated FROM this object via
// JSON.stringify rather than hand-copied, so they cannot drift from each
// other the way normalizeFunc's MAP has already drifted from the deployed
// ConfigMap (a real, repeated incident this repo has hit more than once:
// the generator changes, nobody re-runs infra/scripts/sync-nodered-flow.sh,
// and the aliases silently aren't live). It is still a SEPARATE copy from
// worker/main.go's paramMap (Go can't import this file) — that one is
// still hand-synced; see paramMap's own comment there.
//
// dga_h2_ppm is what firmware in the field actually publishes; hydrogen_ppm
// is accepted too so either spelling maps to the canonical 'hydrogen' param.
// Oiltemp/H2/OilMoisture/Tamb are the real ETERNITY transformer's actual wire
// spellings (confirmed against a live MQTT payload). Tbox/RHamb/RHbox are
// deliberately NOT mapped: no existing canonical param or defensible
// threshold exists for them yet.
const TELEMETRY_ALIAS_MAP = { oil_temp_c:'oilTemp', oil_temp:'oilTemp', oiltemp:'oilTemp', Oiltemp:'oilTemp', ambient_temp_c:'ambientTemp', ambient_temp:'ambientTemp', Tamb:'ambientTemp',
  winding_temp_c:'windingTemp',
  dga_h2_ppm:'hydrogen', hydrogen_ppm:'hydrogen', H2:'hydrogen',
  moisture_ppm:'moisture', oil_moisture:'moisture', oil_moisture_ppm:'moisture', OilMoisture:'moisture', oil_level_pct:'oilLevel', load_pct:'load', door_state:'door',
  electrical_current_a:'current', current_a:'current',
  rh_pct:'rh', batt_pct:'battery', impact_g:'impact', baro_alt_m:'baroAlt',
  // Power meter model B (short names) -> model A (long names), so one alarm
  // rule covers both meters in the fleet. Kept in sync with paramMap in
  // worker/main.go, which carries the full rationale — including why V3pavg,
  // I3p and GHG are deliberately NOT aliased.
  Va:'VoltAN', Vb:'VoltBN', Vc:'VoltCN',
  Ia:'CurrentA', Ib:'CurrentB', Ic:'CurrentC',
  Pa:'ActivepowerA', Pb:'ActivepowerB', Pc:'ActivepowerC',
  VAa:'ApparentpowerA', VAb:'ApparentpowerB', VAc:'ApparentpowerC',
  VARa:'ReactivepowerA', VARb:'ReactivepowerB', VARc:'ReactivepowerC',
  PFa:'PFA', PFb:'PFB', PFc:'PFC',
  I3pavg:'CurrentAVG', P3p:'ActivepowerTotal', VA3p:'ApparentpowerTotal',
  VAR3p:'ReactivepowerTotal', PF3p:'PFTotal',
  V3pab:'VoltAB', V3pbc:'VoltBC', V3pca:'VoltCA', kWh3p:'kWh' };

const normalizeFunc = `
// Out1 = readings (→ ingest); Out2 = presence (→ device_presence);
// Out3 = device logs (→ device_logs: P/diag/log + P/ota/progress);
// Out4 = edge alarms (→ edge_alarm_log: P/alarm/{sid} with edge:true).
// Accepts: {nodeId,values,ts} | {device_id,channel,value,ts} (spec §6) |
//          status {state} & heartbeat {rssi/uptime/heap} | legacy topic tail.
// MAP is generated from TELEMETRY_ALIAS_MAP in the generator source — see
// that constant's comment for the full rationale and where else it's used;
// this deployed copy is JSON, not the hand-commented literal, on purpose.
const MAP = ${JSON.stringify(TELEMETRY_ALIAS_MAP)};
const p = msg.payload;
const topo = (msg.topic||'').split('/');
const fromTopic = (n) => topo.length>=n ? topo[topo.length-n] : undefined;
// --- edge alarm: firmware publishes {edge:true, severity, sid, value, device_id} on P/alarm/{sid}
if (p && typeof p==='object' && p.edge === true && p.severity && p.sid) {
  const id = p.device_id || fromTopic(3);
  if (id) return [null, null, null, { payload: { nodeId:id, paramKey:p.sid, severity:p.severity, value:p.value, channel:p.channel, ts:p.ts||Date.now() } }];
  return null;
}
// --- presence: status (has state) or heartbeat (rssi/uptime/heap), no reading payload
if (p && typeof p==='object' && !p.nodeId && p.channel===undefined) {
  if (p.state || p.rssi!==undefined || p.uptime!==undefined || p.heap!==undefined) {
    const id = p.device_id || fromTopic(2);
    if (!id) return null;
    const online = p.state ? (p.state==='online'?1:0) : 1;   // heartbeat ⇒ online
    return [null, { payload: { nodeId:id, online, rssi:p.rssi, fw:p.fw, batt:p.batt,
      uptime:p.uptime, heap:p.heap, time_src:p.time_src, transport:p.transport,
      transit:p.transit, lat:p.lat, lng:p.lng, ts:p.ts||Date.now() } }, null, null];
  }
  // diag/log or ota/progress → device_logs (Out3)
  const isOta = p.pct!==undefined || p.status!==undefined;
  const id = p.device_id || fromTopic(isOta ? 3 : 3);
  if (id) return [null, null, { payload: { nodeId:id, kind: isOta?'ota':'diag', level: p.level||p.status||'info', code: p.code||null, payload: p, ts: p.ts||Date.now() } }, null];
  return null;
}
// --- readings (carry per-channel quality, spec §16)
let nodeId, raw = {}, rawQ = {}, ts = Date.now();
if (p && typeof p==='object' && p.nodeId){ nodeId=p.nodeId; raw=p.values||{}; rawQ=p.qual||{}; ts=p.ts||ts; }
else if (p && typeof p==='object' && p.device_id && p.channel!==undefined){ nodeId=p.device_id; ts=p.ts||ts; raw={[p.channel]:Number(p.value)}; rawQ={[p.channel]:p.quality||'good'}; }
else if (p && typeof p==='object'){ return null; }
else { const t=topo; nodeId=t[1]; raw={[t[2]]:Number(msg.payload)}; }
if(!nodeId) return null;
const values = {}, qual = {};
for (const k of Object.keys(raw)) { const v = raw[k]; const q = rawQ[k]||'good';
  if (k==='temp_c'){ values.tempHigh=v; values.tempLow=v; qual.tempHigh=q; qual.tempLow=q; }
  else { const mk=MAP[k]||k; values[mk]=v; qual[mk]=q; } }
// orgId/departmentId (added by the worker) are carried through so the WS
// broadcaster can fan a frame out only to that org's authenticated sockets.
return [{ payload: { nodeId, values, qual, ts, orgId: p&&p.orgId, departmentId: p&&p.departmentId } }, null, null, null];
`

// GET /api/telemetry/aliases — the raw wire key -> canonical param key table,
// for a firmware developer looking at admin/live-raw: that page shows canonical
// keys once a device is approved (readings.param_key is written post-alias,
// see normalizeFunc/worker's canonicalParam — the raw key is never persisted),
// so without this there was no way to tell which live-raw row an ESP's own
// field name maps to, short of reading this generator's source. Static data,
// baked in at generation time from the same TELEMETRY_ALIAS_MAP normalizeFunc
// uses — see that constant's comment.
const telemetryAliasesFunc = CORS + `msg.headers=__CORS; msg.payload=${JSON.stringify(TELEMETRY_ALIAS_MAP)}; return msg;`

// Presence upsert: heartbeat/status keep device_presence fresh (last_seen, online).
// Also detects transport switches (wifi↔4g↔lora) and logs them to transport_events.
const presenceFunc = `
const pool = global.get('pool'); const e = msg.payload;
if (!pool || !e || !e.nodeId) return null;
(async () => {
  const opool = global.get('resolvePool')(await global.get('orgOfNode')(e.nodeId));   // org DB (control when flag off)
  // --- Transport-switch detection (§21 observability) ---
  // Compare current transport with the value stored in device_presence; if they
  // differ, a failover or recovery happened — log it to transport_events.
  // Read the previous row once: it tells us both the old transport AND whether
  // the device was marked offline, so a recovery can be logged below.
  const [prev] = await opool.query("SELECT transport, online FROM device_presence WHERE node_id=?", [e.nodeId]);
  const prevTr = prev.length ? prev[0].transport : null;
  const wasOffline = prev.length ? Number(prev[0].online) === 0 : false;
  if (e.transport) {
    if (prevTr && prevTr !== e.transport) {
      const reason = (e.rssi !== undefined && e.rssi !== null && e.rssi < -80) ? 'rssi_low' : 'failover';
      await opool.query(
        "INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
        [e.nodeId, prevTr, e.transport, reason, e.rssi ?? null]
      );
      node.warn('transport switch: ' + e.nodeId + ' ' + prevTr + ' → ' + e.transport + ' (' + reason + ')');
    }
  }
  // --- Presence upsert ---
  await opool.query("INSERT INTO device_presence (node_id, online, last_seen, rssi, batt, fw, uptime_s, heap, time_src, transport, transit, lat, lng) VALUES (?,?,NOW(3),?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE online=VALUES(online), last_seen=VALUES(last_seen), rssi=VALUES(rssi), batt=VALUES(batt), fw=VALUES(fw), uptime_s=VALUES(uptime_s), heap=VALUES(heap), time_src=VALUES(time_src), transport=VALUES(transport), transit=VALUES(transit), lat=VALUES(lat), lng=VALUES(lng)",
    [e.nodeId, e.online?1:0, e.rssi ?? null, e.batt ?? null, e.fw ?? null, e.uptime ?? null, e.heap ?? null, e.time_src ?? null, e.transport ?? null, e.transit ?? null, e.lat ?? null, e.lng ?? null]);
  // offline-recovery: device back online ⇒ clear any open offline alarm AND record
  // the recovery on the connectivity timeline. from_transport='none' is what the
  // transport endpoint maps to LINK_RESTORE, so "device is back" shows up next to
  // the offline entry instead of the outage silently ending.
  if (e.online) {
    await opool.query("UPDATE alarm_events SET cleared_at=NOW(3) WHERE node_id=? AND kind='offline' AND cleared_at IS NULL", [e.nodeId]);
    if (wasOffline) {
      await opool.query(
        "INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
        [e.nodeId, 'none', e.transport || 'wifi', 'recovered', e.rssi ?? null]);
      node.warn('device back online: ' + e.nodeId);
    }
  }
})().catch(err => node.error('presence: ' + err.message));
return null;
`

// Auto-clear: an open threshold/rate event whose param has stayed NORMAL for the
// whole CLEAR_AFTER_MIN window (deadband = hysteresis) is closed (spec §9 CLEAR).
const clearSweepFunc = `
const pool = global.get('pool'); if (!pool || typeof pool.query !== 'function') return null;
const CLEAR_MIN = Number(env.get('CLEAR_AFTER_MIN') || 5);
(async () => {
  for (const __org of await global.get('sweepOrgs')()) {
  const pool = global.get('resolvePool')(__org);
  const [evs] = await pool.query("SELECT e.id, e.node_id, e.param_key, n.mqtt_prefix FROM alarm_events e JOIN nodes n ON n.id=e.node_id WHERE e.cleared_at IS NULL AND e.kind IN ('threshold','rate')");
  for (const ev of evs) {
    const [rr] = await pool.query("SELECT rule_json FROM alarm_rules WHERE node_id=?", [ev.node_id]);
    if (!rr.length) continue;
    const rule = typeof rr[0].rule_json==='string' ? JSON.parse(rr[0].rule_json) : rr[0].rule_json;
    const param = (rule.params||[]).find(p => p.key===ev.param_key);
    if (!param) continue;
    const hys = rule.hysteresis || 0;
    const [rows] = await pool.query("SELECT value FROM readings WHERE node_id=? AND param_key=? AND taken_at > (NOW(3) - INTERVAL ? MINUTE)", [ev.node_id, ev.param_key, CLEAR_MIN]);
    if (!rows.length) continue;   // no fresh data ⇒ don't clear yet
    const stillBreaching = rows.some(r => { const v = Number(r.value); return param.direction==='high' ? v >= (param.warn - hys) : v <= (param.warn + hys); });
    if (!stillBreaching) {
      await pool.query("UPDATE alarm_events SET cleared_at=NOW(3) WHERE id=?", [ev.id]);
      // §9: clear the retained alarm topic so subscribers see NORMAL
      if (ev.mqtt_prefix) node.send({ topic: ev.mqtt_prefix+'/alarm/'+ev.param_key, payload: { sid:ev.param_key, state:'NORMAL', ts:Date.now() }, qos:1, retain:true });
    }
  }
  }
})().catch(e => node.error('clear-sweep: ' + e.message));
return null;
`

// Device logs: store P/diag/log + P/ota/progress (observability).
// OTA progress reports also update the active ota_deployments record so the
// dashboard shows real-time flash progress and final success/failure.
const devlogFunc = `
const pool = global.get('pool'); const e = msg.payload;
if (!pool || !e || !e.nodeId) return null;
(async () => {
  const opool = global.get('resolvePool')(await global.get('orgOfNode')(e.nodeId));   // org DB (control when flag off)
  await opool.query("INSERT INTO device_logs (node_id, kind, level, code, payload, ts) VALUES (?,?,?,?,?,NOW(3))",
    [e.nodeId, e.kind||'diag', String(e.level||'info').slice(0,32), e.code? String(e.code).slice(0,40): null, JSON.stringify(e.payload||{})]);
  // --- OTA progress → ota_deployments (real-time tracking) ---
  if (e.kind === 'ota' && e.payload) {
    const p = e.payload;
    const status = p.status || (typeof p.pct === 'number' ? 'downloading' : null);
    const pct = typeof p.pct === 'number' ? Math.min(100, Math.max(0, p.pct)) : null;
    if (status) {
      const isFinal = ['success','failed','rolled_back'].includes(status);
      await opool.query(
        "UPDATE ota_deployments SET status=?, progress_pct=?, error_msg=?" +
        (isFinal ? ", completed_at=NOW(3)" : "") +
        " WHERE node_id=? AND status NOT IN ('success','failed','rolled_back') ORDER BY started_at DESC LIMIT 1",
        [status, pct ?? (isFinal ? 100 : 0), p.error || null, e.nodeId]
      );
    }
  }
})().catch(err => node.error('devlog: ' + err.message));
return null;
`

// Dead-letter: the global catch node routes any node error here for persistence.
const deadLetterFunc = `
const pool = global.get('pool');
const err = msg.error || {}; const src = (err.source && err.source.id) || 'unknown';
if (pool) pool.query("INSERT INTO dead_letter (source, error, payload) VALUES (?,?,?)",
  [String(src).slice(0,120), String(err.message||'').slice(0,500), JSON.stringify(msg.payload||null)]).catch(()=>{});
node.warn('dead-letter from ' + src + ': ' + (err.message||''));
return null;
`

// Retention: roll raw readings into hourly buckets (with bad_n count), then purge raw older than N days.
const retentionFunc = `
const pool = global.get('pool'); if (!pool || typeof pool.query !== 'function') return null;
const DAYS = Number(env.get('READINGS_RETENTION_DAYS') || 30);
(async () => {
  for (const __org of await global.get('sweepOrgs')()) {
  const pool = global.get('resolvePool')(__org);
  await pool.query(
    "INSERT INTO readings_rollup (node_id, param_key, bucket, n, bad_n, v_avg, v_min, v_max) " +
    "SELECT node_id, param_key, DATE_FORMAT(taken_at,'%Y-%m-%d %H:00:00.000') bucket, " +
    "COUNT(*), SUM(CASE WHEN quality NOT IN ('good') THEN 1 ELSE 0 END), " +
    "AVG(value), MIN(value), MAX(value) " +
    "FROM readings WHERE taken_at < (NOW(3) - INTERVAL ? DAY) GROUP BY node_id, param_key, bucket " +
    "ON DUPLICATE KEY UPDATE n=VALUES(n), bad_n=VALUES(bad_n), v_avg=VALUES(v_avg), v_min=VALUES(v_min), v_max=VALUES(v_max)", [DAYS]);
  const [res] = await pool.query("DELETE FROM readings WHERE taken_at < (NOW(3) - INTERVAL ? DAY)", [DAYS]);
  if (res.affectedRows) node.warn('retention: rolled up + purged ' + res.affectedRows + ' raw readings');
  }
})().catch(e => node.error('retention: ' + e.message));
return null;
`

// Offline detection: any device online but unseen > OFFLINE_AFTER_S ⇒ mark offline,
// raise a CRITICAL offline event, and route to notify (per-tenant, like any alarm).
const offlineSweepFunc = `
const pool = global.get('pool'); if (!pool || typeof pool.query !== 'function') return null;
// Detection window. 45s is comfortably longer than the firmware's 30s heartbeat
// (and telemetry arrives every ~1.5s), so it will not fire on a healthy device,
// but it halves the time an outage stays invisible.
const AFTER = Number(env.get('OFFLINE_AFTER_S') || 45);
// Stage 1 — link silence. A healthy device publishes telemetry every ~1.5s, so
// 20s without a single stored reading already means the uplink is gone; there is
// no reason to wait the full offline window before saying so on the connectivity
// timeline. Measured on last_reading_at (readings only) rather than last_seen,
// which also moves on the 30s heartbeat and would flap inside a 20s window.
const LINK_AFTER = Number(env.get('LINK_LOST_AFTER_S') || 20);
(async () => {
  const ctlPool = global.get('pool');
  if (!ctlPool || typeof ctlPool.query !== 'function') return null;

  // Stage 0 — link recovery: check devices in ctlPool.device_presence that are online=1 and have resumed telemetry
  try {
    const [recovered] = await ctlPool.query(
      "SELECT p.node_id, p.transport, p.last_reading_at, n.org_id FROM device_presence p " +
      "JOIN nodes n ON n.id = p.node_id " +
      "WHERE p.online = 1 AND p.last_reading_at IS NOT NULL");
    for (const r of recovered) {
      const orgPool = global.get('resolvePool')(r.org_id);
      const [lastTe] = await orgPool.query(
        "SELECT to_transport, ts FROM transport_events WHERE node_id=? ORDER BY ts DESC, id DESC LIMIT 1",
        [r.node_id]);
      if (lastTe.length && lastTe[0].to_transport === 'none' && new Date(r.last_reading_at) > new Date(lastTe[0].ts)) {
        await orgPool.query(
          "INSERT INTO transport_events (node_id, from_transport, to_transport, reason, ts) VALUES (?,?,?,?,?)",
          [r.node_id, 'none', r.transport || 'wifi', 'recovered', r.last_reading_at]);
        node.warn('link restored (telemetry resumed): ' + r.node_id);
      }
    }
  } catch (e) { node.warn('link-recovery sweep: ' + e.message); }

  // Stage 1 — link silence: devices online whose readings stopped > LINK_AFTER
  try {
    const [silent] = await ctlPool.query(
      "SELECT p.node_id, p.last_reading_at, p.transport, n.org_id FROM device_presence p " +
      "JOIN nodes n ON n.id = p.node_id " +
      "WHERE p.online = 1 AND p.last_reading_at IS NOT NULL AND p.last_reading_at < (NOW(3) - INTERVAL ? SECOND)",
      [LINK_AFTER]);
    for (const s of silent) {
      const orgPool = global.get('resolvePool')(s.org_id);
      const [dup] = await orgPool.query(
        "SELECT 1 FROM transport_events WHERE node_id = ? AND to_transport = 'none' AND ts >= ?",
        [s.node_id, s.last_reading_at]);
      if (!dup.length) {
        await orgPool.query(
          "INSERT INTO transport_events (node_id, from_transport, to_transport, reason, ts) VALUES (?,?,?,?,?)",
          [s.node_id, s.transport || 'wifi', 'none', 'no_telemetry', s.last_reading_at]);
        node.warn('link lost (no telemetry): ' + s.node_id);
      }
    }
  } catch (e) { node.warn('link-silence sweep: ' + e.message); }

  // Stage 2 — full offline declaration (DEVICE_OFFLINE)
  let rows = [];
  try {
    [rows] = await ctlPool.query(
      "SELECT p.node_id, p.last_seen, p.last_reading_at, p.transport, n.org_id, n.department_id FROM device_presence p " +
      "JOIN nodes n ON n.id = p.node_id " +
      "WHERE p.online = 1 AND p.last_seen < (NOW(3) - INTERVAL ? SECOND)",
      [AFTER]);
  } catch (e) {
    node.warn('offline sweep query error: ' + e.message);
  }
  for (const r of rows) {
    await ctlPool.query("UPDATE device_presence SET online = 0 WHERE node_id = ?", [r.node_id]);
    const orgPool = global.get('resolvePool')(r.org_id);
    const id = 'ev-offline-' + r.node_id + '-' + Date.now();
    const ref = r.last_reading_at || r.last_seen;
    await orgPool.query(
      "INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(?, INTERVAL ? SECOND))",
      [id, r.node_id, r.org_id, r.department_id, 'online', 'Device Offline', 'CRITICAL', 'offline', 0, 0, '', r.last_seen, AFTER]);
    const [dup] = await orgPool.query(
      "SELECT 1 FROM transport_events WHERE node_id = ? AND to_transport = 'none' AND ts >= ? LIMIT 1",
      [r.node_id, ref]);
    if (!dup.length) {
      await orgPool.query(
        "INSERT INTO transport_events (node_id, from_transport, to_transport, reason, ts) VALUES (?,?,?,?,?)",
        [r.node_id, r.transport || 'wifi', 'none', 'no_telemetry', ref]);
    }
    node.send({ payload: { id, nodeId:r.node_id, orgId:r.org_id, departmentId:r.department_id, paramLabel:'Device Offline', kind:'offline', value:0, unit:'', threshold:0, severity:'CRITICAL', time:new Date(new Date(r.last_seen).getTime() + AFTER*1000).toISOString() } });
  }
})().catch(e => node.error('offline-sweep: ' + e.message));
return null;
`

const escalationFunc = `
const ctl = global.get('pool'); if(!ctl || typeof ctl.query !== 'function') return null;
(async()=>{
  for (const __org of await global.get('sweepOrgs')()) {
  const pool = global.get('resolvePool')(__org);
  const [rows]=await pool.query("SELECT * FROM alarm_events WHERE severity='CRITICAL' AND acknowledged_at IS NULL AND cleared_at IS NULL AND escalated=0 AND raised_at<(NOW(3)-INTERVAL ${ESCALATE_MIN} MINUTE)");
  for(const r of rows){ node.send({ payload: { nodeId:r.node_id, orgId:r.org_id, departmentId:r.department_id, paramLabel:'ESCALATION · '+r.param_label, kind:r.kind, value:Number(r.value), unit:r.unit, threshold:Number(r.threshold), severity:'CRITICAL', time:new Date(r.raised_at).toISOString() } }); }
  if(rows.length){ await pool.query('UPDATE alarm_events SET escalated=1 WHERE id IN (?)',[rows.map(r=>r.id)]); }
  }
})().catch(e=>node.error(e.message));
return null;
`

// --- REST handlers (CORS prepended) -----------------------------------------
const healthFunc = CORS + `const pool=global.get('pool');
(async()=>{ let db=false; try{const c=await pool.getConnection(); await c.ping(); c.release(); db=true;}catch(e){} msg.headers=__CORS; msg.statusCode=200; msg.payload={ok:true,db,ts:Date.now()}; node.send(msg);})(); return null;`

// pool resolved via orgOfNode, NOT the bare control pool: alarm_rules lives
// wherever the node's CURRENT org resolves to (resolvePool), and a device
// moved to a real tenant DB (POST /api/nodes/move) has its rule row there
// now, not in control — a hardcoded control pool 404's every rule lookup for
// any device that has ever moved, permanently, with no way to tell "no rule
// set" from "looking in the wrong database".
const getRuleFunc = CORS + `const id=msg.req.params.id;
(async()=>{
  const org=(await global.get('orgOfNode')(id))||'';
  const pool=global.get('resolvePool')(org);
  const[r]=await pool.query('SELECT rule_json, debounce_json FROM alarm_rules WHERE node_id=?',[id]);
  if(!r.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'no rule'};node.send(msg);return;}
  const rule=typeof r[0].rule_json==='string'?JSON.parse(r[0].rule_json):r[0].rule_json;
  let debounce=null; try{debounce=r[0].debounce_json?(typeof r[0].debounce_json==='string'?JSON.parse(r[0].debounce_json):r[0].debounce_json):null;}catch(e){}
  if(debounce) rule.debounceJson = debounce;
  msg.headers=__CORS; msg.statusCode=200; msg.payload=rule; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// The org this rule is stored under is resolved server-side from the
// nodes table itself, NOT trusted from the request body: the body's orgId
// is whatever the CALLER's own client-side state happened to think the
// device's org was at the moment of the click (e.g. a superadmin console's
// org switcher, which is not necessarily synced to the device actually
// being edited) — stale by even one org switch, it would silently write
// this rule into the WRONG org's database, invisible to the device's real
// org and never read back by getRuleFunc (also fixed to resolve the same
// way) or orgRuleFunc's per-org seeding. orgId is still accepted in the
// payload for older callers but no longer used for anything.
//
// A direct `nodes` query, not orgOfNode: orgOfNode deliberately returns
// null when TENANT_DB_MODE is off (nothing needs pool routing then), which
// is fine for a read but would store an empty org_id here — nodes.org_id
// itself is authoritative in every mode.
const putRuleFunc = CORS + `const id=msg.req.params.id; const {rule,updatedBy}=msg.payload||{};
if(!rule){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rule required'};return msg;}
(async()=>{
  const[__n]=await global.get('pool').query('SELECT org_id FROM nodes WHERE id=?',[id]);
  if(!__n.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  const org=__n[0].org_id;
  const pool=global.get('resolvePool')(org);
  const debounceJson = rule.debounceJson ? JSON.stringify(rule.debounceJson) : null;
  const ruleJson = JSON.stringify({...rule, debounceJson:undefined});
  await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),debounce_json=VALUES(debounce_json),domain=VALUES(domain),updated_by=VALUES(updated_by)',[id,org,rule.domain,ruleJson,debounceJson,updatedBy||null]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const orgRuleFunc = CORS + `const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId); const {rule,updatedBy}=msg.payload||{};
if(!rule||!rule.domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rule.domain required'};return msg;}
(async()=>{
  if(!(await global.get('domainEntitled')(msg.auth,orgId,rule.domain))){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'organization is not licensed for '+rule.domain};node.send(msg);return;}
  const debounceJson = rule.debounceJson ? JSON.stringify(rule.debounceJson) : null;
  const ruleJson = JSON.stringify({...rule, debounceJson:undefined});
  // Persist the org+domain default first — this survives even when the org has no
  // nodes yet (provision time), and seeds each node's rule when it comes online.
  // Self-heal the table so this never depends on migrate-v16 running first.
  await pool.query("CREATE TABLE IF NOT EXISTS org_domain_rules (org_id VARCHAR(64) NOT NULL, domain VARCHAR(32) NOT NULL, rule_json JSON NOT NULL, debounce_json JSON, updated_by VARCHAR(120), updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (org_id, domain))");
  await pool.query('INSERT INTO org_domain_rules (org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),debounce_json=VALUES(debounce_json),updated_by=VALUES(updated_by)',[orgId,rule.domain,ruleJson,debounceJson,updatedBy||null]);
  // Also apply to any existing nodes of this org+domain.
  const [nodes]=await pool.query('SELECT id FROM nodes WHERE org_id=? AND domain=?',[orgId,rule.domain]);
  let applied=0;
  for(const n of nodes){
    await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),debounce_json=VALUES(debounce_json),domain=VALUES(domain),updated_by=VALUES(updated_by)',[n.id,orgId,rule.domain,ruleJson,debounceJson,updatedBy||null]);
    applied++;
  }
  msg.headers=__CORS; msg.payload={applied,saved:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// GET /api/orgs/:orgId/rule?domain=transformer — the org+domain default that
// orgRuleFunc above WRITES. There was no way to read it back, so the admin
// Alarm & Notify page had nothing to load and always rendered the hardcoded
// schema defaults from lib/alarmParams.ts: an admin set thresholds, saved
// them to org_domain_rules and every node, came back, and saw the factory
// numbers again with no indication their real values were stored and live.
// Returning null (not 404) for "never configured" so the caller can tell
// "no override, showing defaults" from an error.
const orgRuleGetFunc = CORS + `const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId); const au=msg.auth||{};
const domain=(msg.req.query&&msg.req.query.domain)||'';
if(!domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'domain required'};return msg;}
(async()=>{
  if(!(await global.get('domainEntitled')(au,orgId,domain))){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'organization is not licensed for '+domain};node.send(msg);return;}
  let r=[];
  try{ const[x]=await pool.query("SELECT rule_json,debounce_json,updated_by,updated_at FROM org_domain_rules WHERE org_id=? AND domain=?",[orgId,domain]); r=x; }
  catch(e){ if(String(e&&e.message||'').indexOf('org_domain_rules')<0) throw e; }
  if(!r.length){ msg.headers=__CORS; msg.payload={rule:null}; node.send(msg); return; }
  const row=r[0];
  const parse=(v)=> v==null ? null : (typeof v==='string' ? JSON.parse(v||'null') : v);
  const rule=parse(row.rule_json)||{};
  const deb=parse(row.debounce_json);
  if(deb) rule.debounceJson=deb;
  msg.headers=__CORS; msg.payload={rule,updatedBy:row.updated_by,updatedAt:row.updated_at}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Admin bulk-apply of the SHARED device rule (alarm_rules), scoped to one
// department (or a chosen user's own department) — a separate route from
// orgRuleFunc rather than an optional param on it, so "this never touches
// org_domain_rules" (the org-wide default orgRuleFunc always upserts first)
// is true by construction instead of depending on every future caller
// getting a branch right.
//
// users lives in the CONTROL pool always (auth/orgs/users/departments never
// move with TENANT_DB_MODE — see the control-plane handler list in initFunc),
// so resolving a userId's department is a control-pool lookup even though
// the nodes/alarm_rules it then loops are tenant-pool data.
const orgRuleDepartmentFunc = CORS + `const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId); const controlPool=global.get('pool');
const {rule,departmentId,departmentIds,userId,userIds,updatedBy}=msg.payload||{};
if(!rule||!rule.domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rule.domain required'};return msg;}
const dIds = Array.isArray(departmentIds) ? departmentIds.filter(Boolean) : (departmentId ? [departmentId] : []);
const uIds = Array.isArray(userIds) ? userIds.filter(Boolean) : (userId ? [userId] : []);
if(!dIds.length && !uIds.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'departmentId(s) or userId(s) required'};return msg;}
(async()=>{
  if(!(await global.get('domainEntitled')(msg.auth,orgId,rule.domain))){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'organization is not licensed for '+rule.domain};node.send(msg);return;}
  const targetDeptSet = new Set(dIds);
  if(uIds.length){
    const[ur]=await controlPool.query('SELECT DISTINCT department_id FROM users WHERE id IN (?) AND org_id=?',[uIds,orgId]);
    for(const r of ur){ if(r.department_id) targetDeptSet.add(r.department_id); }
  }
  const finalDeptIds = Array.from(targetDeptSet);
  if(!finalDeptIds.length){
    msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'no valid departments found for the selected scope'};node.send(msg);return;
  }
  const debounceJson = rule.debounceJson ? JSON.stringify(rule.debounceJson) : null;
  const ruleJson = JSON.stringify({...rule, debounceJson:undefined});
  const [nodes]=await pool.query('SELECT id FROM nodes WHERE org_id=? AND domain=? AND department_id IN (?)',[orgId,rule.domain,finalDeptIds]);
  let applied=0;
  for(const n of nodes){
    await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),debounce_json=VALUES(debounce_json),domain=VALUES(domain),updated_by=VALUES(updated_by)',[n.id,orgId,rule.domain,ruleJson,debounceJson,updatedBy||null]);
    applied++;
  }
  msg.headers=__CORS; msg.payload={applied,saved:true,departmentIds:finalDeptIds}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// --- Personal (per-user, per-node) alarm thresholds (migrate-v53) -----------
// Independent of alarm_rules: this is "notify ME when MY threshold is
// crossed", never the shared org-visible WARNING/CRITICAL state everyone
// (including admins) sees on this device. Policy 'node' — the same
// view-access gate getRuleFunc/chartsGetFunc use, deliberately NOT
// 'node:manage' — every role that can see this device may set their own
// personal alert, not just an admin.
const USER_NODE_RULES_DDL = "CREATE TABLE IF NOT EXISTS user_node_rules (user_id VARCHAR(64) NOT NULL, node_id VARCHAR(64) NOT NULL, org_id VARCHAR(64) NOT NULL, domain VARCHAR(32) NOT NULL, rule_json JSON NOT NULL, updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (user_id, node_id), INDEX idx_user_node_rules_node (node_id))";

const getPersonalRuleFunc = CORS + `const id=msg.req.params.id; const uid=(msg.auth&&msg.auth.userId)||'';
(async()=>{
  const pool=await global.get('poolForNode')(id, msg.auth);
  let r=[];
  try{ [r]=await pool.query('SELECT rule_json FROM user_node_rules WHERE node_id=? AND user_id=?',[id,uid]); }
  catch(e){ if(String(e&&e.message||'').indexOf('user_node_rules')<0) throw e; }
  if(!r.length){ msg.headers=__CORS; msg.payload={rule:null}; node.send(msg); return; }
  const rule=typeof r[0].rule_json==='string'?JSON.parse(r[0].rule_json):r[0].rule_json;
  msg.headers=__CORS; msg.payload={rule}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// org_id/domain resolved from a direct nodes query (control pool), not
// trusted from the request body — same reasoning as putRuleFunc: this must
// reflect the device's real CURRENT org, not whatever the caller's client
// state happened to think it was.
const putPersonalRuleFunc = CORS + `const id=msg.req.params.id; const uid=(msg.auth&&msg.auth.userId)||''; const {rule}=msg.payload||{};
if(!rule){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rule required'};return msg;}
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'authentication required'};return msg;}
(async()=>{
  const[__n]=await global.get('pool').query('SELECT org_id,domain FROM nodes WHERE id=?',[id]);
  if(!__n.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  const org=__n[0].org_id; const domain=__n[0].domain;
  const pool=global.get('resolvePool')(org);
  await pool.query(${JSON.stringify(USER_NODE_RULES_DDL)});
  const ruleJson=JSON.stringify(rule);
  await pool.query('INSERT INTO user_node_rules (user_id,node_id,org_id,domain,rule_json) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),domain=VALUES(domain)',[uid,id,org,domain,ruleJson]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// --- Custom multi-parameter trend charts (migrate-v47) ----------------------
// Admin-defined, per-device: any number of charts, each plotting any number of
// this device's own parameters together. Deliberately NOT a new alarm system —
// a chart is just a saved, named selection of parameter keys. Thresholds for
// those keys stay exactly where every other parameter's already live
// (alarm_rules.rule_json, edited by the same PUT /api/nodes/:id/rule this
// device's per-parameter history modal already uses), so a value alarms
// identically whether it's viewed alone or as part of a combined chart —
// nothing duplicated, nothing that can drift out of sync with itself.
//
// Table is created on first write rather than depending on migrate-v47 having
// run — the same self-heal every other optional table in this file uses (see
// org_domain_rules above), because a fresh chart is useless if it 503s until
// an operator remembers to run a migration.
const CHART_DEFINITIONS_DDL = "CREATE TABLE IF NOT EXISTS chart_definitions (id VARCHAR(64) PRIMARY KEY, org_id VARCHAR(64) NOT NULL, node_id VARCHAR(64) NOT NULL, title VARCHAR(120) NOT NULL, param_keys JSON NOT NULL, sort_order INT NOT NULL DEFAULT 0, created_by VARCHAR(120), created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX idx_chart_definitions_node (node_id))";

const chartsGetFunc = CORS + `const id=msg.req.params.id;
(async()=>{
  const pool=await global.get('poolForNode')(id, msg.auth);
  let r;
  try{
    [r]=await pool.query('SELECT id,title,param_keys,sort_order,created_by,updated_at FROM chart_definitions WHERE node_id=? ORDER BY sort_order,created_at',[id]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('chart_definitions')<0) throw e;
    r=[]; // table not created yet on this DB — no charts, not an error
  }
  const out=r.map(x=>({ id:x.id, title:x.title, paramKeys: typeof x.param_keys==='string'?JSON.parse(x.param_keys):x.param_keys, sortOrder:x.sort_order, createdBy:x.created_by, updatedAt:x.updated_at }));
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// org_id resolved from a direct nodes query (control pool), not orgOfNode's
// cache — same reasoning as putRuleFunc: a write needs the device's real
// CURRENT org, not a value that may have gone stale since the last move.
const chartsPostFunc = CORS + `const id=msg.req.params.id; const b=msg.payload||{};
const title=String(b.title||'').trim().slice(0,120);
// No ceiling on how many parameters one chart can plot — same as dpPutFunc's
// paramKeys, which this mirrors. A device can report several dozen; an admin
// combining "all of them" into one chart is a legitimate use, not abuse.
const paramKeys=Array.isArray(b.paramKeys)?b.paramKeys.map(String).filter(Boolean):[];
if(!title){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'title required'};return msg;}
if(!paramKeys.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'select at least one parameter'};return msg;}
(async()=>{
  const[__n]=await global.get('pool').query('SELECT org_id FROM nodes WHERE id=?',[id]);
  if(!__n.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  const org=__n[0].org_id;
  const pool=global.get('resolvePool')(org);
  await pool.query(${JSON.stringify(CHART_DEFINITIONS_DDL)});
  const [cnt]=await pool.query('SELECT COUNT(*) n FROM chart_definitions WHERE node_id=?',[id]);
  const chartId='chart-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  await pool.query('INSERT INTO chart_definitions (id,org_id,node_id,title,param_keys,sort_order,created_by) VALUES (?,?,?,?,?,?,?)',
    [chartId,org,id,title,JSON.stringify(paramKeys),cnt[0].n,(msg.auth&&(msg.auth.name||msg.auth.userId))||null]);
  msg.headers=__CORS; msg.payload={ok:true,id:chartId}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const chartsPutFunc = CORS + `const id=msg.req.params.id; const chartId=msg.req.params.chartId; const b=msg.payload||{};
(async()=>{
  const pool=await global.get('poolForNode')(id, msg.auth);
  const sets=[]; const vals=[];
  if(typeof b.title==='string' && b.title.trim()){ sets.push('title=?'); vals.push(b.title.trim().slice(0,120)); }
  if(Array.isArray(b.paramKeys)){
    const pk=b.paramKeys.map(String).filter(Boolean);
    if(!pk.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'select at least one parameter'};node.send(msg);return;}
    sets.push('param_keys=?'); vals.push(JSON.stringify(pk));
  }
  if(typeof b.sortOrder==='number'){ sets.push('sort_order=?'); vals.push(b.sortOrder); }
  if(!sets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nothing to update'};node.send(msg);return;}
  vals.push(chartId, id);
  let r;
  try{
    [r]=await pool.query('UPDATE chart_definitions SET '+sets.join(',')+' WHERE id=? AND node_id=?',vals);
  }catch(e){
    if(String(e&&e.message||'').indexOf('chart_definitions')<0) throw e;
    msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'chart not found'};node.send(msg);return;
  }
  if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'chart not found'};node.send(msg);return;}
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const chartsDelFunc = CORS + `const id=msg.req.params.id; const chartId=msg.req.params.chartId;
(async()=>{
  const pool=await global.get('poolForNode')(id, msg.auth);
  let r;
  try{
    [r]=await pool.query('DELETE FROM chart_definitions WHERE id=? AND node_id=?',[chartId,id]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('chart_definitions')<0) throw e;
    r={affectedRows:0};
  }
  msg.headers=__CORS; msg.payload={ok:true, deleted: r.affectedRows>0}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// pool resolved via orgOfNode — alarm_events moves with the device on a
// cross-org move (MOVE_TABLE_RULES), same reasoning as getRuleFunc above.
// This is what backs the device page's "Active Alarms" panel; a hardcoded
// control pool silently showed nothing for any moved device, forever.
const getEventsFunc = CORS + `const id=msg.req.params.id;
(async()=>{
  const ctl = global.get('pool');
  const org = (await global.get('orgOfNode')(id)) || (msg.auth && msg.auth.orgId) || '';
  const tenantPool = global.get('resolvePool')(org);
  const pools = Array.from(new Set([tenantPool, ctl].filter(Boolean)));
  const out = [];
  const seen = new Set();
  for (const pool of pools) {
    try {
      const [r] = await pool.query('SELECT * FROM alarm_events WHERE node_id=? ORDER BY raised_at DESC LIMIT 50', [id]);
      for (const row of r) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
      }
    } catch(e) {}
  }
  out.sort((a,b) => new Date(b.raised_at) - new Date(a.raised_at));
  msg.headers = __CORS;
  msg.payload = out.slice(0, 50);
  node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Transport/connectivity timeline for a device: link switches (transport_events,
// written by the firmware's transport handler) merged with offline backlog
// flushes (offline_sync_log, written by the ingest worker when a device uploads
// readings older than 30s). Both are per-node, so the 'node' policy applies.
//
// pool resolved via orgOfNode(id), NOT msg.auth.orgId: for an ordinary org
// admin those agree (guard's 'node' policy already required it), which is
// why this worked in every manual test — but a superadmin has no fixed
// orgId at all, so this always fell back to the control pool regardless of
// which org the device actually belongs to, silently showing an empty
// timeline for every device once TENANT_DB_MODE routes real orgs to their
// own database.
const transportFunc = CORS + `const id=msg.req.params.id;
(async()=>{
  const ctl = global.get('pool');
  const org = (await global.get('orgOfNode')(id)) || (msg.auth && msg.auth.orgId) || '';
  const tenantPool = global.get('resolvePool')(org);
  const pools = Array.from(new Set([tenantPool, ctl].filter(Boolean)));
  const out = [];
  const seenIds = new Set();

  for (const pool of pools) {
    try {
      const [t] = await pool.query("SELECT id,from_transport,to_transport,reason,rssi,ts FROM transport_events WHERE node_id=? ORDER BY ts DESC LIMIT 25", [id]);
      for (const r of t) {
        const key = 'tr-' + r.id + '-' + (r.ts ? new Date(r.ts).getTime() : '');
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        out.push({
          id: 'tr-' + r.id,
          ts: r.ts,
          type: r.to_transport === 'none' ? 'LINK_LOST' : (r.from_transport === 'none' ? 'LINK_RESTORE' : 'FALLBACK_' + String(r.to_transport || '').toUpperCase()),
          desc: 'Link ' + r.from_transport + ' → ' + r.to_transport + (r.reason ? ' (' + r.reason + ')' : '') + (r.rssi != null ? ' · RSSI ' + r.rssi : ''),
          isOfflineSync: false
        });
      }
    } catch(e) {}

    try {
      const [o] = await pool.query("SELECT id,severity,raised_at FROM alarm_events WHERE node_id=? AND kind='offline' ORDER BY raised_at DESC LIMIT 25", [id]);
      for (const r of o) {
        const key = 'off-' + r.id;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        out.push({
          id: 'off-' + r.id,
          ts: r.raised_at,
          type: 'DEVICE_OFFLINE',
          desc: 'Device stopped reporting — marked offline by the presence sweep',
          isOfflineSync: false
        });
      }
    } catch(e) {}

    try {
      const [s] = await pool.query("SELECT id,records_count,oldest_ts,newest_ts,sync_at FROM offline_sync_log WHERE node_id=? ORDER BY sync_at DESC LIMIT 25", [id]);
      for (const r of s) {
        const key = 'os-' + r.id;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        out.push({
          id: 'os-' + r.id,
          ts: r.sync_at,
          type: 'OFFLINE_SYNC',
          desc: 'Flushed ' + r.records_count + ' offline record' + (r.records_count === 1 ? '' : 's') + ' to cloud',
          isOfflineSync: true
        });
      }
    } catch(e) {}
  }

  out.sort((a,b) => new Date(b.ts) - new Date(a.ts));
  msg.headers = __CORS;
  msg.payload = out.slice(0, 25);
  node.send(msg);
})().catch(e => { msg.headers=__CORS; msg.statusCode=500; msg.payload={error:e.message}; node.send(msg); });
return null;`

const ackFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const {by,eventProblemId}=msg.payload||{};
(async()=>{await pool.query('UPDATE alarm_events SET acknowledged_at=NOW(3),acknowledged_by=?,event_problem_id=? WHERE id=?',[by||'user',eventProblemId||null,id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Stored readings for a device. bucketSec > 0 averages into fixed-width buckets
// SERVER-side, which is what any chart actually wants: a device publishing every
// 1.5s produces ~2400 rows per parameter per hour, so a 12-hour raw fetch is
// ~170k rows (tens of MB of JSON) to draw a few hundred pixels of line. The raw
// form is kept as the default because the live tiles legitimately want the last
// individual samples.
// pool resolved from the NODE's own org inside the async body (see
// poolForNode in initFunc), not from msg.auth.orgId via the DATA_PLANE
// rewrite: a superadmin has no orgId, so that rewrite silently sent every
// chart query to the CONTROL database regardless of which org the device
// belongs to. After a device moved to a real tenant DB that meant the
// superadmin's charts froze at the moment of the move (they were reading
// leftover control-DB rows) while the tenant's own admin saw the live data
// — the two roles looking at the same device saw two different halves of
// its history. 'readget' is removed from DATA_PLANE for the same reason.
const readingsGetFunc = CORS + `const id=msg.req.params.id; const q=msg.req.query||{};
const since=Number(q.sinceMin||360); const bucket=Math.max(0,Math.floor(Number(q.bucketSec||0)));
// An explicit window is what the per-parameter history modal needs: "last N
// minutes" cannot express a period that ENDS in the past, so a user inspecting
// last Tuesday's excursion had no way to ask for it. from/to are real instants
// (ISO with Z) converted to the DB's own wall-clock via dbWallClock() — see
// its definition in initFunc for why a bare UTC string silently truncated
// every window to data no more recent than roughly (now - DB_TZ offset).
const clean=global.get('dbWallClock');
const from=q.from?clean(q.from):null; const to=q.to?clean(q.to):null;
const win = from ? ' AND taken_at>=? AND taken_at<=?' : ' AND taken_at>(NOW(3)-INTERVAL ? MINUTE)';
const winArgs = from ? [from, to || clean(new Date().toISOString())] : [since];
// Only the parameter(s) being charted, when asked — a modal for one metric has
// no use for the other five the device publishes. A comma-separated list lets
// a multi-parameter custom chart fetch every one of its series in a single
// round trip instead of one request per line; a single key behaves exactly as
// before (IN (?) with one value is equivalent to =?).
const onlyKeys = q.paramKey ? String(q.paramKey).split(',').map((s) => s.trim()).filter(Boolean) : [];
const pk = onlyKeys.length ? ' AND param_key IN ('+onlyKeys.map(()=>'?').join(',')+')' : '';
const pkArgs = onlyKeys;
(async()=>{
  const pool=await global.get('poolForNode')(id, msg.auth);
  let r;
  if(bucket>0){
    // FROM_UNIXTIME/UNIX_TIMESTAMP both use the session timezone, so the bucket
    // label round-trips to the same wall clock a raw taken_at would return.
    // MIN/MAX ride along with the average: on a wide bucket the average alone
    // hides the very spike the operator opened the chart to look at.
    //
    // GROUP BY repeats the FULL "FROM_UNIXTIME(FLOOR(...)*?)" expression, not
    // just its FLOOR(...) core, and takes 2 more bound params for it (bucket
    // divide + multiply again). This is not cosmetic: MySQL 8's default
    // sql_mode includes ONLY_FULL_GROUP_BY, which only accepts a SELECTed
    // non-aggregate column when it is the SAME expression as a GROUP BY entry
    // — byte-for-byte, not "obviously derived from" one. Grouping by only
    // FLOOR(UNIX_TIMESTAMP(taken_at)/?) while selecting
    // FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(taken_at)/?)*?) AS taken_at reads as
    // two unrelated expressions to that check and raised ER_WRONG_FIELD_WITH_GROUP
    // (1055) on every bucketed call — every chart in the per-parameter modal,
    // Compare Devices and the transformer detail page's sparklines was a 500.
    // Reproduced and confirmed fixed against a live server before landing this.
    [r]=await pool.query(
      "SELECT param_key, FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(taken_at)/?)*?) AS taken_at, AVG(value) AS value, "+
      "MIN(value) AS v_min, MAX(value) AS v_max, COUNT(*) AS n "+
      "FROM readings WHERE node_id=?"+win+pk+" "+
      "GROUP BY param_key, FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(taken_at)/?)*?) ORDER BY taken_at ASC",
      [bucket,bucket,id,...winArgs,...pkArgs,bucket,bucket]);
    for(const row of r){ row.value=Number(row.value); row.v_min=Number(row.v_min); row.v_max=Number(row.v_max); row.n=Number(row.n); }
    // --- readings_rollup for the part of the window raw rows no longer cover --
    // The retention tick (retentionFunc) rolls readings older than
    // READINGS_RETENTION_DAYS into HOURLY readings_rollup buckets and then
    // DELETES the raw rows. So a long window is physically split: recent hours
    // exist only in \`readings\`, older ones only in \`readings_rollup\`. Reading
    // just one table is wrong in both directions — raw alone silently truncates
    // a 90-day chart to its last 30 days, rollup alone returns nothing at all
    // for "last 7 days".
    //
    // Only consulted when the caller asked for a bucket at least as coarse as
    // the rollup's own hour: re-expanding hourly means into 5-minute points
    // would invent detail that was never stored.
    //
    // The two sets cannot overlap (a bucket only reaches the rollup once its
    // raw rows are past the cut), but they are deduped by (param_key, bucket)
    // anyway, preferring raw — retention could run between these two queries.
    if(bucket>=3600){
      try{
        const rwin = from ? ' AND bucket>=? AND bucket<=?' : ' AND bucket>(NOW(3)-INTERVAL ? MINUTE)';
        // SUM(v_avg*n)/SUM(n), not AVG(v_avg): re-aggregating pre-averaged
        // buckets needs their sample counts as weights, or an hour with 3
        // readings would count the same as one with 2400.
        const[ru]=await pool.query(
          "SELECT param_key, FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(bucket)/?)*?) AS taken_at, "+
          "SUM(v_avg*n)/NULLIF(SUM(n),0) AS value, MIN(v_min) AS v_min, MAX(v_max) AS v_max, SUM(n) AS n "+
          "FROM readings_rollup WHERE node_id=?"+rwin+pk+" "+
          "GROUP BY param_key, FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(bucket)/?)*?) ORDER BY taken_at ASC",
          [bucket,bucket,id,...winArgs,...pkArgs,bucket,bucket]);
        if(ru.length){
          const seen=new Set(r.map(x=>x.param_key+'@'+new Date(x.taken_at).getTime()));
          for(const row of ru){
            const k=row.param_key+'@'+new Date(row.taken_at).getTime();
            if(seen.has(k)) continue;
            row.value=Number(row.value); row.v_min=Number(row.v_min); row.v_max=Number(row.v_max); row.n=Number(row.n);
            r.push(row);
          }
          r.sort((a,b)=> new Date(a.taken_at)-new Date(b.taken_at));
        }
      }catch(e){
        // No rollup table on this database yet — the raw rows above are still a
        // correct answer for everything inside the retention window.
        if(String(e&&e.message||'').indexOf('readings_rollup')<0) throw e;
        node.warn('readings: readings_rollup absent, serving raw only');
      }
    }
  } else {
    [r]=await pool.query('SELECT param_key,value,taken_at FROM readings WHERE node_id=?'+win+pk+' ORDER BY taken_at ASC',[id,...winArgs,...pkArgs]);
  }
  msg.headers=__CORS; msg.payload=r; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Everything needed to render a per-device report for an arbitrary date range:
// identity, an hourly series per parameter, the alarm events raised in the
// window and the connectivity timeline.
//
// The series has to read two tables. Raw readings only survive
// READINGS_RETENTION_DAYS (30) — after that the retention tick rolls them into
// hourly buckets in readings_rollup and deletes the raw rows. So a report over
// "last 90 days" is part rollup (old hours) and part on-the-fly aggregation of
// the raw rows (recent hours). The two sets never overlap, because a bucket only
// reaches the rollup once its raw rows are past the retention cut.
//
// Aggregating server-side keeps the payload bounded: a device publishing every
// 1.5s produces ~2400 raw rows per parameter per hour, which no browser should
// have to download to print a monthly report.
const reportFunc = CORS + `const pool=global.get('resolvePool')(msg.auth&&msg.auth.orgId); const id=msg.req.params.id;
const q=msg.req.query||{};
// from/to bind directly against taken_at/raised_at/ts/sync_at below, all of
// which are written in the DB's own wall-clock (DB_TZ, not UTC) — see
// dbWallClock() in initFunc. This used to build a UTC-labelled string (the
// comment here said so explicitly) and compare it against those Bangkok
// wall-clock columns, which silently excluded roughly the last DB_TZ-offset
// hours of every report, including the "last 7 days" default below.
const clean=global.get('dbWallClock');
const to = q.to ? clean(q.to) : clean(new Date().toISOString());
const from = q.from ? clean(q.from) : clean(new Date(Date.now()-7*86400000).toISOString());
(async()=>{
  const out={ nodeId:id, from, to, node:null, series:[], events:[], transport:[] };
  try{ const[n]=await pool.query('SELECT id,name,domain,org_id,department_id,site_id,status,first_seen FROM nodes WHERE id=?',[id]);
    out.node=n[0]||null; }catch(e){ node.warn('report node: '+e.message); }
  try{ const[p]=await pool.query('SELECT online,last_seen,rssi,batt,fw FROM device_presence WHERE node_id=?',[id]);
    if(p.length) out.presence=p[0]; }catch(e){ node.warn('report presence: '+e.message); }
  // Hourly buckets, rollup first then whatever raw rows still exist.
  const series=[];
  try{ const[r]=await pool.query("SELECT param_key,bucket,n,bad_n,v_avg,v_min,v_max FROM readings_rollup WHERE node_id=? AND bucket>=? AND bucket<=? ORDER BY bucket ASC",[id,from,to]);
    for(const x of r) series.push({ param_key:x.param_key, bucket:x.bucket, n:Number(x.n||0), bad_n:Number(x.bad_n||0), v_avg:Number(x.v_avg), v_min:Number(x.v_min), v_max:Number(x.v_max) });
  }catch(e){ node.warn('report rollup: '+e.message); }
  try{ const[r]=await pool.query("SELECT param_key, DATE_FORMAT(taken_at,'%Y-%m-%d %H:00:00.000') bucket, COUNT(*) n, AVG(value) v_avg, MIN(value) v_min, MAX(value) v_max FROM readings WHERE node_id=? AND taken_at>=? AND taken_at<=? GROUP BY param_key,bucket ORDER BY bucket ASC",[id,from,to]);
    for(const x of r) series.push({ param_key:x.param_key, bucket:x.bucket, n:Number(x.n||0), bad_n:0, v_avg:Number(x.v_avg), v_min:Number(x.v_min), v_max:Number(x.v_max) });
  }catch(e){ node.warn('report raw: '+e.message); }
  series.sort((a,b)=> new Date(a.bucket) - new Date(b.bucket));
  out.series=series;
  try{ const[e2]=await pool.query("SELECT id,param_key,param_label,severity,kind,value,threshold,unit,raised_at,acknowledged_at,acknowledged_by,event_problem_id FROM alarm_events WHERE node_id=? AND raised_at>=? AND raised_at<=? ORDER BY raised_at DESC LIMIT 500",[id,from,to]);
    out.events=e2; }catch(e){ node.warn('report events: '+e.message); }
  try{ const[t]=await pool.query("SELECT from_transport,to_transport,reason,rssi,ts FROM transport_events WHERE node_id=? AND ts>=? AND ts<=? ORDER BY ts DESC LIMIT 500",[id,from,to]);
    out.transport=t; }catch(e){ node.warn('report transport: '+e.message); }
  try{ const[s]=await pool.query("SELECT records_count,oldest_ts,newest_ts,sync_at FROM offline_sync_log WHERE node_id=? AND sync_at>=? AND sync_at<=? ORDER BY sync_at DESC LIMIT 500",[id,from,to]);
    out.offlineSync=s; }catch(e){ node.warn('report sync: '+e.message); }
  // Maintenance documents uploaded IN this window — the PDF's appendix asked
  // for by an admin who wants "what was serviced/certified this period"
  // listed alongside the readings, not the device's entire document history
  // regardless of the report's own date range.
  // Filtered on the document's OWN date where it has one (COALESCE to the
  // upload date otherwise): a report for Q1 must include the service report
  // DATED in Q1, even though it was scanned and uploaded in Q2 — filtering on
  // created_at would have silently dropped exactly the document the period is
  // about.
  try{
    let d;
    try{ [d]=await pool.query("SELECT name,kind,size,uploaded_by,created_at,doc_date FROM documents WHERE node_id=? AND COALESCE(doc_date,DATE(created_at))>=DATE(?) AND COALESCE(doc_date,DATE(created_at))<=DATE(?) ORDER BY COALESCE(doc_date,DATE(created_at)) DESC LIMIT 200",[id,from,to]); }
    catch(e2){ const m2=String(e2&&e2.message||''); if(m2.indexOf('kind')<0 && m2.indexOf('doc_date')<0) throw e2;
      [d]=await pool.query("SELECT name,size,uploaded_by,created_at FROM documents WHERE node_id=? AND created_at>=? AND created_at<=? ORDER BY created_at DESC LIMIT 200",[id,from,to]);
      d=d.map(x=>({...x,kind:'other',doc_date:null})); }
    out.documents=d;
  }catch(e){ node.warn('report documents: '+e.message); }
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Categories a maintenance document can carry (migrate-v38) — same fixed
// small vocabulary as node_photos.kind, for the same reason: a list an admin
// can pick from, not a free-text field nobody fills in the same way twice.
//
// Since migrate-v40 these are the BUILT-IN defaults, not the whole list: an
// org can add its own kinds and relabel/reorder/hide these in kind_catalog.
// They stay in code rather than being seeded as rows so that a fresh org needs
// no setup, a built-in cannot be lost to a bad DELETE, and the ones that carry
// behaviour (see BUILTIN_PHOTO below) are not an admin's to remove.
const DOC_KINDS = ['service_report','certificate','test_result','invoice','manual','other']
const BUILTIN_DOC = [
  { key:'service_report', label:'Service report' },
  { key:'certificate',    label:'Certificate' },
  { key:'test_result',    label:'Test result' },
  { key:'invoice',        label:'Invoice' },
  { key:'manual',         label:'Manual' },
  { key:'other',          label:'Other' },
]

// documents used to read/write global.get('pool') unconditionally — the
// CONTROL database — no matter which org's device it belonged to. Every other
// per-device table (node_photos, node_nameplates, display_params…) resolves
// through the node's OWN org via orgOfNode/resolvePool, exactly so a tenant on
// its own iothub_<org> database never has its rows land in the shared control
// database instead. documents was the one table still doing that: a real
// customer's service reports and certificates were being written to — and
// read back from — the control database regardless of which org uploaded
// them, which is precisely the cross-database leak this platform's tenancy
// model exists to prevent.
const docsGetFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id; const dept=(msg.req.query&&msg.req.query.departmentId)||'';
const __all=(au.role==='admin'||au.role==='superadmin') && !dept;   // admin without a department sees every department's docs
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  const cols='id,name,size,uploaded_by,content_type,department_id,created_at';
  // Ordered by the document's OWN date, falling back to the upload time for a
  // row that has none — a scanned March service report filed in June belongs
  // in March in this list, which is the whole point of doc_date existing.
  // note (v44): an entry may be a note with no file at all, so the UI needs to
  // know whether a Download button belongs on the row — hence has_file. Selecting the note TEXT itself is fine here (it
  // is short prose); the file BYTES are still never selected by this list.
  const full=cols+',kind,doc_date,note,(data IS NOT NULL) AS has_file';
  const ord='ORDER BY COALESCE(doc_date, DATE(created_at)) DESC, created_at DESC';
  let r;
  try{
    [r]= __all
      ? await pool.query('SELECT '+full+' FROM documents WHERE node_id=? '+ord,[id])
      : await pool.query('SELECT '+full+' FROM documents WHERE node_id=? AND department_id=? '+ord,[id,dept]);
  }catch(e){
    const m=String(e&&e.message||'');
    if(m.indexOf('kind')<0 && m.indexOf('doc_date')<0 && m.indexOf('note')<0) throw e;
    // kind (v38) / doc_date (v39) / note (v44) not migrated yet — every row is
    // simply uncategorised, undated and file-only, which the read path states
    // rather than fails. has_file is 1 because before v44 a row could only
    // exist by uploading one.
    [r]= __all
      ? await pool.query('SELECT '+cols+' FROM documents WHERE node_id=? ORDER BY created_at DESC',[id])
      : await pool.query('SELECT '+cols+' FROM documents WHERE node_id=? AND department_id=? ORDER BY created_at DESC',[id,dept]);
    r=r.map(x=>({...x,kind:'other',doc_date:null,note:null,has_file:1}));
  }
  msg.headers=__CORS; msg.payload=r; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const docsPostFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const au=msg.auth||{}; const {departmentId,name,size,uploadedBy,contentType,dataBase64,kind,docDate,note}=msg.payload||{};
// An entry may now be a FILE, a NOTE, or both (migrate-v44) — so the old
// "name is all that matters" check would let a completely empty row through.
const __note=(typeof note==='string'&&note.trim())?note.trim():null;
if(!name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
if(!dataBase64 && !__note){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'attach a file or write a note'};return msg;}
// The date the DOCUMENT carries, which is not the upload time — accepted from
// admin and viewer alike, since whoever files a service report is the one who
// knows when the work happened. Validated to a bare YYYY-MM-DD so a malformed
// value becomes NULL (read path falls back to created_at) rather than a
// MySQL error or a silently shifted date.
const __dd=/^\\d{4}-\\d{2}-\\d{2}$/.test(String(docDate||''))?String(docDate):null;
(async()=>{
  // ownOrg, not a bare SELECT: proves this node belongs to the caller's org
  // (or the caller is superadmin) before anything is written, same guard
  // every other per-device write in this file uses.
  const chk=await global.get('ownOrg')(au,pool,'SELECT org_id FROM nodes WHERE id=?',[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  const docId='doc-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  // An admin has no department of their own — file the document under the node's
  // department so it stays visible to the team that operates the device.
  let dept=departmentId||'';
  if(!dept){ const [n]=await opool.query('SELECT department_id FROM nodes WHERE id=?',[id]); dept=(n.length&&n[0].department_id)||''; }
  const __kindsD=await global.get('kindsFor')(opool,chk.orgId,'document',${JSON.stringify(BUILTIN_DOC)});
  const k=__kindsD.some(x=>x.key===String(kind||''))?String(kind):'other';
  try{
    await opool.query('INSERT INTO documents (id,node_id,department_id,name,size,uploaded_by,content_type,data,kind,doc_date,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[docId,id,dept,name,size||null,uploadedBy||au.name||au.userId||null,contentType||null,dataBase64?Buffer.from(dataBase64,'base64'):null,k,__dd,__note]);
  }catch(e){
    const m=String(e&&e.message||'');
    if(m.indexOf('kind')<0 && m.indexOf('doc_date')<0 && m.indexOf('note')<0) throw e;
    await opool.query('INSERT INTO documents (id,node_id,department_id,name,size,uploaded_by,content_type,data) VALUES (?,?,?,?,?,?,?,?)',[docId,id,dept,name,size||null,uploadedBy||au.name||au.userId||null,contentType||null,dataBase64?Buffer.from(dataBase64,'base64'):null]);
  }
  msg.headers=__CORS; msg.payload={ok:true,id:docId}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// Download a stored maintenance document's bytes. policy 'node' → the guard checks
// the caller can access this device (view level is enough), so a viewer who can see
// the device can download its docs. Served with the original filename + content-type.
const docsDownloadFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id; const docId=msg.req.params.docId;
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  const[r]=await pool.query('SELECT name,content_type,data FROM documents WHERE id=? AND node_id=?',[docId,id]);
  if(!r.length||!r[0].data){msg.statusCode=404;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload='not found';node.send(msg);return;}
  const d=r[0]; const fn=String(d.name||'document').replace(/[^\\w.\\- ]/g,'_');
  msg.statusCode=200;
  msg.headers={'Content-Type':d.content_type||'application/octet-stream','Content-Disposition':'attachment; filename=\"'+fn+'\"','Access-Control-Allow-Origin':'*'};
  msg.payload=d.data; node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

const directoryGetFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{const[r]=await pool.query('SELECT * FROM org_directory WHERE org_id=? ORDER BY created_at DESC',[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const directoryPostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const body=msg.payload||{};
// Frontend/Express contract: { rows: [...], replace }. Tolerate a bare array too.
const rows = Array.isArray(body) ? body : (Array.isArray(body.rows) ? body.rows : null);
const replace = Array.isArray(body) ? true : body.replace !== false;
if(!rows){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rows array required'};return msg;}
(async()=>{
  if(replace) await pool.query('DELETE FROM org_directory WHERE org_id=?',[orgId]);
  let i=0;
  for(const entry of rows) {
    // org_directory.id is a non-default PK — must be supplied (mirror Express upsertDirectoryEntries).
    const id='dir-'+orgId+'-'+Date.now()+'-'+(i++);
    await pool.query("INSERT INTO org_directory (id, org_id, department_id, email, phone, name) VALUES (?,?,?,?,?,?)", [id, orgId, entry.department_id||null, entry.email||null, entry.phone||null, entry.name||null]);
  }
  msg.headers=__CORS; msg.payload={ok:true, imported:rows.length}; node.send(msg);
})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const directoryDelFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{await pool.query('DELETE FROM org_directory WHERE org_id=?',[orgId]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const httpIngestFunc = `msg.payload={nodeId:msg.req.params.id,values:(msg.payload&&msg.payload.values)||{},ts:(msg.payload&&msg.payload.ts)};return msg;`
const optionsFunc = CORS + `msg.headers=__CORS; msg.statusCode=204; msg.payload=''; return msg;`

// --- BloodBOX domain handlers (ERD #4) --------------------------------------
const bbErr = `.catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

// --- Transformer nameplate (replaces fabricated Asset Info) -----------------
// FixDashboard's "Asset Info" panel hardcoded 'TR-6787' / '2500 kVA' /
// '22kV/0.4kV' for every transformer on the platform, unconditionally — see
// migrate-v31.sql. Same shape as the device photo (node_images, migrate-v27):
// own table in the ORG database, admin-only write, anyone with device access
// can read, resolved via orgOfNode/ownOrg rather than a stored org_id.
// GET returns both the raw per-unit override columns (unchanged shape — the
// edit form pre-fills from these, so a blank field reads as "inherits", not
// as "the model's value repeated back") AND a \`resolved\` object with the
// effective values a read-only display should show (migrate-v32: model_id
// links a unit to a transformer_models row in the same org's own database;
// COALESCE(override, model's value) — never a cross-org lookup, since the
// join is to a table in this same resolved pool).
const nodeNameplateGetFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  let rows=[];
  try{
    const[r]=await pool.query(
      "SELECT np.manufacturer,np.model,np.serial_number,np.rated_kva,np.voltage_class,np.cooling_type,np.year_installed,np.updated_by,np.updated_at,"+
      "np.model_id, m.model_code, m.active AS model_active, m.manufacturer AS m_manufacturer, m.rated_kva AS m_rated_kva, m.voltage_class AS m_voltage_class, m.cooling_type AS m_cooling_type "+
      "FROM node_nameplates np LEFT JOIN transformer_models m ON m.id=np.model_id WHERE np.node_id=?",[id]);
    rows=r;
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_nameplates')>=0){ msg.headers=__CORS; msg.payload={has:false,pending:'migrate-v31'}; node.send(msg); return; }
    // model_id/transformer_models missing (migrate-v32 not applied here yet) —
    // fall back to the pre-v32 query so the panel still works without the link.
    if(String(e&&e.message||'').indexOf('model_id')<0 && String(e&&e.message||'').indexOf('transformer_models')<0) throw e;
    const[r2]=await pool.query("SELECT manufacturer,model,serial_number,rated_kva,voltage_class,cooling_type,year_installed,updated_by,updated_at FROM node_nameplates WHERE node_id=?",[id]);
    rows=r2;
  }
  if(!rows.length){ msg.headers=__CORS; msg.payload={has:false}; node.send(msg); return; }
  const d=rows[0];
  const linked = !!d.model_id;
  const resolved = {
    model: linked ? d.model_code : d.model,
    manufacturer: d.manufacturer ?? (linked ? d.m_manufacturer : null),
    ratedKva: (d.rated_kva ?? (linked ? d.m_rated_kva : null)) === null ? null : Number(d.rated_kva ?? d.m_rated_kva),
    voltageClass: d.voltage_class ?? (linked ? d.m_voltage_class : null),
    coolingType: d.cooling_type ?? (linked ? d.m_cooling_type : null),
  };
  msg.headers=__CORS; msg.payload={has:true, modelId:d.model_id||null, modelCode:d.model_code||null, modelActive:d.model_active==null?null:!!d.model_active,
    manufacturer:d.manufacturer, model:d.model, serialNumber:d.serial_number,
    ratedKva:d.rated_kva===null||d.rated_kva===undefined?null:Number(d.rated_kva), voltageClass:d.voltage_class, coolingType:d.cooling_type,
    yearInstalled:d.year_installed, updatedBy:d.updated_by, updatedAt:d.updated_at, resolved}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/nameplate — admin only; ownOrg proves the device is
// theirs. Partial update: a key ABSENT from the body leaves that column
// untouched; present as null/'' clears just that one — an admin who knows the
// rating today but not the serial number has to be able to save that much.
// modelId links/unlinks a transformer_models catalog row (migrate-v32); the
// other override columns keep their pre-catalog meaning unchanged when unset.
const nodeNameplatePutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  const sets=[], vals=[], out={};
  const text=(key,col,max)=>{ if(b[key]===undefined) return; const v=b[key]===null?null:String(b[key]).trim().slice(0,max)||null; sets.push(col+'=?'); vals.push(v); out[key]=v; };
  text('manufacturer','manufacturer',120); text('model','model',120); text('serialNumber','serial_number',120);
  text('voltageClass','voltage_class',64); text('coolingType','cooling_type',32);
  if(b.ratedKva!==undefined){
    if(b.ratedKva===null){ sets.push('rated_kva=?'); vals.push(null); out.ratedKva=null; }
    else{ const n=Number(b.ratedKva); if(!isFinite(n)||n<=0||n>500000){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'ratedKva must be a number greater than 0 and at most 500000'};node.send(msg);return;}
      sets.push('rated_kva=?'); vals.push(n); out.ratedKva=n; }
  }
  if(b.yearInstalled!==undefined){
    if(b.yearInstalled===null){ sets.push('year_installed=?'); vals.push(null); out.yearInstalled=null; }
    else{ const y=Number(b.yearInstalled); const nowY=new Date().getFullYear();
      if(!Number.isInteger(y)||y<1970||y>nowY){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'yearInstalled must be a whole year between 1970 and '+nowY};node.send(msg);return;}
      sets.push('year_installed=?'); vals.push(y); out.yearInstalled=y; }
  }
  if(b.modelId!==undefined){
    if(b.modelId){
      try{
        const[m]=await opool.query("SELECT id FROM transformer_models WHERE id=? AND org_id=?",[b.modelId,chk.orgId]);
        if(!m.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'model not found in this organization'};node.send(msg);return;}
      }catch(e){
        if(String(e&&e.message||'').indexOf('transformer_models')<0) throw e;
        msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'the model catalog needs migrate-v32 — run the migration first'};node.send(msg);return;
      }
    }
    sets.push('model_id=?'); vals.push(b.modelId||null); out.modelId=b.modelId||null;
  }
  if(!sets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nothing to update'};node.send(msg);return;}
  sets.push('updated_by=?'); vals.push(au.name||au.userId||null);
  try{
    // Guarantee the row exists first (harmless no-op on a repeat save), then
    // apply exactly the fields this call touched — two statements rather than
    // one giant conditional INSERT column list.
    await opool.query("INSERT INTO node_nameplates (node_id) VALUES (?) ON DUPLICATE KEY UPDATE node_id=node_id",[id]);
    await opool.query("UPDATE node_nameplates SET "+sets.join(',')+" WHERE node_id=?",[...vals,id]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_nameplates')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'nameplates need migrate-v31 — run the migration first'};node.send(msg);return;
  }
  msg.headers=__CORS; msg.payload={ok:true,id,...out}; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/nameplates — bulk map {node_id: {model,ratedKva,voltageClass}}
// for every nameplated node in the org, so the fleet list can show a real
// rating without an N+1 (one request per device) fetching this per row.
// Resolves through a linked catalog model (migrate-v32) the same way the
// single-device GET does, so a device that inherits its rating from a model
// instead of typing it in still shows a real number here.
const orgNameplatesGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  let rows=[];
  try{
    const[r]=await pool.query(
      "SELECT np.node_id, CASE WHEN np.model_id IS NOT NULL THEN m.model_code ELSE np.model END AS eff_model, "+
      "COALESCE(np.rated_kva,m.rated_kva) AS eff_kva, COALESCE(np.voltage_class,m.voltage_class) AS eff_voltage "+
      "FROM node_nameplates np LEFT JOIN transformer_models m ON m.id=np.model_id WHERE np.node_id IN (SELECT id FROM nodes WHERE org_id=?)",[orgId]);
    rows=r;
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_nameplates')<0 && String(e&&e.message||'').indexOf('model_id')<0 && String(e&&e.message||'').indexOf('transformer_models')<0) throw e;
    try{ const[r2]=await pool.query("SELECT node_id,model AS eff_model,rated_kva AS eff_kva,voltage_class AS eff_voltage FROM node_nameplates WHERE node_id IN (SELECT id FROM nodes WHERE org_id=?)",[orgId]); rows=r2; }catch(e2){ if(String(e2&&e2.message||'').indexOf('node_nameplates')<0) throw e2; }
  }
  const out={}; for(const r of rows){ out[r.node_id]={model:r.eff_model, ratedKva:r.eff_kva===null?null:Number(r.eff_kva), voltageClass:r.eff_voltage}; }
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/alarms?open=1 — the org-wide alarm list every page
// that needs "every alarm across the fleet" (admin Alarms, the sidebar's
// CRITICAL badge, a viewer's Overview notifications) used to build itself
// from useAppStore().alarms, a client-side store seeded ONCE from mockData.ts
// and never refreshed from anywhere — so a real CRITICAL alarm on a real
// device never appeared on any of them, while Acknowledge (already wired to
// the real ackFunc) quietly tried to ack a mock id against real alarm_events.
// One real query instead of three independent mock lists, department-, domain-
// AND site-scoped for a non-admin caller exactly like fleetListFunc's own
// visibility filter (acc.levels / acc.departmentIds / siteVisible), so "which
// alarms can I see" can never disagree with "which devices can I see".
//
// Every scoping field is read from the NODE (n.*), never from the alarm row:
// alarm_events.department_id is stamped once at raise time and never updated,
// so filtering on it would answer "which department owned this device when the
// alarm fired" — not "may this caller see this device now". After a device is
// moved between departments (PUT /api/nodes/:id/profile), that difference is
// visible both ways: its pre-move alarms would vanish for the department that
// now owns it, and linger for the one that no longer does. guard()'s own
// event:view check already joins to nodes for exactly this reason.
const orgAlarmsGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const openOnly=!!(msg.req.query&&msg.req.query.open);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  const acc = (au.role==='superadmin'||au.role==='admin') ? null : await global.get('accessFor')(au.userId);
  let sql = "SELECT e.id,e.node_id,e.org_id,e.department_id,e.param_key,e.param_label,e.severity,e.kind,e.value,e.threshold,e.unit,e.raised_at,e.acknowledged_at,e.acknowledged_by,e.event_problem_id,e.cleared_at,n.domain,n.site_id,n.department_id AS node_department_id,n.name AS node_name FROM alarm_events e JOIN nodes n ON n.id=e.node_id WHERE (e.org_id=? OR e.org_id IS NULL OR n.org_id=? OR n.org_id IS NULL)";
  const args=[orgId, orgId];
  if(openOnly){ sql+=" AND e.cleared_at IS NULL AND e.acknowledged_at IS NULL"; }
  sql += " ORDER BY e.raised_at DESC";
  if(!acc) sql += " LIMIT 300";
  let rows = [];
  try {
    const [r] = await pool.query(sql, args);
    rows = r || [];
  } catch(err) {
    try {
      const [r2] = await global.get('pool').query(sql, args);
      rows = r2 || [];
    } catch(e2) {
      node.warn('orgAlarms query error: ' + (e2.message || err.message));
    }
  }
  const grants = acc ? await global.get('nodeDeptMap')(pool, orgId) : {};
  const vis = acc ? rows.filter(r=>{
    const lvl=acc.levels[r.domain]||'none'; if(lvl==='none') return false;
    if(!global.get('deptVisible')(acc, r.node_department_id, grants[r.node_id])) return false;
    if(!global.get('siteVisible')(acc, r.site_id)) return false;
    if(!global.get('nodeVisible')(acc, r.node_id)) return false;
    return true;
  }).slice(0,300) : rows;
  msg.headers=__CORS; msg.payload=vis; node.send(msg);
})()` + bbErr

// --- Transformer model catalog (migrate-v32) ---------------------------------
// Per-org catalog so a fleet built from a handful of repeating model codes
// (ETERNITY IS a transformer manufacturing platform) doesn't mean retyping the
// same manufacturer/kVA/voltage/cooling combination on every device. Lives in
// the resolved ORG pool, same placement as node_nameplates/event_problems, and
// is always filtered by org_id: org-1/2/3 share ONE physical database, so
// without that filter their catalogs would collide in this one table — there
// is deliberately no shared cross-org "ETERNITY master list".
const tmListFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  let rows=[];
  try{ const[r]=await pool.query("SELECT id,model_code,manufacturer,rated_kva,voltage_class,cooling_type,active,created_by,updated_at FROM transformer_models WHERE org_id=? ORDER BY active DESC,model_code",[orgId]); rows=r; }
  catch(e){ if(String(e&&e.message||'').indexOf('transformer_models')<0) throw e; msg.headers=__CORS; msg.payload={pending:'migrate-v32'}; node.send(msg); return; }
  msg.headers=__CORS; msg.payload=rows.map(r=>({id:r.id, modelCode:r.model_code, manufacturer:r.manufacturer, ratedKva:r.rated_kva===null?null:Number(r.rated_kva), voltageClass:r.voltage_class, coolingType:r.cooling_type, active:!!r.active, createdBy:r.created_by, updatedAt:r.updated_at}));
  node.send(msg);
})()` + bbErr

// POST /api/orgs/:orgId/transformer-models — upsert (id present = edit an
// existing row; ownership re-checked so a guessed/reused id from another
// org's catalog can't be overwritten cross-org even though the table is
// shared physically for org-1/2/3).
const tmSaveFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
if(!b.modelCode||!String(b.modelCode).trim()){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'modelCode required'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  let ratedKva=null;
  if(b.ratedKva!==undefined && b.ratedKva!==null && b.ratedKva!==''){
    const n=Number(b.ratedKva); if(!isFinite(n)||n<=0||n>500000){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'ratedKva must be a number greater than 0 and at most 500000'};node.send(msg);return;}
    ratedKva=n;
  }
  let id=b.id;
  try{
    if(id){
      const[ex]=await pool.query("SELECT org_id FROM transformer_models WHERE id=?",[id]);
      if(ex.length && ex[0].org_id!==orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'model belongs to another organization'};node.send(msg);return;}
    } else id='tm-'+Date.now();
    await pool.query("INSERT INTO transformer_models (id,org_id,model_code,manufacturer,rated_kva,voltage_class,cooling_type,active,created_by) VALUES (?,?,?,?,?,?,?,1,?) "+
      "ON DUPLICATE KEY UPDATE model_code=VALUES(model_code),manufacturer=VALUES(manufacturer),rated_kva=VALUES(rated_kva),voltage_class=VALUES(voltage_class),cooling_type=VALUES(cooling_type)",
      [id,orgId,String(b.modelCode).trim().slice(0,120),b.manufacturer?String(b.manufacturer).trim().slice(0,120):null,ratedKva,b.voltageClass?String(b.voltageClass).trim().slice(0,64):null,b.coolingType?String(b.coolingType).trim().slice(0,32):null,au.name||au.userId||null]);
  }catch(e){ if(String(e&&e.message||'').indexOf('transformer_models')<0) throw e; msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'the model catalog needs migrate-v32 — run the migration first'};node.send(msg);return; }
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);
})()` + bbErr

// PUT /api/orgs/:orgId/transformer-models/:id/active {active} — retire/restore.
// Not a delete: units already pointing at this model must keep resolving it.
const tmSetActiveFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const id=msg.req.params.id; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  const[r]=await pool.query("UPDATE transformer_models SET active=? WHERE id=? AND org_id=?",[b.active?1:0,id,orgId]);
  if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  msg.headers=__CORS; msg.payload={ok:true,id,active:!!b.active}; node.send(msg);
})()` + bbErr

// DELETE /api/orgs/:orgId/transformer-models/:id — only when nothing points
// at it; otherwise deleting would silently blank every unit that inherited
// from it. Deactivate (above) is the path for "stop offering this on new
// approvals" without breaking devices already linked.
const tmDeleteFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const id=msg.req.params.id;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  const[inUse]=await pool.query("SELECT COUNT(*) AS n FROM node_nameplates WHERE model_id=?",[id]);
  if(inUse[0].n>0){msg.headers=__CORS;msg.statusCode=409;msg.payload={error:'model is assigned to '+inUse[0].n+' device(s) — deactivate it instead, or reassign those devices first'};node.send(msg);return;}
  const[r]=await pool.query("DELETE FROM transformer_models WHERE id=? AND org_id=?",[id,orgId]);
  if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})()` + bbErr


const bbTransitsFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||'';
(async()=>{const[r]=await pool.query('SELECT * FROM blood_box_transits WHERE org_id=? ORDER BY current_eta_min ASC',[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const bbTransitFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM blood_box_transits WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const[r]=await pool.query('SELECT * FROM blood_box_transits WHERE id=?',[id]); msg.headers=__CORS; msg.payload=r[0]; node.send(msg);})()` + bbErr

const bbJourneyGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const tid=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM blood_box_transits WHERE id=?",[tid]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const[r]=await pool.query('SELECT * FROM blood_box_journey_events WHERE transit_id=? ORDER BY ts ASC',[tid]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

// 2-output handler: out1 → http response, out2 → engine bridge (ingest) when
// the scan carried a temperature. Bridge msgs have no req/res so ingest treats
// them as non-HTTP and won't double-respond.
const bbJourneyPostFunc = CORS + `const pool=global.get('pool'); const tid=msg.req.params.id; const b=msg.payload||{};
if(!b.eventType||!b.signal){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'eventType and signal required'};node.send([msg,null]);return null;}
(async()=>{const id='je-'+Date.now(); await pool.query('INSERT INTO blood_box_journey_events (id,transit_id,floor_id,event_type,label,signal,lat,lng,pos_x_m,pos_y_m,temp_c,battery_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,tid,b.floorId||null,b.eventType,b.label||null,b.signal,b.lat||null,b.lng||null,b.posX||null,b.posY||null,b.tempC||null,b.batteryPct||null]);
  let bridge=null;
  if(typeof b.tempC==='number'){const[tr]=await pool.query('SELECT box_id FROM blood_box_transits WHERE id=?',[tid]); if(tr.length&&tr[0].box_id){const v={tempHigh:b.tempC,tempLow:b.tempC}; if(typeof b.batteryPct==='number')v.battery=b.batteryPct; bridge={payload:{nodeId:tr[0].box_id,values:v,ts:Date.now()}};}}
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send([msg,bridge]);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send([msg,null]);}); return null;`

// Report a transit telemetry sample → persist on the transit + continuous telemetry
// table (blood_box_transit_telemetry) + bridge into the alarm engine (out2 → ingest).
const bbTempFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const b=msg.payload||{};
if(typeof b.tempC!=='number'){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'tempC (number) required'};node.send([msg,null]);return null;}
(async()=>{const[tr]=await pool.query('SELECT box_id FROM blood_box_transits WHERE id=?',[id]);
  if(!tr.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'transit not found'};node.send([msg,null]);return;}
  await pool.query('UPDATE blood_box_transits SET current_temp_c=?, temp_max_c=GREATEST(COALESCE(temp_max_c,?),?) WHERE id=?',[b.tempC,b.tempC,b.tempC,id]);
  // Continuous high-freq transit telemetry log (§ blood_box_transit_telemetry)
  await pool.query('INSERT INTO blood_box_transit_telemetry (transit_id,box_id,temp_c,rh_pct,batt_pct,lat,lng,transport,transit_state) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, tr[0].box_id||null, b.tempC, b.rh??null, b.battery??null, b.lat??null, b.lng??null, b.transport??'wifi', b.transitState??null]);
  const boxId=tr[0].box_id; let bridge=null;
  if(boxId){const v={tempHigh:b.tempC,tempLow:b.tempC}; if(typeof b.battery==='number')v.battery=b.battery; bridge={payload:{nodeId:boxId,values:v,ts:b.ts||Date.now()}};}
  msg.headers=__CORS; msg.payload={ok:true,bridged:boxId?'queued':'no linked node'}; node.send([msg,bridge]);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send([msg,null]);}); return null;`

const bbFloorsFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||'';
(async()=>{const[r]=await pool.query('SELECT * FROM building_floors WHERE org_id=? ORDER BY floor_number DESC',[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const bbBeaconsGetFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||''; const floorId=msg.req.query&&msg.req.query.floorId;
(async()=>{const sql='SELECT * FROM ble_beacons WHERE org_id=?'+(floorId?' AND floor_id=?':'')+' ORDER BY id'; const a=floorId?[orgId,floorId]:[orgId]; const[r]=await pool.query(sql,a); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const bbBeaconsPostFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.orgId||!b.floorId||!b.uuid){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'orgId, floorId and uuid required'};return msg;}
(async()=>{const id=b.id||'bcn-'+Date.now(); await pool.query('INSERT INTO ble_beacons (id,org_id,floor_id,uuid,major,minor,pos_x_m,pos_y_m,tx_power_dbm,battery_pct,status) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE floor_id=VALUES(floor_id),pos_x_m=VALUES(pos_x_m),pos_y_m=VALUES(pos_y_m),tx_power_dbm=VALUES(tx_power_dbm),battery_pct=VALUES(battery_pct),status=VALUES(status)',[id,b.orgId,b.floorId,b.uuid,b.major||null,b.minor||null,b.posX||null,b.posY||null,b.txPower||null,b.battery||null,b.status||'active']); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr

const bbBeaconDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM ble_beacons WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  await pool.query('DELETE FROM ble_beacons WHERE id=?',[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

const bbLocGetFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT * FROM blood_box_locations WHERE box_id=? AND is_current=1 ORDER BY moved_at DESC LIMIT 1',[id]); msg.headers=__CORS; msg.payload=r.length?r[0]:null; node.send(msg);})()` + bbErr

const bbLocPostFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const b=msg.payload||{};
if(!b.orgId){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'orgId required'};return msg;}
(async()=>{await pool.query('UPDATE blood_box_locations SET is_current=0 WHERE box_id=? AND is_current=1',[id]);
  await pool.query('INSERT INTO blood_box_locations (org_id,box_id,floor_id,pos_x_m,pos_y_m,room_label,moved_by) VALUES (?,?,?,?,?,?,?)',[b.orgId,id,b.floorId||null,b.posX||null,b.posY||null,b.roomLabel||null,b.movedBy||null]);
  await pool.query('UPDATE blood_boxes SET floor_id=?,pos_x_m=?,pos_y_m=? WHERE id=?',[b.floorId||null,b.posX||null,b.posY||null,id]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- Generic fleet (transformer + carbonNode + bloodBox sensor nodes) -------
// Powers the per-product overview / device-list screens from live DB instead of
// mock data. Domain-agnostic: filter by ?domain= for one product line.
const fleetListFunc = CORS + `const au=msg.auth||{}; const domain=msg.req.query&&msg.req.query.domain;
const orgId = au.role==='superadmin' ? ((msg.req.query&&msg.req.query.orgId)||au.orgId) : au.orgId;
const pool=global.get('resolvePool')(orgId);   // org DB for the fleet query (accessFor uses control internally)
(async()=>{
  const acc = au.role==='superadmin' ? {role:'superadmin',orgId:orgId,departmentId:null,levels:{}} : await global.get('accessFor')(au.userId);
  // The factory pin (a GPS-less node inherits its org's coordinate) used to be a
  // COALESCE over "LEFT JOIN organizations", which only worked in row-level mode:
  // under TENANT_DB_MODE this query runs against iothub_<org>, where the
  // organizations table exists but is EMPTY — the join produced NULL and every
  // GPS-less device silently vanished from the map, however carefully the admin
  // set the pin. The org row is read from the CONTROL pool below and applied in
  // JS instead, which is correct in both modes.
  const sql="SELECT n.id,n.name,n.domain,n.org_id,n.site_id,n.department_id,n.lat,n.lng,__GRAFANA__,p.online,p.last_seen,p.rssi,p.fw,p.last_sample,"+
    "(SELECT e.severity FROM alarm_events e WHERE e.node_id=n.id AND e.acknowledged_at IS NULL AND e.cleared_at IS NULL ORDER BY FIELD(e.severity,'CRITICAL','WARNING') LIMIT 1) AS alarm "+
    // merge_into IS NULL: a secondary feed (the environmental half of a
    // transformer that publishes on two topics) is not its own device — the
    // worker already stores its readings under the primary, so listing it would
    // show the same transformer twice, once with half its parameters.
    "FROM nodes n LEFT JOIN device_presence p ON p.node_id=n.id WHERE n.org_id=? AND n.status='active' AND __MERGE__"+(domain?" AND n.domain=?":"")+" ORDER BY n.domain,n.id";
  const args=domain?[orgId,domain]:[orgId];
  // merge_into ships with migrate-v20 and grafana_url with migrate-v45, and this
  // flow rolls independently of the migration Job. Naming a column before it
  // exists failed the whole query, so the fleet — every device, every org —
  // 500'd until the Job caught up. Fall back to the pre-migration shape
  // instead, for each column independently: worst case a secondary feed is
  // listed as its own device, or grafanaUrl reads null, for a few minutes.
  const build = (merge, grafana) => sql.replace('__MERGE__', merge).replace('__GRAFANA__', grafana)
  let r;
  try { const[x]=await pool.query(build('n.merge_into IS NULL','n.grafana_url'),args); r=x; }
  catch(e){
    const em=String(e&&e.message||'');
    if(em.indexOf('grafana_url')>=0){
      try{ const[x]=await pool.query(build('n.merge_into IS NULL','NULL AS grafana_url'),args); r=x; node.warn('fleet: nodes.grafana_url missing (migrate-v45 not applied yet)'); }
      catch(e2){
        const em2=String(e2&&e2.message||'');
        if(em2.indexOf('merge_into')<0) throw e2;
        const[x]=await pool.query(build('1=1','NULL AS grafana_url'),args); r=x;
        node.warn('fleet: nodes.merge_into missing (migrate-v20 not applied yet) — listing every device until it is');
      }
    } else if(em.indexOf('merge_into')>=0){
      const[x]=await pool.query(build('1=1','n.grafana_url'),args); r=x;
      node.warn('fleet: nodes.merge_into missing (migrate-v20 not applied yet) — listing every device until it is');
    } else throw e;
  }
  // The device list, the sensor map and the alarm feed are all this one query —
  // the alarms page fans out over exactly the devices listed here — so the site
  // filter belongs in this filter and nowhere else on the read path.
  const __grants = (acc.role==='superadmin'||acc.role==='admin') ? {} : await global.get('nodeDeptMap')(pool, orgId);
  const vis=r.filter(n=>{ if(acc.role==='superadmin')return true; if(n.org_id!==acc.orgId)return false; if(acc.role==='admin')return true; const lvl=acc.levels[n.domain]||'none'; if(lvl==='none')return false; if(!global.get('deptVisible')(acc,n.department_id,__grants[n.id]))return false; if(!global.get('siteVisible')(acc,n.site_id))return false; if(!global.get('nodeVisible')(acc,n.id))return false; return true; });
  // organizations always lives in the control database, whichever mode we are in.
  if(vis.some(n=>n.lat==null||n.lng==null)){
    try{
      const[o]=await global.get('pool').query("SELECT lat,lng FROM organizations WHERE id=?",[orgId]);
      if(o.length && o[0].lat!=null && o[0].lng!=null){
        for(const n of vis){
          if(n.lat!=null && n.lng!=null) continue;
          // Every device still waiting for a real position would otherwise land
          // on the SAME coordinate and stack into one marker — you could not see
          // how many there were, or which. Offset each by a deterministic amount
          // derived from its id: 1e-4 degrees is about 11 m, so this spreads them
          // over roughly +/-15 m — enough to separate the dots, small enough that
          // the cluster still plainly means "at this site" and never implies a
          // surveyed position.
          let h=0; for(const c of n.id) h=(h*31+c.charCodeAt(0))>>>0;
          n.lat = Number(o[0].lat) + (((h%200)-100)/1000000)*1.4;
          n.lng = Number(o[0].lng) + ((((h>>>8)%200)-100)/1000000)*1.4;
          // Flagged so the map can draw it as "roughly here" rather than implying
          // a surveyed position the admin never set.
          n.approx = 1;
        }
      }
    }catch(e){ node.warn('fleet: factory-pin fallback skipped for '+orgId+': '+e.message); }
  }
  // Real sensor/parameter count, not a hardcoded guess: device_presence.last_sample
  // (migrate-v14) is the same latest-values JSON the pending-devices screen already
  // reads, so "N sensors" reflects exactly what this device is actually reporting —
  // and moves the moment its wire payload gains or drops a parameter, unlike a
  // fixed per-domain number that was true only for whatever seeded the demo fleet.
  for(const n of vis){
    let sample=n.last_sample;
    try{ if(typeof sample==='string') sample=JSON.parse(sample); }catch(e){ sample=null; }
    n.sensor_count = sample && typeof sample==='object' ? Object.keys(sample).length : 0;
    n.last_sample = sample && typeof sample==='object' ? sample : null;
  }
  msg.headers=__CORS; msg.payload=vis; node.send(msg);})()` + bbErr

// pool from the node's own org, not msg.auth.orgId — same superadmin
// blind spot readingsGetFunc documents; this is what feeds the live value
// on every device card and header, so a superadmin saw stale numbers for
// any device living in a tenant DB. Removed from DATA_PLANE too.
const fleetLatestFunc = CORS + `const id=msg.req.params.id;
// Only params the device is STILL reporting: keep those whose newest reading is
// within LATEST_WINDOW_MIN (default 60) of the node's newest reading overall.
// Without this, params a device stopped sending (e.g. after re-flashing it to a
// different product) linger forever and the UI shows a mix of live and dead keys.
const __win = Number(env.get('LATEST_WINDOW_MIN') || 60);
(async()=>{const pool=await global.get('poolForNode')(id, msg.auth); const[r]=await pool.query("SELECT r1.param_key,r1.value,r1.taken_at FROM readings r1 JOIN (SELECT param_key,MAX(taken_at) mt FROM readings WHERE node_id=? GROUP BY param_key) r2 ON r1.param_key=r2.param_key AND r1.taken_at=r2.mt JOIN (SELECT MAX(taken_at) nt FROM readings WHERE node_id=?) r3 ON r2.mt >= r3.nt - INTERVAL ? MINUTE WHERE r1.node_id=?",[id,id,__win,id]);
  const out={}; let last=null; for(const row of r){ out[row.param_key]=Number(row.value); if(!last||row.taken_at>last) last=row.taken_at; }
  // Presence comes with it: the device pages poll this endpoint every 10s
  // anyway, and the header badge must follow device_presence (what the offline
  // sweep decides) rather than each page guessing from the reading timestamp —
  // two places inferring "online" from different rules is how the header ends up
  // green while the event log says the device is down.
  let presence=null;
  try{ const[p]=await pool.query("SELECT online,last_seen,last_reading_at,rssi,batt,fw,transport FROM device_presence WHERE node_id=?",[id]); if(p.length) presence=p[0]; }
  catch(e){ try{ const[p]=await pool.query("SELECT online,last_seen,rssi,batt,fw FROM device_presence WHERE node_id=?",[id]); if(p.length) presence=p[0]; }catch(e2){} }
  msg.headers=__CORS; msg.payload={nodeId:id, values:out, lastReadingAt:last, presence:presence}; node.send(msg);})()` + bbErr

// --- Downlink (backend → device): config / cmd / ota --------------------------
// out1 → http response, out2 → mqtt out (published to the device's mqtt_prefix).
const cfgPutFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const body=msg.payload||{};
(async()=>{const[n]=await pool.query("SELECT mqtt_prefix FROM nodes WHERE id=?",[id]);
  if(!n.length||!n[0].mqtt_prefix){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'node/mqtt_prefix not found'};node.send([msg,null]);return;}
  let payload=body; if(!body||!Object.keys(body).length){const[rr]=await pool.query("SELECT rule_json FROM alarm_rules WHERE node_id=?",[id]); payload=rr.length?(typeof rr[0].rule_json==='string'?JSON.parse(rr[0].rule_json):rr[0].rule_json):{};}
  const topic=n[0].mqtt_prefix+'/config'; msg.headers=__CORS; msg.payload={ok:true,topic}; node.send([msg,{topic,payload,qos:1,retain:true}]);})()` + bbErr

const cmdPostFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const body=msg.payload||{}; const op=body.op||'reboot';
(async()=>{const[n]=await pool.query("SELECT mqtt_prefix FROM nodes WHERE id=?",[id]);
  if(!n.length||!n[0].mqtt_prefix){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'node/mqtt_prefix not found'};node.send([msg,null]);return;}
  const topic=n[0].mqtt_prefix+'/cmd/'+op; msg.headers=__CORS; msg.payload={ok:true,topic}; node.send([msg,{topic,payload:body,qos:1,retain:false}]);})()` + bbErr

const otaPostFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const body=msg.payload||{};
if(!body.to_version||!body.artefact_uri){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'to_version and artefact_uri required'};node.send([msg,null]);return null;}
(async()=>{const[n]=await pool.query("SELECT mqtt_prefix FROM nodes WHERE id=?",[id]);
  if(!n.length||!n[0].mqtt_prefix){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'node/mqtt_prefix not found'};node.send([msg,null]);return;}
  // Create a deployment record so progress/result can be tracked
  const depId='dep-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  // Find the release record (optional — may not exist if using ad-hoc URI)
  const [rel]=await pool.query("SELECT id FROM ota_releases WHERE product=? AND version=? LIMIT 1",[body.product||'',body.to_version]);
  const releaseId=rel.length?rel[0].id:(body.release_id||depId);
  await pool.query("INSERT INTO ota_deployments (id,node_id,release_id,status,progress_pct) VALUES (?,?,?,'pending',0)",[depId,id,releaseId]);
  const topic=n[0].mqtt_prefix+'/ota/cmd'; msg.headers=__CORS; msg.payload={ok:true,topic,deploymentId:depId}; node.send([msg,{topic,payload:Object.assign({},body,{deployment_id:depId}),qos:1,retain:false}]);})()` + bbErr

// --- OTA Release Management API (CRUD releases + list deployments) -----------
const otaRelListFunc = CORS + `const pool=global.get('pool'); const q=msg.req.query||{};
(async()=>{
  let sql='SELECT id,product,version,artefact_uri,sha256,release_notes,is_mandatory,created_at FROM ota_releases';
  const args=[]; if(q.product){sql+=' WHERE product=?'; args.push(q.product);}
  sql+=' ORDER BY created_at DESC'; const[r]=await pool.query(sql,args);
  msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const otaRelPostFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
// product/domain identifies which fleet the release targets. Frontend sends
// target_hw for display; the release is bound to a product line (default
// transformer for the ETERNITY go-live) so fleet-deploy can match nodes.domain.
const product = b.product || b.domain || 'transformer';
if(!b.version){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'version required'};return msg;}
(async()=>{
  const id=b.id||'rel-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  // artefact_uri: admin provides the HTTPS URL where the .bin is hosted
  // (S3/GCS pre-signed, nginx static, etc.). The frontend uploads the binary
  // to object storage first, then passes the URL here.
  await pool.query(
    "INSERT INTO ota_releases (id,product,version,artefact_uri,sha256,release_notes,is_mandatory) VALUES (?,?,?,?,?,?,?) " +
    "ON DUPLICATE KEY UPDATE artefact_uri=VALUES(artefact_uri),sha256=VALUES(sha256),release_notes=VALUES(release_notes),is_mandatory=VALUES(is_mandatory)",
    [id, product, b.version, b.artefact_uri||'', b.sha256||null, b.release_notes||null, b.is_mandatory?1:0]);
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr

const otaDepListFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const q=msg.req.query||{};
// Org scope: a deployment's device (nodes.org_id) must belong to the caller's org
// — otherwise an admin could enumerate every org's fleet firmware history via the
// unscoped list. JOIN nodes so the org filter applies; superadmin sees all (or one).
const orgId = au.role==='superadmin' ? (q.orgId||null) : au.orgId;
(async()=>{
  let sql='SELECT d.*, r.product, r.version FROM ota_deployments d LEFT JOIN ota_releases r ON r.id=d.release_id JOIN nodes n ON n.id=d.node_id';
  const args=[]; const where=[];
  if(orgId){where.push('n.org_id=?'); args.push(orgId);}
  if(q.nodeId){where.push('d.node_id=?'); args.push(q.nodeId);}
  if(q.status){where.push('d.status=?'); args.push(q.status);}
  if(where.length) sql+=' WHERE '+where.join(' AND ');
  sql+=' ORDER BY d.started_at DESC LIMIT 100'; const[r]=await pool.query(sql,args);
  msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const otaRelDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query("DELETE FROM ota_releases WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// Group OTA deploy: push a release to all nodes of a given product at once.
const otaFleetFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{}; const au=msg.auth||{};
if(!b.release_id){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'release_id required'};return msg;}
// Normalize the 3-way vocab (firmware product | nodes.domain | platform id) so a
// release's product always resolves to the nodes.domain it should deploy to.
const DOMAIN_OF={transformer:'transformer',eternity:'transformer',eternityTransformers:'transformer',
  carbonNode:'carbonNode',carbonbox:'carbonNode',refrigerationDataLogger:'carbonNode',
  bloodBox:'bloodBox',bloodbox:'bloodBox'};
(async()=>{
  const [rel]=await pool.query("SELECT id,product,version,artefact_uri FROM ota_releases WHERE id=?",[b.release_id]);
  if(!rel.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'release not found'};node.send([msg,null]);return;}
  const r=rel[0]; const dom=DOMAIN_OF[b.domain||r.product]||(b.domain||r.product);
  // Org scope: admins deploy only within their own org; superadmin may target one via org_id.
  const orgId = au.role==='superadmin' ? (b.org_id||au.orgId) : au.orgId;
  const [nodes]=await pool.query("SELECT n.id,n.mqtt_prefix FROM nodes n WHERE n.domain=? AND n.org_id=?",[dom,orgId]);
  const deployed=[];
  for(const nd of nodes){
    if(!nd.mqtt_prefix) continue;
    const depId='dep-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
    await pool.query("INSERT INTO ota_deployments (id,node_id,release_id,status,progress_pct) VALUES (?,?,?,'pending',0)",[depId,nd.id,r.id]);
    const payload={to_version:r.version, artefact_uri:r.artefact_uri, deployment_id:depId};
    node.send([null,{topic:nd.mqtt_prefix+'/ota/cmd',payload,qos:1,retain:false}]);
    deployed.push({nodeId:nd.id,deploymentId:depId});
  }
  // 'applied' matches the frontend api.deployFleetOta contract; 'count' kept for compat.
  msg.headers=__CORS; msg.payload={ok:true,applied:deployed.length,count:deployed.length,deployments:deployed}; node.send([msg,null]);
})()` + bbErr

// Edge alarm persistence: firmware sends edge-evaluated alarms (P/alarm/{sid})
// with {edge:true, severity, sid, value}. Persist to edge_alarm_log so the
// dashboard can show "device decided alarm before cloud".
const edgeAlarmFunc = `
const pool = global.get('pool'); const e = msg.payload;
if (!pool || !e || !e.nodeId) return null;
(async () => {
  const orgId = await global.get('orgOfNode')(e.nodeId);
  const opool = global.get('resolvePool')(orgId);   // org DB (control when flag off)
  const sev = (e.severity === 'CRITICAL' || e.severity === 'WARNING') ? e.severity : 'WARNING';
  // Find the alarm threshold from the rule for context
  const [rr] = await opool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?', [e.nodeId]);
  let threshold = null, dwellCount = null, label = e.paramKey, unit = '';
  if (rr.length) {
    const rule = typeof rr[0].rule_json==='string' ? JSON.parse(rr[0].rule_json) : rr[0].rule_json;
    const param = (rule.params||[]).find(p => p.key === e.paramKey);
    if (param) {
      threshold = sev === 'CRITICAL' ? param.critical : param.warn;
      dwellCount = rule.dwellMin;
      label = param.label || label; unit = param.unit || '';
    }
  }
  await opool.query(
    "INSERT INTO edge_alarm_log (node_id, param_key, severity, value, threshold, dwell_count, ts) VALUES (?,?,?,?,?,?,NOW(3))",
    [e.nodeId, e.paramKey, sev, e.value ?? null, threshold, dwellCount]);

  // --- surface it where operators actually look --------------------------
  // edge_alarm_log is written and read by nothing: no endpoint selects from
  // it, no page renders it, and this node used to have no downstream wire.
  // A fault the device detected and reported therefore never reached the
  // alarm list, never notified and never escalated. Mirroring it into
  // alarm_events puts it in front of the same UI, notifier and escalation
  // scan every cloud-evaluated alarm already goes through; source='edge'
  // preserves that the device, not the cloud, made the call.
  //
  // Suppressed while an equal-or-worse alarm on the same parameter is still
  // open, so firmware repeating the condition re-notifies nobody. This
  // mirrors how threshold alarms fire on transition rather than per sample.
  const [open] = await opool.query(
    "SELECT 1 FROM alarm_events WHERE node_id=? AND param_key=? AND cleared_at IS NULL" +
    " AND (severity=? OR severity='CRITICAL') LIMIT 1", [e.nodeId, e.paramKey, sev]);
  if (open.length) return;

  const [nrow] = await opool.query('SELECT department_id FROM nodes WHERE id=?', [e.nodeId]);
  const depId = nrow.length ? nrow[0].department_id : null;
  const ts = e.ts ? new Date(e.ts) : new Date();
  const id = 'ev-edge-' + e.nodeId + '-' + e.paramKey + '-' + ts.getTime();
  await opool.query(
    "INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,source,value,threshold,unit,raised_at)" +
    " VALUES (?,?,?,?,?,?,?, 'threshold','edge', ?,?,?,NOW(3))",
    [id, e.nodeId, orgId, depId, e.paramKey, label, sev, e.value ?? 0, threshold ?? 0, unit]);

  node.send({ payload: { id, nodeId:e.nodeId, orgId, departmentId:depId, paramKey:e.paramKey,
    paramLabel:label, kind:'threshold', source:'edge', value:e.value ?? 0, unit,
    threshold: threshold ?? 0, severity:sev, time: ts.toISOString() } });
})().catch(err => node.error('edge-alarm: ' + err.message));
return null;
`

const LIBS = [{ var: 'mysql', module: 'mysql2/promise' }]
// A Node-RED Function node runs inside a vm.createContext() sandbox that is a
// bare object literal (@node-red/nodes/core/function/10-function.js) — it does
// NOT inherit the host process's globals, so Node 18+ having a built-in `fetch`
// does not put `fetch` in scope here. Every call site that did `await fetch(...)`
// without declaring it as a lib threw "fetch is not defined" the first time it
// ran — which is exactly the "Tenant database was NOT created (fetch is not
// defined)" error the Provision Wizard showed, because orgsPostFunc's own
// catch(e) reported e.message straight to the UI. Every OTHER fetch() call site
// had the identical bug but is wrapped in a bare try/catch that only node.warn's
// or node.error's — LINE/Telegram/Google Chat notify, self-registration's tenant
// DB trigger, the scheduled Telegram report, and the superadmin's channel "Test"
// button — so it read as those integrations being unconfigured rather than
// broken. RED.import() resolves ESM packages fine (it takes lib.default ?? lib),
// confirmed against node-fetch@3's actual export shape.
const FETCH_LIB = { var: 'fetch', module: 'node-fetch' }
// notify node also needs nodemailer (SMTP email), like the Express service
const NOTIFY_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'nodemailer', module: 'nodemailer' }, FETCH_LIB]
// reportrun additionally attaches a CSV to a scheduled Telegram report. The
// code built that with the web-standard `new FormData()` / `new Blob(...)` —
// also undefined in this sandbox, and even once injected, a WHATWG FormData/Blob
// pair from one package does not reliably serialize through node-fetch's body
// handling unless it is the SAME class node-fetch itself checks `instanceof`
// against. The classic Node streams-based `form-data` package is the pairing
// node-fetch actually documents for multipart uploads, keyed on Buffers/streams
// instead of Blobs — so the call site below was rewritten to match, rather than
// injecting a Blob implementation that might silently serialize wrong.
const REPORT_LIBS = [...NOTIFY_LIBS, { var: 'FormData', module: 'form-data' }]
// init defines the auth guard closure (needs jwt); login verifies bcrypt + signs jwt
// crypto-js (real npm package) encrypts secrets at rest — node:crypto can't be a
// functionExternalModule. nodemailer powers the shared mailConfig() transport.
const INIT_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'jwt', module: 'jsonwebtoken' }, { var: 'nodemailer', module: 'nodemailer' }, { var: 'CryptoJS', module: 'crypto-js' }]
const LOGIN_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'jwt', module: 'jsonwebtoken' }, { var: 'bcrypt', module: 'bcryptjs' }]
// register (self sign-up) triggers the same MIGRATE_URL fetch as the superadmin
// Provision Wizard when a self-registration turns out to be a brand-new org.
const REGISTER_LIBS = [...LOGIN_LIBS, FETCH_LIB]
// forgot mints the token with jwt; reset hashes with bcrypt; forgot mails via nodemailer.
// No 'crypto' external module (Node-RED may resolve it to the deprecated npm stub).
const FORGOT_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'jwt', module: 'jsonwebtoken' }, { var: 'bcrypt', module: 'bcryptjs' }, { var: 'nodemailer', module: 'nodemailer' }]
// orgsPostFunc (superadmin Provision Wizard) triggers /migrate/org/<id> — the
// exact call that was failing.
const PROVISION_LIBS = [...FORGOT_LIBS, FETCH_LIB]
// usrPostFunc (admin "Create new user") hashes an optional password with
// bcrypt. It has no jwt/fetch/nodemailer need, so it isn't LOGIN_LIBS —
// without its own override it fell through to the generic pool-detection
// loop below, which only grants `mysql` (the only lib that loop can infer
// from the source). Referencing `bcrypt` in a function node whose libs don't
// declare it throws a ReferenceError at runtime, not a type error — and only
// AFTER the row's initial INSERT (which doesn't include password_hash) had
// already committed, so a request with a password 500'd while leaving a real
// user row behind with password_hash NULL. Reproduced against live MySQL.
const USRPOST_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'bcrypt', module: 'bcryptjs' }]
const fn = (id, name, func, x, y, wires, outputs = 1, extra = {}) => ({ id, type: 'function', z: 'be', name, func, outputs, libs: [], x, y, wires, ...extra })
let yREST = 360
// policy ∈ public|auth|admin|super (default auth). GUARD is prepended to the handler.
const endpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD_OPEN(policy) + handlerFunc + GUARD_CLOSE(policy), 420, y, [[`${idBase}_resp`]]),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}
// Like endpoint() but the handler has a 2nd output wired to the engine `ingest`
// node — used by the BloodBOX transit-temperature bridge (excursion alerts).
const bridgeEndpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD_OPEN(policy) + handlerFunc + GUARD_CLOSE(policy), 420, y, [[`${idBase}_resp`], ['ingest']], 2, { libs: LIBS }),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}
// Like endpoint() but out2 → `mqttout` — backend→device downlink (config/cmd/ota).
const downlinkEndpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD_OPEN(policy) + handlerFunc + GUARD_CLOSE(policy), 420, y, [[`${idBase}_resp`], ['mqttout', 'dbgMqttOut']], 2, { libs: LIBS }),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}

// Node metadata (domain/department/site), refreshed on a timer so wsBroadcast
// can apply the SAME per-device visibility rules the REST 'node' guard uses
// (deptVisible/siteVisible/product-access level) without a DB round trip on
// every single telemetry frame — readings arrive every ~1.5s per device, far
// too hot a path for a synchronous query. A device missing from the cache
// (not yet swept, or swept before it was created) is treated as unknown and
// the broadcast falls back to the old org-only check, the same fail-open
// default every other visibility gate in this file uses for absent data.
const nodeMetaSweepFunc = `
(async () => {
  const meta = {}, depts = {};
  for (const __org of await global.get('sweepOrgs')()) {
    try {
      const pool = global.get('resolvePool')(__org);
      const [rows] = await pool.query('SELECT id, domain, department_id, site_id FROM nodes WHERE org_id=?', [__org]);
      for (const r of rows) meta[r.id] = { orgId: __org, domain: r.domain, departmentId: r.department_id, siteId: r.site_id };
      Object.assign(depts, await global.get('nodeDeptMap')(pool, __org));
    } catch (e) { node.warn('nodeMetaSweep (' + __org + '): ' + e.message); }
  }
  global.set('nodeMetaCache', meta);
  global.set('nodeDeptCache', depts);
})();
return null;
`

// --- WebSocket bridge: push live telemetry/alarm to the frontend -------------
// Tapped off normalize (readings) + ingest (alarm). Emits the TelemetryData
// shape the useMqttTelemetry hook expects; alarms carry type:'alarm'.
// Per-org fan-out. A single WS listener serves every tenant, so we must NOT
// broadcast to all sockets (that leaked every org's live telemetry+alarms to
// any connected client). Instead we emit one message per AUTHENTICATED socket
// whose org matches the frame's org (superadmin sees all). Sockets that never
// sent a valid token (see wsAuth) are absent from wsSessions → receive nothing.
//
// Org match alone is NOT enough: the REST 'node' guard also enforces product
// access level, department grants, site scoping and per-user device limits
// (guard(), policy 'node') before handing back readings/events/latest for a
// device — a viewer denied all of that over REST was still getting the same
// device's live numbers over this socket, because org was the only thing
// checked here. nodeMetaCache + the session's cached accessFor() snapshot
// (see wsAuth) let us apply the identical checks per frame.
const wsBroadcastFunc = `
const p = msg.payload || {};
let out, nodeId;
if (p.values) {
  const v = p.values;
  let temp = v.tempHigh; if (temp===undefined) temp = v.tempLow; if (temp===undefined) temp = v.oilTemp;
  if (temp===undefined) { const n = Object.values(v).find(x => typeof x==='number'); temp = (n===undefined?null:n); }
  out = { id: p.nodeId, mac: '', temperature: temp===null?null:Number(temp), doorOpen: (v.door||0)>0, values: v, timestamp: new Date(p.ts||Date.now()).toISOString() };
  nodeId = p.nodeId;
} else if (p.severity) {
  out = { type:'alarm', id: p.nodeId, paramKey: p.paramKey, severity: p.severity, value: p.value, timestamp: p.time || new Date().toISOString() };
  nodeId = p.nodeId;
} else { return null; }
const org = p.orgId || null;
const meta = (global.get('nodeMetaCache') || {})[nodeId];
const sessions = global.get('wsSessions') || {};
const outMsgs = [];
for (const sid of Object.keys(sessions)) {
  const s = sessions[sid];
  if (!s) continue;
  // superadmin: all orgs. tenant: only its own org. Frame with no org → superadmin only.
  if (s.role !== 'superadmin' && (!org || s.orgId !== org)) continue;
  if (s.role !== 'admin' && s.role !== 'superadmin' && s.acc && meta) {
    const lvl = s.acc.levels[meta.domain] || 'none';
    if (lvl === 'none') continue;
    if (!global.get('deptVisible')(s.acc, meta.departmentId, (global.get('nodeDeptCache')||{})[nodeId])) continue;
    if (!global.get('siteVisible')(s.acc, meta.siteId)) continue;
    if (!global.get('nodeVisible')(s.acc, nodeId)) continue;
  }
  outMsgs.push({ payload: out, _session: { type: 'websocket', id: sid } });
}
return [outMsgs];
`

// Authenticates a WS client. The frontend sends {token} as its first frame; we
// verify the JWT, resolve the SAME access snapshot the REST guard uses
// (departments/sites/product-access levels/per-user device limits), and
// record session id → {orgId, role, acc}. Only registered sessions receive
// telemetry (fail-closed). Stale entries are pruned by TTL.
const WS_AUTH_LIBS = [{ var: 'jwt', module: 'jsonwebtoken' }];
const wsAuthFunc = `
const s = msg._session; if (!s || !s.id) return null;
let b = msg.payload; if (typeof b === 'string') { try { b = JSON.parse(b); } catch(e) { return null; } }
const tok = b && b.token; if (!tok) return null;
(async () => {
  try {
    const claims = jwt.verify(tok, env.get('JWT_SECRET') || 'dev-secret-change-me');
    const sessions = global.get('wsSessions') || {};
    // Prune sessions older than 24h so dead sockets don't accumulate.
    const cutoff = Date.now() - 86400000;
    for (const k of Object.keys(sessions)) { if (!sessions[k] || sessions[k].ts < cutoff) delete sessions[k]; }
    const acc = (claims.role !== 'admin' && claims.role !== 'superadmin') ? await global.get('accessFor')(claims.userId) : null;
    sessions[s.id] = { orgId: claims.orgId, role: claims.role, acc, ts: Date.now() };
    global.set('wsSessions', sessions);
  } catch (e) { /* invalid token → not registered → receives nothing */ }
})();
return null;
`

// --- Scheduled reports: cron → CSV summary → email (notify) ------------------
//
// Timing (migrate-v41). next_run_at used to be NOW()+INTERVAL, which meant a
// schedule fired at whatever minute it was created and then DRIFTED — this tick
// runs every 15 minutes and sweeps up anything already due, so each run pushed
// the next one up to a quarter-hour later. Now the next run is computed from
// the CONFIGURED send_hour/send_minute (and day_of_week / day_of_month), so
// "07:00 daily" stays 07:00 forever instead of walking through the morning.
//
// Every computation is done in SQL rather than JS on purpose: each pool sets
// `SET time_zone = DB_TZ` ('+07:00'), so NOW(3) inside a query is local wall
// clock, while `new Date()` in this function node is the CONTAINER's zone —
// usually UTC. Doing the arithmetic in JS would put every scheduled report
// seven hours out, and only for deployments whose container clock disagrees
// with DB_TZ, which is exactly the kind of bug that survives a demo.
const reportRunFunc = `
const ctl = global.get('pool'); if (!ctl || typeof ctl.query !== 'function') return null;
(async () => {
  for (const __org of await global.get('sweepOrgs')()) {
  // One org's failure must not cancel the tick for every org swept after it.
  // Before this try, the whole double loop shared ONE catch at the very
  // bottom — a transient error on any single query (a lagging tenant DB, a
  // dropped connection) threw past both loops, and node.error only logs; it
  // does not resume the iteration. Every org later in sweepOrgs()'s order
  // would then silently receive no reports that tick. The 15-minute retick
  // means a genuinely transient failure self-heals for the FAILED org next
  // time, but there is no reason later orgs should ever have been skipped for
  // a problem that was never theirs.
  try {
  const pool = global.get('resolvePool')(__org);

  // The next firing of a schedule, as DB-local wall clock. WEEKDAY() is
  // 0=Monday, so WEEKDAY()+1 gives the 1=Mon..7=Sun the column stores.
  const nextRunAt = async (seq, h, m, dow, dom) => {
    const mins = (Number(h)||0)*60 + (Number(m)||0);
    if (seq === 'weekly') {
      const d = Math.min(7, Math.max(1, Number(dow)||1));
      const [r] = await pool.query(
        "SELECT CASE WHEN base > NOW(3) THEN base ELSE base + INTERVAL 7 DAY END AS nxt FROM " +
        "(SELECT TIMESTAMP(DATE(NOW(3))) + INTERVAL ((? - (WEEKDAY(NOW(3))+1) + 7) % 7) DAY + INTERVAL ? MINUTE AS base) t",
        [d, mins]);
      return r[0].nxt;
    }
    if (seq === 'monthly') {
      // Capped at 28 so the date exists in February. A schedule asking for the
      // 31st would otherwise silently skip most of the year.
      const d = Math.min(28, Math.max(1, Number(dom)||1));
      const [r] = await pool.query(
        "SELECT CASE WHEN base > NOW(3) THEN base ELSE base + INTERVAL 1 MONTH END AS nxt FROM " +
        "(SELECT TIMESTAMP(DATE_FORMAT(NOW(3),'%Y-%m-01')) + INTERVAL (?-1) DAY + INTERVAL ? MINUTE AS base) t",
        [d, mins]);
      return r[0].nxt;
    }
    const [r] = await pool.query(
      "SELECT CASE WHEN base > NOW(3) THEN base ELSE base + INTERVAL 1 DAY END AS nxt FROM " +
      "(SELECT TIMESTAMP(DATE(NOW(3))) + INTERVAL ? MINUTE AS base) t", [mins]);
    return r[0].nxt;
  };

  // Who gets it, asked of the directory at SEND time rather than read from a
  // list somebody typed months ago — that is the whole point of the department
  // and users modes: a new engineer in the department receives the next report
  // without anyone editing this schedule, and a leaver stops receiving it.
  const resolveRecipients = async (s) => {
    const manual = String(s.recipients||'').trim();
    // A telegram destination is a chat id, not an address book entry.
    if ((s.channel||'email') === 'telegram') return manual;
    const mode = s.recipient_mode || 'manual';
    const idList = (v) => String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
    try {
      if (mode === 'department') {
        const ids = idList(s.recipient_dept_ids);
        if (!ids.length) return '';
        // Mirrors global departmentsOf(): user_departments wins when the user
        // has any row there, and users.department_id is the fallback for
        // accounts that predate the join table. Resolving with only the JOIN
        // would silently drop every legacy-assigned member.
        const [rows] = await pool.query(
          "SELECT DISTINCT u.email FROM users u WHERE u.org_id=? AND u.email IS NOT NULL AND u.email<>'' AND (" +
          " u.id IN (SELECT user_id FROM user_departments WHERE department_id IN (?))" +
          " OR (u.department_id IN (?) AND NOT EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id=u.id))" +
          ")", [s.org_id, ids, ids]);
        return rows.map(r=>r.email).join(',');
      }
      if (mode === 'users') {
        const ids = idList(s.recipient_user_ids);
        if (!ids.length) return '';
        // org_id is part of the predicate, not decoration: it is what stops a
        // schedule carrying another tenant's user id from mailing them.
        const [rows] = await pool.query(
          "SELECT email FROM users WHERE org_id=? AND id IN (?) AND email IS NOT NULL AND email<>''",
          [s.org_id, ids]);
        return rows.map(r=>r.email).join(',');
      }
    } catch(e) {
      // An older database without user_departments must not silently mail the
      // wrong people — fall back to nothing and say so.
      node.warn('report '+s.name+': recipient resolution failed ('+e.message+')');
      return '';
    }
    return manual;
  };

  const [due] = await pool.query("SELECT * FROM report_schedules WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at<=NOW(3))");
  for (const s of due) {
    let nodeIds = [];
    if (s.scope==='device' && s.scope_id) nodeIds = [s.scope_id];
    else { const args = (s.scope==='department' && s.scope_id) ? [s.org_id, s.scope_id] : [s.org_id];
      const [ns] = await pool.query("SELECT id FROM nodes WHERE org_id=?"+((s.scope==='department'&&s.scope_id)?" AND department_id=?":""), args); nodeIds = ns.map(n=>n.id); }
    // window_days decouples "how much data it covers" from "how often it
    // arrives" — a daily email summarising the trailing week is a normal ask
    // and could not be expressed before. NULL keeps the original derivation.
    const days = (s.window_days && Number(s.window_days) > 0)
      ? Number(s.window_days)
      : (s.sequence==='weekly'?7 : s.sequence==='monthly'?30 : 1);
    let csv = 'node_id,param_key,n,avg,min,max\\n';
    if (nodeIds.length) {
      const [rows] = await pool.query("SELECT node_id,param_key,COUNT(*) n,AVG(value) a,MIN(value) mn,MAX(value) mx FROM readings WHERE node_id IN (?) AND taken_at>(NOW(3)-INTERVAL ? DAY) GROUP BY node_id,param_key ORDER BY node_id,param_key", [nodeIds, days]);
      for (const r of rows) csv += r.node_id+','+r.param_key+','+r.n+','+Number(r.a).toFixed(2)+','+Number(r.mn).toFixed(2)+','+Number(r.mx).toFixed(2)+'\\n';
    }
    const to = await resolveRecipients(s);
    const channel = s.channel || 'email';
    // Always .csv, because the CSV above is always what is built. format still
    // reads PDF/XLSX on rows created before that picker was made honest, and
    // naming the attachment after the stored format would hand an operator a
    // file called report.pdf containing comma-separated text — worse than a
    // correctly-named CSV. There is no PDF or XLSX generator in this backend
    // (nothing in the function node's libs, nothing in package.json); adding
    // one is what it would take to honour the column.
    if (s.format && s.format !== 'CSV') node.warn('report '+s.name+': format '+s.format+' is not implemented — sending CSV');
    const fname = String(s.name).replace(/\\s+/g,'_')+'.csv';
    // Custom subject / body (migrate-v43). NULL keeps the previous hardcoded
    // wording exactly, so an untouched schedule sends what it always sent.
    // Substitution is a literal placeholder swap, not a template language:
    // this same text goes into an email subject AND a Telegram caption, and
    // anything with expressions would need escaping for both sinks.
    const __rowCount = Math.max(0, csv.split('\\n').filter(Boolean).length - 1);
    const __fill = (t) => String(t)
      .split('{name}').join(s.name || '')
      .split('{sequence}').join(s.sequence || '')
      .split('{scope}').join(s.scope || '')
      .split('{org}').join(s.org_id || '')
      .split('{date}').join(new Date().toISOString().slice(0,10))
      .split('{devices}').join(String(nodeIds.length))
      .split('{rows}').join(String(__rowCount));
    const subject = s.subject_template ? __fill(s.subject_template) : ('ONEOPS Report: '+s.name);
    const body = s.body_template ? __fill(s.body_template) : ('Automated '+s.sequence+' '+s.scope+' report.');
    if (channel === 'telegram') {
      // recipients holds the Telegram chat id; the bot token is a platform setting.
      const tg = (await global.get('notifyConfig')()).telegramToken;
      if (tg && to) {
        // FormData here is the classic 'form-data' package (a Buffer-based
        // multipart builder), not the web-standard FormData/Blob pair the code
        // used before — those are undefined in a Node-RED function sandbox (see
        // FETCH_LIB above), and even injected, a Blob from one implementation is
        // not guaranteed to survive node-fetch's own body-type check. This is
        // the pairing node-fetch documents for multipart uploads.
        const fd = new FormData();
        fd.append('chat_id', to);
        // Custom caption when set, else the previous wording verbatim.
        fd.append('caption', s.subject_template||s.body_template ? (subject+(body?'\\n'+body:'')) : ('ONEOPS Report: '+s.name+' ('+s.sequence+' '+s.scope+')'));
        fd.append('document', Buffer.from(csv, 'utf-8'), { filename: fname, contentType: 'text/csv' });
        const tr = await fetch('https://api.telegram.org/bot'+tg+'/sendDocument', { method:'POST', body: fd });
        if (!tr.ok) node.warn('report '+s.name+': telegram sendDocument failed ('+tr.status+')');
      } else { node.warn('report '+s.name+': telegram skipped (no TELEGRAM_BOT_TOKEN/chat id), '+nodeIds.length+' nodes'); }
    } else if (to) {
      const mc = await global.get('mailConfig')();
      if (mc.transport) { await mc.transport.sendMail({ from: mc.from, to, subject, text: body, attachments: [{ filename: fname, content: csv }] }); }
      else node.warn('report '+s.name+': email skipped (SMTP not configured), '+nodeIds.length+' nodes');
    } else {
      // Distinguish "nobody was configured" from "the department resolved to
      // nobody with an email" — they need different fixes, and the second one
      // looks identical to a working schedule from the outside.
      const mode = s.recipient_mode || 'manual';
      node.warn('report '+s.name+': email skipped — '+(mode==='manual'
        ? 'no recipients set'
        : mode+' targeting resolved to no address (check the selected '+(mode==='department'?'departments have members with email':'users have email')+')')+', '+nodeIds.length+' nodes');
    }
    const nxt = await nextRunAt(s.sequence, s.send_hour, s.send_minute, s.day_of_week, s.day_of_month);
    await pool.query("UPDATE report_schedules SET last_run_at=NOW(3), next_run_at=? WHERE id=?", [nxt, s.id]);
  }
  } catch(e) { node.error('report-run: org '+__org+' failed, continuing with the rest: '+e.message); }
  }
})().catch(e => node.error('report-run: ' + e.message));
return null;
`

// report_schedules is an ORG table (see ORG_TABLES), so it lives in the tenant
// database — and reportRunFunc above reads it through resolvePool(). These three
// endpoints used the CONTROL pool, which meant that under TENANT_DB_MODE=on
// every schedule an admin created was written to `iothub` while the scheduler
// looked for it in `iothub_<org>`. The list endpoint read from the same wrong
// place, so the UI showed the schedule sitting there enabled and nothing was
// ever sent: the feature appeared to work and silently did nothing for every
// org on its own database. Same fix and same reasoning as epListFunc's
// "event_problems live in the org DB".
const rptListFunc = CORS + `const au=msg.auth||{}; const orgId = au.role==='superadmin' ? ((msg.req.query&&msg.req.query.orgId)||au.orgId) : (au.orgId||'');
const pool=global.get('resolvePool')(orgId);
(async()=>{const[r]=await pool.query("SELECT * FROM report_schedules WHERE org_id=? ORDER BY name",[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const rptPostFunc = CORS + `const au=msg.auth||{}; const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
const orgId = au.role==='superadmin' ? (b.orgId||au.orgId) : au.orgId;   // org from JWT, not body
const pool=global.get('resolvePool')(orgId);
// Clamped here rather than trusted from the browser: day_of_month is capped at
// 28 so the date exists in February, and the minute is snapped to the quarter
// hour because the scheduler tick only runs every 15 minutes — storing :07
// would promise a precision that cannot be delivered.
const num=(v,lo,hi,dflt)=>{const n=Number(v); return Number.isFinite(n) ? Math.min(hi,Math.max(lo,Math.round(n))) : dflt;};
const hour=num(b.sendHour,0,23,7);
const minute=[0,15,30,45].indexOf(num(b.sendMinute,0,45,0))>=0 ? num(b.sendMinute,0,45,0) : Math.round(num(b.sendMinute,0,45,0)/15)*15;
const dow=b.sequence==='weekly' ? num(b.dayOfWeek,1,7,1) : null;
const dom=b.sequence==='monthly' ? num(b.dayOfMonth,1,28,1) : null;
const winRaw=(b.windowDays===''||b.windowDays===null||b.windowDays===undefined) ? null : num(b.windowDays,1,365,null);
const mode=['manual','department','users'].indexOf(String(b.recipientMode||'manual'))>=0 ? String(b.recipientMode||'manual') : 'manual';
const csvIds=(v)=>Array.isArray(v) ? v.filter(Boolean).join(',') : (v ? String(v) : null);
// Accept BOTH spellings. The reports page posts scope_id (snake), this handler
// only ever read b.scopeId (camel), so scope_id arrived as undefined and every
// department- or device-scoped schedule was stored with a NULL target — which
// reportRunFunc then treats as "no scope_id", widening the report to the whole
// organization. A "Line 3 daily" schedule silently mailed the entire fleet.
// The frontend is fixed to send scopeId; reading both keeps schedules created
// by the old page (and any other caller) working.
const scopeId=(b.scopeId!==undefined && b.scopeId!==null && b.scopeId!=='') ? b.scopeId
             : ((b.scope_id!==undefined && b.scope_id!==null && b.scope_id!=='') ? b.scope_id : null);
(async()=>{const id=b.id||'rpt-'+Date.now();
  await pool.query("INSERT INTO report_schedules (id,org_id,name,scope,scope_id,sequence,format,channel,recipients,enabled,send_hour,send_minute,day_of_week,day_of_month,window_days,recipient_mode,recipient_dept_ids,recipient_user_ids,subject_template,body_template,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3)) ON DUPLICATE KEY UPDATE name=VALUES(name),scope=VALUES(scope),scope_id=VALUES(scope_id),sequence=VALUES(sequence),format=VALUES(format),channel=VALUES(channel),recipients=VALUES(recipients),enabled=VALUES(enabled),send_hour=VALUES(send_hour),send_minute=VALUES(send_minute),day_of_week=VALUES(day_of_week),day_of_month=VALUES(day_of_month),window_days=VALUES(window_days),recipient_mode=VALUES(recipient_mode),recipient_dept_ids=VALUES(recipient_dept_ids),recipient_user_ids=VALUES(recipient_user_ids),subject_template=VALUES(subject_template),body_template=VALUES(body_template)",
    [id,orgId,b.name,b.scope||'device',scopeId,b.sequence||'daily',b.format||'CSV',b.channel||'email',b.recipients||null,b.enabled===false?0:1,
     hour,minute,dow,dom,winRaw,mode,csvIds(b.recipientDeptIds),csvIds(b.recipientUserIds),
     // Empty string clears a template back to the built-in default; undefined
     // (key absent) would too, which is what an older client sends.
     (b.subjectTemplate||'').trim()||null,(b.bodyTemplate||'').trim()||null]);
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr

const rptDelFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id;
const pool=global.get('resolvePool')(au.orgId||'');
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM report_schedules WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  await pool.query("DELETE FROM report_schedules WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// Event problem catalog (root causes): admin maintains; viewers read for ack.
const epListFunc = CORS + `const au=msg.auth||{}; const q=msg.req.query||{};
const orgId = au.role==='superadmin' ? (q.orgId||au.orgId) : au.orgId;
const pool=global.get('resolvePool')(orgId);   // event_problems live in the org DB
(async()=>{let sql="SELECT * FROM event_problems WHERE org_id=?"; const a=[orgId]; if(q.departmentId){sql+=" AND (department_id=? OR department_id IS NULL)"; a.push(q.departmentId);} if(q.domain){sql+=" AND (domain=? OR domain IS NULL)"; a.push(q.domain);} sql+=" ORDER BY label"; const[r]=await pool.query(sql,a); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const epPostFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const b=msg.payload||{};
if(!b.label){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'label required'};return msg;}
// Force org from the JWT (never trust a client-supplied orgId); superadmin may target one.
const orgId = au.role==='superadmin' ? (b.orgId||au.orgId) : au.orgId;
(async()=>{const id=b.id||'ep-'+Date.now(); await pool.query("INSERT INTO event_problems (id,org_id,department_id,domain,label) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE department_id=VALUES(department_id),domain=VALUES(domain),label=VALUES(label)",[id,orgId,b.departmentId||null,b.domain||null,b.label]); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr

const epDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM event_problems WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  await pool.query("DELETE FROM event_problems WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- Per-user config (configProfile). Identity = the JWT's userId (msg.auth) ----
const meGetFunc = CORS + `const pool=global.get('pool'); const uid=(msg.auth&&msg.auth.userId)||'';
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'authentication required'};return msg;}
(async()=>{const[u]=await pool.query("SELECT id,org_id,email,name,role,department_id FROM users WHERE id=?",[uid]);
  const[pr]=await pool.query("SELECT prefs FROM user_prefs WHERE user_id=?",[uid]);
  const prefs = pr.length ? (typeof pr[0].prefs==='string'?JSON.parse(pr[0].prefs||'{}'):pr[0].prefs) : {};
  msg.headers=__CORS; msg.payload={ user: u.length?u[0]:{id:uid}, prefs }; node.send(msg);})()` + bbErr

const mePutFunc = CORS + `const pool=global.get('pool'); const uid=(msg.auth&&msg.auth.userId)||''; const prefs=msg.payload&&msg.payload.prefs!==undefined?msg.payload.prefs:msg.payload;
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'authentication required'};return msg;}
(async()=>{await pool.query("INSERT INTO user_prefs (user_id,prefs) VALUES (?,?) ON DUPLICATE KEY UPDATE prefs=VALUES(prefs)",[uid,JSON.stringify(prefs||{})]);
  // Name and phone are IDENTITY, not preferences. They only ever reached the
  // prefs blob and were never read back (meGetFunc returns the users row, and
  // the page seeds from the session), so editing Full Name showed "Saved!" and
  // reverted on the next reload.
  const p=prefs||{}; const sets=[]; const vals=[];
  if(typeof p.name==='string' && p.name.trim()){ sets.push('name=?'); vals.push(p.name.trim()); }
  if(typeof p.phone==='string'){ sets.push('phone=?'); vals.push(p.phone.trim()||null); }
  if(sets.length){ vals.push(uid); try{ await pool.query("UPDATE users SET "+sets.join(',')+" WHERE id=?",vals); }catch(e){ node.warn('profile identity update skipped for '+uid+': '+e.message); } }
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- Which parameters a device page shows -----------------------------------
// SENSOR READINGS read a hardcoded frontend list, so an admin could not choose.
// Fine for six values; a merged two-topic transformer reports about forty, and
// oil temperature should not be buried among THD_VoltCA and ApparentpowerB.
//
// Resolution order: this node's own selection, else the org+domain default, else
// nothing — and nothing means "unconfigured, show everything", never "show none".
//
// resolvePool, NOT the control pool. migrate-v26 strips its `USE iothub` and runs
// against every tenant database, so display_params lives beside nodes and
// alarm_rules in the org DB — and the ownership check below reads `nodes`, which
// only exists there. Reading config from one database while the devices it names
// live in another is how a tenant org ends up with a selection that matches
// nothing.
const dpGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const q=msg.req.query||{}; const domain=String(q.domain||''); const nodeId=q.nodeId?String(q.nodeId):null;
// Who are we resolving FOR? An admin configuring the picker names the department
// explicitly (including '' for the org-wide set, which is what they edit by
// default). Everyone else gets their OWN departments — a viewer must not be able
// to ask for another team's parameter set by passing its id.
const asked=q.departmentId===undefined?null:String(q.departmentId||'');
(async()=>{
  let depts;
  if(au.role==='admin'||au.role==='superadmin'){ depts=[asked||null]; }
  else {
    const acc=await global.get('accessFor')(au.userId);
    const own=(acc.departmentIds&&acc.departmentIds.length)?acc.departmentIds:(acc.departmentId?[acc.departmentId]:[]);
    depts=own.length?own:[null];
  }
  const keySet=[]; const seen={}; let scope='none'; const layout={};
  // 'layout' (migrate-v37) and 'user_id' (migrate-v52) are each optional
  // columns an org's tenant DB may not have migrated yet — probed once and
  // remembered, same reasoning for both: a control-DB org missing one must
  // still get a paramKeys answer from every OTHER tier, not a 503 over a
  // column this response does not strictly need. hasUserCol also controls
  // whether "AND user_id IS NULL" is appended to a query at all — appending
  // it unconditionally would 500 every lookup on an org that has not run
  // migrate-v52, since the column would not exist to filter on.
  let hasLayout=true, hasUserCol=true;
  // Every SELECT in this handler goes through here so the two probes stay
  // consistent across the user-tier check and the department loop below —
  // discovering "no layout column" while resolving the user tier must not
  // make the department loop re-discover it the hard way a second time.
  const q1=async(where,args)=>{
    for(;;){
      const userClause=hasUserCol?" AND user_id IS NULL":"";
      const col=hasLayout?"param_key,layout":"param_key";
      try{
        const[r]=await pool.query("SELECT "+col+" FROM display_params WHERE org_id=? AND domain=? AND "+where+userClause+" ORDER BY position, param_key",[orgId,domain].concat(args));
        return r;
      }catch(e2){
        const em2=String(e2&&e2.message||'');
        if(hasLayout && em2.indexOf('layout')>=0){ hasLayout=false; continue; }
        if(hasUserCol && em2.indexOf('user_id')>=0){ hasUserCol=false; continue; }
        throw e2;
      }
    }
  };
  // Same as q1 but for the user-tier check itself, which filters BY user_id
  // rather than excluding it — a distinct query shape, so it takes the
  // WHERE clause pre-built rather than appending the exclusion q1 always adds.
  const q2=async(where,args)=>{
    for(;;){
      const col=hasLayout?"param_key,layout":"param_key";
      try{
        const[r]=await pool.query("SELECT "+col+" FROM display_params WHERE org_id=? AND domain=? AND "+where+" ORDER BY position, param_key",[orgId,domain].concat(args));
        return r;
      }catch(e2){
        const em2=String(e2&&e2.message||'');
        if(hasLayout && em2.indexOf('layout')>=0){ hasLayout=false; continue; }
        if(em2.indexOf('user_id')>=0) return []; // migrate-v52 not applied — no per-user rows possible
        throw e2;
      }
    }
  };
  try{
    // Per-person override (v52), checked once before the department loop —
    // it is the most specific scope there is, narrower than any department
    // since it names an individual rather than a team, and is meant to cut
    // ACROSS departments rather than narrow one (see migrate-v52.sql). Admins
    // are exempt for their OWN view here for the same reason they are exempt
    // from department scoping just below: this endpoint answers "what does
    // MY dashboard show", and an admin's own view has never been department-
    // or person-restricted — only what the picker asks it to preview is.
    if(au.role!=='admin' && au.role!=='superadmin' && au.userId){
      const utries=[];
      if(nodeId) utries.push(['node+user',"node_id=? AND user_id=?",[nodeId,au.userId]]);
                 utries.push(['org+user',"node_id IS NULL AND user_id=?",[au.userId]]);
      for(const[label,where,args] of utries){
        const r=await q2(where,args);
        if(r.length){
          for(const x of r){ if(!seen[x.param_key]){ seen[x.param_key]=1; keySet.push(x.param_key); layout[x.param_key]=x.layout||'card'; } }
          if(scope==='none'||scope===label) scope=label; else scope='mixed';
          break;
        }
      }
    }
    // Per department, the most specific configured set wins; nothing configured
    // at any level for that department means it inherits the org-wide row, and
    // if that is absent too the department simply contributes nothing.
    //
    // Every tier here goes through q1, which appends "AND user_id IS NULL"
    // (when the column exists) — without it, a row the user-tier check above
    // already resolves more specifically (department_id IS NULL, user_id SET)
    // would ALSO satisfy "org" here, since these tries have no way to exclude
    // a non-null user_id on their own. Left unfiltered, a person's own
    // personal override would leak into every OTHER member of their
    // department's "org default" view too.
    for(const d of depts){
      const tries=[];
      if(nodeId&&d) tries.push(['node+dept',"node_id=? AND department_id=?",[nodeId,d]]);
      if(nodeId)    tries.push(['node',"node_id=? AND department_id IS NULL",[nodeId]]);
      if(d)         tries.push(['org+dept',"node_id IS NULL AND department_id=?",[d]]);
                    tries.push(['org',"node_id IS NULL AND department_id IS NULL",[]]);
      for(const[label,where,args] of tries){
        const r=await q1(where,args);
        if(r.length){
          // Union across the caller's departments, most-permissive — the same
          // rule product access uses for a user who belongs to more than one.
          for(const x of r){ if(!seen[x.param_key]){ seen[x.param_key]=1; keySet.push(x.param_key); layout[x.param_key]=x.layout||'card'; } }
          if(scope==='none'||scope===label) scope=label; else scope='mixed';
          break;
        }
      }
    }
  }catch(e){
    const em=String(e&&e.message||'');
    if(em.indexOf('display_params')<0 && em.indexOf('department_id')<0 && em.indexOf('user_id')<0) throw e;
    node.warn('display_params scope column missing (migrate-v26/v28/v52 not fully applied yet)');
  }
  msg.headers=__CORS; msg.payload={ domain, nodeId, departmentId: asked, scope, paramKeys: keySet, layout }; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/param-labels?domain=&nodeId= — admin-editable display
// names for MQTT parameter keys (migrate-v34).
//
// `labels` is the RESOLVED map every reader renders from: the org-wide default
// for the product, with this device's own overrides layered on top. `own` is
// only the rows at the exact scope the editor is about to write, so the picker
// can tell an inherited name from one this device set itself — the same
// distinction display_params needed, and for the same reason.
//
// Readable by any org member (policy 'org'): a viewer has to render the same
// names the admin configured, or the two roles are looking at different
// dashboards again.
const plGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const q=msg.req.query||{}; const domain=String(q.domain||''); const nodeId=q.nodeId?String(q.nodeId):null;
(async()=>{
  const labels={}, own={};
  try{
    const[orgRows]=await pool.query("SELECT param_key,label FROM param_labels WHERE org_id=? AND domain=? AND node_id IS NULL",[orgId,domain]);
    for(const r of orgRows) labels[r.param_key]=r.label;
    if(nodeId){
      const[nodeRows]=await pool.query("SELECT param_key,label FROM param_labels WHERE org_id=? AND domain=? AND node_id=?",[orgId,domain,nodeId]);
      // Node override wins over the org-wide name for the same key.
      for(const r of nodeRows){ labels[r.param_key]=r.label; own[r.param_key]=r.label; }
    } else {
      for(const r of orgRows) own[r.param_key]=r.label;
    }
  }catch(e){
    // Not yet migrated is "no custom names", not a server error — every reader
    // then falls back to the schema label and the raw key, exactly as before.
    if(String(e&&e.message||'').indexOf('param_labels')<0) throw e;
    msg.headers=__CORS; msg.payload={domain,nodeId,labels:{},own:{},pending:'migrate-v34'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={domain,nodeId,labels,own}; node.send(msg);
})()` + bbErr

// PUT /api/orgs/:orgId/param-labels {domain,nodeId,labels:{key:label}}
// Per-KEY upsert, not a whole-scope replace: the picker sends only the keys it
// showed, and a key the admin never touched must keep whatever name it had.
// An empty/blank value deletes that row, which is how a name is reverted to the
// built-in schema label rather than being stored as an empty string that would
// render a nameless tile.
const plPutFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{}; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const domain=String(b.domain||'');
// Same target shape as dpPutFunc: a list of devices, one device, or the
// org-wide default. Renaming a parameter usually belongs to the same set of
// devices whose display list was just changed, so both endpoints take it.
const nodeIds = Array.isArray(b.nodeIds)
  ? b.nodeIds.map(String).filter(Boolean)
  : (b.nodeId ? [String(b.nodeId)] : [null]);
const labels=(b.labels&&typeof b.labels==='object')?b.labels:{};
if(!domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'domain required'};return msg;}
(async()=>{
  // Every target validated before any write — a half-applied rename across a
  // multi-device save leaves the fleet inconsistent with no way to tell where.
  for(const nid of nodeIds){
    if(!nid) continue;
    // Never let one org name a parameter on another org's device.
    const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[nid]);
    if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error+' ('+nid+')'};node.send(msg);return;}
  }
  let set=0, cleared=0;
  try{
    for(const nodeId of nodeIds){
    const where=nodeId?"node_id=?":"node_id IS NULL";
    for(const k of Object.keys(labels)){
      const key=String(k).slice(0,64); if(!key) continue;
      const v=labels[k]==null?'':String(labels[k]).trim().slice(0,120);
      const args=[orgId,domain,key]; if(nodeId) args.splice(2,0,nodeId);
      if(!v){
        await pool.query("DELETE FROM param_labels WHERE org_id=? AND domain=? AND "+where+" AND param_key=?",args);
        cleared++;
      } else {
        await pool.query("INSERT INTO param_labels (org_id,domain,node_id,param_key,label,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),updated_by=VALUES(updated_by)",
          [orgId,domain,nodeId,key,v,au.name||au.userId||null]);
        set++;
      }
    }
    }
  }catch(e){
    if(String(e&&e.message||'').indexOf('param_labels')<0) throw e;
    msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'custom parameter names need migrate-v34 — run the migration first'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={ok:true,domain,nodeIds,set,cleared,devices:nodeIds.length}; node.send(msg);
})()` + bbErr

const dpPutFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{}; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const domain=String(b.domain||'');
// Targets. \`nodeIds\` (an explicit list of devices) is the shape the picker
// sends now: on an ETERNITY fleet every transformer can publish a DIFFERENT
// MQTT payload depending on its spec, so "this device" and "every device in
// the organization" were the wrong two choices — the useful answer is usually
// "these four, which are the same model". A single \`nodeId\` still works, and
// neither key at all still means the org-wide default row.
const nodeIds = Array.isArray(b.nodeIds)
  ? b.nodeIds.map(String).filter(Boolean)
  : (b.nodeId ? [String(b.nodeId)] : [null]);
// null/absent = the org-wide set every department inherits.
const deptId=b.departmentId?String(b.departmentId):null;
// "Limit to specific people" (migrate-v52) — a set of individual user ids,
// mutually exclusive with deptId for this save: naming people is meant to
// cut ACROSS departments, not narrow one, so a non-empty userIds is what
// "who sees this" actually means for this write and deptId is ignored.
const userIds=Array.isArray(b.userIds)?b.userIds.map(String).filter(Boolean):[];
const keys=Array.isArray(b.paramKeys)?b.paramKeys.map(String).filter(Boolean):[];
// Per-key card-vs-list choice (migrate-v37). Any key with no entry — every
// caller before this existed, and any key the admin never touched in the
// picker — defaults to 'card', so an old client that only ever sent
// paramKeys keeps behaving exactly as it did before layout existed.
const layoutIn=(b.layout&&typeof b.layout==='object')?b.layout:{};
const layoutOf=(k)=>String(layoutIn[k])==='list'?'list':'card';
if(!domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'domain required'};return msg;}
(async()=>{
  // Check EVERY target before writing ANY of them: a partial save across a
  // multi-device apply is worse than a clean refusal, because the admin has no
  // way to tell which half landed.
  for(const nid of nodeIds){
    if(!nid) continue;
    // Never let one org point a selection at another org's device.
    const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[nid]);
    if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error+' ('+nid+')'};node.send(msg);return;}
  }
  if(userIds.length){
    // Same reason as the department check below: an id from another tenant
    // would otherwise let an admin write a policy naming someone outside
    // their organization. Every target validated before any write, same as
    // the node check above.
    const cpool=global.get('pool');
    for(const uid of userIds){
      const[u]=await cpool.query("SELECT id FROM users WHERE id=? AND org_id=?",[uid,orgId]);
      if(!u.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'user not found in this organization ('+uid+')'};node.send(msg);return;}
    }
  } else if(deptId){
    // Same reason: a department id from another tenant would otherwise let an
    // admin write a policy into an org that is not theirs.
    const cpool=global.get('pool');
    const[d]=await cpool.query("SELECT id FROM departments WHERE id=? AND org_id=?",[deptId,orgId]);
    if(!d.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'department not found in this organization'};node.send(msg);return;}
  }
  // "Who sees this" targets for this save: either the SET of specific people
  // (department_id stays NULL for each — see userIds' comment above), or the
  // single department/org-wide row exactly as before v52.
  const whoTargets=userIds.length ? userIds.map((uid)=>({deptId:null,userId:uid})) : [{deptId,userId:null}];
  try{
    for(const nodeId of nodeIds){
      for(const who of whoTargets){
      // Replace exactly ONE scope per target. Saving the Maintenance set must
      // not wipe the org-wide set every other department inherits, and vice
      // versa — applying to four devices must not touch the other forty, and
      // (v52) naming three specific people must not touch each other's rows.
      const userCond=who.userId?"user_id=?":"user_id IS NULL";
      const where=(nodeId?"node_id=?":"node_id IS NULL")
        +" AND "+(who.deptId?"department_id=?":"department_id IS NULL")
        +" AND "+userCond;
      const args=[orgId,domain]; if(nodeId) args.push(nodeId); if(who.deptId) args.push(who.deptId); if(who.userId) args.push(who.userId);
      try{
        await pool.query("DELETE FROM display_params WHERE org_id=? AND domain=? AND "+where,args);
      }catch(e1){
        const em1=String(e1&&e1.message||'');
        // A specific-people target has nothing to fall back to — the column
        // naming who this row belongs to is exactly what is missing.
        if(em1.indexOf('user_id')<0 || who.userId) throw e1;
        // migrate-v52 not applied and this is a department/org-wide target
        // (who.userId is null): drop the "AND user_id IS NULL" clause the
        // column cannot support yet and delete on node/department alone —
        // there is nothing scoped to a specific person to accidentally catch,
        // since no such row could exist without the column in the first place.
        const where2=(nodeId?"node_id=?":"node_id IS NULL")+" AND "+(who.deptId?"department_id=?":"department_id IS NULL");
        await pool.query("DELETE FROM display_params WHERE org_id=? AND domain=? AND "+where2,[orgId,domain].concat(nodeId?[nodeId]:[]).concat(who.deptId?[who.deptId]:[]));
      }
      let i=0;
      for(const k of keys){
        const pos=i++;
        let inserted=false;
        // Tier 1: full row, including user_id (migrate-v52) and layout (v37).
        try{
          await pool.query("INSERT IGNORE INTO display_params (org_id,domain,node_id,department_id,user_id,param_key,position,layout) VALUES (?,?,?,?,?,?,?,?)",[orgId,domain,nodeId,who.deptId,who.userId,k,pos,layoutOf(k)]);
          inserted=true;
        }catch(e2){
          const em2=String(e2&&e2.message||'');
          if(em2.indexOf('layout')<0 && em2.indexOf('user_id')<0) throw e2;
          // A specific-people save cannot degrade past this tier — there is
          // nothing else to scope it to, so migrate-v52 is genuinely required.
          if(em2.indexOf('user_id')>=0 && who.userId) throw e2;
        }
        // Tier 2: no user_id column — fine here, since who.userId is null
        // whenever this tier is reached (department/org-wide save).
        if(!inserted){
          try{
            await pool.query("INSERT IGNORE INTO display_params (org_id,domain,node_id,department_id,param_key,position,layout) VALUES (?,?,?,?,?,?,?)",[orgId,domain,nodeId,who.deptId,k,pos,layoutOf(k)]);
            inserted=true;
          }catch(e3){
            if(String(e3&&e3.message||'').indexOf('layout')<0) throw e3;
          }
        }
        // Tier 3: neither user_id nor layout exists yet (pre-v37 org).
        if(!inserted){
          await pool.query("INSERT IGNORE INTO display_params (org_id,domain,node_id,department_id,param_key,position) VALUES (?,?,?,?,?,?)",[orgId,domain,nodeId,who.deptId,k,pos]);
        }
      }
      }
    }
  }catch(e){
    const em=String(e&&e.message||'');
    if(em.indexOf('display_params')<0 && em.indexOf('department_id')<0 && em.indexOf('user_id')<0) throw e;
    const needsV52=em.indexOf('user_id')>=0;
    msg.headers=__CORS; msg.statusCode=503;
    msg.payload={error: needsV52
      ? 'limiting to specific people needs migrate-v52 — run the migration first'
      : 'department-scoped parameter display needs migrate-v26 and v28 — run the migrations first'};
    node.send(msg); return;
  }
  // Clearing the list restores "show everything" rather than hiding the page.
  msg.headers=__CORS; msg.payload={ok:true, domain, nodeIds, departmentId:deptId, userIds, count:keys.length, devices:nodeIds.length}; node.send(msg);
})()` + bbErr


// GET /api/me/access — what the SIGNED-IN user may see. The Dashboard View
// Permission tab stored a policy (department_themes) that nothing ever read, so
// a viewer's navigation was identical no matter what the admin toggled.
//
// Themes are unioned across ALL the user's departments: joining a second team
// must never remove a menu the first one granted.
//
// An empty union means "no policy configured", NOT "hide everything". Nobody has
// set these yet, so a fail-closed reading would blank the navigation of every
// existing viewer the moment this deploys — and hiding every dashboard from a
// department is not a configuration anyone wants anyway.
// levels (per-domain 'none'/'view'/'manage') delegates to accessFor() — the
// SAME helper /api/fleet's visibility filter already trusts — instead of a
// second, independent computation, so "can I see this device" (server-side,
// via fleet/node visibility) and "what can I do with it" (this endpoint,
// consumed client-side by pages that used to ask the mock viewer.ts instead
// of the signed-in session) can never disagree with each other.
const meAccessFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const uid=au.userId||'';
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'authentication required'};return msg;}
(async()=>{
  const acc = await global.get('accessFor')(uid);
  let themeIds=[];
  // An admin is not scoped by a department policy they themselves author.
  if(acc.role!=='admin' && acc.role!=='superadmin' && acc.departmentIds.length){
    try{
      const ph=acc.departmentIds.map(()=>'?').join(',');
      const[t]=await pool.query("SELECT DISTINCT theme_id FROM department_themes WHERE department_id IN ("+ph+")",acc.departmentIds);
      themeIds=t.map(x=>x.theme_id);
    }catch(e){ if(String(e&&e.message||'').indexOf('department_themes')<0) throw e; }
  }
  msg.headers=__CORS; msg.payload={ userId:uid, orgId:acc.orgId, role:acc.role, departmentIds:acc.departmentIds, themeIds, levels:acc.levels }; node.send(msg);
})()` + bbErr

// --- Org-wide notification channels -----------------------------------------
// notification_channels has always been READ by notify() to route an org's
// alerts, but nothing could ever write it — there was no endpoint at all, so the
// Alarm & Notify screen edited local state and saved nothing. Per-user channels
// (user_prefs, via /api/me/config) were the only ones that worked.
// resolvePool, NOT the control pool: notify() reads notification_channels with
// resolvePool(e.orgId), so under TENANT_DB_MODE an org on its own database would
// have had its channels written to iothub and read back from iothub_<org> — the
// screen would save happily and no org-wide alert would ever be delivered. For
// org-1/2/3 (pinned to the control pool) this resolves to the same connection.
// ?departmentId=<id> reads that department's OWN channel set; omitted reads
// the org-level one (department_id IS NULL).
//
// notify() has always routed on "department_id IS NULL OR department_id=?"
// with the alarm's owning department — but nothing could ever CREATE a
// non-NULL row: both this handler and the Express one hardcoded NULL on
// insert and filtered to NULL on read, and the UI had no department control.
// So "Owning department decides where the alarm goes" was true of the routing
// query and false of the product: every alarm fell through to the org-level
// channels no matter which department owned the device. This is the missing
// half — the routing side already worked.
const chGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const dept=(msg.req.query&&msg.req.query.departmentId)||null;
const uid=(msg.req.query&&msg.req.query.userId)||null;
const fetchAll=(msg.req.query&&String(msg.req.query.all)==='true');
(async()=>{
  let r = [];
  try {
    r = fetchAll
      ? (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id,user_id FROM notification_channels WHERE org_id=? ORDER BY channel",[orgId]))[0]
      : (uid
          ? (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id,user_id FROM notification_channels WHERE org_id=? AND user_id=? ORDER BY channel",[orgId,uid]))[0]
          : (dept
              ? (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id,user_id FROM notification_channels WHERE org_id=? AND department_id=? AND (user_id IS NULL OR user_id='') ORDER BY channel",[orgId,dept]))[0]
              : (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id,user_id FROM notification_channels WHERE org_id=? AND department_id IS NULL AND (user_id IS NULL OR user_id='') ORDER BY channel",[orgId]))[0]));
  } catch(e) {
    r = fetchAll
      ? (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id FROM notification_channels WHERE org_id=? ORDER BY channel",[orgId]))[0]
      : (dept
          ? (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id FROM notification_channels WHERE org_id=? AND department_id=? ORDER BY channel",[orgId,dept]))[0]
          : (await pool.query("SELECT id,channel,target,min_severity,enabled,department_id FROM notification_channels WHERE org_id=? AND department_id IS NULL ORDER BY channel",[orgId]))[0]);
  }
  msg.headers=__CORS; msg.payload=r; node.send(msg);
})()` + bbErr

const chPutFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{}; const pool=global.get('resolvePool')(orgId);
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const list=Array.isArray(b.channels)?b.channels:[];
const VALID=['email','line','telegram','googlechat'];
for(const c of list){ if(VALID.indexOf(String(c.channel||c.id))<0){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'unknown channel '+(c.channel||c.id)};return msg;} }
const dept=(b.departmentId===''||b.departmentId===undefined||b.departmentId===null)?null:String(b.departmentId);
const uid=(b.userId===''||b.userId===undefined||b.userId===null)?null:String(b.userId);
(async()=>{
  if(dept){
    const[d]=await global.get('pool').query("SELECT id FROM departments WHERE id=? AND org_id=?",[dept,orgId]);
    if(!d.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'department is not in this organization'};node.send(msg);return;}
  }
  if(uid){
    const[u]=await global.get('pool').query("SELECT id FROM users WHERE id=? AND org_id=?",[uid,orgId]);
    if(!u.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'user is not in this organization'};node.send(msg);return;}
  }
  if(uid){
    try {
      await pool.query("DELETE FROM notification_channels WHERE org_id=? AND user_id=?",[orgId,uid]);
      for(const c of list){
        await pool.query("INSERT INTO notification_channels (org_id,department_id,user_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?,?)",
          [orgId, null, uid, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
      }
    } catch(e) {
      if(String(e&&e.message||'').indexOf('user_id')>=0){
        await pool.query("ALTER TABLE notification_channels ADD COLUMN user_id VARCHAR(64) NULL AFTER department_id");
        await pool.query("DELETE FROM notification_channels WHERE org_id=? AND user_id=?",[orgId,uid]);
        for(const c of list){
          await pool.query("INSERT INTO notification_channels (org_id,department_id,user_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?,?)",
            [orgId, null, uid, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
        }
      } else throw e;
    }
  } else if(dept){
    try {
      await pool.query("DELETE FROM notification_channels WHERE org_id=? AND department_id=? AND (user_id IS NULL OR user_id='')",[orgId,dept]);
    } catch(e){
      await pool.query("DELETE FROM notification_channels WHERE org_id=? AND department_id=?",[orgId,dept]);
    }
    for(const c of list){
      try {
        await pool.query("INSERT INTO notification_channels (org_id,department_id,user_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?,?)",
          [orgId, dept, null, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
      } catch(e){
        await pool.query("INSERT INTO notification_channels (org_id,department_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?)",
          [orgId, dept, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
      }
    }
  } else {
    try {
      await pool.query("DELETE FROM notification_channels WHERE org_id=? AND department_id IS NULL AND (user_id IS NULL OR user_id='')",[orgId]);
    } catch(e){
      await pool.query("DELETE FROM notification_channels WHERE org_id=? AND department_id IS NULL",[orgId]);
    }
    for(const c of list){
      try {
        await pool.query("INSERT INTO notification_channels (org_id,department_id,user_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?,?)",
          [orgId, null, null, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
      } catch(e){
        await pool.query("INSERT INTO notification_channels (org_id,department_id,channel,target,min_severity,enabled) VALUES (?,?,?,?,?,?)",
          [orgId, null, String(c.channel||c.id), c.target||null, (c.minSeverity||c.min_severity)==='CRITICAL'?'CRITICAL':'WARNING', c.enabled===false?0:1]);
      }
    }
  }
  msg.headers=__CORS; msg.payload={ok:true,count:list.length,departmentId:dept,userId:uid}; node.send(msg);
})()` + bbErr

// --- Org Email Alarm Template Config (GET / PUT / TEST) --------------------
const emailTplGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const pool=global.get('pool');
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  let orgName = orgId;
  try {
    const [orgRows] = await pool.query("SELECT name FROM organizations WHERE id=?", [orgId]);
    if (orgRows.length && orgRows[0].name) orgName = orgRows[0].name;
  } catch(e){}
  let template = null;
  try {
    const [r] = await pool.query("SELECT sval FROM platform_settings WHERE skey=?", ['email_template.' + orgId]);
    if(r.length && r[0].sval) template = JSON.parse(r[0].sval);
  } catch(e){}
  if(!template) {
    template = {
      subjectTemplate: '[{{severity}}] ' + orgName + ' Alert: {{device_name}} - {{param_label}} ({{category}})',
      customHeaderNote: 'Attention: Automated priority alert triggered by ' + orgName + ' Industrial IoT Monitoring System.',
      customFooterSop: 'SOP Protocol: For Critical Alarms, contact the Substation Control Room at 02-xxx-xxxx immediately.',
      includeActionLink: true,
      format: 'html',
    };
  }
  msg.headers=__CORS; msg.payload={ ...template, orgName }; node.send(msg);
})()` + bbErr

const emailTplPutFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{}; const pool=global.get('pool');
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  const sval = JSON.stringify({
    subjectTemplate: String(b.subjectTemplate || '[{{severity}}] {{org_name}} Alert: {{device_name}} - {{param_label}} ({{category}})').slice(0, 300),
    customHeaderNote: String(b.customHeaderNote || '').slice(0, 500),
    customFooterSop: String(b.customFooterSop || '').slice(0, 1000),
    includeActionLink: b.includeActionLink !== false,
    format: b.format === 'text' ? 'text' : 'html',
  });
  await pool.query("INSERT INTO platform_settings (skey, sval) VALUES (?, ?) ON DUPLICATE KEY UPDATE sval=VALUES(sval)", ['email_template.' + orgId, sval]);
  msg.headers=__CORS; msg.payload={ok:true, template: JSON.parse(sval)}; node.send(msg);
})()` + bbErr

const emailTplTestFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{}; const pool=global.get('pool');
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  // The JWT carries {userId, orgId, role} and nothing else, so the original
  // 'au.email' fallback here was dead code — targetEmail was ALWAYS whatever
  // the caller put in the body, unvalidated. Sending platform-branded mail,
  // with a caller-supplied subject/header/footer, to any address on the
  // internet is a phishing relay wearing this platform's reputation, so the
  // recipient now has to be a real person: the requester themselves, or
  // another member of the same organization.
  let requesterEmail = '';
  try {
    const [me] = await pool.query("SELECT email FROM users WHERE id=?", [au.userId]);
    if (me.length) requesterEmail = String(me[0].email || '').trim();
  } catch(e){}
  const requested = String(b.targetEmail || '').trim();
  let targetEmail = requesterEmail;
  if (requested && requested.toLowerCase() !== requesterEmail.toLowerCase()) {
    const [mate] = await pool.query("SELECT id FROM users WHERE email=? AND org_id=?", [requested, orgId]);
    if (!mate.length) {
      msg.headers=__CORS; msg.statusCode=403;
      msg.payload={error:'Test emails can only be sent to a member of this organization'};
      return msg;
    }
    targetEmail = requested;
  }
  if(!targetEmail) { msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'Your account has no email address on file to send the test to'}; return msg; }
  const mc = await global.get('mailConfig')();
  if(!mc.transport) { msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'SMTP server is not configured in platform settings'}; return msg; }

  let orgName = orgId;
  try {
    const [orgRows] = await pool.query("SELECT name FROM organizations WHERE id=?", [orgId]);
    if (orgRows.length && orgRows[0].name) orgName = orgRows[0].name;
  } catch(e){}

  const tpl = {
    subjectTemplate: String(b.subjectTemplate || '[{{severity}}] ' + orgName + ' Alert: {{device_name}} - {{param_label}} ({{category}})'),
    customHeaderNote: String(b.customHeaderNote || ''),
    customFooterSop: String(b.customFooterSop || ''),
    includeActionLink: b.includeActionLink !== false,
    format: b.format === 'text' ? 'text' : 'html',
  };

  // Mock simulation variables for testing
  const sampleData = {
    device_name: 'TR-SUBSTATION-01',
    node_id: 'TR-SUBSTATION-01',
    org_id: orgId,
    org_name: orgName,
    severity: 'CRITICAL',
    category: 'Thermal & Oil',
    param_label: 'Top Oil Temperature',
    param_key: 'oilTemp',
    value: '92.5°C',
    threshold: '90.0°C',
    risk_insight: 'Winding / insulation degradation risk (>90°C)',
    time: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }) + ' (Asia/Bangkok)',
    link: mc.frontendUrl + '/admin/nodes/detail/?id=TR-SUBSTATION-01',
    sevEmoji: '🔴',
  };

  const render = (s) => String(s || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => sampleData[k] ?? '');
  const subject = '[TEST] ' + render(tpl.subjectTemplate);
  // The 'const text =' that owned the lines below had gone missing, leaving a
  // dangling '+ ...' expression statement — legal JS that evaluates and throws
  // the result away, so nothing declared 'text' while sendMail still passed
  // it. Every call therefore died with "text is not defined" and this endpoint
  // could never actually deliver a test message. A plain-text alternative is
  // also not optional in a real mail: clients that refuse HTML, and spam
  // filters that score multipart/alternative, both want it.
  const text = 'ONEOPS ' + sampleData.severity + ' alert (TEST SIMULATION)\\n\\n'
    + 'Device: ' + sampleData.device_name + ' (' + sampleData.node_id + ')\\n'
    + 'Organization: ' + sampleData.org_name + '\\n'
    + 'Category: ' + sampleData.category + '\\n'
    + 'Parameter: ' + sampleData.param_label + '\\n'
    + 'Value: ' + sampleData.value + ' (threshold ' + sampleData.threshold + ')\\n'
    + 'Time: ' + sampleData.time + '\\n'
    + 'Risk: ' + sampleData.risk_insight + '\\n'
    + (tpl.customHeaderNote ? '\\nNotice: ' + render(tpl.customHeaderNote) + '\\n' : '')
    + (tpl.customFooterSop ? '\\nSOP Protocol: ' + render(tpl.customFooterSop) + '\\n' : '')
    + (tpl.includeActionLink ? '\\nOpen device: ' + sampleData.link + '\\n' : '');

  const html = '<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"></head>'
    + '<body style=\"font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; background-color: #0a0e1a; margin: 0; padding: 24px; color: #f1f5f9;\">'
    + '<div style=\"max-width: 600px; margin: 0 auto; background-color: #0d1117; border: 1px solid #1e2433; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.5);\">'
    + '<div style=\"background: #ef4444; padding: 18px 24px;\">'
    + '<div style=\"font-size: 11px; font-weight: 700; text-transform: uppercase; color: #ffffff; letter-spacing: 0.05em;\">CRITICAL · ' + sampleData.category + ' (TEST SIMULATION)</div>'
    + '<div style=\"font-size: 20px; font-weight: 800; color: #ffffff; margin-top: 4px;\">' + sampleData.param_label + '</div>'
    + '</div>'
    + (tpl.customHeaderNote ? '<div style=\"background-color: #1e1b4b; border-bottom: 1px solid #312e81; padding: 12px 24px; font-size: 13px; color: #c7d2fe;\">📌 <strong>Notice:</strong> ' + render(tpl.customHeaderNote) + '</div>' : '')
    + '<div style=\"padding: 24px;\">'
    + '<table style=\"width: 100%; border-collapse: collapse; font-size: 13px;\">'
    + '<tbody>'
    + '<tr style=\"border-bottom: 1px solid #1e2433;\"><td style=\"padding: 10px 0; color: #64748b; width: 140px;\">Device / Asset</td><td style=\"padding: 10px 0; color: #ffffff; font-weight: 600; font-family: monospace;\">' + sampleData.device_name + '</td></tr>'
    + '<tr style=\"border-bottom: 1px solid #1e2433;\"><td style=\"padding: 10px 0; color: #64748b;\">Category</td><td style=\"padding: 10px 0; color: #94a3b8;\">' + sampleData.category + '</td></tr>'
    + '<tr style=\"border-bottom: 1px solid #1e2433;\"><td style=\"padding: 10px 0; color: #64748b;\">Live Value</td><td style=\"padding: 10px 0; color: #ef4444; font-weight: 700; font-size: 15px;\">' + sampleData.value + '</td></tr>'
    + '<tr style=\"border-bottom: 1px solid #1e2433;\"><td style=\"padding: 10px 0; color: #64748b;\">Alarm Limit</td><td style=\"padding: 10px 0; color: #cbd5e1;\">' + sampleData.threshold + '</td></tr>'
    + '<tr style=\"border-bottom: 1px solid #1e2433;\"><td style=\"padding: 10px 0; color: #64748b;\">Risk &amp; Condition</td><td style=\"padding: 10px 0; color: #f59e0b; font-weight: 600;\">💡 ' + sampleData.risk_insight + '</td></tr>'
    + '<tr><td style=\"padding: 10px 0; color: #64748b;\">Timestamp</td><td style=\"padding: 10px 0; color: #94a3b8;\">' + sampleData.time + '</td></tr>'
    + '</tbody></table>'
    + (tpl.customFooterSop ? '<div style=\"margin-top: 20px; background-color: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 14px; font-size: 13px; color: #fca5a5;\"><div style=\"font-weight: 700; color: #ef4444; margin-bottom: 4px;\">⚠️ Emergency Response / SOP Protocol:</div><div style=\"line-height: 1.5; color: #fecaca;\">' + render(tpl.customFooterSop) + '</div></div>' : '')
    + (tpl.includeActionLink ? '<div style=\"margin-top: 24px; text-align: center;\"><a href=\"' + sampleData.link + '\" style=\"display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 2px 10px rgba(99, 102, 241, 0.3);\">Open Device &amp; Acknowledge</a></div>' : '')
    + '</div>'
    + '<div style=\"background-color: #070a12; border-top: 1px solid #1e2433; padding: 14px 24px; font-size: 11px; color: #475569; text-align: center;\">Test Notification from ONEOPS Unified Industrial Monitoring Platform.</div>'
    + '</div></body></html>';

  await mc.transport.sendMail({
    from: mc.from,
    to: targetEmail,
    subject,
    text,
    html: tpl.format === 'text' ? undefined : html,
  });

  msg.headers=__CORS; msg.payload={ok:true, sentTo: targetEmail, subject}; node.send(msg);
})()` + bbErr

// --- Which themes an ORGANIZATION is entitled to (superadmin-owned) ----------
// This lived in a frontend const (orgThemes.ts) listing org-1/2/3 and nothing
// else, so every other organization fell back to ['th-overview'] — its admin
// could allocate exactly one theme no matter what the superadmin intended — and
// the superadmin's own save mutated a module-level object that a page reload
// discarded. The Dashboard View Permission tab was reading an entitlement that
// nobody could write.
const tgGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  let ids=[];
  try{ const[r]=await pool.query("SELECT theme_id FROM org_theme_grants WHERE org_id=? ORDER BY theme_id",[orgId]); ids=r.map(x=>x.theme_id); }
  catch(e){ if(String(e&&e.message||'').indexOf('org_theme_grants')<0) throw e; node.warn('org_theme_grants missing (migrate-v28 not applied yet)'); }
  msg.headers=__CORS; msg.payload={orgId, themeIds: ids}; node.send(msg);
})()` + bbErr

// Superadmin only — an org admin allocating themes to departments must not be
// able to widen what their own organization is licensed for.
const tgPutFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const b=msg.payload||{};
const ids=Array.isArray(b.themeIds)?b.themeIds.map(String).filter(Boolean):[];
(async()=>{
  try{
    await pool.query("DELETE FROM org_theme_grants WHERE org_id=?",[orgId]);
    for(const t of ids){ await pool.query("INSERT IGNORE INTO org_theme_grants (org_id,theme_id) VALUES (?,?)",[orgId,t]); }
    // Revoking a theme org-wide must also drop it from every department that had
    // it, or the permission tab would keep handing out a theme the org no longer
    // holds and only the nav filter would (silently) disagree.
    if(ids.length) await pool.query("DELETE FROM department_themes WHERE org_id=? AND theme_id NOT IN (?)",[orgId,ids]);
    else await pool.query("DELETE FROM department_themes WHERE org_id=?",[orgId]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('org_theme_grants')<0) throw e;
    msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'organization theme grants need migrate-v28 — run the migration first'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={ok:true, orgId, count:ids.length}; node.send(msg);
})()` + bbErr

// --- Sites a department may see (migrate-v29) -------------------------------
// The counterpart to department_themes: themes decide WHICH SCREENS a team gets,
// this decides WHICH PLACES. Both are read by the same tab.
const dsGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  let r=[];
  try{ const[x]=await pool.query("SELECT department_id,site_id FROM department_sites WHERE org_id=?",[orgId]); r=x; }
  catch(e){ if(String(e&&e.message||'').indexOf('department_sites')<0) throw e; node.warn('department_sites missing (migrate-v29 not applied yet)'); }
  const by={}; for(const x of r){ (by[x.department_id]=by[x.department_id]||[]).push(x.site_id); }
  msg.headers=__CORS; msg.payload=by; node.send(msg);
})()` + bbErr

const dsPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const deptId=String(b.departmentId||''); const siteIds=Array.isArray(b.siteIds)?b.siteIds.map(String).filter(Boolean):[];
if(!deptId){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'departmentId required'};return msg;}
(async()=>{
  const[d]=await pool.query("SELECT id FROM departments WHERE id=? AND org_id=?",[deptId,orgId]);
  if(!d.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'department not found in this organization'};node.send(msg);return;}
  if(siteIds.length){
    // A site id from another tenant would otherwise grant this department a view
    // into an organization that is not theirs.
    const[s]=await pool.query("SELECT id FROM sites WHERE org_id=? AND id IN (?)",[orgId,siteIds]);
    if(s.length!==siteIds.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'one or more sites are not in this organization'};node.send(msg);return;}
  }
  try{
    await pool.query("DELETE FROM department_sites WHERE department_id=?",[deptId]);
    for(const s of siteIds){ await pool.query("INSERT IGNORE INTO department_sites (department_id,site_id,org_id) VALUES (?,?,?)",[deptId,s,orgId]); }
  }catch(e){
    if(String(e&&e.message||'').indexOf('department_sites')<0) throw e;
    msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'site permissions need migrate-v29 — run the migration first'}; node.send(msg); return;
  }
  // Assigning none removes the restriction rather than blinding the department —
  // see the fail-open note in migrate-v29.sql. Say which it was, because "saved"
  // means two very different things here.
  msg.headers=__CORS; msg.payload={ok:true, departmentId:deptId, count:siteIds.length, restricted:siteIds.length>0}; node.send(msg);
})()` + bbErr

// --- Dashboard themes per department ----------------------------------------
// The Dashboard View Permission tab rendered departments and licensed themes and
// let an admin toggle them, but stored none of it: departments loaded with a
// hardcoded ['th-overview'] and every toggle lived in React state, so a reload
// put it back. The screen described a policy the system did not have.
const dtGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  let r=[];
  // The table arrives with migrate-v23. Before it exists the right answer is an
  // empty policy, not a 500 that blanks the tab.
  try{ const[x]=await pool.query("SELECT department_id,theme_id FROM department_themes WHERE org_id=?",[orgId]); r=x; }
  catch(e){ if(String(e&&e.message||'').indexOf('department_themes')<0) throw e; node.warn('department_themes missing (migrate-v23 not applied yet)'); }
  const by={}; for(const x of r){ (by[x.department_id]=by[x.department_id]||[]).push(x.theme_id); }
  msg.headers=__CORS; msg.payload=by; node.send(msg);
})()` + bbErr

const dtPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const deptId=String(b.departmentId||''); const themes=Array.isArray(b.themeIds)?b.themeIds.map(String):[];
if(!deptId){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'departmentId required'};return msg;}
(async()=>{
  // The department must belong to THIS org, or an admin could grant themes to
  // another tenant's department just by knowing its id.
  const[d]=await pool.query("SELECT id FROM departments WHERE id=? AND org_id=?",[deptId,orgId]);
  if(!d.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'department not found in this organization'};node.send(msg);return;}
  try{
    await pool.query("DELETE FROM department_themes WHERE department_id=?",[deptId]);
    for(const t of themes){ await pool.query("INSERT IGNORE INTO department_themes (department_id,theme_id,org_id) VALUES (?,?,?)",[deptId,t,orgId]); }
  }catch(e){
    if(String(e&&e.message||'').indexOf('department_themes')<0) throw e;
    msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'dashboard view permissions need migrate-v23 — run the migration first'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={ok:true,departmentId:deptId,count:themes.length}; node.send(msg);
})()` + bbErr


// --- Sites (a customer's physical places) + floor-plan georeference ----------
// nodes.site_id existed with nothing to point at: the site list was a frontend
// seed const, identical for every tenant. Floor plans are navigated THROUGH a
// site, so they have to be real rows before any of that can be per-customer.
const sitesGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  // Georeference rides along per floor so the page can convert a pin to a
  // coordinate without a second round trip.
  const[r]=await pool.query("SELECT id,org_id,name,address,lat,lng FROM sites WHERE org_id=? ORDER BY name",[orgId]);
  const[f]=await pool.query("SELECT floor_id,site_id,nw_lat,nw_lng,se_lat,se_lng FROM floorplans WHERE org_id=?",[orgId]);
  // A site-scoped viewer must not even be offered another plant in the picker —
  // the Floor Plans page is navigated THROUGH a site, so the site list IS the
  // access control for it. Admins are never scoped.
  let sites=r, floors=f;
  if(au.role!=='superadmin' && au.role!=='admin'){
    const acc=await global.get('accessFor')(au.userId);
    const vis=global.get('siteVisible');
    sites=r.filter(s=>vis(acc,s.id));
    // A floor plan with no site belongs to no plant in particular; keep it
    // visible for the same reason an unassigned device stays visible.
    floors=f.filter(x=>vis(acc,x.site_id));
  }
  msg.headers=__CORS; msg.payload={sites, floors}; node.send(msg);
})()` + bbErr

const sitesPostFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{
  const id=b.id||'site-'+Date.now();
  await pool.query("INSERT INTO sites (id,org_id,name,address,lat,lng) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),address=VALUES(address),lat=VALUES(lat),lng=VALUES(lng)",[id,orgId,b.name,b.address||null,b.lat??null,b.lng??null]);
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);
})()` + bbErr

const sitesDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM sites WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  // Devices keep running; they just stop being attributed to a place.
  await pool.query("UPDATE nodes SET site_id=NULL WHERE site_id=?",[id]);
  // Drop the site permissions that pointed here too. Leaving them would make a
  // department LOOK restricted to a site that no longer exists — and since an
  // empty grant means "no restriction", a department whose only site was deleted
  // must go back to unrestricted rather than to seeing nothing.
  try{ await pool.query("DELETE FROM department_sites WHERE site_id=?",[id]); }
  catch(e){ if(String(e&&e.message||'').indexOf('department_sites')<0) throw e; }
  await pool.query("DELETE FROM sites WHERE id=?",[id]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})()` + bbErr

// PUT /api/orgs/:orgId/floorplans/:floorId/geo — the real-world corners of a
// floor-plan image, and the site it belongs to. Two corners are enough to make
// pin↔coordinate a linear interpolation both ways.
const fpGeoPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId; const floorId=msg.req.params.floorId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  await pool.query("INSERT INTO floorplans (org_id,floor_id,site_id,nw_lat,nw_lng,se_lat,se_lng) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE site_id=VALUES(site_id),nw_lat=VALUES(nw_lat),nw_lng=VALUES(nw_lng),se_lat=VALUES(se_lat),se_lng=VALUES(se_lng)",
    [orgId,floorId,b.siteId||null,b.nwLat??null,b.nwLng??null,b.seLat??null,b.seLng??null]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/location {lat,lng,siteId} — until now a device's coordinate
// could only be set while APPROVING it, so a transformer pinned on a floor plan
// had nowhere to write the coordinate that pin represents and the GPS map never
// agreed with the layout.
const nodeLocPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const lat=b.lat===null||b.lat===undefined?null:Number(b.lat);
  const lng=b.lng===null||b.lng===undefined?null:Number(b.lng);
  if((lat!==null&&(!isFinite(lat)||lat<-90||lat>90))||(lng!==null&&(!isFinite(lng)||lng<-180||lng>180))){
    msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'lat must be -90..90 and lng -180..180'};node.send(msg);return;
  }
  // Partial update. lat/lng used to be written unconditionally, so a caller that
  // meant "move this device to another site" and sent only siteId also silently
  // set both coordinates to NULL — erasing the pin an admin had placed on the
  // floor plan, which for an ETERNITY transformer IS its location on the map.
  // Sending an explicit null still clears them; omitting the field leaves it.
  const sets=[], vals=[];
  if(b.lat!==undefined){ sets.push('lat=?'); vals.push(lat); }
  if(b.lng!==undefined){ sets.push('lng=?'); vals.push(lng); }
  if(b.siteId!==undefined){ sets.push('site_id=?'); vals.push(b.siteId||null); }
  if(!sets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nothing to update — send lat, lng or siteId'};node.send(msg);return;}
  vals.push(id);
  await pool.query("UPDATE nodes SET "+sets.join(',')+" WHERE id=?",vals);
  // Mirror into the org DB under TENANT_DB_MODE, the way approve does — the
  // fleet reads from there, so writing only the control row would leave the map
  // showing the old pin.
  const opool=global.get('resolvePool')(chk.orgId);
  if(opool!==pool){ try{ await opool.query("UPDATE nodes SET "+sets.join(',')+" WHERE id=?",vals); }catch(e){ node.warn('node location tenant mirror failed for '+id+': '+e.message); } }
  // Echo only the fields this call actually wrote, so a siteId-only update does
  // not report lat/lng: null and read as though it had cleared them.
  const out={ok:true,id};
  if(b.lat!==undefined) out.lat=lat;
  if(b.lng!==undefined) out.lng=lng;
  if(b.siteId!==undefined) out.siteId=b.siteId||null;
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr


// GET /api/nodes/:id/departments — which departments may see this device
// (migrate-v35). `granted` is the stored set; `effective` is what the
// visibility rule actually uses, which falls back to the owning department
// when nothing has been granted, so the UI can show the real current state
// rather than an empty list that would read as "nobody".
const nodeDeptsGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  const[n]=await opool.query("SELECT department_id FROM nodes WHERE id=?",[id]);
  const owner=n.length?n[0].department_id:null;
  let granted=[];
  try{ const[g]=await opool.query("SELECT department_id FROM node_departments WHERE node_id=?",[id]); granted=g.map(x=>x.department_id); }
  catch(e){
    if(String(e&&e.message||'').indexOf('node_departments')<0) throw e;
    msg.headers=__CORS; msg.payload={id,owner,granted:[],effective:owner?[owner]:[],pending:'migrate-v35'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={id,owner,granted,effective:granted.length?granted:(owner?[owner]:[])}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/departments {departmentIds}
// An empty array clears the grants, which returns the device to the owning
// department (or to the whole org if it has none) — it does NOT hide the
// device from everyone. Hiding a device from every department is not a
// configuration anyone wants and would be indistinguishable from the
// unconfigured state a moment after it was set.
const nodeDeptsPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
const ids=Array.isArray(b.departmentIds)?Array.from(new Set(b.departmentIds.map(String).filter(Boolean))):null;
if(!ids){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'departmentIds array required'};return msg;}
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  // Every department must belong to THIS org, or an admin could grant their
  // device to another tenant's department id and that tenant's users would
  // start seeing it.
  if(ids.length){
    const[d]=await pool.query("SELECT id FROM departments WHERE org_id=? AND id IN (?)",[chk.orgId,ids]);
    if(d.length!==ids.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'one or more departments are not in this organization'};node.send(msg);return;}
  }
  const opool=global.get('resolvePool')(chk.orgId);
  try{
    await opool.query("DELETE FROM node_departments WHERE node_id=?",[id]);
    for(const d of ids) await opool.query("INSERT IGNORE INTO node_departments (node_id,department_id,org_id) VALUES (?,?,?)",[id,d,chk.orgId]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_departments')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'per-device department access needs migrate-v35 — run the migration first'};node.send(msg);return;
  }
  msg.headers=__CORS; msg.payload={ok:true,id,departmentIds:ids,count:ids.length}; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/node-visibility — this org's whole per-user device
// policy (migrate-v42), as {userId: [nodeId]}. One indexed read rather than a
// call per user, because both editors need the same map: the device page shows
// which people this device is listed for, and User Management shows which
// devices a person is limited to — two views of one table.
//
// A user ABSENT from the map has no restriction (sees everything their
// department allows); a user PRESENT is limited to exactly the listed devices.
// The UI has to state that difference, so the shape must preserve it — hence a
// map of only the users who actually have rows, never a padded one.
const nodeVisGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
(async()=>{
  const opool=global.get('resolvePool')(orgId);
  const out={};
  try{
    const[r]=await opool.query("SELECT user_id,node_id FROM node_user_visibility WHERE org_id=?",[orgId]);
    for(const x of r) (out[x.user_id]=out[x.user_id]||[]).push(x.node_id);
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_user_visibility')<0) throw e;
    msg.headers=__CORS; msg.payload={byUser:{},pending:'migrate-v42'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={byUser:out}; node.send(msg);
})()` + bbErr

// PUT /api/users/:id/visible-nodes {nodeIds}
// An empty array CLEARS the restriction (back to "everything their department
// allows"), it does not hide every device — the same reasoning as clearing
// node_departments above: "visible to nothing" is not a state anyone wants and
// would be indistinguishable from unconfigured a moment later.
const nodeVisPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const uid=msg.req.params.id; const b=msg.payload||{};
const ids=Array.isArray(b.nodeIds)?Array.from(new Set(b.nodeIds.map(String).filter(Boolean))):null;
if(!ids){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nodeIds array required'};return msg;}
(async()=>{
  // The TARGET USER must be in the caller's own org — otherwise an admin could
  // rewrite another tenant's user's access. users lives in the control DB.
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM users WHERE id=?",[uid]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  // Every node must belong to THAT SAME org. Without this an admin could list
  // another tenant's node id; it would never actually be visible (deptVisible
  // and the org filter both still apply) but it would sit in the table as a
  // misleading grant, and a future widening of these semantics would turn it
  // into a real leak.
  if(ids.length){
    const[n]=await opool.query("SELECT id FROM nodes WHERE org_id=? AND id IN (?)",[chk.orgId,ids]);
    if(n.length!==ids.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'one or more devices are not in this organization'};node.send(msg);return;}
  }
  try{
    await opool.query("DELETE FROM node_user_visibility WHERE user_id=?",[uid]);
    for(const n of ids) await opool.query("INSERT IGNORE INTO node_user_visibility (user_id,node_id,org_id) VALUES (?,?,?)",[uid,n,chk.orgId]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_user_visibility')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'per-user device visibility needs migrate-v42 — run the migration first'};node.send(msg);return;
  }
  global.get('auditLog')(au,'user.visibleNodes',chk.orgId,uid,{count:ids.length});
  msg.headers=__CORS; msg.payload={ok:true,userId:uid,nodeIds:ids,count:ids.length,scoped:ids.length>0}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/profile {name,departmentId} — rename/reassign an already-
// APPROVED device. Device Management (the admin page) used to "save" purely to
// local React state — no endpoint existed for editing anything on an active
// node besides location/nameplate/image — so every edit vanished on refresh;
// this is the missing write path. domain and serial are deliberately NOT
// accepted here: domain is fixed at approval from the device's real MQTT
// topic and the ingest worker parses telemetry against it, so changing it
// post-approval would desync the alarm schema from what the device actually
// sends; serial is derived from the node id (its real MQTT identity) — never
// a value someone types.
const nodeProfilePutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const sets=[], vals=[];
  if(b.name!==undefined){
    const name=String(b.name||'').trim();
    if(!name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name cannot be empty'};node.send(msg);return;}
    sets.push('name=?'); vals.push(name);
  }
  if(b.departmentId!==undefined){
    const dept=b.departmentId||null;
    if(dept){
      const[d]=await pool.query("SELECT id FROM departments WHERE id=? AND org_id=?",[dept,chk.orgId]);
      if(!d.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'department not found in this organization'};node.send(msg);return;}
    }
    sets.push('department_id=?'); vals.push(dept);
  }
  // Second-feed linkage (nodes.merge_into, migrate-v20) AFTER approval. One
  // physical transformer often publishes on two topics — a power meter sending
  // the electrical set and a box sensor sending oil/gas/humidity — and the two
  // arrive as two devices. Approval could already link them ("Second feed of"
  // in Pending Devices), but nothing could link two devices that were ALREADY
  // approved separately, which is the normal case once a site has been running
  // a while. The worker's resolveFeed() then stores both topics' readings under
  // the primary, so the device page shows one asset with every parameter
  // instead of two half-populated ones.
  let mergeChanged=false, mergeTarget=null;
  if(b.mergeInto!==undefined){
    const tgt=b.mergeInto?String(b.mergeInto):null;
    if(tgt===id){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'a device cannot be a second feed of itself'};node.send(msg);return;}
    if(tgt){
      // The target must be a real, active, PRIMARY device in the same org.
      // Refusing a target that is itself a secondary keeps the chain exactly
      // one link deep, which is all resolveFeed() follows — a two-hop chain
      // would silently strand the readings on a middle node.
      let m;
      try{ const[x]=await pool.query("SELECT id FROM nodes WHERE id=? AND org_id=? AND status='active' AND merge_into IS NULL",[tgt,chk.orgId]); m=x; }
      catch(e){
        if(String(e&&e.message||'').indexOf('merge_into')<0) throw e;
        msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'multi-topic merging needs migrate-v20 — run the migration first'};node.send(msg);return;
      }
      if(!m.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'that device is not an active primary device in this organization'};node.send(msg);return;}
      // And this device must not itself be something else's primary, for the
      // same reason in the other direction.
      const[kids]=await pool.query("SELECT id FROM nodes WHERE merge_into=? LIMIT 1",[id]);
      if(kids.length){msg.headers=__CORS;msg.statusCode=409;msg.payload={error:'another device is already a second feed of this one — unlink that first'};node.send(msg);return;}
    }
    sets.push('merge_into=?'); vals.push(tgt);
    mergeChanged=true; mergeTarget=tgt;
  }
  // The Free-Style dashboard's "Open in Grafana" link/embed used to be a
  // per-tab-session text box (FreestyleDashboard's local useState) — nothing
  // saved it, so it reset to blank on every navigation and the button led
  // nowhere. This is the real, admin-set, persisted URL every viewer's
  // Free-Style tab actually reads.
  let grafanaChanged=false;
  if(b.grafanaUrl!==undefined){
    const gu=b.grafanaUrl?String(b.grafanaUrl).trim():null;
    if(gu && gu.length>500){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'grafanaUrl is too long (500 chars max)'};node.send(msg);return;}
    if(gu && gu.toLowerCase().indexOf('http://')!==0 && gu.toLowerCase().indexOf('https://')!==0){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'grafanaUrl must start with http:// or https://'};node.send(msg);return;}
    sets.push('grafana_url=?'); vals.push(gu);
    grafanaChanged=true;
  }
  if(!sets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nothing to update — send name, departmentId, mergeInto or grafanaUrl'};node.send(msg);return;}
  vals.push(id);
  try{ await pool.query("UPDATE nodes SET "+sets.join(',')+" WHERE id=?",vals); }
  catch(e){
    const msgStr=String(e&&e.message||'');
    if(mergeChanged && msgStr.indexOf('merge_into')>=0){
      msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'multi-topic merging needs migrate-v20 — run the migration first'};node.send(msg);return;
    }
    if(grafanaChanged && msgStr.indexOf('grafana_url')>=0){
      msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'the Grafana URL field needs migrate-v45 — run the migration first'};node.send(msg);return;
    }
    throw e;
  }
  // Mirror into the org DB under TENANT_DB_MODE, same as location/approve.
  const opool=global.get('resolvePool')(chk.orgId);
  if(opool!==pool){ try{ await opool.query("UPDATE nodes SET "+sets.join(',')+" WHERE id=?",vals); }catch(e){ node.warn('node profile tenant mirror failed for '+id+': '+e.message); } }
  // Re-point readings already stored under the secondary, so the merged device's
  // HISTORY is whole too and not just its live values. Without this the charts
  // would restart from the moment of the merge while the older half sat on a
  // node id the fleet list no longer shows — visible to nobody. Readings are
  // retention-bounded (30 days raw), so this stays a bounded indexed update.
  let moved=0;
  if(mergeChanged && mergeTarget){
    for(const t of ['readings','readings_rollup']){
      try{ const[u]=await opool.query("UPDATE "+t+" SET node_id=? WHERE node_id=?",[mergeTarget,id]); moved+=u.affectedRows||0; }
      catch(e){ node.warn('merge history move ('+t+') for '+id+': '+e.message); }
    }
  }
  const out={ok:true,id};
  if(b.name!==undefined) out.name=String(b.name||'').trim();
  if(b.departmentId!==undefined) out.departmentId=b.departmentId||null;
  if(mergeChanged){ out.mergeInto=mergeTarget; out.readingsMoved=moved; }
  if(grafanaChanged) out.grafanaUrl=b.grafanaUrl?String(b.grafanaUrl).trim():null;
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr

// GET /api/nodes/:id/feeds — the devices linked as SECOND FEEDS of this one.
// GET /api/fleet deliberately hides secondaries (merge_into IS NULL) so a
// two-topic transformer appears once, not twice with half its parameters each.
// That hiding is right for every list — and it also means a device merged by
// mistake is invisible everywhere, with nothing left to click to undo it. This
// is what makes the merge reversible: the primary's edit modal lists what is
// attached to it and can unlink each one.
const nodeFeedsGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  let rows=[];
  try{ const[r]=await pool.query("SELECT id,name,domain,mqtt_prefix FROM nodes WHERE merge_into=? AND org_id=? ORDER BY id",[id,chk.orgId]); rows=r; }
  catch(e){ if(String(e&&e.message||'').indexOf('merge_into')<0) throw e; }
  msg.headers=__CORS; msg.payload={id, feeds: rows}; node.send(msg);
})()` + bbErr

// --- Device photo (replaces the generic 3D twin) ----------------------------
// Transformer3D draws one hand-modelled unit for every transformer on the
// platform. ETERNITY's fleet spans pole-mounted distribution units to 2500 kVA
// power transformers, so the render matched the asset almost never — while
// presenting itself as a twin OF that asset. An admin uploads the real photo and
// every role sees it, because a viewer sent to a unit at 2am has to recognise it.
//
// The bytes live in the ORG database beside `nodes`; the pool is resolved from
// the node's own org (via the control routing index) rather than the caller's,
// so a superadmin looking at a tenant's device reads the tenant's row and not an
// empty control table.
//
// GET is policy 'node' — the same check that lets someone open the device page
// at all — and doubles as the metadata probe via ?meta=1, so the page can decide
// between photo and fallback in one request instead of loading bytes to find out
// they do not exist.
//
// Since migrate-v36 the writes go to node_photos, so this route reads the COVER
// photo from there first and only falls back to node_images. Keeping it alive
// matters: it is the URL every already-rendered page, cached client and PDF
// still asks for, and it stays correct for a device whose photos were all
// uploaded through the gallery.
const nodeImgGetFunc = `const au=msg.auth||{}; const id=msg.req.params.id; const meta=!!(msg.req.query&&msg.req.query.meta);
const __json=(code,body)=>{msg.statusCode=code;msg.headers={'Content-Type':'application/json','Access-Control-Allow-Origin':env.get('CORS_ORIGIN')||'*'};msg.payload=body;node.send(msg);};
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  let rows=[];
  try{
    const[r]=meta
      ? await pool.query("SELECT content_type,caption,updated_by,updated_at,OCTET_LENGTH(image_data) AS bytes FROM node_photos WHERE node_id=? ORDER BY position, id LIMIT 1",[id])
      : await pool.query("SELECT image_data,content_type FROM node_photos WHERE node_id=? ORDER BY position, id LIMIT 1",[id]);
    rows=r;
  }catch(e){ if(String(e&&e.message||'').indexOf('node_photos')<0) throw e; }
  if(!rows.length) try{
    const[r]=meta
      ? await pool.query("SELECT content_type,caption,updated_by,updated_at,OCTET_LENGTH(image_data) AS bytes FROM node_images WHERE node_id=?",[id])
      : await pool.query("SELECT image_data,content_type FROM node_images WHERE node_id=?",[id]);
    rows=r;
  }catch(e){
    // Not yet migrated is "this device has no photo", not a server error — the
    // page falls back to the twin and stays usable.
    if(String(e&&e.message||'').indexOf('node_images')<0) throw e;
    if(meta){ __json(200,{has:false,pending:'migrate-v27'}); return; }
    msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return;
  }
  if(meta){ const d=rows[0]; __json(200, d&&Number(d.bytes||0)>0 ? {has:true,contentType:d.content_type,caption:d.caption,updatedBy:d.updated_by,updatedAt:d.updated_at,bytes:Number(d.bytes)} : {has:false}); return; }
  if(!rows.length||!rows[0].image_data){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  msg.statusCode=200;
  // The URL carries ?v=<updated_at>, so the bytes at a given URL never change and
  // can be cached hard; a replacement uploads under a new ?v.
  msg.headers={'Content-Type':rows[0].content_type||'image/jpeg','Cache-Control':'private, max-age=300','Access-Control-Allow-Origin':'*'};
  msg.payload=rows[0].image_data;
  node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

// PUT /api/nodes/:id/image — admin only, as asked. The 'admin' policy proves the
// role; ownOrg proves the device is theirs, which the role check alone does not.
const nodeImgPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  const caption=b.caption===undefined?null:String(b.caption||'').slice(0,255);
  if(b.dataBase64===undefined && b.imageUrl===undefined){
    // Caption-only edit: retitle the photo without re-uploading megabytes.
    try{ const[r]=await opool.query("UPDATE node_images SET caption=?, updated_by=? WHERE node_id=?",[caption,au.name||au.userId||null,id]);
      if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'no photo to caption — upload one first'};node.send(msg);return;} }
    catch(e){ if(String(e&&e.message||'').indexOf('node_images')<0) throw e;
      msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'device photos need migrate-v27 — run the migration first'};node.send(msg);return; }
    msg.headers=__CORS; msg.payload={ok:true,id,caption}; node.send(msg); return;
  }
  // Accept either raw base64 or a data: URL, since the two upload paths on the
  // frontend (file picker, paste) naturally produce one each.
  let raw=String(b.dataBase64||b.imageUrl||''), ct=String(b.contentType||'');
  if(raw.startsWith('data:')){ const m=/^data:([^;,]+)[^,]*,/.exec(raw); if(m&&!ct) ct=m[1]; raw=raw.slice(raw.indexOf(',')+1); }
  const buf=Buffer.from(raw,'base64');
  if(!buf.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'image is empty'};node.send(msg);return;}
  if(buf.length>10*1024*1024){msg.headers=__CORS;msg.statusCode=413;msg.payload={error:'image too large (max 10 MB)'};node.send(msg);return;}
  if(ct && ct.indexOf('image/')!==0){msg.headers=__CORS;msg.statusCode=415;msg.payload={error:'only image files can be shown here'};node.send(msg);return;}
  try{
    await opool.query("INSERT INTO node_images (node_id,image_data,content_type,caption,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE image_data=VALUES(image_data),content_type=VALUES(content_type),caption=VALUES(caption),updated_by=VALUES(updated_by)",
      [id,buf,ct||'image/jpeg',caption,au.name||au.userId||null]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_images')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'device photos need migrate-v27 — run the migration first'};node.send(msg);return;
  }
  msg.headers=__CORS; msg.payload={ok:true,id,bytes:buf.length}; node.send(msg);
})()` + bbErr

// DELETE /api/nodes/:id/image — removing the photo restores the generic twin,
// which is the only way back if the wrong unit was uploaded.
const nodeImgDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  try{ await opool.query("DELETE FROM node_images WHERE node_id=?",[id]); }
  catch(e){ if(String(e&&e.message||'').indexOf('node_images')<0) throw e; }
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);
})()` + bbErr

// --- Device photo gallery (migrate-v36) --------------------------------------
// node_images held exactly one photo per device. node_photos holds as many as
// the asset needs, each with a KIND, because they are not alternatives: the
// nameplate close-up, the thermal scan and an as-found condition shot answer
// different questions and are wanted at the same time.
//
// The browser produces both the display image and the thumbnail (see
// src/lib/imagePipeline.ts) — this server stores bytes and never decodes an
// image, so adding photos costs it no CPU per view.
const PHOTO_KINDS = ['overview','nameplate','tapchanger','thermal','condition','other']
// Built-in photo kinds (migrate-v40): an org may relabel, reorder, hide or add
// to these, but not delete them — three carry BEHAVIOUR rather than only a
// label, and losing one breaks a feature silently:
//   overview   the server-side fallback for an unrecognised kind, the column
//              DEFAULT, and what migrate-v36 carried legacy node_images over as
//   thermal    paired against overview/condition to drive the IR compare slider
//   condition  the other half of that pairing, and the as-found/after-repair record
// Hiding one (active=0) only stops it being OFFERED for new uploads; it never
// affects reads or validation of what is already stored, so the compare slider
// keeps working on photos already taken.
const BUILTIN_PHOTO = [
  { key:'overview',   label:'Overview',    hint:'The whole unit — what you are walking up to' },
  { key:'nameplate',  label:'Nameplate',   hint:'The rating plate, close enough to read' },
  { key:'tapchanger', label:'Tap changer', hint:'Position indicator and counter' },
  { key:'thermal',    label:'Thermal',     hint:'IR scan — compare against the visible-light shot' },
  { key:'condition',  label:'Condition',   hint:'As-found / after-repair, a record over time' },
  { key:'other',      label:'Other',       hint:'Anything else worth keeping' },
]
/** Built-ins that other features join on by key — relabelable, never deletable. */
const PROTECTED_PHOTO = ['overview','thermal','condition']

// --- Kind catalog (migrate-v40) ---------------------------------------------
// GET  /api/orgs/:orgId/kinds?scope=photo|document  → the merged, ordered list
// POST /api/orgs/:orgId/kinds                       → add or edit one
// DELETE /api/orgs/:orgId/kinds/:scope/:key         → remove a CUSTOM kind
//
// Read is 'org' policy: every upload picker on every page needs this, viewers
// included. Writes are admin-only.
const KIND_SCOPES = { photo: 'BUILTIN_PHOTO', document: 'BUILTIN_DOC' }
const kindsGetFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const scope=String((msg.req.query&&msg.req.query.scope)||'photo');
const BUILTINS={photo:${JSON.stringify(BUILTIN_PHOTO)},document:${JSON.stringify(BUILTIN_DOC)}};
const PROTECTED={photo:${JSON.stringify(PROTECTED_PHOTO)},document:[]};
if(!BUILTINS[scope]){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'scope must be photo or document'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  const kinds=await global.get('kindsFor')(pool,orgId,scope,BUILTINS[scope]);
  // 'protected' is advisory for the UI (it greys out Delete and warns before
  // hiding); the DELETE handler enforces it independently.
  msg.headers=__CORS; msg.payload={ scope, kinds: kinds.map(k=>({...k, protected: PROTECTED[scope].indexOf(k.key)>=0})) }; node.send(msg);
})()` + bbErr

// Upsert. An existing built-in key becomes an override row; a new key becomes
// a custom kind. The key itself is immutable once rows carry it — renaming is
// what \`label\` is for, and rewriting kind_key would orphan every photo and
// document already stored under the old one.
const kindsPostFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const scope=String(b.scope||'');
const BUILTINS={photo:${JSON.stringify(BUILTIN_PHOTO)},document:${JSON.stringify(BUILTIN_DOC)}};
if(!BUILTINS[scope]){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'scope must be photo or document'};return msg;}
// Keys are stored in a VARCHAR(24) that other tables join on, and end up in
// URLs and JSON — restrict them the same way org ids are restricted rather
// than accepting whatever was typed.
const key=String(b.key||'').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,24);
const label=String(b.label||'').trim().slice(0,120);
if(!key){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'key required (letters, digits and underscores)'};return msg;}
if(!label){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'label required'};return msg;}
const hint=b.hint===undefined||b.hint===null?null:String(b.hint).slice(0,255);
const active=b.active===undefined?1:(b.active?1:0);
const position=Number.isFinite(Number(b.position))?Number(b.position):999;
const pool=global.get('resolvePool')(orgId);
(async()=>{
  try{
    await pool.query(
      "INSERT INTO kind_catalog (org_id,scope,kind_key,label,hint,position,active,created_by) VALUES (?,?,?,?,?,?,?,?) "+
      "ON DUPLICATE KEY UPDATE label=VALUES(label),hint=VALUES(hint),position=VALUES(position),active=VALUES(active)",
      [orgId,scope,key,label,hint,position,active,au.name||au.userId||null]);
  }catch(e){
    if(String(e&&e.message||'').indexOf('kind_catalog')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'the kind catalog needs migrate-v40 — run the migration first'};node.send(msg);return;
  }
  msg.headers=__CORS; msg.payload={ok:true,scope,key,label}; node.send(msg);
})()` + bbErr

// Delete. A built-in is never deletable (it lives in code, and three of the
// photo ones carry behaviour other features join on) — hide it instead. A
// custom kind is refused while anything still carries it, exactly like
// transformer_models: silently orphaning stored rows to an unknown kind is
// worse than making the admin retire it.
const kindsDelFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const scope=String(msg.req.params.scope||''); const key=String(msg.req.params.key||'');
const BUILTINS={photo:${JSON.stringify(BUILTIN_PHOTO)},document:${JSON.stringify(BUILTIN_DOC)}};
if(!BUILTINS[scope]){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'scope must be photo or document'};return msg;}
if(BUILTINS[scope].some(x=>x.key===key)){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'a built-in kind cannot be deleted — hide it instead, which stops it being offered for new uploads'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  // In use anywhere? node_photos/documents live in this same resolved pool.
  const tbl=scope==='photo'?'node_photos':'documents';
  let used=0;
  try{ const[u]=await pool.query("SELECT COUNT(*) AS n FROM "+tbl+" WHERE kind=?",[key]); used=Number(u[0].n||0); }
  catch(e){ if(String(e&&e.message||'').indexOf(tbl)<0 && String(e&&e.message||'').indexOf('kind')<0) throw e; }
  if(used){msg.headers=__CORS;msg.statusCode=409;msg.payload={error:used+' item'+(used===1?' still uses':'s still use')+' this kind — hide it instead, or re-file '+(used===1?'it':'those')+' first',used};node.send(msg);return;}
  try{ await pool.query("DELETE FROM kind_catalog WHERE org_id=? AND scope=? AND kind_key=?",[orgId,scope,key]); }
  catch(e){ if(String(e&&e.message||'').indexOf('kind_catalog')<0) throw e; }
  msg.headers=__CORS; msg.payload={ok:true,scope,key}; node.send(msg);
})()` + bbErr

// GET /api/nodes/:id/photos — metadata only, never bytes. Every list, the
// strip and the lightbox are driven from this; the pixels come from the
// per-photo endpoint below so each one caches independently in the browser.
const nodePhotosListFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  let rows=[];
  try{
    const[r]=await pool.query(
      "SELECT id,kind,position,content_type,width,height,bytes,caption,taken_at,lat,lng,annotations,updated_by,updated_at,"+
      "(thumb_data IS NOT NULL) AS has_thumb FROM node_photos WHERE node_id=? ORDER BY position, id",[id]);
    rows=r;
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_photos')<0) throw e;
    msg.headers=__CORS; msg.payload={nodeId:id,photos:[],pending:'migrate-v36'}; node.send(msg); return;
  }
  msg.headers=__CORS; msg.payload={nodeId:id, photos: rows.map(r=>({
    id:String(r.id), kind:r.kind, position:r.position, contentType:r.content_type,
    width:r.width, height:r.height, bytes:r.bytes, caption:r.caption,
    takenAt:r.taken_at, lat:r.lat===null?null:Number(r.lat), lng:r.lng===null?null:Number(r.lng),
    annotations: r.annotations==null ? [] : (typeof r.annotations==='string' ? JSON.parse(r.annotations) : r.annotations),
    hasThumb: !!r.has_thumb, updatedBy:r.updated_by, updatedAt:r.updated_at,
  }))}; node.send(msg);
})()` + bbErr

// GET /api/nodes/:id/photos/:photoId[?thumb=1] — the bytes.
// Cache-Control is immutable, not max-age=300: the URL carries ?v=<updated_at>
// and a photo's bytes at a given version can never change, so re-downloading
// megabytes every five minutes bought nothing. Replacing a photo bumps
// updated_at, which changes the URL, which misses the cache exactly once.
const nodePhotoBytesFunc = `const au=msg.auth||{}; const id=msg.req.params.id; const pid=msg.req.params.photoId;
const wantThumb=!!(msg.req.query&&msg.req.query.thumb);
(async()=>{
  const org=(await global.get('orgOfNode')(id))||au.orgId||'';
  const pool=global.get('resolvePool')(org);
  let rows=[];
  try{
    const[r]=await pool.query("SELECT image_data,thumb_data,content_type FROM node_photos WHERE id=? AND node_id=?",[pid,id]);
    rows=r;
  }catch(e){
    if(String(e&&e.message||'').indexOf('node_photos')<0) throw e;
    msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return;
  }
  if(!rows.length){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  // A photo carried over from node_images has no thumbnail; serving the full
  // image is better than serving nothing, and it gains one when replaced.
  const data = wantThumb ? (rows[0].thumb_data || rows[0].image_data) : rows[0].image_data;
  if(!data){ msg.statusCode=404; msg.headers={'Access-Control-Allow-Origin':'*'}; msg.payload='not found'; node.send(msg); return; }
  msg.statusCode=200;
  msg.headers={'Content-Type':rows[0].content_type||'image/jpeg','Cache-Control':'private, max-age=31536000, immutable','Access-Control-Allow-Origin':'*'};
  msg.payload=data; node.send(msg);
})().catch(e=>{msg.statusCode=500;msg.headers={'Access-Control-Allow-Origin':'*'};msg.payload=e.message;node.send(msg);}); return null;`

// POST /api/nodes/:id/photos — add one. Appends to the end of the order.
const nodePhotoAddFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
if(!b.dataBase64){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'dataBase64 required'};return msg;}
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const buf=Buffer.from(String(b.dataBase64),'base64');
  if(buf.length>10*1024*1024){msg.headers=__CORS;msg.statusCode=413;msg.payload={error:'image too large (max 10 MB)'};node.send(msg);return;}
  const thumb=b.thumbBase64?Buffer.from(String(b.thumbBase64),'base64'):null;
  // Valid kinds are the built-ins PLUS whatever this org added (migrate-v40),
  // resolved from the org's own pool. An unrecognised kind still falls back to
  // 'overview' rather than 400ing — an upload is not worth losing over a
  // dropdown that went stale between page load and save.
  const __opoolK=global.get('resolvePool')(chk.orgId);
  const __kinds=await global.get('kindsFor')(__opoolK,chk.orgId,'photo',${JSON.stringify(BUILTIN_PHOTO)});
  const kind=__kinds.some(k=>k.key===String(b.kind||''))?String(b.kind):'overview';
  const lat=(b.lat===null||b.lat===undefined)?null:Number(b.lat);
  const lng=(b.lng===null||b.lng===undefined)?null:Number(b.lng);
  const opool=global.get('resolvePool')(chk.orgId);
  let photoId, conn;
  try{
    // MAX(position)+1 read and the INSERT were two separate round-trips —
    // two uploads from the same device page (a multi-select add, or two
    // admins at once) could both read the same max and collide on position.
    // A transaction alone doesn't fix that: SELECT ... FOR UPDATE against
    // node_photos locks nothing when the device has zero photos yet (nothing
    // to lock), so the very first two concurrent uploads would still race.
    // Locking the device's own row in the nodes table instead works in every case,
    // because that row always exists once ownOrg() above has already found
    // it — it serializes "compute next position, insert" into one atomic
    // step regardless of how many photos exist already.
    conn=await opool.getConnection();
    await conn.beginTransaction();
    await conn.query("SELECT id FROM nodes WHERE id=? FOR UPDATE",[id]);
    const[mx]=await conn.query("SELECT COALESCE(MAX(position),-1)+1 AS nextPos FROM node_photos WHERE node_id=?",[id]);
    const[r]=await conn.query(
      "INSERT INTO node_photos (node_id,kind,position,image_data,thumb_data,content_type,width,height,bytes,caption,taken_at,lat,lng,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id,kind,mx[0].nextPos,buf,thumb,b.contentType||'image/jpeg',b.width||null,b.height||null,buf.length,
       b.caption?String(b.caption).slice(0,255):null,b.takenAt?new Date(b.takenAt):null,
       (lat!==null&&isFinite(lat)&&lat>=-90&&lat<=90)?lat:null,(lng!==null&&isFinite(lng)&&lng>=-180&&lng<=180)?lng:null,
       au.name||au.userId||null]);
    await conn.commit();
    photoId=String(r.insertId);
  }catch(e){
    if(conn) try{ await conn.rollback(); }catch(e2){}
    if(String(e&&e.message||'').indexOf('node_photos')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'the photo gallery needs migrate-v36 — run the migration first'};node.send(msg);return;
  }finally{
    if(conn) conn.release();
  }
  msg.headers=__CORS; msg.payload={ok:true,id:photoId,nodeId:id,bytes:buf.length}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/photos/:photoId — caption, kind, annotations. Partial:
// an absent key is left alone, so editing a caption never drops the markers.
const nodePhotoPatchFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const pid=msg.req.params.photoId; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const sets=[],vals=[];
  if(b.caption!==undefined){ sets.push('caption=?'); vals.push(b.caption===null?null:String(b.caption).slice(0,255)); }
  if(b.kind!==undefined){
    const __kindsP=await global.get('kindsFor')(global.get('resolvePool')(chk.orgId),chk.orgId,'photo',${JSON.stringify(BUILTIN_PHOTO)});
    if(!__kindsP.some(k=>k.key===String(b.kind))){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'unknown photo kind'};node.send(msg);return;}
    sets.push('kind=?'); vals.push(String(b.kind));
  }
  if(b.annotations!==undefined){ sets.push('annotations=?'); vals.push(b.annotations===null?null:JSON.stringify(b.annotations)); }
  if(!sets.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nothing to update'};node.send(msg);return;}
  sets.push('updated_by=?'); vals.push(au.name||au.userId||null);
  const opool=global.get('resolvePool')(chk.orgId);
  const[r]=await opool.query("UPDATE node_photos SET "+sets.join(',')+" WHERE id=? AND node_id=?",[...vals,pid,id]);
  if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'photo not found on this device'};node.send(msg);return;}
  msg.headers=__CORS; msg.payload={ok:true,id:pid}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/photos/order {ids} — reorder. The first id becomes the
// cover, which is what every other surface shows.
const nodePhotoOrderFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
const ids=Array.isArray(b.ids)?b.ids.map(String).filter(Boolean):null;
if(!ids){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'ids array required'};return msg;}
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  let i=0;
  for(const pid of ids){ await opool.query("UPDATE node_photos SET position=? WHERE id=? AND node_id=?",[i++,pid,id]); }
  msg.headers=__CORS; msg.payload={ok:true,count:ids.length}; node.send(msg);
})()` + bbErr

const nodePhotoDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const pid=msg.req.params.photoId;
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const opool=global.get('resolvePool')(chk.orgId);
  const[r]=await opool.query("DELETE FROM node_photos WHERE id=? AND node_id=?",[pid,id]);
  if(!r.affectedRows){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'photo not found on this device'};node.send(msg);return;}
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/photo-covers — {nodeId: {photoId, v}} for every device
// that has one. Tables and the map popup need a preview for MANY devices at
// once; this returns only the ids so each <img> fetches its own thumbnail and
// caches it independently, instead of one response carrying every image.
const orgPhotoCoversFunc = CORS + `const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
const pool=global.get('resolvePool')(orgId);
(async()=>{
  const out={};
  try{
    // Matches nodePhotosListFunc's ORDER BY position, id — the same tie-break
    // it and the device page use — not just "lowest position": two photos can
    // share a position (a reorder mid-flight, or a legacy carry-over landing
    // beside a fresh upload) and MIN(position) alone doesn't say which one of
    // those wins, so a table's cover could silently disagree with what the
    // device page itself shows as photos[0].
    const[r]=await pool.query(
      "SELECT p.node_id,p.id,p.updated_at FROM node_photos p JOIN nodes n ON n.id=p.node_id "+
      "WHERE n.org_id=? AND NOT EXISTS (SELECT 1 FROM node_photos q WHERE q.node_id=p.node_id "+
      "AND (q.position<p.position OR (q.position=p.position AND q.id<p.id)))",[orgId]);
    for(const x of r) if(!out[x.node_id]) out[x.node_id]={photoId:String(x.id), v:x.updated_at};
  }catch(e){ if(String(e&&e.message||'').indexOf('node_photos')<0) throw e; }
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr

// --- Tenancy / provisioning (superadmin: orgs/entitlements/nodes; admin: depts/users/access)
// Authz-enforced: each handler self-scopes by the JWT org, or the guard checks :orgId.
const orgsListFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{};
(async()=>{const[r]= au.role==='superadmin' ? (await pool.query("SELECT * FROM organizations ORDER BY name")) : (await pool.query("SELECT * FROM organizations WHERE id=?",[au.orgId||''])); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const orgsPostFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||await global.get('makeOrgId')(pool, b.name);
  await pool.query("INSERT INTO organizations (id,name,status,logo_url) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),status=VALUES(status),logo_url=VALUES(logo_url)",[id,b.name,b.status||'active',b.logoUrl||null]);
  // DB-per-tenant: auto-migrate this org's dedicated database (iothub_<org>) by
  // triggering the migrate service (reuse migrate.ts via HTTP; Node-RED can't
  // import it). Best-effort: the org is created even if migrate fails — ops can
  // re-run 'node dist/migrate.js --org <id>'. Skipped when MIGRATE_URL is unset
  // (e.g. a row-level deploy), so existing single-DB setups are unaffected.
  let provisioned=null; const murl=env.get('MIGRATE_URL');
  if(murl){ try{ const rr=await fetch(murl.replace(/\\/+$/,'')+'/migrate/org/'+encodeURIComponent(id),{method:'POST'}); provisioned=rr.ok?await rr.json():{error:'migrate HTTP '+rr.status}; if(!rr.ok)node.warn('org migrate '+id+': HTTP '+rr.status); }catch(e){ node.warn('org migrate trigger failed for '+id+': '+e.message); provisioned={error:e.message}; } }
  // Create the org's admin (control-plane users) and email a welcome + set-password
  // link so the customer can log in right after provisioning. Best-effort: the org
  // is provisioned regardless of email delivery.
  let admin=null; const adminEmail=(b.adminEmail||'').trim();
  if(adminEmail){ try{
    const [ex]=await pool.query("SELECT id FROM users WHERE email=?",[adminEmail]);
    const uid=ex.length?ex[0].id:('u-'+Date.now());
    const adminName=b.adminName||(b.name+' Admin');
    await pool.query("INSERT INTO users (id,org_id,email,name,role) VALUES (?,?,?,?,'admin') ON DUPLICATE KEY UPDATE org_id=VALUES(org_id),name=VALUES(name),role='admin'",[uid,id,adminEmail,adminName]);
    const [uu]=await pool.query("SELECT id,name FROM users WHERE email=?",[adminEmail]); const userId=uu[0].id;
    // jwt token (avoids the crypto external-module gotcha); 72h for onboarding.
    const token=jwt.sign({uid:userId,k:'pwreset'}, env.get('JWT_SECRET')||'dev-secret-change-me', {expiresIn:'72h', jwtid:String(Date.now())+Math.random().toString(36).slice(2)});
    await pool.query("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?,?,?)",[userId, token, new Date(Date.now()+72*3600*1000)]);
    // A password chosen during provisioning is applied here and mailed WITH the
    // sign-in name, so the customer can use the product immediately. Without one
    // the set-password link stays the way in, exactly as before.
    const chosen=(b.adminPassword||'').trim();
    if(chosen && chosen.length<8){ node.warn('provision: adminPassword shorter than 8 chars for '+adminEmail+' — ignored'); }
    const hasPw = chosen.length>=8;
    if(hasPw){ await pool.query("UPDATE users SET password_hash=? WHERE id=?",[await bcrypt.hash(chosen,10), userId]); }
    const mc=await global.get('mailConfig')();
    const url=mc.frontendUrl+'/reset?token='+token;
    if(mc.transport && hasPw){
      const text='Hello '+uu[0].name+',\\n\\nYour ONEOPS platform for '+b.name+' is ready to use.\\n\\nSign in at '+mc.frontendUrl+'\\n  Username: '+adminEmail+'\\n  Password: '+chosen+'\\n\\nPlease change this password after signing in for the first time.\\n\\nThanks,\\nONEOPS';
      await mc.transport.sendMail({from:mc.from, to:adminEmail, subject:'Your ONEOPS platform for '+b.name+' is ready', text});
      admin={email:adminEmail, emailed:true, passwordSet:true};
    } else if(mc.transport){
      const text='Hello '+uu[0].name+',\\n\\nYour ONEOPS platform for '+b.name+' is ready. Set your admin password to get started:\\n\\n'+url+'\\n\\nThis link expires in 72 hours.\\n\\nThanks,\\nONEOPS';
      await mc.transport.sendMail({from:mc.from, to:adminEmail, subject:'Welcome to ONEOPS — set your admin password', text});
      admin={email:adminEmail, emailed:true};
    } else if(hasPw){
      // Password is set but nothing can deliver it; the superadmin who typed it
      // already knows it, so there is nothing to hand back.
      node.warn('provision: SMTP not configured — password set for '+adminEmail+' but not emailed');
      admin={email:adminEmail, emailed:false, passwordSet:true};
    } else {
      // The admin row is created WITHOUT a password_hash — the set-password link
      // is the only way in. With no SMTP configured that link used to exist only
      // in this function's scope, so a freshly provisioned org could not be
      // logged into at all and someone had to write a bcrypt hash into the users
      // table by hand. Hand it back to the superadmin who is provisioning, so
      // they can pass it to the customer.
      node.warn('provision: SMTP not configured — returning the set-password link for '+adminEmail+' instead of emailing it');
      admin={email:adminEmail, emailed:false, setPasswordUrl:url};
    }
  }catch(e){ node.warn('provision admin/email failed for '+id+': '+e.message); admin={error:e.message}; } }
  msg.headers=__CORS; msg.payload={ok:true,id,provisioned,admin}; node.send(msg);})()` + bbErr

// --- Schema migrations (superadmin) -----------------------------------------
// Every .sql this image ships, in the exact order migrate.ts's discoverFiles()
// applies them: schema first, domain files, then migrate-v* sorted NUMERICALLY
// (so v10 lands after v9, not after v1). Read from disk at BUILD time, so the
// flow always knows precisely what the image beside it contains — a list
// hand-maintained here would drift the first time someone added a migration
// and forgot.
const MIGRATION_FILES = (() => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql')
  let entries = []
  try { entries = readdirSync(dir).filter((f) => f.endsWith('.sql')) } catch { return [] }
  const schema = [], domain = [], migrations = []
  for (const f of entries) {
    if (f === 'install.sql' || f.startsWith('seed-')) continue   // CLI wrapper / opt-in demo data
    if (f === 'schema.sql') schema.push(f)
    else if (f.startsWith('migrate-')) migrations.push(f)
    else domain.push(f)
  }
  migrations.sort((a, b) => (parseInt(a.match(/v(\d+)/)?.[1] || '0', 10)) - (parseInt(b.match(/v(\d+)/)?.[1] || '0', 10)))
  domain.sort()
  return [...schema, ...domain, ...migrations]
})()
console.log(`Migrations: ${MIGRATION_FILES.length} file(s) shipped, newest ${MIGRATION_FILES[MIGRATION_FILES.length - 1] || 'none'}`)

// GET /api/platform/migrations — which databases are behind the code.
//
// Answers the question the superadmin header badge asks: has every tenant
// database caught up with the .sql files in the image running right now?
// Reads schema_migrations out of the control DB and each tenant DB and diffs
// it against MIGRATION_FILES. A missing table means "nothing applied yet",
// not an error — that is a brand-new database, which is exactly a pending
// state worth showing.
const migrationsGetFunc = CORS + `const pool=global.get('pool');
const EXPECTED=${JSON.stringify(MIGRATION_FILES)};
const CONTROL_ORGS=String(env.get('CONTROL_ORG_IDS')||'org-1,org-2,org-3').split(',').map(s=>s.trim()).filter(Boolean);
(async()=>{
  const tenantMode = !!global.get('tenantMode');
  const appliedIn = async (p) => {
    try{ const[r]=await p.query("SELECT filename FROM schema_migrations"); return r.map(x=>x.filename); }
    catch(e){ if(String(e&&e.message||'').indexOf('schema_migrations')<0) throw e; return []; }
  };
  const pendingOf = (applied) => { const has=new Set(applied); return EXPECTED.filter(f=>!has.has(f)); };

  const controlApplied = await appliedIn(pool);
  const control = { db: env.get('DB_NAME')||'iothub', applied: controlApplied.length, pending: pendingOf(controlApplied) };

  const orgs=[];
  if(tenantMode){
    // Suspended orgs, and the '__unassigned__' sentinel used for unclaimed
    // pending devices (itself always suspended), are not tenants to migrate —
    // same filter platformStatsFunc uses below, for the same reason.
    const[rows]=await pool.query("SELECT id,name FROM organizations WHERE (status IS NULL OR status<>'suspended') ORDER BY name");
    for(const o of rows){
      // org-1/2/3 share the control database — resolvePool returns the control
      // pool for them, so reporting them separately would double-count the
      // control row as three "tenants" that are always in whatever state it is.
      if(CONTROL_ORGS.indexOf(o.id)>=0){ orgs.push({orgId:o.id,name:o.name,db:control.db,onControlDb:true,applied:control.applied,pending:[],error:null}); continue; }
      const db=global.get('orgDbName')(o.id);
      try{
        const p=global.get('resolvePool')(o.id);
        const ap=await appliedIn(p);
        orgs.push({orgId:o.id,name:o.name,db,onControlDb:false,applied:ap.length,pending:pendingOf(ap),error:null});
      }catch(e){
        // An unreachable/absent tenant DB is itself the finding — report it
        // rather than failing the whole status call.
        orgs.push({orgId:o.id,name:o.name,db,onControlDb:false,applied:0,pending:EXPECTED.slice(),error:String(e&&e.message||e)});
      }
    }
  }
  const behind = orgs.filter(o=>!o.onControlDb && (o.pending.length || o.error));
  msg.headers=__CORS; msg.payload={
    tenantMode,
    expected: EXPECTED.length,
    newest: EXPECTED[EXPECTED.length-1]||null,
    control,
    orgs,
    // What the badge counts: tenant databases behind the code. The control DB
    // is migrated by the deploy Job, not by this button, so it is reported
    // separately rather than folded into a number this button cannot fix.
    orgsBehind: behind.length,
    controlBehind: control.pending.length,
    canRun: !!env.get('MIGRATE_URL'),
  }; node.send(msg);
})()` + bbErr

// POST /api/platform/migrations/run — bring every tenant database up to date.
//
// A thin, deliberate proxy to the migrate service (MIGRATE_URL), which is the
// only process with the .sql files AND the credentials to CREATE DATABASE.
// Node-RED does not re-implement any of that; it forwards the call and returns
// the service's own per-org result verbatim, because "which org failed and
// why" is the entire value of the response.
//
// It does NOT touch the control database: /migrate/all-orgs is tenant-only,
// and the control schema is applied by the deploy-time Job. Saying so here
// keeps the button honest about what pressing it can and cannot fix.
//
// Explicit timeout, not a bare fetch(): migrateAllOrgs runs every org's
// pending .sql files SEQUENTIALLY against real data (migrate.ts), which with
// enough orgs can legitimately take a while — long enough to be at risk of
// whatever Node's fetch() implicit default actually is. 10 minutes is
// deliberately generous rather than tight, since a false "timed out" on a
// migration that was actually still working is worse than a slow success —
// and the message says so explicitly, rather than surfacing whatever raw
// AbortError text a timeout produces.
const migrationsRunFunc = CORS + `const au=msg.auth||{};
(async()=>{
  const murl=env.get('MIGRATE_URL');
  if(!murl){msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'MIGRATE_URL is not configured — this deployment has no migrate service to call'};node.send(msg);return;}
  let r, body;
  try{
    r = await fetch(String(murl).replace(/\\/+$/,'')+'/migrate/all-orgs',{method:'POST',signal:AbortSignal.timeout(600000)});
    body = await r.json().catch(()=>null);
  }catch(e){
    const timedOut = e && (e.name==='TimeoutError' || e.name==='AbortError');
    const reason = timedOut ? 'timed out after 10 minutes waiting for a response' : String(e&&e.message||e);
    // This used to only ever reach the caller's HTTP response — nothing about
    // it touched the pod's own log stream, so "did this fail, and why" was
    // unanswerable from kubectl logs alone; a superadmin's browser was the
    // only place the reason ever appeared, however many times it happened.
    node.warn('migrations.run: could not reach '+murl+' — '+reason);
    msg.headers=__CORS;msg.statusCode=502;msg.payload={error:'could not reach the migrate service: '+reason};node.send(msg);return;
  }
  // auditLog JSON.stringifies its detail argument itself — pass the object,
  // not a string, or the row stores an escaped string instead of readable JSON.
  global.get('auditLog')(au,'migrations.run','platform',null,{ok:!!(body&&body.ok),migrated:(body&&body.migrated||[]).length,failed:(body&&body.failed||[]).length});
  // The service answers 500 when any org failed. That is not a Node-RED error
  // — it is the result — so it comes back as 200 with ok:false and the detail
  // intact, and the UI decides how loudly to say it.
  msg.headers=__CORS; msg.payload={
    ok: !!(body && body.ok),
    httpStatus: r.status,
    migrated: (body && body.migrated) || [],
    failed: (body && body.failed) || [],
    skipped: (body && body.skipped) || [],
    error: (body && body.error) || null,
  }; node.send(msg);
})()` + bbErr

// GET /api/orgs/:orgId/data-quality?days=7 — real ingest quality for one org.
//
// The Data Quality page was entirely fabricated: three hardcoded "Bronze /
// Silver / Gold" cards (98%, 1.2M records, "Healthy") and a seven-point trend
// array written in the source. It described a medallion data lake that is not
// deployed here — the Airflow/Spark/MinIO/Superset Applications that would
// make one are all under argocd/platform-stack/disabled. Invented numbers on a
// page whose entire job is telling an operator whether their data is
// trustworthy is worse than no page.
//
// What IS real, and what this returns instead:
//   • readings.quality — an enum ('good','sim','error','stale') the ingest
//     path already writes per reading, for data still inside the retention
//     window (READINGS_RETENTION_DAYS).
//   • readings_rollup.n / .bad_n — the retention tick already aggregates
//     "samples" and "not-good samples" per node/param/hour when it rolls raw
//     rows up, so history survives the purge. Same definition, so the two
//     sources can be summed into one trend without disagreeing.
//   • device_presence — which devices are actually reporting right now.
const dataQualityFunc = CORS + `const au=msg.auth||{}; const q=msg.req.query||{};
const orgId = au.role==='superadmin' ? (msg.req.params.orgId||au.orgId) : (au.orgId||'');
const pool = global.get('resolvePool')(orgId);
const days = Math.max(1, Math.min(90, Number(q.days)||7));
(async()=>{
  const[nodes]=await pool.query("SELECT id,name,domain FROM nodes WHERE org_id=? AND status='active'",[orgId]);
  const ids=nodes.map(n=>n.id);
  const out={ days, devices:nodes.length, totals:{samples:0,bad:0}, byQuality:{}, trend:[], worst:[], presence:{online:0,offline:0,never:0}, sources:[] };
  if(!ids.length){ msg.headers=__CORS; msg.payload=out; node.send(msg); return; }

  // Raw readings still inside retention — exact per-quality counts.
  try{
    const[qr]=await pool.query(
      "SELECT quality, COUNT(*) n FROM readings WHERE node_id IN (?) AND taken_at > (NOW(3)-INTERVAL ? DAY) GROUP BY quality",[ids,days]);
    for(const r of qr){ out.byQuality[r.quality]=Number(r.n); out.totals.samples+=Number(r.n); if(r.quality!=='good') out.totals.bad+=Number(r.n); }
    if(qr.length) out.sources.push('readings');
  }catch(e){ node.warn('data-quality: readings scan skipped: '+e.message); }

  // Anything already rolled up and purged. bad_n uses the same
  // "quality NOT IN ('good')" definition the retention tick applies.
  try{
    const[rr]=await pool.query(
      "SELECT SUM(n) n, SUM(bad_n) bad FROM readings_rollup WHERE node_id IN (?) AND bucket > (NOW(3)-INTERVAL ? DAY)",[ids,days]);
    if(rr.length && rr[0].n!==null){
      out.totals.samples+=Number(rr[0].n); out.totals.bad+=Number(rr[0].bad||0);
      out.sources.push('readings_rollup');
    }
  }catch(e){ if(String(e&&e.message||'').indexOf('readings_rollup')<0) throw e; }

  out.totals.good = out.totals.samples - out.totals.bad;
  out.totals.goodPct = out.totals.samples ? Number(((out.totals.good/out.totals.samples)*100).toFixed(2)) : null;

  // Daily trend, raw + rolled-up summed per day so the line does not step down
  // at the retention boundary.
  const byDay={};
  try{
    const[d1]=await pool.query(
      "SELECT DATE_FORMAT(taken_at,'%Y-%m-%d') d, COUNT(*) n, SUM(CASE WHEN quality<>'good' THEN 1 ELSE 0 END) bad "+
      "FROM readings WHERE node_id IN (?) AND taken_at > (NOW(3)-INTERVAL ? DAY) GROUP BY d",[ids,days]);
    for(const r of d1){ const k=String(r.d).slice(0,10); byDay[k]=byDay[k]||{samples:0,bad:0}; byDay[k].samples+=Number(r.n); byDay[k].bad+=Number(r.bad||0); }
  }catch(e){ node.warn('data-quality: daily scan skipped: '+e.message); }
  try{
    const[d2]=await pool.query(
      "SELECT DATE_FORMAT(bucket,'%Y-%m-%d') d, SUM(n) n, SUM(bad_n) bad FROM readings_rollup WHERE node_id IN (?) AND bucket > (NOW(3)-INTERVAL ? DAY) GROUP BY d",[ids,days]);
    for(const r of d2){ const k=String(r.d).slice(0,10); byDay[k]=byDay[k]||{samples:0,bad:0}; byDay[k].samples+=Number(r.n||0); byDay[k].bad+=Number(r.bad||0); }
  }catch(e){ if(String(e&&e.message||'').indexOf('readings_rollup')<0) throw e; }
  out.trend=Object.keys(byDay).sort().map(d=>({ day:d, samples:byDay[d].samples, bad:byDay[d].bad,
    goodPct: byDay[d].samples ? Number((((byDay[d].samples-byDay[d].bad)/byDay[d].samples)*100).toFixed(2)) : null }));

  // The devices actually dragging the number down — the page's whole purpose
  // is pointing at something you can go and fix.
  try{
    const[w]=await pool.query(
      "SELECT node_id, COUNT(*) n, SUM(CASE WHEN quality<>'good' THEN 1 ELSE 0 END) bad "+
      "FROM readings WHERE node_id IN (?) AND taken_at > (NOW(3)-INTERVAL ? DAY) "+
      "GROUP BY node_id HAVING bad > 0 ORDER BY bad DESC LIMIT 10",[ids,days]);
    const nameOf={}; for(const n of nodes) nameOf[n.id]=n.name;
    out.worst=w.map(r=>({ nodeId:r.node_id, name:nameOf[r.node_id]||r.node_id, samples:Number(r.n), bad:Number(r.bad),
      badPct: Number(((Number(r.bad)/Number(r.n))*100).toFixed(2)) }));
  }catch(e){ node.warn('data-quality: worst-offender scan skipped: '+e.message); }

  try{
    const[p]=await pool.query("SELECT node_id, online FROM device_presence WHERE node_id IN (?)",[ids]);
    const seen={}; for(const r of p){ seen[r.node_id]=1; if(Number(r.online)) out.presence.online++; else out.presence.offline++; }
    out.presence.never = ids.filter(i=>!seen[i]).length;
  }catch(e){ node.warn('data-quality: presence scan skipped: '+e.message); }

  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr

// --- Read-only SQL console (superadmin) -------------------------------------
// Replaces the "SQL AI" page, whose backend returned a hardcoded paragraph
// about BloodBOX units on Floor 3 regardless of the question asked, against a
// schema of four tables that do not exist. There is no model configured
// anywhere in this platform, so natural-language → SQL had nothing behind it;
// this is the same page's useful half — browse the real schema, run a real
// query — with the invented half removed.
//
// Isolation is by DATABASE, not by WHERE clause. An arbitrary SELECT cannot be
// constrained to one organization's ROWS without parsing it — a subquery, UNION
// or JOIN reaches anywhere the connection can — so nothing here tries. Instead
// each caller is handed a connection that can only see their own data:
// a superadmin gets the control database, an org admin gets iothub_<org> via
// resolvePool(), and an org with no tenant database of its own is refused
// rather than quietly given the shared one. That makes the guarantee a property
// of the connection, which no query text can talk its way around.
//
// Defence in depth, because "read-only" has to be true, not intended:
//   1. mysql2's multipleStatements defaults to FALSE and is never enabled on
//      any pool here, so "SELECT 1; DROP TABLE users" cannot parse as two
//      statements at the driver level. Checked, not assumed.
//   2. The statement must begin with SELECT or WITH, and must contain no ';'
//      beyond a single trailing one.
//   3. It is executed WRAPPED: SELECT ... FROM (<query>) AS _q LIMIT ?. A
//      non-SELECT is a syntax error inside a derived table, so this is a
//      structural guarantee rather than another regex, and it is also what
//      enforces the row cap no matter what the author wrote.
//   4. An optimizer hint caps wall-clock time so one bad join cannot pin the
//      database that every device is writing into.
//   5. Tables holding credentials or secrets are refused outright, for the
//      same reason a DBA does not SELECT password hashes to answer a question
//      about device counts.
const SQL_BLOCKED_TABLES = ['users', 'password_resets', 'platform_settings', 'user_prefs', 'org_logos']
const sqlConsoleFunc = CORS + `const ctl=global.get('pool'); const au=msg.auth||{}; const b=msg.payload||{};
const BLOCKED=${JSON.stringify(SQL_BLOCKED_TABLES)};
const MAXROWS=Math.max(1,Math.min(1000,Number(b.limit)||200));
const bad=(code,error)=>{msg.headers=__CORS;msg.statusCode=code;msg.payload={error};return msg;};

// --- which database this caller is allowed to talk to -----------------------
// A superadmin gets the control database, as before. An ORG ADMIN gets their
// own tenant database and nothing else — but only when one actually exists.
// resolvePool() falls back to the CONTROL pool in three cases (TENANT_DB_MODE
// off, a legacy org-1/2/3 that was never migrated out, orgDbName() returning
// empty), and in every one of them the control database holds every tenant's
// rows. Comparing the returned pool against the control pool by identity
// catches all three at once, so an org admin can never be handed a connection
// that can see another customer — the fallback is refusal, not silent access.
let pool=ctl, scope='control';
if(au.role!=='superadmin'){
  if(!au.orgId) return bad(403,'no organization on this session');
  pool=global.get('resolvePool')(au.orgId);
  if(!pool || pool===ctl) return bad(403,'your organization does not have its own database, so a query here could reach other customers\\' data. Ask a platform administrator.');
  scope=global.get('orgDbName')(au.orgId)||'tenant';
}

let sql=String(b.sql||'').trim();
if(!sql) return bad(400,'no query');
// One statement only: a single trailing ';' is a habit, anything else is not.
sql=sql.replace(/;\\s*$/,'');
if(sql.indexOf(';')>=0) return bad(400,'only a single statement may be run');

// Block comments are refused outright rather than stripped. MySQL's /*! */ form
// is EXECUTABLE — "/*!50000 UNION SELECT ... */" runs as SQL — so validating a
// comment-stripped copy while executing the original would let a payload hide
// in the gap between the two. Line comments carry no such form, so those are
// only removed (along with backticks) to build the string the checks below
// read; the string that actually RUNS is always the original.
if(sql.indexOf('/*')>=0) return bad(400,'comments are not allowed in this console');
const norm=sql.replace(/--[^\\n]*/g,' ').replace(/#[^\\n]*/g,' ').replace(/\`/g,'');

if(!/^\\s*(SELECT|WITH)\\b/i.test(norm)) return bad(400,'read-only console: the query must start with SELECT or WITH');
// Server-side file access and deliberate stalls are never part of a question
// anyone needs answered from this box.
if(/\\b(INTO\\s+(OUTFILE|DUMPFILE)|LOAD_FILE|BENCHMARK|SLEEP|GET_LOCK)\\b/i.test(norm)) return bad(400,'that function is not available here');
if(/\\b(information_schema|performance_schema|mysql|sys)\\s*\\./i.test(norm)) return bad(400,'system schemas are not queryable — use the schema browser');
// Cross-database reach. The connection's MySQL user holds grants on every
// tenant schema (one shared DB_USER provisions them all), so being CONNECTED to
// iothub_acme does not stop "SELECT * FROM iothub_other.nodes" from resolving —
// only refusing the qualified name does. Every database in this deployment is
// named iothub*, so any iothub-prefixed schema qualifier is a reach into
// another tenant (or back into the control DB) and is refused for everyone,
// superadmin included: a superadmin has no need to qualify, they are already
// connected to the control database.
if(/\\biothub[a-z0-9_]*\\s*\\./i.test(norm)) return bad(400,'queries may not name a database — this console is scoped to '+scope);
for(const t of BLOCKED){ if(new RegExp('\\\\b'+t+'\\\\b','i').test(norm)) return bad(400,'the '+t+' table holds credentials or secrets and cannot be queried here'); }
(async()=>{
  const started=Date.now();
  try{
    // MAX_EXECUTION_TIME is a SELECT-only optimizer hint, which is exactly what
    // the outer statement always is.
    const[rows,fields]=await pool.query("SELECT /*+ MAX_EXECUTION_TIME(8000) */ * FROM ("+sql+") AS _q LIMIT ?",[MAXROWS]);
    // Buffers (a BLOB column) and Dates do not survive JSON in a shape the
    // table can print; make them strings here rather than showing "[object]".
    const out=rows.map(r=>{const o={};for(const k of Object.keys(r)){const v=r[k];
      o[k]= v===null||v===undefined ? null
          : Buffer.isBuffer(v) ? '<'+v.length+' bytes>'
          : v instanceof Date ? v.toISOString()
          : typeof v==='object' ? JSON.stringify(v)
          : v; } return o;});
    msg.headers=__CORS; msg.payload={
      columns: (fields||[]).map(f=>f.name),
      rows: out,
      rowCount: out.length,
      truncated: out.length>=MAXROWS,
      elapsedMs: Date.now()-started,
      database: scope,
    }; node.send(msg);
  }catch(e){
    // The DB's own message is the single most useful thing here (unknown
    // column, bad syntax, and the position it choked on) — passing it through
    // is the difference between a usable console and a guessing game. The
    // caller is already scoped to a database they own, so the message names
    // nothing they cannot see by listing their own schema.
    msg.headers=__CORS; msg.statusCode=400; msg.payload={error:e.sqlMessage||e.message, code:e.code||null};
    node.send(msg);
  }
})(); return null;`

// GET /api/platform/sql/schema — the REAL tables and columns of the database
// being queried, so the explorer stops advertising carbon_emissions /
// sensor_readings / sites / carbon_credits, none of which have ever existed.
//
// Resolved through the same pool the console will use, so an org admin browses
// THEIR tenant schema — DATABASE() follows the connection — and is refused on
// the same terms if no tenant database exists for them.
const sqlSchemaFunc = CORS + `const ctl=global.get('pool'); const au=msg.auth||{};
const BLOCKED=${JSON.stringify(SQL_BLOCKED_TABLES)};
let pool=ctl, scope='control';
if(au.role!=='superadmin'){
  if(!au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'no organization on this session'};return msg;}
  pool=global.get('resolvePool')(au.orgId);
  if(!pool || pool===ctl){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'your organization does not have its own database'};return msg;}
  scope=global.get('orgDbName')(au.orgId)||'tenant';
}
(async()=>{
  const[rows]=await pool.query(
    "SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty FROM information_schema.COLUMNS "+
    "WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION");
  const byTable={};
  for(const r of rows){
    if(BLOCKED.indexOf(String(r.t))>=0) continue;   // not listed, not queryable
    (byTable[r.t]=byTable[r.t]||[]).push({name:r.c, type:r.ty});
  }
  msg.headers=__CORS;
  msg.payload={ tables:Object.keys(byTable).map(t=>({name:t, columns:byTable[t]})), blocked:BLOCKED, database:scope };
  node.send(msg);
})()` + bbErr

// GET /api/platform/stats — the superadmin header's three numbers, for real.
//
// They were hardcoded strings: "OPERATIONAL" in green whatever the state of
// anything, "4.2K req/s" from no source at all, and "23" active alarms. On the
// one screen whose entire job is telling an operator whether the platform is
// healthy, three invented numbers is worse than none. Traffic is gone (there
// is no request-rate source to read); the other two are queried.
const platformStatsFunc = CORS + `const pool=global.get('pool');
const CONTROL_ORGS=String(env.get('CONTROL_ORG_IDS')||'org-1,org-2,org-3').split(',').map(s=>s.trim()).filter(Boolean);
(async()=>{
  const out={orgs:0,devices:0,online:0,alarms:0,critical:0,degraded:[]};
  const[orgRows]=await pool.query("SELECT id FROM organizations WHERE status IS NULL OR status<>'suspended'");
  out.orgs=orgRows.length;
  const tenantMode=!!global.get('tenantMode');
  // One pass per distinct database: the control pool covers every legacy org at
  // once, each tenant DB is its own query.
  const seen={};
  const scan=async(p,key,orgIds)=>{
    if(seen[key]) return; seen[key]=1;
    const inList=orgIds.map(()=>'?').join(',');
    try{
      const[d]=await p.query("SELECT COUNT(*) n, SUM(CASE WHEN pr.online=1 THEN 1 ELSE 0 END) up FROM nodes n2 LEFT JOIN device_presence pr ON pr.node_id=n2.id WHERE n2.status='active' AND n2.org_id IN ("+inList+")",orgIds);
      out.devices+=Number(d[0].n||0); out.online+=Number(d[0].up||0);
    }catch(e){ node.warn('platform stats devices ('+key+'): '+e.message); }
    try{
      const[a]=await p.query("SELECT COUNT(*) n, SUM(CASE WHEN severity='CRITICAL' THEN 1 ELSE 0 END) c FROM alarm_events WHERE cleared_at IS NULL AND acknowledged_at IS NULL AND org_id IN ("+inList+")",orgIds);
      out.alarms+=Number(a[0].n||0); out.critical+=Number(a[0].c||0);
    }catch(e){ node.warn('platform stats alarms ('+key+'): '+e.message); }
  };
  const controlOrgIds=orgRows.map(o=>o.id).filter(id=>!tenantMode||CONTROL_ORGS.indexOf(id)>=0);
  if(controlOrgIds.length) await scan(pool,'__control__',controlOrgIds);
  if(tenantMode){
    for(const o of orgRows){
      if(CONTROL_ORGS.indexOf(o.id)>=0) continue;
      try{ await scan(global.get('resolvePool')(o.id), global.get('orgDbName')(o.id), [o.id]); }
      catch(e){ out.degraded.push(o.id); node.warn('platform stats org '+o.id+': '+e.message); }
    }
  }
  // "OPERATIONAL" is now a claim with something behind it: every org's database
  // answered, and nothing is screaming.
  out.status = out.degraded.length ? 'DEGRADED' : out.critical > 0 ? 'ALARMS' : 'OPERATIONAL';
  msg.headers=__CORS; msg.payload=out; node.send(msg);
})()` + bbErr

// --- Platform settings (superadmin): DB-backed SMTP / sender config ----------
// The password is never returned (passSet flag only) and is stored encrypted.
const SETTINGS_DDL = "CREATE TABLE IF NOT EXISTS platform_settings (skey VARCHAR(64) PRIMARY KEY, sval TEXT, updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3))";
const settingsGetFunc = CORS + `const pool=global.get('pool');
(async()=>{const m={}; try{const[r]=await pool.query("SELECT skey,sval FROM platform_settings"); for(const x of r) m[x.skey]=x.sval;}catch(e){}
  msg.headers=__CORS; msg.payload={
    smtpHost:m['smtp.host']||'', smtpPort:m['smtp.port']||'587', smtpUser:m['smtp.user']||'', mailFrom:m['smtp.from']||'', frontendUrl:m['app.frontendUrl']||'', passSet: !!m['smtp.pass'],
    // Notification tokens are never returned — only a "configured" flag. Chat id is not secret.
    telegramChatId:m['notify.telegramChatId']||'', telegramSet: !!m['notify.telegramToken'], lineSet: !!m['notify.lineToken'], googleChatSet: !!m['notify.googleChatWebhook']
  }; node.send(msg);})()` + bbErr

const settingsPutFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
(async()=>{
  await pool.query(${JSON.stringify(SETTINGS_DDL)});
  const set=async(k,v)=>{ await pool.query("INSERT INTO platform_settings (skey,sval) VALUES (?,?) ON DUPLICATE KEY UPDATE sval=VALUES(sval)",[k, v==null?'':String(v)]); };
  if(b.smtpHost!==undefined) await set('smtp.host', b.smtpHost);
  if(b.smtpPort!==undefined) await set('smtp.port', b.smtpPort);
  if(b.smtpUser!==undefined) await set('smtp.user', b.smtpUser);
  if(b.mailFrom!==undefined) await set('smtp.from', b.mailFrom);
  if(b.frontendUrl!==undefined) await set('app.frontendUrl', b.frontendUrl);
  // Password: set only when a new non-empty value is provided (encrypted); or clear.
  if(b.smtpPass) await set('smtp.pass', global.get('encryptSecret')(b.smtpPass));
  else if(b.clearPass) await set('smtp.pass', '');
  // Notification tokens: same rule (encrypted; blank keeps existing; clear* wipes).
  if(b.telegramChatId!==undefined) await set('notify.telegramChatId', b.telegramChatId);
  if(b.telegramToken) await set('notify.telegramToken', global.get('encryptSecret')(b.telegramToken)); else if(b.clearTelegram) await set('notify.telegramToken','');
  if(b.lineToken) await set('notify.lineToken', global.get('encryptSecret')(b.lineToken)); else if(b.clearLine) await set('notify.lineToken','');
  if(b.googleChatWebhook) await set('notify.googleChatWebhook', global.get('encryptSecret')(b.googleChatWebhook)); else if(b.clearGoogleChat) await set('notify.googleChatWebhook','');
  global.set('__mailCfg', null); global.set('__notifyCfg', null);   // invalidate caches
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- MQTT connection info shown on admin/pending's "MQTT setup" card --------
// Deliberately a SEPARATE endpoint from /api/platform/settings, not a field
// added to it: that endpoint is policy 'super' end to end, but this one has to
// be readable by every ORG ADMIN — they are the ones who actually go program a
// device with it — while only a superadmin may change it. One route cannot
// carry two different read policies for different fields of the same body, so
// this is its own GET (policy 'admin') and PUT (policy 'super').
//
// Unlike smtp.pass, the password IS returned in plaintext to any admin who can
// call the GET — it is not a server-side-only secret an org never needs to see
// again, it is a credential they must copy into firmware. Still stored
// encrypted at rest (same encryptSecret/decryptSecret as smtp.pass) as
// defense-in-depth against a DB-only compromise, not to hide it from the
// customers it exists for.
//
// Falls back to the values this platform shipped with (27.254.143.144:1883,
// device/iothub.2026) when nothing has been configured yet, so an unconfigured
// install shows the same thing admin/pending always has instead of blanks —
// the same "DB row wins, env/default is the fallback" shape mailConfig uses.
const mqttConnGetFunc = CORS + `const pool=global.get('pool');
(async()=>{
  const m={}; try{const[r]=await pool.query("SELECT skey,sval FROM platform_settings WHERE skey LIKE 'mqtt.%'"); for(const x of r) m[x.skey]=x.sval;}catch(e){}
  const dec = global.get('decryptSecret');
  msg.headers=__CORS; msg.payload={
    host: m['mqtt.host'] || env.get('MQTT_PUBLIC_HOST') || '27.254.143.144',
    port: m['mqtt.port'] || env.get('MQTT_PUBLIC_PORT') || '1883',
    username: m['mqtt.username'] || env.get('MQTT_PUBLIC_USER') || 'device',
    password: m['mqtt.password'] ? dec(m['mqtt.password']) : (env.get('MQTT_PUBLIC_PASS') || 'iothub.2026'),
    tls: m['mqtt.tls'] === '1',
  }; node.send(msg);})()` + bbErr

const mqttConnPutFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
(async()=>{
  await pool.query(${JSON.stringify(SETTINGS_DDL)});
  const set=async(k,v)=>{ await pool.query("INSERT INTO platform_settings (skey,sval) VALUES (?,?) ON DUPLICATE KEY UPDATE sval=VALUES(sval)",[k, v==null?'':String(v)]); };
  if(b.host!==undefined) await set('mqtt.host', b.host);
  if(b.port!==undefined) await set('mqtt.port', b.port);
  if(b.username!==undefined) await set('mqtt.username', b.username);
  if(b.password) await set('mqtt.password', global.get('encryptSecret')(b.password));
  else if(b.clearPassword) await set('mqtt.password', '');
  if(b.tls!==undefined) await set('mqtt.tls', b.tls ? '1' : '0');
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// POST /api/nodes/:id/send-export — deliver a device's exported data over one
// of the configured channels, with the files attached.
//
// Registered at policy 'node', NOT 'admin': the point of the feature is that
// whoever is looking after a device can send its data on, and a viewer who can
// open the device is exactly that person. guard()'s 'node' policy already
// proves org + product level + department grant + site + per-user visibility
// for this specific device, so reaching this handler at all means the caller
// may read what they are about to send.
//
// The ATTACHMENTS ARE BUILT BY THE BROWSER and posted here as base64. That is
// deliberate: there is no PDF generator anywhere in this backend (checked —
// nothing in the function node's libs, nothing in package.json), while the
// frontend already builds real PDFs with jsPDF for the two Reports pages.
// Generating the CSV here and the PDF there would also mean the emailed PDF
// and the downloaded one could drift apart. The caller sends what it rendered.
//
// Two limits on being used as a mail relay, since this is viewer-reachable:
//   · total attachment bytes are capped, and
//   · every send is written to the audit log with the device, channel and
//     destination, so an abusive pattern is visible rather than invisible.
// The destination is still free-form for email, matching what report
// schedules already allow — the audit row is what makes that accountable.
const sendExportFunc = CORS + `const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
const __ok=(x)=>{msg.headers=__CORS;msg.payload=x;node.send(msg);};
const __err=(code,e)=>{msg.headers=__CORS;msg.statusCode=code;msg.payload={error:e};node.send(msg);};
const ch=String(b.channel||'email');
const to=String(b.to||'').trim();
const subject=String(b.subject||'ONEOPS device export').slice(0,255);
const body=String(b.body||'').slice(0,4000);
const atts=Array.isArray(b.attachments)?b.attachments:[];
if(!atts.length) return __err(400,'nothing to send');
// 12 MB of decoded attachment: comfortably above a year of one device's
// readings as CSV+PDF, comfortably below the 50 MB body Node-RED accepts.
let __bytes=0;
for(const a of atts){ __bytes += Math.floor(String(a.dataBase64||'').length*0.75); }
if(__bytes > 12*1024*1024) return __err(413,'attachments too large (max 12 MB)');
(async()=>{ try{
  const mkBuf=(a)=>Buffer.from(String(a.dataBase64||''),'base64');
  if(ch==='email'){
    if(!to) return __err(400,'recipient required');
    const mc=await global.get('mailConfig')(); if(!mc.transport) return __err(400,'SMTP not configured');
    await mc.transport.sendMail({from:mc.from,to,subject,text:body||subject,
      attachments:atts.map(a=>({filename:String(a.filename||'export'),content:mkBuf(a),contentType:a.contentType||undefined}))});
    global.get('auditLog')(au,'device.export.send',au.orgId,id,{channel:ch,to,files:atts.length,bytes:__bytes});
    return __ok({ok:true,sent:atts.length});
  }
  const nc=await global.get('notifyConfig')();
  if(ch==='telegram'){
    if(!nc.telegramToken) return __err(400,'Telegram bot token not configured');
    const chat=to||nc.telegramChatId; if(!chat) return __err(400,'chat id required');
    // One sendDocument per file: the API takes a single document per call.
    for(const a of atts){
      const fd=new FormData();
      fd.append('chat_id',chat);
      fd.append('caption',(subject+(body?'\\n'+body:'')).slice(0,1024));
      fd.append('document',mkBuf(a),{filename:String(a.filename||'export'),contentType:a.contentType||'application/octet-stream'});
      const r=await fetch('https://api.telegram.org/bot'+nc.telegramToken+'/sendDocument',{method:'POST',body:fd});
      if(!r.ok) return __err(502,'Telegram HTTP '+r.status);
    }
    global.get('auditLog')(au,'device.export.send',au.orgId,id,{channel:ch,to:chat,files:atts.length,bytes:__bytes});
    return __ok({ok:true,sent:atts.length});
  }
  // LINE Notify and Google Chat accept no file attachment on the endpoints
  // this platform uses (LINE Notify takes an image only; the Google Chat
  // webhook takes a text card). Saying so is better than sending a message
  // that silently drops the very files the user asked to attach.
  if(ch==='line'){
    if(!nc.lineToken) return __err(400,'LINE token not configured');
    return __err(400,'LINE Notify cannot carry file attachments — use email or Telegram for the CSV/PDF, or download and share it manually');
  }
  if(ch==='googlechat'){
    if(!nc.googleChatWebhook) return __err(400,'Google Chat webhook not configured');
    return __err(400,'The Google Chat webhook cannot carry file attachments — use email or Telegram for the CSV/PDF');
  }
  return __err(400,'unknown channel');
}catch(e){ __err(502,e.message); } })(); return null;`

const settingsTestFunc = CORS + `const b=msg.payload||{}; const ch=b.channel||'email'; const to=(b.to||'').trim();
const __ok=(x)=>{msg.headers=__CORS;msg.payload=x;node.send(msg);};
const __err=(code,e)=>{msg.headers=__CORS;msg.statusCode=code;msg.payload={error:e};node.send(msg);};
const __TXT='ONEOPS test notification. If you received this, the channel is configured correctly.';
(async()=>{ try{
  if(ch==='email'){
    if(!to) return __err(400,'recipient required');
    const mc=await global.get('mailConfig')(); if(!mc.transport) return __err(400,'SMTP not configured');
    await mc.transport.sendMail({from:mc.from, to, subject:'ONEOPS SMTP test', text:__TXT}); return __ok({ok:true,from:mc.from});
  }
  const nc=await global.get('notifyConfig')();
  if(ch==='telegram'){
    const raw = String(to || nc.telegramChatId || '').trim();
    const at = raw.lastIndexOf('@');
    const tok = at > 0 ? raw.slice(0, at) : (nc.telegramToken || (raw.includes(':') ? raw : ''));
    const chat = at > 0 ? raw.slice(at + 1) : (raw.includes(':') ? (nc.telegramChatId || '') : raw);
    if(!tok) return __err(400,'Telegram bot token not configured in system (enter Bot Token in superadmin or specify Token@ChatID)');
    if(!chat) return __err(400,'Chat ID is required (enter your numeric Chat ID or Group ID -100...)');
    const r=await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:__TXT})});
    const tgRes = await r.json().catch(()=>({}));
    if (r.ok) return __ok({ok:true});
    let errMsg = tgRes.description || ('Telegram HTTP ' + r.status);
    if (r.status === 403) errMsg = 'Telegram Forbidden: bot was blocked or not started — please open your bot in Telegram and press /start first';
    if (r.status === 400 && String(chat).startsWith('@')) errMsg = 'Telegram Chat ID must be a numeric ID (e.g. 581234567 or -100...), not @botname';
    return __err(r.status >= 500 ? 502 : 400, errMsg);
  }
  if(ch==='line'){
    const raw = String(to || nc.lineToken || '').trim();
    const at = raw.lastIndexOf('@');
    const tok = at > 0 ? raw.slice(0, at) : (nc.lineToken || '');
    const lineTo = at > 0 ? raw.slice(at + 1) : (to || '');
    if(!tok) return __err(400,'LINE token not configured in system');
    let r;
    if (tok && lineTo && lineTo.startsWith('U')) {
      r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: lineTo, messages: [{ type: 'text', text: __TXT }] })
      });
    } else {
      r = await fetch('https://notify-api.line.me/api/notify', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'message=' + encodeURIComponent(' ' + __TXT)
      });
    }
    const resData = await r.json().catch(()=>({}));
    if (r.ok) return __ok({ok:true});
    return __err(r.status >= 500 ? 502 : 400, resData.message || ('LINE HTTP ' + r.status));
  }
  if(ch==='googlechat'){
    const url = (to && to.startsWith('http')) ? to : nc.googleChatWebhook;
    if(!url) return __err(400,'Google Chat webhook not configured in system');
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:__TXT})});
    const resData = await r.json().catch(()=>({}));
    if (r.ok) return __ok({ok:true});
    return __err(r.status >= 500 ? 502 : 400, resData.error?.message || ('Google Chat HTTP ' + r.status));
  }
  return __err(400,'unknown channel');
}catch(e){ __err(502,e.message); }})()` + bbErr
const orgsDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const[__o]=await pool.query("SELECT name FROM organizations WHERE id=?",[id]);
  // Node-scoped rows first (they key off node_id, not org_id, so they must go
  // before the org's nodes are removed or they are orphaned forever).
  // node_images arrives with migrate-v27; like the rest it keys off node_id, so
  // it has to go before the org's nodes do or the bytes are orphaned forever.
  const NODE_TABLES=['readings','device_presence','device_logs','edge_alarm_log','offline_sync_log','ota_deployments','documents','dead_letter','node_images'];
  for(const t of NODE_TABLES){
    try{ await pool.query("DELETE FROM "+t+" WHERE node_id IN (SELECT id FROM nodes WHERE org_id=?)",[id]); }
    catch(e){ node.warn('org delete: '+t+' skipped — '+e.message); }   // table may not exist in this deployment
  }
  // Rows keyed by DEPARTMENT rather than org — they must go before departments
  // is emptied, or nothing can find them again. Both arrived after this handler
  // was written (v23 department_themes, v29 department_sites) and neither was
  // ever added here: a re-created org reusing a department id would silently
  // inherit the deleted customer's dashboard and site permissions.
  const DEPT_TABLES=['department_themes','department_sites'];
  for(const t of DEPT_TABLES){
    try{ await pool.query("DELETE FROM "+t+" WHERE org_id=?",[id]); }
    catch(e){ node.warn('org delete: '+t+' skipped — '+e.message); }
  }
  try{ await pool.query("DELETE FROM user_departments WHERE user_id IN (SELECT id FROM users WHERE org_id=?)",[id]); }
  catch(e){ node.warn('org delete: user_departments skipped — '+e.message); }
  // Org-scoped rows. sites/org_logos/display_params/org_theme_grants were all
  // added by later migrations and never listed here.
  const ORG_TABLES=['alarm_events','alarm_rules','nodes','departments','notification_channels','floorplans','report_schedules','event_problems','org_domain_rules','users','org_directory','org_entitlements','sites','org_logos','display_params','org_theme_grants'];
  for(const t of ORG_TABLES){
    try{ await pool.query("DELETE FROM "+t+" WHERE org_id=?",[id]); }
    catch(e){ node.warn('org delete: '+t+' skipped — '+e.message); }
  }
  await pool.query("DELETE FROM organizations WHERE id=?",[id]);
  if(global.get('tenantMode')){ const dbn=global.get('orgDbName')(id); if(dbn) await pool.query('DROP DATABASE IF EXISTS \`'+dbn+'\`'); }
  // Logged AFTER the fact and deliberately last: this is the least reversible
  // action a superadmin can take, and the audit row is all that remains of it.
  global.get('auditLog')(au,'org.delete',id,(__o.length&&__o[0].name)||id,null);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const entGetFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.orgId;
(async()=>{const[r]=await pool.query("SELECT platform FROM org_entitlements WHERE org_id=?",[id]); msg.headers=__CORS; msg.payload=r.map(x=>x.platform); node.send(msg);})()` + bbErr
const entPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.orgId; const list=(msg.payload&&msg.payload.platforms)||[];
(async()=>{
  // Capture the previous set so the audit row records what actually changed,
  // not merely that someone pressed something.
  const[prev]=await pool.query("SELECT platform FROM org_entitlements WHERE org_id=?",[id]);
  const before=prev.map(x=>x.platform);
  await pool.query("DELETE FROM org_entitlements WHERE org_id=?",[id]);
  for(const p of list){ await pool.query("INSERT IGNORE INTO org_entitlements (org_id,platform) VALUES (?,?)",[id,p]); }
  const granted=list.filter(p=>before.indexOf(p)<0), revoked=before.filter(p=>list.indexOf(p)<0);
  if(granted.length||revoked.length) global.get('auditLog')(au,'license.change',id,
    (granted.length?'+'+granted.join(' +'):'')+(granted.length&&revoked.length?' ':'')+(revoked.length?'-'+revoked.join(' -'):''),
    {before,after:list});
  msg.headers=__CORS; msg.payload={ok:true,count:list.length}; node.send(msg);})()` + bbErr

// PUT /api/orgs/:orgId/status — the maintenance kill switch.
//
// A suspended organization is a 403 for every one of its users, at login AND on
// every subsequent request (see guard), while a superadmin keeps full access —
// which is exactly what an incident needs: lock the tenant out, keep working.
//
// Telemetry ingest is deliberately NOT stopped: readpost/MQTT run outside the
// auth guard, so a suspended org keeps recording. Suspending during an incident
// must not silently create a hole in the customer's history.
//
// A dedicated endpoint rather than reusing POST /api/orgs, because that handler
// upserts name/status/logo_url together — flipping status through it with no
// logoUrl in the body would blank the customer's uploaded logo as a side effect.
const orgStatusPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.orgId; const b=msg.payload||{};
const status=String(b.status||'');
if(status!=='active'&&status!=='suspended'){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:"status must be 'active' or 'suspended'"};return msg;}
(async()=>{
  const[r]=await pool.query("SELECT name,status FROM organizations WHERE id=?",[id]);
  if(!r.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'organization not found'};node.send(msg);return;}
  if(r[0].status===status){ msg.headers=__CORS; msg.payload={ok:true,id,status,unchanged:true}; node.send(msg); return; }
  await pool.query("UPDATE organizations SET status=? WHERE id=?",[status,id]);
  global.get('auditLog')(au, status==='suspended'?'org.suspend':'org.resume', id, r[0].name, {from:r[0].status,to:status,reason:b.reason||null});
  msg.headers=__CORS; msg.payload={ok:true,id,status}; node.send(msg);
})()` + bbErr

// PUT /api/orgs/:orgId/3d-fallback {show} — migrate-v33. Whether a device
// with no uploaded photo yet shows the generic 3D model or nothing 3D at
// all. Superadmin-only, mirrors orgStatusPutFunc's shape exactly (no-op when
// unchanged, audit-logged).
const org3dFallbackPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.orgId; const b=msg.payload||{};
const show = b.show ? 1 : 0;
(async()=>{
  let r;
  try{ [r]=await pool.query("SELECT name,show_3d_fallback FROM organizations WHERE id=?",[id]); }
  catch(e){
    if(String(e&&e.message||'').indexOf('show_3d_fallback')<0) throw e;
    msg.headers=__CORS;msg.statusCode=503;msg.payload={error:'this needs migrate-v33 — run the migration first'};node.send(msg);return;
  }
  if(!r.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'organization not found'};node.send(msg);return;}
  if(Number(r[0].show_3d_fallback)===show){ msg.headers=__CORS; msg.payload={ok:true,id,show:!!show,unchanged:true}; node.send(msg); return; }
  await pool.query("UPDATE organizations SET show_3d_fallback=? WHERE id=?",[show,id]);
  global.get('auditLog')(au, show?'org.show3d':'org.hide3d', id, r[0].name, {});
  msg.headers=__CORS; msg.payload={ok:true,id,show:!!show}; node.send(msg);
})()` + bbErr

// GET /api/platform/audit — the real "Recent Changes" feed. ?orgId= narrows it
// to one customer, which is how it is read during an incident.
const auditGetFunc = CORS + `const pool=global.get('pool'); const q=msg.req.query||{};
const orgId=q.orgId?String(q.orgId):''; const limit=Math.min(Number(q.limit)||50,200);
(async()=>{
  let rows=[];
  try{
    const[r]= orgId
      ? await pool.query("SELECT id,actor_id,actor_name,action,org_id,target,detail,at FROM admin_audit WHERE org_id=? ORDER BY at DESC, id DESC LIMIT ?",[orgId,limit])
      : await pool.query("SELECT id,actor_id,actor_name,action,org_id,target,detail,at FROM admin_audit ORDER BY at DESC, id DESC LIMIT ?",[limit]);
    rows=r;
  }catch(e){ if(String(e&&e.message||'').indexOf('admin_audit')<0) throw e; node.warn('admin_audit missing (migrate-v30 not applied yet)'); }
  msg.headers=__CORS; msg.payload=rows; node.send(msg);
})()` + bbErr
const deptListFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{const[r]=await pool.query("SELECT * FROM departments WHERE org_id=? ORDER BY name",[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const deptPostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||'dept-'+Date.now(); await pool.query("INSERT INTO departments (id,org_id,name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)",[id,orgId,b.name]); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr
const deptDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM departments WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  // Detach first. Deleting the row alone left users.department_id (and the
  // department's product_access grants) pointing at a department that no longer
  // exists, so those users kept being filtered by a scope nothing could name and
  // no screen could clear.
  const[cnt]=await pool.query("SELECT COUNT(*) AS n FROM users WHERE department_id=?",[id]);
  await pool.query("UPDATE users SET department_id=NULL WHERE department_id=?",[id]);
  try{ await pool.query("DELETE FROM product_access WHERE scope='department' AND scope_id=?",[id]); }catch(e){ node.warn('dept delete: product_access cleanup skipped: '+e.message); }
  await pool.query("DELETE FROM departments WHERE id=?",[id]);
  msg.headers=__CORS; msg.payload={ok:true, detachedUsers:(cnt[0]||{}).n||0}; node.send(msg);})()` + bbErr
const usrListFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{let r;
  try{ const[x]=await pool.query("SELECT id,org_id,email,username,name,role,department_id,COALESCE(status,'active') AS status FROM users WHERE org_id=? ORDER BY (status='pending') DESC, name",[orgId]); r=x;
       try{ const[m]=await pool.query("SELECT ud.user_id,ud.department_id FROM user_departments ud JOIN users u ON u.id=ud.user_id WHERE u.org_id=?",[orgId]);
            const by={}; for(const x2 of m){ (by[x2.user_id]=by[x2.user_id]||[]).push(x2.department_id); }
            for(const row of r) row.department_ids = by[row.id] || (row.department_id?[row.department_id]:[]);
       }catch(e){ if(String(e&&e.message||'').indexOf('user_departments')<0) throw e;
            for(const row of r) row.department_ids = row.department_id?[row.department_id]:[]; } }
  catch(e){
    try{ const[x]=await pool.query("SELECT id,org_id,email,username,name,role,department_id FROM users WHERE org_id=? ORDER BY name",[orgId]); r=x; }
    catch(e2){ const[x]=await pool.query("SELECT id,org_id,email,name,role,department_id FROM users WHERE org_id=? ORDER BY name",[orgId]); r=x; }
    for(const row of r) { row.status = row.status || 'active'; row.department_ids = row.department_id?[row.department_id]:[]; }
  }
  msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const usrPostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||'u-'+Date.now();
  const uname=(b.username||'').trim()||null;
  if(b.password!==undefined && b.password!==null && String(b.password)!=='' && String(b.password).length<8){
    msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'password too short (min 8)'};node.send(msg);return;
  }
  if(uname){
    const[dup]=await pool.query("SELECT id FROM users WHERE org_id=? AND username=? AND id<>?",[orgId,uname,id]);
    if(dup.length){msg.headers=__CORS;msg.statusCode=409;msg.payload={error:'that username is already taken in this organization'};node.send(msg);return;}
  }

  let prevUser = null;
  try {
    const [prev] = await pool.query("SELECT id, status, email, name, role FROM users WHERE id=?", [id]);
    if (prev.length) prevUser = prev[0];
  } catch(e) {}

  const targetStatus = b.status || 'active';

  try{
    await pool.query("INSERT INTO users (id,org_id,email,username,name,role,department_id,status) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),username=VALUES(username),name=VALUES(name),role=VALUES(role),department_id=VALUES(department_id),status=VALUES(status)",[id,orgId,b.email||null,uname,b.name,b.role||'viewer',b.departmentId||null,targetStatus]);
    if(b.password){ await pool.query("UPDATE users SET password_hash=? WHERE id=?",[await bcrypt.hash(String(b.password),10), id]); }
    if(Array.isArray(b.departmentIds)){
      try{
        await pool.query("DELETE FROM user_departments WHERE user_id=?",[id]);
        for(const d of b.departmentIds){ if(d) await pool.query("INSERT IGNORE INTO user_departments (user_id,department_id) VALUES (?,?)",[id,d]); }
        await pool.query("UPDATE users SET department_id=? WHERE id=?",[b.departmentIds[0]||null,id]);
      }catch(e){ if(String(e&&e.message||'').indexOf('user_departments')<0) throw e; node.warn('users: user_departments missing (migrate-v25 not applied) — kept the first department only'); }
    }
  }catch(e){
    if(String(e&&e.message||'').indexOf('status')>=0 || String(e&&e.message||'').indexOf('username')>=0) {
      await pool.query("INSERT INTO users (id,org_id,email,name,role,department_id) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),role=VALUES(role),department_id=VALUES(department_id)",[id,orgId,b.email||null,b.name,b.role||'viewer',b.departmentId||null]);
    } else throw e;
  }

  const isNewlyActivated = (!prevUser && targetStatus === 'active') || (prevUser && prevUser.status === 'pending' && targetStatus === 'active');
  if (isNewlyActivated && b.email) {
    let deptNamesStr = '';
    if (Array.isArray(b.departmentIds) && b.departmentIds.length) {
      try {
        const [drows] = await pool.query("SELECT name FROM departments WHERE id IN (?)", [b.departmentIds]);
        deptNamesStr = drows.map(d=>d.name).join(', ');
      } catch(e) {}
    }
    global.get('notifyUserActivated')(pool, orgId, { name: b.name, email: b.email, username: uname, role: b.role||'viewer' }, deptNamesStr);
  }

  // Admin created this user directly with status "Pending Approval" — the user
  // themselves has no other way to learn the account exists until approved.
  const isNewlyPending = !prevUser && targetStatus === 'pending';
  if (isNewlyPending && b.email) {
    global.get('notifyUserPendingApproval')(pool, orgId, { name: b.name, email: b.email });
  }

  // Always mirror user into tenant DB if tenant DB exists
  await global.get('mirrorUserToTenantDb')(pool, orgId, { id, departmentId: b.departmentId||(Array.isArray(b.departmentIds)?b.departmentIds[0]:null), email: b.email, phone: b.phone, name: b.name, role: b.role||'viewer', status: targetStatus, passwordHash: b.password ? await bcrypt.hash(String(b.password),10) : (prevUser?prevUser.password_hash:null) });

  msg.headers=__CORS; msg.payload={ok:true,id,status:targetStatus}; node.send(msg);})()` + bbErr
const usrDelFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM users WHERE id=?",[id]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  await pool.query("DELETE FROM users WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const paGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const q=msg.req.query||{}; const scope=q.scope||'department'; const scopeId=q.scopeId||'';
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM "+(scope==='user'?'users':'departments')+" WHERE id=?",[scopeId]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  const[r]=await pool.query("SELECT domain,level FROM product_access WHERE scope=? AND scope_id=?",[scope,scopeId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const paPutFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const b=msg.payload||{};
if(!b.scope||!b.scopeId||!b.domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'scope, scopeId, domain required'};return msg;}
(async()=>{const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM "+(b.scope==='user'?'users':'departments')+" WHERE id=?",[b.scopeId]); if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  // 'inherit' is the ABSENCE of a row, not a level. The Product Access tab sent
  // level:'none' for it, which wrote an explicit deny — so putting a user back
  // to "Inherit (dept: manage)" silently locked them out of the product their
  // department grants. There was no delete path at all.
  if(b.level==='inherit'||b.level===null||b.level===''){
    await pool.query("DELETE FROM product_access WHERE scope=? AND scope_id=? AND domain=?",[b.scope,b.scopeId,b.domain]);
    msg.headers=__CORS; msg.payload={ok:true,inherited:true}; node.send(msg); return;
  }
  const LV=['none','view','manage']; if(LV.indexOf(String(b.level))<0){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'level must be none, view, manage or inherit'};node.send(msg);return;}
  await pool.query("INSERT INTO product_access (scope,scope_id,domain,level) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level)",[b.scope,b.scopeId,b.domain,b.level]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// GET /api/orgs/:orgId/product-access — the WHOLE org's grid in one call.
// paGet answers for a single scopeId, and the Product Access tab never called
// it: it rendered every cell from React state that started empty, so an admin
// reloading the page saw "none" everywhere and "Inherit" for every user no
// matter what was stored. The screen forgot the policy it had just saved.
const paOrgGetFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const orgId=msg.req.params.orgId;
if(au.role!=='superadmin' && orgId!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};return msg;}
(async()=>{
  const[d]=await pool.query("SELECT id FROM departments WHERE org_id=?",[orgId]);
  const[u]=await pool.query("SELECT id FROM users WHERE org_id=?",[orgId]);
  const byDept={}, byUser={};
  const load=async(scope,ids,out)=>{
    if(!ids.length) return;
    const[r]=await pool.query("SELECT scope_id,domain,level FROM product_access WHERE scope=? AND scope_id IN (?)",[scope,ids]);
    for(const x of r){ (out[x.scope_id]=out[x.scope_id]||{})[x.domain]=x.level; }
  };
  await load('department', d.map(x=>x.id), byDept);
  await load('user', u.map(x=>x.id), byUser);
  msg.headers=__CORS; msg.payload={departments:byDept, users:byUser}; node.send(msg);
})()` + bbErr
const nodeProvFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.id||!b.orgId||!b.domain||!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'id, orgId, domain, name required'};return msg;}
const __NODE_SQL="INSERT INTO nodes (id,org_id,site_id,department_id,domain,name,mqtt_prefix,lat,lng) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE site_id=VALUES(site_id),department_id=VALUES(department_id),domain=VALUES(domain),name=VALUES(name),mqtt_prefix=VALUES(mqtt_prefix),lat=VALUES(lat),lng=VALUES(lng)";
const __NODE_ARGS=[b.id,b.orgId,b.siteId||null,b.departmentId||null,b.domain,b.name,b.mqttPrefix||null,b.lat??null,b.lng??null];
(async()=>{
  // control DB: node row doubles as the nodeId→org_id routing index for ingest.
  await pool.query(__NODE_SQL,__NODE_ARGS);
  // org DB: authoritative node row. When TENANT_DB_MODE is off resolvePool()===pool
  // so we skip the duplicate write.
  const opool=global.get('resolvePool')(b.orgId);
  if(opool!==pool) await opool.query(__NODE_SQL,__NODE_ARGS);
  // Seed the node's alarm rule from the org+domain default (set at provision), if any.
  // Tolerate a missing org_domain_rules table (migrate-v16 not yet run) — just skip.
  try {
    const[dr]=await opool.query("SELECT rule_json,debounce_json FROM org_domain_rules WHERE org_id=? AND domain=?",[b.orgId,b.domain]);
    if(dr.length){
      const rj=typeof dr[0].rule_json==='string'?dr[0].rule_json:JSON.stringify(dr[0].rule_json);
      const dj=dr[0].debounce_json==null?null:(typeof dr[0].debounce_json==='string'?dr[0].debounce_json:JSON.stringify(dr[0].debounce_json));
      await opool.query("INSERT IGNORE INTO alarm_rules (node_id,org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?,?)",[b.id,b.orgId,b.domain,rj,dj,'provision-default']);
    }
  } catch(e){ node.warn('provision: rule seed skipped for '+b.id+': '+e.message); }
  msg.headers=__CORS; msg.payload={ok:true,id:b.id}; node.send(msg);})()` + bbErr

// --- Zero-touch onboarding: list/approve/reject auto-registered PENDING nodes ---
// The Go worker auto-creates a 'pending' node (in the control routing index) on
// first telemetry from an unknown device. These handlers run on the CONTROL pool
// (pending nodes live only there until approved); approve additionally writes the
// active node into the org DB for tenant-mode fleet queries.
// Superadmins see EVERY pending device across all orgs — including orphans parked
// in the '__unassigned__' pool (topic org didn't match a real org). A tenant admin
// sees only their own org's pending devices. last_sample lets the admin sanity-check
// the readings before approving; org_name identifies orphans for reassignment.
const pendingListFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const sup=au.role==='superadmin';
(async()=>{
  const qOrg = msg.req.query && msg.req.query.orgId;
  let where, params;
  if(sup){ if(qOrg){ where='n.org_id=?'; params=[qOrg]; } else { where='1=1'; params=[]; } }
  else { where='n.org_id=?'; params=[au.orgId]; }
  const[r]=await pool.query("SELECT n.id,n.org_id,o.name AS org_name,n.domain,n.name,n.mqtt_prefix,n.first_seen,p.last_seen,p.online,p.last_sample FROM nodes n LEFT JOIN organizations o ON o.id=n.org_id LEFT JOIN device_presence p ON p.node_id=n.id WHERE "+where+" AND n.status='pending' ORDER BY n.first_seen DESC",params);
  msg.headers=__CORS; msg.payload=r; node.send(msg);
})()` + bbErr

const approveFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{}; const sup=au.role==='superadmin';
(async()=>{
  const[n]=await pool.query("SELECT * FROM nodes WHERE id=? AND status='pending'",[id]);
  if(!n.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'pending node not found'};node.send(msg);return;}
  const nd=n[0];
  if(!sup && nd.org_id!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};node.send(msg);return;}
  // Target org: a superadmin may reassign the device (a device belongs to exactly
  // one org) — required to claim an '__unassigned__' orphan. A tenant admin can
  // only keep it in their own org. Validate the target is a real, active org so a
  // device can never be approved into the suspended '__unassigned__' pool.
  const targetOrg = (sup && b.orgId) ? b.orgId : nd.org_id;
  const[o]=await pool.query("SELECT id FROM organizations WHERE id=? AND status='active'",[targetOrg]);
  if(!o.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'select a valid active organization for this device'};node.send(msg);return;}
  const reassigned = targetOrg!==nd.org_id;
  const name=b.name||nd.name; const domain=b.domain||nd.domain;
  // A reassigned device loses its old-org department unless a new one is given.
  const dept=(b.departmentId!==undefined)?(b.departmentId||null):(reassigned?null:nd.department_id);
  const lat=(b.lat!==undefined)?b.lat:nd.lat; const lng=(b.lng!==undefined)?b.lng:nd.lng;
  // mergeInto: approve this feed as the SECOND topic of an asset that is already
  // on the fleet (a transformer whose power meter and box sensor publish under
  // different node ids). Validated here rather than trusted: the target must be
  // a real, active, non-merged node in the same org, or the readings would be
  // redirected onto something that cannot be opened.
  let mergeInto = null;
  if (b.mergeInto) {
    if (b.mergeInto === id) { msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'a device cannot merge into itself'}; node.send(msg); return; }
    let m;
    try { const[x]=await pool.query("SELECT id FROM nodes WHERE id=? AND org_id=? AND status='active' AND merge_into IS NULL",[b.mergeInto,targetOrg]); m=x; }
    catch(e){
      if(String(e&&e.message||'').indexOf('merge_into')<0) throw e;
      msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'multi-topic merging needs migrate-v20; approve without a second feed, or run the migration first'}; node.send(msg); return;
    }
    if(!m.length){ msg.headers=__CORS; msg.statusCode=400; msg.payload={error:'merge target must be an active device in the same organization'}; node.send(msg); return; }
    mergeInto = b.mergeInto;
  }
  // Only touch merge_into when it is actually being set: on a pre-v20 schema an
  // ordinary approval must still work, and that is the common case.
  try { await pool.query("UPDATE nodes SET status='active', org_id=?, name=?, domain=?, department_id=?, lat=?, lng=?, merge_into=? WHERE id=?",[targetOrg,name,domain,dept,lat??null,lng??null,mergeInto,id]); }
  catch(e){
    if(String(e&&e.message||'').indexOf('merge_into')<0) throw e;
    node.warn('approve: nodes.merge_into missing (migrate-v20 not applied yet) — approving '+id+' without it');
    await pool.query("UPDATE nodes SET status='active', org_id=?, name=?, domain=?, department_id=?, lat=?, lng=? WHERE id=?",[targetOrg,name,domain,dept,lat??null,lng??null,id]);
  }
  // DB-per-tenant: ensure the TARGET org DB has the (now active) node row.
  const opool=global.get('resolvePool')(targetOrg);
  // merge_into rides along: GET /api/fleet reads from the ORG database and hides
  // secondary feeds with "merge_into IS NULL", so leaving it out of the mirror
  // listed a merged feed as its own device for every tenant-mode org.
  if(opool!==pool){
    try {
      await opool.query("INSERT INTO nodes (id,org_id,site_id,department_id,domain,name,mqtt_prefix,lat,lng,status,merge_into) VALUES (?,?,?,?,?,?,?,?,?,'active',?) ON DUPLICATE KEY UPDATE org_id=VALUES(org_id),department_id=VALUES(department_id),domain=VALUES(domain),name=VALUES(name),mqtt_prefix=VALUES(mqtt_prefix),lat=VALUES(lat),lng=VALUES(lng),status='active',merge_into=VALUES(merge_into)",[id,targetOrg,nd.site_id||null,dept,domain,name,nd.mqtt_prefix||null,lat??null,lng??null,mergeInto]);
    } catch(e) {
      if(String(e&&e.message||'').indexOf('merge_into')<0) throw e;
      node.warn('approve: org DB has no merge_into yet (migrate-v20 not applied there) — mirroring '+id+' without it');
      await opool.query("INSERT INTO nodes (id,org_id,site_id,department_id,domain,name,mqtt_prefix,lat,lng,status) VALUES (?,?,?,?,?,?,?,?,?,'active') ON DUPLICATE KEY UPDATE org_id=VALUES(org_id),department_id=VALUES(department_id),domain=VALUES(domain),name=VALUES(name),mqtt_prefix=VALUES(mqtt_prefix),lat=VALUES(lat),lng=VALUES(lng),status='active'",[id,targetOrg,nd.site_id||null,dept,domain,name,nd.mqtt_prefix||null,lat??null,lng??null]);
    }
  }
  // Seed this node's alarm rule from the org+domain default (set at provision), if any.
  // Tolerate a missing org_domain_rules table (migrate-v16 not yet run) — just skip.
  try {
    const[dr]=await opool.query("SELECT rule_json,debounce_json FROM org_domain_rules WHERE org_id=? AND domain=?",[targetOrg,domain]);
    if(dr.length){
      const rj=typeof dr[0].rule_json==='string'?dr[0].rule_json:JSON.stringify(dr[0].rule_json);
      const dj=dr[0].debounce_json==null?null:(typeof dr[0].debounce_json==='string'?dr[0].debounce_json:JSON.stringify(dr[0].debounce_json));
      await opool.query("INSERT IGNORE INTO alarm_rules (node_id,org_id,domain,rule_json,debounce_json,updated_by) VALUES (?,?,?,?,?,?)",[id,targetOrg,domain,rj,dj,'provision-default']);
    }
  } catch(e){ node.warn('approve: rule seed skipped for '+id+': '+e.message); }
  // Link the transformer model chosen on approval (migrate-v32), so a
  // factory-run device carries its real spec from the moment it goes active
  // instead of every field reading "Not entered" until someone opens its
  // detail page and types the same manufacturer/kVA/voltage in by hand.
  // Tolerant of a missing catalog table/row the same way the rule seed above
  // is — approval must still succeed even if the model picked doesn't
  // validate for some reason.
  if(domain==='transformer' && b.modelId){
    try{
      const[m]=await opool.query("SELECT id FROM transformer_models WHERE id=? AND org_id=?",[b.modelId,targetOrg]);
      if(m.length){
        await opool.query("INSERT INTO node_nameplates (node_id,model_id,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE model_id=VALUES(model_id),updated_by=VALUES(updated_by)",[id,b.modelId,au.name||au.userId||'approve']);
      } else node.warn('approve: modelId '+b.modelId+' not found in org '+targetOrg+' — approved '+id+' without a nameplate link');
    }catch(e){ node.warn('approve: nameplate model link skipped for '+id+': '+e.message); }
  }
  msg.headers=__CORS; msg.payload={ok:true,id,orgId:targetOrg}; node.send(msg);
})()` + bbErr

const rejectFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id;
(async()=>{
  const[n]=await pool.query("SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!n.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found'};node.send(msg);return;}
  if(au.role!=='superadmin' && n[0].org_id!==au.orgId){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'outside your organization'};node.send(msg);return;}
  // Mark rejected (not delete) so the worker's INSERT IGNORE won't re-create it.
  await pool.query("UPDATE nodes SET status='rejected' WHERE id=?",[id]);
  msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);
})()` + bbErr

// PUT /api/nodes/:id/merge {mergeInto} — pair (or unpair) an already-approved
// feed with the device it belongs to, for the case an admin approved both halves
// of a two-topic transformer before realising they were one asset. Body
// {mergeInto:null} splits them back into standalone devices; nothing is deleted
// either way, so this is reversible.
const mergeFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const id=msg.req.params.id; const b=msg.payload||{};
(async()=>{
  const chk=await global.get('ownOrg')(au,pool,"SELECT org_id FROM nodes WHERE id=?",[id]);
  if(!chk.ok){msg.headers=__CORS;msg.statusCode=chk.code;msg.payload={error:chk.error};node.send(msg);return;}
  try { await pool.query("SELECT merge_into FROM nodes LIMIT 1"); }
  catch(e){ msg.headers=__CORS; msg.statusCode=503; msg.payload={error:'multi-topic merging needs migrate-v20 — run the migration first'}; node.send(msg); return; }
  const tgt = b.mergeInto || null;
  if(tgt){
    if(tgt===id){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'a device cannot merge into itself'};node.send(msg);return;}
    // Same guard as approve: active, same org, and not itself a secondary — the
    // worker follows merge_into exactly one hop, so a chain would strand data on
    // a node the fleet never lists.
    const[m]=await pool.query("SELECT id FROM nodes WHERE id=? AND org_id=? AND status='active' AND merge_into IS NULL",[tgt,chk.orgId]);
    if(!m.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'merge target must be an active device in the same organization'};node.send(msg);return;}
    // Refuse if this node is itself a primary for someone else, for the same reason.
    const[kids]=await pool.query("SELECT id FROM nodes WHERE merge_into=? LIMIT 1",[id]);
    if(kids.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'this device already has feeds merged into it'};node.send(msg);return;}
  }
  await pool.query("UPDATE nodes SET merge_into=? WHERE id=?",[tgt,id]);
  // Mirror into the org database for the same reason approve does — the fleet
  // reads merge_into from there, so a control-only write would leave the pairing
  // invisible to the very screen it exists for.
  const opool=global.get('resolvePool')(chk.orgId);
  if(opool!==pool){ try{ await opool.query("UPDATE nodes SET merge_into=? WHERE id=?",[tgt,id]); }catch(e){ node.warn('merge tenant mirror failed for '+id+': '+e.message); } }
  msg.headers=__CORS; msg.payload={ok:true, id, mergeInto:tgt}; node.send(msg);
})()` + bbErr

// POST /api/nodes/move {nodeIds:[...], targetOrgId} — superadmin only. Moves
// every listed device in one call so a merged group (a primary and its
// second feeds) moves together rather than one at a time, which would leave
// the group split across two organizations mid-operation. A device whose
// merge_into points OUTSIDE the list is refused up front — silently clearing
// that link would strand the OTHER half of the pair, and silently moving it
// too would move a device the caller never asked for.
const nodesMoveFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const b=msg.payload||{};
(async()=>{
  const ids=Array.isArray(b.nodeIds)?b.nodeIds.filter(Boolean):[];
  const targetOrgId=String(b.targetOrgId||'');
  if(!ids.length||!targetOrgId){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nodeIds (non-empty array) and targetOrgId are required'};node.send(msg);return;}
  const idSet=new Set(ids);
  const[rows]=await pool.query("SELECT id,merge_into FROM nodes WHERE id IN (?)",[ids]);
  const found=new Set(rows.map(r=>r.id));
  const missing=ids.filter(i=>!found.has(i));
  if(missing.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'not found: '+missing.join(', ')};node.send(msg);return;}
  const strandedBy=rows.find(r=>r.merge_into && !idSet.has(r.merge_into));
  if(strandedBy){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:strandedBy.id+' is a second feed of '+strandedBy.merge_into+', which is not in this move — include it too, or unlink '+strandedBy.id+' first'};node.send(msg);return;}
  const results=[];
  for(const id of ids){ results.push(await global.get('moveNodeToOrg')(id,targetOrgId,au.name||au.userId||'superadmin')); }
  const ok=results.every(r=>r.ok);
  msg.headers=__CORS; msg.statusCode=ok?200:207; msg.payload={ok,results}; node.send(msg);
})()` + bbErr

// POST /api/nodes/repair-orphans {nodeIds:[...], dryRun?:true} — superadmin
// only. Finds per-device rows stranded in the CONTROL database for devices
// that now live in a tenant database, and pulls them across.
//
// dryRun defaults to TRUE: this touches historical data, so the caller has
// to ask for the write explicitly ({dryRun:false}) rather than discovering
// it moved several thousand rows by accident. A dry run reports exactly what
// it WOULD move, per table, which is also the answer to "is anything even
// stranded?" — usually the first thing worth knowing.
const nodesRepairFunc = CORS + `const pool=global.get('pool'); const au=msg.auth||{}; const b=msg.payload||{};
(async()=>{
  const ids=Array.isArray(b.nodeIds)?b.nodeIds.filter(Boolean):[];
  if(!ids.length){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'nodeIds (non-empty array) is required'};node.send(msg);return;}
  const dryRun = b.dryRun===false ? false : true;
  const results=[];
  for(const id of ids){ results.push(await global.get('repairNodeOrphans')(id, au.name||au.userId||'superadmin', dryRun)); }
  const ok=results.every(r=>r.ok);
  const total=results.reduce((a,r)=>a+(r.total||0),0);
  msg.headers=__CORS; msg.statusCode=ok?200:207; msg.payload={ok,dryRun,total,results}; node.send(msg);
})()` + bbErr

const flow = [
  { id: 'be', type: 'tab', label: 'ONEOPS Node-RED Backend (all-in-one)' },
  { id: 'wslistener', type: 'websocket-listener', path: '/ws/telemetry', wholemsg: 'false' },
  // Complete mqtt-broker config node — a minimal one (host/port/clientid only) makes
  // Node-RED 4.x mark it invalid, so mqtt in/out show "Server: invalid configuration
  // node". Host/port use ${ENV} so the deployment's MQTT_BROKER_HOST/PORT win at
  // runtime (falls back to the generator constants for local/standalone runs).
  { id: 'mqttbroker', type: 'mqtt-broker', name: 'broker',
    broker: '${MQTT_BROKER_HOST}', port: '${MQTT_BROKER_PORT}', clientid: 'nr-backend',
    autoConnect: true, usetls: false, protocolVersion: '4', keepalive: '60', cleansession: true, autoUnsubscribe: true,
    birthTopic: '', birthQos: '0', birthRetain: 'false', birthPayload: '', birthMsg: {},
    closeTopic: '', closeQos: '0', closeRetain: 'false', closePayload: '', closeMsg: {},
    willTopic: '', willQos: '0', willRetain: 'false', willPayload: '', willMsg: {},
    userProps: '', sessionExpiry: '' },

  // init
  { id: 'startup', type: 'inject', z: 'be', name: 'startup', props: [], once: true, onceDelay: '0.2', repeat: '', x: 130, y: 60, wires: [['init']] },
  fn('init', 'init pool + engine + guard', initFunc, 340, 60, [[]], 1, { libs: INIT_LIBS }),

  // ingest pipeline
  { id: 'mqttin', type: 'mqtt in', z: 'be', name: MQTT_TOPIC, topic: MQTT_TOPIC, qos: '0', datatype: 'auto-detect', broker: 'mqttbroker', x: 130, y: 140, wires: [['normalize', 'dbgMqttIn']] },
  { id: 'dbgMqttIn', type: 'debug', z: 'be', name: 'mqtt RX', active: true, complete: 'true', x: 310, y: 100, wires: [] },
  
  // downlink publisher: topic/qos/retain taken from each msg (config/cmd/ota)
  { id: 'mqttout', type: 'mqtt out', z: 'be', name: 'downlink', topic: '', qos: '', retain: '', broker: 'mqttbroker', x: 980, y: 470, wires: [] },
  { id: 'dbgMqttOut', type: 'debug', z: 'be', name: 'mqtt TX', active: true, complete: 'true', x: 980, y: 430, wires: [] },

  fn('normalize', 'normalize (readings | presence | logs | edge-alarm)', normalizeFunc, 330, 140, [['ingest'], ['presence'], ['devlog'], ['edgealarm']], 4),
  fn('ingest', 'ingest + evaluate + persist', ingestFunc, 560, 160, [['dbgIngest'], ['wsbroadcast'], [], ['mqttout', 'dbgMqttOut']], 4, { libs: LIBS }),
  { id: 'mqttalarms', type: 'mqtt in', z: 'be', name: 'internal/alarms/live/#', topic: 'internal/alarms/live/#', qos: '0', datatype: 'json', broker: 'mqttbroker', x: 130, y: 180, wires: [['stormbatch', 'wsbroadcast']] },
  fn('stormbatch', 'storm digest (10s window)', stormBatchFunc, 560, 200, [['notify']], 1),
  fn('notify', 'notify (Email/LINE/Telegram/GChat · per-tenant)', notifyFunc, 820, 200, [[]], 1, { libs: NOTIFY_LIBS }),
  // Personal (per-user) alarm delivery — separate topic/batch/notify from the
  // org-wide trio above, so a personal breach never mixes into the
  // org/department storm digest or broadcast. See worker/main.go's
  // evaluatePersonalAlarms (publisher) and notifyPersonalFunc's own comment.
  { id: 'mqttpersonalalarms', type: 'mqtt in', z: 'be', name: 'internal/alarms/personal/#', topic: 'internal/alarms/personal/#', qos: '0', datatype: 'json', broker: 'mqttbroker', x: 130, y: 240, wires: [['personalstormbatch']] },
  fn('personalstormbatch', 'personal storm digest (10s window)', personalStormBatchFunc, 560, 260, [['notifypersonal']], 1),
  fn('notifypersonal', 'notify personal (single user, own channels only)', notifyPersonalFunc, 820, 260, [[]], 1, { libs: NOTIFY_LIBS }),
  // WebSocket bridge → frontend useMqttTelemetry (NEXT_PUBLIC_WS_URL)
  fn('wsbroadcast', 'ws broadcast (per-org fan-out)', wsBroadcastFunc, 820, 280, [['wsout']], 1),
  { id: 'wsout', type: 'websocket out', z: 'be', name: 'telemetry ws', server: 'wslistener', client: '', x: 1030, y: 280, wires: [] },
  // WS auth: client sends {token} on connect → wsAuth maps its socket to an org so
  // wsBroadcast fans each frame out only to that org's sockets (no cross-org leak).
  { id: 'wsin', type: 'websocket in', z: 'be', name: 'ws auth in', server: 'wslistener', client: '', x: 820, y: 340, wires: [['wsauth']] },
  fn('wsauth', 'ws auth (token → session org)', wsAuthFunc, 1030, 340, [[]], 1, { libs: WS_AUTH_LIBS }),
  { id: 'dbgIngest', type: 'debug', z: 'be', name: 'ingest', active: true, complete: 'payload', x: 830, y: 140, wires: [] },

  // node metadata cache: lets wsBroadcast apply the same department/site/
  // product-access checks the REST 'node' guard does, without a DB query on
  // every telemetry frame.
  { id: 'nmtick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 470, wires: [['nodemetasweep']] },
  fn('nodemetasweep', 'node meta cache sweep', nodeMetaSweepFunc, 350, 470, [[]], 1, { libs: LIBS }),

  // presence: heartbeat/status → device_presence (last_seen, online)
  fn('presence', 'presence upsert', presenceFunc, 560, 80, [[]], 1, { libs: LIBS }),
  // device logs: P/diag/log + P/ota/progress → device_logs
  fn('devlog', 'device log store', devlogFunc, 560, 20, [[]], 1, { libs: LIBS }),
  // edge alarm persistence: P/alarm/{sid} → edge_alarm_log
  // Wired to notify + wsbroadcast: an alarm the firmware raised has to reach
  // the same places a cloud-evaluated one does. This used to be [[]] — a dead
  // end that wrote edge_alarm_log and stopped.
  fn('edgealarm', 'edge alarm persist + surface', edgeAlarmFunc, 560, -40, [['notify', 'wsbroadcast']], 1, { libs: LIBS }),

  // global error catch → dead-letter (persist + warn); robustness
  { id: 'catchall', type: 'catch', z: 'be', name: 'catch all', scope: null, uncaught: false, x: 130, y: 540, wires: [['deadletter']] },
  fn('deadletter', 'dead-letter', deadLetterFunc, 350, 540, [[]], 1, { libs: LIBS }),

  // retention: hourly rollup + purge of raw readings
  { id: 'rettick', type: 'inject', z: 'be', name: 'hourly', props: [], repeat: '3600', x: 130, y: 600, wires: [['retention']] },
  fn('retention', 'readings retention', retentionFunc, 350, 600, [[]], 1, { libs: LIBS }),

  // scheduled reports: cron → CSV → email
  { id: 'rpttick', type: 'inject', z: 'be', name: 'every 15m', props: [], repeat: '900', x: 130, y: 660, wires: [['reportrun']] },
  fn('reportrun', 'report scheduler', reportRunFunc, 350, 660, [[]], 1, { libs: REPORT_LIBS }),

  // escalation loop
  { id: 'esctick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 260, wires: [['escalate']] },
  fn('escalate', 'escalation scan', escalationFunc, 350, 260, [['notify']], 1, { libs: LIBS }),

  // Presence sweep: telemetry silent > LINK_LOST_AFTER_S → LINK_LOST on the
  // connectivity timeline; unseen > OFFLINE_AFTER_S → CRITICAL offline + notify.
  // 10s, not 30s: with a 30s tick the stage-1 window (20s) and the offline
  // window (45s) can land in the same pass, which is what made LINK_LOST and
  // DEVICE_OFFLINE appear together. The sweep is two indexed queries per org.
  { id: 'offtick', type: 'inject', z: 'be', name: 'every 10s', props: [], repeat: '10', x: 130, y: 330, wires: [['offlinesweep']] },
  fn('offlinesweep', 'offline sweep', offlineSweepFunc, 350, 330, [['notify']], 1, { libs: LIBS }),

  // auto-clear sweep: close events whose param returned to NORMAL (spec §9)
  { id: 'cleartick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 400, wires: [['clearsweep']] },
  fn('clearsweep', 'auto-clear sweep', clearSweepFunc, 350, 400, [['mqttout', 'dbgMqttOut']], 1, { libs: LIBS }),

  // REST API (each endpoint = http in → fn → http response)
  ...endpoint('health', 'get', '/api/health', healthFunc, 'public'),
  ...endpoint('login', 'post', '/api/auth/login', loginFunc, 'public'),
  ...endpoint('register', 'post', '/api/auth/register', registerFunc, 'public'),
  ...endpoint('forgot', 'post', '/api/auth/forgot', forgotFunc, 'public'),
  ...endpoint('reset', 'post', '/api/auth/reset', resetFunc, 'public'),
  ...endpoint('password', 'put', '/api/auth/password', passwordFunc, 'auth'),
  ...endpoint('directoryget', 'get', '/api/orgs/:orgId/directory', directoryGetFunc, 'admin'),
  ...endpoint('directorypost', 'post', '/api/orgs/:orgId/directory', directoryPostFunc, 'admin'),
  ...endpoint('directorydel', 'delete', '/api/orgs/:orgId/directory', directoryDelFunc, 'admin'),
  ...endpoint('floorplanget', 'get', '/api/orgs/:orgId/floorplans', floorplanGetFunc, 'org'),
  ...endpoint('floorplanput', 'put', '/api/orgs/:orgId/floorplans', floorplanPutFunc, 'admin'),
  ...endpoint('fpimagepost', 'post', '/api/orgs/:orgId/floorplans/:floorId/image', fpImagePostFunc, 'admin'),
  ...endpoint('fpimageget', 'get', '/api/orgs/:orgId/floorplans/:floorId/image', fpImageGetFunc, 'org'),
  ...endpoint('branding', 'put', '/api/orgs/:orgId/branding', brandingPutFunc, 'admin'),
  ...endpoint('orglogoget', 'get', '/api/orgs/:orgId/logo', orgLogoGetFunc, 'org'),
  // Public counterpart for the pre-login branded page — see orgLogoPublicFunc.
  ...endpoint('orglogopub', 'get', '/api/public/orgs/:orgId/logo', orgLogoPublicFunc, 'public'),
  // Same handler — the Settings page saves the factory pin to /location.
  ...endpoint('orglocation', 'put', '/api/orgs/:orgId/location', brandingPutFunc, 'admin'),
  ...endpoint('aiquery', 'post', '/api/ai/query', aiQueryFunc, 'auth'),
  ...endpoint('reportsdl', 'get', '/api/reports/download', reportsDownloadFunc, 'auth'),
  ...endpoint('getrule', 'get', '/api/nodes/:id/rule', getRuleFunc, 'node'),
  ...endpoint('putrule', 'put', '/api/nodes/:id/rule', putRuleFunc, 'node:manage'),
  ...endpoint('orgrule', 'put', '/api/orgs/:orgId/rule', orgRuleFunc, 'admin'),
  // Read back what the PUT above stored, so the editor shows the live values.
  ...endpoint('orgruleget', 'get', '/api/orgs/:orgId/rule', orgRuleGetFunc, 'admin'),
  // Bulk-apply to one department's (or one user's own department's) devices
  // only — never touches org_domain_rules, unlike orgrule above.
  ...endpoint('orgruledept', 'put', '/api/orgs/:orgId/rule/department', orgRuleDepartmentFunc, 'admin'),
  // Personal (per-user) thresholds — independent of the shared rule above.
  // 'node', not 'node:manage': every role with view access to this device
  // may read/write their OWN personal alert, not just an admin.
  ...endpoint('personalruleget', 'get', '/api/nodes/:id/personal-rule', getPersonalRuleFunc, 'node'),
  ...endpoint('personalruleput', 'put', '/api/nodes/:id/personal-rule', putPersonalRuleFunc, 'node'),
  // Admin-configurable multi-parameter trend charts (migrate-v47). Any signed-in
  // viewer with access to the device may read the charts an admin configured;
  // only 'node:manage' may create/edit/delete them.
  ...endpoint('chartsget', 'get', '/api/nodes/:id/charts', chartsGetFunc, 'node'),
  ...endpoint('chartspost', 'post', '/api/nodes/:id/charts', chartsPostFunc, 'node:manage'),
  ...endpoint('chartsput', 'put', '/api/nodes/:id/charts/:chartId', chartsPutFunc, 'node:manage'),
  ...endpoint('chartsdel', 'delete', '/api/nodes/:id/charts/:chartId', chartsDelFunc, 'node:manage'),
  ...endpoint('events', 'get', '/api/nodes/:id/events', getEventsFunc, 'node'),
  ...endpoint('orgalarms', 'get', '/api/orgs/:orgId/alarms', orgAlarmsGetFunc, 'org'),
  ...endpoint('transport', 'get', '/api/nodes/:id/transport', transportFunc, 'node'),
  ...endpoint('ack', 'post', '/api/events/:id/ack', ackFunc, 'event:view'),
  ...endpoint('readget', 'get', '/api/nodes/:id/readings', readingsGetFunc, 'node'),
  // Per-device report over a date range (hourly series + alarms + connectivity).
  // 'node' policy → any viewer who can open the device can export its report.
  ...endpoint('nodereport', 'get', '/api/nodes/:id/report', reportFunc, 'node'),
  ...endpoint('docsget', 'get', '/api/nodes/:id/documents', docsGetFunc, 'node'),
  // Maintenance-report upload/download are view-level: a viewer (e.g. a field
  // technician) can attach and retrieve a device's service reports.
  ...endpoint('docspost', 'post', '/api/nodes/:id/documents', docsPostFunc, 'node'),
  ...endpoint('docsdl', 'get', '/api/nodes/:id/documents/:docId', docsDownloadFunc, 'node'),
  // Send this device's exported data over a configured channel. 'node' policy
  // (not 'admin') so a viewer who can open the device can send its data on —
  // see sendExportFunc. Its libs are patched below: it needs nodemailer,
  // fetch and form-data, which the default endpoint LIBS do not include.
  ...endpoint('sendexport', 'post', '/api/nodes/:id/send-export', sendExportFunc, 'node'),
  // Device photo. GET is view-level so a viewer sees exactly what the admin
  // uploaded; writing is admin-only (the handler also proves org ownership).
  ...endpoint('nodeimgget', 'get', '/api/nodes/:id/image', nodeImgGetFunc, 'node'),
  ...endpoint('nodeimgput', 'put', '/api/nodes/:id/image', nodeImgPutFunc, 'admin'),
  ...endpoint('nodeimgdel', 'delete', '/api/nodes/:id/image', nodeImgDelFunc, 'admin'),
  // Photo gallery (migrate-v36). Order matters: the literal /order path must
  // be registered BEFORE /:photoId or Express matches 'order' as a photo id.
  ...endpoint('photolist', 'get', '/api/nodes/:id/photos', nodePhotosListFunc, 'node'),
  ...endpoint('photoadd', 'post', '/api/nodes/:id/photos', nodePhotoAddFunc, 'admin'),
  ...endpoint('photoorder', 'put', '/api/nodes/:id/photos/order', nodePhotoOrderFunc, 'admin'),
  ...endpoint('photobytes', 'get', '/api/nodes/:id/photos/:photoId', nodePhotoBytesFunc, 'node'),
  ...endpoint('photopatch', 'put', '/api/nodes/:id/photos/:photoId', nodePhotoPatchFunc, 'admin'),
  ...endpoint('photodel', 'delete', '/api/nodes/:id/photos/:photoId', nodePhotoDelFunc, 'admin'),
  ...endpoint('orgphotocovers', 'get', '/api/orgs/:orgId/photo-covers', orgPhotoCoversFunc, 'org'),
  // Kind catalog (migrate-v40). Read is 'org' — every upload picker needs it,
  // viewers included; writes are admin-only.
  ...endpoint('kindsget', 'get', '/api/orgs/:orgId/kinds', kindsGetFunc, 'org'),
  ...endpoint('kindspost', 'post', '/api/orgs/:orgId/kinds', kindsPostFunc, 'admin'),
  ...endpoint('kindsdel', 'delete', '/api/orgs/:orgId/kinds/:scope/:key', kindsDelFunc, 'admin'),
  // Transformer nameplate — real spec, replacing the fabricated Asset Info panel.
  ...endpoint('nodenpget', 'get', '/api/nodes/:id/nameplate', nodeNameplateGetFunc, 'node'),
  ...endpoint('nodenpput', 'put', '/api/nodes/:id/nameplate', nodeNameplatePutFunc, 'admin'),
  ...endpoint('orgnpget', 'get', '/api/orgs/:orgId/nameplates', orgNameplatesGetFunc, 'org'),
  ...endpoint('tmlist', 'get', '/api/orgs/:orgId/transformer-models', tmListFunc, 'admin'),
  ...endpoint('tmsave', 'post', '/api/orgs/:orgId/transformer-models', tmSaveFunc, 'admin'),
  ...endpoint('tmactive', 'put', '/api/orgs/:orgId/transformer-models/:id/active', tmSetActiveFunc, 'admin'),
  ...endpoint('tmdel', 'delete', '/api/orgs/:orgId/transformer-models/:id', tmDeleteFunc, 'admin'),

  // BloodBOX domain (ERD #4): transits, journey, floors, beacons, locations
  ...endpoint('bbjourneyget', 'get', '/api/bloodbox/transits/:id/journey', bbJourneyGetFunc),
  ...bridgeEndpoint('bbjourneypost', 'post', '/api/bloodbox/transits/:id/journey', bbJourneyPostFunc),
  ...bridgeEndpoint('bbtemp', 'post', '/api/bloodbox/transits/:id/temp', bbTempFunc),
  ...endpoint('bbtransit', 'get', '/api/bloodbox/transits/:id', bbTransitFunc),
  ...endpoint('bbtransits', 'get', '/api/bloodbox/transits', bbTransitsFunc, 'org'),
  ...endpoint('bbfloors', 'get', '/api/bloodbox/floors', bbFloorsFunc, 'org'),
  ...endpoint('bbbeacondel', 'delete', '/api/bloodbox/beacons/:id', bbBeaconDelFunc),
  ...endpoint('bbbeaconsget', 'get', '/api/bloodbox/beacons', bbBeaconsGetFunc, 'org'),
  ...endpoint('bbbeaconspost', 'post', '/api/bloodbox/beacons', bbBeaconsPostFunc),
  ...endpoint('bblocget', 'get', '/api/bloodbox/boxes/:id/location', bbLocGetFunc),
  ...endpoint('bblocpost', 'post', '/api/bloodbox/boxes/:id/location', bbLocPostFunc),

  // Generic fleet read API (all products): list + latest readings
  ...endpoint('fleetlatest', 'get', '/api/fleet/:id/latest', fleetLatestFunc, 'node'),
  ...endpoint('fleetlist', 'get', '/api/fleet', fleetListFunc),
  // Raw wire key -> canonical param key reference table (admin/live-raw's alias
  // panel). Static, no per-org data — 'auth' (any signed-in user) like fleetlist.
  ...endpoint('telemetryaliases', 'get', '/api/telemetry/aliases', telemetryAliasesFunc),

  // Scheduled-report CRUD (cron runs them; the scheduler lives in this flow)
  ...endpoint('rptlist', 'get', '/api/reports/schedules', rptListFunc),
  ...endpoint('rptpost', 'post', '/api/reports/schedules', rptPostFunc, 'admin'),
  ...endpoint('rptdel', 'delete', '/api/reports/schedules/:id', rptDelFunc, 'admin'),

  // Event problem catalog (root causes)
  ...endpoint('eplist', 'get', '/api/event-problems', epListFunc, 'auth'),
  ...endpoint('eppost', 'post', '/api/event-problems', epPostFunc, 'admin'),
  ...endpoint('epdel', 'delete', '/api/event-problems/:id', epDelFunc, 'admin'),

  // Per-user config (configProfile)
  ...endpoint('meget', 'get', '/api/me/config', meGetFunc),
  ...endpoint('meput', 'put', '/api/me/config', mePutFunc),

  // Tenancy / provisioning (superadmin + admin; not yet authz-enforced)
  ...endpoint('orgsget', 'get', '/api/orgs', orgsListFunc),
  ...endpoint('orgspost', 'post', '/api/orgs', orgsPostFunc, 'super'),
  // Platform SMTP / sender settings (superadmin-managed, DB-backed)
  // Schema migration status + the button that fixes it, and the header's real numbers.
  ...endpoint('migstatus', 'get', '/api/platform/migrations', migrationsGetFunc, 'super'),
  ...endpoint('migrun', 'post', '/api/platform/migrations/run', migrationsRunFunc, 'super'),
  ...endpoint('platstats', 'get', '/api/platform/stats', platformStatsFunc, 'super'),
  // Read-only SQL console. 'admin' at the route, then sqlConsoleFunc narrows by
  // role: a superadmin gets the control DB, an org admin gets their own tenant
  // DB and is refused outright if they do not have one.
  ...endpoint('sqlrun', 'post', '/api/platform/sql', sqlConsoleFunc, 'admin'),
  ...endpoint('sqlschema', 'get', '/api/platform/sql/schema', sqlSchemaFunc, 'admin'),
  // Real ingest quality for one org — guard's org-scope check pins a non-super
  // caller to their own :orgId, so an admin only ever sees their own fleet.
  ...endpoint('dataquality', 'get', '/api/orgs/:orgId/data-quality', dataQualityFunc, 'admin'),
  ...endpoint('settingsget', 'get', '/api/platform/settings', settingsGetFunc, 'super'),
  ...endpoint('settingsput', 'put', '/api/platform/settings', settingsPutFunc, 'super'),
  ...endpoint('settingstest', 'post', '/api/platform/settings/test', settingsTestFunc, 'admin'),
  // 'admin', not 'super' — every org admin has to read this to program a
  // device; only a superadmin may write it. See mqttConnGetFunc's own comment
  // for why this cannot just be a field on /api/platform/settings.
  ...endpoint('mqttconnget', 'get', '/api/platform/mqtt', mqttConnGetFunc, 'admin'),
  ...endpoint('mqttconnput', 'put', '/api/platform/mqtt', mqttConnPutFunc, 'super'),
  ...endpoint('entget', 'get', '/api/orgs/:orgId/entitlements', entGetFunc),
  ...endpoint('entput', 'put', '/api/orgs/:orgId/entitlements', entPutFunc, 'super'),
  // Maintenance kill switch + the audit trail that records using it.
  ...endpoint('orgstatus', 'put', '/api/orgs/:orgId/status', orgStatusPutFunc, 'super'),
  ...endpoint('org3dfallback', 'put', '/api/orgs/:orgId/3d-fallback', org3dFallbackPutFunc, 'super'),
  ...endpoint('auditget', 'get', '/api/platform/audit', auditGetFunc, 'super'),
  ...endpoint('deptget', 'get', '/api/orgs/:orgId/departments', deptListFunc),
  ...endpoint('deptpost', 'post', '/api/orgs/:orgId/departments', deptPostFunc, 'admin'),
  ...endpoint('usrget', 'get', '/api/orgs/:orgId/users', usrListFunc),
  ...endpoint('usrpost', 'post', '/api/orgs/:orgId/users', usrPostFunc, 'admin'),
  ...endpoint('orgsdel', 'delete', '/api/orgs/:id', orgsDelFunc, 'super'),
  ...endpoint('deptdel', 'delete', '/api/departments/:id', deptDelFunc, 'admin'),
  ...endpoint('usrdel', 'delete', '/api/users/:id', usrDelFunc, 'admin'),
  ...endpoint('paget', 'get', '/api/product-access', paGetFunc),
  ...endpoint('paput', 'put', '/api/product-access', paPutFunc, 'admin'),
  // Whole-org grid in one call — what the Product Access tab needs to render
  // what is actually stored instead of an empty default.
  ...endpoint('paorgget', 'get', '/api/orgs/:orgId/product-access', paOrgGetFunc),
  ...endpoint('nodeprov', 'post', '/api/nodes', nodeProvFunc, 'super'),
  // Zero-touch onboarding (admin: approve/reject devices auto-registered on first telemetry)
  ...endpoint('nodepending', 'get', '/api/nodes/pending', pendingListFunc, 'admin'),
  ...endpoint('nodeapprove', 'post', '/api/nodes/:id/approve', approveFunc, 'admin'),
  ...endpoint('nodereject', 'post', '/api/nodes/:id/reject', rejectFunc, 'admin'),
  ...endpoint('nodemerge', 'put', '/api/nodes/:id/merge', mergeFunc, 'admin'),
  // Cross-org reassignment for already-active devices — 'super' policy,
  // unlike everything else in this onboarding block: an org admin may
  // rearrange devices within their own org (merge/location/profile), but
  // moving a device OUT of an org entirely is a superadmin-only action, same
  // boundary as the org picker on a still-pending device (approveFunc).
  ...endpoint('nodesmove', 'post', '/api/nodes/move', nodesMoveFunc, 'super'),
  // Repair for rows an earlier/partial move stranded in the control DB.
  // 'super' for the same reason move is: it rewrites where a device's
  // history physically lives, across organization boundaries.
  ...endpoint('nodesrepair', 'post', '/api/nodes/repair-orphans', nodesRepairFunc, 'super'),
  ...endpoint('nodeloc', 'put', '/api/nodes/:id/location', nodeLocPutFunc, 'admin'),
  ...endpoint('nodeprofile', 'put', '/api/nodes/:id/profile', nodeProfilePutFunc, 'admin'),
  ...endpoint('nodefeeds', 'get', '/api/nodes/:id/feeds', nodeFeedsGetFunc, 'admin'),
  ...endpoint('nodedeptsget', 'get', '/api/nodes/:id/departments', nodeDeptsGetFunc, 'admin'),
  ...endpoint('nodedeptsput', 'put', '/api/nodes/:id/departments', nodeDeptsPutFunc, 'admin'),
  // Per-user device visibility (migrate-v42) — admin-only both ways: this is
  // who-may-see-what, so it belongs with the other access administration.
  ...endpoint('nodevisget', 'get', '/api/orgs/:orgId/node-visibility', nodeVisGetFunc, 'admin'),
  ...endpoint('nodevisput', 'put', '/api/users/:id/visible-nodes', nodeVisPutFunc, 'admin'),
  ...endpoint('meaccess', 'get', '/api/me/access', meAccessFunc),
  ...endpoint('dpget', 'get', '/api/orgs/:orgId/display-params', dpGetFunc),
  ...endpoint('dpput', 'put', '/api/orgs/:orgId/display-params', dpPutFunc, 'admin'),
  ...endpoint('plget', 'get', '/api/orgs/:orgId/param-labels', plGetFunc, 'org'),
  ...endpoint('plput', 'put', '/api/orgs/:orgId/param-labels', plPutFunc, 'admin'),
  ...endpoint('chget', 'get', '/api/orgs/:orgId/channels', chGetFunc),
  ...endpoint('chput', 'put', '/api/orgs/:orgId/channels', chPutFunc, 'admin'),
  ...endpoint('emailtplget', 'get', '/api/orgs/:orgId/email-template', emailTplGetFunc),
  ...endpoint('emailtplput', 'put', '/api/orgs/:orgId/email-template', emailTplPutFunc, 'admin'),
  ...endpoint('emailtpltest', 'post', '/api/orgs/:orgId/email-template/test', emailTplTestFunc, 'admin'),
  ...endpoint('dtget', 'get', '/api/orgs/:orgId/department-themes', dtGetFunc),
  ...endpoint('dtput', 'put', '/api/orgs/:orgId/department-themes', dtPutFunc, 'admin'),
  // The org's theme entitlement: readable by its admin (to allocate from),
  // writable by the superadmin only (who decides what it is licensed for).
  ...endpoint('tgget', 'get', '/api/orgs/:orgId/theme-grants', tgGetFunc),
  ...endpoint('tgput', 'put', '/api/orgs/:orgId/theme-grants', tgPutFunc, 'super'),
  // Which of the customer's sites each department may see.
  ...endpoint('dsget', 'get', '/api/orgs/:orgId/department-sites', dsGetFunc),
  ...endpoint('dsput', 'put', '/api/orgs/:orgId/department-sites', dsPutFunc, 'admin'),
  ...endpoint('sitesget', 'get', '/api/orgs/:orgId/sites', sitesGetFunc),
  ...endpoint('sitespost', 'post', '/api/orgs/:orgId/sites', sitesPostFunc, 'admin'),
  ...endpoint('sitesdel', 'delete', '/api/sites/:id', sitesDelFunc, 'admin'),
  ...endpoint('fpgeo', 'put', '/api/orgs/:orgId/floorplans/:floorId/geo', fpGeoPutFunc, 'admin'),

  // Downlink (backend → device): config (retained) / cmd / ota
  ...downlinkEndpoint('cfgput', 'put', '/api/nodes/:id/config', cfgPutFunc, 'node:manage'),
  ...downlinkEndpoint('cmdpost', 'post', '/api/nodes/:id/cmd', cmdPostFunc, 'node:manage'),
  ...downlinkEndpoint('otapost', 'post', '/api/nodes/:id/ota', otaPostFunc, 'node:manage'),

  // OTA release management + deployment tracking
  ...endpoint('otarellist', 'get', '/api/ota/releases', otaRelListFunc, 'admin'),
  ...endpoint('otarelpost', 'post', '/api/ota/releases', otaRelPostFunc, 'admin'),
  ...endpoint('otareldel', 'delete', '/api/ota/releases/:id', otaRelDelFunc, 'admin'),
  ...endpoint('otadeplist', 'get', '/api/ota/deployments', otaDepListFunc, 'admin'),
  ...downlinkEndpoint('otafleet', 'post', '/api/ota/deploy-fleet', otaFleetFunc, 'admin'),

  ...endpoint('cors', 'options', '/api/*', optionsFunc, 'public'),
]

// give every REST fn the mysql lib (handlers query the pool)
// Any handler that queries the pool gets the mysql lib (skip ones with libs set).
for (const n of flow) if (n.type === 'function' && /pool\.query|global\.get\('pool'\)/.test(n.func) && !(n.libs && n.libs.length)) n.libs = LIBS
// login also needs jwt + bcrypt (the guard closure's jwt lives in the init node)
const loginFn = flow.find((n) => n.id === 'login_fn'); if (loginFn) loginFn.libs = LOGIN_LIBS
// register also self-provisions a brand-new org's tenant DB via fetch(MIGRATE_URL).
const regFn = flow.find((n) => n.id === 'register_fn'); if (regFn) regFn.libs = REGISTER_LIBS
const passFn = flow.find((n) => n.id === 'password_fn'); if (passFn) passFn.libs = LOGIN_LIBS
const forgotFn = flow.find((n) => n.id === 'forgot_fn'); if (forgotFn) forgotFn.libs = FORGOT_LIBS
const resetFn = flow.find((n) => n.id === 'reset_fn'); if (resetFn) resetFn.libs = FORGOT_LIBS
// orgspost creates the org's admin + emails a welcome/set-password link (needs
// jwt + nodemailer) AND triggers the tenant DB via fetch(MIGRATE_URL) — the call
// that was failing with "fetch is not defined" in the Provision Wizard.
const orgsPostFn = flow.find((n) => n.id === 'orgspost_fn'); if (orgsPostFn) orgsPostFn.libs = PROVISION_LIBS
// admin "Create new user" hashes an optional password with bcrypt — see
// USRPOST_LIBS above for why the generic pool-detection pass isn't enough.
const usrPostFn = flow.find((n) => n.id === 'usrpost_fn'); if (usrPostFn) usrPostFn.libs = USRPOST_LIBS
// settingstest has no pool.query at all (it only calls mailConfig()/notifyConfig()),
// so the generic pool-detection pass above never gave it a libs entry — it has
// been calling fetch() with libs:[] this whole time. This is the superadmin's
// "Test" button on a Telegram/LINE/Google Chat channel; email uses nodemailer
// and was unaffected.
const settingsTestFn = flow.find((n) => n.id === 'settingstest_fn'); if (settingsTestFn) settingsTestFn.libs = [FETCH_LIB]
// send-export attaches files over SMTP (nodemailer) and Telegram multipart
// (form-data + fetch) — the same trio reportrun uses. Without this it would
// throw ReferenceError on the first send rather than at deploy time.
const sendExportFn = flow.find((n) => n.id === 'sendexport_fn'); if (sendExportFn) sendExportFn.libs = REPORT_LIBS

// --- DB-per-tenant: route data-plane REST handlers to the caller's org DB ----
// Swap the control-pool lookup for the per-org resolver (keyed by the JWT org).
// Control-plane handlers (auth, orgs, users, entitlements, departments,
// product-access, me/config, floorplans, branding) keep the control pool and are
// intentionally NOT listed. fleetlist / eplist / orgrule / nodeprov resolve their
// pool explicitly in-handler (org comes from a query param or the request body),
// so they are excluded here. Under TENANT_DB_MODE=off, resolvePool() returns the
// control pool, so this rewrite is a behavioural no-op.
//
// Keyed by msg.auth.orgId, which is the CALLER's own org — correct for an
// ordinary org admin (guard's 'node'/'node:manage' policy already requires
// it to match the device), but empty for a superadmin, who has no fixed
// org at all: resolvePool(undefined) silently falls back to the control
// pool regardless of which org the device the superadmin is actually
// looking at belongs to. getrule/putrule/events were removed from this set
// (generate-nodered-backend.mjs's own getRuleFunc/putRuleFunc/getEventsFunc
// now resolve pool explicitly via the NODE's real org, not the caller's) —
// the same superadmin-blind-spot almost certainly affects every other id
// still listed here (ack, readget, docsget, the bloodbox/report/ota
// handlers), not yet audited one by one.
const DATA_PLANE = new Set(['ack','docsget','docspost','docsdl',
  'bbjourneyget','bbjourneypost','bbtemp','bbtransit','bbtransits','bbfloors','bbbeacondel','bbbeaconsget','bbbeaconspost','bblocget','bblocpost',
  'rptlist','rptpost','rptdel','eppost','epdel',
  'cfgput','cmdpost','otapost','otarellist','otarelpost','otareldel','otadeplist','otafleet'])
for (const n of flow) {
  if (n.type === 'function' && DATA_PLANE.has(String(n.id || '').replace(/_fn$/, ''))) {
    n.func = n.func.split("global.get('pool')").join("global.get('resolvePool')(msg.auth&&msg.auth.orgId)")
  }
}

// POST /readings ingest → reuse the engine ingest node, then reply via its
// own http response node. ingest re-emits the original msg (req/res preserved
// for HTTP-originated requests) on output 1, so we wire that to readpost_resp.
const httpIngest = endpoint('readpost', 'post', '/api/nodes/:id/readings', httpIngestFunc, 'public')
httpIngest[1].wires = [['ingest']]      // fn → ingest (engine)
httpIngest[1].name = 'POST /api/nodes/:id/readings'
flow.push(...httpIngest)                 // keep the http response node (readpost_resp)
// ingest output 3 → readings http response (only fired for HTTP-origin msgs)
const ingestNode = flow.find((n) => n.id === 'ingest')
ingestNode.wires = [['dbgIngest'], ['wsbroadcast'], ['readpost_resp'], ['mqttout', 'dbgMqttOut']]

// Build-time guard: a function node that USES __CORS but was never prefixed
// with the `CORS +` string (which is what actually declares `const __CORS=…`
// inside that function's own scope) throws ReferenceError the first time it
// runs. nodeNameplateGetFunc shipped exactly this bug — and because bbErr's
// OWN catch handler also references __CORS, the safety net that was supposed
// to turn the error into a clean 500 response threw the SAME ReferenceError
// instead, which is an unhandled rejection at the process level: Node-RED
// logged "Uncaught Exception" and the whole runtime went unstable, taking
// every other endpoint down with it, not just this one. This is checked on
// every generate from now on, against the FINAL assembled func text (after
// GUARD_OPEN/CLOSE wrapping) — the actual thing that ships — so this exact
// class of bug fails the build instead of the running platform.
{
  const brokenCors = flow.filter((n) =>
    n.type === 'function' && /\b__CORS\b/.test(n.func) && !/const __CORS\s*=/.test(n.func)
  )
  if (brokenCors.length) {
    console.error('FATAL: function node(s) reference __CORS without declaring it (missing `CORS +` prefix on the source *Func constant):')
    for (const n of brokenCors) console.error('  ' + n.id)
    console.error('Fix: prefix the offending const with `CORS +` where it is defined.')
    process.exit(1)
  }
}

// Build-time guard #2, same class of failure, different cause: a GENERATOR-side
// constant referenced from INSIDE a handler's template literal. `PHOTO_KINDS`
// and `DOC_KINDS` are plain JS consts in this file — writing PHOTO_KINDS.indexOf(…)
// inside a `...` handler string does not inline the array, it emits the bare
// identifier into a Node-RED function node where nothing declares it, so every
// request to that endpoint died with "PHOTO_KINDS is not defined" → 500. It
// shipped exactly that way on three endpoints (photoadd, photopatch, docspost)
// and the only symptom was an opaque 500 on upload. The fix is to interpolate
// the value (`${JSON.stringify(PHOTO_KINDS)}`); this makes forgetting it fail
// the build instead.
//
// Deliberately a NAMED list rather than a general "undeclared identifier" scan:
// handler code legitimately references plenty of runtime-provided globals
// (msg, node, env, global, mysql, Buffer…), so a blanket check would be all
// false positives. Add new generator-side constants here as they appear.
{
  const GENERATOR_CONSTS = ['PHOTO_KINDS', 'DOC_KINDS']
  const leaked = []
  for (const n of flow) {
    if (n.type !== 'function') continue
    for (const name of GENERATOR_CONSTS) {
      const used = new RegExp(`\\b${name}\\b`).test(n.func)
      const declared = new RegExp(`(const|let|var)\\s+${name}\\b`).test(n.func)
      if (used && !declared) leaked.push(`${n.id} → ${name}`)
    }
  }
  if (leaked.length) {
    console.error('FATAL: function node(s) reference a generator-side constant that is not defined at runtime:')
    for (const l of leaked) console.error('  ' + l)
    console.error('Fix: interpolate the value into the handler string, e.g. ${JSON.stringify(PHOTO_KINDS)}.')
    process.exit(1)
  }
}

// Build-time guard #3: JavaScript syntax verification on EVERY function node.
// Parses each function node's `func` string with vm.Script. Any syntax error
// (unclosed braces, unexpected tokens, invalid syntax) fails the generator immediately.
{
  const syntaxErrors = []
  let funcNodeCount = 0
  for (const n of flow) {
    if (n.type !== 'function' || !n.func) continue
    funcNodeCount++
    try {
      new vm.Script(`(async function(){\n${n.func}\n})`, { filename: `node_${n.id}.js` })
    } catch (err) {
      syntaxErrors.push({ id: n.id, name: n.name || '', error: err.stack || err.message })
    }
  }
  if (syntaxErrors.length) {
    console.error(`FATAL: ${syntaxErrors.length} Syntax Error(s) detected in function node(s):`)
    for (const e of syntaxErrors) {
      console.error(`  ✗ Node "${e.id}" (${e.name}): ${e.error}`)
    }
    process.exit(1)
  }
  console.log(`✓ Syntax gate passed: ${funcNodeCount} function nodes validated (0 errors).`)
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'flows.nodered-backend.json')
writeFileSync(out, JSON.stringify(flow, null, 2) + '\n')
const types = [...new Set(flow.map((n) => n.type))]
console.log('Generated', out, '—', flow.length, 'nodes ·', types.join(', '))
console.log('Endpoints: GET /health · GET|PUT /nodes/:id/rule · PUT /orgs/:orgId/rule · GET /nodes/:id/events · POST /events/:id/ack · GET|POST /nodes/:id/readings · GET|POST /nodes/:id/documents · OPTIONS /api/*')
console.log('BloodBOX: GET /bloodbox/transits · GET /bloodbox/transits/:id · GET|POST /bloodbox/transits/:id/journey · POST /bloodbox/transits/:id/temp (→engine bridge) · GET /bloodbox/floors · GET|POST|DELETE /bloodbox/beacons · GET|POST /bloodbox/boxes/:id/location')
console.log('Fleet (all products): GET /fleet?orgId=&domain= · GET /fleet/:id/latest')
console.log('Downlink (→device): PUT /nodes/:id/config (retained) · POST /nodes/:id/cmd · POST /nodes/:id/ota')
console.log('OTA Mgmt: GET|POST|DELETE /ota/releases · GET /ota/deployments · POST /ota/deploy-fleet (group OTA)')
console.log('Observability: transport_events (WiFi↔4G) · offline_sync_log (backlog) · edge_alarm_log (firmware alarms)')
console.log('Reports: GET|POST /reports/schedules · DELETE /reports/schedules/:id (cron 15m → CSV email)')
console.log('Realtime: WebSocket bridge on listener path /ws/telemetry (tap normalize + ingest)')
