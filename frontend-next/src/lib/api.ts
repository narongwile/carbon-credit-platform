// ---------------------------------------------------------------------------
// REST adapter for the ONEOPS backend.
// When NEXT_PUBLIC_API_URL is unset (e.g. the static GitHub Pages build), every
// call is a no-op and the app falls back to its local (zustand/localStorage)
// state — so the frontend works with OR without the backend.
// ---------------------------------------------------------------------------

import type { NodeAlarmRule } from '@/server/alarmEngine'
import { useAppStore } from './store'

/** device_presence as served alongside the latest readings. */
export interface DevicePresence {
  online: number
  last_seen: string | null
  last_reading_at?: string | null
  rssi?: number | null
  batt?: number | null
  fw?: string | null
  transport?: string | null
}

/** Payload of GET /api/fleet/:id/latest. */
export interface NodeLatest {
  nodeId: string
  values: Record<string, number>
  lastReadingAt: string | null
  /** null when the device has never reported (no presence row yet). */
  presence?: DevicePresence | null
}

/** Payload of GET /api/nodes/:id/report — see reportFunc in the Node-RED generator. */
export interface NodeReport {
  nodeId: string
  from: string
  to: string
  node: { id: string; name: string; domain: string; org_id: string; department_id: string | null; site_id: string | null; status: string; first_seen: string } | null
  presence?: { online: number; last_seen: string; rssi: number | null; batt: number | null; fw: string | null }
  /** One row per parameter per hour, oldest first. */
  series: { param_key: string; bucket: string; n: number; bad_n: number; v_avg: number; v_min: number; v_max: number }[]
  events: { id: string; param_key: string; param_label: string; severity: string; kind: string; value: number; threshold: number; unit: string; raised_at: string; acknowledged_at: string | null; acknowledged_by: string | null; event_problem_id: string | null }[]
  transport: { from_transport: string; to_transport: string; reason: string | null; rssi: number | null; ts: string }[]
  offlineSync?: { records_count: number; oldest_ts: string | null; newest_ts: string | null; sync_at: string }[]
}

// NEXT_PUBLIC_API_URL="relative" = same-origin build (nginx reverse-proxies /api
// and /ws to Node-RED), so BASE is empty for relative fetches — but the backend
// still exists, so apiEnabled keys off RAW_URL, not BASE (else relative mode would
// wrongly look like "no backend" → demo).
const RAW_URL = process.env.NEXT_PUBLIC_API_URL || ''
const BASE = RAW_URL === 'relative' ? '' : RAW_URL
// apiEnabled = a backend was configured at BUILD time. Live/demo is a RUNTIME
// switch on top of that: isLive() gates every request, so flipping the sidebar
// Demo/Live toggle makes calls hit the backend (live) or return null (demo → the
// pages fall back to their local mock/seed state). A build with no backend is
// always demo. Prefer useIsLive() inside components so they re-render on toggle.
export const apiEnabled = !!RAW_URL
export function isLive(): boolean {
  return apiEnabled && useAppStore.getState().isLiveMode
}
export function useIsLive(): boolean {
  return useAppStore((s) => s.isLiveMode) && apiEnabled
}
// Resolve a server-relative path (e.g. a floor-plan image URL) to an absolute one.
export const apiUrl = (path: string) => (BASE && path.startsWith('/') ? `${BASE}${path}` : path)
const TOKEN_KEY = 'oneops_token'

// JWT is kept in localStorage and attached as Bearer on every call.
export function setToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
export function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)
}

