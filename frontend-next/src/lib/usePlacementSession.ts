'use client'

// ---------------------------------------------------------------------------
// Setting a device's coordinate by clicking the map — one at a time, or many.
// ---------------------------------------------------------------------------
// ETERNITY has no Floor Plans feature (that workflow is for an indoor image
// with geo-referenced corners, which is the wrong tool for real GPS sites),
// and until now the ONLY way a device got a lat/lng was that workflow, or an
// admin re-uploading a photo hoping its EXIF happened to carry GPS. This is
// the missing direct path: click a device (or several), click the map.
//
// Two modes, because both are real needs:
//   sequential  — walk a list one device at a time. Precise: each device gets
//                 its own click, its own exact point. What field placement of
//                 a substation full of distinct units actually looks like.
//   same-point  — one click, applied to every selected device at once. For a
//                 pole-mounted cluster or a first-pass "get them all roughly
//                 on the map" before refining the important ones individually.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useFleetLive, fleetToGeoNodes } from '@/lib/useFleetLive'
import { reverseGeocode } from '@/lib/geoAddress'
import type { SensorDomain } from '@/types/fleet'
import toast from 'react-hot-toast'

export type PlacementMode = 'sequential' | 'same-point'

export interface PlacementSession {
  mode: PlacementMode
  ids: string[]
  /** Index into ids of the device currently being placed (sequential only). */
  index: number
}

export interface PendingPlacement {
  lat: number
  lng: number
  address: string | null
  loadingAddress: boolean
  devices: { id: string; name: string; domain: SensorDomain }[]
}

export function usePlacementSession(orgId: string) {
  const { byId, loaded, reload } = useFleetLive(orgId)
  const [session, setSession] = useState<PlacementSession | null>(null)
  const [pending, setPending] = useState<PendingPlacement | null>(null)
  const [busy, setBusy] = useState(false)

  const devices = useMemo(
    () => Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [byId])

  const nodes = useMemo(() => fleetToGeoNodes(byId, orgId), [byId, orgId])

  const unplaced = useMemo(() => devices.filter((d) => d.lat == null || d.lng == null || d.approx === 1), [devices])

  const start = useCallback((ids: string[], mode: PlacementMode) => {
    if (!ids.length) return
    setSession({ mode, ids, index: 0 })
    setPending(null)
  }, [])

  const stop = useCallback(() => {
    setSession(null)
    setPending(null)
  }, [])

  const current = session ? byId.get(session.ids[session.index]) : null

  // Triggered when user clicks the map or enters coordinates: Previews the location info first
  const pick = useCallback(async (lat: number, lng: number) => {
    if (!session || busy) return

    const targetDevices = session.mode === 'same-point'
      ? session.ids.map((id) => {
          const d = byId.get(id)
          return { id, name: d?.name ?? id, domain: d?.domain ?? ('transformer' as SensorDomain) }
        })
      : (() => {
          const id = session.ids[session.index]
          const d = byId.get(id)
          return [{ id, name: d?.name ?? id, domain: d?.domain ?? ('transformer' as SensorDomain) }]
        })()

    setPending({
      lat,
      lng,
      address: null,
      loadingAddress: true,
      devices: targetDevices,
    })

    const addr = await reverseGeocode(lat, lng)
    setPending((p) => (p && p.lat === lat && p.lng === lng ? { ...p, address: addr, loadingAddress: false } : p))
  }, [session, busy, byId])

  // Cancel pending preview without saving
  const cancelPending = useCallback(() => {
    setPending(null)
  }, [])

  // Confirm and execute the actual placement save
  const confirmPending = useCallback(async () => {
    if (!session || !pending || busy) return
    const { lat, lng } = pending
    setBusy(true)
    try {
      if (session.mode === 'same-point') {
        const results = await Promise.all(session.ids.map((id) => api.setNodeLocation(id, { lat, lng })))
        const ok = results.filter((r) => r?.ok).length
        const failed = session.ids.length - ok
        if (ok) toast.success(`${ok} device${ok === 1 ? '' : 's'} placed at ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        if (failed) toast.error(`${failed} could not be saved`)
        reload()
        setPending(null)
        setSession(null)
        return
      }
      // sequential
      const id = session.ids[session.index]
      const r = await api.setNodeLocation(id, { lat, lng })
      const name = byId.get(id)?.name ?? id
      if (!r?.ok) { toast.error(`Could not save the position for ${name}`); return }
      reload()
      setPending(null)
      const next = session.index + 1
      if (next >= session.ids.length) {
        toast.success(`${session.ids.length} device${session.ids.length === 1 ? '' : 's'} placed successfully`)
        setSession(null)
      } else {
        toast.success(`${name} placed — next: ${byId.get(session.ids[next])?.name ?? session.ids[next]}`)
        setSession({ ...session, index: next })
      }
    } finally {
      setBusy(false)
    }
  }, [session, pending, busy, byId, reload])

  /** Move past the current device in a sequential walk without placing it. */
  const skip = useCallback(() => {
    if (!session || session.mode !== 'sequential') return
    setPending(null)
    const next = session.index + 1
    if (next >= session.ids.length) setSession(null)
    else setSession({ ...session, index: next })
  }, [session])

  return {
    devices, unplaced, nodes, loaded,
    session, current, busy, pending,
    start, stop, pick, skip, reload,
    confirmPending, cancelPending,
  }
}
