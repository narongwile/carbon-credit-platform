'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'

export interface Nameplate {
  has: boolean
  manufacturer?: string | null
  model?: string | null
  serialNumber?: string | null
  ratedKva?: number | null
  voltageClass?: string | null
  coolingType?: string | null
  yearInstalled?: number | null
  updatedBy?: string | null
  updatedAt?: string
  pending?: string
}

/**
 * A device's real nameplate — kVA, voltage class, manufacturer, serial number.
 * Same shape as the device-photo fetch: a meta-only GET, no bytes, so both
 * Asset Info panels (FixDashboard, TransformerDetailView) can read it cheaply.
 */
export function useNodeNameplate(nodeId: string): { data: Nameplate | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<Nameplate | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (!isLive() || !nodeId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    api.nodeNameplate(nodeId).then((r) => { if (!cancelled) setData(r ?? { has: false }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId])

  useEffect(() => load(), [load])

  return { data, loading, refetch: load }
}