// Resolve a protected image path (e.g. a floor-plan image) and attach the JWT as a
// ?token= query param, since an <img> tag cannot send an Authorization header. The
// backend guard accepts the token this way and still enforces org-scope.
export const apiImageUrl = (path: string) => {
  const u = apiUrl(path)
  const tok = getToken()
  return tok ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok)}` : u
}

const apiBase = typeof window !== 'undefined' ? window.location.origin : ''

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!isLive()) return null   // demo mode (or no backend) → caller falls back to mock
  try {
    const tok = getToken()
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(init?.headers as Record<string, string>) } })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export interface AuthUser { id: string; orgId: string; role: string; name?: string; email?: string }

export const api = {
  // Auth — stores the JWT on success so subsequent calls are authenticated.
  login: async (email: string, password: string): Promise<{ token: string; user: AuthUser } | null> => {
    const r = await req<{ token: string; user: AuthUser }>(`/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
    if (r?.token) setToken(r.token)
    return r
  },
  register: async (b: any) => req(`/api/auth/register`, { method: 'POST', body: JSON.stringify(b) }),
  forgotPassword: async (email: string) => req(`/api/auth/forgot`, { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: async (token: string, password: string) => req(`/api/auth/reset`, { method: 'POST', body: JSON.stringify({ token, password }) }),
  updatePassword: async (b: any) => req(`/api/auth/password`, { method: 'PUT', body: JSON.stringify(b) }),
  logout: () => setToken(null),

  getRule: (nodeId: string) => req<NodeAlarmRule>(`/api/nodes/${nodeId}/rule`),
  putRule: (nodeId: string, body: { orgId: string; rule: NodeAlarmRule; updatedBy?: string }) =>
    req(`/api/nodes/${nodeId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  putOrgRule: (orgId: string, body: { rule: NodeAlarmRule; updatedBy?: string }) =>
    req<{ applied: number }>(`/api/orgs/${orgId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  orgChannels: (orgId: string) => req<any[]>(`/api/orgs/${orgId}/channels`),
  putOrgChannels: (orgId: string, channels: any[]) => req(`/api/orgs/${orgId}/channels`, { method: 'PUT', body: JSON.stringify({ channels }) }),
  events: (nodeId: string) => req<unknown[]>(`/api/nodes/${nodeId}/events`),
  // Link switches + offline-backlog flushes for a device (transport_events
  // merged with offline_sync_log), newest first.
  transportEvents: (nodeId: string) =>
    req<{ id: string; ts: string; type: string; desc: string; isOfflineSync: boolean }[]>(
      `/api/nodes/${nodeId}/transport`),
  ackEvent: (eventId: string, body: { by: string; eventProblemId?: string }) =>
    req(`/api/events/${eventId}/ack`, { method: 'POST', body: JSON.stringify(body) }),
  // Stored reading history for one device (canonical param keys, oldest first).
  // Feeds the trend charts and sparklines with real samples instead of the
  // synthetic series the demo store generates.
  // bucketSec > 0 asks the backend to average into fixed-width buckets. Always
  // pass it for charts: a raw multi-hour fetch is tens of MB for a line a few
  // hundred pixels wide. Omit it only when the individual samples matter.
  readings: (nodeId: string, sinceMin = 720, bucketSec = 0) =>
    req<{ param_key: string; value: number; taken_at: string }[]>(
      `/api/nodes/${nodeId}/readings?sinceMin=${sinceMin}${bucketSec > 0 ? `&bucketSec=${Math.round(bucketSec)}` : ''}`),
  // Explicit window (UTC 'YYYY-MM-DD HH:MM:SS'), optionally one parameter only.
  // "last N minutes" cannot express a period that ENDS in the past, which is
  // exactly what inspecting a past excursion needs. Bucketed rows also carry
  // v_min/v_max so a spike is not averaged away on a wide window.
  readingsWindow: (nodeId: string, from: string, to: string, bucketSec = 0, paramKey?: string) =>
    req<{ param_key: string; value: number; taken_at: string; v_min?: number; v_max?: number; n?: number }[]>(
      `/api/nodes/${nodeId}/readings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      + (bucketSec > 0 ? `&bucketSec=${Math.round(bucketSec)}` : '')
      + (paramKey ? `&paramKey=${encodeURIComponent(paramKey)}` : '')),
  // Per-device report over a date range: hourly min/avg/max per parameter
  // (raw readings for the retention window, readings_rollup beyond it), plus the
  // alarms and connectivity events raised in that window. from/to are UTC.
  nodeReport: (nodeId: string, from: string, to: string) =>
    req<NodeReport>(`/api/nodes/${nodeId}/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  ingest: (nodeId: string, values: Record<string, number>, ts?: number) =>
    req(`/api/nodes/${nodeId}/readings`, { method: 'POST', body: JSON.stringify({ values, ts }) }),

  // Generic fleet (transformer / carbonNode / bloodBox) — live overview data.
  // Returns null when the API is unset, so callers fall back to fleetData mock.
  fleet: (orgId: string, domain?: string) =>
    req<FleetNode[]>(`/api/fleet?orgId=${encodeURIComponent(orgId)}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`),
  latest: (nodeId: string) =>
    req<NodeLatest>(`/api/fleet/${nodeId}/latest`),

  // Downlink (backend → device). config publishes retained; body empty = sync
  // the saved alarm rule down to the device.
  pushConfig: (nodeId: string, body?: Record<string, unknown>) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/config`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  sendCmd: (nodeId: string, op: string, args?: Record<string, unknown>) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/cmd`, { method: 'POST', body: JSON.stringify({ op, ...args }) }),
  sendOta: (nodeId: string, body: { to_version: string; artefact_uri: string; sha256?: string }) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/ota`, { method: 'POST', body: JSON.stringify(body) }),
  // Per-device maintenance documents (service reports). View-level: a viewer can
  // upload and download a device's docs, scoped to their department.
  getNodeDocuments: (id: string, departmentId: string) =>
    req<{ id: string; name: string; size: string | null; uploaded_by: string | null; created_at: string }[]>(
      `/api/nodes/${id}/documents?departmentId=${encodeURIComponent(departmentId)}`),
  uploadNodeDocument: (id: string, doc: { departmentId: string; name: string; size?: string; uploadedBy?: string; contentType?: string; dataBase64: string }) =>
    req<{ ok: boolean; id: string }>(`/api/nodes/${id}/documents`, { method: 'POST', body: JSON.stringify(doc) }),
  // Fetch the document bytes with auth (an <a download> can't send a Bearer header)
  // and save via a temporary object URL.
  downloadNodeDocument: async (id: string, docId: string, filename: string) => {
    if (!isLive()) return
    const token = getToken()
    const r = await fetch(`${BASE}/api/nodes/${id}/documents/${encodeURIComponent(docId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!r.ok) return
    const blob = await r.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  },


  // Org Rule and Floorplans
  updateOrgRule: (orgId: string, rule: any, updatedBy: string = 'system') => req(`/api/orgs/${orgId}/rule`, { method: 'PUT', body: JSON.stringify({ rule, updatedBy }) }),
  // Sites — a customer's physical places. Floor plans are reached through one,
  // and a site's own pin is the coarse fallback for devices with no GPS.
  sites: (orgId: string) =>
    req<{ sites: { id: string; name: string; address: string | null; lat: number | null; lng: number | null }[]
          floors: { floor_id: string; site_id: string | null; nw_lat: number | null; nw_lng: number | null; se_lat: number | null; se_lng: number | null }[] }>(
      `/api/orgs/${orgId}/sites`),
  saveSite: (orgId: string, body: { id?: string; name: string; address?: string; lat?: number | null; lng?: number | null }) =>
    req<{ ok: boolean; id: string }>(`/api/orgs/${orgId}/sites`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSite: (id: string) => req<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),
  /** Real-world corners of a floor-plan image — what makes a pin a coordinate. */
  setFloorGeo: (orgId: string, floorId: string, body: { siteId?: string | null; nwLat?: number | null; nwLng?: number | null; seLat?: number | null; seLng?: number | null }) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/floorplans/${floorId}/geo`, { method: 'PUT', body: JSON.stringify(body) }),
  /** Persist a device's coordinate (and site) so the GPS map matches the layout. */
  setNodeLocation: (id: string, body: { lat: number | null; lng: number | null; siteId?: string | null }) =>
    req<{ ok: boolean; id: string; lat: number | null; lng: number | null }>(`/api/nodes/${id}/location`, { method: 'PUT', body: JSON.stringify(body) }),
  getFloorplans: (orgId: string) => req(`/api/orgs/${orgId}/floorplans`),
  updateFloorplans: (orgId: string, data: any) => req(`/api/orgs/${orgId}/floorplans`, { method: 'PUT', body: JSON.stringify(data) }),
  // Upload a floor-plan layout image (base64) → stored in the floorplans table;
  // returns the served path to use as the <img> src (persistent, unlike a blob URL).
  uploadFloorplanImage: (orgId: string, floorId: string, dataBase64: string, contentType: string) =>
    req<{ ok: boolean; url: string }>(`/api/orgs/${orgId}/floorplans/${encodeURIComponent(floorId)}/image`, { method: 'POST', body: JSON.stringify({ dataBase64, contentType }) }),

  // AI & Reports
  aiQuery: (query: string) => req(`/api/ai/query`, { method: 'POST', body: JSON.stringify({ query }) }),
  // Real on-demand report: a readings summary CSV for the caller's org, scoped by
  // days/scope/domain. Returns false when nothing could be downloaded.
  downloadReport: async (opts?: { days?: number; scope?: string; scopeId?: string; domain?: string; orgId?: string }): Promise<boolean> => {
    if (!isLive()) return false
    const token = getToken()
    const qs = new URLSearchParams()
    if (opts?.days) qs.set('days', String(opts.days))
    if (opts?.scope) qs.set('scope', opts.scope)
    if (opts?.scopeId) qs.set('scopeId', opts.scopeId)
    if (opts?.domain) qs.set('domain', opts.domain)
    if (opts?.orgId) qs.set('orgId', opts.orgId)
    const r = await fetch(`${BASE}/api/reports/download?${qs.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!r.ok) return false
    const blob = await r.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'oneops-report.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
    return true
  },

  // Fleet OTA Management
  otaReleases: () => req<{id:string; version:string; domain:string; artefact_uri:string; released_at:string; release_notes:string}[]>(`/api/ota/releases`),
  saveOtaRelease: (body: { version: string; domain: string; artefact_uri: string; release_notes?: string }) =>
    req<{ id: string }>(`/api/ota/releases`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOtaRelease: (id: string) => req(`/api/ota/releases/${id}`, { method: 'DELETE' }),
  otaDeployments: () => req<{node_id:string; release_id:string; status:string; updated_at:string}[]>(`/api/ota/deployments`),
  deployFleetOta: (body: { release_id: string; domain: string; org_id?: string }) =>
    req<{ applied: number }>(`/api/ota/deploy-fleet`, { method: 'POST', body: JSON.stringify(body) }),

  // Scheduled reports (cron-generated CSV emailed to recipients)
  listSchedules: (orgId: string) => req<ReportSchedule[]>(`/api/reports/schedules?orgId=${encodeURIComponent(orgId)}`),
  saveSchedule: (body: Partial<ReportSchedule> & { orgId: string; name: string }) =>
    req<{ id: string }>(`/api/reports/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSchedule: (id: string) => req(`/api/reports/schedules/${id}`, { method: 'DELETE' }),

  // Per-user config (configProfile); identity passed as the x-user-id header.
  getMyConfig: (userId: string) =>
    req<{ user: Record<string, unknown>; prefs: Record<string, unknown> }>(`/api/me/config`, { headers: { 'x-user-id': userId } }),
  putMyConfig: (userId: string, prefs: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/api/me/config`, { method: 'PUT', headers: { 'x-user-id': userId }, body: JSON.stringify({ prefs }) }),

  // ---- Platform settings (superadmin): DB-backed SMTP / sender config.
  // The password is never returned (passSet flag only) and is stored encrypted.
  platformSettings: () =>
    req<{
      smtpHost: string; smtpPort: string; smtpUser: string; mailFrom: string; frontendUrl: string; passSet: boolean
      telegramChatId: string; telegramSet: boolean; lineSet: boolean; googleChatSet: boolean
    }>(`/api/platform/settings`),
  savePlatformSettings: (body: {
    smtpHost?: string; smtpPort?: string; smtpUser?: string; smtpPass?: string; clearPass?: boolean; mailFrom?: string; frontendUrl?: string
    telegramChatId?: string; telegramToken?: string; clearTelegram?: boolean; lineToken?: string; clearLine?: boolean; googleChatWebhook?: string; clearGoogleChat?: boolean
  }) =>
    req<{ ok: boolean }>(`/api/platform/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  // channel: 'email' | 'telegram' | 'line' | 'googlechat'. `to` = email/chat id (optional for line/googlechat).
  testPlatformChannel: (channel: string, to?: string) =>
    req<{ ok: boolean; from?: string }>(`/api/platform/settings/test`, { method: 'POST', body: JSON.stringify({ channel, to }) }),

  // ---- Tenancy / provisioning (superadmin: orgs/entitlements/nodes; admin: depts/users/access)
  orgs: () => req<{ id: string; name: string; status?: string; logo_url?: string | null; lat?: number; lng?: number }[]>(`/api/orgs`),
  // provisioned: the tenant database this org needs under TENANT_DB_MODE.
  // admin.setPasswordUrl: returned only when SMTP is unconfigured, because the
  // admin row carries no password and that link is then the only way to sign in.
  saveOrg: (body: { id?: string; name: string; status?: string; logoUrl?: string; adminEmail?: string; adminName?: string }) =>
    req<{
      id: string
      provisioned?: { ok?: boolean; db?: string; applied?: number; error?: string } | null
      admin?: { email?: string; emailed?: boolean; setPasswordUrl?: string; error?: string } | null
    }>(`/api/orgs`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOrg: (id: string) => req(`/api/orgs/${id}`, { method: 'DELETE' }),
  // Per-company branding: org admins set their own org's logo (data URL or
  // hosted URL), display name (shown beside the sidebar logo instead of
  // "ONEOPS") and factory pin. Partial — only the fields passed are written.
  updateOrgBranding: (orgId: string, patch: { logoUrl?: string; name?: string; lat?: number | null; lng?: number | null }) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/branding`, { method: 'PUT', body: JSON.stringify(patch) }),
  updateOrgLocation: (orgId: string, lat: number, lng: number) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/location`, { method: 'PUT', body: JSON.stringify({ lat, lng }) }),
  entitlements: (orgId: string) => req<string[]>(`/api/orgs/${orgId}/entitlements`),
  setEntitlements: (orgId: string, platforms: string[]) =>
    req(`/api/orgs/${orgId}/entitlements`, { method: 'PUT', body: JSON.stringify({ platforms }) }),
  departments: (orgId: string) => req<unknown[]>(`/api/orgs/${orgId}/departments`),
  saveDepartment: (orgId: string, body: { id?: string; name: string }) =>
    req<{ id: string }>(`/api/orgs/${orgId}/departments`, { method: 'POST', body: JSON.stringify(body) }),
  deleteDepartment: (id: string) => req(`/api/departments/${id}`, { method: 'DELETE' }),
  users: (orgId: string) => req<unknown[]>(`/api/orgs/${orgId}/users`),
  saveUser: (orgId: string, body: { id?: string; email?: string; name: string; role?: string; departmentId?: string }) =>
    req<{ id: string }>(`/api/orgs/${orgId}/users`, { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (id: string) => req(`/api/users/${id}`, { method: 'DELETE' }),
  productAccess: (scope: 'department' | 'user', scopeId: string) =>
    req<{ domain: string; level: string }[]>(`/api/product-access?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`),
  setProductAccess: (body: { scope: 'department' | 'user'; scopeId: string; domain: string; level: string }) =>
    req(`/api/product-access`, { method: 'PUT', body: JSON.stringify(body) }),
  provisionNode: (body: { id: string; orgId: string; siteId?: string; departmentId?: string; domain: string; name: string; mqttPrefix?: string; lat?: number; lng?: number }) =>
    req<{ id: string }>(`/api/nodes`, { method: 'POST', body: JSON.stringify(body) }),

  // ---- Zero-touch onboarding: devices auto-registered as 'pending' on first
  // telemetry; admin approves (assigns name/domain/department) or rejects.
  // orgId omitted → superadmin gets EVERY org's pending devices (incl. orphans in
  // the '__unassigned__' pool). A tenant admin is always scoped to their own org
  // by the backend regardless of the param.
  pendingNodes: (orgId?: string) =>
    req<{ id: string; org_id: string; org_name: string | null; domain: string; name: string; mqtt_prefix: string | null; first_seen: string; last_seen: string | null; online: 0 | 1 | null; last_sample: Record<string, number> | null }[]>(
      `/api/nodes/pending${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`),
  // orgId reassigns the device to a target org (superadmin only; required to claim
  // an '__unassigned__' orphan). A device belongs to exactly one org.
  // mergeInto: approve this device as a SECOND FEED of an existing one — a
  // transformer whose power meter and box sensor publish under different node
  // ids is one asset, and the worker then stores both topics' readings there.
  approveNode: (id: string, body: { name?: string; domain?: string; departmentId?: string; orgId?: string; lat?: number; lng?: number; mergeInto?: string }) =>
    req<{ ok: boolean; id: string; orgId: string }>(`/api/nodes/${id}/approve`, { method: 'POST', body: JSON.stringify(body) }),
  rejectNode: (id: string) => req<{ ok: boolean }>(`/api/nodes/${id}/reject`, { method: 'POST' }),
  /** Pair (mergeInto: id) or unpair (mergeInto: null) an already-approved feed. */
  setNodeMerge: (id: string, mergeInto: string | null) =>
    req<{ ok: boolean; id: string; mergeInto: string | null }>(`/api/nodes/${id}/merge`, { method: 'PUT', body: JSON.stringify({ mergeInto }) }),

  // Event problem catalog (root causes) — admin maintains, viewers read for ack.
  eventProblems: (orgId: string, departmentId?: string, domain?: string) =>
    req<{ id: string; label: string; department_id: string | null; domain: string | null }[]>(
      `/api/event-problems?orgId=${encodeURIComponent(orgId)}${departmentId ? `&departmentId=${encodeURIComponent(departmentId)}` : ''}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`),
  saveEventProblem: (body: { id?: string; orgId: string; departmentId?: string; domain?: string; label: string }) =>
    req<{ id: string }>(`/api/event-problems`, { method: 'POST', body: JSON.stringify(body) }),
  deleteEventProblem: (id: string) => req(`/api/event-problems/${id}`, { method: 'DELETE' }),

  // ---- Employee directory (CSV allowlist) ----------------------------------
  getDirectory: (orgId: string) => req<any[]>(`/api/orgs/${orgId}/directory`),
  uploadDirectory: (orgId: string, rows: any[], replace = true) =>
    req<{ ok: boolean; imported: number }>(`/api/orgs/${orgId}/directory`, { method: 'POST', body: JSON.stringify({ rows, replace }) }),
  clearDirectory: (orgId: string) => req(`/api/orgs/${orgId}/directory`, { method: 'DELETE' }),
}

export interface FleetNode {
  id: string
  name: string
  domain: 'transformer' | 'carbonNode' | 'bloodBox'
  site_id: string | null
  department_id: string | null
  lat: number | null
  lng: number | null
  online: 0 | 1 | null
  last_seen: string | null
  rssi: number | null
  fw: string | null
  alarm: 'WARNING' | 'CRITICAL' | null
}

export interface ReportSchedule {
  id: string
  org_id: string
  name: string
  scope: 'device' | 'department' | 'org'
  scope_id: string | null
  sequence: 'daily' | 'weekly' | 'monthly'
  format: 'PDF' | 'XLSX' | 'CSV'
  channel: 'email' | 'telegram'
  recipients: string | null
  enabled: 0 | 1
  last_run_at: string | null
  next_run_at: string | null
}

export default api
