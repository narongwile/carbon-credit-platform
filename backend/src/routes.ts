import { Router } from 'express'
import { ingest } from './ingest.js'
import {
  getRule, putRule, nodesByOrg, eventsByNode, ackEvent, recentReadings,
  fleetByOrg, latestReadings, mqttPrefix,
  listSchedules, upsertSchedule, deleteSchedule,
  getUser, getPrefs, putPrefs,
} from './repo.js'
import { ping, pool } from './db.js'
import { bloodboxRouter } from './bloodbox.js'
import { publishDownlink } from './mqtt.js'

export const router = Router()

// ---- BloodBOX domain (transits, journey, floors, beacons, locations) -------
router.use('/bloodbox', bloodboxRouter)

router.get('/health', async (_req, res) => {
  res.json({ ok: true, db: await ping(), ts: Date.now() })
})

// ---- Alarm rules -----------------------------------------------------------
router.get('/nodes/:id/rule', async (req, res) => {
  const rule = await getRule(req.params.id)
  if (!rule) return res.status(404).json({ error: 'no rule' })
  res.json(rule)
})

router.put('/nodes/:id/rule', async (req, res) => {
  const { orgId, rule, updatedBy } = req.body
  if (!orgId || !rule) return res.status(400).json({ error: 'orgId and rule required' })
  await putRule(req.params.id, orgId, rule, updatedBy)
  res.json({ ok: true })
})

// Admin "apply to all org nodes": set the same rule for every node of a domain.
router.put('/orgs/:orgId/rule', async (req, res) => {
  const { rule, updatedBy } = req.body
  if (!rule?.domain) return res.status(400).json({ error: 'rule with domain required' })
  const nodes = (await nodesByOrg(req.params.orgId)).filter((n) => n.domain === rule.domain)
  for (const n of nodes) await putRule(n.id, req.params.orgId, rule, updatedBy)
  res.json({ ok: true, applied: nodes.length })
})

// ---- Fleet (generic, all products) ----------------------------------------
router.get('/fleet', async (req, res) => {
  res.json(await fleetByOrg((req.query.orgId as string) || '', req.query.domain as string | undefined))
})

router.get('/fleet/:id/latest', async (req, res) => {
  res.json(await latestReadings(req.params.id))
})

// ---- Per-user config (configProfile); identity = x-user-id header ----------
router.get('/me/config', async (req, res) => {
  const uid = req.header('x-user-id')
  if (!uid) return res.status(401).json({ error: 'x-user-id header required' })
  res.json({ user: (await getUser(uid)) ?? { id: uid }, prefs: await getPrefs(uid) })
})
router.put('/me/config', async (req, res) => {
  const uid = req.header('x-user-id')
  if (!uid) return res.status(401).json({ error: 'x-user-id header required' })
  await putPrefs(uid, req.body?.prefs ?? req.body)
  res.json({ ok: true })
})

// ---- Scheduled reports -----------------------------------------------------
router.get('/reports/schedules', async (req, res) => {
  res.json(await listSchedules((req.query.orgId as string) || ''))
})
router.post('/reports/schedules', async (req, res) => {
  const { orgId, name } = req.body ?? {}
  if (!orgId || !name) return res.status(400).json({ error: 'orgId and name required' })
  res.json({ ok: true, id: await upsertSchedule(req.body) })
})
router.delete('/reports/schedules/:id', async (req, res) => {
  await deleteSchedule(req.params.id)
  res.json({ ok: true })
})

// ---- Downlink (backend → device): config / cmd / ota -----------------------
router.put('/nodes/:id/config', async (req, res) => {
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  let payload = req.body
  if (!payload || !Object.keys(payload).length) payload = (await getRule(req.params.id)) ?? {}
  const topic = `${prefix}/config`
  res.json({ ok: publishDownlink(topic, payload, { qos: 1, retain: true }), topic })
})

router.post('/nodes/:id/cmd', async (req, res) => {
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  const op = (req.body?.op as string) || 'reboot'
  const topic = `${prefix}/cmd/${op}`
  res.json({ ok: publishDownlink(topic, req.body ?? {}, { qos: 1 }), topic })
})

router.post('/nodes/:id/ota', async (req, res) => {
  const { to_version, artefact_uri } = req.body ?? {}
  if (!to_version || !artefact_uri) return res.status(400).json({ error: 'to_version and artefact_uri required' })
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  const topic = `${prefix}/ota/cmd`
  res.json({ ok: publishDownlink(topic, req.body, { qos: 1 }), topic })
})

// ---- Events ----------------------------------------------------------------
router.get('/nodes/:id/events', async (req, res) => {
  res.json(await eventsByNode(req.params.id, Number(req.query.limit || 50)))
})

router.post('/events/:id/ack', async (req, res) => {
  const { by, eventProblemId } = req.body
  await ackEvent(req.params.id, by || 'user', eventProblemId)
  res.json({ ok: true })
})

// ---- Telemetry -------------------------------------------------------------
router.get('/nodes/:id/readings', async (req, res) => {
  res.json(await recentReadings(req.params.id, Number(req.query.sinceMin || 360)))
})

// Node-RED / device telemetry ingest over HTTP (alternative to MQTT)
router.post('/nodes/:id/readings', async (req, res) => {
  const { values, ts } = req.body
  if (!values) return res.status(400).json({ error: 'values required' })
  const result = await ingest(req.params.id, values, ts)
  res.json(result)
})

// ---- Documents (department-scoped) ----------------------------------------
router.get('/nodes/:id/documents', async (req, res) => {
  const dept = req.query.departmentId as string | undefined
  const [rows] = await pool.query(
    'SELECT id, name, size, uploaded_by, created_at FROM documents WHERE node_id = :n AND department_id = :d ORDER BY created_at DESC',
    { n: req.params.id, d: dept ?? '' },
  )
  res.json(rows)
})

router.post('/nodes/:id/documents', async (req, res) => {
  const { departmentId, name, size, uploadedBy, dataBase64 } = req.body
  if (!departmentId || !name) return res.status(400).json({ error: 'departmentId and name required' })
  const id = `doc-${Date.now()}`
  await pool.query(
    'INSERT INTO documents (id, node_id, department_id, name, size, uploaded_by, data) VALUES (:id, :n, :d, :name, :size, :by, :data)',
    { id, n: req.params.id, d: departmentId, name, size: size ?? null, by: uploadedBy ?? null, data: dataBase64 ? Buffer.from(dataBase64, 'base64') : null },
  )
  res.json({ ok: true, id })
})
