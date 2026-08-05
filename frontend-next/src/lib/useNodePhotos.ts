'use client'

// ---------------------------------------------------------------------------
// The photo set for one device.
// ---------------------------------------------------------------------------
// Metadata only. Nothing here ever holds image bytes: each <img> fetches its
// own URL from api.nodePhotoUrl() and the browser caches it independently, so a
// gallery of twelve photos costs one JSON request plus whatever the user
// actually looks at — not twelve base64 blobs in a React state object.
//
// Mutations refetch rather than patch local state. The list is small, the
// server owns `position` (append is MAX+1, reorder rewrites the block), and a
// hand-maintained local copy would drift from it the first time two admins
// uploaded at once.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { api, useIsLive, type NodePhoto, type NodePhotoKind, type PhotoAnnotation } from '@/lib/api'

export type { NodePhoto, NodePhotoKind, PhotoAnnotation }

export interface NodePhotosState {
  photos: NodePhoto[]
  /** The lowest-position photo: what the dashboard, the tables and the map show. */
  cover: NodePhoto | null
  loading: boolean
  /** Set when the table is missing — the UI says which migration, instead of failing silently. */
  pending: string | null
  reload: () => void
}

export function useNodePhotos(nodeId: string | null | undefined): NodePhotosState {
  const live = useIsLive()
  const [photos, setPhotos] = useState<NodePhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!live || !nodeId) { setPhotos([]); setPending(null); return }
    let cancelled = false
    setLoading(true)
    api.nodePhotos(nodeId)
      .then((r) => {
        if (cancelled) return
        setPhotos(r?.photos ?? [])
        setPending(r?.pending ?? null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Cancel on device change: a slow response for the previous device must not
    // land on this one's gallery.
    return () => { cancelled = true }
  }, [live, nodeId, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { photos, cover: photos[0] ?? null, loading, pending, reload }
}

/**
 * Cover photo per device for a whole org, for list surfaces (Fleet, Device
 * Management, the map). One request for the page instead of one per row.
 */
export function useOrgPhotoCovers(orgId: string | null | undefined) {
  const live = useIsLive()
  const [covers, setCovers] = useState<Record<string, { photoId: string; v: string }>>({})

  useEffect(() => {
    if (!live || !orgId) { setCovers({}); return }
    let cancelled = false
    api.orgPhotoCovers(orgId).then((r) => { if (!cancelled) setCovers(r ?? {}) })
    return () => { cancelled = true }
  }, [live, orgId])

  return covers
}
