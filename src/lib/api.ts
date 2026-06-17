// ---------------------------------------------------------------------------
// REST adapter for the ONEOPS backend.
// When NEXT_PUBLIC_API_URL is unset (e.g. the static GitHub Pages build), every
// call is a no-op and the app falls back to its local (zustand/localStorage)
// state — so the frontend works with OR without the backend.
// ---------------------------------------------------------------------------

import type { NodeAlarmRule } from '@/server/alarmEngine'

const BASE = process.env.NEXT_PUBLIC_API_URL || ''
export const apiEnabled = !!BASE

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!BASE) return null
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { 'content-type': 'application/json' }, ...init })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export const api = {
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

  // Scheduled reports (cron-generated CSV emailed to recipients)
  listSchedules: (orgId: string) => req<ReportSchedule[]>(`/api/reports/schedules?orgId=${encodeURIComponent(orgId)}`),
  saveSchedule: (body: Partial<ReportSchedule> & { orgId: string; name: string }) =>
    req<{ id: string }>(`/api/reports/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSchedule: (id: string) => req(`/api/reports/schedules/${id}`, { method: 'DELETE' }),
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
