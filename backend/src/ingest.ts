import type { RowDataPacket } from 'mysql2'
import { evaluate, type Reading, type AlarmEvent } from './engine.js'
import {
  insertReading, getRule, recentReadings, nodeMeta, existingEventIds, insertEvents, channelsFor, mqttPrefix,
} from './repo.js'
import { dispatch, type Channel } from './notify/index.js'
import { publishDownlink } from './mqtt.js'

function groupReadings(rows: RowDataPacket[]): Reading[] {
  const byTs = new Map<number, Reading>()
  for (const r of rows) {
    const ts = new Date(r.taken_at).getTime()
    if (!byTs.has(ts)) byTs.set(ts, { time: new Date(ts).toISOString(), ts, values: {} })
    byTs.get(ts)!.values[r.param_key] = Number(r.value)
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/**
 * Ingest one telemetry sample (from MQTT or HTTP), evaluate the node against its
 * saved rule, persist NEW events, and dispatch notifications for them.
 */
export async function ingest(nodeId: string, values: Record<string, number>, ts?: number): Promise<{ inserted: number }> {
  const taken = new Date(ts ?? Date.now())
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number' && !Number.isNaN(v)) await insertReading(nodeId, k, v, taken)
  }

  const [rule, meta] = await Promise.all([getRule(nodeId), nodeMeta(nodeId)])
  if (!rule || !meta) return { inserted: 0 }

  const readings = groupReadings(await recentReadings(nodeId))
  const events = evaluate(nodeId, rule, readings)
  if (!events.length) return { inserted: 0 }

  const existing = await existingEventIds(events.map((e) => e.id))
  const fresh: AlarmEvent[] = events.filter((e) => !existing.has(e.id))
  if (!fresh.length) return { inserted: 0 }

  await insertEvents(meta.org_id, meta.department_id, fresh)

  // §9: retained per-device alarm echo so late subscribers / actuators read current state
  const prefix = await mqttPrefix(nodeId)
  if (prefix) for (const e of fresh) {
    publishDownlink(`${prefix}/alarm/${e.paramKey}`, { sid: e.paramKey, severity: e.severity, value: e.value, thr: e.threshold, state: e.severity, ts: e.ts }, { qos: 1, retain: true })
  }

  const channels = await channelsFor(meta.org_id, meta.department_id)
  const cfgs = channels.map((c) => ({ channel: c.channel as Channel, target: c.target as string, min_severity: c.min_severity as 'WARNING' | 'CRITICAL' }))
  if (cfgs.length) for (const e of fresh) await dispatch(e, cfgs)

  return { inserted: fresh.length }
}
