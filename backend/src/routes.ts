import { Router } from 'express'
import crypto from 'crypto'
import { ingest } from './ingest.js'
import {
  getRule, putRule, nodesByOrg, eventsByNode, ackEvent, recentReadings,
  fleetByOrg, latestReadings, mqttPrefix,
  listSchedules, upsertSchedule, deleteSchedule,
  getUser, getPrefs, putPrefs,
  listOrgs, getOrg, upsertOrg, deleteOrg, getEntitlements, setEntitlements,
  listEventProblems, upsertEventProblem, deleteEventProblem,
  listDepartments, upsertDepartment, deleteDepartment,
  listUsers, upsertUser, deleteUser, updateUserPassword, updateOrgLogo, getProductAccess, putProductAccess, provisionNode,
  listPendingNodes, approveNode, rejectNode, upsertOrgDomainRule,
  listDirectory, upsertDirectoryEntries, clearDirectory, matchDirectory,
  createResetToken, getResetToken, markResetUsed,
  upsertFloorplanImage, getFloorplanImage, resourceOrg,
} from './repo.js'
import { ping, pool } from './db.js'
import { migrateOrg } from './migrate.js'
import { bloodboxRouter } from './bloodbox.js'
import { publishDownlink } from './mqtt.js'
import { userByEmail } from './repo.js'
import { signToken, checkPassword, hashPassword, requireAuth, requireRole, orgScope, requireNode, requireEvent, loginRateLimit, noteLoginFailure, noteLoginSuccess } from './auth.js'
import { effectiveAccess, canSeeNode } from './repo.js'

export const router = Router()

// 403 a non-superadmin whose org doesn't own the resource (404 if it's missing).
function denyCrossOrg(auth: { role?: string; orgId?: string } | undefined, resOrg: string | null): { code: number; error: string } | null {
  if (resOrg === null) return { code: 404, error: 'not found' }
  if (auth?.role !== 'superadmin' && resOrg !== auth?.orgId) return { code: 403, error: 'outside your organization' }
  return null
}

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
  const { name, email, password, phone, orgName, orgId: explicitOrgId } = req.body ?? {}
  if (!name || !email || !password) return res.status(400).json({ error: 'missing fields' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password too short (min 8)' })
  if (await userByEmail(email)) return res.status(409).json({ error: 'email already registered' })

  // Check org_directory for a match (email > phone > name)
  const match = await matchDirectory(email, phone || undefined, name)
  const hash = await hashPassword(password)

  if (match) {
    // Matched! Assign as viewer to the matched org + department
    const userId = await upsertUser(match.org_id as string, {
      name, email, phone, role: 'viewer',
      departmentId: (match.department_id as string) || undefined,
      passwordHash: hash,
    })
    return res.json({ ok: true, userId, orgId: match.org_id, role: 'viewer', matched: true, department: match.department_id || null })
  }

  // If explicit orgId was provided (from /register?org=org-1)
  if (explicitOrgId) {
    const org = await getOrg(explicitOrgId)
    if (org) {
      const userId = await upsertUser(explicitOrgId, { name, email, phone, role: 'viewer', passwordHash: hash })
      return res.json({ ok: true, userId, orgId: explicitOrgId, role: 'viewer', matched: false })
    }
  }

  // No match — self-service signup: create new org
  const orgId = `org-${Date.now()}`
  await upsertOrg({ id: orgId, name: orgName || `${name}'s Organization` })
  await setEntitlements(orgId, ['refrigeration', 'bloodbox'])
  const userId = await upsertUser(orgId, { name, email, phone, role: 'admin', passwordHash: hash })
  res.json({ ok: true, userId, orgId, role: 'admin', matched: false })
})

