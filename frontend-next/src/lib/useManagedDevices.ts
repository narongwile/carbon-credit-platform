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

// api.fleet() resolves to null on ANY failure — a genuinely empty roster and a
// dropped request are indistinguishable to the caller (req() in api.ts never
// rejects: a non-2xx or a network error both become `null`). Without a retry,
// one transient blip (a cold pod, a momentary DB hiccup) permanently fell back
// to the seed roster for that hook instance's whole lifetime — a REAL device
// (say, a transformer clicked from a list that had just shown it fine) would
// read "not found" on the very next page, because the fresh fetch on that page
// failed once and nothing ever tried again. Three attempts with backoff is
// enough to ride out a blip without turning a real, sustained outage into an
// infinite retry loop.
async function fetchFleetWithRetry(orgId: string, domain?: string): Promise<FleetNode[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await api.fleet(orgId, domain)
    if (rows) return rows
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  return null
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
  const coordStr = (n.lat != null && n.lng != null) ? `${Number(n.lat).toFixed(4)}, ${Number(n.lng).toFixed(4)}` : undefined
  const loc = siteName ?? (n.site_id && n.site_id !== '—' ? n.site_id : undefined) ?? coordStr ?? (mock?.location && mock.location !== '—' ? mock.location : undefined) ?? '—'
  return {
    id: n.id,
    orgId,
    name: n.name || mock?.name || n.id,
    serial: mock?.serial ?? n.id.toUpperCase(),
    deviceType: DEVICE_TYPE[domain] ?? mock?.deviceType ?? 'Sensor Node',
    domain,
    siteId: n.site_id ?? mock?.siteId,
    location: loc,
    theme: mock?.theme ?? 'fix',
    departmentIds: n.department_id ? [n.department_id] : (mock?.departmentIds ?? []),
    status: n.online === 0 ? 'offline' : 'online',
    picture: mock?.picture,
    lastValue: mock?.lastValue,
    // Real, admin-set (migrate-v45) — no mock fallback: an unset value means
    // "no Grafana dashboard configured", not "show fabricated demo charts".
    grafanaUrl: n.grafana_url ?? null,
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
  // Real sites (migrate-v21). The name used to be looked up in the frontend seed
  // list, which is the same four hardcoded places for every tenant — so a
  // customer's own site rendered as its raw id ("site-1754…") in the header of
  // every device page.
  const [siteRows, setSiteRows] = useState<{ id: string; name: string }[] | null>(null)

  useEffect(() => {
    if (!live || !orgId) { setNodes(null); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    fetchFleetWithRetry(orgId, domain)
      .then((rows) => { if (!cancelled) { setNodes(rows); setLoaded(true) } })
    return () => { cancelled = true }
  }, [live, orgId, domain])

  useEffect(() => {
    if (!live || !orgId) { setSiteRows(null); return }
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSiteRows(r.sites ?? []) })
    return () => { cancelled = true }
  }, [live, orgId])

  return useMemo(() => {
    const mock = managedDevicesFromFleet(orgId)
    // No backend answer (demo, or an error): the seed fleet, as before.
    if (!nodes) return { devices: mock, loaded, fromBackend: false }
    // An empty array is a real answer — this org genuinely has no devices yet.
    const byId = new Map(mock.map((d) => [d.id, d]))
    // Seed names stay as the fallback for demo orgs whose sites are not rows.
    const siteName = new Map(getSitesByOrg(orgId).map((s) => [s.id, s.name] as [string, string]))
    for (const s of siteRows ?? []) siteName.set(s.id, s.name)
    const devices = nodes.map((n) =>
      fleetNodeToDevice(n, orgId, byId.get(n.id), n.site_id ? siteName.get(n.site_id) : undefined))
    return { devices, loaded, fromBackend: true }
  }, [nodes, orgId, loaded, siteRows])
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
  // Real nameplates (kVA/model/voltage), fetched once per org rather than once
  // per device — was hardcoding kva:0/voltage:'—'/model:'—' for every real
  // transformer with no seed match, because nothing else ever supplied a real
  // value. Takes priority over the seed's fabricated numbers too, when an
  // admin has actually entered one: real data wins over a demo placeholder.
  const [nameplates, setNameplates] = useState<Record<string, { model: string | null; ratedKva: number | null; voltageClass: string | null }>>({})

  useEffect(() => {
    if (!live || !orgId) { setNodes(null); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    fetchFleetWithRetry(orgId)
      .then((rows) => { if (!cancelled) { setNodes(rows); setLoaded(true) } })
    return () => { cancelled = true }
  }, [live, orgId])

  useEffect(() => {
    if (!live || !orgId) { setNameplates({}); return }
    let cancelled = false
    api.orgNameplates(orgId).then((r) => { if (!cancelled && r) setNameplates(r) })
    return () => { cancelled = true }
  }, [live, orgId])

  return useMemo(() => {
    const mock = getHostsByOrg(orgId)
    if (!nodes) return { hosts: mock, loaded, fromBackend: false }
    const byId = new Map(mock.map((h) => [h.id, h]))
    const hosts = nodes.map((n): SensorHost => {
      const seed = byId.get(n.id)
      const status = statusFromLive(n)
      const coordStr = (n.lat != null && n.lng != null) ? `${Number(n.lat).toFixed(4)}, ${Number(n.lng).toFixed(4)}` : undefined
      // n.sensor_count (device_presence.last_sample's key count) is the real
      // reading — preferred over the mock seed's fixed per-domain number even
      // when an id happens to collide with one, so a real device's page never
      // shows a made-up sensor count just because its id looks like a demo one.
      const computedHealth = status === 'CRITICAL' ? 50 : status === 'WARNING' ? 80 : status === 'NORMAL' ? 100 : (seed?.domain === 'transformer' ? seed.healthIndex : 0)
      if (seed) {
        if (seed.domain === 'transformer') {
          const np = nameplates[n.id]
          return {
            ...seed, status, name: n.name || seed.name, sensorCount: n.sensor_count ?? seed.sensorCount,
            healthIndex: computedHealth,
            model: np?.model || seed.model, kva: np?.ratedKva ?? seed.kva, voltage: np?.voltageClass || seed.voltage,
            lat: n.lat ?? seed.lat, lng: n.lng ?? seed.lng,
          }
        }
        return { ...seed, status, name: n.name || seed.name, sensorCount: n.sensor_count ?? seed.sensorCount, lat: n.lat ?? seed.lat, lng: n.lng ?? seed.lng }
      }
      const base = {
        id: n.id, orgId, siteId: n.site_id ?? '—', name: n.name || n.id, status, sensorCount: n.sensor_count ?? 0,
        lat: n.lat, lng: n.lng, location: coordStr ?? (n.site_id && n.site_id !== '—' ? n.site_id : '—'),
      }
      if (n.domain === 'transformer') {
        const np = nameplates[n.id]
        return {
          ...base, domain: 'transformer', model: np?.model || '—', serial: n.id.toUpperCase(),
          kva: np?.ratedKva ?? 0, voltage: np?.voltageClass || '—', healthIndex: computedHealth, openAlarms: n.alarm ? 1 : 0,
        }
      }
      if (n.domain === 'carbonNode') {
        return { ...base, domain: 'carbonNode', cabinetZone: '—', targetMinC: 2, targetMaxC: 8, refrigerantType: '—', co2eSavedKg: 0, creditsIssued: 0 }
      }
      return { ...base, domain: 'bloodBox', boxCode: n.id.toUpperCase(), setLowC: 2, setHighC: 6, floor: '—', excursions: 0, inTransit: false }
    })
    return { hosts, loaded, fromBackend: true }
  }, [nodes, orgId, loaded, nameplates])
}

/**
 * One device by id. `found` distinguishes "still loading" from "this id is not
 * in the fleet" — pages previously did `find(...) ?? devices[0]`, which silently
 * rendered a DIFFERENT device's name, serial and location for an unknown id.
 *
 * `verified` distinguishes WHICH of the two lists `found` matched: true only
 * when the hit came from `devices` — the org-scoped, access-controlled result
 * of useManagedDevices(orgId) (real /api/fleet in Live mode, already filtered
 * server-side to what the caller may see). false when it came from the
 * allManagedDevices() fallback below, which is the static cross-ORG seed list
 * with no access control at all — kept for the admin twin (a superadmin
 * legitimately opens devices outside their selected org), but NOT proof that
 * the CALLER may see this device. A consumer that gates real content on
 * access (the customer portal's device-detail page) must check `verified`,
 * not just `found` — `found` alone was true for a mock cross-org id
 * regardless of who was asking, which combined with a `live ? true : ...`
 * shortcut elsewhere read as "the fetch is real, so access must be real too."
 */
export function useManagedDevice(orgId: string, id: string): {
  device: ManagedDevice | null
  loaded: boolean
  found: boolean
  verified: boolean
} {
  const { devices, loaded, fromBackend } = useManagedDevices(orgId)
  return useMemo(() => {
    const hit = devices.find((d) => d.id === id)
    if (hit) return { device: hit, loaded, found: true, verified: fromBackend }
    // Not in this org's roster. It may still be a real device in ANOTHER org — a
    // superadmin can open any node — so fall back to the full seed list before
    // declaring it missing, and only once the roster has actually arrived
    // (otherwise the page flashes "not found" on every load). This branch is
    // never verified: it is static seed data, not an access-checked fetch.
    const anyMock = allManagedDevices().find((d) => d.id === id)
    return { device: anyMock ?? null, loaded, found: !!anyMock, verified: false }
  }, [devices, id, loaded, fromBackend])
}
