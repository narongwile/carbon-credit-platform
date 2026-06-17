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
    `SELECT n.id, n.name, n.domain, n.site_id, n.department_id, n.lat, n.lng,
            p.online, p.last_seen, p.rssi, p.fw,
            (SELECT e.severity FROM alarm_events e
              WHERE e.node_id = n.id AND e.acknowledged_at IS NULL AND e.cleared_at IS NULL
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
      WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND cleared_at IS NULL AND escalated = 0
        AND raised_at < (NOW(3) - INTERVAL :mins MINUTE)`,
    { mins: olderThanMin },
  )
  return rows
}

// ---- Auto-clear (recovery) -------------------------------------------------
export async function openThresholdEvents(): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, node_id, param_key FROM alarm_events WHERE cleared_at IS NULL AND kind IN ('threshold','rate')",
  )
  return rows
}

export async function recentParamValues(nodeId: string, paramKey: string, mins: number): Promise<number[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT value FROM readings WHERE node_id = :n AND param_key = :p AND taken_at > (NOW(3) - INTERVAL :m MINUTE)',
    { n: nodeId, p: paramKey, m: mins },
  )
  return rows.map((r) => Number(r.value))
}

export async function clearEvent(id: string): Promise<void> {
  await pool.query('UPDATE alarm_events SET cleared_at = NOW(3) WHERE id = :id', { id })
}

// ---- Downlink --------------------------------------------------------------
export async function mqttPrefix(nodeId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT mqtt_prefix FROM nodes WHERE id = :id', { id: nodeId })
  return rows.length ? ((rows[0].mqtt_prefix as string) ?? null) : null
}

// ---- Robustness: dead-letter + retention -----------------------------------
export async function insertDeadLetter(source: string, error: string, payload: unknown): Promise<void> {
  await pool.query('INSERT INTO dead_letter (source, error, payload) VALUES (:s, :e, :p)', {
    s: source.slice(0, 120), e: error.slice(0, 500), p: payload == null ? null : JSON.stringify(payload),
  })
}

// ---- Report schedules ------------------------------------------------------
export async function listSchedules(orgId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM report_schedules WHERE org_id = :o ORDER BY name', { o: orgId })
  return rows
}
export async function upsertSchedule(s: { id?: string; orgId: string; name: string; scope?: string; scopeId?: string; sequence?: string; format?: string; recipients?: string; enabled?: boolean }): Promise<string> {
  const id = s.id || `rpt-${Date.now()}`
  await pool.query(
    `INSERT INTO report_schedules (id,org_id,name,scope,scope_id,sequence,format,recipients,enabled,next_run_at)
       VALUES (:id,:o,:n,:sc,:si,:sq,:f,:r,:e,NOW(3))
     ON DUPLICATE KEY UPDATE name=:n,scope=:sc,scope_id=:si,sequence=:sq,format=:f,recipients=:r,enabled=:e`,
    { id, o: s.orgId, n: s.name, sc: s.scope ?? 'device', si: s.scopeId ?? null, sq: s.sequence ?? 'daily', f: s.format ?? 'CSV', r: s.recipients ?? null, e: s.enabled === false ? 0 : 1 },
  )
  return id
}
export async function deleteSchedule(id: string): Promise<void> {
  await pool.query('DELETE FROM report_schedules WHERE id = :id', { id })
}
export async function dueSchedules(): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM report_schedules WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at <= NOW(3))')
  return rows
}
export async function nodeIdsForScope(orgId: string, scope: string, scopeId: string | null): Promise<string[]> {
  if (scope === 'device' && scopeId) return [scopeId]
  const sql = `SELECT id FROM nodes WHERE org_id = :o ${scope === 'department' && scopeId ? 'AND department_id = :d' : ''}`
  const [rows] = await pool.query<RowDataPacket[]>(sql, { o: orgId, d: scopeId })
  return rows.map((r) => r.id as string)
}
export async function summaryReadings(nodeIds: string[], days: number): Promise<RowDataPacket[]> {
  if (!nodeIds.length) return []
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT node_id, param_key, COUNT(*) n, AVG(value) a, MIN(value) mn, MAX(value) mx FROM readings WHERE node_id IN (?) AND taken_at > (NOW(3) - INTERVAL ? DAY) GROUP BY node_id, param_key ORDER BY node_id, param_key',
    [nodeIds, days],
  )
  return rows
}
export async function markScheduleRun(id: string, sequence: string): Promise<void> {
  const iv = sequence === 'weekly' ? '7 DAY' : sequence === 'monthly' ? '1 MONTH' : '1 DAY'
  await pool.query(`UPDATE report_schedules SET last_run_at=NOW(3), next_run_at=(NOW(3)+INTERVAL ${iv}) WHERE id=:id`, { id })
}

export async function rollupAndPurgeReadings(retentionDays: number): Promise<number> {
  await pool.query(
    `INSERT INTO readings_rollup (node_id, param_key, bucket, n, v_avg, v_min, v_max)
       SELECT node_id, param_key, DATE_FORMAT(taken_at,'%Y-%m-%d %H:00:00.000'), COUNT(*), AVG(value), MIN(value), MAX(value)
         FROM readings WHERE taken_at < (NOW(3) - INTERVAL :d DAY)
        GROUP BY node_id, param_key, DATE_FORMAT(taken_at,'%Y-%m-%d %H:00:00.000')
     ON DUPLICATE KEY UPDATE n=VALUES(n), v_avg=VALUES(v_avg), v_min=VALUES(v_min), v_max=VALUES(v_max)`,
    { d: retentionDays },
  )
  const [res] = await pool.query<ResultSetHeader>('DELETE FROM readings WHERE taken_at < (NOW(3) - INTERVAL :d DAY)', { d: retentionDays })
  return res.affectedRows
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
