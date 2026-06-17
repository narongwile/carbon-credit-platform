import { openThresholdEvents, getRule, recentParamValues, clearEvent } from './repo.js'

// Periodically close alarm events whose parameter has returned to NORMAL for the
// whole CLEAR_AFTER_MIN window (deadband = the rule's hysteresis). Mirrors the
// Node-RED clear-sweep so both backends auto-clear identically (spec §9 CLEAR).
export function startClearance(): void {
  const mins = Number(process.env.CLEAR_AFTER_MIN || 5)
  const tick = async () => {
    try {
      const evs = await openThresholdEvents()
      for (const ev of evs) {
        const rule = await getRule(ev.node_id as string)
        const param = rule?.params.find((p) => p.key === ev.param_key)
        if (!param) continue
        const hys = rule!.hysteresis || 0
        const vals = await recentParamValues(ev.node_id as string, ev.param_key as string, mins)
        if (!vals.length) continue // no fresh data ⇒ don't clear yet
        const stillBreaching = vals.some((v) => (param.direction === 'high' ? v >= param.warn - hys : v <= param.warn + hys))
        if (!stillBreaching) await clearEvent(ev.id as string)
      }
    } catch (e) {
      console.error('[clearance]', (e as Error).message)
    }
  }
  setInterval(tick, 60_000)
  console.log(`[clearance] active — auto-clear after ${mins} min sustained NORMAL`)
}