router.post('/auth/forgot', async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: 'missing email' })
  // Always respond success to prevent email enumeration
  const u = await userByEmail(email)
  if (u) {
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await createResetToken(u.id as string, token, expires)

    // Send email via nodemailer (if SMTP configured)
    try {
      const nodemailer = await import('nodemailer')
      const smtpHost = process.env.SMTP_HOST
      if (smtpHost) {
        const transport = nodemailer.default.createTransport({
          host: smtpHost,
          port: Number(process.env.SMTP_PORT || 587),
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        })
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`
        const resetUrl = `${baseUrl}/reset?token=${token}`
        await transport.sendMail({
          from: process.env.MAIL_FROM || 'noreply@oneops.local',
          to: email,
          subject: 'ONEOPS — Password Reset',
          text: `You requested a password reset.\n\nClick the link below to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p><p style="color:#888;font-size:12px;">This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
        })
        console.log(`[auth:forgot] reset email sent to ${email}`)
      } else {
        console.log(`[auth:forgot] SMTP not configured — token: ${token}`)
      }
    } catch (err) {
      console.error('[auth:forgot] email send failed:', (err as Error).message)
    }
  }
  res.json({ ok: true, message: 'recovery email sent if account exists' })
})

// Reset password with token (public, no auth required)
router.post('/auth/reset', async (req, res) => {
  const { token, password } = req.body ?? {}
  if (!token || !password) return res.status(400).json({ error: 'missing token or password' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password too short (min 8)' })
  const reset = await getResetToken(token)
  if (!reset) return res.status(400).json({ error: 'invalid or expired reset link' })
  const hash = await hashPassword(password)
  await updateUserPassword(reset.user_id as string, hash)
  await markResetUsed(token)
  res.json({ ok: true })
})

// Everything below requires a valid token.
router.use(requireAuth)

// Floor-plan image — org-scoped so a floor plan never leaks across organizations.
// authMiddleware accepts the JWT from a ?token= query param (an <img> tag can't
// set an Authorization header); orgScope enforces :id matches the caller's org.
router.get('/orgs/:id/floorplans/:floorId/image', orgScope('id'), async (req, res) => {
  const img = await getFloorplanImage(req.params.id, req.params.floorId)
  if (!img) return res.status(404).send('not found')
  res.setHeader('Content-Type', img.contentType)
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.send(img.data)
})

// Floor-plan image upload (admin) — stores the bytes, returns the served path.
router.post('/orgs/:id/floorplans/:floorId/image', requireRole('admin'), orgScope('id'), async (req, res) => {
  const { dataBase64, contentType } = req.body ?? {}
  if (!dataBase64) return res.status(400).json({ error: 'dataBase64 required' })
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64')
  const url = `/api/orgs/${req.params.id}/floorplans/${encodeURIComponent(req.params.floorId)}/image`
  await upsertFloorplanImage(req.params.id, req.params.floorId, buf, contentType || 'image/png', url)
  res.json({ ok: true, url: `${url}?v=${Date.now()}` })
})

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
  // Persist the org+domain default first (survives when the org has no nodes yet).
  await upsertOrgDomainRule(req.params.orgId, rule.domain, rule, updatedBy)
  const nodes = (await nodesByOrg(req.params.orgId)).filter((n) => n.domain === rule.domain)
  for (const n of nodes) await putRule(n.id, req.params.orgId, rule, updatedBy)
  res.json({ ok: true, applied: nodes.length, saved: true })
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
router.get('/orgs', async (req, res) => {
  const all = await listOrgs()
  res.json(req.auth?.role === 'superadmin' ? all : all.filter((o) => o.id === req.auth?.orgId))
})
router.post('/orgs', requireRole(), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  const id = await upsertOrg(req.body)
  // DB-per-tenant: create + migrate this org's dedicated database (iothub_<org>).
  // Best-effort — the org row is committed even if migration fails so ops can
  // re-run `node dist/migrate.js --org <id>`; the result is echoed for visibility.
  let provisioned: { orgId: string; db: string; applied: number } | { error: string }
  try { provisioned = await migrateOrg(id) }
  catch (e) { provisioned = { error: (e as Error).message } }
  res.json({ ok: true, id, provisioned })
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
router.delete('/departments/:id', requireRole('admin'), async (req, res) => {
  const bad = denyCrossOrg(req.auth, await resourceOrg('departments', req.params.id))
  if (bad) return res.status(bad.code).json({ error: bad.error })
  await deleteDepartment(req.params.id); res.json({ ok: true })
})
router.get('/orgs/:orgId/users', orgScope('orgId'), async (req, res) => res.json(await listUsers(req.params.orgId)))
router.post('/orgs/:orgId/users', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  res.json({ ok: true, id: await upsertUser(req.params.orgId, req.body) })
})
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  const bad = denyCrossOrg(req.auth, await resourceOrg('users', req.params.id))
  if (bad) return res.status(bad.code).json({ error: bad.error })
  await deleteUser(req.params.id); res.json({ ok: true })
})
router.get('/product-access', async (req, res) => {
  const scope = (req.query.scope as string) || 'department'
  const scopeId = (req.query.scopeId as string) || ''
  const bad = denyCrossOrg(req.auth, await resourceOrg(scope === 'user' ? 'users' : 'departments', scopeId))
  if (bad) return res.status(bad.code).json({ error: bad.error })
  res.json(await getProductAccess(scope, scopeId))
})
router.put('/product-access', requireRole('admin'), async (req, res) => {
  const { scope, scopeId, domain } = req.body ?? {}
  if (!scope || !scopeId || !domain) return res.status(400).json({ error: 'scope, scopeId, domain required' })
  const bad = denyCrossOrg(req.auth, await resourceOrg(scope === 'user' ? 'users' : 'departments', scopeId))
  if (bad) return res.status(bad.code).json({ error: bad.error })
  await putProductAccess(req.body); res.json({ ok: true })
})
router.post('/nodes', requireRole(), async (req, res) => {
  const { id, orgId, domain, name } = req.body ?? {}
  if (!id || !orgId || !domain || !name) return res.status(400).json({ error: 'id, orgId, domain, name required' })
  await provisionNode(req.body); res.json({ ok: true, id })
})

