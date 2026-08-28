'use client'

import React, { useState, useMemo } from 'react'
import {
  Battery, BatteryCharging, Zap, Leaf, DollarSign, TrendingDown,
  Clock, ShieldCheck, ArrowDownRight, RefreshCw, CheckCircle2,
  Sliders, AlertTriangle, Sparkles
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid
} from 'recharts'
import clsx from 'clsx'

interface BessCoOptimizationProps {
  transformerName?: string
  orgName?: string
  nameplateKva?: number
  currentLoadKva?: number
  hotSpotTemp?: number
  dtrHeadroomKva?: number
}

export default function BessCoOptimization({
  transformerName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  nameplateKva = 2500,
  currentLoadKva = 1850,
  hotSpotTemp = 78,
  dtrHeadroomKva = 1015,
}: BessCoOptimizationProps) {
  const [bessMode, setBessMode] = useState<'peak-shave' | 'tou-arbitrage' | 'preservation'>('peak-shave')
  const defaultCapacity = Math.max(100, Math.round(nameplateKva * 0.2))
  const defaultThreshold = Math.max(200, Math.round(nameplateKva * 0.8))
  const [bessCapacityKwh, setBessCapacityKwh] = useState(defaultCapacity)
  const [batterySocPct, setBatterySocPct] = useState(82)
  const [shaveThresholdKva, setShaveThresholdKva] = useState(defaultThreshold)
  const [autoDispatchActive, setAutoDispatchActive] = useState(true)
  const [manualDischarging, setManualDischarging] = useState(false)

  // Maximum inverter discharge power (C-rate 0.5C)
  const maxDischargeKw = bessCapacityKwh * 0.5 // 250 kW

  // Real-time BESS Dispatch Metrics
  const dispatchMetrics = useMemo(() => {
    const isExceeding = currentLoadKva > shaveThresholdKva
    const dischargePowerKw = manualDischarging || (autoDispatchActive && isExceeding)
      ? Math.min(maxDischargeKw, Math.round((currentLoadKva - shaveThresholdKva) * 0.95))
      : 0

    // Effective transformer load after BESS injection
    const shavedLoadKva = currentLoadKva - Math.round(dischargePowerKw / 0.95)
    // Temperature relief: ~0.04°C per kVA relieved
    const hotSpotReliefC = Number((Math.round(dischargePowerKw / 0.95) * 0.04).toFixed(1))
    const effectiveHotSpotC = Number((hotSpotTemp - hotSpotReliefC).toFixed(1))

    // Economic & Carbon Arbitrage (TOU Tariff: Off-peak 2.6 THB vs On-peak 4.3 THB)
    const dailyKwhDispatched = Math.round(dischargePowerKw * 3.5) // 3.5 peak hours
    const touProfitThb = Math.round(dailyKwhDispatched * (4.3 - 2.6))
    const touProfitUsd = Number((touProfitThb / 36).toFixed(2))

    // Scope 2 Carbon Emissions Avoided: 0.20 kgCO2e/kWh differential
    const carbonOffsetKg = Math.round(dailyKwhDispatched * 0.20)
    const carbonOffsetTons = Number((carbonOffsetKg / 1000).toFixed(2))

    return {
      dischargePowerKw,
      shavedLoadKva,
      hotSpotReliefC,
      effectiveHotSpotC,
      touProfitThb,
      touProfitUsd,
      carbonOffsetTons,
      isExceeding,
    }
  }, [currentLoadKva, shaveThresholdKva, manualDischarging, autoDispatchActive, maxDischargeKw, hotSpotTemp])

  // 24-Hour Diurnal Load vs BESS Shaved Profile
  const profile24h = useMemo(() => {
    const hours = [
      { t: '00:00', raw: 1450, soc: 45 },
      { t: '03:00', raw: 1320, soc: 60 },
      { t: '06:00', raw: 1680, soc: 75 },
      { t: '09:00', raw: 2150, soc: 90 }, // Solar charging window
      { t: '12:00', raw: 2320, soc: 95 }, // Midday solar peak
      { t: '15:00', raw: 2280, soc: 85 },
      { t: '18:00', raw: 2450, soc: 55 }, // Evening peak discharge
      { t: '21:00', raw: 1980, soc: 40 },
    ]

    return hours.map((pt) => {
      const excess = Math.max(0, pt.raw - shaveThresholdKva)
      const bessOutKw = excess > 0 ? Math.min(maxDischargeKw, Math.round(excess * 0.95)) : 0
      const shaved = pt.raw - Math.round(bessOutKw / 0.95)

      return {
        time: pt.t,
        rawLoad: pt.raw,
        shavedLoad: shaved,
        bessPower: bessOutKw,
        batterySoc: pt.soc,
        threshold: shaveThresholdKva,
        nameplate: nameplateKva,
      }
    })
  }, [shaveThresholdKva, maxDischargeKw, nameplateKva])

  return (
    <div className="rounded-2xl p-5 space-y-6 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <BatteryCharging size={18} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Substation BESS Peak Shaving &amp; Carbon Arbitrage</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
              {bessCapacityKwh} kWh LFP ESS
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 font-mono font-bold">
              Autonomous Grid Co-Optimization
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic transformer peak load relief, thermal hot-spot mitigation &amp; Time-of-Use carbon credit arbitrage
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start lg:self-auto">
          {[
            { id: 'peak-shave' as const, label: '⚡ Peak Shave' },
            { id: 'tou-arbitrage' as const, label: '💰 TOU Arbitrage' },
            { id: 'preservation' as const, label: '🛡️ Asset Life Guard' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setBessMode(m.id)}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-md font-semibold transition-all',
                bessMode === m.id
                  ? 'bg-emerald-600 text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/15 space-y-1">
          <div className="text-[10px] text-emerald-300 uppercase font-semibold flex items-center justify-between">
            <span>BESS Discharge Active</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-900/60 text-emerald-200 font-mono font-bold">
              SOC {batterySocPct}%
            </span>
          </div>
          <div className="text-xl font-black text-emerald-400 font-mono">
            {dispatchMetrics.dischargePowerKw} <span className="text-xs font-normal text-slate-400">kW</span>
          </div>
          <div className="text-[10px] text-slate-400">
            Shaves ~{Math.round(dispatchMetrics.dischargePowerKw / 0.95)} kVA off Transformer
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/15 space-y-1">
          <div className="text-[10px] text-indigo-300 uppercase font-semibold">Hot-Spot Thermal Relief</div>
          <div className="text-xl font-black text-indigo-400 font-mono">
            -{dispatchMetrics.hotSpotReliefC}°C
          </div>
          <div className="text-[10px] text-slate-400">
            Core Temp: {dispatchMetrics.effectiveHotSpotC}°C (Was {hotSpotTemp}°C)
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/15 space-y-1">
          <div className="text-[10px] text-amber-300 uppercase font-semibold">Daily TOU Arbitrage</div>
          <div className="text-xl font-black text-amber-400 font-mono">
            +{dispatchMetrics.touProfitThb.toLocaleString()} <span className="text-xs font-normal text-slate-400">THB</span>
          </div>
          <div className="text-[10px] text-slate-400">
            Approx. +${dispatchMetrics.touProfitUsd} USD / day
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/15 space-y-1">
          <div className="text-[10px] text-cyan-300 uppercase font-semibold">Scope 2 Carbon Offset</div>
          <div className="text-xl font-black text-cyan-400 font-mono">
            +{dispatchMetrics.carbonOffsetTons} <span className="text-xs font-normal text-slate-400">tCO₂e</span>
          </div>
          <div className="text-[10px] text-slate-400">
            Clean midday solar energy shifted to peak
          </div>
        </div>
      </div>

      {/* Interactive Sliders & Auto-Dispatch Toggle */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="text-amber-400" />
              <span>Peak Shaving Trigger Threshold</span>
            </span>
            <span className="font-mono font-bold text-white">{shaveThresholdKva.toLocaleString()} kVA</span>
          </div>
          <input
            type="range"
            min={1500}
            max={2400}
            step={50}
            value={shaveThresholdKva}
            onChange={(e) => setShaveThresholdKva(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-slate-500 font-mono">
            <span>1,500 kVA (Aggressive Shave)</span>
            <span>2,400 kVA (DTR Limit)</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <Battery size={14} className="text-emerald-400" />
              <span>BESS Available Energy Capacity</span>
            </span>
            <span className="font-mono font-bold text-white">{bessCapacityKwh} kWh</span>
          </div>
          <input
            type="range"
            min={250}
            max={1000}
            step={50}
            value={bessCapacityKwh}
            onChange={(e) => setBessCapacityKwh(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-slate-500 font-mono">
            <span>250 kWh (Compact)</span>
            <span>1,000 kWh (Utility 1 MWh)</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col justify-between gap-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-semibold text-[11px]">Autonomous Control:</span>
            <button
              onClick={() => setAutoDispatchActive(!autoDispatchActive)}
              className={clsx(
                'px-2.5 py-1 rounded text-[11px] font-bold border transition-all flex items-center gap-1',
                autoDispatchActive
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              )}
            >
              <CheckCircle2 size={12} />
              <span>Auto Peak-Shave: {autoDispatchActive ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <button
            onClick={() => setManualDischarging(!manualDischarging)}
            className={clsx(
              'w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm',
              manualDischarging
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            )}
          >
            <Zap size={13} />
            <span>{manualDischarging ? 'Stop Manual BESS Injection' : '⚡ Force BESS Peak Injection'}</span>
          </button>
        </div>
      </div>

      {/* 24-Hour Diurnal Load vs Shaved Profile Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="font-semibold text-slate-200">
            24-Hour Diurnal Profile: Raw Transformer Load vs BESS Shaved Peak
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-slate-400 font-medium">
              <span className="w-2 h-0.5 bg-slate-500 inline-block" /> Raw Load (kVA)
            </span>
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Shaved Load (kVA)
            </span>
            <span className="flex items-center gap-1 text-amber-400 font-medium">
              {/* strokeDasharray is an SVG-only attribute — inert on a <span>
                  and a TS error under React 18's DOM typings. The chart's
                  actual dashed reference line is drawn by recharts; this is
                  only the legend swatch, so a dashed border reproduces the
                  look without a foreign SVG prop. */}
              <span className="w-2.5 h-0 inline-block border-t border-dashed border-amber-400" /> Shave Limit ({shaveThresholdKva.toLocaleString()} kVA)
            </span>
          </div>
        </div>

        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profile24h} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="rawGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#64748b" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#64748b" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="shavedGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
              <YAxis stroke="#475569" fontSize={10} domain={[1000, 2800]} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }}
                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
              />
              <ReferenceLine y={shaveThresholdKva} stroke="#f59e0b" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="rawLoad" stroke="#64748b" strokeWidth={1.5} fill="url(#rawGrad)" name="Raw Transformer Load (kVA)" />
              <Area type="monotone" dataKey="shavedLoad" stroke="#10b981" strokeWidth={2} fill="url(#shavedGrad)" name="Shaved Load w/ BESS (kVA)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
