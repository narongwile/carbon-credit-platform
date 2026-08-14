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

/**
 * What a device photo is FOR. A transformer's photos are not alternative shots
 * of the same thing — each answers a different question, and the answer is
 * wanted at a different moment, which is why the gallery groups by this rather
 * than showing one undifferentiated pile.
 */
// Since migrate-v40 an org can add its own kinds, so this is no longer a
// closed set. The `& {}` keeps editor autocomplete for the built-ins while
// still accepting a custom key — modelling it as a closed union would now be
// a lie that forces a cast at every call site handling real data.
export type NodePhotoKind =
  | 'overview' | 'nameplate' | 'tapchanger' | 'thermal' | 'condition' | 'other'
  | (string & {})

export const PHOTO_KINDS: { key: NodePhotoKind; label: string; hint: string }[] = [
  { key: 'overview',   label: 'Overview',    hint: 'The whole unit — what you are walking up to' },
  { key: 'nameplate',  label: 'Nameplate',   hint: 'The rating plate, close enough to read' },
  { key: 'tapchanger', label: 'Tap changer', hint: 'Position indicator and counter' },
  { key: 'thermal',    label: 'Thermal',     hint: 'IR scan — compare against the visible-light shot' },
  { key: 'condition',  label: 'Condition',   hint: 'As-found / after-repair, a record over time' },
  { key: 'other',      label: 'Other',       hint: 'Anything else worth keeping' },
]

/**
 * A marker drawn on a photo. Coordinates are normalised 0..1 against the image,
 * so an arrow pointing at a hotspot stays on that hotspot at thumbnail size, in
 * the lightbox and in the PDF.
 */
export interface PhotoAnnotation {
  /** 'arrow' has a tail (x,y) and a head (x2,y2); 'box' is a rectangle; 'dot' marks a point. */
  type: 'arrow' | 'box' | 'dot'
  x: number
  y: number
  x2?: number
  y2?: number
  label?: string
  color?: string
}

/** One row of GET /api/nodes/:id/photos — metadata only, never the bytes. */
export interface NodePhoto {
  id: string
  kind: NodePhotoKind
  position: number
  contentType?: string | null
  width?: number | null
  height?: number | null
  bytes?: number | null
  caption?: string | null
  /** EXIF DateTimeOriginal — when the shutter fired, not when it was uploaded. */
  takenAt?: string | null
  lat?: number | null
  lng?: number | null
  annotations: PhotoAnnotation[]
  /** false for photos carried over from node_images; the read path falls back to the full image. */
  hasThumb: boolean
  updatedBy?: string | null
  updatedAt: string
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
  /** Maintenance documents uploaded within [from, to] — the report's own window, not the device's whole history. */
  documents?: { name: string; kind: DocKind; size: string | null; uploaded_by: string | null; created_at: string; doc_date?: string | null }[]
}

/**
 * What a maintenance document is (migrate-v38) — the same fixed-vocabulary
 * idea as NodePhotoKind, so "service report" and "certificate" sort apart
 * instead of one undifferentiated pile distinguishable only by filename.
 */
export type DocKind =
  | 'service_report' | 'certificate' | 'test_result' | 'invoice' | 'manual' | 'other'
  | (string & {})

/** One database's migration state — see migrationsGetFunc. */
export interface MigrationDbState {
  orgId: string
  name: string
  db: string
  /** org-1/2/3 share the control database; they have no tenant DB of their own. */
  onControlDb: boolean
  applied: number
  pending: string[]
  error: string | null
}
export interface MigrationStatus {
  tenantMode: boolean
  expected: number
  newest: string | null
  control: { db: string; applied: number; pending: string[] }
  orgs: MigrationDbState[]
  /** Tenant databases behind the code — what the header badge counts. */
  orgsBehind: number
  /** Control database files not yet applied. Fixed by a deploy, not by the button. */
  controlBehind: number
  /** false when MIGRATE_URL is unset — there is no migrate service to call. */
  canRun: boolean
}
export interface MigrationRunResult {
  ok: boolean
  httpStatus: number
  migrated: { orgId: string; db: string; applied: number }[]
  failed: { orgId: string; error: string }[]
  skipped: string[]
  error: string | null
}

/** Real platform counters for the superadmin header. */
export interface PlatformStats {
  orgs: number
  devices: number
  online: number
  alarms: number
  critical: number
  /** Organizations whose database could not be read — why status can say DEGRADED. */
  degraded: string[]
  status: 'OPERATIONAL' | 'ALARMS' | 'DEGRADED'
}

/** Which picker a catalog entry belongs to. */
export type KindScope = 'photo' | 'document'

/** One entry of the merged (built-in + org-customised) kind list. */
export interface CatalogKind {
  key: string
  label: string
  hint?: string
  position: number
  /** 0 = hidden: not offered for NEW uploads. Never affects what is already stored. */
  active: 0 | 1
  /** Ships in code — relabelable and hideable, never deletable. */
  builtin: boolean
  /** A built-in other features join on by key (overview/thermal/condition). Hiding it degrades those. */
  protected: boolean
}

export const DOC_KINDS: { key: DocKind; label: string }[] = [
  { key: 'service_report', label: 'Service report' },
  { key: 'certificate', label: 'Certificate' },
  { key: 'test_result', label: 'Test result' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'manual', label: 'Manual' },
  { key: 'other', label: 'Other' },
]

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

/** Which scope answered a display-params lookup; 'mixed' = a multi-department union. */
export type DisplayParamScope = 'none' | 'org' | 'org+dept' | 'node' | 'node+dept' | 'mixed'

/**
 * How a shown parameter renders (migrate-v37). 'card' is the full sensor
 * card — icon, number, sparkline, status pill; 'list' is a dense row, same
 * shape the old fixed "Other parameters" block used. Every key defaults to
 * 'card' unless the admin demotes it, so a selection made before this existed
 * still renders exactly as it always did.
 */
