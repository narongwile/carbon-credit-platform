// ---------------------------------------------------------------------------
// Alarm evaluation engine (pure domain logic — the "backend" core)
// ---------------------------------------------------------------------------
// Framework-free and deterministic so it can run anywhere (browser, Node API,
// edge worker, tests). Evaluates a telemetry series against domain-aware alarm
// rules and emits events using multi-level thresholds, rate-of-rise, dwell
// (debounce) and hysteresis (deadband).
// ---------------------------------------------------------------------------

export type Severity = 'WARNING' | 'CRITICAL'

export interface ParamRule {
  key: string
  label: string
  unit: string
  direction: 'high' | 'low'
  warn: number
  critical: number
  rate?: { unit: string; warn: number } // emit a rate event if |Δ/sample| exceeds this
}

export interface NodeAlarmRule {
  domain: string
  params: ParamRule[]
  dwellMin: number      // samples a condition must persist before it fires
  hysteresis: number    // value must recover past (threshold ∓ hysteresis) to clear
  healthIndexWarn?: number
  debounceJson?: Record<string, { dwell_min?: number; cooldown_s?: number }>
}

export interface Reading {
  time: string
  ts: number
  values: Record<string, number> // keyed by param key
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
  source?: 'edge' | 'cloud'
}

const breaches = (v: number, limit: number, dir: 'high' | 'low') => (dir === 'high' ? v >= limit : v <= limit)
const cleared = (v: number, limit: number, dir: 'high' | 'low', hyst: number) =>
  dir === 'high' ? v < limit - hyst : v > limit + hyst

// Evaluate one parameter's series → events on each activation (not per sample).
function evalParam(nodeId: string, p: ParamRule, readings: Reading[], dwell: number, hyst: number): AlarmEvent[] {
  const out: AlarmEvent[] = []
  let active: Severity | null = null // currently-firing level
  let run = 0                        // consecutive breaching samples
  let prev: number | null = null

  for (const r of readings) {
    const v = r.values[p.key]
    if (v === undefined || Number.isNaN(v)) continue

    // ----- rate-of-rise (debounced: only when not already firing) -----
    if (p.rate && prev !== null) {
      const delta = p.direction === 'high' ? v - prev : prev - v
      if (delta >= p.rate.warn) {
        out.push(mkEvent(nodeId, p, 'WARNING', 'rate', v, p.rate.warn, r))
      }
    }
    prev = v

    // ----- multi-level threshold with dwell + hysteresis -----
    const level: Severity | null = breaches(v, p.critical, p.direction) ? 'CRITICAL'
      : breaches(v, p.warn, p.direction) ? 'WARNING' : null

    if (level) {
      run++
      // escalate or newly fire once the condition has persisted past dwell
      if (run >= dwell && level !== active) {
        // only emit when entering a level (fire) or escalating warn→critical
        if (active === null || (active === 'WARNING' && level === 'CRITICAL')) {
          out.push(mkEvent(nodeId, p, level, 'threshold', v, level === 'CRITICAL' ? p.critical : p.warn, r))
        }
        active = level
      }
    } else if (active && cleared(v, p.warn, p.direction, hyst)) {
      active = null
      run = 0
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
    source: 'cloud', // local evaluation is cloud
  }
}

/** Evaluate a whole node's telemetry against its rule → events (newest first). */
export function evaluate(nodeId: string, rule: NodeAlarmRule, readings: Reading[]): AlarmEvent[] {
  const events = rule.params.flatMap((p) => evalParam(nodeId, p, readings, rule.dwellMin, rule.hysteresis))
  return events.sort((a, b) => b.ts - a.ts)
}
