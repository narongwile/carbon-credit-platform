'use client'

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'

/**
 * Whether a device with no uploaded photo yet should fall back to the
 * generic 3D model (migrate-v33) — false only once a superadmin has
 * explicitly turned it off for this org. Defaults to true while unknown
 * (still loading, demo mode, or the org isn't in the response) so a slow
 * fetch never flashes the 3D model off and back on.
 */
export function useShow3dFallback(orgId: string): boolean {
  const [show, setShow] = useState(true)
  useEffect(() => {
    if (!isLive() || !orgId) { setShow(true); return }
    let cancelled = false
    api.orgs().then((rows) => {
      if (cancelled || !rows) return
      const row = rows.find((o) => o.id === orgId)
      if (row) setShow(row.show_3d_fallback !== 0)
    })
    return () => { cancelled = true }
  }, [orgId])
  return show
}
