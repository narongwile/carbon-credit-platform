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
      // Was in READING_PAYLOAD_CATALOG but missing here, so defaultNodeRule()
      // never seeded it into a new device's starting rule — the exact dead-key
      // class of bug already fixed once for overVoltage/underVoltage/
      // voltageUnbalance. Threshold copied verbatim from the reading catalog.
      { key: 'ambientTemp', label: 'Ambient Temperature', unit: '°C', direction: 'high', warn: 45, critical: 55 },
      // ⚡️ Voltage & Power Quality
      //
      // Real MQTT field names from the device's payload spec (VoltAN/BN/CN,
      // VoltUnbalanceAN/BN/CN) — 'overVoltage'/'underVoltage'/'voltageUnbalance'
      // used to sit here as percent-of-rated values under keys no device ever
      // published, and because defaultNodeRule() below copies this list
      // VERBATIM as the starting rule for every brand-new device, that meant
      // every new transformer silently shipped with three enabled, permanently
      // dead voltage alarms. Over/under-voltage are two independent bands (one
      // 'high', one 'low') sharing one key per phase — see AlarmParamConfig's
      // rowId() for why that needs no new field, just the direction each
      // already carries. 230V line-to-neutral / 400V line-to-line is the Thai
      // LV nominal this assumes; a transformer on a different rated voltage
      // needs these retuned per device in Alarm & Notify.
      { key: 'VoltAN', label: 'Phase A-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253 },
      { key: 'VoltAN', label: 'Phase A-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207 },
      { key: 'VoltBN', label: 'Phase B-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253 },
      { key: 'VoltBN', label: 'Phase B-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207 },
      { key: 'VoltCN', label: 'Phase C-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253 },
      { key: 'VoltCN', label: 'Phase C-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207 },
      { key: 'VoltUnbalanceAN', label: 'Phase A-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5 },
      { key: 'VoltUnbalanceBN', label: 'Phase B-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5 },
      { key: 'VoltUnbalanceCN', label: 'Phase C-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5 },
      // 🧪 DGA & Oil Quality
      { key: 'hydrogen', label: 'Hydrogen H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 150, critical: 300, rate: { unit: 'ppm/day', warn: 10 } },
      { key: 'moisture', label: 'Moisture', unit: 'ppm', direction: 'high', warn: 25, critical: 35 },
      // ⚡️ Power quality — published by the meter on every frame.
      { key: 'PFTotal', label: 'Power Factor (3-phase)', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75 },
      { key: 'Hz', label: 'Frequency — Over', unit: 'Hz', direction: 'high', warn: 50.5, critical: 51 },
      { key: 'Hz', label: 'Frequency — Under', unit: 'Hz', direction: 'low', warn: 49.5, critical: 49 },
      { key: 'THD_VoltAB', label: 'Voltage THD A-B', unit: '%', direction: 'high', warn: 5, critical: 8 },
      { key: 'THD_VoltBC', label: 'Voltage THD B-C', unit: '%', direction: 'high', warn: 5, critical: 8 },
      { key: 'THD_VoltCA', label: 'Voltage THD C-A', unit: '%', direction: 'high', warn: 5, critical: 8 },
      // ---------------------------------------------------------------------
      // DELIBERATELY ABSENT: windingTemp, load, oilLevel.
      //
      // This list is copied VERBATIM by defaultNodeRule() into the starting
      // rule of every new transformer, so anything here is armed on day one.
      // All three named a key that no device in the fleet has ever published
      // (proved in e2e/proofs/audit-catalog-vs-device.mjs against captured
      // frames) — an alarm that shows as configured and enabled in the editor
      // and cannot fire at any reading, which is worse than no alarm because
      // it reads as coverage.
      //
      // 'load' additionally asked for a percentage of rated capacity that
      // nothing computes: rated_kva sits on the nameplate and no code path
      // turns it into a load percentage. The Alarm List's over-current
      // requirement is served instead by CurrentA/B/C in the reading catalog,
      // alarmed directly in amps — no derivation involved.
      //
      // windingTemp and oilLevel remain in READING_PAYLOAD_CATALOG so a
      // transformer that does carry a winding probe or a level float can
      // still enable them; they are simply no longer armed by default on
      // hardware that has neither.
      // ---------------------------------------------------------------------
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
  // Real ETERNITY transformer wire spellings (confirmed against a live MQTT
  // payload) — none of the spellings above matched them.
  'Oiltemp', 'Tamb', 'H2', 'OilMoisture',
  // Short-name power meter (tr-111), aliased onto the long-name meter's keys
  // so one alarm rule covers both models. See paramMap in worker/main.go.
  'Va', 'Vb', 'Vc', 'Ia', 'Ib', 'Ic', 'Pa', 'Pb', 'Pc',
  'VAa', 'VAb', 'VAc', 'VARa', 'VARb', 'VARc', 'PFa', 'PFb', 'PFc',
  'I3pavg', 'P3p', 'VA3p', 'VAR3p', 'PF3p', 'V3pab', 'V3pbc', 'V3pca', 'kWh3p',
])

/**
 * Standard Alarm Category, Condition, Consequence Risk, ISA-18.2 Priority,
 * and Operator Corrective SOP Action based on industrial transformer specifications.
 */
export interface AlarmRiskInsight {
  category: string
  risk: string
  condition: string
  priority: 'EMERGENCY' | 'HIGH' | 'MEDIUM' | 'LOW'
  action: string
}

export const ALARM_RISK_INSIGHTS: Record<string, AlarmRiskInsight> = {
  oilTemp: {
    category: 'Thermal & Oil',
    risk: 'Accelerated paper insulation degradation & oil oxidation rate',
    condition: 'Top Oil Temperature > 85°C (Warning) / > 90°C (Critical)',
    priority: 'HIGH',
    action: 'Inspect radiator cooling fans, verify ambient air flow, and check transformer loading current.',
  },
  Oiltemp: {
    category: 'Thermal & Oil',
    risk: 'Accelerated paper insulation degradation & oil oxidation rate',
    condition: 'Top Oil Temperature > 85°C (Warning) / > 90°C (Critical)',
    priority: 'HIGH',
    action: 'Inspect radiator cooling fans, verify ambient air flow, and check transformer loading current.',
  },
  hydrogen: {
    category: 'DGA Gas',
    risk: 'Partial discharge, corona sparking, or localized low-energy arcing under oil',
    condition: 'Dissolved H₂ > 100 ppm (Warning) / > 300 ppm (Critical) or Rate > 10 ppm/day',
    priority: 'HIGH',
    action: 'Order laboratory dissolved gas analysis (DGA) verification; monitor gassing rate trend.',
  },
  H2: {
    category: 'DGA Gas',
    risk: 'Partial discharge, corona sparking, or localized low-energy arcing under oil',
    condition: 'Dissolved H₂ > 100 ppm (Warning) / > 300 ppm (Critical) or Rate > 10 ppm/day',
    priority: 'HIGH',
    action: 'Order laboratory dissolved gas analysis (DGA) verification; monitor gassing rate trend.',
  },
  moisture: {
    category: 'Insulation',
    risk: 'Reduced dielectric breakdown strength & accelerated bubble formation risk',
    condition: 'Oil Moisture > 25 ppm (Warning) / > 35 ppm (Critical)',
    priority: 'HIGH',
    action: 'Schedule oil dehydration / filtration; check conservator silica gel breather condition.',
  },
  OilMoisture: {
    category: 'Insulation',
    risk: 'Reduced dielectric breakdown strength & accelerated bubble formation risk',
    condition: 'Oil Moisture > 25 ppm (Warning) / > 35 ppm (Critical)',
    priority: 'HIGH',
    action: 'Schedule oil dehydration / filtration; check conservator silica gel breather condition.',
  },
  load: {
    category: 'Current Load',
    risk: 'Thermal overloading & winding hotspot damage exceeding nameplate rating',
    condition: 'Load > 100% (Warning) / > 115% rated capacity (Critical)',
    priority: 'HIGH',
    action: 'Shed non-critical feeder loads; redistribute power across secondary substation buses.',
  },
  CurrentAVG: {
    category: 'Current Load',
    risk: 'Three-phase average current exceeding continuous thermal rating',
    condition: 'Average Current > Warning/Critical threshold',
    priority: 'HIGH',
    action: 'Check plant demand curve; prepare backup feeder transfer if overload persists.',
  },
  VoltAN: {
    category: 'Phase Voltage',
    risk: 'Phase-A insulation dielectric overstress (>High) or motor stalling/overcurrent (<Low)',
    condition: 'Phase A Voltage outside ±5% (Warning) / ±10% (Critical) of nominal',
    priority: 'MEDIUM',
    action: 'Verify On-Load Tap Changer (OLTC) position; check primary utility supply level.',
  },
  VoltBN: {
    category: 'Phase Voltage',
    risk: 'Phase-B insulation dielectric overstress (>High) or motor stalling/overcurrent (<Low)',
    condition: 'Phase B Voltage outside ±5% (Warning) / ±10% (Critical) of nominal',
    priority: 'MEDIUM',
    action: 'Verify On-Load Tap Changer (OLTC) position; check primary utility supply level.',
  },
  VoltCN: {
    category: 'Phase Voltage',
    risk: 'Phase-C insulation dielectric overstress (>High) or motor stalling/overcurrent (<Low)',
    condition: 'Phase C Voltage outside ±5% (Warning) / ±10% (Critical) of nominal',
    priority: 'MEDIUM',
    action: 'Verify On-Load Tap Changer (OLTC) position; check primary utility supply level.',
  },
  overVoltage: {
    category: 'Voltage',
    risk: 'Equipment insulation dielectric overstress & magnetic core saturation',
    condition: '> +5% of rated voltage (Warning) / > +10% of rated voltage (Critical)',
    priority: 'MEDIUM',
    action: 'Adjust substation voltage regulator / tap changer down.',
  },
  underVoltage: {
    category: 'Voltage',
    risk: 'Operational instability, motor overheating due to compensatory current draw',
    condition: '< -5% of rated voltage (Warning) / < -10% of rated voltage (Critical)',
    priority: 'MEDIUM',
    action: 'Check for heavy feeder startup or grid brownout condition.',
  },
  voltageUnbalance: {
    category: 'Power Quality',
    risk: 'Negative-sequence voltage causing excessive heating in 3-phase induction equipment',
    condition: 'Voltage unbalance > 2% (Warning) / > 5% (Critical)',
    priority: 'MEDIUM',
    action: 'Rebalance single-phase connected branch loads across secondary phases.',
  },
  VoltUnbalanceAN: {
    category: 'Power Quality',
    risk: 'Phase-A voltage unbalance exceeding IEC 61000-2-4 tolerance',
    condition: 'Phase-A unbalance > 2% (Warning) / > 5% (Critical)',
    priority: 'MEDIUM',
    action: 'Inspect phase load distribution on downstream panel boards.',
  },
  CurrentUnbalanceA: {
    category: 'Power Quality',
    risk: 'Current unbalance causing neutral current overheating and ground circulating flow',
    condition: 'Current unbalance > 10% (Warning) / > 20% (Critical)',
    priority: 'MEDIUM',
    action: 'Balance load allocation across phases; check for open single-phase branch fuses.',
  },
  THD_VoltAB: {
    category: 'Harmonics',
    risk: 'Voltage harmonic distortion causing stray eddy current losses & transformer derating',
    condition: 'THD Voltage > 5% (Warning) / > 8% (Critical) per IEEE 519',
    priority: 'LOW',
    action: 'Inspect active harmonic filters (AHF); identify variable frequency drives without chokes.',
  },
  THD_CurrentA: {
    category: 'Harmonics',
    risk: 'Current harmonic distortion causing neutral conductor heating & skin effect losses',
    condition: 'THD Current > 8% (Warning) / > 15% (Critical)',
    priority: 'LOW',
    action: 'Audit non-linear loads on Phase A; verify line reactor impedance.',
  },
  Tbox: {
    category: 'Enclosure',
    risk: 'Elevated internal control cabinet temperature causing IoT gateway & PLC thermal wear',
    condition: 'Control box temperature exceeding normal operational band',
    priority: 'LOW',
    action: 'Inspect control cabinet louvers, exhaust fan, and dust filter condition.',
  },
  RHbox: {
    category: 'Enclosure',
    risk: 'High cabinet relative humidity risking condensation on electronic terminal blocks',
    condition: 'Control box humidity > 80%',
    priority: 'LOW',
    action: 'Inspect cabinet enclosure door gasket; verify anti-condensation space heater operation.',
  },
  externalFault: {
    category: 'Event/Fault',
    risk: 'Transformer protective trip from external surge, lightning, or grid incident',
    condition: 'Buchi/Overcurrent protective trip assertion',
    priority: 'EMERGENCY',
    action: 'Do not re-energize without visual inspection, insulation resistance test, and oil sample.',
  },
}

/**
 * Resolves standard ISA-18.2 Risk Insight metadata for any parameter key.
 */
export function getAlarmInsight(paramKey: string): AlarmRiskInsight | undefined {
  if (!paramKey) return undefined
  if (ALARM_RISK_INSIGHTS[paramKey]) return ALARM_RISK_INSIGHTS[paramKey]
  const lower = paramKey.toLowerCase()
  for (const [k, v] of Object.entries(ALARM_RISK_INSIGHTS)) {
    if (k.toLowerCase() === lower) return v
  }
  if (lower.includes('temp')) return ALARM_RISK_INSIGHTS.oilTemp
  if (lower.includes('volt') && lower.includes('unbal')) return ALARM_RISK_INSIGHTS.voltageUnbalance
  if (lower.includes('curr') && lower.includes('unbal')) return ALARM_RISK_INSIGHTS.CurrentUnbalanceA
  if (lower.includes('volt')) return ALARM_RISK_INSIGHTS.VoltAN
  if (lower.includes('load') || lower.includes('curr')) return ALARM_RISK_INSIGHTS.load
  if (lower.includes('h2') || lower.includes('hydro')) return ALARM_RISK_INSIGHTS.hydrogen
  if (lower.includes('moist')) return ALARM_RISK_INSIGHTS.moisture
  return undefined
}
