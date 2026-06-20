import { Router } from 'express'
import { ingest } from './ingest.js'
import {
  getRule, putRule, nodesByOrg, eventsByNode, ackEvent, recentReadings,
  fleetByOrg, latestReadings, mqttPrefix,
  listSchedules, upsertSchedule, deleteSchedule,
  getUser, getPrefs, putPrefs,
  listOrgs, upsertOrg, deleteOrg, getEntitlements, setEntitlements,
  listEventProblems, upsertEventProblem, deleteEventProblem,
  listDepartments, upsertDepartment, deleteDepartment,
  listUsers, upsertUser, deleteUser, updateUserPassword, updateOrgLogo, getProductAccess, putProductAccess, provisionNode,
} from './repo.js'
import { ping, pool } from './db.js'
import { bloodboxRouter } from './bloodbox.js'
import { publishDownlink } from './mqtt.js'
import { userByEmail } from './repo.js'
import { signToken, checkPassword, hashPassword, requireAuth, requireRole, orgScope, requireNode, requireEvent, loginRateLimit, noteLoginFailure, noteLoginSuccess } from './auth.js'
import { effectiveAccess, canSeeNode } from './repo.js'

export const router = Router()

// ---- Public: health + login ------------------------------------------------
router.get('/health', async (_req, res) => {
  res.json({ ok: true, db: await ping(), ts: Date.now() })
})

router.post('/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {}
  const u = email ? await userByEmail(email) : null
  if (!u || !u.password_hash || !(await checkPassword(password || '', u.password_hash as string))) {
    noteLoginFailure(req)
    return res.status(401).json({ error: 'invalid credentials' })
  }
  noteLoginSuccess(req)
  const claims = { userId: u.id as string, orgId: (u.org_id as string) || '', role: (u.role as string) || 'viewer' }
  res.json({ token: signToken(claims), user: { id: claims.userId, orgId: claims.orgId, role: claims.role, name: u.name, email: u.email } })
})

router.post('/auth/register', async (req, res) => {
  const { name, email, password, orgName } = req.body ?? {}
  if (!name || !email || !password) return res.status(400).json({ error: 'missing fields' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password too short (min 8)' })
  if (await userByEmail(email)) return res.status(409).json({ error: 'email already registered' })
  // Self-service signup: create the org row first (so the user's FK resolves
  // and the org appears in listings), grant default access, then add the admin.
  const orgId = `org-${Date.now()}`
  await upsertOrg({ id: orgId, name: orgName || `${name}'s Organization` })
  await setEntitlements(orgId, ['refrigeration', 'bloodbox']) // default access
  const hash = await hashPassword(password)
  const userId = await upsertUser(orgId, { name, email, role: 'admin', passwordHash: hash })
  res.json({ ok: true, userId, orgId })
})

router.post('/auth/forgot', async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: 'missing email' })
  // In production, send email here. For now, pretend success.
  res.json({ ok: true, message: 'recovery email sent if account exists' })
})

// Everything below requires a valid token.
router.use(requireAuth)

router.put('/auth/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'new password too short (min 8)' })
  const u = await getUser(req.auth!.userId)
  if (!u || !u.password_hash || !(await checkPassword(currentPassword || '', u.password_hash as string))) {
    return res.status(401).json({ error: 'invalid current password' })
  }
  const hash = await hashPassword(newPassword)
  await updateUserPassword(req.auth!.userId, hash)
  res.json({ ok: true })
})

// ---- BloodBOX domain (transits, journey, floors, beacons, locations) -------
router.use('/bloodbox', bloodboxRouter)

// ---- Alarm rules (device-scoped: org + product/department access) ----------
router.get('/nodes/:id/rule', requireNode(), async (req, res) => {
  const rule = await getRule(req.params.id)
  if (!rule) return res.status(404).json({ error: 'no rule' })
  res.json(rule)
})

router.put('/nodes/:id/rule', requireNode(true), async (req, res) => {
  const { orgId, rule, updatedBy } = req.body
  if (!orgId || !rule) return res.status(400).json({ error: 'orgId and rule required' })
  await putRule(req.params.id, orgId, rule, updatedBy)
  res.json({ ok: true })
})

// Admin "apply to all org nodes": set the same rule for every node of a domain.
router.put('/orgs/:orgId/rule', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  const { rule, updatedBy } = req.body
  if (!rule?.domain) return res.status(400).json({ error: 'rule with domain required' })
  const nodes = (await nodesByOrg(req.params.orgId)).filter((n) => n.domain === rule.domain)
  for (const n of nodes) await putRule(n.id, req.params.orgId, rule, updatedBy)
  res.json({ ok: true, applied: nodes.length })
})

