'use client'

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import type { SensorDomain } from '@/types/fleet'

export interface MyAccess {
  orgId: string
  role: string
  departmentIds: string[]
  levels: Partial<Record<SensorDomain, 'none' | 'view' | 'manage'>>
}

/**
 * The SIGNED-IN user's real org, department(s) and per-domain access level —
 * GET /api/me/access, which delegates server-side to accessFor(), the SAME
 * helper /api/fleet's own visibility filter trusts. null while loading or in
 * demo/offline mode; callers fall back to the mock viewer.ts "acting viewer"
 * picker in that case, same as every other real-data hook in this app
 * (useManagedDevices, useFleetHosts, useOrgAlarms, ...).
 *
 * Replaces viewerUserId + getViewerUser()/viewerCanAccess() from viewer.ts,
 * which never reflected the real signed-in session — viewerUserId defaults
 * to a demo persona id ('u-cc') that a real login never sets, so every one
 * of those calls silently resolved to "no access" for a real viewer.
 */
export function useMyAccess(): MyAccess | null {
  const [acc, setAcc] = useState<MyAccess | null>(null)
  useEffect(() => {
    if (!isLive()) { setAcc(null); return }
    let cancelled = false
    api.myAccess().then((r) => {
      if (cancelled || !r) return
      setAcc({ orgId: r.orgId, role: r.role, departmentIds: r.departmentIds, levels: r.levels })
    })
    return () => { cancelled = true }
  }, [])
  return acc
}

/** acc.levels omits a domain entirely rather than sending 'none' for it. */
export const levelOf = (acc: MyAccess | null, domain: SensorDomain): 'none' | 'view' | 'manage' =>
  (acc?.levels[domain]) ?? 'none'
