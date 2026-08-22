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

/**
 * The band suffix on a dual-band alarm label: "Frequency — Over" splits into
 * the measured quantity ("Frequency") and the band ("Over"). A plain hyphen is
 * NOT this separator — quantity names legitimately contain them ("Phase A-N",
 * "Line-Neutral") — so this is the em-dash U+2014 with spaces around it, which
 * appears nowhere else in a label.
 */
const BAND_SEPARATOR = ' — '

/** Built-in name for a key, with the raw key as the last resort.
 *
 * One telemetry key can carry TWO alarm rows — a phase voltage alarms both
 * over and under, a frequency both high and low — differing only in
 * `direction`. That is a property of the alarm RULES, not of the sensor: the
 * meter reports one number either way.
 *
 * This used to be a bare `.find()`, which returned whichever row was declared
 * first and dragged its band suffix along with it. Every caller of this
 * function wants the name of the measured value, not one of its alarm bands —
 * the readings picker, the payload cross-check, the catalog editor, the org
 * payload spec, and the pending-device approval screen all render it as "what
 * is this reading called" — so a device publishing `Hz` was labelled
 * "Frequency — Over" in all five, as if the sensor itself were an over-limit.
 * (The genuinely band-specific labels are read straight off the catalog by
 * AlarmParamConfig, which deliberately bypasses this function; see the comment
 * on its `allParams` memo.)
 *
 * So: one row → its label unchanged. Several rows → the quantity name they
 * share, with the band suffix dropped. If they somehow disagree on the prefix,
 * fall back to the first row rather than inventing a name.
 */
export function schemaLabel(domain: SensorDomain | undefined, key: string): string {
  if (!domain) return key
  const rows = ALARM_SCHEMA[domain]?.params.filter((p) => p.key === key) ?? []
  if (rows.length === 0) return key
  if (rows.length === 1) return rows[0].label
  const quantityOf = (label: string) => {
    // lastIndexOf, not indexOf: the band is always the final segment, so this
    // strips exactly one suffix even if a name ever contains an em-dash.
    const i = label.lastIndexOf(BAND_SEPARATOR)
    return i > 0 ? label.slice(0, i) : label
  }
  const quantities = rows.map((p) => quantityOf(p.label))
  return quantities.every((q) => q === quantities[0]) ? quantities[0] : rows[0].label
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