// ---- Zero-touch onboarding: approve/reject auto-registered PENDING devices ---
router.get('/nodes/pending', requireRole('admin'), async (req, res) => {
  // Superadmin without an explicit orgId sees all orgs (incl. orphans); a tenant
  // admin is always scoped to their own org regardless of the query param.
  const isSuper = req.auth!.role === 'superadmin'
  const orgId = isSuper ? (req.query.orgId as string | undefined) : req.auth!.orgId
  res.json(await listPendingNodes(orgId))
})
router.post('/nodes/:id/approve', requireRole('admin'), async (req, res) => {
  const r = await approveNode(req.params.id, req.auth!.orgId, req.auth!.role === 'superadmin', req.body ?? {})
  if (!r.ok) return res.status(r.status ?? 404).json({ error: r.error ?? 'approve failed' })
  res.json({ ok: true, id: req.params.id, orgId: r.orgId })
})
router.post('/nodes/:id/reject', requireRole('admin'), async (req, res) => {
  const ok = await rejectNode(req.params.id, req.auth!.orgId, req.auth!.role === 'superadmin')
  if (!ok) return res.status(404).json({ error: 'not found or outside your organization' })
  res.json({ ok: true })
})

// ---- Per-user config (configProfile); identity = x-user-id header ----------
router.get('/me/config', async (req, res) => {
  const uid = req.auth!.userId   // identity from the JWT only, never a client-supplied header
  res.json({ user: (await getUser(uid)) ?? { id: uid }, prefs: await getPrefs(uid) })
})
router.put('/me/config', async (req, res) => {
  await putPrefs(req.auth!.userId, req.body?.prefs ?? req.body)
  res.json({ ok: true })
})

