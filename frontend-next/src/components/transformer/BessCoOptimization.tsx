'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  Battery, BatteryCharging, Zap, Leaf, DollarSign, TrendingDown,
  Clock, ShieldCheck, ArrowDownRight, RefreshCw, CheckCircle2,
  Sliders, AlertTriangle, Sparkles, Settings, Check, Download
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid
} from 'recharts'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'
import { recordAuditAction } from '@/lib/auditStore'

export interface TouTariffConfig {
  currency: string
  currencySymbol: string
  onPeakRate: number
  offPeakRate: number
  peakHours: number
  fxToUsd: number
  gridDifferentialKgCo2: number // Scope 2 kgCO2e/kWh differential
}

export const DEFAULT_TARIFF: TouTariffConfig = {
  currency: 'THB',
  currencySymbol: '฿',
  onPeakRate: 4.3,
  offPeakRate: 2.6,
  peakHours: 3.5,
  fxToUsd: 36,
  gridDifferentialKgCo2: 0.20,
}

interface BessCoOptimizationProps {
  transformerName?: string
  orgName?: string
  assetId?: string
  orgId?: string
  nameplateKva?: number
  currentLoadKva?: number
  hotSpotTemp?: number
  dtrHeadroomKva?: number
}

export default function BessCoOptimization({
  transformerName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  assetId = 'TR-01',
  orgId = 'default',
  nameplateKva = 2500,
  currentLoadKva = 1850,
  hotSpotTemp = 78,
  dtrHeadroomKva = 1015,
}: BessCoOptimizationProps) {
  const [bessMode, setBessMode] = useState<'peak-shave' | 'tou-arbitrage' | 'preservation'>('peak-shave')
  const tariffStorageKey = `pdm_bess_tariff_${orgId}`
  const [tariff, setTariff] = useState<TouTariffConfig>(DEFAULT_TARIFF)
  const [showTariffModal, setShowTariffModal] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  // Load persistent TOU tariff settings
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(tariffStorageKey)
      if (saved) {
        setTariff(JSON.parse(saved))
      }
    } catch (e) {
      console.error('Failed to load TOU tariff', e)
    }
  }, [tariffStorageKey])

  const saveTariff = (updated: TouTariffConfig) => {
    setTariff(updated)
    try {
      localStorage.setItem(tariffStorageKey, JSON.stringify(updated))
    } catch (e) {
      console.error('Failed to persist TOU tariff', e)
    }
  }

  // Slider RANGES have to scale with the asset too, not just the seeded value.
  const capacityMin = Math.max(50, Math.round(nameplateKva * 0.05 / 50) * 50)
  const capacityMax = Math.max(capacityMin + 200, Math.round(nameplateKva * 0.4 / 50) * 50)
  const thresholdMin = Math.max(50, Math.round(nameplateKva * 0.5 / 50) * 50)
  const thresholdMax = Math.max(thresholdMin + 100, Math.round(nameplateKva * 0.96 / 50) * 50)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const defaultCapacity = clamp(Math.round(nameplateKva * 0.2), capacityMin, capacityMax)
  const defaultThreshold = clamp(Math.round(nameplateKva * 0.8), thresholdMin, thresholdMax)
  const [bessCapacityKwh, setBessCapacityKwh] = useState(defaultCapacity)

  const seededFor = useRef(nameplateKva)
  useEffect(() => {
    if (seededFor.current === nameplateKva) return
    seededFor.current = nameplateKva
    setBessCapacityKwh(defaultCapacity)
    setShaveThresholdKva(defaultThreshold)
  }, [nameplateKva, defaultCapacity, defaultThreshold])

  const batterySocPct = 82
  const [shaveThresholdKva, setShaveThresholdKva] = useState(defaultThreshold)
  const [autoDispatchActive, setAutoDispatchActive] = useState(true)
  const [manualDischarging, setManualDischarging] = useState(false)

  // Maximum inverter discharge power (C-rate 0.5C)
  const maxDischargeKw = bessCapacityKwh * 0.5 // 250 kW

  // Real-time BESS Dispatch Metrics
  const dispatchMetrics = useMemo(() => {
    const isExceeding = currentLoadKva > shaveThresholdKva
    const dischargePowerKw = manualDischarging || (autoDispatchActive && isExceeding)
      ? Math.max(0, Math.min(maxDischargeKw, Math.round((currentLoadKva - shaveThresholdKva) * 0.95)))
      : 0

    // Effective transformer load after BESS injection
    const shavedLoadKva = currentLoadKva - Math.round(dischargePowerKw / 0.95)
    // Temperature relief: ~0.04°C per kVA relieved
    const hotSpotReliefC = Number((Math.round(dischargePowerKw / 0.95) * 0.04).toFixed(1))
    const effectiveHotSpotC = Number((hotSpotTemp - hotSpotReliefC).toFixed(1))

    // Economic & Carbon Arbitrage (TOU Tariff: Off-peak vs On-peak)
    const dailyKwhDispatched = Math.round(dischargePowerKw * tariff.peakHours)
    const rateDiff = Math.max(0, tariff.onPeakRate - tariff.offPeakRate)
    const touProfitLocal = Math.round(dailyKwhDispatched * rateDiff)
    const touProfitUsd = Number((touProfitLocal / tariff.fxToUsd).toFixed(2))

    // Scope 2 Carbon Emissions Avoided: kgCO2e/kWh differential
    const carbonOffsetKg = Math.round(dailyKwhDispatched * tariff.gridDifferentialKgCo2)
    const carbonOffsetTons = Number((carbonOffsetKg / 1000).toFixed(2))

    return {
      dischargePowerKw,
      shavedLoadKva,
      hotSpotReliefC,
      effectiveHotSpotC,
      touProfitLocal,
      touProfitUsd,
      carbonOffsetTons,
      isExceeding,
    }
  }, [currentLoadKva, shaveThresholdKva, manualDischarging, autoDispatchActive, maxDischargeKw, hotSpotTemp, tariff])

  const handleApplyStrategy = async () => {
    setIsApplying(true)
    await recordAuditAction({
      action: 'CONFIG_CHANGE',
      target: { assetId, assetName: transformerName },
      before: `BESS Shave Threshold: ${defaultThreshold} kVA, Mode: PEAK-SHAVE`,
      after: `BESS Mode: ${bessMode.toUpperCase()}, Shave Threshold: ${shaveThresholdKva} kVA, Capacity: ${bessCapacityKwh} kWh, Tariff: ${tariff.currency} ${tariff.onPeakRate}/${tariff.offPeakRate}`,
      justification: `Optimization strategy updated for ${transformerName} (Est. Daily TOU saving: ${tariff.currencySymbol}${dispatchMetrics.touProfitLocal.toLocaleString()})`,
    })
    setIsApplying(false)
    toast.success('BESS Co-Optimization Strategy Applied & Logged to Audit Trail')
  }

  // 24-Hour Diurnal Load vs BESS Shaved Profile.
  const profile24h = useMemo(() => {
    const shape = [
      { t: '00:00', frac: 0.58, soc: 45 },
      { t: '03:00', frac: 0.53, soc: 60 },
      { t: '06:00', frac: 0.67, soc: 75 },
      { t: '09:00', frac: 0.86, soc: 90 }, // Solar charging window
      { t: '12:00', frac: 0.93, soc: 95 }, // Midday solar peak
      { t: '15:00', frac: 0.91, soc: 85 },
      { t: '18:00', frac: 0.98, soc: 55 }, // Evening peak discharge
      { t: '21:00', frac: 0.79, soc: 40 },
    ]
    const hours = shape.map((h) => ({ t: h.t, raw: Math.round(nameplateKva * h.frac), soc: h.soc }))

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

  const handleExportSchedule = () => {
    const rows = [
      ['Time', 'Raw_Load_kVA', 'BESS_Discharge_kW', 'Shaved_Load_kVA', 'Battery_SOC_Pct', 'TOU_Rate_Type', 'Tariff_Rate'],
      ...profile24h.map((d) => {
        const isPeak = d.time >= '09:00' && d.time <= '22:00'
        return [
          d.time,
          d.rawLoad,
          d.bessPower,
          d.shavedLoad,
          d.batterySoc,
          isPeak ? 'ON_PEAK' : 'OFF_PEAK',
          isPeak ? tariff.onPeakRate : tariff.offPeakRate,
        ]
      }),
    ]
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `bess_dispatch_schedule_${assetId}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('24-Hour BESS Dispatch Schedule Exported (CSV)')
  }

  return (
    <div className="rounded-2xl p-5 space-y-6 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* nameplateKva / currentLoadKva / hotSpotTemp / dtrHeadroomKva ARE real.
          What is not: the 24h load SHAPE (fixed fractions of nameplate), the
          TOU tariff (2.6 / 4.3 THB), the 3.5 peak-hour window, the THB->USD
          rate (/36), the 0.20 kgCO2e/kWh grid differential, and the 0.04 degC
          per kVA thermal-relief coefficient. Those drive the daily-profit and
          carbon-avoided figures this panel headlines — the same class of
          externally-reportable number the carbon page and the fleet capex
          table already had to disclose. */}
      <DemoDataBanner
        title="ตัวเลขกำไรต่อวันและคาร์บอนที่ลดได้ เป็นค่าประมาณจากสมมุติฐานคงที่"
        detail="พิกัดหม้อแปลง โหลดปัจจุบัน และ Hot-Spot เป็นค่าจริงจากอุปกรณ์ แต่รูปแบบโหลด 24 ชม. อัตราค่าไฟ TOU (2.6 / 4.3 บาท) ช่วงพีค 3.5 ชม. อัตราแลกเปลี่ยน และค่า 0.20 kgCO₂e/kWh ล้วนเป็นค่าคงที่ในโค้ด ไม่ได้มาจากสัญญาซื้อไฟหรือ emission factor จริงขององค์กร ห้ามใช้ตัวเลขนี้ประกอบการลงทุน BESS หรือรายงานคาร์บอน โดยไม่ตรวจสอบกับอัตราจริง"
      />
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
            Planning model for peak load relief, hot-spot mitigation &amp; Time-of-Use arbitrage. No BESS is connected to this
            platform — the controls below size a hypothetical battery and do not dispatch hardware.
          </p>
        </div>

        {/* Actions & Mode Selector */}
        <div className="flex items-center gap-2 flex-wrap self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setShowTariffModal(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Settings size={13} className="text-amber-400" />
            <span>ตั้งค่า TOU ({tariff.currency})</span>
          </button>

          <button
            type="button"
            onClick={handleExportSchedule}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Export 24-Hour Dispatch Schedule to CSV"
          >
            <Download size={13} className="text-cyan-400" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleApplyStrategy}
            disabled={isApplying}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-slate-950 transition-all flex items-center gap-1.5 cursor-pointer shadow disabled:opacity-50"
          >
            <Check size={13} />
            <span>{isApplying ? 'กำลังบันทึก...' : 'ปรับใช้กลยุทธ์ (Apply)'}</span>
          </button>

          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800">
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
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/15 space-y-1">
          <div className="text-[10px] text-emerald-300 uppercase font-semibold flex items-center justify-between">
            <span>BESS Discharge Active</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-900/60 text-emerald-200 font-mono font-bold">
              SOC {batterySocPct}% (assumed)
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
            +{dispatchMetrics.touProfitLocal.toLocaleString()} <span className="text-xs font-normal text-slate-400">{tariff.currency}</span>
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
            min={thresholdMin}
            max={thresholdMax}
            step={50}
            value={shaveThresholdKva}
            onChange={(e) => setShaveThresholdKva(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-slate-500 font-mono">
            <span>{thresholdMin.toLocaleString()} kVA (Aggressive Shave)</span>
            <span>{thresholdMax.toLocaleString()} kVA (DTR Limit)</span>
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
            min={capacityMin}
            max={capacityMax}
            step={50}
            value={bessCapacityKwh}
            onChange={(e) => setBessCapacityKwh(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <div className="flex justify-between text-[9px] text-slate-500 font-mono">
            <span>{capacityMin.toLocaleString()} kWh (Compact)</span>
            <span>{capacityMax.toLocaleString()} kWh (Utility Scale)</span>
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
            <span>{manualDischarging ? 'Stop Simulated Injection' : '⚡ Simulate BESS Peak Injection'}</span>
          </button>
        </div>
      </div>

      {/* 24-Hour Diurnal Load vs Shaved Profile Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="font-semibold text-slate-200">
            24-Hour Diurnal Profile: Modelled Load Shape vs BESS Shaved Peak
            <span className="ml-2 font-normal text-[10px] text-amber-400/90">typical shape scaled to nameplate — not this asset&apos;s recorded history</span>
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
              <YAxis stroke="#475569" fontSize={10} domain={[Math.round(nameplateKva * 0.4), Math.round(nameplateKva * 1.12)]} tickLine={false} />
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

      {/* TOU Tariff Settings Modal */}
      {showTariffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-2xl p-5 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-amber-400" />
                <h4 className="text-sm font-bold text-white">กำหนดค่าอัตราค่าไฟฟ้า TOU &amp; การคำนวณคาร์บอน</h4>
              </div>
              <button
                onClick={() => setShowTariffModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400 font-medium">ชุดอัตราค่าไฟฟ้ามาตรฐาน (Regional Tariff Presets)</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { label: '🇹🇭 THB (MEA/PEA)', curr: 'THB', sym: '฿', on: 4.30, off: 2.60, hrs: 3.5, fx: 36, co2: 0.20 },
                  { label: '🇸🇬 SGD (EMA)', curr: 'SGD', sym: 'S$', on: 0.32, off: 0.19, hrs: 4.0, fx: 1.35, co2: 0.16 },
                  { label: '🇻🇳 VND (EVN)', curr: 'VND', sym: '₫', on: 3100, off: 1600, hrs: 3.5, fx: 25000, co2: 0.25 },
                  { label: '🇺🇸 USD (US/Global)', curr: 'USD', sym: '$', on: 0.24, off: 0.10, hrs: 4.0, fx: 1.0, co2: 0.18 },
                ].map((preset) => (
                  <button
                    key={preset.curr}
                    type="button"
                    onClick={() => {
                      setTariff({
                        currency: preset.curr,
                        currencySymbol: preset.sym,
                        onPeakRate: preset.on,
                        offPeakRate: preset.off,
                        peakHours: preset.hrs,
                        fxToUsd: preset.fx,
                        gridDifferentialKgCo2: preset.co2,
                      })
                    }}
                    className={clsx(
                      'text-[10px] p-2 rounded-lg border text-left font-medium transition-all cursor-pointer',
                      tariff.currency === preset.curr
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-[#0a0e1a] text-slate-400 border-slate-800 hover:text-slate-200'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveTariff(tariff)
                setShowTariffModal(false)
                toast.success('บันทึกการตั้งค่า TOU & Carbon Factor สำเร็จ')
              }}
              className="space-y-3 text-xs"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">รหัสสกุลเงิน (Currency Code)</label>
                  <input
                    type="text"
                    required
                    value={tariff.currency}
                    onChange={(e) => setTariff({ ...tariff, currency: e.target.value.toUpperCase() })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">สัญลักษณ์สกุลเงิน (Symbol)</label>
                  <input
                    type="text"
                    required
                    value={tariff.currencySymbol}
                    onChange={(e) => setTariff({ ...tariff, currencySymbol: e.target.value })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">อัตรา On-Peak ({tariff.currency}/kWh)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={tariff.onPeakRate}
                    onChange={(e) => setTariff({ ...tariff, onPeakRate: Number(e.target.value) })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">อัตรา Off-Peak ({tariff.currency}/kWh)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={tariff.offPeakRate}
                    onChange={(e) => setTariff({ ...tariff, offPeakRate: Number(e.target.value) })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">ช่วงชั่วโมง Peak (ชม./วัน)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={tariff.peakHours}
                    onChange={(e) => setTariff({ ...tariff, peakHours: Number(e.target.value) })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">อัตราแลกเปลี่ยน (ต่อ USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={tariff.fxToUsd}
                    onChange={(e) => setTariff({ ...tariff, fxToUsd: Number(e.target.value) })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Scope 2 Diff (kgCO₂e/kWh)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={tariff.gridDifferentialKgCo2}
                    onChange={(e) => setTariff({ ...tariff, gridDifferentialKgCo2: Number(e.target.value) })}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTariffModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-slate-950 rounded-lg bg-amber-500 hover:bg-amber-400 cursor-pointer shadow"
                >
                  บันทึกการตั้งค่า (Save Settings)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
