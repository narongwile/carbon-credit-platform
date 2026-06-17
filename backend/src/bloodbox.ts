// ---------------------------------------------------------------------------
// BloodBOX domain service (ERD #4): transits, journey events, building floors,
// BLE beacons, box indoor locations. Mounted at /api/bloodbox.
// ---------------------------------------------------------------------------
import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { pool } from './db.js'

// ---- Repo ------------------------------------------------------------------
export async function transitsByOrg(orgId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM blood_box_transits WHERE org_id = :orgId ORDER BY current_eta_min ASC',
    { orgId },
  )
  return rows
}

export async function transitById(id: string): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM blood_box_transits WHERE id = :id', { id })
  return rows.length ? rows[0] : null
}

export async function journeyByTransit(transitId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM blood_box_journey_events WHERE transit_id = :t ORDER BY ts ASC',
    { t: transitId },
  )
  return rows
}

export async function insertJourneyEvent(transitId: string, e: {
  eventType: string; label?: string; signal: string; floorId?: string
  lat?: number; lng?: number; posX?: number; posY?: number; tempC?: number; batteryPct?: number
}): Promise<string> {
  const id = `je-${Date.now()}`
  await pool.query(
    `INSERT INTO blood_box_journey_events
       (id, transit_id, floor_id, event_type, label, signal, lat, lng, pos_x_m, pos_y_m, temp_c, battery_pct)
     VALUES (:id, :t, :floor, :et, :label, :sig, :lat, :lng, :px, :py, :temp, :bat)`,
    {
      id, t: transitId, floor: e.floorId ?? null, et: e.eventType, label: e.label ?? null, sig: e.signal,
      lat: e.lat ?? null, lng: e.lng ?? null, px: e.posX ?? null, py: e.posY ?? null,
      temp: e.tempC ?? null, bat: e.batteryPct ?? null,
    },
  )
  return id
}

export async function floorsByOrg(orgId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM building_floors WHERE org_id = :orgId ORDER BY floor_number DESC',
    { orgId },
  )
  return rows
}

export async function beaconsByOrg(orgId: string, floorId?: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ble_beacons WHERE org_id = :orgId ${floorId ? 'AND floor_id = :floorId' : ''} ORDER BY id`,
    { orgId, floorId },
  )
  return rows
}

export async function upsertBeacon(b: {
  id?: string; orgId: string; floorId: string; uuid: string; major?: number; minor?: number
  posX?: number; posY?: number; txPower?: number; battery?: number; status?: string
}): Promise<string> {
  const id = b.id || `bcn-${Date.now()}`
  await pool.query(
    `INSERT INTO ble_beacons
       (id, org_id, floor_id, uuid, major, minor, pos_x_m, pos_y_m, tx_power_dbm, battery_pct, status)
     VALUES (:id, :org, :floor, :uuid, :major, :minor, :px, :py, :tx, :bat, :status)
     ON DUPLICATE KEY UPDATE floor_id = :floor, pos_x_m = :px, pos_y_m = :py,
       tx_power_dbm = :tx, battery_pct = :bat, status = :status`,
    {
      id, org: b.orgId, floor: b.floorId, uuid: b.uuid, major: b.major ?? null, minor: b.minor ?? null,
      px: b.posX ?? null, py: b.posY ?? null, tx: b.txPower ?? null, bat: b.battery ?? null,
      status: b.status ?? 'active',
    },
  )
  return id
}

export async function deleteBeacon(id: string): Promise<void> {
  await pool.query('DELETE FROM ble_beacons WHERE id = :id', { id })
}

export async function boxLocation(boxId: string): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM blood_box_locations WHERE box_id = :b AND is_current = 1 ORDER BY moved_at DESC LIMIT 1',
    { b: boxId },
  )
  return rows.length ? rows[0] : null
}

export async function moveBox(boxId: string, loc: {
  orgId: string; floorId?: string; posX?: number; posY?: number; roomLabel?: string; movedBy?: string
}): Promise<void> {
  await pool.query('UPDATE blood_box_locations SET is_current = 0 WHERE box_id = :b AND is_current = 1', { b: boxId })
  await pool.query(
    `INSERT INTO blood_box_locations (org_id, box_id, floor_id, pos_x_m, pos_y_m, room_label, moved_by)
     VALUES (:org, :b, :floor, :px, :py, :room, :by)`,
    {
      org: loc.orgId, b: boxId, floor: loc.floorId ?? null, px: loc.posX ?? null, py: loc.posY ?? null,
      room: loc.roomLabel ?? null, by: loc.movedBy ?? null,
    },
  )
  await pool.query('UPDATE blood_boxes SET floor_id = :floor, pos_x_m = :px, pos_y_m = :py WHERE id = :b', {
    b: boxId, floor: loc.floorId ?? null, px: loc.posX ?? null, py: loc.posY ?? null,
  })
}

// ---- Router ----------------------------------------------------------------
export const bloodboxRouter = Router()

bloodboxRouter.get('/transits', async (req, res) => {
  res.json(await transitsByOrg((req.query.orgId as string) || ''))
})

bloodboxRouter.get('/transits/:id', async (req, res) => {
  const t = await transitById(req.params.id)
  if (!t) return res.status(404).json({ error: 'not found' })
  res.json(t)
})

bloodboxRouter.get('/transits/:id/journey', async (req, res) => {
  res.json(await journeyByTransit(req.params.id))
})

bloodboxRouter.post('/transits/:id/journey', async (req, res) => {
  const { eventType, signal } = req.body
  if (!eventType || !signal) return res.status(400).json({ error: 'eventType and signal required' })
  const id = await insertJourneyEvent(req.params.id, req.body)
  res.json({ ok: true, id })
})

bloodboxRouter.get('/floors', async (req, res) => {
  res.json(await floorsByOrg((req.query.orgId as string) || ''))
})

bloodboxRouter.get('/beacons', async (req, res) => {
  res.json(await beaconsByOrg((req.query.orgId as string) || '', req.query.floorId as string | undefined))
})

bloodboxRouter.post('/beacons', async (req, res) => {
  const { orgId, floorId, uuid } = req.body
  if (!orgId || !floorId || !uuid) return res.status(400).json({ error: 'orgId, floorId and uuid required' })
  const id = await upsertBeacon(req.body)
  res.json({ ok: true, id })
})

bloodboxRouter.delete('/beacons/:id', async (req, res) => {
  await deleteBeacon(req.params.id)
  res.json({ ok: true })
})

bloodboxRouter.get('/boxes/:id/location', async (req, res) => {
  res.json(await boxLocation(req.params.id))
})

bloodboxRouter.post('/boxes/:id/location', async (req, res) => {
  const { orgId } = req.body
  if (!orgId) return res.status(400).json({ error: 'orgId required' })
  await moveBox(req.params.id, req.body)
  res.json({ ok: true })
})
