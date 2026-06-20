// ---------------------------------------------------------------------------
// Geographic sensor nodes for the Live Sensor Map (all domains).
// Derived from fleet hosts; spread across Thai provinces for a realistic map.
// ---------------------------------------------------------------------------

import { hosts, sites } from '@/lib/fleetData'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'

export type NodeHealth = 'healthy' | 'warning' | 'critical'

export interface GeoNode {
  id: string
  orgId: string
  name: string
  domain: SensorDomain
  platform: string
  accent: string
  health: NodeHealth
  lat: number
  lng: number
  metricLabel: string
  metricValue: string
  updated: string
}

const CITIES: [number, number, string][] = [
  [13.7563, 100.5018, 'Bangkok'],
  [18.7883, 98.9853, 'Chiang Mai'],
  [16.4419, 102.836, 'Khon Kaen'],
  [13.3611, 100.9847, 'Chonburi'],
  [7.8804, 98.3923, 'Phuket'],
  [14.9799, 102.0978, 'Nakhon Ratchasima'],
]

const healthFor = (status: string): NodeHealth =>
  status === 'CRITICAL' ? 'critical' : status === 'WARNING' || status === 'OFFLINE' ? 'warning' : 'healthy'

export const healthColor: Record<NodeHealth, string> = {
  healthy: '#16a34a',
  warning: '#f59e0b',
  critical: '#ef4444',
}

function metric(h: (typeof hosts)[number]): { label: string; value: string } {
  if (h.domain === 'transformer') return { label: 'Oil Temp', value: '68.4°C' }
  if (h.domain === 'carbonNode') return { label: 'Temperature', value: `${h.targetMaxC}°C` }
  return { label: 'Temperature', value: '4.6°C' }
}

export function getGeoNodes(orgId?: string): GeoNode[] {
  const list = orgId ? hosts.filter((h) => h.orgId === orgId) : hosts
  return list.map((h, i) => {
    // Place each node at its real site coordinates (best-practice geo mapping),
    // falling back to a spread of Thai cities if a site has no coordinates.
    const site = sites.find((s) => s.id === h.siteId)
    const fallback = CITIES[i % CITIES.length]
    const baseLat = site?.lat ?? fallback[0]
    const baseLng = site?.lng ?? fallback[1]
    const label = site?.name ?? fallback[2]
    const jitter = (n: number) => (((i * 37 + n * 13) % 100) / 100 - 0.5) * 0.05
    const m = metric(h)
    return {
      id: h.id,
      orgId: h.orgId,
      name: `${h.name} · ${label}`,
      domain: h.domain,
      platform: DOMAIN_META[h.domain].platform,
      accent: DOMAIN_META[h.domain].accent,
      health: healthFor(h.status),
      lat: baseLat + jitter(1),
      lng: baseLng + jitter(2),
      metricLabel: m.label,
      metricValue: m.value,
      updated: `${(i % 9) + 1} mins ago`,
    }
  })
}
