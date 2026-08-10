#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Auto-generate a Node-RED flow (flows.json) for the ONEOPS telemetry pipeline.
// No hand-wiring needed — run `node generate-flows.mjs` and import the result
// into Node-RED (Menu → Import → select flows.json → Deploy).
//
//   Customize via env:
//     BACKEND_URL  (default http://oneops-backend.data.svc.cluster.local)
//     MQTT_HOST    (default mqtt.data.svc.cluster.local)
//     MQTT_PORT    (default 1883)
//     MQTT_TOPIC   (default telemetry/#)
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BACKEND_URL = process.env.BACKEND_URL || 'http://oneops-backend.data.svc.cluster.local'
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt.data.svc.cluster.local'
const MQTT_PORT = process.env.MQTT_PORT || '1883'
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'telemetry/#'

const normalizeFn = `// Accepts either JSON {nodeId, values, ts} or topic telemetry/<nodeId>/<param> = number
let nodeId, values, ts = Date.now();
if (msg.payload && typeof msg.payload === 'object' && msg.payload.nodeId) {
  nodeId = msg.payload.nodeId; values = msg.payload.values || {}; ts = msg.payload.ts || ts;
} else {
  const p = (msg.topic || '').split('/');   // telemetry/<nodeId>/<param>
  nodeId = p[1]; values = { [p[2]]: Number(msg.payload) };
}
if (!nodeId) { return null; }
msg.method = 'POST';
msg.url = '${BACKEND_URL}/api/nodes/' + nodeId + '/readings';
msg.headers = { 'content-type': 'application/json' };
msg.payload = { values, ts };
return msg;`

const simFn = `// Manual test: pretend transformer tr-001 reports a hot oil temperature
msg.payload = { nodeId: 'tr-001', values: { oilTemp: 96, hydrogen: 220 }, ts: Date.now() };
return msg;`

const flow = [
  { id: 'oneops-tab', type: 'tab', label: 'ONEOPS Telemetry → Alarm Engine', disabled: false },

  { id: 'mqtt-broker', type: 'mqtt-broker', name: 'cluster broker', broker: MQTT_HOST, port: MQTT_PORT, clientid: 'node-red-oneops', keepalive: '60', cleansession: true },

  { id: 'mqtt-in', type: 'mqtt in', z: 'oneops-tab', name: MQTT_TOPIC, topic: MQTT_TOPIC, qos: '0', datatype: 'auto-detect', broker: 'mqtt-broker', x: 150, y: 120, wires: [['normalize']] },

  { id: 'normalize', type: 'function', z: 'oneops-tab', name: 'normalize → ingest payload', func: normalizeFn, outputs: 1, noerr: 0, x: 410, y: 120, wires: [['http-ingest']] },

  { id: 'http-ingest', type: 'http request', z: 'oneops-tab', name: 'POST → backend ingest (evaluate + notify)', method: 'use', ret: 'obj', url: '', persist: false, x: 720, y: 120, wires: [['debug-ok']] },

  { id: 'debug-ok', type: 'debug', z: 'oneops-tab', name: 'ingest result', active: true, complete: 'payload', x: 990, y: 120, wires: [] },

  { id: 'catch', type: 'catch', z: 'oneops-tab', name: 'errors', scope: null, x: 720, y: 200, wires: [['debug-err']] },
  { id: 'debug-err', type: 'debug', z: 'oneops-tab', name: 'error', active: true, complete: 'true', x: 980, y: 200, wires: [] },

  // --- manual test path (no broker needed) ---
  { id: 'inject-sim', type: 'inject', z: 'oneops-tab', name: 'Simulate reading', props: [{ p: 'payload' }], repeat: '', once: false, x: 160, y: 300, wires: [['sim-fn']] },
  { id: 'sim-fn', type: 'function', z: 'oneops-tab', name: 'fake tr-001 telemetry', func: simFn, outputs: 1, x: 400, y: 300, wires: [['normalize']] },
]

const out = join(dirname(fileURLToPath(import.meta.url)), 'flows.json')
writeFileSync(out, JSON.stringify(flow, null, 2) + '\n')
console.log(`Generated ${out}`)
console.log(`  backend: ${BACKEND_URL}`)
console.log(`  mqtt:    ${MQTT_HOST}:${MQTT_PORT}  topic ${MQTT_TOPIC}`)
console.log('Import in Node-RED:  Menu → Import → select flows.json → Deploy')