// ---- Fleet (filtered to what the caller may see) ---------------------------
router.get('/fleet', async (req, res) => {
  const access = req.auth ? await effectiveAccess(req.auth.userId) : null
  if (!access) return res.status(401).json({ error: 'authentication required' })
  const orgId = access.role === 'superadmin' ? ((req.query.orgId as string) || access.orgId) : access.orgId
  const rows = await fleetByOrg(orgId, req.query.domain as string | undefined)
  res.json(rows.filter((n) => canSeeNode(access, { org_id: n.org_id ?? orgId, domain: n.domain, department_id: n.department_id })))
})

router.get('/fleet/:id/latest', requireNode(), async (req, res) => {
  res.json(await latestReadings(req.params.id))
})

// ---- Tenancy / provisioning ------------------------------------------------
// superadmin: orgs + entitlements + node provisioning. admin (own org): depts,
// users, product-access. requireRole() with no args = superadmin-only.
router.get('/orgs', async (_req, res) => res.json(await listOrgs()))
router.post('/orgs', requireRole(), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  res.json({ ok: true, id: await upsertOrg(req.body) })
})
router.delete('/orgs/:id', requireRole(), async (req, res) => { await deleteOrg(req.params.id); res.json({ ok: true }) })
// Per-company branding logo. Org admins may set their OWN org's logo (org-scoped),
// so the static-export frontend doesn't need superadmin POST /orgs. logoUrl is a
// data URL or hosted URL; empty string clears it.
router.put('/orgs/:id/branding', requireRole('admin'), orgScope('id'), async (req, res) => {
  const logo = typeof req.body?.logoUrl === 'string' ? req.body.logoUrl : ''
  await updateOrgLogo(req.params.id, logo || null)
  res.json({ ok: true })
})
router.get('/orgs/:id/entitlements', orgScope('id'), async (req, res) => res.json(await getEntitlements(req.params.id)))
router.put('/orgs/:id/entitlements', requireRole(), async (req, res) => { await setEntitlements(req.params.id, req.body?.platforms ?? []); res.json({ ok: true }) })
router.get('/orgs/:orgId/departments', orgScope('orgId'), async (req, res) => res.json(await listDepartments(req.params.orgId)))
router.post('/orgs/:orgId/departments', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  res.json({ ok: true, id: await upsertDepartment(req.params.orgId, req.body) })
})
router.delete('/departments/:id', requireRole('admin'), async (req, res) => { await deleteDepartment(req.params.id); res.json({ ok: true }) })
router.get('/orgs/:orgId/users', orgScope('orgId'), async (req, res) => res.json(await listUsers(req.params.orgId)))
router.post('/orgs/:orgId/users', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  res.json({ ok: true, id: await upsertUser(req.params.orgId, req.body) })
})
router.delete('/users/:id', requireRole('admin'), async (req, res) => { await deleteUser(req.params.id); res.json({ ok: true }) })
router.get('/product-access', async (req, res) => res.json(await getProductAccess((req.query.scope as string) || 'department', (req.query.scopeId as string) || '')))
router.put('/product-access', requireRole('admin'), async (req, res) => {
  const { scope, scopeId, domain } = req.body ?? {}
  if (!scope || !scopeId || !domain) return res.status(400).json({ error: 'scope, scopeId, domain required' })
  await putProductAccess(req.body); res.json({ ok: true })
})
router.post('/nodes', requireRole(), async (req, res) => {
  const { id, orgId, domain, name } = req.body ?? {}
  if (!id || !orgId || !domain || !name) return res.status(400).json({ error: 'id, orgId, domain, name required' })
  await provisionNode(req.body); res.json({ ok: true, id })
})

