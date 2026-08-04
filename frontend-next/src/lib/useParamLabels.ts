'use client'

// ---------------------------------------------------------------------------
// What a parameter is CALLED on screen.
// ---------------------------------------------------------------------------
// Three sources, most specific first:
//   1. the admin's custom name for this device        (param_labels, node row)
//   2. the admin's custom name for the whole product  (param_labels, org row)
//   3. the built-in schema label                      (ALARM_SCHEMA)
//   4. the raw MQTT wire key
//
// (1) and (2) are merged server-side into one map — see GET
// /api/orgs/:orgId/param-labels — so a caller only has to fall through to the
// schema and then the key. The wire key is never renamed anywhere: it stays
// the join key for readings, alarms, display_params and the rule engine, and
// this only decides the text a human reads.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'

/** Built-in name for a key, with the raw key as the last resort. */
export function schemaLabel(domain: SensorDomain | undefined, key: string): string {
  if (!domain) return key
  return ALARM_SCHEMA[domain]?.params.find((p) => p.key === key)?.label ?? key
}

export function useParamLabels(orgId: string, domain: SensorDomain | undefined, nodeId?: string): {
  /** Resolved custom names (org default + this device's overrides). */
  labels: Record<string, string>
  /** Only the rows at this exact scope — an editor needs the distinction. */
  own: Record<string, string>
  /** custom -> schema -> raw key. Safe to call before the fetch resolves. */
  labelOf: (key: string) => string
  refetch: () => void
} {
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [own, setOwn] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    if (!isLive() || !orgId || !domain) { setLabels({}); setOwn({}); return }
    let cancelled = false
    api.paramLabels(orgId, domain, nodeId).then((r) => {
      if (cancelled || !r) return
      setLabels(r.labels ?? {})
      setOwn(r.own ?? {})
    })
    return () => { cancelled = true }
  }, [orgId, domain, nodeId])

  useEffect(() => load(), [load])

  const labelOf = useCallback(
    (key: string) => labels[key] || schemaLabel(domain, key),
    [labels, domain],
  )

  return { labels, own, labelOf, refetch: load }
}
