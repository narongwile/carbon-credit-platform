'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import type { SensorDomain } from '@/types/fleet'

export interface OrgAlarmRow {
  id: string
  nodeId: string
  nodeName: string
  domain: SensorDomain
  paramLabel: string
  severity: 'WARNING' | 'CRITICAL'
  value: number
  threshold: number
  unit: string
  raisedAt: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  eventProblemId: string | null
  clearedAt: string | null
}

/**
 * Every alarm across the org — GET /api/orgs/:orgId/alarms, already
 * department- and domain-scoped server-side for a non-admin caller. Replaces
 * useAppStore().alarms (the sidebar badge, admin Alarms and a viewer's
 * Overview notifications all used to read that store directly): it is seeded
 * ONCE from mockData.ts at store creation and nothing ever refreshes it from
 * a real endpoint, so a real CRITICAL alarm on a real device never appeared
 * anywhere that read it, in Live mode or not.
 *
 * open=true narrows to unacknowledged + uncleared (the badge/notifications
 * use case); omit for the full history (the Alarms page's own filters narrow
 * further client-side). Empty array in demo mode or before the first load —
 * callers that also work offline should keep their own mock fallback.
 */
export function useOrgAlarms(orgId: string, opts?: { open?: boolean; pollMs?: number }): {
  alarms: OrgAlarmRow[]
  loaded: boolean
  refetch: () => void
} {
  const [alarms, setAlarms] = useState<OrgAlarmRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const open = opts?.open
  const pollMs = opts?.pollMs

  const load = useCallback(() => {
    if (!isLive() || !orgId) { setAlarms([]); setLoaded(true); return }
    api.orgAlarms(orgId, open).then((rows) => {
      setAlarms((rows ?? []).map((r) => ({
        id: r.id, nodeId: r.node_id, nodeName: r.node_name, domain: r.domain,
        paramLabel: r.param_label, severity: r.severity, value: Number(r.value), threshold: Number(r.threshold),
        unit: r.unit ?? '', raisedAt: r.raised_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
        eventProblemId: r.event_problem_id, clearedAt: r.cleared_at,
      })))
      setLoaded(true)
    })
  }, [orgId, open])

  useEffect(() => {
    load()
    if (!isLive()) return
    if (pollMs) {
      const t = setInterval(load, pollMs)
      return () => clearInterval(t)
    }
  }, [load, pollMs])

  // Instant refetch when a WebSocket alarm event arrives
  useEffect(() => {
    if (!isLive() || !orgId) return
    const unsubscribe = subscribeTelemetry((f) => {
      if (f?.type === 'alarm') {
        load()
      }
    })
    return () => unsubscribe()
  }, [load, orgId])

  return { alarms, loaded, refetch: load }
}
