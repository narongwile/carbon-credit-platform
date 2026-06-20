'use client'
// ---------------------------------------------------------------------------
// Live fleet overlay. Fetches GET /api/fleet (+ optional per-node latest) from
// the backend and exposes it by node id. When NEXT_PUBLIC_API_URL is unset the
// hook is a no-op (empty map) so callers transparently fall back to mock data.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react'
import { api, apiEnabled, type FleetNode } from './api'
import { DOMAIN_META } from '@/types/fleet'
import type { GeoNode } from './geoNodes'

export type EffectiveStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'

export function statusFromLive(n: FleetNode): EffectiveStatus {
  if (n.online === 0) return 'OFFLINE'
  if (n.alarm === 'CRITICAL') return 'CRITICAL'
  if (n.alarm === 'WARNING') return 'WARNING'
  return 'NORMAL'
}

export function useFleetLive(orgId: string, domain?: string) {
  const [byId, setById] = useState<Map<string, FleetNode>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!apiEnabled || !orgId) { setLoaded(true); return }
    let cancelled = false
    api.fleet(orgId, domain).then((rows) => {
      if (cancelled) return
      if (rows) setById(new Map(rows.map((r) => [r.id, r])))
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [orgId, domain])

  return { byId, enabled: apiEnabled, loaded }
}

const geoHealth = (n: FleetNode) => {
  const s = statusFromLive(n)
  return s === 'CRITICAL' ? 'critical' : s === 'WARNING' || s === 'OFFLINE' ? 'warning' : 'healthy'
}

// Live GeoNode[] for the sensor map from /api/fleet (uses node lat/lng). Returns
// null when the API is off or no node has coordinates → caller falls back to mock.
export function useLiveGeoNodes(orgId: string): GeoNode[] | null {
  const { byId, loaded } = useFleetLive(orgId)
  if (!loaded || byId.size === 0) return null
  const geo: GeoNode[] = []
  for (const n of Array.from(byId.values())) {
    if (n.lat == null || n.lng == null) continue
    const meta = DOMAIN_META[n.domain]
    geo.push({
      id: n.id, orgId, name: n.name, domain: n.domain,
      platform: meta.platform, accent: meta.accent, health: geoHealth(n),
      lat: Number(n.lat), lng: Number(n.lng),
      metricLabel: 'Status', metricValue: n.alarm ?? (n.online === 0 ? 'Offline' : 'Online'),
      updated: n.last_seen ?? '—',
    })
  }
  return geo.length ? geo : null
}
