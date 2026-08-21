'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAlarmSchema, defaultNodeRule, type AlarmParam, ALARM_SCHEMA } from '@/lib/alarmParams'
import { useAlarmDB } from '@/server/alarmStore'
import { useParamLabels, schemaLabel } from '@/lib/useParamLabels'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { api, isLive, useIsLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import type { SensorDomain } from '@/types/fleet'
import type { NodeAlarmRule, ParamRule } from '@/server/alarmEngine'
import {
  ArrowUp, ArrowDown, TrendingUp, Timer, Activity, Save, Plus, Trash2,
  Search, Sliders, SlidersHorizontal, Check, AlertTriangle, RefreshCw, X, ShieldAlert,
  Gauge, Zap, Droplet, Radio, Thermometer, Box, Filter
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export type ParamCategory = 'all' | 'temperature' | 'electrical' | 'dga_oil' | 'mechanical_env' | 'custom'

interface CategoryTab {
  id: ParamCategory
  label: string
  icon: React.ElementType
}

const CATEGORY_TABS: CategoryTab[] = [
  { id: 'all', label: 'All Parameters', icon: Filter },
  { id: 'temperature', label: 'Temperature', icon: Thermometer },
  { id: 'electrical', label: 'Electrical & Power', icon: Zap },
  { id: 'dga_oil', label: 'DGA & Oil Quality', icon: Droplet },
  { id: 'mechanical_env', label: 'Mechanical & Environment', icon: Gauge },
  { id: 'custom', label: 'Custom / Other', icon: Box },
]

export type ParamKind = 'reading' | 'compound'

export interface ExtendedAlarmParam extends AlarmParam {
  paramType?: ParamKind
  sourceFormula?: string
  riskInsight?: string
}

/** Physical Reading Parameters Catalog (Direct Sensors from Telemetry) */
export const READING_PAYLOAD_CATALOG: Record<SensorDomain, ExtendedAlarmParam[]> = {
  transformer: [
    // 🌡️ Thermal & Temperature Sensors
    { key: 'oilTemp', label: 'Top Oil Temperature', unit: '°C', direction: 'high', warn: 85, critical: 90, rate: { unit: '°C/h', warn: 3 }, paramType: 'reading', riskInsight: 'Top Oil Temperature Sensor' },
    { key: 'windingTemp', label: 'Winding / Hot-Spot Temp', unit: '°C', direction: 'high', warn: 95, critical: 110, rate: { unit: '°C/h', warn: 5 }, paramType: 'reading', riskInsight: 'Winding Hot-spot Probe' },
    { key: 'ambientTemp', label: 'Ambient Temperature', unit: '°C', direction: 'high', warn: 45, critical: 55, paramType: 'reading' },
    { key: 'bottomOilTemp', label: 'Bottom Oil Temperature', unit: '°C', direction: 'high', warn: 70, critical: 85, paramType: 'reading' },
    { key: 'coreTemp', label: 'Core Temperature', unit: '°C', direction: 'high', warn: 90, critical: 105, paramType: 'reading' },

    // ⚡️ Electrical Power Sensors
    { key: 'voltageA', label: 'Phase A Voltage (V_an)', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading' },
    { key: 'voltageB', label: 'Phase B Voltage (V_bn)', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading' },
    { key: 'voltageC', label: 'Phase C Voltage (V_cn)', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading' },
    { key: 'currentA', label: 'Phase A Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading' },
    { key: 'currentB', label: 'Phase B Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading' },
    { key: 'currentC', label: 'Phase C Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading' },
    { key: 'currentN', label: 'Neutral Current', unit: 'A', direction: 'high', warn: 50, critical: 100, paramType: 'reading' },
    { key: 'load', label: 'Load Factor', unit: '%', direction: 'high', warn: 100, critical: 115, paramType: 'reading' },
    { key: 'powerFactor', label: 'Power Factor', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75, paramType: 'reading' },
    { key: 'frequency', label: 'Frequency', unit: 'Hz', direction: 'high', warn: 51.5, critical: 52.5, paramType: 'reading' },
    { key: 'thd_v', label: 'Voltage THD', unit: '%', direction: 'high', warn: 5, critical: 8, paramType: 'reading' },
    { key: 'thd_i', label: 'Current THD', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading' },
    { key: 'activePower', label: 'Active Power', unit: 'kW', direction: 'high', warn: 800, critical: 1000, paramType: 'reading' },
    { key: 'apparentPower', label: 'Apparent Power', unit: 'kVA', direction: 'high', warn: 1000, critical: 1250, paramType: 'reading' },

    // 🧪 DGA & Oil Quality Sensors
    { key: 'hydrogen', label: 'Hydrogen H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 150, critical: 300, rate: { unit: 'ppm/day', warn: 10 }, paramType: 'reading' },
    { key: 'methane', label: 'Methane CH₄ (DGA)', unit: 'ppm', direction: 'high', warn: 120, critical: 400, paramType: 'reading' },
    { key: 'acetylene', label: 'Acetylene C₂H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 5, critical: 35, paramType: 'reading' },
    { key: 'ethylene', label: 'Ethylene C₂H₄ (DGA)', unit: 'ppm', direction: 'high', warn: 100, critical: 200, paramType: 'reading' },
    { key: 'ethane', label: 'Ethane C₂H₆ (DGA)', unit: 'ppm', direction: 'high', warn: 65, critical: 150, paramType: 'reading' },
    { key: 'co', label: 'Carbon Monoxide CO', unit: 'ppm', direction: 'high', warn: 500, critical: 1000, paramType: 'reading' },
    { key: 'co2', label: 'Carbon Dioxide CO₂', unit: 'ppm', direction: 'high', warn: 5000, critical: 10000, paramType: 'reading' },
    { key: 'tdcg', label: 'Total Combustible Gas (TDCG)', unit: 'ppm', direction: 'high', warn: 720, critical: 1920, paramType: 'reading' },
    { key: 'moisture', label: 'Moisture in Oil', unit: 'ppm', direction: 'high', warn: 25, critical: 35, paramType: 'reading' },
    { key: 'oilLevel', label: 'Oil Level', unit: '%', direction: 'low', warn: 70, critical: 60, paramType: 'reading' },
    { key: 'bdv', label: 'Breakdown Voltage (BDV)', unit: 'kV', direction: 'low', warn: 40, critical: 30, paramType: 'reading' },
    { key: 'acidity', label: 'Oil Acidity', unit: 'mg KOH/g', direction: 'high', warn: 0.15, critical: 0.3, paramType: 'reading' },

    // 🛡️ Mechanical & Environmental Sensors
    { key: 'pressure', label: 'Tank Pressure', unit: 'kPa', direction: 'high', warn: 35, critical: 50, paramType: 'reading' },
    { key: 'partialDischarge', label: 'Partial Discharge (PD)', unit: 'pC', direction: 'high', warn: 200, critical: 500, paramType: 'reading' },
    { key: 'vibration', label: 'Vibration Velocity', unit: 'mm/s', direction: 'high', warn: 4.5, critical: 7.1, paramType: 'reading' },
  ],
  carbonNode: [
    { key: 'tempHigh', label: 'Chamber High Temperature', unit: '°C', direction: 'high', warn: 8, critical: 10, paramType: 'reading' },
    { key: 'tempLow', label: 'Chamber Low Temperature', unit: '°C', direction: 'low', warn: 2, critical: 0, paramType: 'reading' },
    { key: 'door', label: 'Door-open Duration', unit: 'min', direction: 'high', warn: 5, critical: 15, paramType: 'reading' },
    { key: 'current', label: 'Compressor Current', unit: 'A', direction: 'high', warn: 5, critical: 10, paramType: 'reading' },
    { key: 'rh', label: 'Relative Humidity', unit: '%', direction: 'high', warn: 85, critical: 95, paramType: 'reading' },
    { key: 'defrostTemp', label: 'Defrost Sensor Temp', unit: '°C', direction: 'high', warn: 15, critical: 25, paramType: 'reading' },
    { key: 'power', label: 'Power Consumption', unit: 'kW', direction: 'high', warn: 3.5, critical: 5.0, paramType: 'reading' },
  ],
  bloodBox: [
    { key: 'tempHigh', label: 'Blood Storage High Temp', unit: '°C', direction: 'high', warn: 6, critical: 8, paramType: 'reading' },
    { key: 'tempLow', label: 'Blood Storage Low Temp', unit: '°C', direction: 'low', warn: 2, critical: 1, paramType: 'reading' },
    { key: 'battery', label: 'Battery Level', unit: '%', direction: 'low', warn: 30, critical: 15, paramType: 'reading' },
    { key: 'excursion', label: 'Excursion Duration', unit: 'min', direction: 'high', warn: 10, critical: 30, paramType: 'reading' },
    { key: 'ambientTemp', label: 'External Ambient Temp', unit: '°C', direction: 'high', warn: 38, critical: 45, paramType: 'reading' },
    { key: 'impact', label: 'Shock / Impact Sensor', unit: 'g', direction: 'high', warn: 2.5, critical: 4.0, paramType: 'reading' },
    { key: 'baroAlt', label: 'Barometric Altitude', unit: 'm', direction: 'high', warn: 2500, critical: 3500, paramType: 'reading' },
    { key: 'rssi', label: 'Cellular Signal Strength', unit: 'dBm', direction: 'low', warn: -95, critical: -110, paramType: 'reading' },
  ],
  automobile: [
    // 🧠 Biosignal & 1D-CNN Fatigue Index (Direct MQTT & Model Ingest)
    { key: 'fatigue_score', label: 'Driver Fatigue Risk Index (1D-CNN)', unit: '%', direction: 'high', warn: 70, critical: 85, paramType: 'reading', riskInsight: 'Driver drowsiness / cognitive fatigue risk breach' },
    { key: 'hr_bpm', label: 'Driver Heart Rate', unit: 'BPM', direction: 'high', warn: 110, critical: 130, paramType: 'reading', riskInsight: 'Driver physical exertion / cardiac stress' },
    { key: 'hrv_rmssd', label: 'Heart-Rate Variability (HRV RMSSD)', unit: 'ms', direction: 'low', warn: 30, critical: 20, paramType: 'reading', riskInsight: 'Autonomic nervous system recovery depletion' },
    { key: 'fatigue_ratio', label: 'Neural EEG Fatigue Ratio (θ+α)/β', unit: 'ratio', direction: 'high', warn: 4.0, critical: 6.0, paramType: 'reading', riskInsight: 'Frontal theta wave surge vs beta wave suppression' },
    { key: 'eeg_theta', label: 'EEG Theta Band Surge', unit: 'μV', direction: 'high', warn: 30, critical: 45, paramType: 'reading' },
    { key: 'eeg_alpha', label: 'EEG Alpha Band Power', unit: 'μV', direction: 'high', warn: 35, critical: 50, paramType: 'reading' },
    { key: 'eeg_beta', label: 'EEG Beta Band Power', unit: 'μV', direction: 'low', warn: 12, critical: 8, paramType: 'reading' },

    // 🏎️ Vehicle Dynamics & Powertrain (CAN Ingest)
    { key: 'speed_kmh', label: 'Vehicle Speed', unit: 'km/h', direction: 'high', warn: 120, critical: 140, paramType: 'reading' },
    { key: 'steering_angle', label: 'Steering Reversal Deviation', unit: '°', direction: 'high', warn: 45, critical: 60, paramType: 'reading' },
    { key: 'brake_bar', label: 'Hydraulic Brake Pressure', unit: 'bar', direction: 'high', warn: 80, critical: 120, paramType: 'reading' },
    { key: 'apps1', label: 'Accelerator Pedal Position (APPS1)', unit: '%', direction: 'high', warn: 95, critical: 100, paramType: 'reading' },
    { key: 'motor_rpm', label: 'Inverter Motor RPM', unit: 'RPM', direction: 'high', warn: 7500, critical: 8500, paramType: 'reading' },
    { key: 'motor_temp', label: 'Inverter / Motor Temperature', unit: '°C', direction: 'high', warn: 85, critical: 100, paramType: 'reading' },
    { key: 'bms_soc', label: 'BMS Battery State of Charge', unit: '%', direction: 'low', warn: 20, critical: 10, paramType: 'reading' },

    // Aliases (camelCase for Frontend Compatibility)
    { key: 'fatigueScore', label: 'Fatigue Score (Aliased)', unit: '%', direction: 'high', warn: 70, critical: 85, paramType: 'reading' },
    { key: 'speedKmh', label: 'Vehicle Speed (Aliased)', unit: 'km/h', direction: 'high', warn: 120, critical: 140, paramType: 'reading' },
    { key: 'motorTemp', label: 'Motor Temp (Aliased)', unit: '°C', direction: 'high', warn: 85, critical: 100, paramType: 'reading' },
    { key: 'bmsSoc', label: 'Battery SOC (Aliased)', unit: '%', direction: 'low', warn: 20, critical: 10, paramType: 'reading' },
  ],
}

/** Compound / Multi-condition Alarm Rules (Industrial Alarm List) */
export const COMPOUND_ALARM_CATALOG: Record<SensorDomain, ExtendedAlarmParam[]> = {
  transformer: [
    {
      key: 'alarm_oil_temp',
      label: 'Top Oil Temperature High / Critical',
      unit: '°C',
      direction: 'high',
      warn: 85,
      critical: 90,
      paramType: 'compound',
      sourceFormula: 'Evaluated from Top Oil Temperature (oilTemp)',
      riskInsight: 'Winding / insulation damage risk (>90°C)',
    },
    {
      key: 'alarm_over_voltage',
      label: 'Over Voltage Warning / Critical',
      unit: '%',
      direction: 'high',
      warn: 105,
      critical: 110,
      paramType: 'compound',
      sourceFormula: 'Evaluated across Phase Voltages (> +5% / > +10% of rated 230V)',
      riskInsight: 'Equipment damage risk (> +10%)',
    },
    {
      key: 'alarm_under_voltage',
      label: 'Under Voltage Warning / Critical',
      unit: '%',
      direction: 'low',
      warn: 95,
      critical: 90,
      paramType: 'compound',
      sourceFormula: 'Evaluated across Phase Voltages (< -5% / < -10% of rated 230V)',
      riskInsight: 'Low voltage operational trip / brownout',
    },
    {
      key: 'alarm_over_current',
      label: 'Over Current (Overload) / Short Circuit',
      unit: '%',
      direction: 'high',
      warn: 100,
      critical: 115,
      paramType: 'compound',
      sourceFormula: 'Evaluated from Load Factor & Phase Currents (> 100% to 115% / > 115%)',
      riskInsight: 'Immediate short circuit risk on critical breach (>115%)',
    },
    {
      key: 'alarm_voltage_unbalance',
      label: 'Voltage Unbalance High / Critical',
      unit: '%',
      direction: 'high',
      warn: 2,
      critical: 5,
      paramType: 'compound',
      sourceFormula: 'Calculated as (|V_max - V_min| / V_avg) * 100% between phases',
      riskInsight: 'Phase unbalance motor heating & system stress (>2% / >5%)',
    },
    {
      key: 'alarm_external_fault',
      label: 'External Fault / Event',
      unit: '',
      direction: 'high',
      warn: 1,
      critical: 1,
      paramType: 'compound',
      sourceFormula: 'Transformer shutdown / sudden trip from external cause',
      riskInsight: 'Shutdown from external fault such as animals, lightning, or grid incident',
    },
  ],
  carbonNode: [],
  bloodBox: [],
  automobile: [],
}

/** Comprehensive Expected Payload Catalog combining physical readings and compound alarm rules */
export const EXPECTED_PAYLOAD_CATALOG: Record<SensorDomain, ExtendedAlarmParam[]> = {
  transformer: [
    ...READING_PAYLOAD_CATALOG.transformer,
    ...COMPOUND_ALARM_CATALOG.transformer,
  ],
  carbonNode: READING_PAYLOAD_CATALOG.carbonNode,
  bloodBox: READING_PAYLOAD_CATALOG.bloodBox,
  automobile: READING_PAYLOAD_CATALOG.automobile,
}

/** Categorize any parameter key into one of the standard tabs */
export function classifyParam(key: string, domain?: SensorDomain): ParamCategory {
  const k = key.toLowerCase()

  // 1. Temperature
  if (
    k.includes('temp') || k.includes('hotspot') || k.includes('cooler') ||
    k === 'thigh' || k === 'tlow' || k.startsWith('t_') || k.endsWith('_temp')
  ) {
    return 'temperature'
  }

  // 2. Electrical
  if (
    k.includes('volt') || k.includes('curr') || k.includes('amp') ||
    k.includes('freq') || k.includes('hz') || k.includes('pf') ||
    k.includes('power') || k.includes('load') || k.includes('thd') ||
    k === 'kw' || k === 'kva' || k === 'kvar' || k === 'kwh' ||
    k.startsWith('v_') || k.startsWith('i_') || k.startsWith('voltage') || k.startsWith('current')
  ) {
    return 'electrical'
  }

  // 3. DGA & Oil Quality
  if (
    k.includes('dga') || k.includes('hydrogen') || k === 'h2' ||
    k.includes('methane') || k === 'ch4' || k.includes('acetylene') || k === 'c2h2' ||
    k.includes('ethylene') || k === 'c2h4' || k.includes('ethane') || k === 'c2h6' ||
    k.includes('carbon') || k === 'co' || k === 'co2' || k.includes('tdcg') ||
    k.includes('moist') || k.includes('oil') || k.includes('bdv') ||
    k.includes('breakdown') || k.includes('dielectric') || k.includes('acidity') || k.includes('ift')
  ) {
    return 'dga_oil'
  }

  // 4. Mechanical & Environmental
  if (
    k.includes('press') || k.includes('baro') || k.includes('alt') ||
    k.includes('vib') || k.includes('pd') || k.includes('partial') ||
    k.includes('sound') || k.includes('noise') || k.includes('door') ||
    k.includes('batt') || k.includes('excursion') || k.includes('rssi') ||
    k.includes('humid') || k.includes('rh') || k.includes('tilt') || k.includes('impact')
  ) {
    return 'mechanical_env'
  }

  return 'custom'
}

export default function AlarmParamConfig({
  domain = 'transformer',
  nodeId,
  orgId = 'org-1',
  onApplyAll,
}: {
  domain?: SensorDomain
  nodeId?: string
  orgId?: string
  onApplyAll?: (rule: NodeAlarmRule) => void
}) {
  const live = useIsLive()
  const schema = getAlarmSchema(domain)
  const setRule = useAlarmDB((s) => s.setRule)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)
  const { labelOf } = useParamLabels(orgId || '', domain, nodeId)
  const { devices } = useManagedDevices(orgId || '')

  // Current live sensor readings polled or subscribed
  const [liveReadings, setLiveReadings] = useState<Record<string, number>>({})
  const [configuredDisplayKeys, setConfiguredDisplayKeys] = useState<string[]>([])
  const [discoveredWireKeys, setDiscoveredWireKeys] = useState<string[]>([])
  const [customParams, setCustomParams] = useState<AlarmParam[]>([])

  // Search & Filter state
  const [paramKindFilter, setParamKindFilter] = useState<'all' | 'reading' | 'compound'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ParamCategory>('all')

  // New Custom Parameter Form Drawer
  const [showAddParam, setShowAddParam] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [newDirection, setNewDirection] = useState<'high' | 'low'>('high')
  const [newWarn, setNewWarn] = useState<number>(80)
  const [newCritical, setNewCritical] = useState<number>(100)

  // -------------------------------------------------------------------------
  // Fetch Real Live Telemetry & Discovered Parameters
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!live || !nodeId) {
      setLiveReadings({})
      return
    }
    let cancelled = false
    const fetchLatest = () => {
      api.latest(nodeId).then((r) => {
        if (cancelled || !r?.values) return
        setLiveReadings(r.values)
        setDiscoveredWireKeys(Object.keys(r.values))
      })
    }
    fetchLatest()
    const pollId = setInterval(fetchLatest, 5000)

    // Telemetry WS stream
    const unsubscribe = subscribeTelemetry((frame) => {
      if (frame.id === nodeId && frame.values && Object.keys(frame.values).length > 0) {
        setLiveReadings((prev) => ({ ...prev, ...frame.values }))
        setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Object.keys(frame.values ?? {})])))
      }
    })

    return () => {
      cancelled = true
      clearInterval(pollId)
      unsubscribe()
    }
  }, [live, nodeId])

  // Fetch configured display parameters from SENSOR READINGS
  useEffect(() => {
    if (!live || !orgId || !domain) return
    let cancelled = false
    api.displayParams(orgId, domain, nodeId).then((res) => {
      if (cancelled || !res?.paramKeys) return
      setConfiguredDisplayKeys(res.paramKeys)
    })
    return () => { cancelled = true }
  }, [live, orgId, domain, nodeId])

  // Discover parameters across the entire fleet if org-level
  useEffect(() => {
    if (nodeId || !devices.length) return
    const keys = new Set<string>()
    for (const d of devices) {
      if (d.domain === domain && (d as any).lastSample) {
        Object.keys((d as any).lastSample).forEach((k) => keys.add(k))
      }
    }
    if (keys.size > 0) {
      setDiscoveredWireKeys(Array.from(keys))
    }
  }, [nodeId, devices, domain])

  // -------------------------------------------------------------------------
  // Unified Parameter List: Catalog + Live Samples + Display Params + Custom
  // -------------------------------------------------------------------------
  const allParams: ExtendedAlarmParam[] = useMemo(() => {
    const map = new Map<string, ExtendedAlarmParam>()

    // 1. Expected catalog for this domain
    const catalog = EXPECTED_PAYLOAD_CATALOG[domain] || schema?.params || []
    for (const p of catalog) {
      map.set(p.key, { ...p, label: labelOf(p.key) })
    }

    // 2. Add keys configured in SENSOR READINGS (DisplayParamPicker)
    for (const k of configuredDisplayKeys) {
      if (!map.has(k)) {
        const lower = k.toLowerCase()
        const unit = lower.includes('temp') ? '°C' : lower.includes('volt') || lower.startsWith('v') ? 'V' : lower.includes('curr') || lower.startsWith('i') ? 'A' : lower.includes('thd') || lower.includes('level') || lower.includes('load') || lower.includes('pct') ? '%' : ''
        const direction: 'high' | 'low' = lower.includes('level') || lower.includes('low') || lower.includes('batt') || lower.includes('pf') || lower.includes('bdv') ? 'low' : 'high'
        map.set(k, {
          key: k,
          label: labelOf(k),
          unit,
          direction,
          warn: direction === 'high' ? 80 : 20,
          critical: direction === 'high' ? 100 : 10,
          paramType: 'reading',
        })
      }
    }

    // 3. Add any dynamically discovered wire keys from live telemetry / lastSample
    for (const k of discoveredWireKeys) {
      if (k === 'time' || k === 'ts' || k === 'id' || k === 'nodeId' || k === 'orgId' || k === 'domain' || k === 'status' || k === 'alarm') continue
      if (!map.has(k)) {
        const lower = k.toLowerCase()
        const unit = lower.includes('temp') ? '°C' : lower.includes('volt') || lower.startsWith('v') ? 'V' : lower.includes('curr') || lower.startsWith('i') ? 'A' : lower.includes('thd') || lower.includes('level') || lower.includes('load') || lower.includes('pct') ? '%' : ''
        const direction: 'high' | 'low' = lower.includes('level') || lower.includes('low') || lower.includes('batt') || lower.includes('pf') || lower.includes('bdv') ? 'low' : 'high'
        map.set(k, {
          key: k,
          label: labelOf(k),
          unit,
          direction,
          warn: direction === 'high' ? 80 : 20,
          critical: direction === 'high' ? 100 : 10,
          paramType: 'reading',
        })
      }
    }

    // 4. User-created custom parameters
    for (const cp of customParams) {
      map.set(cp.key, { ...cp, paramType: 'reading' })
    }

    return Array.from(map.values())
  }, [domain, schema, configuredDisplayKeys, discoveredWireKeys, customParams, labelOf])

  const readingCount = useMemo(() => allParams.filter((p) => p.paramType !== 'compound').length, [allParams])
  const compoundCount = useMemo(() => allParams.filter((p) => p.paramType === 'compound').length, [allParams])

  // Active parameter configuration values
  const [vals, setVals] = useState<Record<string, { warn: number; critical: number; rate?: number; enabled?: boolean }>>({})
  const [dbVals, setDbVals] = useState<Record<string, { dwell_min?: number; cooldown_s?: number }>>({})
  const [dwell, setDwell] = useState(schema?.dwellMin ?? 3)
  const [hyst, setHyst] = useState(schema?.hysteresis ?? 1)
  const [healthIdx, setHealthIdx] = useState(schema?.healthIndexWarn ?? 60)

  // Seed default values when allParams changes
  useEffect(() => {
    setVals((prev) => {
      const next = { ...prev }
      for (const p of allParams) {
        if (!next[p.key]) {
          next[p.key] = {
            warn: p.warn,
            critical: p.critical,
            rate: p.rate?.warn,
            enabled: true,
          }
        }
      }
      return next
    })
  }, [allParams])

  const setVal = (key: string, field: 'warn' | 'critical' | 'rate', v: number) =>
    setVals((s) => ({ ...s, [key]: { ...s[key], [field]: v } }))

  const toggleEnabled = (key: string) =>
    setVals((s) => ({ ...s, [key]: { ...s[key], enabled: s[key]?.enabled === false ? true : false } }))

  const toggleDirection = (key: string) => {
    // Invert direction and flip default warn/critical
    setVals((s) => {
      const current = s[key]
      return {
        ...s,
        [key]: {
          ...current,
          warn: current?.critical ?? 80,
          critical: current?.warn ?? 100,
        },
      }
    })
  }

  // Apply stored rule (from node or org)
  const applyRule = (saved: NodeAlarmRule) => {
    const nextVals: Record<string, { warn: number; critical: number; rate?: number; enabled?: boolean }> = {}
    for (const p of saved.params ?? []) {
      nextVals[p.key] = {
        warn: p.warn,
        critical: p.critical,
        rate: p.rate?.warn,
        enabled: (p as any).enabled !== false,
      }
    }
    setVals((prev) => ({ ...prev, ...nextVals }))
    if (saved.debounceJson) setDbVals(saved.debounceJson)
    if (saved.dwellMin !== undefined) setDwell(saved.dwellMin)
    if (saved.hysteresis !== undefined) setHyst(saved.hysteresis)
    if (saved.healthIndexWarn !== undefined) setHealthIdx(saved.healthIndexWarn)
  }

  // Load per-node saved rule
  useEffect(() => {
    if (!nodeId || !hasHydrated) return
    const saved = useAlarmDB.getState().rules[nodeId]
    if (saved) applyRule(saved)
  }, [nodeId, hasHydrated])

  // Load org-level saved rule
  const [orgRuleState, setOrgRuleState] = useState<'idle' | 'loading' | 'custom' | 'default'>('idle')
  const [orgRuleMeta, setOrgRuleMeta] = useState<{ updatedBy?: string | null; updatedAt?: string | null } | null>(null)
  useEffect(() => {
    if (nodeId || !orgId || !domain) return
    let cancelled = false
    setOrgRuleState('loading')
    api.getOrgRule(orgId, domain).then((r) => {
      if (cancelled) return
      if (r?.rule) {
        applyRule(r.rule)
        setOrgRuleMeta({ updatedBy: r.updatedBy, updatedAt: r.updatedAt })
        setOrgRuleState('custom')
      } else {
        setOrgRuleState('default')
      }
    })
    return () => { cancelled = true }
  }, [nodeId, orgId, domain])

  // -------------------------------------------------------------------------
  // Filtering & Category Tabs
  // -------------------------------------------------------------------------
  const categoryCounts = useMemo(() => {
    const subset = allParams.filter((p) => {
      if (paramKindFilter === 'reading') return p.paramType !== 'compound'
      if (paramKindFilter === 'compound') return p.paramType === 'compound'
      return true
    })
    const counts: Record<ParamCategory, number> = {
      all: subset.length,
      temperature: 0,
      electrical: 0,
      dga_oil: 0,
      mechanical_env: 0,
      custom: 0,
    }
    for (const p of subset) {
      const cat = classifyParam(p.key, domain)
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [allParams, paramKindFilter, domain])

  const filteredParams = useMemo(() => {
    let list = allParams
    if (paramKindFilter === 'reading') {
      list = list.filter((p) => p.paramType !== 'compound')
    } else if (paramKindFilter === 'compound') {
      list = list.filter((p) => p.paramType === 'compound')
    }

    if (activeTab !== 'all') {
      list = list.filter((p) => classifyParam(p.key, domain) === activeTab)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((p) =>
        p.label.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.unit && p.unit.toLowerCase().includes(q)) ||
        (p.riskInsight && p.riskInsight.toLowerCase().includes(q)) ||
        (p.sourceFormula && p.sourceFormula.toLowerCase().includes(q))
      )
    }
    return list
  }, [allParams, paramKindFilter, activeTab, searchQuery, domain])

  // Build current rule for persistence
  const buildRule = (): NodeAlarmRule | null => {
    if (!domain) return null
    const paramsOut: ParamRule[] = allParams.map((p) => {
      const v = vals[p.key]
      return {
        key: p.key,
        label: p.label,
        unit: p.unit,
        direction: p.direction,
        warn: v?.warn ?? p.warn,
        critical: v?.critical ?? p.critical,
        rate: p.rate ? { ...p.rate, warn: v?.rate ?? p.rate.warn } : undefined,
        enabled: v?.enabled !== false,
      } as ParamRule
    })

    return {
      domain,
      params: paramsOut,
      dwellMin: dwell,
      hysteresis: hyst,
      healthIndexWarn: schema?.healthIndexWarn !== undefined ? healthIdx : undefined,
      debounceJson: Object.keys(dbVals).length ? dbVals : undefined,
    }
  }

  /** Enabled parameters whose critical limit sits on the wrong side of warn.
   *
   * paramStatus tests critical FIRST, so for a 'high' parameter with warn 90 /
   * critical 80 everything above 80 reports CRITICAL and the warning tier can
   * never fire — the operator loses their early notice and only ever sees the
   * top severity. ParamHistoryModal already refuses to save this; this editor
   * is the more dangerous one to leave unguarded, because Apply-to-all pushes
   * a single mistake onto every device in the fleet at once. */
  const misordered = allParams.filter((p) => {
    const v = vals[p.key]
    if (v?.enabled === false) return false
    const warn = v?.warn ?? p.warn
    const critical = v?.critical ?? p.critical
    if (!Number.isFinite(warn) || !Number.isFinite(critical)) return false
    return p.direction === 'high' ? critical <= warn : critical >= warn
  })

  const persist = async () => {
    if (misordered.length) {
      toast.error(
        `Critical must be ${misordered[0].direction === 'high' ? 'higher' : 'lower'} than warning for `
        + `${misordered.map((p) => p.label).slice(0, 3).join(', ')}`
        + `${misordered.length > 3 ? ` and ${misordered.length - 3} more` : ''}`
        + ' — otherwise the warning level can never fire.'
      )
      return
    }
    const rule = buildRule()
    if (!rule) return
    if (nodeId) {
      setRule(nodeId, rule, orgId)
      if (isLive()) {
        await api.putRule(nodeId, { orgId, rule })
      }
      toast.success('Alarm rules saved for this device')
    }
  }

  const applyAll = () => {
    // Same gate as persist(): this path is the one that would replicate a
    // misordered pair across the whole fleet.
    if (misordered.length) {
      toast.error(`Fix the warning/critical order on ${misordered[0].label} before applying to all devices.`)
      return
    }
    const rule = buildRule()
    if (rule && onApplyAll) onApplyAll(rule)
  }

  const handleAddCustomParam = () => {
    if (!newKey.trim() || !newLabel.trim()) {
      toast.error('Please enter both Parameter Key and Label')
      return
    }
    const key = newKey.trim()
    const p: AlarmParam = {
      key,
      label: newLabel.trim(),
      unit: newUnit.trim(),
      direction: newDirection,
      warn: newWarn,
      critical: newCritical,
    }
    setCustomParams((prev) => [...prev.filter((x) => x.key !== key), p])
    setVals((prev) => ({
      ...prev,
      [key]: { warn: newWarn, critical: newCritical, enabled: true },
    }))
    setNewKey('')
    setNewLabel('')
    setNewUnit('')
    setShowAddParam(false)
    toast.success(`Parameter "${p.label}" added to configuration`)
  }

  const resetToFactoryDefaults = () => {
    const catalog = EXPECTED_PAYLOAD_CATALOG[domain] || schema?.params || []
    const nextVals: Record<string, { warn: number; critical: number; rate?: number; enabled?: boolean }> = {}
    for (const p of catalog) {
      nextVals[p.key] = { warn: p.warn, critical: p.critical, rate: p.rate?.warn, enabled: true }
    }
    setVals(nextVals)
    setDwell(schema?.dwellMin ?? 3)
    setHyst(schema?.hysteresis ?? 1)
    setHealthIdx(schema?.healthIndexWarn ?? 60)
    toast.success('Reset to standard factory defaults')
  }

  const toggleAll = (enable: boolean) => {
    setVals((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], enabled: enable }
      }
      return next
    })
    toast.success(enable ? 'Enabled all alarm parameters' : 'Disabled all alarm parameters')
  }

  // Live status evaluation helper
  const getLiveStatusBadge = (param: AlarmParam, liveVal?: number) => {
    if (liveVal === undefined || liveVal === null || isNaN(liveVal)) {
      return <span className="text-[10px] text-slate-600 font-mono">—</span>
    }
    const v = vals[param.key] ?? param
    const isHigh = param.direction === 'high'
    const isCrit = isHigh ? liveVal >= v.critical : liveVal <= v.critical
    const isWarn = isHigh ? liveVal >= v.warn : liveVal <= v.warn

    if (isCrit) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800 text-[10px] font-semibold font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          {liveVal.toFixed(1)} {param.unit} (CRIT)
        </span>
      )
    }
    if (isWarn) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800 text-[10px] font-semibold font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {liveVal.toFixed(1)} {param.unit} (WARN)
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 text-[10px] font-semibold font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {liveVal.toFixed(1)} {param.unit}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header Info & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white">Alarm Thresholds &amp; Telemetry Payload</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-950 text-indigo-300 border border-indigo-800/60">
              {allParams.length} parameters mapped
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {nodeId ? (
              <span>Device-specific mapping for <strong className="text-indigo-300">{nodeId}</strong> (Live payload &amp; sensor readings)</span>
            ) : (
              <span>Organization-wide threshold baseline for <strong className="text-indigo-300">{schema?.label ?? domain}</strong></span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetToFactoryDefaults}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/5 border border-slate-800"
            title="Reset all thresholds to factory baseline"
          >
            <RefreshCw size={11} /> Defaults
          </button>
          <button
            type="button"
            onClick={() => setShowAddParam(!showAddParam)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-indigo-300 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-800/80"
          >
            <Plus size={12} /> Add Custom Param
          </button>
        </div>
      </div>

      {/* Add Custom Parameter Form Drawer */}
      {showAddParam && (
        <div className="p-3.5 rounded-xl border border-indigo-800/60 bg-indigo-950/20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Plus size={14} className="text-indigo-400" /> Add Custom Sensor / Wire Key
            </div>
            <button onClick={() => setShowAddParam(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Parameter Key (MQTT Payload Key)</label>
              <input
                type="text"
                placeholder="e.g. bearing_temp_c"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-white font-mono text-xs outline-none"
                style={inset}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Display Label</label>
              <input
                type="text"
                placeholder="e.g. Bearing Temperature"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-white text-xs outline-none"
                style={inset}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Unit</label>
              <input
                type="text"
                placeholder="e.g. °C, V, A, ppm, %"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-white text-xs outline-none"
                style={inset}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Alarm Direction</label>
              <select
                value={newDirection}
                onChange={(e) => setNewDirection(e.target.value as any)}
                className="w-full px-2.5 py-1.5 rounded-lg text-white text-xs outline-none"
                style={inset}
              >
                <option value="high">▲ High (Alarm Above)</option>
                <option value="low">▼ Low (Alarm Below)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-amber-400 mb-1">Warning Threshold</label>
              <input
                type="number"
                value={newWarn}
                onChange={(e) => setNewWarn(+e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-amber-300 text-xs outline-none"
                style={inset}
              />
            </div>
            <div>
              <label className="block text-[10px] text-red-400 mb-1">Critical Threshold</label>
              <input
                type="number"
                value={newCritical}
                onChange={(e) => setNewCritical(+e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-red-300 text-xs outline-none"
                style={inset}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowAddParam(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleAddCustomParam}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
            >
              Add Parameter
            </button>
          </div>
        </div>
      )}

      {/* Scope Segment Filter: All vs. Reading Parameters vs. Compound Alarms */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-800 bg-slate-950/60 max-w-full overflow-x-auto">
        <button
          type="button"
          onClick={() => setParamKindFilter('all')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all',
            paramKindFilter === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <Sliders size={12} />
          <span>All Parameters ({allParams.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setParamKindFilter('reading')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all',
            paramKindFilter === 'reading' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <Activity size={12} className={paramKindFilter === 'reading' ? 'text-white' : 'text-sky-400'} />
          <span>Reading Parameters ({readingCount})</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/30 font-normal">Physical Sensors</span>
        </button>
        <button
          type="button"
          onClick={() => setParamKindFilter('compound')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all',
            paramKindFilter === 'compound' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <Zap size={12} className={paramKindFilter === 'compound' ? 'text-white' : 'text-amber-400'} />
          <span>Compound Alarms ({compoundCount})</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/30 font-normal">Alarm List</span>
        </button>
      </div>

      {/* Category Tabs & Quick Search */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
            {CATEGORY_TABS.map((tab) => {
              const count = categoryCounts[tab.id]
              if (tab.id !== 'all' && count === 0) return null
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
                    active ? 'text-white bg-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  )}
                  style={!active ? inset : {}}
                >
                  <Icon size={12} className={active ? 'text-white' : 'text-slate-400'} />
                  {tab.label}
                  <span className={clsx('ml-0.5 px-1.5 py-0.2 rounded-full text-[10px]', active ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-800 text-slate-400')}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Instant Search Bar */}
          <div className="relative min-w-[200px] flex-shrink-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search parameter or risk..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Parameter Table */}
      <div className="rounded-xl overflow-hidden border border-slate-800/90" style={{ background: '#0a0e1a' }}>
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
              <tr>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Active</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Parameter &amp; Classification</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Live Reading</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Direction</th>
                <th className="py-2.5 px-3 text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Warning</th>
                <th className="py-2.5 px-3 text-[10px] text-red-400 font-semibold uppercase tracking-wider">Critical</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Dwell (m)</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Cooldown (s)</th>
                <th className="py-2.5 px-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Rate-of-Rise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredParams.map((p) => {
                const current = vals[p.key] ?? { warn: p.warn, critical: p.critical, enabled: true, rate: p.rate?.warn }
                const isEnabled = current.enabled !== false
                const liveVal = liveReadings[p.key] ?? (devices.find((d) => d.id === nodeId) as any)?.lastSample?.[p.key]

                return (
                  <tr
                    key={p.key}
                    className={clsx(
                      'transition-colors hover:bg-white/[0.02]',
                      !isEnabled && 'opacity-40 bg-black/20'
                    )}
                  >
                    {/* Enable Checkbox */}
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleEnabled(p.key)}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </td>

                    {/* Parameter Label & Wire Key & Type Badges */}
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-200">{p.label}</span>
                        {p.paramType === 'compound' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/60">
                            <Zap size={9} /> Compound Alarm
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-950/60 text-sky-300 border border-sky-800/50">
                            <Activity size={9} /> Reading Sensor
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                        <span>{p.key}</span>
                        {p.unit && <span className="text-indigo-400/80">({p.unit})</span>}
                      </div>
                      {p.sourceFormula && (
                        <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                          <span className="text-slate-500 font-medium">Formula:</span>
                          <span className="text-slate-300">{p.sourceFormula}</span>
                        </div>
                      )}
                      {p.riskInsight && (
                        <div className="text-[10px] text-amber-400/90 mt-0.5 flex items-center gap-1">
                          <span>💡 {p.riskInsight}</span>
                        </div>
                      )}
                    </td>

                    {/* Live Reading */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      {getLiveStatusBadge(p, liveVal)}
                    </td>

                    {/* Direction Toggle */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleDirection(p.key)}
                        disabled={!isEnabled}
                        className={clsx(
                          'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all',
                          p.direction === 'high'
                            ? 'bg-red-950/40 border-red-800/80 text-red-300 hover:bg-red-900/60'
                            : 'bg-blue-950/40 border-blue-800/80 text-blue-300 hover:bg-blue-900/60'
                        )}
                        title="Click to toggle High (Alarm above) vs Low (Alarm below)"
                      >
                        {p.direction === 'high' ? (
                          <>
                            <ArrowUp size={11} className="text-red-400" />
                            <span>Alarm &gt;</span>
                          </>
                        ) : (
                          <>
                            <ArrowDown size={11} className="text-blue-400" />
                            <span>Alarm &lt;</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Warning Input */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        disabled={!isEnabled}
                        value={current.warn}
                        onChange={(e) => setVal(p.key, 'warn', +e.target.value)}
                        className="w-20 rounded-md px-2 py-1 text-xs text-amber-300 font-mono outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                        style={inset}
                      />
                    </td>

                    {/* Critical Input */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        disabled={!isEnabled}
                        value={current.critical}
                        onChange={(e) => setVal(p.key, 'critical', +e.target.value)}
                        className="w-20 rounded-md px-2 py-1 text-xs text-red-300 font-mono outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
                        style={inset}
                      />
                    </td>

                    {/* Dwell (min) */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        disabled={!isEnabled}
                        value={dbVals[p.key]?.dwell_min ?? ''}
                        placeholder={String(dwell)}
                        onChange={(e) => setDbVals((s) => ({ ...s, [p.key]: { ...s[p.key], dwell_min: e.target.value ? +e.target.value : undefined } }))}
                        className="w-14 rounded-md px-2 py-1 text-xs text-slate-200 font-mono outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 disabled:opacity-50"
                        style={inset}
                      />
                    </td>

                    {/* Cooldown (s) */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        disabled={!isEnabled}
                        value={dbVals[p.key]?.cooldown_s ?? ''}
                        placeholder="-"
                        onChange={(e) => setDbVals((s) => ({ ...s, [p.key]: { ...s[p.key], cooldown_s: e.target.value ? +e.target.value : undefined } }))}
                        className="w-14 rounded-md px-2 py-1 text-xs text-slate-200 font-mono outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 disabled:opacity-50"
                        style={inset}
                      />
                    </td>

                    {/* Rate of Rise */}
                    <td className="py-2 px-3">
                      {p.rate ? (
                        <div className="flex items-center gap-1">
                          <TrendingUp size={11} className="text-indigo-400" />
                          <input
                            type="number"
                            disabled={!isEnabled}
                            value={current.rate ?? p.rate.warn}
                            onChange={(e) => setVal(p.key, 'rate', +e.target.value)}
                            className="w-14 rounded-md px-2 py-1 text-xs text-indigo-300 font-mono outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            style={inset}
                          />
                          <span className="text-[10px] text-slate-500">{p.rate.unit}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-700">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}

              {filteredParams.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No matching parameters found for query &ldquo;{searchQuery}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Timing & Composite Health Settings */}
      <div className="p-3.5 rounded-xl border border-slate-800" style={surface}>
        <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
          <SlidersHorizontal size={13} className="text-indigo-400" /> Global Engine Debounce &amp; Hysteresis
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
              <Timer size={11} /> Global Dwell (min)
            </label>
            <input
              type="number"
              value={dwell}
              onChange={(e) => setDwell(+e.target.value)}
              className="w-full rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
              <Activity size={11} /> Hysteresis / Deadband
            </label>
            <input
              type="number"
              value={hyst}
              onChange={(e) => setHyst(+e.target.value)}
              className="w-full rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            />
          </div>
          {schema?.healthIndexWarn !== undefined && (
            <div>
              <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                <Gauge size={11} /> Health Index Alarm &lt;
              </label>
              <input
                type="number"
                value={healthIdx}
                onChange={(e) => setHealthIdx(+e.target.value)}
                className="w-full rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:ring-1 focus:ring-indigo-500"
                style={inset}
              />
            </div>
          )}
        </div>
      </div>

      {/* Status info if org-level */}
      {!nodeId && orgRuleState !== 'idle' && (
        <p className="text-[11px] text-slate-500">
          {orgRuleState === 'loading'
            ? 'Loading organization thresholds…'
            : orgRuleState === 'custom'
              ? `Showing saved baseline for ${schema?.label ?? domain}${orgRuleMeta?.updatedBy ? ` — last changed by ${orgRuleMeta.updatedBy}` : ''}.`
              : 'No custom baseline saved yet — showing built-in industrial recommendations.'}
        </p>
      )}

      {/* Save Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
        {nodeId && (
          <button
            onClick={persist}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md hover:brightness-110 transition-all"
            style={gradient}
          >
            <Save size={15} /> Save Device Alarm Rules
          </button>
        )}
        {onApplyAll && (
          <button
            onClick={applyAll}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md hover:brightness-110 transition-all"
            style={gradient}
          >
            <Save size={15} /> Apply Baseline to All {schema?.label ?? domain} Devices
          </button>
        )}
      </div>
    </div>
  )
}
