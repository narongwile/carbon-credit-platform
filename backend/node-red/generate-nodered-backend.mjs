#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Auto-generate a NODE-RED-ONLY backend flow (no Express service).
// It implements MQTT ingest + the alarm engine + MySQL persistence + REST API
// + notifications + escalation entirely inside Node-RED.
//
// Requires (in your Node-RED):
//   • settings.js → functionExternalModules: true
//   • the `mysql2` npm module available to function nodes (added via the
//     function node "Setup → Modules", which this flow pre-declares)
//   • env vars on the Node-RED process: DB_HOST/PORT/USER/PASSWORD/NAME,
//     LINE_NOTIFY_TOKEN / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / GOOGLE_CHAT_WEBHOOK
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

// --- shared engine + db helpers, installed into global context on deploy ----
const initFunc = `
const mysql = global.get('mysql') || require('mysql2/promise');
global.set('mysql', mysql);
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
// Pure alarm engine (mirrors src/server/alarmEngine.ts) ----------------------
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
const pool = global.get('pool'); const evaluate = global.get('evaluate');
const { nodeId, values, ts } = msg.payload || {};
if (!pool || !evaluate || !nodeId || !values) { msg.payload = { error: 'bad input' }; return msg; }
const taken = new Date(ts || Date.now());
(async () => {
  for (const [k,v] of Object.entries(values)) { if(typeof v==='number') await pool.query('INSERT IGNORE INTO readings (node_id,param_key,value,taken_at) VALUES (?,?,?,?)',[nodeId,k,v,taken]); }
  const [rr] = await pool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?',[nodeId]);
  const [mm] = await pool.query('SELECT org_id, department_id FROM nodes WHERE id=?',[nodeId]);
  if (!rr.length || !mm.length) { msg.payload={inserted:0}; node.send(msg); return; }
  const rule = typeof rr[0].rule_json==='string'?JSON.parse(rr[0].rule_json):rr[0].rule_json;
  const [rows] = await pool.query('SELECT param_key,value,taken_at FROM readings WHERE node_id=? AND taken_at>(NOW(3)-INTERVAL 360 MINUTE) ORDER BY taken_at ASC',[nodeId]);
  const byTs=new Map();
  for(const r of rows){const t=new Date(r.taken_at).getTime(); if(!byTs.has(t))byTs.set(t,{time:new Date(t).toISOString(),ts:t,values:{}}); byTs.get(t).values[r.param_key]=Number(r.value);}
  const readings=[...byTs.values()].sort((a,b)=>a.ts-b.ts);
  const events = evaluate(nodeId, rule, readings);
  let inserted=0;
  for (const e of events){
    const [ex]=await pool.query('SELECT id FROM alarm_events WHERE id=?',[e.id]);
    if (ex.length) continue;
    await pool.query('INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [e.id,nodeId,mm[0].org_id,mm[0].department_id,e.paramKey,e.paramLabel,e.severity,e.kind,e.value,e.threshold,e.unit,new Date(e.ts)]);
    inserted++;
    node.send([null, { payload: e }]); // 2nd output → notify
  }
  msg.payload = { inserted }; node.send([msg, null]);
})().catch(err => { node.error(err.message, msg); });
return null;
`

const notifyFunc = `
const e = msg.payload; const env2 = (k)=>env.get(k);
const text = '['+e.severity+'] '+e.paramLabel+' = '+e.value+e.unit+' (limit '+e.threshold+') on '+e.nodeId+' @ '+e.time;
(async () => {
  try {
    const line = env2('LINE_NOTIFY_TOKEN');
    if (line) await fetch('https://notify-api.line.me/api/notify',{method:'POST',headers:{Authorization:'Bearer '+line,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:' '+text})});
    const tg = env2('TELEGRAM_BOT_TOKEN'), chat = env2('TELEGRAM_CHAT_ID');
    if (tg && chat) await fetch('https://api.telegram.org/bot'+tg+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text})});
    const gc = env2('GOOGLE_CHAT_WEBHOOK');
    if (gc) await fetch(gc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
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
  for(const r of rows){ node.send({ payload: { nodeId:r.node_id, paramLabel:'ESCALATION · '+r.param_label, value:Number(r.value), unit:r.unit, threshold:Number(r.threshold), severity:'CRITICAL', time:new Date(r.raised_at).toISOString() } }); }
  if(rows.length){ await pool.query('UPDATE alarm_events SET escalated=1 WHERE id IN (?)',[rows.map(r=>r.id)]); }
})().catch(e=>node.error(e.message));
return null;
`

