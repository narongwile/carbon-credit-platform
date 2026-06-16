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
}
