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
import { getSession } from '@/lib/auth'
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
  /**
   * A key this device is genuinely publishing, for which no catalog entry (and
   * therefore no engineered limit) exists. Its warn/critical are placeholders
   * guessed from the key's spelling, NOT rationalized setpoints, so it is
   * offered to the operator switched OFF: an alarm on a made-up limit is worse
   * than no alarm, because it spends the operator's attention on a number
   * nobody chose. ISA-18.2 §6 calls this out explicitly — every alarm needs a
   * documented basis before it is allowed to annunciate.
   */
  unrationalized?: boolean
}

/**
 * Identity for the CONFIG UI's own bookkeeping (catalog dedup, per-row edit
 * state, React list keys) — NOT the identity the alarm engine evaluates on,
 * which is `.key` alone against live telemetry (r.values[p.key] / t.Values[p.Key],
 * identical in worker/main.go, alarmEngine.ts and the Node-RED backend).
 *
 * A single physical sensor can carry two independent alarm bands — a phase
 * voltage alarms both over ('high') and under ('low') — as two ParamRule
 * entries that share one `.key` and differ only in `.direction`. Every place
 * in this editor that used to key a Map/Record by `.key` alone (the reading
 * catalog, the per-row `vals` edit state, React's `key` prop) would silently
 * merge those two rows into one, each write clobbering the other's numbers.
 * `.direction` already disambiguates them, so no new field is needed on
 * ParamRule itself — just a stable composite to key the UI's own state by.
 */
