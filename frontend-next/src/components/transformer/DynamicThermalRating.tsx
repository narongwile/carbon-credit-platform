'use client'

import React, { useState, useMemo } from 'react'
import { Zap, Wind, Sun, Thermometer, ShieldCheck, TrendingUp, AlertCircle, ArrowUpRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import clsx from 'clsx'

interface DynamicThermalRatingProps {
  nameplateKva?: number
  currentLoadKva?: number
  oilTemp?: number
  hotSpotTemp?: number
  coolingMode?: 'ONAN' | 'ONAF1' | 'ONAF2'
}

export default function DynamicThermalRating({
  nameplateKva = 2500,
  currentLoadKva = 1850,
  oilTemp = 64,
  hotSpotTemp = 78,
}: DynamicThermalRatingProps) {
  // Environmental Simulation Inputs
  const [ambientTemp, setAmbientTemp] = useState(26) // °C
  const [windSpeed, setWindSpeed] = useState(3.2) // m/s
  const [coolingStage, setCoolingStage] = useState<'ONAN' | 'ONAF1' | 'ONAF2'>('ONAF1')

  // IEEE C57.115 & IEC 60076-7 Dynamic Ampacity Model
  // Reference ambient = 40°C. Lower ambient provides extra convective/radiative dissipation.
  // Wind provides forced external air velocity across radiator fins.
  const dtrMetrics = useMemo(() => {
    const tempHeadroom = 40 - ambientTemp
    // Ambient correction factor: ~0.8% capacity per degree below 40°C
    const ambientFactor = 1 + (tempHeadroom * 0.008)
    // Wind cooling enhancement factor: ~1.2% per m/s above 1 m/s baseline
    const windFactor = 1 + Math.max(0, windSpeed - 1) * 0.012
    // Cooling mode stage multiplier
    const coolingMultiplier = coolingStage === 'ONAN' ? 0.80 : coolingStage === 'ONAF1' ? 1.0 : 1.25

    const dynamicRatingKva = Math.round(nameplateKva * ambientFactor * windFactor * (coolingMultiplier / 1.0))
    const dynamicRatingPct = ((dynamicRatingKva / nameplateKva) * 100).toFixed(1)
    const availableHeadroomKva = Math.max(0, dynamicRatingKva - currentLoadKva)
    const emergency2hKva = Math.round(dynamicRatingKva * 1.15)
    const hotSpotLimitC = 120
    const hotSpotMarginC = Math.max(0, hotSpotLimitC - hotSpotTemp)

    return {
      dynamicRatingKva,
      dynamicRatingPct,
      availableHeadroomKva,
      emergency2hKva,
      hotSpotLimitC,
      hotSpotMarginC,
      loadPctNameplate: ((currentLoadKva / nameplateKva) * 100).toFixed(1),
      loadPctDynamic: ((currentLoadKva / dynamicRatingKva) * 100).toFixed(1),
    }
  }, [nameplateKva, currentLoadKva, ambientTemp, windSpeed, coolingStage, hotSpotTemp])

  // 24-Hour Simulated DTR Profile vs Actual Load
  const profile24h = useMemo(() => {
    const hours = [
      { h: '00:00', amb: 22, load: 1450 },
      { h: '03:00', amb: 20, load: 1320 },
      { h: '06:00', amb: 22, load: 1680 },
      { h: '09:00', amb: 28, load: 2150 },
      { h: '12:00', amb: 34, load: 2280 },
      { h: '15:00', amb: 35, load: 2340 },
      { h: '18:00', amb: 30, load: 2100 },
      { h: '21:00', amb: 26, load: 1780 },
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

  return (
    <div className="rounded-2xl p-5 space-y-5 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-400" />
            <h3 className="text-sm font-bold text-white">Dynamic Thermal Rating (DTR) & Ampacity</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30 font-mono font-bold">
              IEEE C57.115 / IEC 60076-7
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time environmental ampacity tracking & safe load headroom optimization
          </p>
        </div>

        {/* Cooling Stage Selector */}
        <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          {[
            { id: 'ONAN' as const, label: 'ONAN (Natural)' },
            { id: 'ONAF1' as const, label: 'ONAF-1 (Forced)' },
            { id: 'ONAF2' as const, label: 'ONAF-2 (Dual)' },
          ].map((stg) => (
            <button
              key={stg.id}
              onClick={() => setCoolingStage(stg.id)}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded font-semibold transition-all',
                coolingStage === stg.id
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {stg.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI 4-Card Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/15">
          <div className="text-[10px] text-amber-300/80 uppercase font-semibold">Real-Time DTR Capacity</div>
          <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
            {dtrMetrics.dynamicRatingKva.toLocaleString()} <span className="text-xs font-normal text-slate-400">kVA</span>
          </div>
          <div className="text-[10px] text-emerald-400 mt-0.5 font-semibold flex items-center gap-0.5">
            <ArrowUpRight size={12} /> {dtrMetrics.dynamicRatingPct}% of Nameplate
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
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Hot-Spot Thermal Margin</div>
          <div className="text-xl font-black text-slate-200 font-mono mt-0.5">
            {dtrMetrics.hotSpotMarginC.toFixed(1)}°C
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Current: {hotSpotTemp}°C (Limit: {dtrMetrics.hotSpotLimitC}°C)</div>
        </div>

        <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Emergency 2h Overload</div>
          <div className="text-xl font-black text-rose-400 font-mono mt-0.5">
            {dtrMetrics.emergency2hKva.toLocaleString()} <span className="text-xs font-normal text-slate-400">kVA</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">115% DTR Boost ceiling</div>
        </div>
      </div>

      {/* Environmental Sliders */}
      <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a] grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <Thermometer size={14} className="text-rose-400" />
              <span>Ambient Air Temperature</span>
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
            <span>45°C (Extreme Heat)</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <Wind size={14} className="text-cyan-400" />
              <span>Wind Velocity (Convective Fin Cooling)</span>
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
            <span>10 m/s (Breezy)</span>
          </div>
        </div>
      </div>

      {/* 24-Hour DTR vs Actual Load Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="font-semibold text-slate-200">24-Hour Simulated DTR Capacity vs Actual Load Profile</div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Real-Time DTR
            </span>
            <span className="flex items-center gap-1 text-indigo-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> Actual Load
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-medium">
              <span className="w-2 h-0.5 bg-slate-500 inline-block" /> Nameplate (2,500 kVA)
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
    </div>
  )
}
