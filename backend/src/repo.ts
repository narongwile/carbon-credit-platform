import type { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from './db.js'
import type { NodeAlarmRule, AlarmEvent } from './engine.js'

// ---- Alarm rules -----------------------------------------------------------
export async function getRule(nodeId: string): Promise<NodeAlarmRule | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT rule_json FROM alarm_rules WHERE node_id = :id', { id: nodeId })
  if (!rows.length) return null
  const raw = rows[0].rule_json
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as NodeAlarmRule)
}

export async function putRule(nodeId: string, orgId: string, rule: NodeAlarmRule, updatedBy?: string): Promise<void> {
  await pool.query(
    `INSERT INTO alarm_rules (node_id, org_id, domain, rule_json, updated_by)
     VALUES (:nodeId, :orgId, :domain, :rule, :by)
     ON DUPLICATE KEY UPDATE rule_json = :rule, domain = :domain, updated_by = :by`,
    { nodeId, orgId, domain: rule.domain, rule: JSON.stringify(rule), by: updatedBy ?? null },
  )
}

export async function nodesByOrg(orgId: string): Promise<{ id: string; domain: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, domain FROM nodes WHERE org_id = :orgId', { orgId })
  return rows as { id: string; domain: string }[]
}

// ---- Fleet (generic, all products) ----------------------------------------
export async function fleetByOrg(orgId: string, domain?: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT n.id, n.name, n.domain, n.site_id, n.department_id,
            p.online, p.last_seen, p.rssi, p.fw,
            (SELECT e.severity FROM alarm_events e
              WHERE e.node_id = n.id AND e.acknowledged_at IS NULL
              ORDER BY FIELD(e.severity,'CRITICAL','WARNING') LIMIT 1) AS alarm
       FROM nodes n LEFT JOIN device_presence p ON p.node_id = n.id
      WHERE n.org_id = :orgId ${domain ? 'AND n.domain = :domain' : ''}
      ORDER BY n.domain, n.id`,
    { orgId, domain },
  )
  return rows
}

export async function latestReadings(nodeId: string): Promise<{ nodeId: string; values: Record<string, number>; lastReadingAt: string | null }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r1.param_key, r1.value, r1.taken_at FROM readings r1
       JOIN (SELECT param_key, MAX(taken_at) mt FROM readings WHERE node_id = :id GROUP BY param_key) r2
         ON r1.param_key = r2.param_key AND r1.taken_at = r2.mt
      WHERE r1.node_id = :id`,
    { id: nodeId },
  )
  const values: Record<string, number> = {}
  let last: string | null = null
  for (const r of rows) { values[r.param_key as string] = Number(r.value); if (!last || (r.taken_at as string) > last) last = r.taken_at as string }
  return { nodeId, values, lastReadingAt: last }
}

// ---- Events ----------------------------------------------------------------
export async function insertEvents(orgId: string, deptId: string | null, events: AlarmEvent[]): Promise<number> {
  if (!events.length) return 0
  const values = events.map((e) => [
    e.id, e.nodeId, orgId, deptId, e.paramKey, e.paramLabel, e.severity, e.kind,
    e.value, e.threshold, e.unit, new Date(e.ts),
  ])
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO alarm_events
       (id, node_id, org_id, department_id, param_key, param_label, severity, kind, value, threshold, unit, raised_at)
     VALUES ?`,
    [values],
  )
  return res.affectedRows
}

export async function eventsByNode(nodeId: string, limit = 50): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM alarm_events WHERE node_id = :nodeId ORDER BY raised_at DESC LIMIT :limit',
    { nodeId, limit },
  )
  return rows
}

export async function ackEvent(id: string, by: string, eventProblemId?: string): Promise<void> {
  await pool.query(
    'UPDATE alarm_events SET acknowledged_at = NOW(3), acknowledged_by = :by, event_problem_id = :ep WHERE id = :id',
    { id, by, ep: eventProblemId ?? null },
  )
}

export async function unacknowledgedCriticals(olderThanMin: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM alarm_events
      WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND escalated = 0
        AND raised_at < (NOW(3) - INTERVAL :mins MINUTE)`,
    { mins: olderThanMin },
  )
  return rows
}

export async function markEscalated(ids: string[]): Promise<void> {
  if (!ids.length) return
  await pool.query('UPDATE alarm_events SET escalated = 1 WHERE id IN (?)', [ids])
}

// ---- Readings (telemetry ingest) ------------------------------------------
export async function insertReading(nodeId: string, paramKey: string, value: number, takenAt: Date): Promise<void> {
  await pool.query(
    'INSERT IGNORE INTO readings (node_id, param_key, value, taken_at) VALUES (:n, :p, :v, :t)',
    { n: nodeId, p: paramKey, v: value, t: takenAt },
  )
}

export async function recentReadings(nodeId: string, sinceMin = 360): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT param_key, value, taken_at FROM readings
      WHERE node_id = :nodeId AND taken_at > (NOW(3) - INTERVAL :mins MINUTE)
      ORDER BY taken_at ASC`,
    { nodeId, mins: sinceMin },
  )
  return rows
}

export async function nodeMeta(nodeId: string): Promise<{ org_id: string; department_id: string | null; domain: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT org_id, department_id, domain FROM nodes WHERE id = :id', { id: nodeId })
  return rows.length ? (rows[0] as { org_id: string; department_id: string | null; domain: string }) : null
}

export async function existingEventIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM alarm_events WHERE id IN (?)', [ids])
  return new Set(rows.map((r) => r.id as string))
}

// ---- Channels --------------------------------------------------------------
export async function channelsFor(orgId: string, deptId: string | null): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM notification_channels
      WHERE org_id = :orgId AND enabled = 1 AND (department_id IS NULL OR department_id = :dept)`,
    { orgId, dept: deptId },
  )
  return rows
}
