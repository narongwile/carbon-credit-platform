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

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MQTT_HOST = process.env.MQTT_HOST || 'mqtt.data.svc.cluster.local'
const MQTT_PORT = process.env.MQTT_PORT || '1883'
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'telemetry/#'
const ESCALATE_MIN = process.env.ESCALATE_AFTER_MIN || '15'

// CORS preamble injected into every REST handler
const CORS = `const __CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-user-id, authorization','Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS'};\n`

// Guard preamble injected into protected handlers (policy: auth|admin|super).
// Verifies the Bearer JWT via the global guard (set in init) and enforces role +
// org-scope; on failure it responds and short-circuits the handler.
const GUARD = (policy) => !policy || policy === 'public' ? '' : `
const __g=global.get('guard');
const __ar=__g?__g((msg.req.headers&&(msg.req.headers.authorization||msg.req.headers.Authorization))||'','${policy}',msg.req):{ok:false,code:503,error:'auth not ready'};
if(!__ar.ok){msg.headers={'Access-Control-Allow-Origin':'*'};msg.statusCode=__ar.code;msg.payload={error:__ar.error};return msg;}
msg.auth=__ar.auth;
`

// --- init: MySQL pool + alarm engine into global context --------------------
const initFunc = `
// 'mysql' is injected by functionExternalModules (declared in this node's libs).
if (!global.get('pool')) {
  global.set('pool', mysql.createPool({
    host: env.get('DB_HOST') || 'mysql.data.svc.cluster.local',
    port: Number(env.get('DB_PORT') || 3306),
    user: env.get('DB_USER') || 'admin',
    password: env.get('DB_PASSWORD') || 'iothub.2026',
    database: env.get('DB_NAME') || 'iothub',
    namedPlaceholders: true, connectionLimit: 10, timezone: 'Z',
  }));
}
function breaches(v,l,d){return d==='high'?v>=l:v<=l;}
function cleared(v,l,d,h){return d==='high'?v<l-h:v>l+h;}
function evaluate(nodeId, rule, readings){
  const out=[];
  for(const p of rule.params){
    let active=null, run=0, prev=null;
    for(const r of readings){
      const v=r.values[p.key]; if(v===undefined||Number.isNaN(v))continue;
      if(p.rate&&prev!==null){const d=p.direction==='high'?v-prev:prev-v; if(d>=p.rate.warn)out.push(mk(nodeId,p,'WARNING','rate',v,p.rate.warn,r));}
      prev=v;
      const lvl=breaches(v,p.critical,p.direction)?'CRITICAL':breaches(v,p.warn,p.direction)?'WARNING':null;
      if(lvl){run++; if(run>=rule.dwellMin&&lvl!==active){ if(active===null||(active==='WARNING'&&lvl==='CRITICAL')){out.push(mk(nodeId,p,lvl,'threshold',v,lvl==='CRITICAL'?p.critical:p.warn,r));} active=lvl; } }
      else if(active&&cleared(v,p.warn,p.direction,rule.hysteresis)){active=null;run=0;}
      else if(!lvl){run=0;}
    }
  }
  return out.sort((a,b)=>b.ts-a.ts);
}
function mk(nodeId,p,sev,kind,value,thr,r){return {id:'ev-'+nodeId+'-'+p.key+'-'+r.ts+'-'+kind,nodeId:nodeId,paramKey:p.key,paramLabel:p.label,severity:sev,kind:kind,value:+value.toFixed(2),threshold:thr,unit:p.unit,time:r.time,ts:r.ts};}
global.set('evaluate', evaluate);
// 'jwt' is injected (functionExternalModules). Auth guard for protected handlers.
global.set('guard', function(authHeader, policy, req){
  if(policy==='public') return {ok:true,auth:null};
  try{
    const tok=(authHeader||'').replace(/^Bearer /,'');
    if(!tok) return {ok:false,code:401,error:'authentication required'};
    const claims=jwt.verify(tok, env.get('JWT_SECRET')||'dev-secret-change-me');
    if(policy==='super' && claims.role!=='superadmin') return {ok:false,code:403,error:'superadmin only'};
    if(policy==='admin' && claims.role!=='admin' && claims.role!=='superadmin') return {ok:false,code:403,error:'admin only'};
    const oid = req.params && req.params.orgId;
    if(claims.role!=='superadmin' && oid && oid!==claims.orgId) return {ok:false,code:403,error:'outside your organization'};
    return {ok:true, auth:claims};
  }catch(e){ return {ok:false,code:401,error:'invalid token'}; }
});
node.warn('ONEOPS Node-RED backend: pool + engine + auth guard ready');
`

