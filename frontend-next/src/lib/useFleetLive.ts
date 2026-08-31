'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useIsLive, type FleetNode } from './api'
import { subscribeTelemetry, type TelemetryFrame } from './telemetryBus'
import { DOMAIN_META } from '@/types/fleet'
import type { GeoNode } from './geoNodes'

export type EffectiveStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'

export function statusFromLive(n: FleetNode): EffectiveStatus {
  if (!n || n.online === 0 || (n.online as any) === '0' || (n as any).status === 'OFFLINE' || (n as any).status === 'offline') return 'OFFLINE'
  if (n.alarm === 'CRITICAL') return 'CRITICAL'
  if (n.alarm === 'WARNING') return 'WARNING'
  return 'NORMAL'
}

/** How often the fleet re-fetches — the map's background poll (5s). */
const POLL_MS = 5_000

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

  // Periodic poll to catch new devices, rule/presence changes from DB
  useEffect(() => {
    load()
    if (!apiEnabled || !orgId) return
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load, apiEnabled, orgId])

  // Sub-second real-time telemetry overlay via WebSocket
  useEffect(() => {
    if (!apiEnabled) return
    const unsubscribe = subscribeTelemetry((f: TelemetryFrame) => {
      if (!f?.id) return
      setById((prev) => {
        const existing = prev.get(f.id)
        if (!existing) return prev
        const updated: FleetNode = { ...existing }
        // Receiving telemetry proves the device is online
        updated.online = 1
        if (f.timestamp) updated.last_seen = f.timestamp
        if (f.type === 'alarm') {
          if (f.severity === 'CRITICAL') updated.alarm = 'CRITICAL'
          else if (f.severity === 'WARNING') updated.alarm = 'WARNING'
          else if (f.severity === 'NORMAL') updated.alarm = null
        }
        const next = new Map(prev)
        next.set(f.id, updated)
        return next
      })
    })
    return () => unsubscribe()
  }, [apiEnabled])

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
    if (n.org_id && n.org_id !== orgId) continue
    const meta = DOMAIN_META[n.domain]
    geo.push({
      id: n.id, orgId, name: n.name, domain: n.domain,
      platform: meta.platform, accent: meta.accent, health: geoHealth(n),
      lat: Number(n.lat), lng: Number(n.lng), approx: n.approx === 1,
      metricLabel: 'Status', metricValue: n.alarm ?? (n.online === 0 ? 'Offline' : 'Online'),
      updated: n.last_seen ?? '—',
      // Everything the fleet row already carries, passed through rather than
      // discarded — the map popup is the one place an operator looks at a
      // device without first knowing which device they want, so identity,
      // presence and link quality belong there.
      deviceId: n.id,
      online: n.online, lastSeen: n.last_seen, rssi: n.rssi, fw: n.fw,
      sensorCount: n.sensor_count, alarm: n.alarm, siteId: n.site_id,
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
