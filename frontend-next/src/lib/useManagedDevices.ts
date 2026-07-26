'use client'

// ---------------------------------------------------------------------------
// The device roster — one source for every page that lists or opens a device.
// ---------------------------------------------------------------------------
// Pages used to build their roster from the hardcoded fleet in fleetData.ts and
// then overlay live status on top. That meant a device auto-registered by its
// first telemetry frame never appeared anywhere in the UI, and a mock device
// that does not exist stayed on the dashboard forever with an "offline" chip.
//
// In Live mode the roster IS the backend's node table (GET /api/fleet); the
// mock entry for the same id, when there is one, only contributes cosmetics the
// API does not carry (serial, dashboard theme, site label, picture). In Demo
// mode — or when the fetch fails — the mock list is used unchanged, so the app
// still demonstrates without a backend.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type FleetNode } from './api'
import { allManagedDevices, managedDevicesFromFleet, getSitesByOrg, getHostsByOrg } from './fleetData'
import { statusFromLive } from './useFleetLive'
import type { SensorHost } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'

const DEVICE_TYPE: Record<NonNullable<ManagedDevice['domain']>, string> = {
  transformer: 'Power Transformer',
  carbonNode: 'Refrigeration Logger',
  bloodBox: 'BloodBOX Cold Storage',
}

/**
 * Project a backend node onto the shape the device pages consume. `mock` is the
 * seed entry for the same id when one exists — the backend has no serial,
 * dashboard theme or picture, so those come from the seed rather than being
 * invented. Everything the backend does know (name, domain, department,
 * online) wins, because that is the record of what is actually deployed.
 */
export function fleetNodeToDevice(
  n: FleetNode,
  orgId: string,
  mock?: ManagedDevice,
  siteName?: string,
): ManagedDevice {
  const domain = n.domain
  return {
    id: n.id,
    orgId,
    name: n.name || mock?.name || n.id,
    serial: mock?.serial ?? n.id.toUpperCase(),
    deviceType: DEVICE_TYPE[domain] ?? mock?.deviceType ?? 'Sensor Node',
    domain,
    siteId: n.site_id ?? mock?.siteId,
    location: siteName ?? mock?.location ?? n.site_id ?? '—',
    theme: mock?.theme ?? 'fix',
    departmentIds: n.department_id ? [n.department_id] : (mock?.departmentIds ?? []),
    status: n.online === 0 ? 'offline' : 'online',
    picture: mock?.picture,
    lastValue: mock?.lastValue,
  }
}

interface Roster {
  devices: ManagedDevice[]
  /** True once the source below has produced its answer (mock is immediate). */
  loaded: boolean
  /** True when the list came from the backend rather than the seed fleet. */
  fromBackend: boolean
}

/** Roster for one organization, optionally narrowed to a product domain. */
export function useManagedDevices(orgId: string, domain?: string): Roster {
  const live = useIsLive()
  const [nodes, setNodes] = useState<FleetNode[] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!live || !orgId) { setNodes(null); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    api.fleet(orgId, domain)
      .then((rows) => { if (!cancelled) { setNodes(rows ?? null); setLoaded(true) } })
      .catch(() => { if (!cancelled) { setNodes(null); setLoaded(true) } })
    return () => { cancelled = true }
  }, [live, orgId, domain])

  return useMemo(() => {
    const mock = managedDevicesFromFleet(orgId)
    // No backend answer (demo, or an error): the seed fleet, as before.
    if (!nodes) return { devices: mock, loaded, fromBackend: false }
    // An empty array is a real answer — this org genuinely has no devices yet.
    const byId = new Map(mock.map((d) => [d.id, d]))
    const siteName = new Map(getSitesByOrg(orgId).map((s) => [s.id, s.name]))
    const devices = nodes.map((n) =>
      fleetNodeToDevice(n, orgId, byId.get(n.id), n.site_id ? siteName.get(n.site_id) : undefined))
    return { devices, loaded, fromBackend: true }
  }, [nodes, orgId, loaded])
}

/**
 * The same roster in SensorHost shape, for the dashboards and maps that key off
 * product-specific fields (kVA, cabinet zone, box code). The backend node table
 * carries none of those, so a device it knows about but the seed does not gets
 * neutral placeholders — better than omitting a real, deployed device from the
 * overview entirely, which is what listing only the seed fleet did.
 */
export function useFleetHosts(orgId: string): { hosts: SensorHost[]; loaded: boolean; fromBackend: boolean } {
  const live = useIsLive()
  const [nodes, setNodes] = useState<FleetNode[] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!live || !orgId) { setNodes(null); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    api.fleet(orgId)
      .then((rows) => { if (!cancelled) { setNodes(rows ?? null); setLoaded(true) } })
      .catch(() => { if (!cancelled) { setNodes(null); setLoaded(true) } })
    return () => { cancelled = true }
  }, [live, orgId])

  return useMemo(() => {
    const mock = getHostsByOrg(orgId)
    if (!nodes) return { hosts: mock, loaded, fromBackend: false }
    const byId = new Map(mock.map((h) => [h.id, h]))
    const hosts = nodes.map((n): SensorHost => {
      const seed = byId.get(n.id)
      const status = statusFromLive(n)
      if (seed) return { ...seed, status, name: n.name || seed.name }
      const base = {
        id: n.id, orgId, siteId: n.site_id ?? '—', name: n.name || n.id, status, sensorCount: 0,
      }
      if (n.domain === 'transformer') {
        return { ...base, domain: 'transformer', model: '—', serial: n.id.toUpperCase(), kva: 0, voltage: '—', healthIndex: 0, openAlarms: 0 }
      }
      if (n.domain === 'carbonNode') {
        return { ...base, domain: 'carbonNode', cabinetZone: '—', targetMinC: 2, targetMaxC: 8, refrigerantType: '—', co2eSavedKg: 0, creditsIssued: 0 }
      }
      return { ...base, domain: 'bloodBox', boxCode: n.id.toUpperCase(), setLowC: 2, setHighC: 6, floor: '—', excursions: 0, inTransit: false }
    })
    return { hosts, loaded, fromBackend: true }
  }, [nodes, orgId, loaded])
}

/**
 * One device by id. `found` distinguishes "still loading" from "this id is not
 * in the fleet" — pages previously did `find(...) ?? devices[0]`, which silently
 * rendered a DIFFERENT device's name, serial and location for an unknown id.
 */
export function useManagedDevice(orgId: string, id: string): {
  device: ManagedDevice | null
  loaded: boolean
  found: boolean
} {
  const { devices, loaded } = useManagedDevices(orgId)
  return useMemo(() => {
    const hit = devices.find((d) => d.id === id)
    if (hit) return { device: hit, loaded, found: true }
    // Not in this org's roster. It may still be a real device in ANOTHER org — a
    // superadmin can open any node — so fall back to the full seed list before
    // declaring it missing, and only once the roster has actually arrived
    // (otherwise the page flashes "not found" on every load).
    const anyMock = allManagedDevices().find((d) => d.id === id)
    return { device: anyMock ?? null, loaded, found: !!anyMock }
  }, [devices, id, loaded])
}
