// ---------------------------------------------------------------------------
// REST adapter for the ONEOPS backend.
// When NEXT_PUBLIC_API_URL is unset (e.g. the static GitHub Pages build), every
// call is a no-op and the app falls back to its local (zustand/localStorage)
// state — so the frontend works with OR without the backend.
// ---------------------------------------------------------------------------

import type { NodeAlarmRule } from '@/server/alarmEngine'

const BASE = process.env.NEXT_PUBLIC_API_URL || ''
export const apiEnabled = !!BASE
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

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!BASE) return null
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
  updatePassword: async (b: any) => req(`/api/auth/password`, { method: 'PUT', body: JSON.stringify(b) }),
  logout: () => setToken(null),

  getRule: (nodeId: string) => req<NodeAlarmRule>(`/api/nodes/${nodeId}/rule`),
  putRule: (nodeId: string, body: { orgId: string; rule: NodeAlarmRule; updatedBy?: string }) =>
    req(`/api/nodes/${nodeId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  putOrgRule: (orgId: string, body: { rule: NodeAlarmRule; updatedBy?: string }) =>
    req<{ applied: number }>(`/api/orgs/${orgId}/rule`, { method: 'PUT', body: JSON.stringify(body) }),
  events: (nodeId: string) => req<unknown[]>(`/api/nodes/${nodeId}/events`),
  ackEvent: (eventId: string, body: { by: string; eventProblemId?: string }) =>
    req(`/api/events/${eventId}/ack`, { method: 'POST', body: JSON.stringify(body) }),
  ingest: (nodeId: string, values: Record<string, number>, ts?: number) =>
    req(`/api/nodes/${nodeId}/readings`, { method: 'POST', body: JSON.stringify({ values, ts }) }),

  // Generic fleet (transformer / carbonNode / bloodBox) — live overview data.
  // Returns null when the API is unset, so callers fall back to fleetData mock.
  fleet: (orgId: string, domain?: string) =>
    req<FleetNode[]>(`/api/fleet?orgId=${encodeURIComponent(orgId)}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`),
  latest: (nodeId: string) =>
    req<{ nodeId: string; values: Record<string, number>; lastReadingAt: string | null }>(`/api/fleet/${nodeId}/latest`),

  // Downlink (backend → device). config publishes retained; body empty = sync
  // the saved alarm rule down to the device.
  pushConfig: (nodeId: string, body?: Record<string, unknown>) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/config`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  sendCmd: (nodeId: string, op: string, args?: Record<string, unknown>) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/cmd`, { method: 'POST', body: JSON.stringify({ op, ...args }) }),
  sendOta: (nodeId: string, body: { to_version: string; artefact_uri: string; sha256?: string }) =>
    req<{ ok: boolean; topic: string }>(`/api/nodes/${nodeId}/ota`, { method: 'POST', body: JSON.stringify(body) }),
  saveNodeDocuments: (id: string, docs: any[]) => req(`/api/nodes/${id}/documents`, { method: 'POST', body: JSON.stringify(docs) }),

  meConfig: () => req(`/api/me/config`),
  updateMeConfig: (b: any) => req(`/api/me/config`, { method: 'PUT', body: JSON.stringify(b) }),
  
  // Org Rule
  updateOrgRule: (orgId: string, rule: any) => req(`/api/orgs/${orgId}/rule`, { method: 'PUT', body: JSON.stringify(rule) }),

  // Fleet OTA Management
  otaReleases: () => req<{id:string; version:string; target_hw:string; artefact_uri:string; released_at:string; release_notes:string}[]>(`/api/ota/releases`),
  saveOtaRelease: (body: { version: string; target_hw: string; artefact_uri: string; release_notes?: string }) =>
    req<{ id: string }>(`/api/ota/releases`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOtaRelease: (id: string) => req(`/api/ota/releases/${id}`, { method: 'DELETE' }),
  otaDeployments: () => req<{node_id:string; release_id:string; status:string; updated_at:string}[]>(`/api/ota/deployments`),
  deployFleetOta: (body: { release_id: string; target_hw: string; org_id?: string }) =>
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

  // ---- Tenancy / provisioning (superadmin: orgs/entitlements/nodes; admin: depts/users/access)
  orgs: () => req<unknown[]>(`/api/orgs`),
  saveOrg: (body: { id?: string; name: string; status?: string; logoUrl?: string }) =>
    req<{ id: string }>(`/api/orgs`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOrg: (id: string) => req(`/api/orgs/${id}`, { method: 'DELETE' }),
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

  // Event problem catalog (root causes) — admin maintains, viewers read for ack.
  eventProblems: (orgId: string, departmentId?: string, domain?: string) =>
    req<{ id: string; label: string; department_id: string | null; domain: string | null }[]>(
      `/api/event-problems?orgId=${encodeURIComponent(orgId)}${departmentId ? `&departmentId=${encodeURIComponent(departmentId)}` : ''}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`),
  saveEventProblem: (body: { id?: string; orgId: string; departmentId?: string; domain?: string; label: string }) =>
    req<{ id: string }>(`/api/event-problems`, { method: 'POST', body: JSON.stringify(body) }),
  deleteEventProblem: (id: string) => req(`/api/event-problems/${id}`, { method: 'DELETE' }),
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
  recipients: string | null
  enabled: 0 | 1
  last_run_at: string | null
  next_run_at: string | null
}