// Login: verify bcrypt password → issue JWT (userId/orgId/role).
const loginFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
(async()=>{const[u]=await pool.query("SELECT id,org_id,role,name,email,password_hash FROM users WHERE email=?",[b.email||'']);
  if(!u.length||!u[0].password_hash||!(await bcrypt.compare(b.password||'', u[0].password_hash))){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'invalid credentials'};node.send(msg);return;}
  const claims={userId:u[0].id,orgId:u[0].org_id||'',role:u[0].role||'viewer'};
  const token=jwt.sign(claims, env.get('JWT_SECRET')||'dev-secret-change-me', {expiresIn: env.get('JWT_TTL')||'12h'});
  msg.headers=__CORS; msg.payload={token, user:{id:claims.userId,orgId:claims.orgId,role:claims.role,name:u[0].name,email:u[0].email}}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const ingestFunc = `
const __H = { 'Access-Control-Allow-Origin': '*' };
const __http = !!(msg.req && msg.res);   // only HTTP-origin msgs get a response (out 3)
const pool = global.get('pool'); const evaluate = global.get('evaluate');
const { nodeId, values, ts } = msg.payload || {};
if (!pool || !evaluate || !nodeId || !values) { msg.headers = __H; msg.statusCode = 400; msg.payload = { error: 'bad input' }; node.send([msg, null, __http ? msg : null, null]); return null; }
const taken = new Date(ts || Date.now());
(async () => {
  for (const [k,v] of Object.entries(values)) { if(typeof v==='number') await pool.query('INSERT IGNORE INTO readings (node_id,param_key,value,taken_at) VALUES (?,?,?,?)',[nodeId,k,v,taken]); }
  const [rr] = await pool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?',[nodeId]);
  const [mm] = await pool.query('SELECT org_id, department_id, mqtt_prefix FROM nodes WHERE id=?',[nodeId]);
  if (!rr.length || !mm.length) { msg.headers=__H; msg.payload={inserted:0,reason:'no rule/node'}; node.send([msg,null,__http?msg:null,null]); return; }
  const rule = typeof rr[0].rule_json==='string'?JSON.parse(rr[0].rule_json):rr[0].rule_json;
  const [rows] = await pool.query('SELECT param_key,value,taken_at FROM readings WHERE node_id=? AND taken_at>(NOW(3)-INTERVAL 360 MINUTE) ORDER BY taken_at ASC',[nodeId]);
  const byTs=new Map();
  for(const r of rows){const t=new Date(r.taken_at).getTime(); if(!byTs.has(t))byTs.set(t,{time:new Date(t).toISOString(),ts:t,values:{}}); byTs.get(t).values[r.param_key]=Number(r.value);}
  const readings=[...byTs.values()].sort((a,b)=>a.ts-b.ts);
  const events = evaluate(nodeId, rule, readings);
  const pfx = mm[0].mqtt_prefix;
  let inserted=0;
  for (const e of events){
    const [ex]=await pool.query('SELECT id FROM alarm_events WHERE id=?',[e.id]); if (ex.length) continue;
    await pool.query('INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [e.id,nodeId,mm[0].org_id,mm[0].department_id,e.paramKey,e.paramLabel,e.severity,e.kind,e.value,e.threshold,e.unit,new Date(e.ts)]);
    inserted++;
    // §9: retained per-device alarm state echo so late subscribers/actuators read current severity
    const echo = pfx ? { topic: pfx+'/alarm/'+e.paramKey, payload: { sid:e.paramKey, severity:e.severity, value:e.value, thr:e.threshold, state:e.severity, ts:e.ts }, qos:1, retain:true } : null;
    node.send([null, { payload: Object.assign({}, e, { orgId: mm[0].org_id, departmentId: mm[0].department_id }) }, null, echo]);
  }
  msg.headers = __H; msg.payload = { inserted }; node.send([msg, null, __http?msg:null, null]);
})().catch(err => { node.error(err.message, msg); });
return null;
`

const notifyFunc = `
const pool = global.get('pool');
const e = msg.payload;
if (!e) return null;
const text = '['+e.severity+'] '+e.paramLabel+' = '+e.value+e.unit+' (limit '+e.threshold+') on '+e.nodeId+' — '+(e.kind||'')+' @ '+e.time;
const subject = 'ONEOPS '+e.severity+': '+e.paramLabel;
(async () => {
  try {
    // Per-tenant channels (org + dept) from DB — same routing as the Express service.
    let channels = [];
    if (pool && e.orgId) {
      const [rows] = await pool.query("SELECT channel,target,min_severity FROM notification_channels WHERE org_id=? AND enabled=1 AND (department_id IS NULL OR department_id=?)", [e.orgId, e.departmentId || null]);
      channels = rows;
    }
    // Fallback: env-based single destination when no DB channels are configured.
    if (!channels.length) {
      if (env.get('LINE_NOTIFY_TOKEN')) channels.push({ channel:'line', target:'' });
      if (env.get('TELEGRAM_BOT_TOKEN')) channels.push({ channel:'telegram', target:'' });
      if (env.get('GOOGLE_CHAT_WEBHOOK')) channels.push({ channel:'googlechat', target:'' });
    }
    for (const c of channels) {
      if (c.min_severity === 'CRITICAL' && e.severity !== 'CRITICAL') continue;   // severity filter
      try {
        if (c.channel === 'email') {
          if (!env.get('SMTP_HOST') || !c.target) { node.warn('notify:email skipped — SMTP_HOST/target missing'); continue; }
          let tx = global.get('mailer');
          if (!tx) { tx = nodemailer.createTransport({ host: env.get('SMTP_HOST'), port: Number(env.get('SMTP_PORT')||587), auth: env.get('SMTP_USER') ? { user: env.get('SMTP_USER'), pass: env.get('SMTP_PASS') } : undefined }); global.set('mailer', tx); }
          await tx.sendMail({ from: env.get('MAIL_FROM')||'alerts@oneops.local', to: c.target, subject, text });
        } else if (c.channel === 'line') {
          const t = c.target || env.get('LINE_NOTIFY_TOKEN');
          if (t) await fetch('https://notify-api.line.me/api/notify',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:' '+text})});
        } else if (c.channel === 'telegram') {
          const tg = env.get('TELEGRAM_BOT_TOKEN'); const chat = c.target || env.get('TELEGRAM_CHAT_ID');
          if (tg && chat) await fetch('https://api.telegram.org/bot'+tg+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text})});
        } else if (c.channel === 'googlechat') {
          const url = c.target || env.get('GOOGLE_CHAT_WEBHOOK');
          if (url) await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
        }
      } catch(err){ node.error('notify:'+c.channel+' '+err.message); }
    }
  } catch(err){ node.error('notify: '+err.message); }
})();
return null;
`

const normalizeFunc = `
// Out1 = readings (→ ingest); Out2 = presence (→ device_presence);
// Out3 = device logs (→ device_logs: P/diag/log + P/ota/progress).
// Accepts: {nodeId,values,ts} | {device_id,channel,value,ts} (spec §6) |
//          status {state} & heartbeat {rssi/uptime/heap} | legacy topic tail.
const MAP = { oil_temp_c:'oilTemp', ambient_temp_c:'ambientTemp', dga_h2_ppm:'hydrogen',
  moisture_ppm:'moisture', oil_level_pct:'oilLevel', load_pct:'load', door_state:'door',
  rh_pct:'rh', batt_pct:'battery', impact_g:'impact', baro_alt_m:'baroAlt' };
const p = msg.payload;
const topo = (msg.topic||'').split('/');
const fromTopic = (n) => topo.length>=n ? topo[topo.length-n] : undefined;
// --- presence: status (has state) or heartbeat (rssi/uptime/heap), no reading payload
if (p && typeof p==='object' && !p.nodeId && p.channel===undefined) {
  if (p.state || p.rssi!==undefined || p.uptime!==undefined || p.heap!==undefined) {
    const id = p.device_id || fromTopic(2);
    if (!id) return null;
    const online = p.state ? (p.state==='online'?1:0) : 1;   // heartbeat ⇒ online
    return [null, { payload: { nodeId:id, online, rssi:p.rssi, fw:p.fw, batt:p.batt, ts:p.ts||Date.now() } }, null];
  }
  // diag/log or ota/progress → device_logs (Out3)
  const isOta = p.pct!==undefined || p.status!==undefined;
  const id = p.device_id || fromTopic(isOta ? 3 : 3);
  if (id) return [null, null, { payload: { nodeId:id, kind: isOta?'ota':'diag', level: p.level||p.status||'info', payload: p, ts: p.ts||Date.now() } }];
  return null;
}
// --- readings
let nodeId, raw = {}, ts = Date.now();
if (p && typeof p==='object' && p.nodeId){ nodeId=p.nodeId; raw=p.values||{}; ts=p.ts||ts; }
else if (p && typeof p==='object' && p.device_id && p.channel!==undefined){ nodeId=p.device_id; ts=p.ts||ts; raw={[p.channel]:Number(p.value)}; }
else if (p && typeof p==='object'){ return null; }
else { const t=topo; nodeId=t[1]; raw={[t[2]]:Number(msg.payload)}; }
if(!nodeId) return null;
const values = {};
for (const k of Object.keys(raw)) { const v = raw[k]; if (k==='temp_c'){ values.tempHigh=v; values.tempLow=v; } else values[MAP[k]||k]=v; }
return [{ payload: { nodeId, values, ts } }, null, null];
`

// Presence upsert: heartbeat/status keep device_presence fresh (last_seen, online).
const presenceFunc = `
const pool = global.get('pool'); const e = msg.payload;
if (!pool || !e || !e.nodeId) return null;
(async () => {
  await pool.query("INSERT INTO device_presence (node_id, online, last_seen, rssi, batt, fw) VALUES (?,?,NOW(3),?,?,?) ON DUPLICATE KEY UPDATE online=VALUES(online), last_seen=VALUES(last_seen), rssi=VALUES(rssi), batt=VALUES(batt), fw=VALUES(fw)",
    [e.nodeId, e.online?1:0, e.rssi ?? null, e.batt ?? null, e.fw ?? null]);
  // offline-recovery: device back online ⇒ clear any open offline alarm
  if (e.online) await pool.query("UPDATE alarm_events SET cleared_at=NOW(3) WHERE node_id=? AND kind='offline' AND cleared_at IS NULL", [e.nodeId]);
})().catch(err => node.error('presence: ' + err.message));
return null;
`

// Auto-clear: an open threshold/rate event whose param has stayed NORMAL for the
// whole CLEAR_AFTER_MIN window (deadband = hysteresis) is closed (spec §9 CLEAR).
const clearSweepFunc = `
const pool = global.get('pool'); if (!pool) return null;
const CLEAR_MIN = Number(env.get('CLEAR_AFTER_MIN') || 5);
(async () => {
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
})().catch(e => node.error('clear-sweep: ' + e.message));
return null;
`

// Device logs: store P/diag/log + P/ota/progress (observability).
const devlogFunc = `
const pool = global.get('pool'); const e = msg.payload;
if (!pool || !e || !e.nodeId) return null;
(async () => {
  await pool.query("INSERT INTO device_logs (node_id, kind, level, payload, ts) VALUES (?,?,?,?,NOW(3))",
    [e.nodeId, e.kind||'diag', String(e.level||'info').slice(0,32), JSON.stringify(e.payload||{})]);
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

// Retention: roll raw readings into hourly buckets, then purge raw older than N days.
const retentionFunc = `
const pool = global.get('pool'); if (!pool) return null;
const DAYS = Number(env.get('READINGS_RETENTION_DAYS') || 30);
(async () => {
  await pool.query("INSERT INTO readings_rollup (node_id, param_key, bucket, n, v_avg, v_min, v_max) " +
    "SELECT node_id, param_key, DATE_FORMAT(taken_at,'%Y-%m-%d %H:00:00.000') bucket, COUNT(*), AVG(value), MIN(value), MAX(value) " +
    "FROM readings WHERE taken_at < (NOW(3) - INTERVAL ? DAY) GROUP BY node_id, param_key, bucket " +
    "ON DUPLICATE KEY UPDATE n=VALUES(n), v_avg=VALUES(v_avg), v_min=VALUES(v_min), v_max=VALUES(v_max)", [DAYS]);
  const [res] = await pool.query("DELETE FROM readings WHERE taken_at < (NOW(3) - INTERVAL ? DAY)", [DAYS]);
  if (res.affectedRows) node.warn('retention: rolled up + purged ' + res.affectedRows + ' raw readings');
})().catch(e => node.error('retention: ' + e.message));
return null;
`

// Offline detection: any device online but unseen > OFFLINE_AFTER_S ⇒ mark offline,
// raise a CRITICAL offline event, and route to notify (per-tenant, like any alarm).
const offlineSweepFunc = `
const pool = global.get('pool'); if (!pool) return null;
const AFTER = Number(env.get('OFFLINE_AFTER_S') || 90);
(async () => {
  const [rows] = await pool.query(
    "SELECT p.node_id, n.org_id, n.department_id FROM device_presence p JOIN nodes n ON n.id = p.node_id WHERE p.online = 1 AND p.last_seen < (NOW(3) - INTERVAL ? SECOND)",
    [AFTER]);
  for (const r of rows) {
    await pool.query("UPDATE device_presence SET online = 0 WHERE node_id = ?", [r.node_id]);
    const id = 'ev-offline-' + r.node_id + '-' + Date.now();
    await pool.query("INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(3))",
      [id, r.node_id, r.org_id, r.department_id, 'online', 'Device Offline', 'CRITICAL', 'offline', 0, 0, '']);
    node.send({ payload: { id, nodeId:r.node_id, orgId:r.org_id, departmentId:r.department_id, paramLabel:'Device Offline', kind:'offline', value:0, unit:'', threshold:0, severity:'CRITICAL', time:new Date().toISOString() } });
  }
})().catch(e => node.error('offline-sweep: ' + e.message));
return null;
`

const escalationFunc = `
const pool = global.get('pool'); if(!pool) return null;
(async()=>{
  const [rows]=await pool.query("SELECT * FROM alarm_events WHERE severity='CRITICAL' AND acknowledged_at IS NULL AND cleared_at IS NULL AND escalated=0 AND raised_at<(NOW(3)-INTERVAL ${ESCALATE_MIN} MINUTE)");
  for(const r of rows){ node.send({ payload: { nodeId:r.node_id, orgId:r.org_id, departmentId:r.department_id, paramLabel:'ESCALATION · '+r.param_label, kind:r.kind, value:Number(r.value), unit:r.unit, threshold:Number(r.threshold), severity:'CRITICAL', time:new Date(r.raised_at).toISOString() } }); }
  if(rows.length){ await pool.query('UPDATE alarm_events SET escalated=1 WHERE id IN (?)',[rows.map(r=>r.id)]); }
})().catch(e=>node.error(e.message));
return null;
`

// --- REST handlers (CORS prepended) -----------------------------------------
const healthFunc = CORS + `const pool=global.get('pool');
(async()=>{ let db=false; try{const c=await pool.getConnection(); await c.ping(); c.release(); db=true;}catch(e){} msg.headers=__CORS; msg.statusCode=200; msg.payload={ok:true,db,ts:Date.now()}; node.send(msg);})(); return null;`

const getRuleFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?',[id]); msg.headers=__CORS; msg.statusCode=r.length?200:404; msg.payload=r.length?(typeof r[0].rule_json==='string'?JSON.parse(r[0].rule_json):r[0].rule_json):{error:'no rule'}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const putRuleFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const {orgId,rule,updatedBy}=msg.payload||{};
if(!orgId||!rule){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'orgId and rule required'};return msg;}
(async()=>{await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),domain=VALUES(domain),updated_by=VALUES(updated_by)',[id,orgId,rule.domain,JSON.stringify(rule),updatedBy||null]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const orgRuleFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const {rule,updatedBy}=msg.payload||{};
if(!rule||!rule.domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'rule.domain required'};return msg;}
(async()=>{const[n]=await pool.query('SELECT id FROM nodes WHERE org_id=? AND domain=?',[orgId,rule.domain]);
  for(const row of n){ await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),updated_by=VALUES(updated_by)',[row.id,orgId,rule.domain,JSON.stringify(rule),updatedBy||null]); }
  msg.headers=__CORS; msg.payload={ok:true,applied:n.length}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const getEventsFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT * FROM alarm_events WHERE node_id=? ORDER BY raised_at DESC LIMIT 50',[id]); msg.headers=__CORS; msg.payload=r; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const ackFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const {by,eventProblemId}=msg.payload||{};
(async()=>{await pool.query('UPDATE alarm_events SET acknowledged_at=NOW(3),acknowledged_by=?,event_problem_id=? WHERE id=?',[by||'user',eventProblemId||null,id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const readingsGetFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const since=Number((msg.req.query&&msg.req.query.sinceMin)||360);
(async()=>{const[r]=await pool.query('SELECT param_key,value,taken_at FROM readings WHERE node_id=? AND taken_at>(NOW(3)-INTERVAL ? MINUTE) ORDER BY taken_at ASC',[id,since]); msg.headers=__CORS; msg.payload=r; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const docsGetFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const dept=(msg.req.query&&msg.req.query.departmentId)||'';
(async()=>{const[r]=await pool.query('SELECT id,name,size,uploaded_by,created_at FROM documents WHERE node_id=? AND department_id=? ORDER BY created_at DESC',[id,dept]); msg.headers=__CORS; msg.payload=r; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const docsPostFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const {departmentId,name,size,uploadedBy,dataBase64}=msg.payload||{};
if(!departmentId||!name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'departmentId and name required'};return msg;}
(async()=>{const docId='doc-'+Date.now(); await pool.query('INSERT INTO documents (id,node_id,department_id,name,size,uploaded_by,data) VALUES (?,?,?,?,?,?,?)',[docId,id,departmentId,name,size||null,uploadedBy||null,dataBase64?Buffer.from(dataBase64,'base64'):null]); msg.headers=__CORS; msg.payload={ok:true,id:docId}; node.send(msg);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const httpIngestFunc = `msg.payload={nodeId:msg.req.params.id,values:(msg.payload&&msg.payload.values)||{},ts:(msg.payload&&msg.payload.ts)};return msg;`
const optionsFunc = CORS + `msg.headers=__CORS; msg.statusCode=204; msg.payload=''; return msg;`

// --- BloodBOX domain handlers (ERD #4) --------------------------------------
const bbErr = `.catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send(msg);}); return null;`

const bbTransitsFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||'';
(async()=>{const[r]=await pool.query('SELECT * FROM blood_box_transits WHERE org_id=? ORDER BY current_eta_min ASC',[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const bbTransitFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT * FROM blood_box_transits WHERE id=?',[id]); msg.headers=__CORS; msg.statusCode=r.length?200:404; msg.payload=r.length?r[0]:{error:'not found'}; node.send(msg);})()` + bbErr

