import mqtt, { type MqttClient } from 'mqtt'
import { ingest } from './ingest.js'
import { broadcastTelemetry } from './ws.js'

let client: MqttClient | null = null

// Backend→device downlink (config/cmd/ota). No-op + log if not yet connected.
export function publishDownlink(topic: string, payload: unknown, opts: { qos?: 0 | 1 | 2; retain?: boolean } = {}): boolean {
  if (!client) { console.warn('[mqtt] downlink skipped — client not ready:', topic); return false }
  client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: opts.qos ?? 1, retain: opts.retain ?? false })
  return true
}

// Subscribe to device/Node-RED telemetry and feed the alarm engine.
// Accepted payloads on MQTT_TOPIC (default telemetry/#):
//   • JSON: { "nodeId": "tr-001", "values": { "oilTemp": 82.1 }, "ts": 1690000000000 }
//   • topic telemetry/<nodeId>/<param> with a numeric payload
export function startMqtt(): void {
  const url = process.env.MQTT_URL || 'mqtt://mqtt.data.svc.cluster.local:1883'
  const topic = process.env.MQTT_TOPIC || 'telemetry/#'
  client = mqtt.connect(url, { reconnectPeriod: 5000 })

  client.on('connect', () => { console.log(`[mqtt] connected ${url}`); client!.subscribe(topic) })
  client.on('error', (e) => console.error('[mqtt]', e.message))

  client.on('message', async (t, buf) => {
    try {
      const text = buf.toString()
      if (text.trim().startsWith('{')) {
        const m = JSON.parse(text) as { nodeId: string; values: Record<string, number>; ts?: number }
        if (m.nodeId && m.values) { await ingest(m.nodeId, m.values, m.ts); broadcastTelemetry(m.nodeId, m.values, m.ts) }
      } else {
        const parts = t.split('/') // telemetry/<nodeId>/<param>
        const nodeId = parts[1], param = parts[2]
        const val = Number(text)
        if (nodeId && param && !Number.isNaN(val)) { await ingest(nodeId, { [param]: val }); broadcastTelemetry(nodeId, { [param]: val }) }
      }
    } catch (e) {
      console.error('[mqtt:message]', (e as Error).message)
    }
  })
}