const rowId = (p: { key: string; direction: 'high' | 'low' }) => `${p.key}::${p.direction}`

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
    //
    // VoltAN/BN/CN etc. are the real MQTT payload field names this platform's
    // ETERNITY meters actually publish (confirmed against the device's real
    // payload spec — the previous voltageA/B/C keys here were never once
    // reported by anything: same class of dead-key bug as the removed
    // Compound Alarms catalog, just in the reading list instead).
    //
    // Over-voltage and under-voltage are two INDEPENDENT bands on the SAME
    // physical reading — one 'high', one 'low' — which is why each phase
    // gets two catalog rows sharing one key. That only works because the
    // config UI's own bookkeeping is keyed by rowId(key+direction), not key
    // alone (see rowId's doc comment above); the alarm engine itself matches
    // on .key exactly as before, so both rows evaluate independently against
    // the same live reading.
    //
    // Assumes a 230V line-to-neutral LV nominal (400V line-to-line) — the
    // Thai LV distribution standard, and the same number this catalog's
    // dead voltageA/B/C entries already assumed. If a monitored transformer
    // uses a different rated voltage, these thresholds need adjusting per
    // device via this same editor; there is no per-transformer rated-voltage
    // config to derive it from automatically yet.
    { key: 'VoltAN', label: 'Phase A-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading', riskInsight: 'Equipment damage risk (> +10% of rated 230V)' },
    { key: 'VoltAN', label: 'Phase A-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207, paramType: 'reading', riskInsight: 'Operational instability / low voltage trip (< -10% of rated 230V)' },
    { key: 'VoltBN', label: 'Phase B-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading', riskInsight: 'Equipment damage risk (> +10% of rated 230V)' },
    { key: 'VoltBN', label: 'Phase B-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207, paramType: 'reading', riskInsight: 'Operational instability / low voltage trip (< -10% of rated 230V)' },
    { key: 'VoltCN', label: 'Phase C-N Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading', riskInsight: 'Equipment damage risk (> +10% of rated 230V)' },
    { key: 'VoltCN', label: 'Phase C-N Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207, paramType: 'reading', riskInsight: 'Operational instability / low voltage trip (< -10% of rated 230V)' },
    // The device computes phase unbalance onboard and publishes it directly
    // (VoltUnbalanceAN/BN/CN) — trusted as-is, the same way oilTemp/hydrogen
    // are trusted as-is, rather than re-derived from VoltAN/BN/CN here.
    { key: 'VoltUnbalanceAN', label: 'Phase A-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading', riskInsight: 'Phase unbalance motor heating & system stress (>2% / >5%)' },
    { key: 'VoltUnbalanceBN', label: 'Phase B-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading', riskInsight: 'Phase unbalance motor heating & system stress (>2% / >5%)' },
    { key: 'VoltUnbalanceCN', label: 'Phase C-N Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading', riskInsight: 'Phase unbalance motor heating & system stress (>2% / >5%)' },
    // Line-to-line voltages, 400 V nominal — the same ±5% / ±10% bands as the
    // line-to-neutral pairs above, expressed directly in volts.
    { key: 'VoltAB', label: 'Line A-B Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 420, critical: 440, paramType: 'reading', riskInsight: 'Equipment damage risk (> +5% / +10% of rated 400V)' },
    { key: 'VoltAB', label: 'Line A-B Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 380, critical: 360, paramType: 'reading', riskInsight: 'Operational instability / low voltage trip (< -5% / -10% of rated 400V)' },
    { key: 'VoltBC', label: 'Line B-C Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 420, critical: 440, paramType: 'reading' },
    { key: 'VoltBC', label: 'Line B-C Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 380, critical: 360, paramType: 'reading' },
    { key: 'VoltCA', label: 'Line C-A Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 420, critical: 440, paramType: 'reading' },
    { key: 'VoltCA', label: 'Line C-A Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 380, critical: 360, paramType: 'reading' },
    { key: 'VoltLN_AVG', label: 'Line-Neutral Average Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253, paramType: 'reading' },
    { key: 'VoltLN_AVG', label: 'Line-Neutral Average Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207, paramType: 'reading' },
    // Line-to-line unbalance, same 2% / 5% basis as the L-N unbalance above.
    { key: 'VoltUnbalanceAB', label: 'Line A-B Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading' },
    { key: 'VoltUnbalanceBC', label: 'Line B-C Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading' },
    { key: 'VoltUnbalanceCA', label: 'Line C-A Voltage Unbalance', unit: '%', direction: 'high', warn: 2, critical: 5, paramType: 'reading' },

    // Currents, in AMPS as the meter reports them — NOT as a percent of rated
    // capacity. The Alarm List specifies over-current at ">100% / >115% of
    // rated", but no rated current is derivable here: rated_kva is stored on
    // the nameplate and nothing computes a load percentage from it, so the old
    // 'load' entry named a value no device has ever published. Alarming on the
    // measured ampere directly needs no such computation — but the correct
    // ampere for "100% of rated" differs per transformer, so these ship
    // unrationalized: named, offered, and switched OFF until the operator
    // enters the limit for that unit.
    { key: 'CurrentA', label: 'Phase A Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading', unrationalized: true, riskInsight: 'Overload / short-circuit risk — set from this transformer’s rated current' },
    { key: 'CurrentB', label: 'Phase B Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading', unrationalized: true },
    { key: 'CurrentC', label: 'Phase C Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading', unrationalized: true },
    { key: 'CurrentN', label: 'Neutral Current', unit: 'A', direction: 'high', warn: 50, critical: 100, paramType: 'reading', unrationalized: true },
    { key: 'CurrentAVG', label: 'Average Current', unit: 'A', direction: 'high', warn: 400, critical: 500, paramType: 'reading', unrationalized: true },
    // Current unbalance has no single accepted limit the way the 2%/5%
    // voltage figure does — it is derated against motor/load type — so the
    // operator sets it rather than inheriting an invented number.
    { key: 'CurrentUnbalanceA', label: 'Phase A Current Unbalance', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },
    { key: 'CurrentUnbalanceB', label: 'Phase B Current Unbalance', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },
    { key: 'CurrentUnbalanceC', label: 'Phase C Current Unbalance', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },

    // Power factor: 0.85 is the threshold Thai utilities levy a PF penalty at.
    { key: 'PFTotal', label: 'Power Factor (3-phase)', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75, paramType: 'reading', riskInsight: 'Utility power-factor penalty below 0.85' },
    { key: 'PFA', label: 'Phase A Power Factor', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75, paramType: 'reading' },
    { key: 'PFB', label: 'Phase B Power Factor', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75, paramType: 'reading' },
    { key: 'PFC', label: 'Phase C Power Factor', unit: 'PF', direction: 'low', warn: 0.85, critical: 0.75, paramType: 'reading' },

    // Frequency needs BOTH bands — the grid drifts in both directions, and a
    // high-only entry (as this used to be) cannot see an under-frequency
    // event at all. 50 Hz nominal, ±1% warning / ±2% critical.
    { key: 'Hz', label: 'Frequency — Over', unit: 'Hz', direction: 'high', warn: 50.5, critical: 51, paramType: 'reading' },
    { key: 'Hz', label: 'Frequency — Under', unit: 'Hz', direction: 'low', warn: 49.5, critical: 49, paramType: 'reading' },

    // Voltage THD: 5% warning / 8% critical is the usual LV distribution
    // practice. Current THD has no equivalent single figure — its limit is a
    // function of the short-circuit-to-load-current ratio at the point of
    // common coupling — so it is left for the operator.
    { key: 'THD_VoltAB', label: 'Voltage THD A-B', unit: '%', direction: 'high', warn: 5, critical: 8, paramType: 'reading' },
    { key: 'THD_VoltBC', label: 'Voltage THD B-C', unit: '%', direction: 'high', warn: 5, critical: 8, paramType: 'reading' },
    { key: 'THD_VoltCA', label: 'Voltage THD C-A', unit: '%', direction: 'high', warn: 5, critical: 8, paramType: 'reading' },
    { key: 'THD_CurrentA', label: 'Current THD A', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },
    { key: 'THD_CurrentB', label: 'Current THD B', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },
    { key: 'THD_CurrentC', label: 'Current THD C', unit: '%', direction: 'high', warn: 10, critical: 20, paramType: 'reading', unrationalized: true },

    // Power and energy scale with the installation, so no universal limit.
    { key: 'ActivepowerTotal', label: 'Active Power (3-phase)', unit: 'W', direction: 'high', warn: 800000, critical: 1000000, paramType: 'reading', unrationalized: true },
    { key: 'ActivepowerA', label: 'Phase A Active Power', unit: 'W', direction: 'high', warn: 300000, critical: 400000, paramType: 'reading', unrationalized: true },
    { key: 'ActivepowerB', label: 'Phase B Active Power', unit: 'W', direction: 'high', warn: 300000, critical: 400000, paramType: 'reading', unrationalized: true },
    { key: 'ActivepowerC', label: 'Phase C Active Power', unit: 'W', direction: 'high', warn: 300000, critical: 400000, paramType: 'reading', unrationalized: true },
    { key: 'ApparentpowerTotal', label: 'Apparent Power (3-phase)', unit: 'VA', direction: 'high', warn: 1000000, critical: 1250000, paramType: 'reading', unrationalized: true },
    { key: 'ApparentpowerA', label: 'Phase A Apparent Power', unit: 'VA', direction: 'high', warn: 400000, critical: 500000, paramType: 'reading', unrationalized: true },
    { key: 'ApparentpowerB', label: 'Phase B Apparent Power', unit: 'VA', direction: 'high', warn: 400000, critical: 500000, paramType: 'reading', unrationalized: true },
    { key: 'ApparentpowerC', label: 'Phase C Apparent Power', unit: 'VA', direction: 'high', warn: 400000, critical: 500000, paramType: 'reading', unrationalized: true },
    { key: 'ReactivepowerTotal', label: 'Reactive Power (3-phase)', unit: 'VAR', direction: 'high', warn: 500000, critical: 700000, paramType: 'reading', unrationalized: true },
    { key: 'ReactivepowerA', label: 'Phase A Reactive Power', unit: 'VAR', direction: 'high', warn: 200000, critical: 300000, paramType: 'reading', unrationalized: true },
    { key: 'ReactivepowerB', label: 'Phase B Reactive Power', unit: 'VAR', direction: 'high', warn: 200000, critical: 300000, paramType: 'reading', unrationalized: true },
    { key: 'ReactivepowerC', label: 'Phase C Reactive Power', unit: 'VAR', direction: 'high', warn: 200000, critical: 300000, paramType: 'reading', unrationalized: true },
    // Reported only by the short-name meter (tr-111) and left unaliased on
    // purpose — see paramMap in worker/main.go. I3p is a three-phase TOTAL
    // current, not the average CurrentAVG holds; V3pavg averages the
    // LINE-TO-LINE voltages (≈396 V), not the line-to-neutral ones
    // VoltLN_AVG averages (≈229 V). Folding either into its near-namesake
    // would compare a reading against a limit meant for a different quantity.
    { key: 'I3p', label: '3-Phase Total Current', unit: 'A', direction: 'high', warn: 1200, critical: 1500, paramType: 'reading', unrationalized: true },
    { key: 'V3pavg', label: 'Line-Line Average Voltage — Over-voltage', unit: 'V', direction: 'high', warn: 420, critical: 440, paramType: 'reading' },
    { key: 'V3pavg', label: 'Line-Line Average Voltage — Under-voltage', unit: 'V', direction: 'low', warn: 380, critical: 360, paramType: 'reading' },
    { key: 'GHG', label: 'Greenhouse Gas (meter-reported)', unit: 'gCO₂e', direction: 'high', warn: 100000, critical: 200000, paramType: 'reading', unrationalized: true, riskInsight: 'Carbon figure computed onboard the meter — cumulative, not a fault condition' },
    { key: 'kWh', label: 'Energy Counter', unit: 'kWh', direction: 'high', warn: 1000000, critical: 2000000, paramType: 'reading', unrationalized: true, riskInsight: 'Cumulative counter — rises forever; alarm only if you mean a billing ceiling' },

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
    //
    // Tbox / RHbox / RHamb are published by the real ETERNITY sensor box on
    // every frame. They ship unrationalized: enclosure temperature and
    // humidity limits depend on the cabinet's own rating and on the local dew
    // point, and there is no defensible number that holds for every site — so
    // they are named and offered, with the limit left to whoever knows the
    // installation.
    { key: 'Tbox', label: 'Enclosure Temperature', unit: '°C', direction: 'high', warn: 50, critical: 60, paramType: 'reading', unrationalized: true, riskInsight: 'RTU / electronics enclosure — set from the cabinet’s rated maximum' },
    { key: 'RHbox', label: 'Enclosure Humidity', unit: '%', direction: 'high', warn: 70, critical: 85, paramType: 'reading', unrationalized: true, riskInsight: 'Condensation risk inside the enclosure — depends on local dew point' },
    { key: 'RHamb', label: 'Ambient Humidity', unit: '%', direction: 'high', warn: 80, critical: 90, paramType: 'reading', unrationalized: true },
    { key: 'pressure', label: 'Tank Pressure', unit: 'kPa', direction: 'high', warn: 35, critical: 50, paramType: 'reading' },
    { key: 'partialDischarge', label: 'Partial Discharge (PD)', unit: 'pC', direction: 'high', warn: 200, critical: 500, paramType: 'reading' },
    { key: 'vibration', label: 'Vibration Velocity', unit: 'mm/s', direction: 'high', warn: 4.5, critical: 7.1, paramType: 'reading' },

    // ⚡️ Surge Arrester & Lightning Protection (IEC 60099-5)
    { key: 'surgeArresterCurrent', label: 'Surge Arrester Total Leakage Current', unit: 'μA', direction: 'high', warn: 500, critical: 1000, paramType: 'reading', riskInsight: 'MOV block degradation or moisture ingress per IEC 60099-5' },
    { key: 'surgeArresterResistive', label: 'Surge Arrester 3rd Harmonic Resistive Current', unit: 'μA', direction: 'high', warn: 50, critical: 100, paramType: 'reading', riskInsight: 'Direct indicator of non-linear metal oxide varistor degradation' },
    { key: 'surgeCounter', label: 'Lightning Surge Strike Count', unit: 'strikes', direction: 'high', warn: 15, critical: 30, paramType: 'reading', unrationalized: true },

    // ⚙️ On-Load Tap Changer (OLTC) Diagnostics (IEEE C57.131)
    { key: 'oltcTapPosition', label: 'OLTC Current Tap Position', unit: 'step', direction: 'high', warn: 30, critical: 33, paramType: 'reading', unrationalized: true },
    { key: 'oltcMotorCurrent', label: 'OLTC Drive Motor Operating Current', unit: 'A', direction: 'high', warn: 4.5, critical: 6.0, paramType: 'reading', riskInsight: 'Mechanical jamming, gear resistance, or brake failure' },
    { key: 'oltcOilTempDelta', label: 'OLTC Diverter vs Main Tank Temp Delta (ΔT)', unit: '°C', direction: 'high', warn: 4.0, critical: 8.0, paramType: 'reading', riskInsight: 'Severe contact coking or transition resistor overheating' },
    { key: 'oltcOperationsCount', label: 'OLTC Cumulative Tap Operations', unit: 'cycles', direction: 'high', warn: 50000, critical: 100000, paramType: 'reading', unrationalized: true },

    // 🐍 Optical Arc-Flash & Intrusion Protection
    { key: 'arcFlashOptical', label: 'Optical Arc-Flash Sensor Intensity', unit: 'lux', direction: 'high', warn: 5000, critical: 10000, paramType: 'reading', riskInsight: 'Point or loop fiber sensor detecting switchgear / bushing arcing' },
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

/**
 * Compound / Multi-condition Alarm Rules (Industrial Alarm List) — EMPTY.
 *
 * This catalog used to carry 6 transformer entries (oil temp, over/under
 * voltage, over current, voltage unbalance, external fault) with synthetic
 * keys like 'alarm_oil_temp' that no device ever reports. The alarm engine
 * matches purely by key against live telemetry (r.values[p.key] in both
 * alarmEngine.ts and the backend generator), so enabling any of these rows
 * produced a rule that looked configured — checkbox on, thresholds saved,
 * badged "Alarm List" — and never once fired, at any reading. Proved by
 * extracting evaluate() and feeding it a reading 10° past critical: the
 * compound-keyed rule raised zero events while the equivalent real
 * reading-parameter rule (key 'oilTemp') raised one.
 *
 * oilTemp and load already exist correctly-keyed in READING_PAYLOAD_CATALOG.
 * overVoltage/underVoltage/voltageUnbalance had NO working equivalent at
 * all — their 'sourceFormula' text described a percent-of-rated /
 * phase-unbalance calculation that is not implemented anywhere in the
 * readings pipeline, so there was no reading key they could have been
 * pointed at even if renamed. Reintroducing them needs that computation
 * built first, not a threshold row pointed at a value nothing produces.
 */
export const COMPOUND_ALARM_CATALOG: Record<SensorDomain, ExtendedAlarmParam[]> = {
  transformer: [],
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

/**
 * Fallback row set for a transformer with nothing to scope by yet — no
 * display-params configured, no telemetry seen, no saved rule.
 *
 * These MUST be catalog keys (READING_PAYLOAD_CATALOG.transformer), not the
 * telemetry payload names. The list this replaced was copied out of
 * realtime.ts's SENSOR_KEYS ('oilTemperature', 'windingTemperature', 'load',
 * …) — those are what the wire carries, and realtime.ts's own TX_KEY_MAP is
 * the thing that renames 'oilTemp' → 'oilTemperature'. Filtering the alarm
 * catalog by them silently matched only 'hydrogen', 'moisture' and
 * 'oilLevel': both temperature alarms, the primary transformer alarms,
 * dropped out of the editor with no error anywhere. Proven by grepping the
 * catalog — `key: 'oilTemperature'` occurs zero times, `key: 'oilTemp'` once.
 *
 * 'load' has no alarm-catalog parameter at all (deliberately — see the
 * COMPOUND_ALARM_CATALOG note above); loading is alarmed via CurrentAVG/I3p.
 */
const DEFAULT_TRANSFORMER_KEYS = [
  'oilTemp', 'windingTemp', 'ambientTemp', 'bottomOilTemp', 'coreTemp',
  'VoltAN', 'VoltBN', 'VoltCN', 'VoltUnbalanceAN', 'VoltUnbalanceBN', 'VoltUnbalanceCN',
  'VoltAB', 'VoltBC', 'VoltCA', 'VoltLN_AVG',
  'CurrentA', 'CurrentB', 'CurrentC', 'CurrentAVG',
  'PFTotal', 'Hz',
  'ActivepowerTotal',
  'hydrogen', 'methane', 'acetylene', 'ethylene', 'ethane', 'co', 'co2',
  'moisture', 'oilLevel', 'pressure', 'vibration',
]

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
  applyAllLabel,
  mode = 'device',
  targetDeviceIds,
}: {
  domain?: SensorDomain
  nodeId?: string
  orgId?: string
  onApplyAll?: (rule: NodeAlarmRule) => void
  /** Overrides the onApplyAll button's text — e.g. a caller that scopes the bulk-apply to one department/user, so the button never says "All Devices" for a narrower action. */
  applyAllLabel?: string
  /**
   * 'device' (default): the shared, org-visible rule everyone sees for this
   * node — reads/writes alarm_rules via getRule/putRule + the shared
   * useAlarmDB store.
   * 'personal': the CALLER's own independent overlay ("notify me when MY
   * threshold is crossed") — reads/writes user_node_rules via
   * getMyNodeRule/putMyNodeRule, never touches alarm_rules or useAlarmDB, so
   * it can never clobber (or be clobbered by) the shared device rule's
   * cached view for this same node.
   */
  mode?: 'device' | 'personal'
  /** Optional filter of device IDs in the active scope (e.g. from department/user bulk selection) */
  targetDeviceIds?: Set<string>
}) {
  const live = useIsLive()
  const schema = getAlarmSchema(domain)
  const setRule = useAlarmDB((s) => s.setRule)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)
  const { labels, labelOf } = useParamLabels(orgId || '', domain, nodeId)
  const { devices } = useManagedDevices(orgId || '')

  /** 'reported' = only what this device sends; 'all' = the whole catalog. */
  const [scopeFilter, setScopeFilter] = useState<'reported' | 'all'>('reported')
  /**
   * Keys the SAVED rule already covers. Kept apart from `vals`, which the
   * seeding effect fills for every catalog row — so `vals` cannot answer
   * "was this parameter actually configured on this device", and using it
   * to decide visibility would show all 80 rows again.
   */
  const [ruleKeys, setRuleKeys] = useState<Set<string>>(new Set())

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
    if (!live) return
    let cancelled = false

    const targetNodeIds = nodeId
      ? [nodeId]
      : (targetDeviceIds && targetDeviceIds.size > 0 ? Array.from(targetDeviceIds) : [])

    if (nodeId) {
      const fetchLatest = () => {
        api.latest(nodeId).then((r) => {
          if (cancelled || !r?.values) return
          setLiveReadings(r.values)
          setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Object.keys(r.values)])))
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

      // Discover historical parameters from api.readings
      api.readings(nodeId, 720, 3600).then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        const keys = new Set<string>()
        rows.forEach((r: any) => { if (r.param_key) keys.add(r.param_key) })
        if (keys.size > 0) {
          setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Array.from(keys)])))
        }
      }).catch(() => {})

      return () => {
        cancelled = true
        clearInterval(pollId)
        unsubscribe()
      }
    } else if (targetNodeIds.length > 0) {
      // Discover parameters across multiple selected devices
      const fetchMulti = () => {
        Promise.allSettled(targetNodeIds.slice(0, 10).map((id) => api.latest(id))).then((results) => {
          if (cancelled) return
          const combined: Record<string, number> = {}
          const keys = new Set<string>()
          for (const res of results) {
            if (res.status === 'fulfilled' && res.value?.values) {
              Object.entries(res.value.values).forEach(([k, v]) => {
                keys.add(k)
                if (typeof v === 'number' && combined[k] === undefined) combined[k] = v
              })
            }
          }
          if (keys.size > 0) {
            setLiveReadings((prev) => ({ ...prev, ...combined }))
            setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Array.from(keys)])))
          }
        })
      }
      fetchMulti()
      const pollId = setInterval(fetchMulti, 8000)

      // Also discover history from readings across selected devices
      Promise.allSettled(targetNodeIds.slice(0, 5).map((id) => api.readings(id, 720, 3600))).then((results) => {
        if (cancelled) return
        const keys = new Set<string>()
        for (const res of results) {
          if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            res.value.forEach((r: any) => { if (r.param_key) keys.add(r.param_key) })
          }
        }
        if (keys.size > 0) {
          setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Array.from(keys)])))
        }
      }).catch(() => {})

      return () => {
        cancelled = true
        clearInterval(pollId)
      }
    } else {
      setLiveReadings({})
    }
  }, [live, nodeId, targetDeviceIds])

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
      setDiscoveredWireKeys((prev) => Array.from(new Set([...prev, ...Array.from(keys)])))
    }
  }, [nodeId, devices, domain])

  // -------------------------------------------------------------------------
  // Unified Parameter List: Catalog + Live Samples + Display Params + Custom
  // -------------------------------------------------------------------------
  // Devices in the active target scope (single device, selected departments/users, or full domain)
  const scopedDevices = useMemo(() => {
    if (nodeId) {
      return devices.filter((d) => d.id === nodeId)
    }
    if (targetDeviceIds && targetDeviceIds.size > 0) {
      return devices.filter((d) => d.domain === domain && targetDeviceIds.has(d.id))
    }
    return devices.filter((d) => d.domain === domain)
  }, [devices, domain, nodeId, targetDeviceIds])

  // Active keys reported across the active target scope (union of all reporting devices in scope)
  const activeKeysAcrossScope = useMemo(() => {
    const s = new Set<string>()
    Object.keys(liveReadings).forEach((k) => s.add(k))
    discoveredWireKeys.forEach((k) => s.add(k))
    if (nodeId) {
      const dev = devices.find((d) => d.id === nodeId) as { lastSample?: Record<string, unknown> } | undefined
      if (dev?.lastSample) Object.keys(dev.lastSample).forEach((k) => s.add(k))
    } else {
      for (const dev of scopedDevices) {
        if ((dev as any)?.lastSample) {
          Object.keys((dev as any).lastSample).forEach((k) => s.add(k))
        }
      }
    }
    return s
  }, [nodeId, liveReadings, discoveredWireKeys, devices, scopedDevices])

  /**
   * Keys THIS device has actually reported — the same evidence SENSOR READINGS
   * is built from (api.latest + the fleet row's lastSample + readings history).
   * null on the org-level editor, where there is no single device to scope to.
   */
  const reportedKeys = useMemo(() => {
    if (!nodeId) return null
    const s = new Set<string>(Object.keys(liveReadings))
    discoveredWireKeys.forEach((k) => s.add(k))
    const dev = devices.find((d) => d.id === nodeId) as { lastSample?: Record<string, unknown> } | undefined
    if (dev?.lastSample) for (const k of Object.keys(dev.lastSample)) s.add(k)
    return s
  }, [nodeId, liveReadings, discoveredWireKeys, devices])

  const allParams: ExtendedAlarmParam[] = useMemo(() => {
    const map = new Map<string, ExtendedAlarmParam>()

    // 1. Expected catalog for this domain
    const catalog = EXPECTED_PAYLOAD_CATALOG[domain] || schema?.params || []
    for (const p of catalog) {
      // labelOf() (org-custom -> SCHEMA -> raw key) is deliberately NOT used
      // here. Two problems, both from the same root cause: schemaLabel()
      // does `ALARM_SCHEMA[domain].params.find(x => x.key === key)`, a
      // single first-match lookup with no notion of direction — so for a
      // dual-band key like VoltAN (an 'over-voltage' entry and an 'under-
      // voltage' entry sharing that key) it resolves to the SAME label for
      // BOTH catalog rows, always the first one registered. Confirmed in a
      // real browser: both rows rendered "Phase A-N Voltage — Over-voltage",
      // the second silently losing its own identity. And even without a
      // direction clash, the bare-key fallback used to discard a real,
      // deliberately-written catalog label in favor of the literal string
      // "VoltAN" whenever nobody had bothered to rename it.
      //
      // Only the org's own explicit rename should ever override this
      // catalog's per-band label — that rename is stored flat by key
      // (labels[key]), so it necessarily applies identically to every band
      // sharing that key (an org that renames "VoltAN" to "Substation A —
      // Phase A" wants that context on both bands, just not a lost "Over/
      // Under-voltage" suffix). The product-schema tier is skipped entirely
      // here in favor of this catalog's own label, which for every entry in
      // this file already IS the correct, direction-specific schema label.
      map.set(rowId(p), { ...p, label: labels[p.key] || p.label })
    }

    // Bare keys already carried by a catalog row. The catalog is keyed by
    // rowId (key::direction) because one sensor can hold two bands, but the
    // discovery lists below carry BARE keys — so they must be matched against
    // bare keys, never against the map's own rowIds.
    //
    // This used to do `map.has(k)` with a bare k against a rowId-keyed map,
    // which can never match. Every parameter the device actually publishes was
    // therefore added a SECOND time, as a phantom row with the guessed limits
    // below, and phantom rows save into the rule with enabled:true like any
    // other. On a real ETERNITY transformer publishing VoltAN ≈ 225 V that
    // produced a duplicate 'VoltAN' rule at warn 80 V / critical 100 V —
    // permanently CRITICAL on a perfectly healthy phase, while the real
    // 241.5/253 V band sat right beside it.
    const catalogKeys = new Set<string>()
    for (const p of catalog) catalogKeys.add(p.key)

    /** Placeholder shape for a key with no engineered limits behind it. */
    const discovered = (k: string): ExtendedAlarmParam => {
      const lower = k.toLowerCase()
      const unit = lower.includes('temp') ? '°C' : lower.includes('volt') || lower.startsWith('v') ? 'V' : lower.includes('curr') || lower.startsWith('i') ? 'A' : lower.includes('thd') || lower.includes('humid') || lower.includes('rh') || lower.includes('level') || lower.includes('load') || lower.includes('pct') ? '%' : ''
      const direction: 'high' | 'low' = lower.includes('level') || lower.includes('low') || lower.includes('batt') || lower.includes('pf') || lower.includes('bdv') ? 'low' : 'high'
      return {
        key: k,
        label: labelOf(k),
        unit,
        direction,
        warn: direction === 'high' ? 80 : 20,
        critical: direction === 'high' ? 100 : 10,
        paramType: 'reading',
        unrationalized: true,
      }
    }

    // 2. Add keys configured in SENSOR READINGS (DisplayParamPicker)
    for (const k of configuredDisplayKeys) {
      if (catalogKeys.has(k) || map.has(k)) continue
      map.set(k, discovered(k))
    }

    // 3. Add any dynamically discovered wire keys from live telemetry / lastSample
    for (const k of discoveredWireKeys) {
      if (k === 'time' || k === 'ts' || k === 'id' || k === 'nodeId' || k === 'orgId' || k === 'domain' || k === 'status' || k === 'alarm') continue
      if (catalogKeys.has(k) || map.has(k)) continue
      map.set(k, discovered(k))
    }

    // 4. User-created custom parameters
    for (const cp of customParams) {
      map.set(rowId(cp), { ...cp, paramType: 'reading' })
    }

    return Array.from(map.values())
  }, [domain, schema, configuredDisplayKeys, discoveredWireKeys, customParams, labelOf, labels])

  /**
   * allParams narrowed to the scope the operator has selected — the honest
   * denominator for every count this editor shows.
   *
   * The scope filter used to live inside filteredParams alone, so it hid rows
   * from the table while every badge above the table kept counting the whole
   * catalog: the header read "80 parameters mapped" and the tab read "All
   * Parameters (80)" over a table showing 9. That contradicts SENSOR READINGS
   * on the same page (which lists only what the device reports) and reads as a
   * bug in the scoping rather than what it was — a stale count.
   *
   * Category tab counts, the reading/compound split and filteredParams all
   * derive from this, so a switch to "Full catalog" moves every number
   * together. buildRule()/misordered deliberately keep using allParams: what
   * gets SAVED and validated must not depend on which rows are on screen.
   */
  const scopedParams = useMemo(() => {
    // When editing a specific single device (nodeId set), scope strictly to what THAT device actually reports in live telemetry
    const activeKeys = nodeId ? (reportedKeys || new Set<string>()) : activeKeysAcrossScope
    if (mode === 'personal') {
      // If Admin has set specific Displayed Parameters for this user/department, enforce that restriction!
      if (configuredDisplayKeys.length > 0) {
        if (nodeId && activeKeys.size > 0) {
          return allParams.filter((p) => activeKeys.has(p.key) && configuredDisplayKeys.includes(p.key))
        }
        return allParams.filter((p) => configuredDisplayKeys.includes(p.key))
      }
      // If no department/user restriction is configured by admin, show active reported keys for the device
      if (nodeId && activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key))
      }
      if (activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key))
      }
      if (!isLive() && nodeId && domain === 'transformer') {
        return allParams.filter((p) => DEFAULT_TRANSFORMER_KEYS.includes(p.key))
      }
    }

    // When scoped to what devices in scope actually report (default "Reported by device" / "Active in selection"):
    if (scopeFilter === 'reported') {
      if (nodeId && activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key))
      }
      if (activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key))
      }
      if (configuredDisplayKeys.length > 0) {
        return allParams.filter((p) => configuredDisplayKeys.includes(p.key))
      }
      if (!isLive() && nodeId && domain === 'transformer') {
        return allParams.filter((p) => DEFAULT_TRANSFORMER_KEYS.includes(p.key))
      }
    }
    return allParams
  }, [allParams, scopeFilter, nodeId, reportedKeys, activeKeysAcrossScope, configuredDisplayKeys, mode, domain])

  const activeParamsCount = useMemo(() => {
    const activeKeys = nodeId ? (reportedKeys || new Set<string>()) : activeKeysAcrossScope
    if (mode === 'personal') {
      if (configuredDisplayKeys.length > 0) {
        if (nodeId && activeKeys.size > 0) {
          return allParams.filter((p) => activeKeys.has(p.key) && configuredDisplayKeys.includes(p.key)).length
        }
        return allParams.filter((p) => configuredDisplayKeys.includes(p.key)).length
      }
      if (nodeId && activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key)).length
      }
      if (activeKeys.size > 0) {
        return allParams.filter((p) => activeKeys.has(p.key)).length
      }
      if (!isLive() && nodeId && domain === 'transformer') {
        return allParams.filter((p) => DEFAULT_TRANSFORMER_KEYS.includes(p.key)).length
      }
    }
    if (nodeId && activeKeys.size > 0) {
      return allParams.filter((p) => activeKeys.has(p.key)).length
    }
    if (activeKeys.size > 0) {
      return allParams.filter((p) => activeKeys.has(p.key)).length
    }
    if (configuredDisplayKeys.length > 0) {
      return allParams.filter((p) => configuredDisplayKeys.includes(p.key)).length
    }
    if (!isLive() && nodeId && domain === 'transformer') {
      return allParams.filter((p) => DEFAULT_TRANSFORMER_KEYS.includes(p.key)).length
    }
    return allParams.length
  }, [allParams, nodeId, reportedKeys, activeKeysAcrossScope, configuredDisplayKeys, mode, domain])

  const readingCount = useMemo(() => scopedParams.filter((p) => p.paramType !== 'compound').length, [scopedParams])
  const compoundCount = useMemo(() => scopedParams.filter((p) => p.paramType === 'compound').length, [scopedParams])

  // Active parameter configuration values
  const [vals, setVals] = useState<Record<string, { warn: number; critical: number; rate?: number; enabled?: boolean; direction?: 'high' | 'low' }>>({})
  const [dbVals, setDbVals] = useState<Record<string, { dwell_min?: number; cooldown_s?: number }>>({})
  const [dwell, setDwell] = useState(schema?.dwellMin ?? 3)
  const [hyst, setHyst] = useState(schema?.hysteresis ?? 1)
  const [healthIdx, setHealthIdx] = useState(schema?.healthIndexWarn ?? 60)

  // Seed default values when allParams changes
  useEffect(() => {
    setVals((prev) => {
      const next = { ...prev }
      for (const p of allParams) {
        if (!next[rowId(p)]) {
          next[rowId(p)] = {
            warn: p.warn,
            critical: p.critical,
            rate: p.rate?.warn,
            direction: p.direction,
            // This seed runs for EVERY row and lands in `vals`, which every
            // later read consults first — so an unconditional `true` here
            // silently re-armed the rows the unrationalized rule is meant to
            // leave off. The catalog rows still default on, as before.
            enabled: !p.unrationalized,
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

  const toggleDirection = (key: string, defaultDir: 'high' | 'low') => {
    // Invert direction state (high <-> low) and flip warn/critical numbers accordingly
    setVals((s) => {
      const current = s[key]
      const currentDir = current?.direction ?? defaultDir
      const nextDir = currentDir === 'high' ? 'low' : 'high'
      return {
        ...s,
        [key]: {
          ...current,
          direction: nextDir,
          warn: current?.critical ?? 80,
          critical: current?.warn ?? 100,
        },
      }
    })
  }

  const savedRule = useAlarmDB((s) => (nodeId ? s.rules[nodeId] : undefined))

  // Apply stored rule (from node or org)
  const applyRule = (saved: NodeAlarmRule) => {
    const savedKeys = new Set((saved.params ?? []).map((p) => rowId(p)))
    const nextVals: Record<string, { warn: number; critical: number; rate?: number; enabled?: boolean; direction?: 'high' | 'low' }> = {}
    for (const p of saved.params ?? []) {
      nextVals[rowId(p)] = {
        warn: p.warn,
        critical: p.critical,
        rate: p.rate?.warn,
        direction: p.direction,
        enabled: (p as any).enabled !== false,
      }
    }
    // Any parameter not present in the saved rule's params list is inactive (disabled)
    for (const p of allParams) {
      const rid = rowId(p)
      if (!savedKeys.has(rid) && !nextVals[rid]) {
        nextVals[rid] = {
          warn: p.warn,
          critical: p.critical,
          rate: p.rate?.warn,
          enabled: false,
        }
      }
    }
    setVals((prev) => ({ ...prev, ...nextVals }))
    // Remember which parameters this rule actually covers, so the
    // reported-only filter never hides an alarm someone configured — including
    // one whose sensor has since stopped reporting, which is exactly when you
    // most need to reach it.
    setRuleKeys(new Set((saved.params ?? []).map((p) => p.key)))
    if (saved.debounceJson) setDbVals(saved.debounceJson)
    if (saved.dwellMin !== undefined) setDwell(saved.dwellMin)
    if (saved.hysteresis !== undefined) setHyst(saved.hysteresis)
    if (saved.healthIndexWarn !== undefined) setHealthIdx(saved.healthIndexWarn)
  }

  // Load per-node saved rule (device mode: the shared useAlarmDB store, reactively synced)
  useEffect(() => {
    if (mode !== 'device' || !nodeId || !hasHydrated) return
    if (savedRule) applyRule(savedRule)
  }, [mode, nodeId, hasHydrated, savedRule])

  // Load this user's own personal rule for this node (personal mode) — a
  // separate fetch, deliberately never touching useAlarmDB, so a personal
  // edit can never overwrite (or be overwritten by) the shared device rule's
  // cached view for the same nodeId.
  //
  // A user who has never saved a personal rule yet started from the raw
  // catalog defaults (85/90 for oilTemp, etc.) — numbers that have nothing
  // to do with what the admin actually configured for THIS device, if
  // anything. Falling back to the device's real current rule (a plain read,
  // via the same GET /nodes/:id/rule the admin's own accordion uses) instead
  // means "start from what's really enforced right now, then adjust to
  // taste" — read-only until they actually press Save, at which point it
  // becomes their own independent row exactly as before.
  const [personalSource, setPersonalSource] = useState<'idle' | 'loading' | 'own' | 'inherited' | 'default'>('idle')
  useEffect(() => {
    if (mode !== 'personal' || !nodeId) return
    if (!isLive()) { setPersonalSource('default'); return }
    let cancelled = false
    setPersonalSource('loading')
    api.getMyNodeRule(nodeId).then((r) => {
      if (cancelled) return
      if (r?.rule) { applyRule(r.rule); setPersonalSource('own'); return }
      api.getRule(nodeId).then((shared) => {
        if (cancelled) return
        if (shared) { applyRule(shared); setPersonalSource('inherited'); return }
        setPersonalSource('default')
      })
    })
    return () => { cancelled = true }
  }, [mode, nodeId])

  // Load org-level saved rule
  const [orgRuleState, setOrgRuleState] = useState<'idle' | 'loading' | 'custom' | 'default'>('idle')
  const [orgRuleMeta, setOrgRuleMeta] = useState<{ updatedBy?: string | null; updatedAt?: string | null } | null>(null)
  useEffect(() => {
    if (mode !== 'device' || nodeId || !orgId || !domain) return
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
  }, [mode, nodeId, orgId, domain])

  // -------------------------------------------------------------------------
  // Filtering & Category Tabs
  // -------------------------------------------------------------------------
  const categoryCounts = useMemo(() => {
    const subset = scopedParams.filter((p) => {
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
  }, [scopedParams, paramKindFilter, domain])

  const filteredParams = useMemo(() => {
    // Already scoped to what THIS device reports (see scopedParams). The
    // catalog is a menu for every transformer this platform supports — 80
    // rows. A given unit publishes a fraction of it: the fleet's sensor box
    // sends 7 values, so 91% of the editor was parameters that device will
    // never report. That is not just noise; it is the same trap the dead-key
    // bugs came from, because every one of those rows can be enabled and
    // configured and will then never fire at any reading.
    let list = scopedParams
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
  }, [scopedParams, paramKindFilter, activeTab, searchQuery, domain])

  // Build current rule for persistence
  const buildRule = (): NodeAlarmRule | null => {
    if (!domain) return null
    const paramsOut: ParamRule[] = allParams.map((p) => {
      const v = vals[rowId(p)]
      return {
        key: p.key,
        label: p.label,
        unit: p.unit,
        direction: v?.direction ?? p.direction,
        warn: v?.warn ?? p.warn,
        critical: v?.critical ?? p.critical,
        rate: p.rate ? { ...p.rate, warn: v?.rate ?? p.rate.warn } : undefined,
        // An unrationalized row carries a guessed limit, so it only arms once
        // the operator has actually chosen one (see ExtendedAlarmParam).
        enabled: v?.enabled ?? !p.unrationalized,
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

  /** Enabled parameters whose critical limit sits on the wrong side of warn. */
  const misordered = allParams.filter((p) => {
    const v = vals[rowId(p)]
    if (!(v?.enabled ?? !p.unrationalized)) return false
    const warn = v?.warn ?? p.warn
    const critical = v?.critical ?? p.critical
    const effDir = v?.direction ?? p.direction
    if (!Number.isFinite(warn) || !Number.isFinite(critical)) return false
    return effDir === 'high' ? critical <= warn : critical >= warn
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
    if (!nodeId) return
    if (mode === 'personal') {
      if (isLive()) {
        const r = await api.putMyNodeRule(nodeId, { rule })
        if (!r) { toast.error('Could not save your personal alarm thresholds'); return }
        try {
          const s = getSession()
          if (s?.id) {
            const cfg = await api.getMyConfig(s.id)
            const p = (cfg?.prefs ?? {}) as Record<string, unknown>
            const currentChannels = (p.alertChannels ?? {}) as Record<string, unknown>
            if (!currentChannels[nodeId]) {
              currentChannels[nodeId] = {
                email: true,
                telegram: !!(p.telegramBotApi || p.telegramChatId),
                line: !!(p.lineMsgApi || p.lineUserId),
                googlechat: !!(p.googleChatApi || p.googleChatWebhook)
              }
              await api.putMyConfig(s.id, { ...p, alertChannels: currentChannels })
            }
          }
        } catch (_) {}
      }
      toast.success('Your personal alarm thresholds are saved')
      return
    }
    setRule(nodeId, rule, orgId)
    if (isLive()) {
      await api.putRule(nodeId, { orgId, rule })
    }
    toast.success('Alarm rules saved for this device')
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
      [rowId(p)]: { warn: newWarn, critical: newCritical, enabled: true },
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
      nextVals[rowId(p)] = { warn: p.warn, critical: p.critical, rate: p.rate?.warn, enabled: true }
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

  // Resolves live readings for this parameter across the scoped devices
  const getDeviceReadings = (paramKey: string) => {
    const results: Array<{ deviceId: string; deviceName: string; value: number }> = []
    if (nodeId) {
      const dev = devices.find((d) => d.id === nodeId)
      const raw = liveReadings[paramKey] ?? (dev as any)?.lastSample?.[paramKey]
      const val = typeof raw === 'number' ? raw : parseFloat(String(raw))
      if (!isNaN(val)) {
        results.push({ deviceId: nodeId, deviceName: dev?.name || nodeId, value: val })
      }
    } else {
      for (const dev of scopedDevices) {
        const raw = (dev as any)?.lastSample?.[paramKey]
        const val = typeof raw === 'number' ? raw : parseFloat(String(raw))
        if (!isNaN(val)) {
          results.push({ deviceId: dev.id, deviceName: dev.name || dev.id, value: val })
        }
      }
    }
    return results
  }

  // Live status evaluation helper with Device labeling (IIoT Best Practice: asset tagging & spread overview)
  const renderLiveReadingCell = (param: ExtendedAlarmParam) => {
    const devReadings = getDeviceReadings(param.key)
    if (!devReadings.length) {
      return <span className="text-[10px] text-slate-600 font-mono italic" title="No telemetry reported yet for this sensor">—</span>
    }

    const v = vals[rowId(param)] ?? param
    const isHigh = param.direction === 'high'

    // 1. Single device in scope or exactly 1 device reports this sensor
    if (devReadings.length === 1) {
      const dr = devReadings[0]
      const isCrit = isHigh ? dr.value >= v.critical : dr.value <= v.critical
      const isWarn = isHigh ? dr.value >= v.warn : dr.value <= v.warn
      return (
        <div
          className={clsx(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border shadow-sm',
            isCrit ? 'bg-red-950/80 text-red-300 border-red-800' :
            isWarn ? 'bg-amber-950/80 text-amber-300 border-amber-800' :
            'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
          )}
        >
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isCrit ? 'bg-red-400 animate-pulse' : isWarn ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400')} />
          <span className="text-slate-300 font-sans font-semibold max-w-[90px] truncate">{dr.deviceName}:</span>
          <span className="font-bold">{dr.value.toFixed(1)} {param.unit}</span>
          {isCrit && <span className="text-[8px] px-1 rounded bg-red-600 text-white font-extrabold uppercase">Crit</span>}
          {isWarn && !isCrit && <span className="text-[8px] px-1 rounded bg-amber-600 text-white font-extrabold uppercase">Warn</span>}
        </div>
      )
    }

    // 2. 2 to 3 devices reporting this sensor: show neat badge stack
    if (devReadings.length <= 3) {
      return (
        <div className="flex flex-col gap-1 py-0.5">
          {devReadings.map((dr) => {
            const isCrit = isHigh ? dr.value >= v.critical : dr.value <= v.critical
            const isWarn = isHigh ? dr.value >= v.warn : dr.value <= v.warn
            return (
              <div
                key={dr.deviceId}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all',
                  isCrit ? 'bg-red-950/80 text-red-300 border-red-800 animate-pulse' :
                  isWarn ? 'bg-amber-950/80 text-amber-300 border-amber-800' :
                  'bg-slate-900/90 text-slate-300 border-slate-700/80'
                )}
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isCrit ? 'bg-red-400' : isWarn ? 'bg-amber-400' : 'bg-emerald-400')} />
                <span className="text-slate-300 font-sans font-medium max-w-[80px] truncate">{dr.deviceName}:</span>
                <span className={clsx('font-bold', isCrit ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-emerald-400')}>
                  {dr.value.toFixed(1)} {param.unit}
                </span>
                {isCrit && <span className="text-[8px] px-0.5 rounded bg-red-800 text-white font-bold">CRIT</span>}
              </div>
            )
          })}
        </div>
      )
    }

    // 3. More than 3 devices: show range & worst-case summary with popover tooltip
    let minVal = devReadings[0].value
    let maxVal = devReadings[0].value
    let hasAnyCrit = false
    let hasAnyWarn = false

    for (const dr of devReadings) {
      if (dr.value < minVal) minVal = dr.value
      if (dr.value > maxVal) maxVal = dr.value
      const isCrit = isHigh ? dr.value >= v.critical : dr.value <= v.critical
      const isWarn = isHigh ? dr.value >= v.warn : dr.value <= v.warn
      if (isCrit) hasAnyCrit = true
      else if (isWarn && !hasAnyCrit) hasAnyWarn = true
    }

    return (
      <div className="relative group inline-block">
        <div
          className={clsx(
            'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border cursor-help shadow-sm transition-all',
            hasAnyCrit ? 'bg-red-950/80 text-red-300 border-red-800 animate-pulse' :
            hasAnyWarn ? 'bg-amber-950/80 text-amber-300 border-amber-800' :
            'bg-slate-900/90 text-slate-300 border-slate-700'
          )}
        >
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', hasAnyCrit ? 'bg-red-400' : hasAnyWarn ? 'bg-amber-400' : 'bg-emerald-400')} />
          <span>{minVal.toFixed(1)} – {maxVal.toFixed(1)} {param.unit}</span>
          <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-sans font-bold">
            {devReadings.length} devs
          </span>
          {hasAnyCrit && <span className="text-[8px] px-1 rounded bg-red-600 text-white font-extrabold">1+ CRIT</span>}
        </div>

        {/* Floating Tooltip displaying all devices */}
        <div className="hidden group-hover:block absolute left-0 bottom-full mb-1 z-30 w-52 p-2 rounded-lg bg-slate-950 border border-slate-700 shadow-2xl text-[10px] pointer-events-none">
          <div className="flex items-center justify-between font-bold text-white pb-1 border-b border-slate-800 mb-1">
            <span>{param.label}</span>
            <span className="text-slate-400">{devReadings.length} devices</span>
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono">
            {devReadings.map((dr) => {
              const isCrit = isHigh ? dr.value >= v.critical : dr.value <= v.critical
              const isWarn = isHigh ? dr.value >= v.warn : dr.value <= v.warn
              return (
                <div key={dr.deviceId} className="flex items-center justify-between">
                  <span className="text-slate-300 font-sans truncate max-w-[100px]">{dr.deviceName}</span>
                  <span className={clsx('font-bold', isCrit ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-emerald-400')}>
                    {dr.value.toFixed(1)} {param.unit}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
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
              {scopedParams.length} parameters mapped
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

        {mode !== 'personal' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetToFactoryDefaults}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/5 border border-slate-800"
              title="Reset all thresholds to factory baseline"
            >
              <RefreshCw size={11} /> Defaults
            </button>
            {/* toggleAll was implemented (including its toast) and never given
                a control, so "enable/disable every parameter" existed in the
                code and was unreachable in the UI. With up to 80 rows in the
                full catalog, arming or clearing them one checkbox at a time is
                the difference between using this editor and giving up on it. */}
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/5 border border-slate-800"
              title="Enable every parameter currently listed"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/5 border border-slate-800"
              title="Disable every parameter currently listed"
            >
              Disable all
            </button>
            <button
              type="button"
              onClick={() => setShowAddParam(!showAddParam)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-indigo-300 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-800/80"
            >
              <Plus size={12} /> Add Custom Param
            </button>
          </div>
        )}
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
          <span>All Parameters ({scopedParams.length})</span>
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
        {/* Hidden once empty, same convention CATEGORY_TABS already uses below
            — a permanently-"(0)" tab that opens onto nothing is clutter, not
            a feature, and every domain's compound catalog is empty now. */}
        {compoundCount > 0 && (
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
        )}
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

          {/* Scope Filter: Reported/Active in Selection vs Full Catalog (Admin only) */}
          {mode !== 'personal' && (
            <div className="flex items-center gap-1 flex-shrink-0" data-scope-filter>
              <button
                type="button"
                onClick={() => setScopeFilter('reported')}
                title={
                  nodeId
                    ? "Only parameters this device actually reports — plus any it already has an alarm on"
                    : "Only parameters actively reported across the selected devices"
                }
                className="text-[11px] px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 font-medium"
                style={scopeFilter === 'reported'
                  ? { background: 'rgba(99,102,241,0.22)', border: '1px solid #6366f1', color: '#fff' }
                  : { ...inset, color: '#94a3b8' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>{nodeId ? `This device's sensors (${activeParamsCount})` : `Active in selection (${activeParamsCount})`}</span>
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                title="Every parameter this product supports — use to configure alarm baseline across the full catalog"
                className="text-[11px] px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 font-medium"
                style={scopeFilter === 'all'
                  ? { background: 'rgba(99,102,241,0.22)', border: '1px solid #6366f1', color: '#fff' }
                  : { ...inset, color: '#94a3b8' }}
              >
                <span>Full catalog ({allParams.length})</span>
              </button>
            </div>
          )}

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
                const current = vals[rowId(p)] ?? { warn: p.warn, critical: p.critical, enabled: !p.unrationalized, rate: p.rate?.warn }
                const isEnabled = current.enabled !== false
                const devReadings = getDeviceReadings(p.key)

                return (
                  <tr
                    key={rowId(p)}
                    // Surfaced for e2e/browser/test-alarm-discovery-ui.mjs:
                    // the duplicate-row bug this guards against is only
                    // countable if the row's identity is visible in the DOM.
                    data-param-key={p.key}
                    data-param-direction={p.direction}
                    data-param-unrationalized={p.unrationalized ? 'true' : 'false'}
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
                        onChange={() => toggleEnabled(rowId(p))}
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
                      {!nodeId && scopedDevices.length > 1 && (
                        <div className="mt-1 flex items-center gap-1">
                          <span
                            className={clsx(
                              'text-[9px] px-1.5 py-0.2 rounded font-mono',
                              devReadings.length === scopedDevices.length
                                ? 'bg-indigo-950/70 text-indigo-300 border border-indigo-800/40'
                                : devReadings.length > 0
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-slate-900/50 text-slate-500 border border-slate-800/50'
                            )}
                            title={`${devReadings.length} of ${scopedDevices.length} devices in scope report this parameter`}
                          >
                            📍 {devReadings.length === scopedDevices.length ? `All ${scopedDevices.length} Devices` : `${devReadings.length}/${scopedDevices.length} Devices`}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Live Reading */}
                    <td className="py-2 px-3">
                      {renderLiveReadingCell(p)}
                    </td>

                    {/* Direction Toggle */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      {(() => {
                        const effDir = current.direction ?? p.direction
                        return (
                          <button
                            type="button"
                            onClick={() => toggleDirection(rowId(p), p.direction)}
                            disabled={!isEnabled}
                            className={clsx(
                              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all',
                              effDir === 'high'
                                ? 'bg-red-950/40 border-red-800/80 text-red-300 hover:bg-red-900/60'
                                : 'bg-blue-950/40 border-blue-800/80 text-blue-300 hover:bg-blue-900/60'
                            )}
                            title="Click to toggle High (Alarm above) vs Low (Alarm below)"
                          >
                            {effDir === 'high' ? (
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
                        )
                      })()}
                    </td>

                    {/* Warning Input */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        disabled={!isEnabled}
                        value={current.warn}
                        onChange={(e) => setVal(rowId(p), 'warn', +e.target.value)}
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
                        onChange={(e) => setVal(rowId(p), 'critical', +e.target.value)}
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
                            onChange={(e) => setVal(rowId(p), 'rate', +e.target.value)}
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

      {/* Status info for a personal editor: where these starting numbers came
          from, since there are now three possible sources. */}
      {mode === 'personal' && personalSource !== 'idle' && (
        <p className="text-[11px] text-slate-500">
          {personalSource === 'loading'
            ? 'Loading your personal thresholds…'
            : personalSource === 'own'
              ? 'Showing YOUR saved personal thresholds.'
              : personalSource === 'inherited'
                ? "You haven't set your own values yet — showing this device's current official thresholds as a starting point. Save to make these your own personal alert, independent of the official rule."
                : "You haven't set your own values yet, and this device has no official thresholds configured either — showing built-in industrial recommendations as a starting point."}
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
            <Save size={15} /> {mode === 'personal' ? 'Save My Personal Alarm Thresholds' : 'Save Device Alarm Rules'}
          </button>
        )}
        {onApplyAll && (
          <button
            onClick={applyAll}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md hover:brightness-110 transition-all"
            style={gradient}
          >
            <Save size={15} /> {applyAllLabel ?? `Apply Baseline to All ${schema?.label ?? domain} Devices`}
          </button>
        )}
      </div>
    </div>
  )
}