export type ParamLayout = 'card' | 'list'

export interface AuthUser { id: string; orgId: string; role: string; name?: string; email?: string }

export const api = {
  // Auth — stores the JWT on success so subsequent calls are authenticated.
  /**
   * A dedicated fetch, not req(): req() discards the response body on any
   * non-2xx, so wrong password (401), too many attempts (429) and a suspended
   * org (403) all collapsed into the exact same generic "Invalid credentials"
   * on screen — indistinguishable from each other AND from a genuine server
   * error, which is exactly the information someone needs when something goes
   * wrong here. The backend already returns a real message for each
   * (loginFunc); this is what actually reads it.
   */
  login: async (email: string, password: string, orgId?: string | null): Promise<
    { ok: true; user: AuthUser } | { ok: false; status: number; error: string }
  > => {
    if (!apiEnabled) return { ok: false, status: 0, error: 'offline' }
    try {
      const payload: Record<string, any> = { email, password }
      if (orgId) payload.orgId = orgId
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      const body = await r.json().catch(() => null) as { token?: string; user?: AuthUser; error?: string } | null
      if (!r.ok || !body?.token) return { ok: false, status: r.status, error: body?.error || 'login failed' }
      setToken(body.token)
      useAppStore.setState({ isLiveMode: true })
      return { ok: true, user: body.user as AuthUser }
    } catch (err: any) {
      return { ok: false, status: 0, error: err?.message || 'network error' }
    }
  },
  register: async (b: any): Promise<{ ok: boolean; message?: string; error?: string; pending?: boolean } | null> => {
    if (!apiEnabled) return null
    try {
      const r = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) return { ok: false, error: data?.error || 'Registration failed' }
      return data || { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error' }
    }
  },
  forgotPassword: async (email: string) => {
    if (!apiEnabled) return null
    try {
      const r = await fetch(`${BASE}/api/auth/forgot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      return await r.json().catch(() => null)
    } catch { return null }
  },
  resetPassword: async (token: string, password: string) => {
    if (!apiEnabled) return null
    try {
      const r = await fetch(`${BASE}/api/auth/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      return await r.json().catch(() => null)
    } catch { return null }
  },
  updatePassword: async (b: any) => req(`/api/auth/password`, { method: 'PUT', body: JSON.stringify(b) }),
  logout: () => setToken(null),

  getRule: (nodeId: string) => req<NodeAlarmRule>(`/api/nodes/${nodeId}/rule`),
  putRule: (nodeId: string, body: { orgId: string; rule: NodeAlarmRule; updatedBy?: string }) =>
    req(`/api/nodes/${nodeId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  putOrgRule: (orgId: string, body: { rule: NodeAlarmRule; updatedBy?: string }) =>
    req<{ applied: number }>(`/api/orgs/${orgId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  /**
   * The org+domain default that putOrgRule stores (org_domain_rules).
   * `rule: null` means never configured — the caller should then show the
   * built-in schema defaults. There was no way to read this back, so the
   * admin Alarm & Notify editor always rendered those defaults even when real
   * thresholds were saved and live on every node.
   */
  getOrgRule: (orgId: string, domain: string) =>
    req<{ rule: NodeAlarmRule | null; updatedBy?: string | null; updatedAt?: string | null }>(
      `/api/orgs/${orgId}/rule?domain=${encodeURIComponent(domain)}`),

  /**
   * The SAME readings summary downloadReport() streams as a CSV, parsed into
   * rows — so a PDF and a CSV of the same range contain the same numbers
   * rather than two different reports. Server-side scoping is identical
   * (it is the one endpoint), including the per-viewer narrowing.
   * Returns null when unreachable; [] when there is genuinely no data.
   */
  reportSummary: async (opts?: { days?: number; scope?: string; scopeId?: string; domain?: string; orgId?: string }):
    Promise<{ node_id: string; param_key: string; samples: string; avg: string; min: string; max: string }[] | null> => {
    if (!isLive()) return null
    const qs = new URLSearchParams()
    if (opts?.days) qs.set('days', String(opts.days))
    if (opts?.scope) qs.set('scope', opts.scope)
    if (opts?.scopeId) qs.set('scopeId', opts.scopeId)
    if (opts?.domain) qs.set('domain', opts.domain)
    if (opts?.orgId) qs.set('orgId', opts.orgId)
    try {
      const token = getToken()
      const r = await fetch(`${BASE}/api/reports/download?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!r.ok) return null
      const text = await r.text()
      // node_id,param_key,samples,avg,min,max — header row, then data.
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      return lines.slice(1).map((l) => {
        const [node_id, param_key, samples, avg, min, max] = l.split(',')
        return { node_id, param_key, samples, avg, min, max }
      })
    } catch {
      return null
    }
  },
  /** Org-wide alert routing (notification_channels). notify() reads these. */
  /**
   * Notification destinations. Omit departmentId for the ORG-level set (the
   * fallback every alarm uses); pass one to read that department's own set.
   * notify() routes an alarm to "org-level OR the owning department's" rows,
   * so a department set here is what makes nodes.department_id actually
   * change where an alarm is delivered.
   */
  orgChannels: (orgId: string, departmentId?: string) =>
    req<{ id: number; channel: string; target: string | null; min_severity: string; enabled: number }[]>(
      `/api/orgs/${orgId}/channels${departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ''}`),
  // Accepts either shape: the UI models a channel as { id }, the table as
  // { channel }. The backend reads channel||id, so both are valid here.
  // The org-level and each department's rows are independent — saving one
  // never wipes another.
  putOrgChannels: (orgId: string, channels: { id?: string; channel?: string; target?: string | null; enabled?: boolean; minSeverity?: string }[], departmentId?: string) =>
    req<{ ok: boolean; count: number; departmentId: string | null }>(
      `/api/orgs/${orgId}/channels`, { method: 'PUT', body: JSON.stringify({ channels, departmentId: departmentId ?? null }) }),
  /**
   * Which parameters SENSOR READINGS shows. Resolved per department, most
   * specific first: device+department -> device -> organization+department ->
   * organization -> none. A user in several departments gets the union, the
   * same most-permissive rule product access uses. 'none' means unconfigured,
   * which shows everything — never nothing.
   */
  displayParams: (orgId: string, domain: string, nodeId?: string, departmentId?: string | null) =>
    req<{ domain: string; nodeId: string | null; departmentId: string | null; scope: DisplayParamScope; paramKeys: string[]; layout: Record<string, ParamLayout> }>(
      `/api/orgs/${orgId}/display-params?domain=${encodeURIComponent(domain)}`
      + (nodeId ? `&nodeId=${encodeURIComponent(nodeId)}` : '')
      // Only an admin may name a department; for anyone else the backend uses
      // their own, so a viewer cannot read another team's selection.
      + (departmentId !== undefined ? `&departmentId=${encodeURIComponent(departmentId ?? '')}` : '')),
  /**
   * `layout` is per-key; an omitted key defaults to 'card' server-side.
   *
   * Targets: `nodeIds` applies the same selection to several devices at once —
   * an ETERNITY fleet has transformers of different specs publishing different
   * MQTT payloads, so "these four, which are the same model" is the useful
   * scope. `nodeId` (one device) and neither key (the org-wide default) both
   * still work.
   */
  setDisplayParams: (orgId: string, body: { domain: string; nodeId?: string | null; nodeIds?: string[]; departmentId?: string | null; paramKeys: string[]; layout?: Record<string, ParamLayout> }) =>
    req<{ ok: boolean; count: number; devices?: number }>(`/api/orgs/${orgId}/display-params`, { method: 'PUT', body: JSON.stringify(body) }),
  /**
   * Admin-editable display names for MQTT parameter keys (migrate-v34).
   * `labels` is the resolved map to render from (org-wide default with this
   * device's overrides on top); `own` is only the rows at the exact scope,
   * so an editor can tell an inherited name from one this device set itself.
   * The wire key is never renamed — this only decides what a human sees.
   */
  paramLabels: (orgId: string, domain: string, nodeId?: string) =>
    req<{ domain: string; nodeId: string | null; labels: Record<string, string>; own: Record<string, string>; pending?: string }>(
      `/api/orgs/${orgId}/param-labels?domain=${encodeURIComponent(domain)}`
      + (nodeId ? `&nodeId=${encodeURIComponent(nodeId)}` : '')),
  /** Per-key upsert; a blank value deletes that row (reverts to the built-in name). */
  /** Same target shape as setDisplayParams: `nodeIds` (several), `nodeId` (one), or neither (org-wide). */
  setParamLabels: (orgId: string, body: { domain: string; nodeId?: string | null; nodeIds?: string[]; labels: Record<string, string> }) =>
    req<{ ok: boolean; set: number; cleared: number; devices?: number }>(`/api/orgs/${orgId}/param-labels`, { method: 'PUT', body: JSON.stringify(body) }),
  /** The org's theme entitlement. Superadmin writes it; an admin allocates from it. */
  themeGrants: (orgId: string) => req<{ orgId: string; themeIds: string[] }>(`/api/orgs/${orgId}/theme-grants`),
  setThemeGrants: (orgId: string, themeIds: string[]) =>
    req<{ ok: boolean; count: number }>(`/api/orgs/${orgId}/theme-grants`, { method: 'PUT', body: JSON.stringify({ themeIds }) }),
  /** Every department's and user's product access for one org, in a single call. */
  orgProductAccess: (orgId: string) =>
    req<{ departments: Record<string, Record<string, string>>; users: Record<string, Record<string, string>> }>(
      `/api/orgs/${orgId}/product-access`),
  /** Which of the org's sites each department may see: { [departmentId]: siteId[] }. */
  departmentSites: (orgId: string) => req<Record<string, string[]>>(`/api/orgs/${orgId}/department-sites`),
  /** An empty list REMOVES the restriction — it never blinds the department. */
  setDepartmentSites: (orgId: string, departmentId: string, siteIds: string[]) =>
    req<{ ok: boolean; count: number; restricted: boolean }>(`/api/orgs/${orgId}/department-sites`, {
      method: 'PUT', body: JSON.stringify({ departmentId, siteIds }),
    }),
  /** Which dashboard themes each department may see: { [departmentId]: themeId[] }. */
  departmentThemes: (orgId: string) => req<Record<string, string[]>>(`/api/orgs/${orgId}/department-themes`),
  setDepartmentThemes: (orgId: string, departmentId: string, themeIds: string[]) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/department-themes`, { method: 'PUT', body: JSON.stringify({ departmentId, themeIds }) }),
  events: (nodeId: string) => req<unknown[]>(`/api/nodes/${nodeId}/events`),
  /**
   * Every alarm across the org in one call, instead of fanning out per
   * device — already department- and domain-scoped server-side for a
   * non-admin caller (same accessFor() visibility rule /api/fleet uses), so
   * the sidebar badge, admin Alarms, and a viewer's Overview notifications
   * all read the SAME real list. open=true narrows to unacknowledged +
   * uncleared (the badge/notifications use case); omit for the full history.
   */
  orgAlarms: (orgId: string, open?: boolean) =>
    req<{
      id: string; node_id: string; org_id: string; department_id: string | null
      param_key: string; param_label: string; severity: 'WARNING' | 'CRITICAL'; kind: string
      value: number; threshold: number; unit: string | null; raised_at: string
      acknowledged_at: string | null; acknowledged_by: string | null; event_problem_id: string | null
      cleared_at: string | null; domain: 'transformer' | 'carbonNode' | 'bloodBox'; node_name: string
    }[]>(`/api/orgs/${orgId}/alarms${open ? '?open=1' : ''}`),
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
    req<{ id: string; name: string; size: string | null; uploaded_by: string | null; content_type?: string | null; kind: DocKind; department_id?: string | null; created_at: string; doc_date?: string | null; note?: string | null; has_file?: number }[]>(
      `/api/nodes/${id}/documents?departmentId=${encodeURIComponent(departmentId)}`),
  /**
   * `docDate` is the date the DOCUMENT carries (YYYY-MM-DD), distinct from the
   * upload timestamp. `dataBase64` is now OPTIONAL: an entry may be a file, a
   * NOTE with no file (migrate-v44), or both — a lot of maintenance history
   * has no document behind it and used to go unrecorded or get typed into a
   * filename. The server rejects an entry with neither.
   */
  uploadNodeDocument: (id: string, doc: { departmentId: string; name: string; size?: string; uploadedBy?: string; contentType?: string; dataBase64?: string; kind?: DocKind; docDate?: string | null; note?: string }) =>
    req<{ ok: boolean; id: string }>(`/api/nodes/${id}/documents`, { method: 'POST', body: JSON.stringify(doc) }),
  /**
   * Send this device's exported data over a configured channel with the files
   * attached. Reachable by anyone who can OPEN the device (guard's 'node'
   * policy), not admins only. Attachments are built in the browser — there is
   * no PDF generator in the backend, and this way the emailed file is byte-for
   * -byte the one the user would have downloaded.
   * LINE Notify and the Google Chat webhook cannot carry attachments; the
   * server returns a 400 saying so rather than sending a message without them.
   */
  sendNodeExport: async (id: string, body: {
    channel: 'email' | 'telegram' | 'line' | 'googlechat'
    to?: string
    subject?: string
    body?: string
    attachments: { filename: string; contentType?: string; dataBase64: string }[]
  }): Promise<{ ok: true; sent: number } | { ok: false; error: string }> => {
    if (!isLive()) return { ok: false, error: 'Live mode required to send.' }
    try {
      const r = await fetch(`${BASE}/api/nodes/${id}/send-export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) return { ok: false, error: j?.error || `send failed (${r.status})` }
      return { ok: true, sent: j?.sent ?? body.attachments.length }
    } catch {
      return { ok: false, error: 'Could not reach the server.' }
    }
  },
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
  /**
   * Persist a device's coordinate and/or site. Partial: an omitted field is left
   * alone, so reassigning a site does not clear a pin placed on the floor plan.
   * Pass an explicit null to actually clear one.
   */
  setNodeLocation: (id: string, body: { lat?: number | null; lng?: number | null; siteId?: string | null }) =>
    req<{ ok: boolean; id: string; lat?: number | null; lng?: number | null; siteId?: string | null }>(`/api/nodes/${id}/location`, { method: 'PUT', body: JSON.stringify(body) }),
  /**
   * Rename / reassign the department of an already-approved device. Partial,
   * same rule as setNodeLocation: an omitted field is left alone. Domain and
   * serial are not editable here — domain is fixed at approval from the
   * device's real MQTT topic, and serial is the node id itself.
   */
  /**
   * `mergeInto` links this device as the SECOND FEED of another (nodes.merge_into,
   * migrate-v20) — one physical transformer publishing on two MQTT topics. The
   * worker then stores both topics' readings under the primary, so the device
   * page shows one asset with every parameter instead of two half-populated
   * ones, and readings already stored under this id are re-pointed so the
   * history is whole too. Pass null to unlink.
   */
  updateNodeProfile: (id: string, body: { name?: string; departmentId?: string | null; mergeInto?: string | null; grafanaUrl?: string | null }) =>
    req<{ ok: boolean; id: string; name?: string; departmentId?: string | null; mergeInto?: string | null; readingsMoved?: number; grafanaUrl?: string | null }>(
      `/api/nodes/${id}/profile`, { method: 'PUT', body: JSON.stringify(body) }),
  /** Devices linked as SECOND FEEDS of this one — what makes a merge undoable. */
  nodeFeeds: (id: string) =>
    req<{ id: string; feeds: { id: string; name: string | null; domain: string | null; mqtt_prefix: string | null }[] }>(
      `/api/nodes/${id}/feeds`),
  /**
   * Which departments may SEE this device (migrate-v35). Distinct from
   * updateNodeProfile's departmentId, which is the OWNING department — the
   * one alarms route to. `granted` is what is stored; `effective` is what the
   * visibility rule actually applies, falling back to the owner when nothing
   * has been granted.
   */
  nodeDepartments: (id: string) =>
    req<{ id: string; owner: string | null; granted: string[]; effective: string[]; pending?: string }>(
      `/api/nodes/${id}/departments`),
  /** An empty array clears the grants — the device reverts to its owning department, never to nobody. */
  setNodeDepartments: (id: string, departmentIds: string[]) =>
    req<{ ok: boolean; id: string; departmentIds: string[]; count: number }>(
      `/api/nodes/${id}/departments`, { method: 'PUT', body: JSON.stringify({ departmentIds }) }),

  /**
   * This org's per-user device restrictions (migrate-v42), as {userId: nodeIds}.
   * A user ABSENT from the map has no restriction and sees everything their
   * department allows; a user PRESENT is limited to exactly those devices.
   * That difference is the whole point of the feature, so never normalise an
   * absent user into an empty array — the two mean opposite things.
   */
  nodeVisibility: (orgId: string) =>
    req<{ byUser: Record<string, string[]>; pending?: string }>(`/api/orgs/${orgId}/node-visibility`),
  /**
   * Limit one user to specific devices. RESTRICT-ONLY: a device listed here is
   * still hidden unless the user's department could see it anyway. An empty
   * array CLEARS the restriction (back to unrestricted) — it never hides
   * everything.
   */
  setUserVisibleNodes: (userId: string, nodeIds: string[]) =>
    req<{ ok: boolean; userId: string; nodeIds: string[]; count: number; scoped: boolean }>(
      `/api/users/${userId}/visible-nodes`, { method: 'PUT', body: JSON.stringify({ nodeIds }) }),

  // Device photo — the real unit, uploaded by an admin, shown to every role in
  // place of the generic 3D twin.
  /** Is there a photo, and who put it there? One request, no bytes. */
  nodeImageMeta: (id: string) =>
    req<{ has: boolean; contentType?: string; caption?: string | null; updatedBy?: string | null; updatedAt?: string; bytes?: number; pending?: string }>(
      `/api/nodes/${id}/image?meta=1`),
  /** Served path for an <img>; ?v busts the cache when the photo is replaced. */
  nodeImageUrl: (id: string, version?: string | number) =>
    apiImageUrl(`/api/nodes/${id}/image${version ? `?v=${encodeURIComponent(String(version))}` : ''}`),
  setNodeImage: (id: string, body: { dataBase64?: string; contentType?: string; caption?: string | null }) =>
    req<{ ok: boolean; id: string; bytes?: number }>(`/api/nodes/${id}/image`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteNodeImage: (id: string) => req<{ ok: boolean }>(`/api/nodes/${id}/image`, { method: 'DELETE' }),

  // Device photo gallery (migrate-v36) — many photos per device, each with a
  // KIND, because a real transformer needs the overview, the nameplate close-up,
  // the tap changer, a thermal scan and before/after condition shots at the same
  // time. The single-photo routes above still work and now serve the cover.
  nodePhotos: (id: string) =>
    req<{ nodeId: string; photos: NodePhoto[]; pending?: string }>(`/api/nodes/${id}/photos`),
  /**
   * Served path for an <img>. `thumb` asks for the ~320px copy, which is what
   * every table, strip and map popup should use — the full image is 1600px and
   * only the lightbox needs it. `v` is the photo's updatedAt: the bytes at a
   * given version never change, so the response is cached immutably and a
   * caption edit (which bumps updatedAt) is what re-fetches it.
   */
  nodePhotoUrl: (id: string, photoId: string, opts?: { thumb?: boolean; v?: string | number }) => {
    const q: string[] = []
    if (opts?.thumb) q.push('thumb=1')
    if (opts?.v) q.push(`v=${encodeURIComponent(String(opts.v))}`)
    return apiImageUrl(`/api/nodes/${id}/photos/${photoId}${q.length ? `?${q.join('&')}` : ''}`)
  },
  /** Append a photo. Both sizes are produced in the browser — see src/lib/imagePipeline.ts. */
  addNodePhoto: (id: string, body: {
    dataBase64: string; thumbBase64?: string; contentType?: string
    kind?: NodePhotoKind; caption?: string | null
    width?: number; height?: number
    takenAt?: string | null; lat?: number | null; lng?: number | null
  }) => req<{ ok: boolean; id: string; nodeId: string; bytes: number }>(
    `/api/nodes/${id}/photos`, { method: 'POST', body: JSON.stringify(body) }),
  /** Partial: an omitted key is left alone, so saving a caption never drops the annotations. */
  patchNodePhoto: (id: string, photoId: string, body: { caption?: string | null; kind?: NodePhotoKind; annotations?: PhotoAnnotation[] | null }) =>
    req<{ ok: boolean; id: string }>(`/api/nodes/${id}/photos/${photoId}`, { method: 'PUT', body: JSON.stringify(body) }),
  /** Reorder; the first id becomes the cover every other surface shows. */
  orderNodePhotos: (id: string, ids: string[]) =>
    req<{ ok: boolean; count: number }>(`/api/nodes/${id}/photos/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  deleteNodePhoto: (id: string, photoId: string) =>
    req<{ ok: boolean }>(`/api/nodes/${id}/photos/${photoId}`, { method: 'DELETE' }),
  /**
   * Cover photo id per device for a whole org, in one request. Lists render a
   * thumbnail per row from this without asking each device separately, and each
   * <img> then caches its own bytes.
   */
  orgPhotoCovers: (orgId: string) =>
    req<Record<string, { photoId: string; v: string }>>(`/api/orgs/${orgId}/photo-covers`),

  // Kind catalog (migrate-v40) — the admin-owned list behind the photo-kind
  // and document-kind pickers. Built-ins are merged in server-side, so this
  // always returns a usable list even for an org that has customised nothing.
  orgKinds: (orgId: string, scope: KindScope) =>
    req<{ scope: KindScope; kinds: CatalogKind[] }>(`/api/orgs/${orgId}/kinds?scope=${scope}`),
  /** Upsert: an existing key edits it (including relabelling a built-in), a new key adds one. */
  saveOrgKind: (orgId: string, body: { scope: KindScope; key: string; label: string; hint?: string | null; position?: number; active?: boolean }) =>
    req<{ ok: boolean; scope: KindScope; key: string; label: string }>(`/api/orgs/${orgId}/kinds`, { method: 'POST', body: JSON.stringify(body) }),
  /** Custom kinds only — a built-in is hidden, never deleted, and the backend refuses (409) while anything still carries it. */
  deleteOrgKind: (orgId: string, scope: KindScope, key: string) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/kinds/${scope}/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // Transformer nameplate — real per-device spec (kVA, voltage, manufacturer…),
  // replacing the fabricated Asset Info that used to show the same fake unit
  // for every transformer regardless of its actual rating.
  nodeNameplate: (id: string) =>
    req<{
      has: boolean; modelId?: string | null; modelCode?: string | null; modelActive?: boolean | null
      manufacturer?: string | null; model?: string | null; serialNumber?: string | null
      ratedKva?: number | null; voltageClass?: string | null; coolingType?: string | null
      yearInstalled?: number | null; updatedBy?: string | null; updatedAt?: string; pending?: string
      resolved?: { model?: string | null; manufacturer?: string | null; ratedKva?: number | null; voltageClass?: string | null; coolingType?: string | null }
    }>(`/api/nodes/${id}/nameplate`),
  /**
   * Partial update — an omitted key is left alone; null/'' clears just that
   * field. modelId links/unlinks a transformer_models catalog row (migrate-
   * v32); pass null to unlink back to free-typed fields.
   */
  setNodeNameplate: (id: string, body: {
    modelId?: string | null
    manufacturer?: string | null; model?: string | null; serialNumber?: string | null
    ratedKva?: number | null; voltageClass?: string | null; coolingType?: string | null; yearInstalled?: number | null
  }) => req<{ ok: boolean; id: string }>(`/api/nodes/${id}/nameplate`, { method: 'PUT', body: JSON.stringify(body) }),
  /** Whole-org map, so the fleet list can show real ratings without one request per device. */
  orgNameplates: (orgId: string) =>
    req<Record<string, { model: string | null; ratedKva: number | null; voltageClass: string | null }>>(`/api/orgs/${orgId}/nameplates`),

  // Transformer model catalog (migrate-v32) — each org's own copy, never a
  // shared cross-org list. See src/lib/useNodeNameplate.ts's TransformerModel.
  transformerModels: (orgId: string) =>
    req<{ id: string; modelCode: string; manufacturer: string | null; ratedKva: number | null; voltageClass: string | null; coolingType: string | null; active: boolean; createdBy: string | null; updatedAt: string }[]>(
      `/api/orgs/${orgId}/transformer-models`),
  /** Upsert: omit id to create, pass it back to edit. */
  saveTransformerModel: (orgId: string, body: { id?: string; modelCode: string; manufacturer?: string | null; ratedKva?: number | null; voltageClass?: string | null; coolingType?: string | null }) =>
    req<{ ok: boolean; id: string }>(`/api/orgs/${orgId}/transformer-models`, { method: 'POST', body: JSON.stringify(body) }),
  /** Retire/restore — never deletes, so units already linked keep resolving. */
  setTransformerModelActive: (orgId: string, id: string, active: boolean) =>
    req<{ ok: boolean; id: string; active: boolean }>(`/api/orgs/${orgId}/transformer-models/${id}/active`, { method: 'PUT', body: JSON.stringify({ active }) }),
  /** Hard delete — the backend refuses (409) while any device is linked. */
  deleteTransformerModel: (orgId: string, id: string) =>
    req<{ ok: boolean }>(`/api/orgs/${orgId}/transformer-models/${id}`, { method: 'DELETE' }),
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
  // otaRelListFunc SELECTs `product` (the ota_releases column) — this declared
  // `domain`/`released_at`, fields the response has never actually carried,
  // so admin/ota's release cards always rendered a blank product-line label.
  otaReleases: () => req<{id:string; version:string; product:string; artefact_uri:string; release_notes:string}[]>(`/api/ota/releases`),
  saveOtaRelease: (body: { version: string; domain: string; artefact_uri: string; release_notes?: string }) =>
    req<{ id: string }>(`/api/ota/releases`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOtaRelease: (id: string) => req(`/api/ota/releases/${id}`, { method: 'DELETE' }),
  // otaDepListFunc already supports ?nodeId= and joins ota_releases for
  // product/version server-side — pass it instead of fetching the whole org's
  // OTA history to filter one device out of it client-side.
  // ota_deployments has no updated_at column — the page that used to read
  // d.updated_at was reading a field that has never existed on this table
  // (started_at / completed_at are the real ones), so a naive real-data
  // migration would have produced "Invalid Date" instead of a fabricated one.
  otaDeployments: (opts?: { nodeId?: string; status?: string }) =>
    req<{ node_id: string; release_id: string; product: string | null; version: string | null; status: string; progress_pct: number | null; error_msg: string | null; started_at: string; completed_at: string | null }[]>(
      `/api/ota/deployments${opts?.nodeId || opts?.status ? '?' : ''}${[
        opts?.nodeId ? `nodeId=${encodeURIComponent(opts.nodeId)}` : '',
        opts?.status ? `status=${encodeURIComponent(opts.status)}` : '',
      ].filter(Boolean).join('&')}`),
  deployFleetOta: (body: { release_id: string; domain: string; org_id?: string }) =>
    req<{ applied: number }>(`/api/ota/deploy-fleet`, { method: 'POST', body: JSON.stringify(body) }),

  // Scheduled reports (cron-generated CSV emailed to recipients)
  listSchedules: (orgId: string) => req<ReportScheduleRow[]>(`/api/reports/schedules?orgId=${encodeURIComponent(orgId)}`),
  // scopeId, NOT scope_id: rptPostFunc reads b.scopeId. The page used to post
  // scope_id, which arrived as undefined and stored a NULL target — so a
  // "Line 3 daily" schedule silently reported on the whole organization. The
  // backend now accepts both spellings; this sends the one it always wanted.
  saveSchedule: (body: SaveSchedule) =>
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

  // ---- MQTT connection info shown on admin/pending's "MQTT setup" card.
  // Separate from platformSettings above: readable by EVERY admin (policy
  // 'admin', not 'super') — they are the ones who go program a device with
  // it — only writable by a superadmin. The password comes back in plaintext
  // on purpose; unlike smtp.pass this is a credential admins must copy into
  // firmware, not a server-side-only secret.
  mqttConnection: () =>
    req<{ host: string; port: string; username: string; password: string; tls: boolean }>(`/api/platform/mqtt`),
  saveMqttConnection: (body: { host?: string; port?: string; username?: string; password?: string; clearPassword?: boolean; tls?: boolean }) =>
    req<{ ok: boolean }>(`/api/platform/mqtt`, { method: 'PUT', body: JSON.stringify(body) }),

  // ---- Tenancy / provisioning (superadmin: orgs/entitlements/nodes; admin: depts/users/access)
  orgs: () => req<{ id: string; name: string; status?: string; logo_url?: string | null; lat?: number; lng?: number; show_3d_fallback?: number }[]>(`/api/orgs`),

  // Schema migrations (superadmin). Which databases are behind the .sql files
  // in the image running right now, and the button that brings tenants up.
  migrationStatus: () =>
    req<MigrationStatus>(`/api/platform/migrations`),
  /**
   * Runs every TENANT database up to date via the migrate service. Not the
   * control database — that is applied by the deploy-time Job, so a control
   * database behind the code needs a deploy, not this button.
   *
   * A dedicated fetch, not req(): migrationsRunFunc already computes a real
   * reason on failure — ECONNREFUSED, DNS failure, a timeout waiting on a
   * genuinely slow full-catalog run — and sends it as {error} on a 502/503.
   * req() discards the response body on any non-2xx and returns null, so
   * MigrationsPanel's "Could not reach the migrate service" toast was the
   * ONLY thing a superadmin could ever see here, regardless of what actually
   * went wrong. The panel already renders result.error when result is
   * non-null (built for this, apparently never exercised) — this is what
   * actually gets it there.
   */
  runMigrations: async (): Promise<MigrationRunResult | null> => {
    if (!apiEnabled) return null
    try {
      const tok = getToken()
      const r = await fetch(`${BASE}/api/platform/migrations/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      })
      const body = await r.json().catch(() => null) as MigrationRunResult | null
      if (body) return body
      return { ok: false, httpStatus: r.status, migrated: [], failed: [], skipped: [], error: `HTTP ${r.status} with no readable response body` }
    } catch (err: any) {
      return { ok: false, httpStatus: 0, migrated: [], failed: [], skipped: [], error: err?.message || 'network error' }
    }
  },
  /** The superadmin header's numbers, queried rather than invented. */
  platformStats: () =>
    req<PlatformStats>(`/api/platform/stats`),
  // Read-only SQL console (superadmin). runSql resolves to the error BODY on a
  // rejected query rather than null, because "Unknown column 'foo'" is the
  // whole point of a console — req() collapses every failure to null, so this
  // one call reads the response itself.
  // Like runSql, this resolves to the error BODY rather than null: the one
  // failure that matters here ("your organization does not have its own
  // database") is a sentence the admin needs to read, and req() collapses every
  // failure to null.
  sqlSchema: async (): Promise<
    { ok: true; tables: { name: string; columns: { name: string; type: string }[] }[]; blocked: string[]; database: string }
    | { ok: false; error: string }
  > => {
    if (!isLive()) return { ok: false, error: 'Live mode required — demo mode has no database.' }
    try {
      const r = await fetch(`${BASE}/api/platform/sql/schema`, {
        headers: { ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) return { ok: false, error: body?.error || `request failed (${r.status})` }
      return { ok: true, ...body }
    } catch {
      return { ok: false, error: 'Could not reach the server.' }
    }
  },
  /**
   * Real ingest quality for one org: readings.quality for data inside the
   * retention window, plus readings_rollup.n/bad_n for everything already
   * rolled up, summed so the trend does not step down at the retention edge.
   */
  dataQuality: (orgId: string, days = 7) =>
    req<{
      days: number
      devices: number
      totals: { samples: number; bad: number; good: number; goodPct: number | null }
      byQuality: Record<string, number>
      trend: { day: string; samples: number; bad: number; goodPct: number | null }[]
      worst: { nodeId: string; name: string; samples: number; bad: number; badPct: number }[]
      presence: { online: number; offline: number; never: number }
      sources: string[]
    }>(`/api/orgs/${orgId}/data-quality?days=${days}`),
  runSql: async (sql: string, limit = 200): Promise<
    { ok: true; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; elapsedMs: number; database: string }
    | { ok: false; error: string }
  > => {
    if (!isLive()) return { ok: false, error: 'Live mode required — demo mode has no database.' }
    try {
      const r = await fetch(`${BASE}/api/platform/sql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
        body: JSON.stringify({ sql, limit }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) return { ok: false, error: body?.error || `request failed (${r.status})` }
      return { ok: true, ...body }
    } catch {
      return { ok: false, error: 'Could not reach the server.' }
    }
  },
  // provisioned: the tenant database this org needs under TENANT_DB_MODE.
  // admin.setPasswordUrl: returned only when SMTP is unconfigured, because the
  // admin row carries no password and that link is then the only way to sign in.
  // adminPassword: set the new org admin's password at provisioning time and
  // email it with the sign-in name, so the customer can use the product straight
  // away. Omit it to fall back to the set-password link.
  saveOrg: (body: { id?: string; name: string; status?: string; logoUrl?: string; adminEmail?: string; adminName?: string; adminPassword?: string }) =>
    req<{
      id: string
      provisioned?: { ok?: boolean; db?: string; applied?: number; error?: string } | null
      admin?: { email?: string; emailed?: boolean; passwordSet?: boolean; setPasswordUrl?: string; error?: string } | null
    }>(`/api/orgs`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOrg: (id: string) => req(`/api/orgs/${id}`, { method: 'DELETE' }),
  /**
   * The maintenance kill switch. A suspended organization is a 403 for all of
   * its users, at login and on every request; a superadmin keeps full access.
   * Telemetry ingest is NOT stopped — suspending must not punch a hole in the
   * customer's history.
   */
  setOrgStatus: (orgId: string, status: 'active' | 'suspended', reason?: string) =>
    req<{ ok: boolean; id: string; status: string; unchanged?: boolean }>(`/api/orgs/${orgId}/status`, {
      method: 'PUT', body: JSON.stringify({ status, reason }),
    }),
  /**
   * Whether a device with no uploaded photo yet shows the generic 3D model
   * (FixDashboard's twin slot, TransformerDetailView's 3D canvas) or nothing
   * 3D at all. Defaults to true for every org (migrate-v33) — today's
   * behavior, unchanged until a superadmin turns it off.
   */
  set3dFallback: (orgId: string, show: boolean) =>
    req<{ ok: boolean; id: string; show: boolean; unchanged?: boolean }>(`/api/orgs/${orgId}/3d-fallback`, {
      method: 'PUT', body: JSON.stringify({ show }),
    }),
  /** Real administrative audit trail (migrate-v30). Most recent first. */
  auditLog: (opts?: { orgId?: string; limit?: number }) =>
    req<{ id: number; actor_id: string | null; actor_name: string | null; action: string; org_id: string | null; target: string | null; detail: string | null; at: string }[]>(
      `/api/platform/audit?limit=${opts?.limit ?? 50}${opts?.orgId ? `&orgId=${encodeURIComponent(opts.orgId)}` : ''}`),
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
  // username is stored (migrate-v22) and unique per org — login accepts it or
  // the email. 409 when it is already taken, which the form surfaces.
  // password: optional on edit (blank keeps the existing one), and the only way
  // an admin-created account can ever sign in — the row is stored with a NULL
  // password_hash otherwise and login refuses those.
  /** What the signed-in user may see: departments and the union of their themes. */
  /**
   * The SIGNED-IN user's real org, department(s) and per-domain access level
   * — orgId/levels delegate server-side to accessFor(), the same helper
   * /api/fleet's own visibility filter trusts, so this can never disagree
   * with what a page's real data already scoped out. levels omits a domain
   * entirely rather than sending 'none' for it — treat an absent key as
   * 'none', not as truthy.
   */
  myAccess: () => req<{
    userId: string; orgId: string; role: string; departmentIds: string[]; themeIds: string[]
    levels: Partial<Record<'transformer' | 'carbonNode' | 'bloodBox', 'none' | 'view' | 'manage'>>
  }>(`/api/me/access`),
  // departmentIds is the real assignment (migrate-v25). departmentId is still
  // sent so a backend without that table keeps the primary one.
  saveUser: (orgId: string, body: { id?: string; email?: string; username?: string; name: string; role?: string; departmentId?: string; departmentIds?: string[]; password?: string }) =>
    req<{ id: string }>(`/api/orgs/${orgId}/users`, { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (id: string) => req(`/api/users/${id}`, { method: 'DELETE' }),
  productAccess: (scope: 'department' | 'user', scopeId: string) =>
    req<{ domain: string; level: string }[]>(`/api/product-access?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`),
  /** level 'inherit' DELETES the override — it is the absence of a row, not a level. */
  setProductAccess: (body: { scope: 'department' | 'user'; scopeId: string; domain: string; level: 'none' | 'view' | 'manage' | 'inherit' }) =>
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
  approveNode: (id: string, body: { name?: string; domain?: string; departmentId?: string; orgId?: string; lat?: number; lng?: number; mergeInto?: string; modelId?: string }) =>
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
  /** 1 = no coordinate of its own; this is the org's factory pin, nudged apart. */
  approx?: 0 | 1
  /** Admin-set Free-Style dashboard link (migrate-v45). Null = not configured. */
  grafana_url?: string | null
}

/** How a schedule decides who receives it. See migrate-v41. */
export type RecipientMode = 'manual' | 'department' | 'users'

/** A report_schedules row as the API returns it (snake_case, straight from MySQL). */
export interface ReportScheduleRow {
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
  // migrate-v41. Times are wall clock in the deployment timezone (DB_TZ),
  // not UTC — see the migration for why.
  send_hour: number
  send_minute: number
  day_of_week: number | null      // 1=Mon .. 7=Sun, weekly only
  day_of_month: number | null     // 1..28, monthly only
  window_days: number | null      // null = derive from sequence
  recipient_mode: RecipientMode
  recipient_dept_ids: string | null   // comma-separated
  recipient_user_ids: string | null   // comma-separated
  // migrate-v43. NULL = use the built-in wording, so an untouched schedule
  // keeps sending exactly what it sent before.
  subject_template: string | null
  body_template: string | null
}

/** What the page POSTs. camelCase — this is what rptPostFunc reads. */
export interface SaveSchedule {
  id?: string
  orgId: string
  name: string
  scope?: 'device' | 'department' | 'org'
  scopeId?: string
  sequence?: 'daily' | 'weekly' | 'monthly'
  format?: 'PDF' | 'XLSX' | 'CSV'
  channel?: 'email' | 'telegram'
  recipients?: string
  enabled?: 0 | 1
  sendHour?: number
  sendMinute?: number
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  windowDays?: number | null
  recipientMode?: RecipientMode
  recipientDeptIds?: string[]
  recipientUserIds?: string[]
  /** Empty string clears back to the built-in default. */
  subjectTemplate?: string
  bodyTemplate?: string
}

/** @deprecated kept so older imports keep compiling; use ReportScheduleRow. */
export type ReportSchedule = ReportScheduleRow

export default api
