// ---------------------------------------------------------------------------
// Domain-aware alarm parameter schema
// ---------------------------------------------------------------------------
// Each sensor product (domain) declares the parameters that can be alarmed —
// multi-level thresholds (Warning / Critical), direction, units, and optional
// rate-of-rise. The alarm-config UI is rendered from this schema, so adding a
// product or parameter is data-only.
// ---------------------------------------------------------------------------

import type { SensorDomain } from '@/types/fleet'
import type { NodeAlarmRule } from '@/server/alarmEngine'

export interface AlarmParam {
  key: string
  label: string
  unit: string
  /** 'high' = alarm when value rises above; 'low' = alarm when it drops below. */
  direction: 'high' | 'low'
  warn: number
  critical: number
  /** Optional rate-of-rise alarm (e.g. gassing rate) — key transformer signal. */
  rate?: { unit: string; warn: number }
}

export interface DomainAlarmSchema {
  label: string
  params: AlarmParam[]
  dwellMin: number        // debounce: alarm only if condition persists ≥ N minutes
  hysteresis: number      // deadband to clear the alarm
  healthIndexWarn?: number // composite health threshold (transformer)
}

export const ALARM_SCHEMA: Record<SensorDomain, DomainAlarmSchema> = {
  transformer: {
    label: 'ETERNITY Transformer',
    params: [
      { key: 'oilTemp', label: 'Oil Temperature', unit: '°C', direction: 'high', warn: 80, critical: 95, rate: { unit: '°C/h', warn: 3 } },
      { key: 'windingTemp', label: 'Winding / Hot-spot Temp', unit: '°C', direction: 'high', warn: 95, critical: 110 },
      { key: 'hydrogen', label: 'Hydrogen H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 150, critical: 300, rate: { unit: 'ppm/day', warn: 10 } },
      { key: 'moisture', label: 'Moisture', unit: 'ppm', direction: 'high', warn: 25, critical: 35 },
      { key: 'oilLevel', label: 'Oil Level', unit: '%', direction: 'low', warn: 70, critical: 60 },
      { key: 'load', label: 'Load', unit: '%', direction: 'high', warn: 80, critical: 95 },
    ],
    dwellMin: 5,
    hysteresis: 2,
    healthIndexWarn: 60,
  },
  carbonNode: {
    label: 'CarbonBOX Refrigeration',
    params: [
      { key: 'tempHigh', label: 'Temperature (high)', unit: '°C', direction: 'high', warn: 8, critical: 10 },
      { key: 'tempLow', label: 'Temperature (low)', unit: '°C', direction: 'low', warn: 2, critical: 0 },
      { key: 'door', label: 'Door-open duration', unit: 'min', direction: 'high', warn: 5, critical: 15 },
      // Compressor draw: a rising current means the compressor is labouring
      // (dirty condenser, low refrigerant, failing motor). Defaults suit a small
      // unit — tune per org/device in Alarm & Notify.
      { key: 'current', label: 'Compressor Current', unit: 'A', direction: 'high', warn: 5, critical: 10 },
    ],
    dwellMin: 3,
    hysteresis: 1,
  },
  bloodBox: {
    label: 'BloodBOX Cold-Chain',
    params: [
      { key: 'tempHigh', label: 'Temperature (high)', unit: '°C', direction: 'high', warn: 6, critical: 8 },
      { key: 'tempLow', label: 'Temperature (low)', unit: '°C', direction: 'low', warn: 2, critical: 1 },
      { key: 'battery', label: 'Battery', unit: '%', direction: 'low', warn: 30, critical: 15 },
      { key: 'excursion', label: 'Excursion duration', unit: 'min', direction: 'high', warn: 10, critical: 30 },
    ],
    dwellMin: 2,
    hysteresis: 0.5,
  },
}

export const getAlarmSchema = (domain?: SensorDomain): DomainAlarmSchema | null =>
  domain ? ALARM_SCHEMA[domain] : null

export type ParamStatus = 'NORMAL' | 'WARNING' | 'CRITICAL'

/**
 * Grade one live reading against its schema thresholds. 'high' params alarm on
 * the way up (oil temp, hydrogen), 'low' ones on the way down (oil level), so
 * the comparison direction has to come from the param, not the caller.
 */
export function paramStatus(value: number, p: AlarmParam): ParamStatus {
  const breach = (limit: number) => (p.direction === 'high' ? value >= limit : value <= limit)
  if (breach(p.critical)) return 'CRITICAL'
  if (breach(p.warn)) return 'WARNING'
  return 'NORMAL'
}

/**
 * Composite health index from the live readings of one device: every param
 * sitting in warning costs 10 points and every critical one 25, so the gauge
 * moves for the same reasons the status pills do. Returns null when the device
 * has reported none of its schema params (nothing to score) — the caller then
 * keeps its own placeholder rather than showing a misleading 100.
 */
export function healthFromValues(values: Record<string, number>, domain?: SensorDomain): number | null {
  const schema = getAlarmSchema(domain)
  if (!schema) return null
  let penalty = 0
  let seen = 0
  for (const p of schema.params) {
    const v = values[p.key]
    if (v === undefined) continue
    seen++
    const st = paramStatus(v, p)
    if (st === 'CRITICAL') penalty += 25
    else if (st === 'WARNING') penalty += 10
  }
  if (!seen) return null
  return Math.max(0, Math.min(100, 100 - penalty))
}

/** Build the engine rule (NodeAlarmRule) from a domain's default schema. */
export function defaultNodeRule(domain: SensorDomain): NodeAlarmRule {
  const s = ALARM_SCHEMA[domain]
  return {
    domain,
    params: s.params.map((p) => ({ ...p, rate: p.rate ? { ...p.rate } : undefined })),
    dwellMin: s.dwellMin,
    hysteresis: s.hysteresis,
    healthIndexWarn: s.healthIndexWarn,
  }
}

/**
 * Raw device wire keys that the ingest worker now normalises into canonical
 * params (temp_c -> tempHigh+tempLow, oil_temp_c -> oilTemp, dga_h2_ppm ->
 * hydrogen, ...). Readings stored before that normalisation still carry the raw
 * spelling, so a device page would list the same metric twice — once as temp_c
 * and once as tempHigh. Device dashboards hide these; the raw telemetry viewer
 * deliberately does not, since its whole job is to show the wire verbatim.
 * Keep in sync with paramMap in backend/worker/main.go.
 */
export const LEGACY_WIRE_KEYS = new Set([
  'temp_c', 'oil_temp_c', 'ambient_temp_c', 'winding_temp_c',
  'dga_h2_ppm', 'hydrogen_ppm', 'moisture_ppm', 'oil_level_pct', 'load_pct',
  'door_state', 'rh_pct', 'batt_pct', 'impact_g', 'baro_alt_m',
  'electrical_current_a', 'current_a',
])