const bbJourneyGetFunc = CORS + `const pool=global.get('pool'); const tid=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT * FROM blood_box_journey_events WHERE transit_id=? ORDER BY ts ASC',[tid]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

// 2-output handler: out1 → http response, out2 → engine bridge (ingest) when
// the scan carried a temperature. Bridge msgs have no req/res so ingest treats
// them as non-HTTP and won't double-respond.
const bbJourneyPostFunc = CORS + `const pool=global.get('pool'); const tid=msg.req.params.id; const b=msg.payload||{};
if(!b.eventType||!b.signal){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'eventType and signal required'};node.send([msg,null]);return null;}
(async()=>{const id='je-'+Date.now(); await pool.query('INSERT INTO blood_box_journey_events (id,transit_id,floor_id,event_type,label,signal,lat,lng,pos_x_m,pos_y_m,temp_c,battery_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[id,tid,b.floorId||null,b.eventType,b.label||null,b.signal,b.lat||null,b.lng||null,b.posX||null,b.posY||null,b.tempC||null,b.batteryPct||null]);
  let bridge=null;
  if(typeof b.tempC==='number'){const[tr]=await pool.query('SELECT box_id FROM blood_box_transits WHERE id=?',[tid]); if(tr.length&&tr[0].box_id){const v={tempHigh:b.tempC,tempLow:b.tempC}; if(typeof b.batteryPct==='number')v.battery=b.batteryPct; bridge={payload:{nodeId:tr[0].box_id,values:v,ts:Date.now()}};}}
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send([msg,bridge]);})().catch(e=>{msg.headers=__CORS;msg.statusCode=500;msg.payload={error:e.message};node.send([msg,null]);}); return null;`

// Report a transit telemetry sample → persist on the transit + bridge into the
// central alarm engine (out2 → ingest) for real excursion alerts in transit.
const bbTempFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const b=msg.payload||{};
if(typeof b.tempC!=='number'){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'tempC (number) required'};node.send([msg,null]);return null;}
(async()=>{const[tr]=await pool.query('SELECT box_id FROM blood_box_transits WHERE id=?',[id]);
  if(!tr.length){msg.headers=__CORS;msg.statusCode=404;msg.payload={error:'transit not found'};node.send([msg,null]);return;}
  await pool.query('UPDATE blood_box_transits SET current_temp_c=?, temp_max_c=GREATEST(COALESCE(temp_max_c,?),?) WHERE id=?',[b.tempC,b.tempC,b.tempC,id]);
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

const bbBeaconDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query('DELETE FROM ble_beacons WHERE id=?',[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

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
const fleetListFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||''; const domain=msg.req.query&&msg.req.query.domain;
(async()=>{const sql="SELECT n.id,n.name,n.domain,n.site_id,n.department_id,n.lat,n.lng,p.online,p.last_seen,p.rssi,p.fw,"+
  "(SELECT e.severity FROM alarm_events e WHERE e.node_id=n.id AND e.acknowledged_at IS NULL AND e.cleared_at IS NULL ORDER BY FIELD(e.severity,'CRITICAL','WARNING') LIMIT 1) AS alarm "+
  "FROM nodes n LEFT JOIN device_presence p ON p.node_id=n.id WHERE n.org_id=?"+(domain?" AND n.domain=?":"")+" ORDER BY n.domain,n.id";
  const a=domain?[orgId,domain]:[orgId]; const[r]=await pool.query(sql,a); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const fleetLatestFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query("SELECT r1.param_key,r1.value,r1.taken_at FROM readings r1 JOIN (SELECT param_key,MAX(taken_at) mt FROM readings WHERE node_id=? GROUP BY param_key) r2 ON r1.param_key=r2.param_key AND r1.taken_at=r2.mt WHERE r1.node_id=?",[id,id]);
  const out={}; let last=null; for(const row of r){ out[row.param_key]=Number(row.value); if(!last||row.taken_at>last) last=row.taken_at; }
  msg.headers=__CORS; msg.payload={nodeId:id, values:out, lastReadingAt:last}; node.send(msg);})()` + bbErr

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
  const topic=n[0].mqtt_prefix+'/ota/cmd'; msg.headers=__CORS; msg.payload={ok:true,topic}; node.send([msg,{topic,payload:body,qos:1,retain:false}]);})()` + bbErr

const LIBS = [{ var: 'mysql', module: 'mysql2/promise' }]
// notify node also needs nodemailer (SMTP email), like the Express service
const NOTIFY_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'nodemailer', module: 'nodemailer' }]
// init defines the auth guard closure (needs jwt); login verifies bcrypt + signs jwt
const INIT_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'jwt', module: 'jsonwebtoken' }]
const LOGIN_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'jwt', module: 'jsonwebtoken' }, { var: 'bcrypt', module: 'bcryptjs' }]
const fn = (id, name, func, x, y, wires, outputs = 1, extra = {}) => ({ id, type: 'function', z: 'be', name, func, outputs, libs: [], x, y, wires, ...extra })
let yREST = 360
// policy ∈ public|auth|admin|super (default auth). GUARD is prepended to the handler.
const endpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD(policy) + handlerFunc, 420, y, [[`${idBase}_resp`]]),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}
// Like endpoint() but the handler has a 2nd output wired to the engine `ingest`
// node — used by the BloodBOX transit-temperature bridge (excursion alerts).
const bridgeEndpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD(policy) + handlerFunc, 420, y, [[`${idBase}_resp`], ['ingest']], 2, { libs: LIBS }),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}
// Like endpoint() but out2 → `mqttout` — backend→device downlink (config/cmd/ota).
const downlinkEndpoint = (idBase, method, url, handlerFunc, policy = 'auth') => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, GUARD(policy) + handlerFunc, 420, y, [[`${idBase}_resp`], ['mqttout']], 2, { libs: LIBS }),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}

// --- WebSocket bridge: push live telemetry/alarm to the frontend -------------
// Tapped off normalize (readings) + ingest (alarm). Emits the TelemetryData
// shape the useMqttTelemetry hook expects; alarms carry type:'alarm'.
const wsBroadcastFunc = `
const p = msg.payload || {};
let out;
if (p.values) {
  const v = p.values;
  let temp = v.tempHigh; if (temp===undefined) temp = v.tempLow; if (temp===undefined) temp = v.oilTemp;
  if (temp===undefined) { const n = Object.values(v).find(x => typeof x==='number'); temp = (n===undefined?null:n); }
  out = { id: p.nodeId, mac: '', temperature: temp===null?null:Number(temp), doorOpen: (v.door||0)>0, values: v, timestamp: new Date(p.ts||Date.now()).toISOString() };
} else if (p.severity) {
  out = { type:'alarm', id: p.nodeId, paramKey: p.paramKey, severity: p.severity, value: p.value, timestamp: p.time || new Date().toISOString() };
} else { return null; }
msg.payload = out;
return msg;
`

// --- Scheduled reports: cron → CSV summary → email (notify) ------------------
const reportRunFunc = `
const pool = global.get('pool'); if (!pool) return null;
(async () => {
  const [due] = await pool.query("SELECT * FROM report_schedules WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at<=NOW(3))");
  for (const s of due) {
    let nodeIds = [];
    if (s.scope==='device' && s.scope_id) nodeIds = [s.scope_id];
    else { const args = (s.scope==='department' && s.scope_id) ? [s.org_id, s.scope_id] : [s.org_id];
      const [ns] = await pool.query("SELECT id FROM nodes WHERE org_id=?"+((s.scope==='department'&&s.scope_id)?" AND department_id=?":""), args); nodeIds = ns.map(n=>n.id); }
    const days = s.sequence==='weekly'?7 : s.sequence==='monthly'?30 : 1;
    let csv = 'node_id,param_key,n,avg,min,max\\n';
    if (nodeIds.length) {
      const [rows] = await pool.query("SELECT node_id,param_key,COUNT(*) n,AVG(value) a,MIN(value) mn,MAX(value) mx FROM readings WHERE node_id IN (?) AND taken_at>(NOW(3)-INTERVAL ? DAY) GROUP BY node_id,param_key ORDER BY node_id,param_key", [nodeIds, days]);
      for (const r of rows) csv += r.node_id+','+r.param_key+','+r.n+','+Number(r.a).toFixed(2)+','+Number(r.mn).toFixed(2)+','+Number(r.mx).toFixed(2)+'\\n';
    }
    const to = (s.recipients||'').trim();
    if (to && env.get('SMTP_HOST')) {
      let tx = global.get('mailer');
      if (!tx) { tx = nodemailer.createTransport({ host: env.get('SMTP_HOST'), port: Number(env.get('SMTP_PORT')||587), auth: env.get('SMTP_USER')?{user:env.get('SMTP_USER'),pass:env.get('SMTP_PASS')}:undefined }); global.set('mailer', tx); }
      await tx.sendMail({ from: env.get('MAIL_FROM')||'alerts@oneops.local', to, subject: 'ONEOPS Report: '+s.name, text: 'Automated '+s.sequence+' '+s.scope+' report.', attachments: [{ filename: String(s.name).replace(/\\s+/g,'_')+'.csv', content: csv }] });
    } else { node.warn('report '+s.name+': email skipped (no SMTP/recipients), '+nodeIds.length+' nodes'); }
    const iv = s.sequence==='weekly'?'7 DAY' : s.sequence==='monthly'?'1 MONTH' : '1 DAY';
    await pool.query("UPDATE report_schedules SET last_run_at=NOW(3), next_run_at=(NOW(3)+INTERVAL "+iv+") WHERE id=?", [s.id]);
  }
})().catch(e => node.error('report-run: ' + e.message));
return null;
`

const rptListFunc = CORS + `const pool=global.get('pool'); const orgId=(msg.req.query&&msg.req.query.orgId)||'';
(async()=>{const[r]=await pool.query("SELECT * FROM report_schedules WHERE org_id=? ORDER BY name",[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr

const rptPostFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.orgId||!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'orgId and name required'};return msg;}
(async()=>{const id=b.id||'rpt-'+Date.now();
  await pool.query("INSERT INTO report_schedules (id,org_id,name,scope,scope_id,sequence,format,recipients,enabled,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3)) ON DUPLICATE KEY UPDATE name=VALUES(name),scope=VALUES(scope),scope_id=VALUES(scope_id),sequence=VALUES(sequence),format=VALUES(format),recipients=VALUES(recipients),enabled=VALUES(enabled)",
    [id,b.orgId,b.name,b.scope||'device',b.scopeId||null,b.sequence||'daily',b.format||'CSV',b.recipients||null,b.enabled===false?0:1]);
  msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr

const rptDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query("DELETE FROM report_schedules WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- Per-user config (configProfile). Identity = x-user-id header (pre-auth) --
const meGetFunc = CORS + `const pool=global.get('pool'); const uid=(msg.req.headers&&msg.req.headers['x-user-id'])||'';
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'x-user-id header required'};return msg;}
(async()=>{const[u]=await pool.query("SELECT id,org_id,email,name,role,department_id FROM users WHERE id=?",[uid]);
  const[pr]=await pool.query("SELECT prefs FROM user_prefs WHERE user_id=?",[uid]);
  const prefs = pr.length ? (typeof pr[0].prefs==='string'?JSON.parse(pr[0].prefs||'{}'):pr[0].prefs) : {};
  msg.headers=__CORS; msg.payload={ user: u.length?u[0]:{id:uid}, prefs }; node.send(msg);})()` + bbErr

const mePutFunc = CORS + `const pool=global.get('pool'); const uid=(msg.req.headers&&msg.req.headers['x-user-id'])||''; const prefs=msg.payload&&msg.payload.prefs!==undefined?msg.payload.prefs:msg.payload;
if(!uid){msg.headers=__CORS;msg.statusCode=401;msg.payload={error:'x-user-id header required'};return msg;}
(async()=>{await pool.query("INSERT INTO user_prefs (user_id,prefs) VALUES (?,?) ON DUPLICATE KEY UPDATE prefs=VALUES(prefs)",[uid,JSON.stringify(prefs||{})]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr

// --- Tenancy / provisioning (superadmin: orgs/entitlements/nodes; admin: depts/users/access)
// NOTE: not yet authz-enforced — guard lands with the JWT auth work.
const orgsListFunc = CORS + `const pool=global.get('pool');
(async()=>{const[r]=await pool.query("SELECT * FROM organizations ORDER BY name"); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const orgsPostFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||'org-'+Date.now(); await pool.query("INSERT INTO organizations (id,name,status,logo_url) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),status=VALUES(status),logo_url=VALUES(logo_url)",[id,b.name,b.status||'active',b.logoUrl||null]); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr
const orgsDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query("DELETE FROM organizations WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const entGetFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query("SELECT platform FROM org_entitlements WHERE org_id=?",[id]); msg.headers=__CORS; msg.payload=r.map(x=>x.platform); node.send(msg);})()` + bbErr
const entPutFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id; const list=(msg.payload&&msg.payload.platforms)||[];
(async()=>{await pool.query("DELETE FROM org_entitlements WHERE org_id=?",[id]); for(const p of list){ await pool.query("INSERT IGNORE INTO org_entitlements (org_id,platform) VALUES (?,?)",[id,p]); } msg.headers=__CORS; msg.payload={ok:true,count:list.length}; node.send(msg);})()` + bbErr
const deptListFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{const[r]=await pool.query("SELECT * FROM departments WHERE org_id=? ORDER BY name",[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const deptPostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||'dept-'+Date.now(); await pool.query("INSERT INTO departments (id,org_id,name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)",[id,orgId,b.name]); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr
const deptDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query("DELETE FROM departments WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const usrListFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId;
(async()=>{const[r]=await pool.query("SELECT id,org_id,email,name,role,department_id FROM users WHERE org_id=? ORDER BY name",[orgId]); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const usrPostFunc = CORS + `const pool=global.get('pool'); const orgId=msg.req.params.orgId; const b=msg.payload||{};
if(!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'name required'};return msg;}
(async()=>{const id=b.id||'u-'+Date.now(); await pool.query("INSERT INTO users (id,org_id,email,name,role,department_id) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),role=VALUES(role),department_id=VALUES(department_id)",[id,orgId,b.email||null,b.name,b.role||'viewer',b.departmentId||null]); msg.headers=__CORS; msg.payload={ok:true,id}; node.send(msg);})()` + bbErr
const usrDelFunc = CORS + `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{await pool.query("DELETE FROM users WHERE id=?",[id]); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const paGetFunc = CORS + `const pool=global.get('pool'); const q=msg.req.query||{};
(async()=>{const[r]=await pool.query("SELECT domain,level FROM product_access WHERE scope=? AND scope_id=?",[q.scope||'department',q.scopeId||'']); msg.headers=__CORS; msg.payload=r; node.send(msg);})()` + bbErr
const paPutFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.scope||!b.scopeId||!b.domain){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'scope, scopeId, domain required'};return msg;}
(async()=>{await pool.query("INSERT INTO product_access (scope,scope_id,domain,level) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level)",[b.scope,b.scopeId,b.domain,b.level||'view']); msg.headers=__CORS; msg.payload={ok:true}; node.send(msg);})()` + bbErr
const nodeProvFunc = CORS + `const pool=global.get('pool'); const b=msg.payload||{};
if(!b.id||!b.orgId||!b.domain||!b.name){msg.headers=__CORS;msg.statusCode=400;msg.payload={error:'id, orgId, domain, name required'};return msg;}
(async()=>{await pool.query("INSERT INTO nodes (id,org_id,site_id,department_id,domain,name,mqtt_prefix,lat,lng) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE site_id=VALUES(site_id),department_id=VALUES(department_id),domain=VALUES(domain),name=VALUES(name),mqtt_prefix=VALUES(mqtt_prefix),lat=VALUES(lat),lng=VALUES(lng)",[b.id,b.orgId,b.siteId||null,b.departmentId||null,b.domain,b.name,b.mqttPrefix||null,b.lat??null,b.lng??null]); msg.headers=__CORS; msg.payload={ok:true,id:b.id}; node.send(msg);})()` + bbErr

const flow = [
  { id: 'be', type: 'tab', label: 'ONEOPS Node-RED Backend (all-in-one)' },
  { id: 'wslistener', type: 'websocket-listener', path: '/ws/telemetry', wholemsg: 'false' },
  { id: 'mqttbroker', type: 'mqtt-broker', name: 'broker', broker: MQTT_HOST, port: MQTT_PORT, clientid: 'nr-backend' },

  // init
  { id: 'startup', type: 'inject', z: 'be', name: 'startup', props: [], once: true, onceDelay: '0.2', repeat: '', x: 130, y: 60, wires: [['init']] },
  fn('init', 'init pool + engine + guard', initFunc, 340, 60, [[]], 1, { libs: INIT_LIBS }),

  // ingest pipeline
  { id: 'mqttin', type: 'mqtt in', z: 'be', name: MQTT_TOPIC, topic: MQTT_TOPIC, qos: '0', datatype: 'auto-detect', broker: 'mqttbroker', x: 130, y: 140, wires: [['normalize']] },
  // downlink publisher: topic/qos/retain taken from each msg (config/cmd/ota)
  { id: 'mqttout', type: 'mqtt out', z: 'be', name: 'downlink', topic: '', qos: '', retain: '', broker: 'mqttbroker', x: 980, y: 470, wires: [] },
  fn('normalize', 'normalize (readings | presence | logs)', normalizeFunc, 330, 140, [['ingest', 'wsbroadcast'], ['presence'], ['devlog']], 3),
  fn('ingest', 'ingest + evaluate + persist', ingestFunc, 560, 160, [['dbgIngest'], ['notify', 'wsbroadcast'], [], ['mqttout']], 4, { libs: LIBS }),
  fn('notify', 'notify (Email/LINE/Telegram/GChat · per-tenant)', notifyFunc, 820, 200, [[]], 1, { libs: NOTIFY_LIBS }),
  // WebSocket bridge → frontend useMqttTelemetry (NEXT_PUBLIC_WS_URL)
  fn('wsbroadcast', 'ws broadcast', wsBroadcastFunc, 820, 280, [['wsout']], 1),
  { id: 'wsout', type: 'websocket out', z: 'be', name: 'telemetry ws', server: 'wslistener', client: '', x: 1030, y: 280, wires: [] },
  { id: 'dbgIngest', type: 'debug', z: 'be', name: 'ingest', active: true, complete: 'payload', x: 830, y: 140, wires: [] },

  // presence: heartbeat/status → device_presence (last_seen, online)
  fn('presence', 'presence upsert', presenceFunc, 560, 80, [[]], 1, { libs: LIBS }),
  // device logs: P/diag/log + P/ota/progress → device_logs
  fn('devlog', 'device log store', devlogFunc, 560, 20, [[]], 1, { libs: LIBS }),

  // global error catch → dead-letter (persist + warn); robustness
  { id: 'catchall', type: 'catch', z: 'be', name: 'catch all', scope: null, uncaught: false, x: 130, y: 540, wires: [['deadletter']] },
  fn('deadletter', 'dead-letter', deadLetterFunc, 350, 540, [[]], 1, { libs: LIBS }),

  // retention: hourly rollup + purge of raw readings
  { id: 'rettick', type: 'inject', z: 'be', name: 'hourly', props: [], repeat: '3600', x: 130, y: 600, wires: [['retention']] },
  fn('retention', 'readings retention', retentionFunc, 350, 600, [[]], 1, { libs: LIBS }),

  // scheduled reports: cron → CSV → email
  { id: 'rpttick', type: 'inject', z: 'be', name: 'every 15m', props: [], repeat: '900', x: 130, y: 660, wires: [['reportrun']] },
  fn('reportrun', 'report scheduler', reportRunFunc, 350, 660, [[]], 1, { libs: NOTIFY_LIBS }),

  // escalation loop
  { id: 'esctick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 260, wires: [['escalate']] },
  fn('escalate', 'escalation scan', escalationFunc, 350, 260, [['notify']], 1, { libs: LIBS }),

  // offline detection: unseen device > OFFLINE_AFTER_S → CRITICAL offline + notify
  { id: 'offtick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 330, wires: [['offlinesweep']] },
  fn('offlinesweep', 'offline sweep', offlineSweepFunc, 350, 330, [['notify']], 1, { libs: LIBS }),

  // auto-clear sweep: close events whose param returned to NORMAL (spec §9)
  { id: 'cleartick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 400, wires: [['clearsweep']] },
  fn('clearsweep', 'auto-clear sweep', clearSweepFunc, 350, 400, [['mqttout']], 1, { libs: LIBS }),

  // REST API (each endpoint = http in → fn → http response)
  ...endpoint('health', 'get', '/api/health', healthFunc, 'public'),
  ...endpoint('login', 'post', '/api/auth/login', loginFunc, 'public'),
  ...endpoint('getrule', 'get', '/api/nodes/:id/rule', getRuleFunc),
  ...endpoint('putrule', 'put', '/api/nodes/:id/rule', putRuleFunc, 'admin'),
  ...endpoint('orgrule', 'put', '/api/orgs/:orgId/rule', orgRuleFunc, 'admin'),
  ...endpoint('events', 'get', '/api/nodes/:id/events', getEventsFunc),
  ...endpoint('ack', 'post', '/api/events/:id/ack', ackFunc, 'admin'),
  ...endpoint('readget', 'get', '/api/nodes/:id/readings', readingsGetFunc),
  ...endpoint('docsget', 'get', '/api/nodes/:id/documents', docsGetFunc),
  ...endpoint('docspost', 'post', '/api/nodes/:id/documents', docsPostFunc),

  // BloodBOX domain (ERD #4): transits, journey, floors, beacons, locations
  ...endpoint('bbjourneyget', 'get', '/api/bloodbox/transits/:id/journey', bbJourneyGetFunc),
  ...bridgeEndpoint('bbjourneypost', 'post', '/api/bloodbox/transits/:id/journey', bbJourneyPostFunc),
  ...bridgeEndpoint('bbtemp', 'post', '/api/bloodbox/transits/:id/temp', bbTempFunc),
  ...endpoint('bbtransit', 'get', '/api/bloodbox/transits/:id', bbTransitFunc),
  ...endpoint('bbtransits', 'get', '/api/bloodbox/transits', bbTransitsFunc),
  ...endpoint('bbfloors', 'get', '/api/bloodbox/floors', bbFloorsFunc),
  ...endpoint('bbbeacondel', 'delete', '/api/bloodbox/beacons/:id', bbBeaconDelFunc),
  ...endpoint('bbbeaconsget', 'get', '/api/bloodbox/beacons', bbBeaconsGetFunc),
  ...endpoint('bbbeaconspost', 'post', '/api/bloodbox/beacons', bbBeaconsPostFunc),
  ...endpoint('bblocget', 'get', '/api/bloodbox/boxes/:id/location', bbLocGetFunc),
  ...endpoint('bblocpost', 'post', '/api/bloodbox/boxes/:id/location', bbLocPostFunc),

  // Generic fleet read API (all products): list + latest readings
  ...endpoint('fleetlatest', 'get', '/api/fleet/:id/latest', fleetLatestFunc),
  ...endpoint('fleetlist', 'get', '/api/fleet', fleetListFunc),

  // Scheduled-report CRUD (cron runs them; the scheduler lives in this flow)
  ...endpoint('rptlist', 'get', '/api/reports/schedules', rptListFunc),
  ...endpoint('rptpost', 'post', '/api/reports/schedules', rptPostFunc, 'admin'),
  ...endpoint('rptdel', 'delete', '/api/reports/schedules/:id', rptDelFunc, 'admin'),

  // Per-user config (configProfile)
  ...endpoint('meget', 'get', '/api/me/config', meGetFunc),
  ...endpoint('meput', 'put', '/api/me/config', mePutFunc),

  // Tenancy / provisioning (superadmin + admin; not yet authz-enforced)
  ...endpoint('orgsget', 'get', '/api/orgs', orgsListFunc),
  ...endpoint('orgspost', 'post', '/api/orgs', orgsPostFunc, 'super'),
  ...endpoint('entget', 'get', '/api/orgs/:id/entitlements', entGetFunc),
  ...endpoint('entput', 'put', '/api/orgs/:id/entitlements', entPutFunc, 'super'),
  ...endpoint('deptget', 'get', '/api/orgs/:orgId/departments', deptListFunc),
  ...endpoint('deptpost', 'post', '/api/orgs/:orgId/departments', deptPostFunc, 'admin'),
  ...endpoint('usrget', 'get', '/api/orgs/:orgId/users', usrListFunc),
  ...endpoint('usrpost', 'post', '/api/orgs/:orgId/users', usrPostFunc, 'admin'),
  ...endpoint('orgsdel', 'delete', '/api/orgs/:id', orgsDelFunc, 'super'),
  ...endpoint('deptdel', 'delete', '/api/departments/:id', deptDelFunc, 'admin'),
  ...endpoint('usrdel', 'delete', '/api/users/:id', usrDelFunc, 'admin'),
  ...endpoint('paget', 'get', '/api/product-access', paGetFunc),
  ...endpoint('paput', 'put', '/api/product-access', paPutFunc, 'admin'),
  ...endpoint('nodeprov', 'post', '/api/nodes', nodeProvFunc, 'super'),

  // Downlink (backend → device): config (retained) / cmd / ota
  ...downlinkEndpoint('cfgput', 'put', '/api/nodes/:id/config', cfgPutFunc, 'admin'),
  ...downlinkEndpoint('cmdpost', 'post', '/api/nodes/:id/cmd', cmdPostFunc, 'admin'),
  ...downlinkEndpoint('otapost', 'post', '/api/nodes/:id/ota', otaPostFunc, 'admin'),

  ...endpoint('cors', 'options', '/api/*', optionsFunc, 'public'),
]

// give every REST fn the mysql lib (handlers query the pool)
// Any handler that queries the pool gets the mysql lib (skip ones with libs set).
for (const n of flow) if (n.type === 'function' && /pool\.query|global\.get\('pool'\)/.test(n.func) && !(n.libs && n.libs.length)) n.libs = LIBS
// login also needs jwt + bcrypt (the guard closure's jwt lives in the init node)
const loginFn = flow.find((n) => n.id === 'login_fn'); if (loginFn) loginFn.libs = LOGIN_LIBS

// POST /readings ingest → reuse the engine ingest node, then reply via its
// own http response node. ingest re-emits the original msg (req/res preserved
// for HTTP-originated requests) on output 1, so we wire that to readpost_resp.
const httpIngest = endpoint('readpost', 'post', '/api/nodes/:id/readings', httpIngestFunc, 'public')
httpIngest[1].wires = [['ingest']]      // fn → ingest (engine)
httpIngest[1].name = 'POST /api/nodes/:id/readings'
flow.push(...httpIngest)                 // keep the http response node (readpost_resp)
// ingest output 3 → readings http response (only fired for HTTP-origin msgs)
const ingestNode = flow.find((n) => n.id === 'ingest')
ingestNode.wires = [['dbgIngest'], ['notify', 'wsbroadcast'], ['readpost_resp'], ['mqttout']]

const out = join(dirname(fileURLToPath(import.meta.url)), 'flows.nodered-backend.json')
writeFileSync(out, JSON.stringify(flow, null, 2) + '\n')
const types = [...new Set(flow.map((n) => n.type))]
console.log('Generated', out, '—', flow.length, 'nodes ·', types.join(', '))
console.log('Endpoints: GET /health · GET|PUT /nodes/:id/rule · PUT /orgs/:orgId/rule · GET /nodes/:id/events · POST /events/:id/ack · GET|POST /nodes/:id/readings · GET|POST /nodes/:id/documents · OPTIONS /api/*')
console.log('BloodBOX: GET /bloodbox/transits · GET /bloodbox/transits/:id · GET|POST /bloodbox/transits/:id/journey · POST /bloodbox/transits/:id/temp (→engine bridge) · GET /bloodbox/floors · GET|POST|DELETE /bloodbox/beacons · GET|POST /bloodbox/boxes/:id/location')
console.log('Fleet (all products): GET /fleet?orgId=&domain= · GET /fleet/:id/latest')
console.log('Downlink (→device): PUT /nodes/:id/config (retained) · POST /nodes/:id/cmd · POST /nodes/:id/ota')
console.log('Reports: GET|POST /reports/schedules · DELETE /reports/schedules/:id (cron 15m → CSV email)')
console.log('Realtime: WebSocket bridge on listener path /ws/telemetry (tap normalize + ingest)')
