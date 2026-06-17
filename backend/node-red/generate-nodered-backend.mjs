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
const CORS = `const __CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS'};\n`

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
node.warn('ONEOPS Node-RED backend: pool + engine ready');
`

const ingestFunc = `
const __H = { 'Access-Control-Allow-Origin': '*' };
const __http = !!(msg.req && msg.res);   // only HTTP-origin msgs get a response (out 3)
const pool = global.get('pool'); const evaluate = global.get('evaluate');
const { nodeId, values, ts } = msg.payload || {};
if (!pool || !evaluate || !nodeId || !values) { msg.headers = __H; msg.statusCode = 400; msg.payload = { error: 'bad input' }; node.send([msg, null, __http ? msg : null]); return null; }
const taken = new Date(ts || Date.now());
(async () => {
  for (const [k,v] of Object.entries(values)) { if(typeof v==='number') await pool.query('INSERT IGNORE INTO readings (node_id,param_key,value,taken_at) VALUES (?,?,?,?)',[nodeId,k,v,taken]); }
  const [rr] = await pool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?',[nodeId]);
  const [mm] = await pool.query('SELECT org_id, department_id FROM nodes WHERE id=?',[nodeId]);
  if (!rr.length || !mm.length) { msg.headers=__H; msg.payload={inserted:0,reason:'no rule/node'}; node.send([msg,null,__http?msg:null]); return; }
  const rule = typeof rr[0].rule_json==='string'?JSON.parse(rr[0].rule_json):rr[0].rule_json;
  const [rows] = await pool.query('SELECT param_key,value,taken_at FROM readings WHERE node_id=? AND taken_at>(NOW(3)-INTERVAL 360 MINUTE) ORDER BY taken_at ASC',[nodeId]);
  const byTs=new Map();
  for(const r of rows){const t=new Date(r.taken_at).getTime(); if(!byTs.has(t))byTs.set(t,{time:new Date(t).toISOString(),ts:t,values:{}}); byTs.get(t).values[r.param_key]=Number(r.value);}
  const readings=[...byTs.values()].sort((a,b)=>a.ts-b.ts);
  const events = evaluate(nodeId, rule, readings);
  let inserted=0;
  for (const e of events){
    const [ex]=await pool.query('SELECT id FROM alarm_events WHERE id=?',[e.id]); if (ex.length) continue;
    await pool.query('INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [e.id,nodeId,mm[0].org_id,mm[0].department_id,e.paramKey,e.paramLabel,e.severity,e.kind,e.value,e.threshold,e.unit,new Date(e.ts)]);
    inserted++; node.send([null, { payload: Object.assign({}, e, { orgId: mm[0].org_id, departmentId: mm[0].department_id }) }, null]);
  }
  msg.headers = __H; msg.payload = { inserted }; node.send([msg, null, __http?msg:null]);
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
let nodeId, values, ts = Date.now();
if (msg.payload && typeof msg.payload==='object' && msg.payload.nodeId){ nodeId=msg.payload.nodeId; values=msg.payload.values||{}; ts=msg.payload.ts||ts; }
else { const p=(msg.topic||'').split('/'); nodeId=p[1]; values={[p[2]]:Number(msg.payload)}; }
if(!nodeId) return null;
msg.payload = { nodeId, values, ts };
return msg;
`

const escalationFunc = `
const pool = global.get('pool'); if(!pool) return null;
(async()=>{
  const [rows]=await pool.query("SELECT * FROM alarm_events WHERE severity='CRITICAL' AND acknowledged_at IS NULL AND escalated=0 AND raised_at<(NOW(3)-INTERVAL ${ESCALATE_MIN} MINUTE)");
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

const LIBS = [{ var: 'mysql', module: 'mysql2/promise' }]
// notify node also needs nodemailer (SMTP email), like the Express service
const NOTIFY_LIBS = [{ var: 'mysql', module: 'mysql2/promise' }, { var: 'nodemailer', module: 'nodemailer' }]
const fn = (id, name, func, x, y, wires, outputs = 1, extra = {}) => ({ id, type: 'function', z: 'be', name, func, outputs, libs: [], x, y, wires, ...extra })
let yREST = 360
const endpoint = (idBase, method, url, handlerFunc) => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, handlerFunc, 420, y, [[`${idBase}_resp`]]),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}
// Like endpoint() but the handler has a 2nd output wired to the engine `ingest`
// node — used by the BloodBOX transit-temperature bridge (excursion alerts).
const bridgeEndpoint = (idBase, method, url, handlerFunc) => {
  const y = yREST; yREST += 50
  return [
    { id: `${idBase}_in`, type: 'http in', z: 'be', name: '', url, method, x: 150, y, wires: [[`${idBase}_fn`]] },
    fn(`${idBase}_fn`, `${method.toUpperCase()} ${url}`, handlerFunc, 420, y, [[`${idBase}_resp`], ['ingest']], 2, { libs: LIBS }),
    { id: `${idBase}_resp`, type: 'http response', z: 'be', statusCode: '', x: 700, y, wires: [] },
  ]
}

const flow = [
  { id: 'be', type: 'tab', label: 'ONEOPS Node-RED Backend (all-in-one)' },
  { id: 'mqttbroker', type: 'mqtt-broker', name: 'broker', broker: MQTT_HOST, port: MQTT_PORT, clientid: 'nr-backend' },

  // init
  { id: 'startup', type: 'inject', z: 'be', name: 'startup', props: [], once: true, onceDelay: '0.2', repeat: '', x: 130, y: 60, wires: [['init']] },
  fn('init', 'init pool + engine', initFunc, 340, 60, [[]], 1, { libs: LIBS }),

  // ingest pipeline
  { id: 'mqttin', type: 'mqtt in', z: 'be', name: MQTT_TOPIC, topic: MQTT_TOPIC, qos: '0', datatype: 'auto-detect', broker: 'mqttbroker', x: 130, y: 140, wires: [['normalize']] },
  fn('normalize', 'normalize', normalizeFunc, 330, 140, [['ingest']]),
  fn('ingest', 'ingest + evaluate + persist', ingestFunc, 560, 160, [['dbgIngest'], ['notify'], []], 3, { libs: LIBS }),
  fn('notify', 'notify (Email/LINE/Telegram/GChat · per-tenant)', notifyFunc, 820, 200, [[]], 1, { libs: NOTIFY_LIBS }),
  { id: 'dbgIngest', type: 'debug', z: 'be', name: 'ingest', active: true, complete: 'payload', x: 830, y: 140, wires: [] },

  // escalation loop
  { id: 'esctick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 260, wires: [['escalate']] },
  fn('escalate', 'escalation scan', escalationFunc, 350, 260, [['notify']], 1, { libs: LIBS }),

  // REST API (each endpoint = http in → fn → http response)
  ...endpoint('health', 'get', '/api/health', healthFunc),
  ...endpoint('getrule', 'get', '/api/nodes/:id/rule', getRuleFunc),
  ...endpoint('putrule', 'put', '/api/nodes/:id/rule', putRuleFunc),
  ...endpoint('orgrule', 'put', '/api/orgs/:orgId/rule', orgRuleFunc),
  ...endpoint('events', 'get', '/api/nodes/:id/events', getEventsFunc),
  ...endpoint('ack', 'post', '/api/events/:id/ack', ackFunc),
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

  ...endpoint('cors', 'options', '/api/*', optionsFunc),
]

// give every REST fn the mysql lib (handlers query the pool)
for (const n of flow) if (n.type === 'function' && /^(health|getrule|putrule|orgrule|events|ack|readget|docs|bb)/.test(n.id)) n.libs = LIBS

// POST /readings ingest → reuse the engine ingest node, then reply via its
// own http response node. ingest re-emits the original msg (req/res preserved
// for HTTP-originated requests) on output 1, so we wire that to readpost_resp.
const httpIngest = endpoint('readpost', 'post', '/api/nodes/:id/readings', httpIngestFunc)
httpIngest[1].wires = [['ingest']]      // fn → ingest (engine)
httpIngest[1].name = 'POST /api/nodes/:id/readings'
flow.push(...httpIngest)                 // keep the http response node (readpost_resp)
// ingest output 3 → readings http response (only fired for HTTP-origin msgs)
const ingestNode = flow.find((n) => n.id === 'ingest')
ingestNode.wires = [['dbgIngest'], ['notify'], ['readpost_resp']]

const out = join(dirname(fileURLToPath(import.meta.url)), 'flows.nodered-backend.json')
writeFileSync(out, JSON.stringify(flow, null, 2) + '\n')
const types = [...new Set(flow.map((n) => n.type))]
console.log('Generated', out, '—', flow.length, 'nodes ·', types.join(', '))
console.log('Endpoints: GET /health · GET|PUT /nodes/:id/rule · PUT /orgs/:orgId/rule · GET /nodes/:id/events · POST /events/:id/ack · GET|POST /nodes/:id/readings · GET|POST /nodes/:id/documents · OPTIONS /api/*')
console.log('BloodBOX: GET /bloodbox/transits · GET /bloodbox/transits/:id · GET|POST /bloodbox/transits/:id/journey · POST /bloodbox/transits/:id/temp (→engine bridge) · GET /bloodbox/floors · GET|POST|DELETE /bloodbox/beacons · GET|POST /bloodbox/boxes/:id/location')
