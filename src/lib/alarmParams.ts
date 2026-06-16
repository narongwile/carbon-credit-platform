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
