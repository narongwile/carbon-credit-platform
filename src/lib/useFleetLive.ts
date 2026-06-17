'use client'
// ---------------------------------------------------------------------------
// Live fleet overlay. Fetches GET /api/fleet (+ optional per-node latest) from
// the backend and exposes it by node id. When NEXT_PUBLIC_API_URL is unset the
// hook is a no-op (empty map) so callers transparently fall back to mock data.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react'
import { api, apiEnabled, type FleetNode } from './api'

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