// ---- Per-user config (configProfile); identity = x-user-id header ----------
router.get('/me/config', async (req, res) => {
  const uid = req.auth?.userId || req.header('x-user-id')
  if (!uid) return res.status(401).json({ error: 'authentication required' })
  res.json({ user: (await getUser(uid)) ?? { id: uid }, prefs: await getPrefs(uid) })
})
router.put('/me/config', async (req, res) => {
  const uid = req.auth?.userId || req.header('x-user-id')
  if (!uid) return res.status(401).json({ error: 'authentication required' })
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
router.put('/nodes/:id/config', requireRole('admin'), requireNode(true), async (req, res) => {
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  let payload = req.body
  if (!payload || !Object.keys(payload).length) payload = (await getRule(req.params.id)) ?? {}
  const topic = `${prefix}/config`
  res.json({ ok: publishDownlink(topic, payload, { qos: 1, retain: true }), topic })
})

router.post('/nodes/:id/cmd', requireRole('admin'), requireNode(true), async (req, res) => {
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  const op = (req.body?.op as string) || 'reboot'
  const topic = `${prefix}/cmd/${op}`
  res.json({ ok: publishDownlink(topic, req.body ?? {}, { qos: 1 }), topic })
})

router.post('/nodes/:id/ota', requireRole('admin'), requireNode(true), async (req, res) => {
  const { to_version, artefact_uri } = req.body ?? {}
  if (!to_version || !artefact_uri) return res.status(400).json({ error: 'to_version and artefact_uri required' })
  const prefix = await mqttPrefix(req.params.id)
  if (!prefix) return res.status(404).json({ error: 'node/mqtt_prefix not found' })
  const topic = `${prefix}/ota/cmd`
  res.json({ ok: publishDownlink(topic, req.body, { qos: 1 }), topic })
})

// ---- Events ----------------------------------------------------------------
router.get('/nodes/:id/events', requireNode(), async (req, res) => {
  res.json(await eventsByNode(req.params.id, Number(req.query.limit || 50)))
})

router.post('/events/:id/ack', requireEvent(false), async (req, res) => {
  const { by, eventProblemId } = req.body
  await ackEvent(req.params.id, by || req.auth?.userId || 'user', eventProblemId)
  res.json({ ok: true })
})

// ---- Event problem catalog (root causes; admin maintains, viewers read) ----
router.get('/event-problems', async (req, res) => {
  const orgId = req.auth?.role === 'superadmin' ? ((req.query.orgId as string) || req.auth.orgId) : (req.auth?.orgId || '')
  res.json(await listEventProblems(orgId, req.query.departmentId as string | undefined, req.query.domain as string | undefined))
})
router.post('/event-problems', requireRole('admin'), orgScope(), async (req, res) => {
  if (!req.body?.orgId || !req.body?.label) return res.status(400).json({ error: 'orgId and label required' })
  res.json({ ok: true, id: await upsertEventProblem(req.body) })
})
router.delete('/event-problems/:id', requireRole('admin'), async (req, res) => {
  await deleteEventProblem(req.params.id); res.json({ ok: true })
})

// ---- Floorplans -----------------------------------------------------------
router.get('/orgs/:id/floorplans', orgScope('id'), async (req, res) => {
  const data = await getPrefs(req.params.id + '_floorplans')
  res.json(data || {})
})

router.put('/orgs/:id/floorplans', requireRole('admin'), orgScope('id'), async (req, res) => {
  await putPrefs(req.params.id + '_floorplans', req.body)
  res.json({ ok: true })
})

// ---- AI & SQL -------------------------------------------------------------
router.post('/ai/query', async (req, res) => {
  const { query } = req.body ?? {}
  // Mock response for now, establishes the API contract for P2
  res.json({
    answer: "Based on the telemetry data, there are 2 critical anomalies in the BloodBOX units located in Floor 3. The refrigeration systems are showing elevated temperatures above 8°C. I recommend immediate maintenance on BBX-03 and BBX-04.",
    sources: ["bbx-telemetry", "fleet-events"]
  })
})

// ---- Reports Download -----------------------------------------------------
router.get('/reports/download', async (req, res) => {
  // Mock CSV download response
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="report.csv"')
  res.send("Date,Node,Value,Status\n2023-01-01,BBX-01,5.2,OK\n2023-01-02,BBX-01,5.5,OK")
})

// ---- Telemetry -------------------------------------------------------------
router.get('/nodes/:id/readings', requireNode(), async (req, res) => {
  res.json(await recentReadings(req.params.id, Number(req.query.sinceMin || 360)))
})

// Node-RED / device telemetry ingest over HTTP (alternative to MQTT)
router.post('/nodes/:id/readings', requireNode(), async (req, res) => {
  const { values, ts } = req.body
  if (!values) return res.status(400).json({ error: 'values required' })
  const result = await ingest(req.params.id, values, ts)
  res.json(result)
})

// ---- Documents (department-scoped) ----------------------------------------
router.get('/nodes/:id/documents', requireNode(), async (req, res) => {
  const dept = req.query.departmentId as string | undefined
  const [rows] = await pool.query(
    'SELECT id, name, size, uploaded_by, created_at FROM documents WHERE node_id = :n AND department_id = :d ORDER BY created_at DESC',
    { n: req.params.id, d: dept ?? '' },
  )
  res.json(rows)
})

router.post('/nodes/:id/documents', requireNode(true), async (req, res) => {
  const { departmentId, name, size, uploadedBy, dataBase64 } = req.body
  if (!departmentId || !name) return res.status(400).json({ error: 'departmentId and name required' })
  const id = `doc-${Date.now()}`
  await pool.query(
    'INSERT INTO documents (id, node_id, department_id, name, size, uploaded_by, data) VALUES (:id, :n, :d, :name, :size, :by, :data)',
    { id, n: req.params.id, d: departmentId, name, size: size ?? null, by: uploadedBy ?? null, data: dataBase64 ? Buffer.from(dataBase64, 'base64') : null },
  )
  res.json({ ok: true, id })
})
