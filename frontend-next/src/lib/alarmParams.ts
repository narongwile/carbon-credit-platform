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
      // 🌡️ Thermal & Oil
      { key: 'oilTemp', label: 'Top Oil Temperature', unit: '°C', direction: 'high', warn: 85, critical: 90, rate: { unit: '°C/h', warn: 3 } },
      { key: 'windingTemp', label: 'Winding / Hot-spot Temp', unit: '°C', direction: 'high', warn: 95, critical: 110 },
      // ⚡️ Voltage & Power Quality
      { key: 'overVoltage', label: 'Over Voltage', unit: '%', direction: 'high', warn: 105, critical: 110 },
      { key: 'underVoltage', label: 'Under Voltage', unit: '%', direction: 'low', warn: 95, critical: 90 },
      { key: 'voltageUnbalance', label: 'Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5 },
      // 🔌 Current & Load
      { key: 'load', label: 'Over Current (Load)', unit: '%', direction: 'high', warn: 100, critical: 115 },
      // 🧪 DGA & Oil Quality
      { key: 'hydrogen', label: 'Hydrogen H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 150, critical: 300, rate: { unit: 'ppm/day', warn: 10 } },
      { key: 'moisture', label: 'Moisture', unit: 'ppm', direction: 'high', warn: 25, critical: 35 },
      { key: 'oilLevel', label: 'Oil Level', unit: '%', direction: 'low', warn: 70, critical: 60 },
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
  automobile: {
    label: 'Formula EV (NAT)',
    params: [
      { key: 'fatigue_score', label: 'Driver Fatigue Risk Index (1D-CNN)', unit: '%', direction: 'high', warn: 70, critical: 85 },
      { key: 'hr_bpm', label: 'Driver Heart Rate', unit: 'BPM', direction: 'high', warn: 110, critical: 130 },
      { key: 'fatigue_ratio', label: 'Neural EEG Fatigue Ratio (Theta+Alpha)/Beta', unit: 'ratio', direction: 'high', warn: 4.0, critical: 6.0 },
      { key: 'eeg_theta', label: 'EEG Theta Band Surge', unit: 'μV', direction: 'high', warn: 30, critical: 45 },
      { key: 'speed_kmh', label: 'Vehicle Speed', unit: 'km/h', direction: 'high', warn: 120, critical: 140 },
      { key: 'steering_angle', label: 'Steering Reversal Deviation', unit: 'deg', direction: 'high', warn: 45, critical: 60 },
      { key: 'motor_temp', label: 'Inverter Motor Temp', unit: '°C', direction: 'high', warn: 85, critical: 100 },
      { key: 'bms_soc', label: 'BMS Battery SOC', unit: '%', direction: 'low', warn: 20, critical: 10 },
    ],
    dwellMin: 2,
    hysteresis: 1,
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
  if (!values || !Object.keys(values).length) return null
  const schema = getAlarmSchema(domain)
  // No schema means there is nothing to score against — null, never 100.
  // Scoring an unknown domain as perfect health is the exact failure this
  // function's contract exists to prevent.
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
  // A device can report plenty of values and still match NONE of the schema
  // keys — a real ETERNITY transformer publishes Oiltemp/H2/RHamb/Tbox, not
  // one of which is a schema key. Without this check such a device scores a
  // green 100 out of an empty loop: a perfect health gauge derived from
  // nothing, on a device nobody is actually monitoring.
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

/**
 * Standard Alarm Category and Condition / Risk Insights based on industrial transformer specification.
 */
export const ALARM_RISK_INSIGHTS: Record<string, { category: string; risk: string; condition: string }> = {
  oilTemp: {
    category: 'Thermal & Oil',
    risk: 'Winding/insulation damage risk',
    condition: 'Top Oil Temperature > 85°C (Warning) / > 90°C (Critical)',
  },
  windingTemp: {
    category: 'Thermal & Oil',
    risk: 'Hot-spot thermal degradation',
    condition: 'Winding Temp > 95°C (Warning) / > 110°C (Critical)',
  },
  overVoltage: {
    category: 'Voltage',
    risk: 'Equipment damage risk',
    condition: '> +5% of rated voltage (Warning) / > +10% of rated voltage (Critical)',
  },
  underVoltage: {
    category: 'Voltage',
    risk: 'Operational instability / low voltage trip',
    condition: '< -5% of rated voltage (Warning) / < -10% of rated voltage (Critical)',
  },
  load: {
    category: 'Current',
    risk: 'Immediate short circuit risk on critical breach',
    condition: '> 100% to 115% rated capacity (Warning) / > 115% (Critical)',
  },
  voltageUnbalance: {
    category: 'Power Quality',
    risk: 'Phase unbalance motor heating & system stress',
    condition: 'Voltage unbalance between phases > 2% (Warning) / > 5% (Critical)',
  },
  externalFault: {
    category: 'Event/Fault',
    risk: 'Transformer shutdown from external fault such as animals, lightning, or grid incident',
    condition: 'Notice/Warning condition',
  },
}
