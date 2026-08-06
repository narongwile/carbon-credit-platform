'use client'
// ---------------------------------------------------------------------------
// Live fleet overlay. Fetches GET /api/fleet (+ optional per-node latest) from
// the backend and exposes it by node id. When NEXT_PUBLIC_API_URL is unset the
// hook is a no-op (empty map) so callers transparently fall back to mock data.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react'
import { api, useIsLive, type FleetNode } from './api'
import { DOMAIN_META } from '@/types/fleet'
import type { GeoNode } from './geoNodes'

export type EffectiveStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'

export function statusFromLive(n: FleetNode): EffectiveStatus {
  if (n.online === 0) return 'OFFLINE'
  if (n.alarm === 'CRITICAL') return 'CRITICAL'
  if (n.alarm === 'WARNING') return 'WARNING'
  return 'NORMAL'
}

/** How often the fleet re-fetches — the map's own claim to being "live". */
const POLL_MS = 15_000

export function useFleetLive(orgId: string, domain?: string) {
  const [byId, setById] = useState<Map<string, FleetNode>>(new Map())
  const [loaded, setLoaded] = useState(false)
  // Reactive: re-fetches (and falls back to mock) when the Demo/Live toggle flips.
  const apiEnabled = useIsLive()

  const load = useCallback(() => {
    if (!apiEnabled || !orgId) { setById(new Map()); setLoaded(true); return }
    api.fleet(orgId, domain).then((rows) => {
      if (rows) setById(new Map(rows.map((r) => [r.id, r])))
      setLoaded(true)
    })
  }, [orgId, domain, apiEnabled])

  useEffect(() => {
    load()
    if (!apiEnabled || !orgId) return
    // A device placed on the Live Sensor Map (DevicePlacementPanel) needs its
    // new pin to actually appear without a manual page reload — this is what
    // makes that possible, and every other consumer of this hook gets the same
    // "positions/alarms/presence catch up on their own" for free.
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load, apiEnabled, orgId])

  return { byId, enabled: apiEnabled, loaded, reload: load }
}

const geoHealth = (n: FleetNode) => {
  const s = statusFromLive(n)
  return s === 'CRITICAL' ? 'critical' : s === 'WARNING' || s === 'OFFLINE' ? 'warning' : 'healthy'
}

/** The FleetNode → GeoNode mapping, factored out so a caller that also needs
 * `reload` (DevicePlacementPanel's host page) can call useFleetLive itself
 * instead of going through the read-only hook below. */
export function fleetToGeoNodes(byId: Map<string, FleetNode>, orgId: string): GeoNode[] {
  const geo: GeoNode[] = []
  for (const n of Array.from(byId.values())) {
    if (n.lat == null || n.lng == null) continue
    const meta = DOMAIN_META[n.domain]
    geo.push({
      id: n.id, orgId, name: n.name, domain: n.domain,
      platform: meta.platform, accent: meta.accent, health: geoHealth(n),
      lat: Number(n.lat), lng: Number(n.lng), approx: n.approx === 1,
      metricLabel: 'Status', metricValue: n.alarm ?? (n.online === 0 ? 'Offline' : 'Online'),
      updated: n.last_seen ?? '—',
    })
  }
  return geo
}

// Live GeoNode[] for the sensor map from /api/fleet (uses node lat/lng). Returns
// null when the API is off or no node has coordinates → caller falls back to mock.
export function useLiveGeoNodes(orgId: string): GeoNode[] | null {
  const { byId, loaded } = useFleetLive(orgId)
  if (!loaded || byId.size === 0) return null
  const geo = fleetToGeoNodes(byId, orgId)
  return geo.length ? geo : null
}
