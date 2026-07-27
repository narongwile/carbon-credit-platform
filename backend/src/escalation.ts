import { unacknowledgedCriticals, markEscalated, channelsFor } from './repo.js'
import { dispatch, type Channel } from './notify/index.js'
import type { AlarmEvent } from './engine.js'

// Periodically escalate CRITICAL events that stay unacknowledged too long.
export function startEscalation(): void {
  const mins = Number(process.env.ESCALATE_AFTER_MIN || 15)
  const tick = async () => {
    try {
      const rows = await unacknowledgedCriticals(mins)
      if (!rows.length) return
      for (const r of rows) {
        const ev: AlarmEvent = {
          id: r.id, nodeId: r.node_id, paramKey: r.param_key, paramLabel: r.param_label,
          severity: 'CRITICAL', kind: r.kind, value: Number(r.value), threshold: Number(r.threshold),
          unit: r.unit, time: new Date(r.raised_at).toISOString(), ts: new Date(r.raised_at).getTime(),
        }
        const channels = await channelsFor(r.org_id, r.department_id)
        const cfgs = channels.map((c) => ({ channel: c.channel as Channel, target: c.target as string, min_severity: 'CRITICAL' as const }))
        await dispatch(ev, cfgs, true)
      }
      await markEscalated(rows.map((r) => r.id as string))
      console.log(`[escalation] escalated ${rows.length} critical event(s)`)
    } catch (e) {
      console.error('[escalation]', (e as Error).message)
    }
  }
  setInterval(tick, 60_000)
  console.log(`[escalation] active — unacked CRITICAL > ${mins} min`)
}
