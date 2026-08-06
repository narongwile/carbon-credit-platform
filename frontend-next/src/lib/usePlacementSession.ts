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
import toast from 'react-hot-toast'

export type PlacementMode = 'sequential' | 'same-point'

export interface PlacementSession {
  mode: PlacementMode
  ids: string[]
  /** Index into ids of the device currently being placed (sequential only). */
  index: number
}

export function usePlacementSession(orgId: string) {
  const { byId, loaded, reload } = useFleetLive(orgId)
  const [session, setSession] = useState<PlacementSession | null>(null)
  const [busy, setBusy] = useState(false)

  const devices = useMemo(
    () => Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [byId])

  const nodes = useMemo(() => fleetToGeoNodes(byId, orgId), [byId, orgId])

  const unplaced = useMemo(() => devices.filter((d) => d.lat == null || d.lng == null || d.approx === 1), [devices])

  const start = useCallback((ids: string[], mode: PlacementMode) => {
    if (!ids.length) return
    setSession({ mode, ids, index: 0 })
  }, [])

  const stop = useCallback(() => setSession(null), [])

  const current = session ? byId.get(session.ids[session.index]) : null

  const pick = useCallback(async (lat: number, lng: number) => {
    if (!session || busy) return
    setBusy(true)
    try {
      if (session.mode === 'same-point') {
        const results = await Promise.all(session.ids.map((id) => api.setNodeLocation(id, { lat, lng })))
        const ok = results.filter((r) => r?.ok).length
        const failed = session.ids.length - ok
        if (ok) toast.success(`${ok} device${ok === 1 ? '' : 's'} placed at ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        if (failed) toast.error(`${failed} could not be saved`)
        reload()
        setSession(null)
        return
      }
      // sequential
      const id = session.ids[session.index]
      const r = await api.setNodeLocation(id, { lat, lng })
      const name = byId.get(id)?.name ?? id
      if (!r?.ok) { toast.error(`Could not save the position for ${name}`); return }
      reload()
      const next = session.index + 1
      if (next >= session.ids.length) {
        toast.success(`${session.ids.length} device${session.ids.length === 1 ? '' : 's'} placed`)
        setSession(null)
      } else {
        toast.success(`${name} placed — next: ${byId.get(session.ids[next])?.name ?? session.ids[next]}`)
        setSession({ ...session, index: next })
      }
    } finally {
      setBusy(false)
    }
  }, [session, busy, byId, reload])

  /** Move past the current device in a sequential walk without placing it. */
  const skip = useCallback(() => {
    if (!session || session.mode !== 'sequential') return
    const next = session.index + 1
    if (next >= session.ids.length) setSession(null)
    else setSession({ ...session, index: next })
  }, [session])

  return {
    devices, unplaced, nodes, loaded,
    session, current, busy,
    start, stop, pick, skip, reload,
  }
}