// REST endpoint handlers ------------------------------------------------------
const getRuleFunc = `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT rule_json FROM alarm_rules WHERE node_id=?',[id]); msg.statusCode=r.length?200:404; msg.payload=r.length?(typeof r[0].rule_json==='string'?JSON.parse(r[0].rule_json):r[0].rule_json):{error:'no rule'}; node.send(msg);})(); return null;`
const putRuleFunc = `const pool=global.get('pool'); const id=msg.req.params.id; const {orgId,rule,updatedBy}=msg.payload||{};
(async()=>{await pool.query('INSERT INTO alarm_rules (node_id,org_id,domain,rule_json,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE rule_json=VALUES(rule_json),domain=VALUES(domain),updated_by=VALUES(updated_by)',[id,orgId,rule.domain,JSON.stringify(rule),updatedBy||null]); msg.payload={ok:true}; node.send(msg);})(); return null;`
const getEventsFunc = `const pool=global.get('pool'); const id=msg.req.params.id;
(async()=>{const[r]=await pool.query('SELECT * FROM alarm_events WHERE node_id=? ORDER BY raised_at DESC LIMIT 50',[id]); msg.payload=r; node.send(msg);})(); return null;`
const ackFunc = `const pool=global.get('pool'); const id=msg.req.params.id; const {by,eventProblemId}=msg.payload||{};
(async()=>{await pool.query('UPDATE alarm_events SET acknowledged_at=NOW(3),acknowledged_by=?,event_problem_id=? WHERE id=?',[by||'user',eventProblemId||null,id]); msg.payload={ok:true}; node.send(msg);})(); return null;`

const LIBS = [{ var: 'mysql', module: 'mysql2/promise' }]
const fn = (id, name, func, x, y, wires, outputs = 1, extra = {}) => ({ id, type: 'function', z: 'be', name, func, outputs, libs: [], x, y, wires, ...extra })

const flow = [
  { id: 'be', type: 'tab', label: 'ONEOPS Node-RED Backend (all-in-one)' },
  { id: 'mqttbroker', type: 'mqtt-broker', name: 'broker', broker: MQTT_HOST, port: MQTT_PORT, clientid: 'nr-backend' },

  // init (pool + engine)
  { id: 'startup', type: 'inject', z: 'be', name: 'startup', props: [], once: true, onceDelay: '0.2', repeat: '', x: 130, y: 60, wires: [['init']] },
  fn('init', 'init pool + engine', initFunc, 340, 60, [[]], 1, { libs: LIBS }),

  // ingest pipeline
  { id: 'mqttin', type: 'mqtt in', z: 'be', name: MQTT_TOPIC, topic: MQTT_TOPIC, qos: '0', datatype: 'auto-detect', broker: 'mqttbroker', x: 130, y: 140, wires: [['normalize']] },
  fn('normalize', 'normalize', normalizeFunc, 330, 140, [['ingest']]),
  fn('ingest', 'ingest + evaluate + persist', ingestFunc, 560, 160, [['dbgIngest'], ['notify']], 2),
  fn('notify', 'notify (LINE/Telegram/GChat)', notifyFunc, 820, 200, [[]]),
  { id: 'dbgIngest', type: 'debug', z: 'be', name: 'ingest', active: true, complete: 'payload', x: 830, y: 140, wires: [] },

  // escalation loop
  { id: 'esctick', type: 'inject', z: 'be', name: 'every 60s', props: [], repeat: '60', x: 130, y: 260, wires: [['escalate']] },
  fn('escalate', 'escalation scan', escalationFunc, 350, 260, [['notify']]),

  // REST API (http in/response)
  { id: 'hGetRule', type: 'http in', z: 'be', name: '', url: '/api/nodes/:id/rule', method: 'get', x: 140, y: 360, wires: [['fGetRule']] },
  fn('fGetRule', 'getRule', getRuleFunc, 360, 360, [['resp1']]),
  { id: 'resp1', type: 'http response', z: 'be', x: 560, y: 360, wires: [] },

  { id: 'hPutRule', type: 'http in', z: 'be', name: '', url: '/api/nodes/:id/rule', method: 'put', x: 140, y: 410, wires: [['fPutRule']] },
  fn('fPutRule', 'putRule', putRuleFunc, 360, 410, [['resp2']]),
  { id: 'resp2', type: 'http response', z: 'be', x: 560, y: 410, wires: [] },

  { id: 'hEvents', type: 'http in', z: 'be', name: '', url: '/api/nodes/:id/events', method: 'get', x: 140, y: 460, wires: [['fEvents']] },
  fn('fEvents', 'getEvents', getEventsFunc, 360, 460, [['resp3']]),
  { id: 'resp3', type: 'http response', z: 'be', x: 560, y: 460, wires: [] },

  { id: 'hAck', type: 'http in', z: 'be', name: '', url: '/api/events/:id/ack', method: 'post', x: 140, y: 510, wires: [['fAck']] },
  fn('fAck', 'ackEvent', ackFunc, 360, 510, [['resp4']]),
  { id: 'resp4', type: 'http response', z: 'be', x: 560, y: 510, wires: [] },

  { id: 'hIngest', type: 'http in', z: 'be', name: '', url: '/api/nodes/:id/readings', method: 'post', x: 140, y: 560, wires: [['fHttpIngest']] },
  fn('fHttpIngest', 'http→{nodeId,values}', `msg.payload={nodeId:msg.req.params.id,values:(msg.payload&&msg.payload.values)||{},ts:(msg.payload&&msg.payload.ts)};return msg;`, 360, 560, [['ingest']]),
]

const out = join(dirname(fileURLToPath(import.meta.url)), 'flows.nodered-backend.json')
writeFileSync(out, JSON.stringify(flow, null, 2) + '\n')
console.log('Generated', out, '—', flow.length, 'nodes')
console.log('Import in Node-RED (functionExternalModules: true; mysql2 available). REST on Node-RED httpNodeRoot.')
