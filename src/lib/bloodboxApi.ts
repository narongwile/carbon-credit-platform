// ---------------------------------------------------------------------------
// BloodBOX REST client. Talks to the backend (/api/bloodbox) when
// NEXT_PUBLIC_API_URL is set; otherwise every call is a no-op so the static
// build keeps working from the local mock data in bloodboxData.ts.
// ---------------------------------------------------------------------------

import type { JourneyEventType, JourneySignal } from './bloodboxData'

const BASE = process.env.NEXT_PUBLIC_API_URL || ''
export const bloodboxApiEnabled = !!BASE

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

export interface LogJourneyBody {
  eventType: JourneyEventType
  signal: JourneySignal
  label?: string
  floorId?: string
  posX?: number
  posY?: number
  tempC?: number
  batteryPct?: number
}

export interface BeaconBody {
  id?: string
  orgId: string
  floorId: string
  uuid: string
  major?: number
  minor?: number
  posX?: number
  posY?: number
  txPower?: number
  battery?: number
  status?: string
}

export const bloodboxApi = {
  transits: (orgId: string) => req<unknown[]>(`/api/bloodbox/transits?orgId=${encodeURIComponent(orgId)}`),
  journey: (transitId: string) => req<unknown[]>(`/api/bloodbox/transits/${transitId}/journey`),
  logJourney: (transitId: string, body: LogJourneyBody) =>
    req<{ id: string }>(`/api/bloodbox/transits/${transitId}/journey`, { method: 'POST', body: JSON.stringify(body) }),
  // Report a transit temperature sample — persists + bridges into the central
  // alarm engine so excursions during transit raise events/notifications.
  reportTemp: (transitId: string, body: { tempC: number; battery?: number; ts?: number }) =>
    req<{ ok: boolean; bridged: unknown }>(`/api/bloodbox/transits/${transitId}/temp`, { method: 'POST', body: JSON.stringify(body) }),
  floors: (orgId: string) => req<unknown[]>(`/api/bloodbox/floors?orgId=${encodeURIComponent(orgId)}`),
  beacons: (orgId: string, floorId?: string) =>
    req<unknown[]>(`/api/bloodbox/beacons?orgId=${encodeURIComponent(orgId)}${floorId ? `&floorId=${encodeURIComponent(floorId)}` : ''}`),
  saveBeacon: (body: BeaconBody) =>
    req<{ id: string }>('/api/bloodbox/beacons', { method: 'POST', body: JSON.stringify(body) }),
  deleteBeacon: (id: string) => req(`/api/bloodbox/beacons/${id}`, { method: 'DELETE' }),
  moveBox: (boxId: string, body: { orgId: string; floorId?: string; posX?: number; posY?: number; roomLabel?: string; movedBy?: string }) =>
    req(`/api/bloodbox/boxes/${boxId}/location`, { method: 'POST', body: JSON.stringify(body) }),
}
