// Alarm evaluation engine — identical logic to the frontend
// (src/server/alarmEngine.ts). Pure & deterministic so the same thresholds
// produce the same events on device, edge and server. In production publish
// this as a shared package consumed by both.

export type Severity = 'WARNING' | 'CRITICAL'

export interface ParamRule {
  key: string
  label: string
  unit: string
  direction: 'high' | 'low'
  warn: number
  critical: number
  rate?: { unit: string; warn: number }
}

export interface NodeAlarmRule {
  domain: string
  params: ParamRule[]
  dwellMin: number
  hysteresis: number
  healthIndexWarn?: number
}

export interface Reading {
  time: string
  ts: number
  values: Record<string, number>
}

export interface AlarmEvent {
  id: string
  nodeId: string
  paramKey: string
  paramLabel: string
  severity: Severity
  kind: 'threshold' | 'rate'
  value: number
  threshold: number
  unit: string
  time: string
  ts: number
}

const breaches = (v: number, limit: number, dir: 'high' | 'low') => (dir === 'high' ? v >= limit : v <= limit)
const cleared = (v: number, limit: number, dir: 'high' | 'low', hyst: number) =>
  dir === 'high' ? v < limit - hyst : v > limit + hyst

function evalParam(nodeId: string, p: ParamRule, readings: Reading[], dwell: number, hyst: number): AlarmEvent[] {
  const out: AlarmEvent[] = []
  let active: Severity | null = null
  let run = 0
  let prev: number | null = null
  for (const r of readings) {
    const v = r.values[p.key]
    if (v === undefined || Number.isNaN(v)) continue
    if (p.rate && prev !== null) {
      const delta = p.direction === 'high' ? v - prev : prev - v
      if (delta >= p.rate.warn) out.push(mkEvent(nodeId, p, 'WARNING', 'rate', v, p.rate.warn, r))
    }
    prev = v
    const level: Severity | null = breaches(v, p.critical, p.direction) ? 'CRITICAL'
      : breaches(v, p.warn, p.direction) ? 'WARNING' : null
    if (level) {
      run++
      if (run >= dwell && level !== active) {
        if (active === null || (active === 'WARNING' && level === 'CRITICAL')) {
          out.push(mkEvent(nodeId, p, level, 'threshold', v, level === 'CRITICAL' ? p.critical : p.warn, r))
        }
        active = level
      }
    } else if (active && cleared(v, p.warn, p.direction, hyst)) {
      active = null; run = 0
    } else if (!level) {
      run = 0
    }
  }
  return out
}

function mkEvent(nodeId: string, p: ParamRule, severity: Severity, kind: 'threshold' | 'rate', value: number, threshold: number, r: Reading): AlarmEvent {
  return {
    id: `ev-${nodeId}-${p.key}-${r.ts}-${kind}`,
    nodeId, paramKey: p.key, paramLabel: p.label, severity, kind,
    value: +value.toFixed(2), threshold, unit: p.unit, time: r.time, ts: r.ts,
  }
}

export function evaluate(nodeId: string, rule: NodeAlarmRule, readings: Reading[]): AlarmEvent[] {
  return rule.params.flatMap((p) => evalParam(nodeId, p, readings, rule.dwellMin, rule.hysteresis)).sort((a, b) => b.ts - a.ts)
}
