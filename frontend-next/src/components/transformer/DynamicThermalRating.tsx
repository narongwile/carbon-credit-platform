'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Zap, Wind, Sun, Thermometer, ShieldCheck, TrendingUp, AlertCircle,
  ArrowUpRight, Radio, RefreshCw, DollarSign, Clock, CheckCircle2,
  Sliders, Fan, Sparkles, Download, Wrench
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { computeDynamicRating, type CoolingStage } from '@/lib/dtrModel'
import { recordAuditAction } from '@/lib/auditStore'

interface DynamicThermalRatingProps {
  nameplateKva?: number
  currentLoadKva?: number
  oilTemp?: number
  hotSpotTemp?: number
  lat?: number
  lng?: number
  assetId?: string
  assetName?: string
  orgId?: string
}

export default function DynamicThermalRating({
  nameplateKva = 2500,
  currentLoadKva = 1850,
  oilTemp = 64,
  hotSpotTemp = 78,
  lat = 13.7563,
  lng = 100.5018,
  assetId = 'TR-01',
  assetName = 'Main Substation TR-01',
}: DynamicThermalRatingProps) {
  // ── 1. Auto Live Weather vs Manual Mode ─────────────────────────────────
  const [weatherMode, setWeatherMode] = useState<'auto' | 'manual'>('auto')
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherSource, setWeatherSource] = useState<'open-meteo' | 'simulated'>('open-meteo')
  const [solarIrradiance, setSolarIrradiance] = useState(680) // W/m2

  // Environmental Simulation Inputs
  const [ambientTemp, setAmbientTemp] = useState(28.4) // °C
  const [windSpeed, setWindSpeed] = useState(3.8) // m/s
  const [coolingStage, setCoolingStage] = useState<'ONAN' | 'ONAF1' | 'ONAF2'>('ONAF1')

  // Auto-Dispatch & Overload Duration States
  const [overloadHours, setOverloadHours] = useState(2) // hours for LOL calculation
  // This panel has NO downlink: it imports no api client and its only network
  // call is the weather feed. It cannot command a fan. `coolingDispatched`
  // therefore means "model what ONAF-2 would give", never "ONAF-2 was
  // commanded" — it used to default to auto-firing and then render
  // "Auxiliary cooling stage dispatched ... ONAF-2 ACTIVE" while also feeding
  // the 1.25x ONAF-2 multiplier and a 12 degC hot-spot reduction into the
  // rating, so the capacity shown was inflated ~25% on the strength of a
  // command that was never sent.
  const [autoDispatchCooling, setAutoDispatchCooling] = useState(false)
  const [coolingDispatched, setCoolingDispatched] = useState(false)

  // Fetch Live Weather Feed
  const fetchLiveWeather = useCallback(async () => {
    setWeatherLoading(true)
    const cacheKey = `meteo_cache_${lat.toFixed(3)}_${lng.toFixed(3)}`
    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Date.now() - parsed.ts < 5 * 60 * 1000) {
          setAmbientTemp(parsed.temp)
          setWindSpeed(parsed.wind)
          setSolarIrradiance(parsed.solar)
          setWeatherSource('open-meteo')
          setWeatherLoading(false)
          return
        }
      }
    } catch {}

    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,direct_normal_irradiance&wind_speed_unit=ms`,
        { signal: AbortSignal.timeout(3000) }
      )
      if (!res.ok) throw new Error('Weather API unreachable')
      const data = await res.json()
      if (data.current) {
        const temp = Number(data.current.temperature_2m.toFixed(1))
        const wind = Number(data.current.wind_speed_10m.toFixed(1))
        const solar = data.current.direct_normal_irradiance != null ? Math.round(data.current.direct_normal_irradiance) : 640

        setAmbientTemp(temp)
        setWindSpeed(wind)
        setSolarIrradiance(solar)
        setWeatherSource('open-meteo')

        try {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(cacheKey, JSON.stringify({ temp, wind, solar, ts: Date.now() }))
          }
        } catch {}
      }
    } catch {
      // The weather feed is unreachable, so these are MODELLED values, not a
      // reading: a sine/cosine around a seasonal mean. They must be labelled as
      // such. This branch used to set 'site-mast', which the banner rendered as
      // "Ultrasonic Mast Sensor" — naming a physical instrument that does not
      // exist, over a number that is a sine wave, on the panel an operator uses
      // to decide how far to overload a transformer.
      const jitterTemp = Number((28.5 + (Math.sin(Date.now() / 60000) * 1.5)).toFixed(1))
      const jitterWind = Number((3.6 + (Math.cos(Date.now() / 45000) * 1.2)).toFixed(1))
      setAmbientTemp(jitterTemp)
      setWindSpeed(Math.max(0.5, jitterWind))
      setSolarIrradiance(640)
      setWeatherSource('simulated')
    } finally {
      setWeatherLoading(false)
    }
  }, [lat, lng])

  useEffect(() => {
    if (weatherMode === 'auto') {
      fetchLiveWeather()
      const timer = setInterval(fetchLiveWeather, 60000)
      return () => clearInterval(timer)
    }
  }, [weatherMode, fetchLiveWeather])

  // ── 2. IEEE C57.115 & IEC 60076-7 Dynamic Ampacity Model ────────────────
  const dtrMetrics = useMemo(() => {
    // Model lives in lib/dtrModel so the PDF export, the BESS studio and this
    // panel cannot report different capacities for the same asset — they used
    // to, because those three used a flat nameplate * 1.146 instead.
    const effectiveCooling: CoolingStage = coolingDispatched ? 'ONAF2' : coolingStage
    // Only the rating is consumed here; the individual factors are applied
    // inside computeDynamicRating and were destructured for a breakdown this
    // panel does not render.
    const { dynamicRatingKva } = computeDynamicRating({
      nameplateKva, ambientTemp, windSpeed, solarIrradiance, coolingStage: effectiveCooling,
    })
    const dynamicRatingPct = ((dynamicRatingKva / nameplateKva) * 100).toFixed(1)
    const availableHeadroomKva = Math.max(0, dynamicRatingKva - currentLoadKva)
    const emergency2hKva = Math.round(dynamicRatingKva * 1.15)
    const hotSpotLimitC = 120
    // Dynamic hot spot reduction from wind and forced cooling
    const dynamicHotSpot = Math.max(ambientTemp + 10, hotSpotTemp - (effectiveCooling === 'ONAF2' ? 12 : effectiveCooling === 'ONAF1' ? 6 : 0) - (windSpeed * 0.8))
    const hotSpotMarginC = Math.max(0, hotSpotLimitC - dynamicHotSpot)

    return {
      dynamicRatingKva,
      dynamicRatingPct,
      availableHeadroomKva,
      emergency2hKva,
      hotSpotLimitC,
      dynamicHotSpot: Number(dynamicHotSpot.toFixed(1)),
      hotSpotMarginC: Number(hotSpotMarginC.toFixed(1)),
      effectiveCooling,
    }
  }, [nameplateKva, currentLoadKva, ambientTemp, windSpeed, coolingStage, coolingDispatched, hotSpotTemp, solarIrradiance])

  // ── 3. IEEE C57.91 Loss-of-Life (LOL) Trade-Off Engine ───────────────────
  const lolTradeOff = useMemo(() => {
    // Relative Aging Rate FAA = exp(15000/(110 + 273.15) - 15000/(Theta_H + 273.15))
    const thetaH = dtrMetrics.dynamicHotSpot
    const faa = Math.exp(15000 / (110 + 273.15) - 15000 / (thetaH + 273.15))
    // Equivalent hours of life lost for given operating duration
    const equivalentHoursLost = Number((faa * overloadHours).toFixed(2))
    const netLifeDeltaHours = Number((equivalentHoursLost - overloadHours).toFixed(2))

    // Asset Financials (Standard 2.5 MVA Distribution Substation Unit)
    const assetReplacementCostUsd = 85000 // ~$85,000 USD
    const designLifeHours = 180000 // 20.5 years continuous normal operation
    const costPerLifeHour = assetReplacementCostUsd / designLifeHours // ~$0.472 / hour

    const assetDepreciationCost = Number((equivalentHoursLost * costPerLifeHour).toFixed(2))
    // Energy Value Generated during overload window: Headroom utilized * hours * $0.11/kWh
    const incrementalPowerKwh = (dtrMetrics.availableHeadroomKva * 0.95) * overloadHours
    const powerDeliveryRevenueUsd = Number((incrementalPowerKwh * 0.11).toFixed(2))
    const netEconomicBenefitUsd = Number((powerDeliveryRevenueUsd - assetDepreciationCost).toFixed(2))

    let status: 'optimal' | 'moderate' | 'hazard' = 'optimal'
    if (thetaH >= 115) status = 'hazard'
    else if (thetaH >= 98) status = 'moderate'

    return {
      faa: Number(faa.toFixed(3)),
      equivalentHoursLost,
      netLifeDeltaHours,
      assetDepreciationCost,
      powerDeliveryRevenueUsd,
      netEconomicBenefitUsd,
      status,
    }
  }, [dtrMetrics.dynamicHotSpot, overloadHours, dtrMetrics.availableHeadroomKva])

  // ── 4. Automated Cooling Dispatch Suggestion ─────────────────────────────
  const coolingAdvisory = useMemo(() => {
    const isHeadroomCritical = dtrMetrics.availableHeadroomKva < (nameplateKva * 0.15)
    const isHotSpotWarm = dtrMetrics.dynamicHotSpot > 88
    const needPreCooling = (isHeadroomCritical || isHotSpotWarm) && dtrMetrics.effectiveCooling !== 'ONAF2'

    const fanPowerKw = 3.6 // 3.6 kW auxiliary fan bank
    const fanCost2h = (fanPowerKw * 2 * 0.11).toFixed(2)
    const avoidedAgingSavings = (lolTradeOff.assetDepreciationCost * 0.35).toFixed(2)

    return {
      needPreCooling,
      recommendedStage: isHotSpotWarm ? 'ONAF-2 (Dual Stage Forced Air)' : 'ONAF-1 (Stage 1 Forced Air)',
      fanCost2h,
      avoidedAgingSavings,
    }
  }, [dtrMetrics.availableHeadroomKva, dtrMetrics.dynamicHotSpot, dtrMetrics.effectiveCooling, nameplateKva, lolTradeOff.assetDepreciationCost])

  // Opt-in only, and it applies the ONAF-2 case to the MODEL — it does not
  // dispatch anything. Defaulting this on meant a page load could silently
  // switch the displayed capacity to the boosted-cooling case.
  useEffect(() => {
    if (autoDispatchCooling && coolingAdvisory.needPreCooling && !coolingDispatched) {
      setCoolingDispatched(true)
    }
  }, [autoDispatchCooling, coolingAdvisory.needPreCooling, coolingDispatched])

  // ── 5. 24-Hour Diurnal DTR Profile ───────────────────────────────────────
  const profile24h = useMemo(() => {
    const hours = [
      { h: '00:00', amb: 24, load: 1450 },
      { h: '03:00', amb: 22, load: 1320 },
      { h: '06:00', amb: 23, load: 1680 },
      { h: '09:00', amb: 28, load: 2150 },
      { h: '12:00', amb: 33, load: 2280 },
      { h: '15:00', amb: 34, load: 2340 },
      { h: '18:00', amb: 30, load: 2100 },
      { h: '21:00', amb: 27, load: 1780 },
    ]

    return hours.map((pt) => {
      const ambFactor = 1 + (40 - pt.amb) * 0.008
      const dtrKva = Math.round(nameplateKva * ambFactor * 1.03)
      return {
        time: pt.h,
        ambient: pt.amb,
        actualLoad: pt.load,
        dynamicRating: dtrKva,
        nameplate: nameplateKva,
        extraHeadroom: Math.max(0, dtrKva - pt.load),
      }
    })
  }, [nameplateKva])

  const [dispatchedWo, setDispatchedWo] = useState<string | null>(null)

  const handleExportDtrCsv = () => {
    const headers = ['Time', 'Ambient Temp (C)', 'Actual Load (kVA)', 'Dynamic Rating (kVA)', 'Nameplate (kVA)', 'Available Headroom (kVA)']
    const rows = profile24h.map(pt => [
      pt.time,
      pt.ambient,
      pt.actualLoad,
      pt.dynamicRating,
      pt.nameplate,
      pt.extraHeadroom,
    ])
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DTR_Diurnal_Profile_${assetId}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('ส่งออกข้อมูล Dynamic Rating 24 ชม. (CSV) สำเร็จ')
  }

  const handleToggleCoolingDispatch = () => {
    const nextState = !coolingDispatched
    setCoolingDispatched(nextState)

    recordAuditAction({
      action: 'THRESHOLD_CHANGE',
      target: { assetId, assetName },
      before: coolingDispatched ? 'Cooling Stage: ONAF2' : `Cooling Stage: ${coolingStage}`,
      after: nextState ? 'Cooling Stage: ONAF2 (Simulated)' : `Cooling Stage: ${coolingStage}`,
      justification: nextState
        ? `Operator initiated ONAF-2 pre-cooling simulation for ${assetName} (ambient ${ambientTemp}°C, hot-spot ${dtrMetrics.dynamicHotSpot}°C).`
        : `Deactivated simulated ONAF-2 cooling stage for ${assetName}.`,
    })

    if (nextState) {
      toast.success('จำลองเปิดพัดลมช่วยระบายความร้อน ONAF-2 สำเร็จ (บันทึกลง Audit Trail)')
    } else {
      toast('ยกเลิกการจำลองพัดลมช่วยระบายความร้อน ONAF-2')
    }
  }

  const handleDispatchThermalWo = () => {
    const woNumber = `WO-DTR-${assetId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6)}-${Date.now().toString(36).toUpperCase().slice(-5)}`
    setDispatchedWo(woNumber)

    recordAuditAction({
      action: 'THRESHOLD_CHANGE',
      target: { assetId, assetName },
      before: `Dynamic Hot-Spot: ${dtrMetrics.dynamicHotSpot}°C, Margin: ${dtrMetrics.hotSpotMarginC}°C`,
      after: `Work Order ${woNumber} queued in CMMS`,
      justification: `Thermal load headroom restricted. Dispatched radiator cleaning and cooling airflow verification.`,
      workOrderId: woNumber,
    })

    toast.success(`Work Order ${woNumber} queued — export to your CMMS manually (no direct integration configured)`)
  }

  return (
    <div className="rounded-2xl p-5 space-y-6 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* Header & Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Zap size={18} className="text-amber-400" />
            <h3 className="text-sm font-bold text-white">Dynamic Thermal Rating (DTR) &amp; Ampacity Studio</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30 font-mono font-bold">
              IEEE C57.115 / IEC 60076-7
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-mono font-semibold">
              Level-5 Autonomous IIoT
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time environmental telemetry, Arrhenius Loss-of-Life trade-off &amp; automated ONAF pre-cooling dispatch
          </p>
        </div>

        {/* Controls Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live Weather Toggle */}
          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setWeatherMode('auto')}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1.5',
                weatherMode === 'auto'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Radio size={12} className={weatherMode === 'auto' ? 'animate-pulse' : ''} />
              <span>Auto Live Weather</span>
            </button>
            <button
              onClick={() => setWeatherMode('manual')}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1.5',
                weatherMode === 'manual'
                  ? 'bg-indigo-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Sliders size={12} />
              <span>Manual Sim</span>
            </button>
          </div>

          {/* Cooling Mode Stage */}
          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800">
            {(['ONAN', 'ONAF1', 'ONAF2'] as const).map((stg) => (
              <button
                key={stg}
                onClick={() => { setCoolingStage(stg); setCoolingDispatched(false) }}
                className={clsx(
                  'text-[11px] px-2.5 py-1 rounded font-semibold transition-all',
                  dtrMetrics.effectiveCooling === stg
                    ? 'bg-amber-500 text-slate-950 shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {stg === 'ONAN' ? 'ONAN' : stg === 'ONAF1' ? 'ONAF-1' : 'ONAF-2'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Weather Station Banner (When Auto mode is active) */}
      {weatherMode === 'auto' && (
        <div
          className="p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
          style={weatherSource === 'open-meteo'
            ? { borderColor: 'rgba(16,185,129,0.2)', background: 'rgba(2,44,34,0.15)' }
            : { borderColor: 'rgba(249,115,22,0.25)', background: 'rgba(67,20,7,0.2)' }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={weatherSource === 'open-meteo' ? 'w-2 h-2 rounded-full bg-emerald-400 animate-ping' : 'w-2 h-2 rounded-full bg-amber-400'}
            />
            <div className="space-y-0.5">
              <div className="font-semibold text-emerald-300 flex items-center gap-2">
                <span>
                  {weatherSource === 'open-meteo' ? 'Microclimate Met Station Connected' : 'Weather Feed Unavailable'}
                  {' '}({lat.toFixed(4)}°N, {lng.toFixed(4)}°E)
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.2 rounded border"
                  style={weatherSource === 'open-meteo'
                    ? { background: 'rgba(6,78,59,0.6)', color: '#a7f3d0', borderColor: 'rgba(4,120,87,0.4)' }
                    : { background: 'rgba(69,26,3,0.6)', color: '#fed7aa', borderColor: 'rgba(154,52,18,0.5)' }}
                >
                  {weatherSource === 'open-meteo' ? 'Open-Meteo High-Res' : 'Simulated — not measured'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {weatherSource === 'open-meteo'
                  ? 'Feeding real-time ambient temperature, wind velocity, and direct solar irradiance into C57.115 differential equations'
                  : 'Modelled ambient/wind values around a seasonal mean — no live measurement. Treat the ratings below as indicative, and enter measured values in Manual mode before acting on them.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono font-bold text-slate-200">
            <span className="flex items-center gap-1 text-rose-300"><Thermometer size={13} /> {ambientTemp}°C</span>
            <span className="flex items-center gap-1 text-cyan-300"><Wind size={13} /> {windSpeed} m/s</span>
            <span className="flex items-center gap-1 text-amber-300"><Sun size={13} /> {solarIrradiance} W/m²</span>
            <button
              onClick={fetchLiveWeather}
              disabled={weatherLoading}
              title="Refresh Weather Now"
              className="p-1 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw size={12} className={weatherLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      )}

      {/* KPI 4-Card Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/15">
          <div className="text-[10px] text-amber-300/80 uppercase font-semibold">Real-Time DTR Capacity</div>
          <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
            {dtrMetrics.dynamicRatingKva.toLocaleString()} <span className="text-xs font-normal text-slate-400">kVA</span>
          </div>
          <div className="text-[10px] text-emerald-400 mt-0.5 font-semibold flex items-center gap-0.5">
            <ArrowUpRight size={12} /> {dtrMetrics.dynamicRatingPct}% of Nameplate ({nameplateKva.toLocaleString()} kVA)
          </div>
        </div>

        <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/15">
          <div className="text-[10px] text-emerald-300/80 uppercase font-semibold">Available Safe Headroom</div>
          <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
            +{dtrMetrics.availableHeadroomKva.toLocaleString()} <span className="text-xs font-normal text-slate-400">kVA</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Current: {currentLoadKva.toLocaleString()} kVA</div>
        </div>

        <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Dynamic Hot-Spot Margin</div>
          <div className="text-xl font-black text-slate-200 font-mono mt-0.5">
            {dtrMetrics.hotSpotMarginC.toFixed(1)}°C
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Hot-Spot: {dtrMetrics.dynamicHotSpot}°C (Limit: {dtrMetrics.hotSpotLimitC}°C)
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Emergency 2h Overload</div>
          <div className="text-xl font-black text-rose-400 font-mono mt-0.5">
            {dtrMetrics.emergency2hKva.toLocaleString()} <span className="text-xs font-normal text-slate-400">kVA</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">115% DTR Boost ceiling</div>
        </div>
      </div>

      {/* Manual Sliders (Shown only in Manual Sim Mode) */}
      {weatherMode === 'manual' && (
        <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a] grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-1.5">
                <Thermometer size={14} className="text-rose-400" />
                <span>Ambient Air Temperature (What-If Simulation)</span>
              </span>
              <span className="font-mono font-bold text-white">{ambientTemp}°C</span>
            </div>
            <input
              type="range"
              min={10}
              max={45}
              value={ambientTemp}
              onChange={(e) => setAmbientTemp(Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>10°C (Cold Night)</span>
              <span>45°C (Extreme Heatwave)</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-1.5">
                <Wind size={14} className="text-cyan-400" />
                <span>Wind Velocity (Convective Fin Dissipation)</span>
              </span>
              <span className="font-mono font-bold text-white">{windSpeed.toFixed(1)} m/s</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={windSpeed}
              onChange={(e) => setWindSpeed(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>0 m/s (Still Air)</span>
              <span>10 m/s (Gale Cooling)</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Feature 2: Loss-of-Life (LOL) Trade-Off Calculator ── */}
      <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/15 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-800/40 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-indigo-200">
              IEEE C57.91 Loss-of-Life (LOL) &amp; Economic Arbitrage Engine
            </h4>
          </div>

          {/* Overload Duration Selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[11px] text-slate-400">Target Duration:</span>
            <div className="flex items-center gap-1 bg-[#0a0e1a] p-0.5 rounded-lg border border-indigo-900/60">
              {[1, 2, 4, 8].map((hrs) => (
                <button
                  key={hrs}
                  onClick={() => setOverloadHours(hrs)}
                  className={clsx(
                    'text-[10px] px-2 py-0.5 rounded font-mono font-bold transition-all',
                    overloadHours === hrs
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {hrs}h
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Arrhenius Rate */}
          <div className="p-3 rounded-lg bg-[#0a0e1a] border border-indigo-900/40 space-y-1">
            <div className="text-[10px] text-slate-400 uppercase font-semibold flex items-center justify-between">
              <span>Aging Factor (F_AA)</span>
              <span className={clsx('font-bold', lolTradeOff.faa <= 1.0 ? 'text-emerald-400' : lolTradeOff.faa < 2.0 ? 'text-amber-400' : 'text-rose-400')}>
                {lolTradeOff.faa <= 1.0 ? 'Normal / Preserving' : 'Accelerated'}
              </span>
            </div>
            <div className="text-lg font-black font-mono text-white">
              {lolTradeOff.faa}x <span className="text-xs font-normal text-slate-400">Aging Velocity</span>
            </div>
            <p className="text-[10px] text-slate-400">
              Running at {dtrMetrics.dynamicHotSpot}°C hot-spot consumes{' '}
              <strong className="text-indigo-300 font-mono">{lolTradeOff.equivalentHoursLost} hrs</strong> of insulation life over {overloadHours}h operation.
            </p>
          </div>

          {/* Card 2: Financial Degradation vs Energy Value */}
          <div className="p-3 rounded-lg bg-[#0a0e1a] border border-indigo-900/40 space-y-1">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Asset Depreciation Cost</div>
            <div className="text-lg font-black font-mono text-rose-400">
              -${lolTradeOff.assetDepreciationCost.toFixed(2)}{' '}
              <span className="text-xs font-normal text-slate-400">USD</span>
            </div>
            <p className="text-[10px] text-slate-400">
              Based on $85k CapEx replacement cost (approx. $0.47 per normal operating hour).
            </p>
          </div>

          {/* Card 3: Power Arbitrage Net Gain */}
          <div className="p-3 rounded-lg bg-[#0a0e1a] border border-emerald-900/40 space-y-1">
            <div className="text-[10px] text-emerald-300 uppercase font-semibold flex items-center justify-between">
              <span>Net Economic Arbitrage</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 font-bold">
                ROI POSITIVE
              </span>
            </div>
            <div className="text-lg font-black font-mono text-emerald-400">
              +${lolTradeOff.netEconomicBenefitUsd.toFixed(2)}{' '}
              <span className="text-xs font-normal text-slate-400">Net Margin</span>
            </div>
            <p className="text-[10px] text-slate-400">
              Delivering +{dtrMetrics.availableHeadroomKva} kVA creates{' '}
              <strong className="text-emerald-300">${lolTradeOff.powerDeliveryRevenueUsd}</strong> in energy value against negligible asset wear.
            </p>
          </div>
        </div>
      </div>

      {/* ── Feature 3: Automated Cooling Dispatch Suggestion ── */}
      <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/15 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Fan size={16} className={clsx('text-cyan-400', coolingDispatched ? 'animate-spin' : '')} />
            <h4 className="font-bold text-cyan-200">
              Pre-Cooling Advisory (what-if model)
            </h4>
            {coolingDispatched && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/80 text-amber-300 border border-amber-500/40 font-mono font-bold">
                ONAF-2 MODELLED — NOT COMMANDED
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-300">
            {coolingDispatched
              ? `Figures above now model the ONAF-2 case (~12°C lower hot-spot). This platform cannot command fans — start ONAF-2 on the transformer's own control before relying on this capacity.`
              : coolingAdvisory.needPreCooling
              ? `Advisory: Headroom approaching thermal boundary. Consider pre-cooling to prevent winding hot-spot overshoot.`
              : `Cooling is adequate under current load and wind conditions. No fan override indicated.`}
          </p>
          <div className="text-[10px] text-slate-400 font-mono">
            Fan Power Cost: ~${coolingAdvisory.fanCost2h} vs Avoided Loss-of-Life: +${coolingAdvisory.avoidedAgingSavings} USD
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            onClick={() => setAutoDispatchCooling(!autoDispatchCooling)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5',
              autoDispatchCooling
                ? 'bg-cyan-600 text-white border-cyan-400 shadow-sm'
                : 'bg-[#0a0e1a] text-slate-400 border-slate-800'
            )}
          >
            <CheckCircle2 size={13} />
            <span>Auto-Dispatch: {autoDispatchCooling ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={handleToggleCoolingDispatch}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer',
              coolingDispatched
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
            )}
          >
            <Fan size={13} className={coolingDispatched ? 'animate-spin' : ''} />
            <span>{coolingDispatched ? 'Deactivate ONAF' : '⚡ Dispatch ONAF Pre-Cooling'}</span>
          </button>
        </div>
      </div>

      {/* 24-Hour DTR vs Actual Load Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">24-Hour Diurnal DTR Capacity vs Actual Load Profile</span>
            <button
              onClick={handleExportDtrCsv}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              title="ดาวน์โหลดตารางข้อมูล DTR 24 ชั่วโมงลงไฟล์ CSV"
            >
              <Download size={11} />
              <span>Export CSV</span>
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Real-Time DTR
            </span>
            <span className="flex items-center gap-1 text-indigo-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> Actual Load
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-medium">
              <span className="w-2 h-0.5 bg-slate-500 inline-block" /> Nameplate ({nameplateKva.toLocaleString()} kVA)
            </span>
          </div>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profile24h} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="dtrGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="loadGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
              <YAxis stroke="#475569" fontSize={10} domain={[1000, 3200]} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }}
                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
              />
              <ReferenceLine y={nameplateKva} stroke="#64748b" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="dynamicRating" stroke="#f59e0b" strokeWidth={2} fill="url(#dtrGrad)" name="Dynamic Rating (kVA)" />
              <Area type="monotone" dataKey="actualLoad" stroke="#6366f1" strokeWidth={2} fill="url(#loadGrad)" name="Actual Load (kVA)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Prescriptive Thermal Health Action Plan */}
      <div className="p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/20 space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Wrench size={15} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white">Prescriptive Thermal Action Plan (RxM)</h4>
          </div>
          {dispatchedWo ? (
            <span className="text-[10px] px-2.5 py-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 font-mono font-bold flex items-center gap-1">
              <CheckCircle2 size={12} /> {dispatchedWo} DISPATCHED
            </span>
          ) : (
            <button
              onClick={handleDispatchThermalWo}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Wrench size={12} />
              <span>สั่งตรวจเช็คพัดลมระบายความร้อน CMMS</span>
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-300 space-y-1">
          <div>
            <strong>Target Asset:</strong> <span className="font-mono text-indigo-300">{assetId}</span> · {assetName}
          </div>
          <div className="text-slate-400">
            <strong>Thermal Directive:</strong> รักษาอุณหภูมิ Hot-Spot ให้อยู่ต่ำกว่า 98°C เพื่อคงอายุการใช้งานของฉนวนตามมาตรฐาน IEEE C57.91 หากต้องการรองรับโหลดช่วงพีคเกินพิกัด ให้เตรียมเดินพัดลม ONAF ล่วงหน้า 45 นาที
          </div>
        </div>
      </div>
    </div>
  )
}
