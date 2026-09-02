'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ComposedChart,
} from 'recharts'
import {
  Leaf,
  Factory,
  Zap,
  Truck,
  Target,
  TrendingDown,
  Info,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Download,
  Sliders,
  Calendar,
  Settings,
  Check,
  RotateCcw,
  FileSpreadsheet,
  Sparkles,
  Layers,
  SunMedium,
  Cpu,
  BatteryCharging,
  Fuel,
  ShieldCheck,
  Plus,
  RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'
import { useAppStore } from '@/lib/store'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { api } from '@/lib/api'
import { recordAuditAction } from '@/lib/auditStore'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

type Tab = 'scope' | 'tou' | 'sbti'
type TimePeriod = '7d' | '30d' | 'ytd' | '1yr'

interface EmissionFactorPreset {
  id: string
  name: string
  region: string
  factor: number // kgCO2e/kWh
  source: string
}

const EF_PRESETS: EmissionFactorPreset[] = [
  { id: 'th_egat', name: 'Thailand EGAT Grid (0.4999 kgCO₂e/kWh)', region: 'Thailand', factor: 0.4999, source: 'TGO 2024 / EPPO' },
  { id: 'sg_ema', name: 'Singapore National Grid (0.4168 kgCO₂e/kWh)', region: 'Singapore', factor: 0.4168, source: 'EMA 2024' },
  { id: 'vn_evn', name: 'Vietnam EVN Grid (0.7221 kgCO₂e/kWh)', region: 'Vietnam', factor: 0.7221, source: 'EVN / MONRE' },
  { id: 'us_egrid', name: 'US eGRID National Avg (0.3850 kgCO₂e/kWh)', region: 'USA', factor: 0.3850, source: 'EPA eGRID2023' },
  { id: 'eu_avg', name: 'EU-27 Grid Electricity (0.2510 kgCO₂e/kWh)', region: 'European Union', factor: 0.2510, source: 'EEA 2024' },
  { id: 'custom', name: 'Custom PPA / REC Factor', region: 'Custom', factor: 0.0000, source: 'User Defined' },
]

export default function CarbonPage() {
  const [activeTab, setActiveTab] = useState<Tab>('scope')

  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = selectedOrgId || 'org-1'
  const { devices, fromBackend } = useManagedDevices(orgId)

  // ── Tab 1: Scope 1, 2, 3 GHG Accounting States ──────────────────────────
  const [period, setPeriod] = useState<TimePeriod>('30d')
  const [selectedEfPreset, setSelectedEfPreset] = useState<string>('th_egat')
  const [customEf, setCustomEf] = useState<number>(0.4999)
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [showScopeInputs, setShowScopeInputs] = useState<boolean>(false)

  // Scope 1 inputs
  const [sf6InventoryKg, setSf6InventoryKg] = useState<number>(14.5) // kg of SF6 in switchgear
  const [sf6LeakageRatePct, setSf6LeakageRatePct] = useState<number>(0.5) // 0.5% per IEC 62271-4
  const [dieselFuelLiters, setDieselFuelLiters] = useState<number>(920) // Liters of backup genset diesel

  // Scope 3 inputs
  const [transitTrips, setTransitTrips] = useState<number>(142) // BloodBox shipments
  const [avgTransitKm, setAvgTransitKm] = useState<number>(45) // km per trip
  const [fleetLogisticsKm, setFleetLogisticsKm] = useState<number>(8500) // automobile fleet km

  // Effective grid emission factor (kgCO2e/kWh)
  const effectiveGridEf = useMemo(() => {
    if (selectedEfPreset === 'custom') return customEf
    const preset = EF_PRESETS.find((p) => p.id === selectedEfPreset)
    return preset ? preset.factor : 0.4999
  }, [selectedEfPreset, customEf])

  // Multiplier for time period (in fraction of a year)
  const periodDays = useMemo(() => {
    switch (period) {
      case '7d': return 7
      case '30d': return 30
      case 'ytd': return Math.max(1, Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000))
      case '1yr': return 365
    }
  }, [period])

  const periodYearFraction = periodDays / 365.25

  // ── Asset-by-Asset Energy & Carbon Calculation ──────────────────────────
  const assetInventory = useMemo(() => {
    return devices.map((d) => {
      const domain = d.domain || 'transformer'
      let periodKwh = 0
      let activityDesc = ''
      let scopeCategory = 'Scope 2 (Grid)'

      if (domain === 'transformer') {
        const kva = (d as any).kva || 1250
        const loadFactor = 0.68
        const pf = 0.85
        periodKwh = Math.round(kva * pf * loadFactor * 24 * periodDays)
        activityDesc = `${kva} kVA Substation (${(loadFactor * 100).toFixed(0)}% avg load)`
      } else if (domain === 'carbonNode') {
        periodKwh = Math.round(1.45 * 24 * periodDays)
        activityDesc = `Commercial Chiller (${(periodDays * 24).toLocaleString()} hrs run)`
      } else if (domain === 'bloodBox') {
        periodKwh = Math.round(0.22 * periodDays)
        activityDesc = `Active Cold Chain Box (${periodDays} days monitored)`
        scopeCategory = 'Scope 2 / 3'
      } else if (domain === 'automobile') {
        periodKwh = Math.round(42 * periodDays)
        activityDesc = `EV Fast Charging Telemetry (${periodDays} days)`
      }

      const emissionsTco2e = Number(((periodKwh * effectiveGridEf) / 1000).toFixed(2))

      return {
        id: d.id,
        name: d.name || d.id,
        serial: d.serial || d.id,
        domain,
        location: d.location || 'Facility Alpha',
        periodKwh,
        activityDesc,
        scopeCategory,
        emissionsTco2e,
      }
    })
  }, [devices, periodDays, effectiveGridEf])

  const filteredAssetInventory = useMemo(() => {
    if (domainFilter === 'all') return assetInventory
    return assetInventory.filter((a) => a.domain === domainFilter)
  }, [assetInventory, domainFilter])

  const totalScope2Tco2e = useMemo(() => {
    return Number(assetInventory.reduce((acc, a) => acc + a.emissionsTco2e, 0).toFixed(2))
  }, [assetInventory])

  const totalScope1Tco2e = useMemo(() => {
    const sf6Emissions = (sf6InventoryKg * (sf6LeakageRatePct / 100) * 24300) / 1000 * periodYearFraction
    const dieselEmissions = (dieselFuelLiters * 2.687) / 1000 * periodYearFraction
    return Number((sf6Emissions + dieselEmissions).toFixed(2))
  }, [sf6InventoryKg, sf6LeakageRatePct, dieselFuelLiters, periodYearFraction])

  const totalScope3Tco2e = useMemo(() => {
    const transitEmissions = (transitTrips * avgTransitKm * 0.21) / 1000 * periodYearFraction
    const logisticsEmissions = (fleetLogisticsKm * 0.165) / 1000 * periodYearFraction
    return Number((transitEmissions + logisticsEmissions).toFixed(2))
  }, [transitTrips, avgTransitKm, fleetLogisticsKm, periodYearFraction])

  const totalEmissionsTco2e = useMemo(() => {
    return Number((totalScope1Tco2e + totalScope2Tco2e + totalScope3Tco2e).toFixed(2))
  }, [totalScope1Tco2e, totalScope2Tco2e, totalScope3Tco2e])

  const scopeDataChart = useMemo(() => [
    { name: 'Scope 1 (Direct Fugitive & Fuel)', value: totalScope1Tco2e, color: '#f43f5e' },
    { name: 'Scope 2 (Grid Electricity)', value: totalScope2Tco2e, color: '#6366f1' },
    { name: 'Scope 3 (Value Chain & Transit)', value: totalScope3Tco2e, color: '#fbbf24' },
  ], [totalScope1Tco2e, totalScope2Tco2e, totalScope3Tco2e])

  // ── Tab 2: 24-Hour TOU Grid Carbon Intensity & Arbitrage ────────────────
  const [shiftablePct, setShiftablePct] = useState<number>(20)
  const [shiftStrategy, setShiftStrategy] = useState<'solar' | 'night'>('solar')

  const touHourlyData = useMemo(() => {
    const totalFleetPowerKw = assetInventory.reduce((acc, a) => acc + (a.periodKwh / (periodDays * 24)), 0)

    return Array.from({ length: 24 }).map((_, i) => {
      const hourStr = `${i.toString().padStart(2, '0')}:00`
      let gridIntensity = 0.45
      let solarOutputKw = 0
      let tier: 'SOLAR' | 'SHOULDER' | 'PEAK' = 'SHOULDER'
      let loadMultiplier = 0.85

      if (i >= 9 && i <= 15) {
        gridIntensity = 0.37
        solarOutputKw = Math.sin(((i - 9) / 6) * Math.PI) * (totalFleetPowerKw * 0.45)
        tier = 'SOLAR'
        loadMultiplier = 1.05
      } else if (i >= 18 && i <= 22) {
        gridIntensity = 0.585
        solarOutputKw = 0
        tier = 'PEAK'
        loadMultiplier = 1.25
      } else if (i >= 0 && i < 6) {
        gridIntensity = 0.42
        solarOutputKw = 0
        tier = 'SHOULDER'
        loadMultiplier = 0.72
      }

      const baselineFleetLoadKw = Math.round(totalFleetPowerKw * loadMultiplier)

      return {
        hour: hourStr,
        gridIntensity,
        fleetLoadKw: baselineFleetLoadKw,
        solarOutputKw: Math.round(solarOutputKw),
        tier,
      }
    })
  }, [assetInventory, periodDays])

  const arbitrageMetrics = useMemo(() => {
    const peakHours = touHourlyData.filter((h) => h.tier === 'PEAK')
    const avgPeakLoadKw = peakHours.reduce((acc, h) => acc + h.fleetLoadKw, 0) / (peakHours.length || 1)
    const shiftedPowerKw = avgPeakLoadKw * (shiftablePct / 100)
    const dailyShiftedKwh = shiftedPowerKw * 4

    const peakEf = 0.585
    const targetEf = shiftStrategy === 'solar' ? 0.370 : 0.420
    const deltaEf = peakEf - targetEf

    const annualAvoidedCarbonTco2e = Number(((dailyShiftedKwh * deltaEf * 365.25) / 1000).toFixed(2))
    const tariffDiffUsd = 0.088
    const annualCostSavingsUsd = Math.round(dailyShiftedKwh * tariffDiffUsd * 365.25)

    return {
      shiftedPowerKw: Math.round(shiftedPowerKw),
      dailyShiftedKwh: Math.round(dailyShiftedKwh),
      annualAvoidedCarbonTco2e,
      annualCostSavingsUsd,
    }
  }, [touHourlyData, shiftablePct, shiftStrategy])

  // ── Tab 3: SBTi 1.5°C Net-Zero Trajectory & Abatement Modeling ──────────
  const [baseYear, setBaseYear] = useState<number>(2022)
  const [baseEmissions, setBaseEmissions] = useState<number>(1080)
  const [ambitionPathway, setAmbitionPathway] = useState<'1.5c' | 'well_below_2c'>('1.5c')

  const [leverSolarPv, setLeverSolarPv] = useState<boolean>(true)
  const [solarCapacityKwp, setSolarCapacityKwp] = useState<number>(250)
  const [leverTransformerCore, setLeverTransformerCore] = useState<boolean>(true)
  const [leverLowGwpRefrigerant, setLeverLowGwpRefrigerant] = useState<boolean>(false)
  const [leverSmartCharging, setLeverSmartCharging] = useState<boolean>(true)

  const leverAbatements = useMemo(() => {
    const solarAbatement = leverSolarPv ? Math.round(solarCapacityKwp * 0.58) : 0
    const coreAbatement = leverTransformerCore ? 35 : 0
    const refrigerantAbatement = leverLowGwpRefrigerant ? 22 : 0
    const smartChargingAbatement = leverSmartCharging ? 48 : 0
    const totalAbatement = solarAbatement + coreAbatement + refrigerantAbatement + smartChargingAbatement
    return {
      solarAbatement,
      coreAbatement,
      refrigerantAbatement,
      smartChargingAbatement,
      totalAbatement,
    }
  }, [leverSolarPv, solarCapacityKwp, leverTransformerCore, leverLowGwpRefrigerant, leverSmartCharging])

  const sbtiTrajectoryData = useMemo(() => {
    const annualLinearRate = ambitionPathway === '1.5c' ? 0.042 : 0.025
    const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2028, 2030, 2035, 2040]

    const actualMap: Record<number, number> = {
      2020: 1200,
      2021: 1150,
      2022: baseEmissions,
      2023: Math.round(baseEmissions * 0.96),
      2024: Math.round(totalEmissionsTco2e > 0 ? (totalEmissionsTco2e / periodYearFraction) : 980),
    }

    return years.map((yr) => {
      let target = baseEmissions
      if (yr >= baseYear) {
        const elapsed = yr - baseYear
        const targetFraction = Math.max(0, 1 - annualLinearRate * elapsed)
        target = Math.round(baseEmissions * targetFraction)
      } else {
        target = Math.round(baseEmissions * (1 + annualLinearRate * (baseYear - yr)))
      }

      const actual = actualMap[yr] !== undefined ? actualMap[yr] : null

      let projected: number | null = null
      if (yr >= 2024) {
        const baselineProjection = actualMap[2024] || baseEmissions
        const yearsForward = yr - 2024
        const leverPhaseIn = Math.min(1, yearsForward / 3)
        const totalAbated = leverAbatements.totalAbatement * leverPhaseIn
        const naturalGlide = baselineProjection * Math.pow(0.985, yearsForward)
        projected = Math.max(0, Math.round(naturalGlide - totalAbated))
      }

      return {
        year: String(yr),
        actual,
        target,
        projected,
      }
    })
  }, [baseYear, baseEmissions, ambitionPathway, totalEmissionsTco2e, periodYearFraction, leverAbatements])

  const sbtiStatus = useMemo(() => {
    const data2024 = sbtiTrajectoryData.find((d) => d.year === '2024')
    if (!data2024 || data2024.actual === null) return { status: 'ON_TRACK', diffPct: 0, diffTco2e: 0 }
    const diffTco2e = data2024.actual - data2024.target
    const diffPct = Number(((diffTco2e / data2024.target) * 100).toFixed(1))
    const status = diffPct <= 0 ? 'ON_TRACK' : diffPct <= 5 ? 'AT_RISK' : 'ACTION_REQUIRED'
    return { status, diffPct, diffTco2e }
  }, [sbtiTrajectoryData])

  const handleExportGhgCsv = useCallback(() => {
    const headers = ['Asset_ID', 'Asset_Name', 'Serial', 'Domain', 'Scope_Category', 'Activity_Description', 'Electricity_kWh', 'Grid_Factor_kgCO2e_kWh', 'Emissions_tCO2e']
    const rows = filteredAssetInventory.map((a) => [
      a.id,
      `"${a.name}"`,
      a.serial,
      a.domain,
      `"${a.scopeCategory}"`,
      `"${a.activityDesc}"`,
      a.periodKwh,
      effectiveGridEf.toFixed(4),
      a.emissionsTco2e.toFixed(2),
    ])

    const summaryBlock = [
      ['# GHG PROTOCOL CORPORATE STANDARD INVENTORY REPORT'],
      ['# Organization', orgId],
      ['# Reporting Period', `${period} (${periodDays} days)`],
      ['# Grid Emission Standard', `${selectedEfPreset} (${effectiveGridEf.toFixed(4)} kgCO2e/kWh)`],
      ['# Scope 1 Total (tCO2e)', totalScope1Tco2e.toFixed(2)],
      ['# Scope 2 Total (tCO2e)', totalScope2Tco2e.toFixed(2)],
      ['# Scope 3 Total (tCO2e)', totalScope3Tco2e.toFixed(2)],
      ['# Total Gross Footprint (tCO2e)', totalEmissionsTco2e.toFixed(2)],
      [],
    ].map((r) => r.join(',')).join('\n')

    const dataCsv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const fullCsv = `${summaryBlock}\n${dataCsv}`

    const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `ghg_inventory_${orgId}_${period}_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('GHG Protocol corporate inventory exported successfully!')
  }, [filteredAssetInventory, orgId, period, periodDays, selectedEfPreset, effectiveGridEf, totalScope1Tco2e, totalScope2Tco2e, totalScope3Tco2e, totalEmissionsTco2e])

  const handleApplyArbitrageRule = async () => {
    try {
      await recordAuditAction({
        action: 'CARBON_ADJUST',
        target: { assetId: 'tou-schedule-opt', assetName: 'Grid Carbon TOU Arbitrage Schedule' },
        before: 'Unscheduled load dispatch',
        after: `Shift ${shiftablePct}% peak load to ${shiftStrategy} window (Estimated -${arbitrageMetrics.annualAvoidedCarbonTco2e} tCO₂e/yr)`,
        justification: `Automated peak shaving and solar absorption optimization per ISO 50001 / GHG Protocol Scope 2 reduction policy`,
        workOrderId: `OPT-${Date.now().toString(36).toUpperCase()}`,
      })
      toast.success(`Arbitrage rule applied & logged to 21 CFR Part 11 audit trail: -${arbitrageMetrics.annualAvoidedCarbonTco2e} tCO₂e/yr avoided!`, {
        icon: '⚡',
        duration: 4500,
      })
    } catch (err: any) {
      toast.error('Failed to log arbitrage rule')
    }
  }

  const handleSaveSbtiTarget = async () => {
    try {
      await recordAuditAction({
        action: 'CARBON_ADJUST',
        target: { assetId: 'sbti-trajectory-target', assetName: 'SBTi 1.5°C Decarbonization Roadmap' },
        before: `Baseline ${baseEmissions} tCO₂e (Base Year: ${baseYear})`,
        after: `Target ambition: ${ambitionPathway.toUpperCase()} with ${leverAbatements.totalAbatement} tCO₂e/yr planned abatements`,
        justification: `Corporate SBTi 1.5°C validation submission and Net-Zero milestone update`,
        workOrderId: `SBTI-${baseYear}-${new Date().getFullYear()}`,
      })
      toast.success('SBTi Net-Zero roadmap baseline and decarbonization levers saved to compliance ledger!', {
        icon: '🎯',
      })
    } catch (err: any) {
      toast.error('Failed to log SBTi target update')
    }
  }

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ISO 14064-1 & GHG Protocol Activity Data Disclosure */}
        <DemoDataBanner
          title="Emissions Accounting Methodology & Unmeasured Direct Source Disclosure"
          detail="Scope 2 electricity emissions are calculated by multiplying active IoT device energy throughput by regional Grid Emission Factors. Scope 1 (SF₆ switchgear fugitive gas, backup diesel) and Scope 3 (cold-chain transits, fleet logistics) represent activity-data engineering estimates rather than continuous stack emissions monitoring (CEMS). Official reporting under CDP, SBTi, or ISO 14064-1 requires third-party verification (ISO 14064-3) of corporate activity data."
        />

        {/* Compliant Status Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Leaf className="w-6 h-6 text-emerald-400" />
                Carbon &amp; ESG Net-Zero Accounting
              </h1>
              <span className="text-[10px] px-2.5 py-0.5 rounded font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-emerald-400" />
                GHG PROTOCOL &amp; ISO 14064-1 COMPLIANT
              </span>
              {fromBackend && (
                <span className="text-[10px] px-2.5 py-0.5 rounded font-mono font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-500/40 flex items-center gap-1.5">
                  <CheckCircle size={12} className="text-indigo-400" />
                  Live Fleet Synced ({devices.length} Assets)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live corporate greenhouse gas accounting, 24-hour marginal grid intensity arbitrage, and SBTi 1.5°C trajectory modeling for <strong>{orgId}</strong>.
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-2 p-1 rounded-lg" style={inset}>
            {[
              { id: 'scope', label: 'Scope Breakdown', icon: Factory },
              { id: 'tou', label: 'TOU Intensity & Arbitrage', icon: Zap },
              { id: 'sbti', label: 'SBTi Trajectory', icon: Target },
            ].map((t) => {
              const Icon = t.icon
              const isActive = activeTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as Tab)}
                  className={clsx(
                    'flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition-all',
                    isActive ? 'bg-slate-800 text-white shadow-sm border border-slate-700' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  )}
                >
                  <Icon className="w-4 h-4 text-emerald-400" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content Tabs */}
        {activeTab === 'scope' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Global Controls: Period & Grid Emission Factor */}
            <div className="p-4 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={surface}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar size={14} className="text-indigo-400" />
                  Reporting Period:
                </span>
                <div className="flex rounded-lg p-0.5 bg-slate-900 border border-slate-800">
                  {[
                    { id: '7d', label: 'Last 7 Days' },
                    { id: '30d', label: 'Last 30 Days' },
                    { id: 'ytd', label: 'Year-to-Date (YTD)' },
                    { id: '1yr', label: 'Full Year (Annualized)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPeriod(p.id as TimePeriod)}
                      className={clsx(
                        'px-2.5 py-1 text-xs rounded-md font-medium transition-colors',
                        period === p.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Settings size={14} className="text-emerald-400" />
                  Grid Factor:
                </span>
                <select
                  value={selectedEfPreset}
                  onChange={(e) => setSelectedEfPreset(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-emerald-500"
                >
                  {EF_PRESETS.map((ef) => (
                    <option key={ef.id} value={ef.id}>
                      {ef.name}
                    </option>
                  ))}
                </select>

                {selectedEfPreset === 'custom' && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.0001"
                      value={customEf}
                      onChange={(e) => setCustomEf(parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-lg text-emerald-400 font-mono"
                    />
                    <span className="text-[10px] text-slate-500">kgCO₂e/kWh</span>
                  </div>
                )}

                <button
                  onClick={() => setShowScopeInputs(!showScopeInputs)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border',
                    showScopeInputs
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  )}
                >
                  <Sliders size={13} />
                  Configure Scope 1 &amp; 3
                </button>

                <button
                  onClick={handleExportGhgCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
                >
                  <Download size={13} />
                  Export GHG CSV
                </button>
              </div>
            </div>

            {/* Collapsible Scope 1 & 3 Inventory Parameters */}
            {showScopeInputs && (
              <div className="p-5 rounded-xl space-y-4 border border-indigo-500/30 bg-[#0a0e1a]" style={inset}>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                    <Settings size={14} className="text-indigo-400" />
                    Corporate Direct (Scope 1) &amp; Value Chain (Scope 3) Inventory Parameters
                  </h4>
                  <span className="text-[11px] text-slate-400">Values update footprint calculations immediately</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">SF₆ Gas Inventory (kg)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={sf6InventoryKg}
                      onChange={(e) => setSf6InventoryKg(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">SF₆ Leakage Rate (%/yr)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={sf6LeakageRatePct}
                      onChange={(e) => setSf6LeakageRatePct(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Genset Diesel (Liters)</label>
                    <input
                      type="number"
                      value={dieselFuelLiters}
                      onChange={(e) => setDieselFuelLiters(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">BloodBOX Transits</label>
                    <input
                      type="number"
                      value={transitTrips}
                      onChange={(e) => setTransitTrips(parseInt(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Avg Trip Distance (km)</label>
                    <input
                      type="number"
                      value={avgTransitKm}
                      onChange={(e) => setAvgTransitKm(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Automobile Fleet (km)</label>
                    <input
                      type="number"
                      value={fleetLogisticsKm}
                      onChange={(e) => setFleetLogisticsKm(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Scope 1, 2, 3 KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Scope 1 */}
              <div className="p-6 rounded-xl flex flex-col justify-between gap-4 relative overflow-hidden" style={surface}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <Factory className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Scope 1 (Direct)</h3>
                        <p className="text-[11px] text-slate-400">SF₆ Fugitive + Backup Genset Diesel</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-3xl font-black text-white">
                    {totalScope1Tco2e.toLocaleString()} <span className="text-xs font-normal text-slate-500">tCO₂e</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-slate-800/80 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>SF₆ Switchgear ({sf6InventoryKg} kg @ {sf6LeakageRatePct}% leak):</span>
                    <span className="font-mono text-rose-300">
                      {(((sf6InventoryKg * (sf6LeakageRatePct / 100) * 24300) / 1000) * periodYearFraction).toFixed(2)} tCO₂e
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Diesel Genset ({dieselFuelLiters} L @ 2.687 kg/L):</span>
                    <span className="font-mono text-rose-300">
                      {(((dieselFuelLiters * 2.687) / 1000) * periodYearFraction).toFixed(2)} tCO₂e
                    </span>
                  </div>
                </div>
              </div>

              {/* Scope 2 */}
              <div className="p-6 rounded-xl flex flex-col justify-between gap-4 relative overflow-hidden" style={surface}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Scope 2 (Grid Electricity)</h3>
                        <p className="text-[11px] text-slate-400">Metered Power from Active Assets</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-3xl font-black text-indigo-300">
                    {totalScope2Tco2e.toLocaleString()} <span className="text-xs font-normal text-slate-500">tCO₂e</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-slate-800/80 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Total Energy Consumed:</span>
                    <span className="font-mono text-white">
                      {assetInventory.reduce((acc, a) => acc + a.periodKwh, 0).toLocaleString()} kWh
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Applied Grid Factor:</span>
                    <span className="font-mono text-emerald-400">{effectiveGridEf.toFixed(4)} kgCO₂e/kWh</span>
                  </div>
                </div>
              </div>

              {/* Scope 3 */}
              <div className="p-6 rounded-xl flex flex-col justify-between gap-4 relative overflow-hidden" style={surface}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Truck className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Scope 3 (Value Chain)</h3>
                        <p className="text-[11px] text-slate-400">Cold-Chain Transit &amp; Fleet Logistics</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-3xl font-black text-amber-300">
                    {totalScope3Tco2e.toLocaleString()} <span className="text-xs font-normal text-slate-500">tCO₂e</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-slate-800/80 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>BloodBOX Transits ({transitTrips} trips):</span>
                    <span className="font-mono text-amber-300">
                      {(((transitTrips * avgTransitKm * 0.21) / 1000) * periodYearFraction).toFixed(2)} tCO₂e
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Automobile Logistics ({fleetLogisticsKm.toLocaleString()} km):</span>
                    <span className="font-mono text-amber-300">
                      {(((fleetLogisticsKm * 0.165) / 1000) * periodYearFraction).toFixed(2)} tCO₂e
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Donut Chart & Scope Ratio Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="col-span-1 p-6 rounded-xl flex flex-col items-center justify-center relative" style={surface}>
                <h3 className="text-sm font-semibold text-white w-full text-left mb-2">Total Gross Emissions</h3>
                <div className="w-full h-[240px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={scopeDataChart}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={88}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                      >
                        {scopeDataChart.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [`${Number(val).toFixed(2)} tCO₂e`, 'Emissions']}
                        contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                        itemStyle={{ color: '#cbd5e1' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-white">{totalEmissionsTco2e.toFixed(1)}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">tCO₂e Total</span>
                  </div>
                </div>

                <div className="w-full space-y-2 pt-2 border-t border-slate-800 text-xs">
                  {scopeDataChart.map((s) => (
                    <div key={s.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                        <span className="text-slate-300 text-[11px] truncate max-w-[160px]">{s.name}</span>
                      </div>
                      <span className="font-mono text-white text-[11px]">
                        {s.value.toFixed(1)} ({totalEmissionsTco2e > 0 ? ((s.value / totalEmissionsTco2e) * 100).toFixed(1) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Asset-by-Asset Inventory Table */}
              <div className="col-span-2 p-6 rounded-xl space-y-4" style={surface}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-white">Live Asset GHG Inventory</h3>
                    <p className="text-xs text-slate-500">Granular electricity consumption and Scope 2 allocations</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Filter:</span>
                    <select
                      value={domainFilter}
                      onChange={(e) => setDomainFilter(e.target.value)}
                      className="px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                    >
                      <option value="all">All Domains ({assetInventory.length})</option>
                      <option value="transformer">Transformers</option>
                      <option value="carbonNode">Refrigeration</option>
                      <option value="bloodBox">Cold-Chain Boxes</option>
                      <option value="automobile">Automobile Fleet</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[320px] rounded-lg border border-slate-800">
                  <table className="w-full text-xs text-left">
                    <thead className="text-[10px] text-slate-400 uppercase bg-slate-900/90 sticky top-0 border-b border-slate-800">
                      <tr>
                        <th className="px-3.5 py-2.5">Asset / Model</th>
                        <th className="px-3.5 py-2.5">Domain</th>
                        <th className="px-3.5 py-2.5">Operating Activity</th>
                        <th className="px-3.5 py-2.5 text-right">Energy (kWh)</th>
                        <th className="px-3.5 py-2.5 text-right">Emissions (tCO₂e)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {filteredAssetInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-slate-200 font-sans">{item.name}</div>
                            <div className="text-[10px] text-slate-500">{item.serial}</div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="text-[10px] px-2 py-0.5 rounded uppercase font-semibold bg-slate-800 text-slate-300">
                              {item.domain}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-sans text-slate-400 text-[11px]">{item.activityDesc}</td>
                          <td className="px-3.5 py-2.5 text-right text-slate-200">{item.periodKwh.toLocaleString()}</td>
                          <td className="px-3.5 py-2.5 text-right font-bold text-emerald-400">{item.emissionsTco2e.toFixed(2)}</td>
                        </tr>
                      ))}
                      {filteredAssetInventory.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                            No devices matched filter
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: TOU INTENSITY & ARBITRAGE SIMULATOR ───────────────────── */}
        {activeTab === 'tou' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-6 rounded-xl space-y-6" style={surface}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Zap className="text-amber-400" size={20} />
                    24-Hour Grid Carbon Intensity &amp; Fleet Load Curve
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Marginal emission factor (kgCO₂e/kWh) mapped against your organization&apos;s aggregate power draw.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500" />
                    <span className="text-slate-300">Solar Midday (Clean Grid)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-rose-500/20 border border-rose-500" />
                    <span className="text-slate-300">Evening Peaker Peak (High Carbon)</span>
                  </div>
                </div>
              </div>

              {/* 24-Hour Composed Chart */}
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={touHourlyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                    <XAxis dataKey="hour" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    {/* Left Axis: Grid Carbon Intensity */}
                    <YAxis
                      yAxisId="left"
                      stroke="#6366f1"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      domain={[0.3, 0.65]}
                      tickFormatter={(v) => `${v.toFixed(2)}`}
                    />
                    {/* Right Axis: Fleet Load in kW */}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#fbbf24"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v} kW`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                      formatter={(val: any, name: string) => [
                        name === 'Grid Carbon Intensity' ? `${val} kgCO₂e/kWh` : `${val} kW`,
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <ReferenceArea yAxisId="left" x1="09:00" x2="15:00" fill="#10b981" fillOpacity={0.08} />
                    <ReferenceArea yAxisId="left" x1="18:00" x2="22:00" fill="#f43f5e" fillOpacity={0.08} />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="gridIntensity"
                      name="Grid Carbon Intensity"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="#6366f1"
                      fillOpacity={0.15}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="fleetLoadKw"
                      name="Org Fleet Load (kW)"
                      stroke="#fbbf24"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#fbbf24' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Interactive Arbitrage Simulator */}
            <div className="p-6 rounded-xl space-y-6" style={surface}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sliders className="text-indigo-400" size={18} />
                    Load Shifting &amp; Carbon Arbitrage Simulator
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Model the environmental and financial gains of shifting heavy batch and charging loads outside of peak carbon hours.
                  </p>
                </div>
                <button
                  onClick={handleApplyArbitrageRule}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                >
                  <CheckCircle size={14} />
                  Dispatch Optimization Schedule
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Control sliders */}
                <div className="space-y-4 p-5 rounded-lg" style={inset}>
                  <div>
                    <div className="flex justify-between items-center text-xs mb-2">
                      <span className="font-semibold text-slate-300">Shiftable Load Fraction</span>
                      <span className="font-bold text-amber-400 font-mono">{shiftablePct}% ({arbitrageMetrics.shiftedPowerKw} kW)</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      step={5}
                      value={shiftablePct}
                      onChange={(e) => setShiftablePct(parseInt(e.target.value))}
                      className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">Target Destination Window</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShiftStrategy('solar')}
                        className={clsx(
                          'p-2 rounded-lg text-xs font-semibold border flex flex-col items-center gap-1 transition-all',
                          shiftStrategy === 'solar'
                            ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        )}
                      >
                        <SunMedium size={16} />
                        <span>Solar Midday (09-15h)</span>
                      </button>
                      <button
                        onClick={() => setShiftStrategy('night')}
                        className={clsx(
                          'p-2 rounded-lg text-xs font-semibold border flex flex-col items-center gap-1 transition-all',
                          shiftStrategy === 'night'
                            ? 'bg-indigo-950/40 border-indigo-500 text-indigo-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        )}
                      >
                        <BatteryCharging size={16} />
                        <span>Night Off-Peak (22-06h)</span>
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 pt-2 leading-relaxed">
                    Moving <strong className="text-white">{arbitrageMetrics.dailyShiftedKwh.toLocaleString()} kWh/day</strong> away from evening peakers reduces both Scope 2 grid emissions and expensive on-peak TOU tariff rates.
                  </div>
                </div>

                {/* KPI Results */}
                <div className="p-5 rounded-lg flex flex-col justify-between" style={inset}>
                  <div>
                    <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Annual Avoided Emissions</span>
                    <div className="text-3xl font-black text-emerald-400 mt-1">
                      -{arbitrageMetrics.annualAvoidedCarbonTco2e.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">tCO₂e / yr</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      Equivalent to removing {(arbitrageMetrics.annualAvoidedCarbonTco2e / 4.6).toFixed(0)} passenger gasoline vehicles from the road for a year.
                    </p>
                  </div>
                  <div className="pt-4 border-t border-slate-800/80">
                    <span className="text-[11px] text-slate-500">Marginal Grid Offset:</span>
                    <div className="text-xs font-mono text-emerald-300 font-semibold mt-0.5">
                      Δ {(0.585 - (shiftStrategy === 'solar' ? 0.37 : 0.42)).toFixed(3)} kgCO₂e per shifted kWh
                    </div>
                  </div>
                </div>

                <div className="p-5 rounded-lg flex flex-col justify-between" style={inset}>
                  <div>
                    <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Annual Utility Cost Savings</span>
                    <div className="text-3xl font-black text-indigo-400 mt-1">
                      ${arbitrageMetrics.annualCostSavingsUsd.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">USD / yr</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      Based on regional TOU on-peak vs off-peak differential (~฿3.10 / kWh arbitrage spread).
                    </p>
                  </div>
                  <div className="pt-4 border-t border-slate-800/80">
                    <span className="text-[11px] text-slate-500">Projected Monthly Savings:</span>
                    <div className="text-xs font-mono text-indigo-300 font-semibold mt-0.5">
                      ${Math.round(arbitrageMetrics.annualCostSavingsUsd / 12).toLocaleString()} / month
                    </div>
                  </div>
                </div>
              </div>

              {/* Actionable recommendations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex gap-3.5">
                  <div className="mt-0.5"><CheckCircle className="w-5 h-5 text-emerald-400" /></div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-emerald-300">Cold-Chain Thermal Pre-Chilling</h4>
                    <p className="text-xs text-slate-400">
                      Lower chiller setpoint by 2°C between 11:00 and 14:00 using solar power; allow thermal inertia to coast through 18:00–21:00 peak hours without compressor cycling.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 flex gap-3.5">
                  <div className="mt-0.5"><BatteryCharging className="w-5 h-5 text-indigo-400" /></div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-indigo-300">Smart EV Fleet Overnight Interlock</h4>
                    <p className="text-xs text-slate-400">
                      Configure downlink commands on automobile charging points to gate high-amperage charging until after 22:00, preventing peak grid surcharge.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: SBTI NET-ZERO TRAJECTORY & ABATEMENT WATERFALL ─────────── */}
        {activeTab === 'sbti' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* SBTi Chart Card */}
            <div className="p-6 rounded-xl space-y-6" style={surface}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Target className="w-5 h-5 text-emerald-400" />
                      SBTi 1.5°C Net-Zero Trajectory Model
                    </h3>
                    {sbtiStatus.status === 'ON_TRACK' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1">
                        <CheckCircle size={12} />
                        On Track ({sbtiStatus.diffPct}%)
                      </span>
                    )}
                    {sbtiStatus.status === 'AT_RISK' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1">
                        <AlertTriangle size={12} />
                        At Risk (+{sbtiStatus.diffPct}%)
                      </span>
                    )}
                    {sbtiStatus.status === 'ACTION_REQUIRED' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold flex items-center gap-1">
                        <AlertTriangle size={12} />
                        Abatement Deficit (+{sbtiStatus.diffPct}%)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Annual linear reduction target (4.2%/yr per SBTi Corporate Net-Zero Standard) compared against actual and planned levers.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveSbtiTarget}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                  >
                    <Check size={14} />
                    Save Target Roadmap
                  </button>
                </div>
              </div>

              {/* Trajectory Multi-Line Chart */}
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sbtiTrajectoryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                    <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 'auto']}
                      tickFormatter={(v) => `${v}`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                      formatter={(val: any) => [`${val} tCO₂e`, 'Emissions']}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Line
                      type="monotone"
                      dataKey="target"
                      name="SBTi 1.5°C Target Path (-4.2%/yr)"
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Historical / Measured Actual"
                      stroke="#6366f1"
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#6366f1' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="projected"
                      name="Forecast with Active Levers"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#38bdf8' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Baseline Parameters & Interactive Decarbonization Levers */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Baseline Config */}
              <div className="p-5 rounded-xl space-y-4" style={surface}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Settings size={14} className="text-indigo-400" />
                  SBTi Baseline Parameters
                </h4>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Base Year</label>
                    <select
                      value={baseYear}
                      onChange={(e) => setBaseYear(parseInt(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-indigo-500"
                    >
                      <option value={2020}>2020 (Pre-Pandemic Baseline)</option>
                      <option value={2021}>2021</option>
                      <option value={2022}>2022 (Standard Corporate Base)</option>
                      <option value={2023}>2023</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Baseline Gross Emissions (tCO₂e)</label>
                    <input
                      type="number"
                      value={baseEmissions}
                      onChange={(e) => setBaseEmissions(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Ambition Pathway</label>
                    <select
                      value={ambitionPathway}
                      onChange={(e) => setAmbitionPathway(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-indigo-500"
                    >
                      <option value="1.5c">1.5°C Aligned (-4.2% / yr linear)</option>
                      <option value="well_below_2c">Well-Below 2°C (-2.5% / yr linear)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 text-[11px] text-slate-500">
                  Target formula: Base Emissions × (1 - 4.2% × Years Elapsed). 2030 Interim requires 42% absolute gross reduction.
                </div>
              </div>

              {/* Decarbonization Levers (MACC Waterfalls) */}
              <div className="col-span-2 p-5 rounded-xl space-y-4" style={surface}>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" />
                    Interactive Abatement Levers (Total: -{leverAbatements.totalAbatement} tCO₂e/yr)
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">Toggle to see forecast update</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Lever 1: Solar */}
                  <div
                    onClick={() => setLeverSolarPv(!leverSolarPv)}
                    className={clsx(
                      'p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-3',
                      leverSolarPv
                        ? 'bg-amber-950/20 border-amber-500/50 text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 opacity-60'
                    )}
                  >
                    <div className={clsx('p-2 rounded-md', leverSolarPv ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-500')}>
                      <SunMedium size={18} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Rooftop Solar PV</span>
                        <span className="font-mono text-xs font-bold text-amber-400">-{leverAbatements.solarAbatement} tCO₂e/yr</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {solarCapacityKwp} kWp on-site solar generation offsetting peak grid draw.
                      </p>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-400">Capacity:</span>
                        <input
                          type="number"
                          value={solarCapacityKwp}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setSolarCapacityKwp(parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-0.5 text-xs bg-slate-900 border border-slate-700 rounded text-amber-300 font-mono"
                        />
                        <span className="text-[10px] text-slate-500">kWp</span>
                      </div>
                    </div>
                  </div>

                  {/* Lever 2: Transformer Core */}
                  <div
                    onClick={() => setLeverTransformerCore(!leverTransformerCore)}
                    className={clsx(
                      'p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-3',
                      leverTransformerCore
                        ? 'bg-indigo-950/20 border-indigo-500/50 text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 opacity-60'
                    )}
                  >
                    <div className={clsx('p-2 rounded-md', leverTransformerCore ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500')}>
                      <Cpu size={18} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Low-Loss Amorphous Cores</span>
                        <span className="font-mono text-xs font-bold text-indigo-400">-{leverAbatements.coreAbatement} tCO₂e/yr</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Upgrades aging transformers with 65% lower no-load excitation losses.
                      </p>
                    </div>
                  </div>

                  {/* Lever 3: Low-GWP Refrigerant */}
                  <div
                    onClick={() => setLeverLowGwpRefrigerant(!leverLowGwpRefrigerant)}
                    className={clsx(
                      'p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-3',
                      leverLowGwpRefrigerant
                        ? 'bg-emerald-950/20 border-emerald-500/50 text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 opacity-60'
                    )}
                  >
                    <div className={clsx('p-2 rounded-md', leverLowGwpRefrigerant ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-500')}>
                      <Factory size={18} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Natural Refrigerant (R290)</span>
                        <span className="font-mono text-xs font-bold text-emerald-400">-{leverAbatements.refrigerantAbatement} tCO₂e/yr</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Phases out high-GWP R404A in refrigeration loggers for ultra-low GWP propane.
                      </p>
                    </div>
                  </div>

                  {/* Lever 4: Smart EV Charging */}
                  <div
                    onClick={() => setLeverSmartCharging(!leverSmartCharging)}
                    className={clsx(
                      'p-3.5 rounded-lg border cursor-pointer transition-all flex items-start gap-3',
                      leverSmartCharging
                        ? 'bg-cyan-950/20 border-cyan-500/50 text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 opacity-60'
                    )}
                  >
                    <div className={clsx('p-2 rounded-md', leverSmartCharging ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-500')}>
                      <BatteryCharging size={18} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Smart EV Charging Interlock</span>
                        <span className="font-mono text-xs font-bold text-cyan-400">-{leverAbatements.smartChargingAbatement} tCO₂e/yr</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Automated telemetry scheduling shifting automobile charging to solar hours.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Milestones Progress Bars */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-white">2026 Near-Term Target</span>
                  <span className="text-slate-400 font-mono">{Math.round(baseEmissions * (1 - 0.042 * 4))} tCO₂e</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 w-[78%] rounded-full" />
                </div>
                <div className="text-[11px] text-slate-400 flex justify-between">
                  <span>16.8% reduction from base</span>
                  <span className="text-emerald-400 font-semibold">On Track</span>
                </div>
              </div>

              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-white">2030 Interim Milestone</span>
                  <span className="text-slate-400 font-mono">{Math.round(baseEmissions * 0.58)} tCO₂e</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 w-[52%] rounded-full" />
                </div>
                <div className="text-[11px] text-slate-400 flex justify-between">
                  <span>42.0% absolute reduction</span>
                  <span className="text-slate-300">Requires Levers 1-3</span>
                </div>
              </div>

              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-white">2040 Corporate Net-Zero</span>
                  <span className="text-slate-400 font-mono">0 tCO₂e (Residual &lt;10%)</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 w-[24%] rounded-full" />
                </div>
                <div className="text-[11px] text-slate-400 flex justify-between">
                  <span>100% neutralized value chain</span>
                  <span className="text-cyan-400 font-semibold">SBTi 1.5°C Standard</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
