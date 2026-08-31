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
 * use case); omit for the full history. Empty array in demo mode or before
 * the first load — callers that also work offline should keep their own mock
 * fallback.
 *
 * fromMs/toMs push the Alarms console's time range into the QUERY. They are
 * part of `load`'s identity, so picking a different range refetches rather
 * than re-filtering: the server returns at most `limit` rows ordered newest
 * first, so a range narrowed client-side could only ever show a subset of the
 * newest page, never the older events that the range actually covers. Pass
 * undefined (not 0/Infinity) for an open-ended bound.
 */
export function useOrgAlarms(
  orgId: string,
  opts?: {
    open?: boolean; pollMs?: number; fromMs?: number; toMs?: number; limit?: number
    severity?: 'WARNING' | 'CRITICAL'; unacked?: boolean
  },
): {
  alarms: OrgAlarmRow[]
  loaded: boolean
  refetch: () => void
} {
  const [alarms, setAlarms] = useState<OrgAlarmRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const open = opts?.open
  const pollMs = opts?.pollMs
  const fromMs = opts?.fromMs
  const toMs = opts?.toMs
  const limit = opts?.limit
  const severity = opts?.severity
  const unacked = opts?.unacked

  const load = useCallback(() => {
    if (!isLive() || !orgId) { setAlarms([]); setLoaded(true); return }
    api.orgAlarms(orgId, { open, fromMs, toMs, limit, severity, unacked }).then((rows) => {
      setAlarms((rows ?? []).map((r) => ({
        id: r.id, nodeId: r.node_id, nodeName: r.node_name, domain: r.domain,
        paramLabel: r.param_label, severity: r.severity, value: Number(r.value), threshold: Number(r.threshold),
        unit: r.unit ?? '', raisedAt: r.raised_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
        eventProblemId: r.event_problem_id, clearedAt: r.cleared_at,
      })))
      setLoaded(true)
    })
  }, [orgId, open, fromMs, toMs, limit, severity, unacked])

  useEffect(() => {
    load()
    if (!isLive()) return
    if (pollMs) {
      const t = setInterval(load, pollMs)
      return () => clearInterval(t)
    }
  }, [load, pollMs])

  // Refetch when a WebSocket alarm frame arrives, COALESCED.
  //
  // Refetching once per frame is fine for a single alarm and pathological for
  // the case that matters: a substation tripping raises alarms on many devices
  // and many parameters within the same second, and one full org-wide
  // /alarms query per frame turns the worst moment for the operator into the
  // worst moment for the API too. A short trailing window collapses that burst
  // into a single fetch, which is all the UI needed anyway — the list is
  // re-read whole, so N fetches and 1 fetch produce the same screen.
  useEffect(() => {
    if (!isLive() || !orgId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeTelemetry((f) => {
      if (f?.type !== 'alarm') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; load() }, 400)
    })
    return () => { if (timer) clearTimeout(timer); unsubscribe() }
  }, [load, orgId])

  return { alarms, loaded, refetch: load }
}