// ---- Scheduled reports -----------------------------------------------------
router.get('/reports/schedules', async (req, res) => {
  const orgId = req.auth!.role === 'superadmin' ? ((req.query.orgId as string) || req.auth!.orgId) : req.auth!.orgId
  res.json(await listSchedules(orgId))
})
router.post('/reports/schedules', requireRole('admin'), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'name required' })
  const orgId = req.auth!.role === 'superadmin' ? (req.body.orgId || req.auth!.orgId) : req.auth!.orgId
  res.json({ ok: true, id: await upsertSchedule({ ...req.body, orgId }) })
})
router.delete('/reports/schedules/:id', async (req, res) => {
  const bad = denyCrossOrg(req.auth, await resourceOrg('report_schedules', req.params.id))
  if (bad) return res.status(bad.code).json({ error: bad.error })
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
  const bad = denyCrossOrg(req.auth, await resourceOrg('event_problems', req.params.id))
  if (bad) return res.status(bad.code).json({ error: bad.error })
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
  const { inserted } = await ingest(req.params.id, values, ts)
  res.json({ inserted })
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

// View-level: a viewer (e.g. a field technician) can attach a device's service report.
router.post('/nodes/:id/documents', requireNode(), async (req, res) => {
  const { departmentId, name, size, uploadedBy, contentType, dataBase64 } = req.body
  if (!departmentId || !name) return res.status(400).json({ error: 'departmentId and name required' })
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await pool.query(
    'INSERT INTO documents (id, node_id, department_id, name, size, uploaded_by, content_type, data) VALUES (:id, :n, :d, :name, :size, :by, :ct, :data)',
    { id, n: req.params.id, d: departmentId, name, size: size ?? null, by: uploadedBy ?? req.auth!.userId ?? null, ct: contentType ?? null, data: dataBase64 ? Buffer.from(dataBase64, 'base64') : null },
  )
  res.json({ ok: true, id })
})

// Download a document's bytes (view-level; the guard checks device access).
router.get('/nodes/:id/documents/:docId', requireNode(), async (req, res) => {
  const [rows] = await pool.query(
    'SELECT name, content_type, data FROM documents WHERE id = :d AND node_id = :n',
    { d: req.params.docId, n: req.params.id },
  )
  const doc = (rows as Array<{ name: string; content_type: string | null; data: Buffer | null }>)[0]
  if (!doc || !doc.data) return res.status(404).send('not found')
  const fn = String(doc.name || 'document').replace(/[^\w.\- ]/g, '_')
  res.setHeader('Content-Type', doc.content_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${fn}"`)
  res.send(doc.data)
})

// ---- Notifications ---------------------------------------------------------
router.get('/orgs/:orgId/channels', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  const { getOrgChannels } = await import('./repo')
  res.json(await getOrgChannels(req.params.orgId))
})

router.put('/orgs/:orgId/channels', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  const { putOrgChannels } = await import('./repo')
  await putOrgChannels(req.params.orgId, req.body.channels || [])
  res.json({ ok: true })
})

router.put('/orgs/:orgId/location', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  const { updateOrgLocation } = await import('./repo')
  const { lat, lng } = req.body
  await updateOrgLocation(req.params.orgId, lat, lng)
  res.json({ ok: true })
})

// ---- Employee Directory (CSV allowlist) ------------------------------------
router.get('/orgs/:orgId/directory', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  res.json(await listDirectory(req.params.orgId))
})

router.post('/orgs/:orgId/directory', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  const { rows, replace } = req.body ?? {}
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' })
  if (replace) await clearDirectory(req.params.orgId)
  const count = await upsertDirectoryEntries(req.params.orgId, rows)
  res.json({ ok: true, imported: count })
})

router.delete('/orgs/:orgId/directory', requireRole('admin'), orgScope('orgId'), async (req, res) => {
  await clearDirectory(req.params.orgId)
  res.json({ ok: true })
})
