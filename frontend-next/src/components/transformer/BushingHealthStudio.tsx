'use client'

import React, { useState, useMemo } from 'react'
import {
  Activity, Zap, AlertTriangle, ShieldCheck, TrendingUp,
  Radio, CheckCircle2, ArrowUpRight, Gauge, Info, Layers, Download
} from 'lucide-react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Cell
} from 'recharts'
import clsx from 'clsx'

interface BushingData {
  phase: 'A' | 'B' | 'C'
  serialNumber: string
  mfgYear: number
  c1NominalPf: number
  c1MeasuredPf: number
  tanDeltaPct: number
  tanDeltaBaselinePct: number
  leakageCurrentMa: number
  pdMagnitudePc: number
  status: 'good' | 'warning' | 'critical'
}

const DEFAULT_BUSHINGS: BushingData[] = [
  {
    phase: 'A',
    serialNumber: 'BSH-115KV-A921',
    mfgYear: 2021,
    c1NominalPf: 382.0,
    c1MeasuredPf: 384.2,
    tanDeltaPct: 0.38,
    tanDeltaBaselinePct: 0.32,
    leakageCurrentMa: 14.1,
    pdMagnitudePc: 42,
    status: 'good',
  },
  {
    phase: 'B',
    serialNumber: 'BSH-115KV-B922',
    mfgYear: 2021,
    c1NominalPf: 380.0,
    c1MeasuredPf: 393.8, // +3.6% capacitance drift (Warning)
    tanDeltaPct: 0.82,  // 0.82% tan delta (IEEE Deteriorated 0.5-1.0%)
    tanDeltaBaselinePct: 0.33,
    leakageCurrentMa: 16.8,
    pdMagnitudePc: 195, // High partial discharge
    status: 'warning',
  },
  {
    phase: 'C',
    serialNumber: 'BSH-115KV-C923',
    mfgYear: 2021,
    c1NominalPf: 381.5,
    c1MeasuredPf: 383.1,
    tanDeltaPct: 0.35,
    tanDeltaBaselinePct: 0.31,
    leakageCurrentMa: 13.9,
    pdMagnitudePc: 38,
    status: 'good',
  },
]

export default function BushingHealthStudio({
  voltageKv = 115,
  assetId = 'TR-01',
  assetName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  isSensorInstalled = false,
}: {
  voltageKv?: number
  assetId?: string
  assetName?: string
  orgName?: string
  isSensorInstalled?: boolean
}) {
  // Whether a bushing adapter is fitted is a fact about the DEVICE, not a view
  // option. This used to be local state behind a button, so any user could flip
  // the badge to "ONLINE SENSOR ADAPTER" over the same static table below.
  const sensorInstalled = isSensorInstalled
  const [bushings, setBushings] = useState<BushingData[]>(DEFAULT_BUSHINGS)
  const [selectedPhase, setSelectedPhase] = useState<'A' | 'B' | 'C'>('B')
  const [pdFilter, setPdFilter] = useState<'all' | 'corona' | 'internal' | 'surface'>('all')

  const activeBushing = useMemo(
    () => bushings.find((b) => b.phase === selectedPhase) || bushings[0],
    [bushings, selectedPhase]
  )

  // Capacitance Drift Calculation: Delta C1 (%) = ((C1_meas - C1_nom) / C1_nom) * 100
  const c1DriftPct = useMemo(() => {
    const delta = ((activeBushing.c1MeasuredPf - activeBushing.c1NominalPf) / activeBushing.c1NominalPf) * 100
    return Number(delta.toFixed(2))
  }, [activeBushing])

  // Synthetic Phase-Resolved Partial Discharge (PRPD) Scatter Cloud (0° to 360° phase angle)
  const prpdData = useMemo(() => {
    const points: { phaseAngle: number; magnitude: number; count: number; type: string }[] = []
    const isPhaseB = selectedPhase === 'B'
    const pointCount = isPhaseB ? 140 : 45

    for (let i = 0; i < pointCount; i++) {
      // Cluster around 45°-90° (positive half-cycle) and 225°-270° (negative half-cycle)
      const isPos = Math.random() > 0.5
      const centerAngle = isPos ? 70 : 250
      const phaseAngle = Math.round(centerAngle + (Math.random() - 0.5) * 60)
      const baseMag = isPhaseB ? (80 + Math.random() * 140) : (20 + Math.random() * 40)
      const magnitude = Math.round(baseMag * (0.6 + Math.sin((phaseAngle * Math.PI) / 180) * 0.4))
      const count = Math.round(1 + Math.random() * 12)
      const type = phaseAngle > 60 && phaseAngle < 90 ? 'internal' : phaseAngle > 240 && phaseAngle < 270 ? 'surface' : 'corona'

      points.push({
        phaseAngle: Math.max(0, Math.min(360, phaseAngle)),
        magnitude: Math.max(5, magnitude),
        count,
        type,
      })
    }

    return points
  }, [selectedPhase])

  const filteredPoints = useMemo(() => {
    if (pdFilter === 'all') return prpdData
    return prpdData.filter((p) => p.type === pdFilter)
  }, [prpdData, pdFilter])

  return (
    <div className="rounded-2xl p-5 space-y-6 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Zap size={18} className="text-amber-400" />
            <h3 className="text-sm font-bold text-white">Bushing Health &amp; Tan-Delta (tan δ) Studio</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30 font-mono font-bold">
              IEEE C57.19.00 / IEC 60137
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-500/30 font-mono font-bold">
              {voltageKv} kV High-Voltage Class
            </span>
            <span className={clsx(
              'text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border',
              sensorInstalled
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
            )}>
              {sensorInstalled ? '📄 REFERENCE VALUES — ADAPTER FITTED' : '📄 REFERENCE VALUES — NO ADAPTER FITTED'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dielectric dissipation factor (tan δ), C1 capacitance drift &amp; Phase-Resolved Partial Discharge (PRPD)
          </p>
        </div>

        {/* Phase Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-800 font-medium">
            Adapter: {sensorInstalled ? 'Fitted' : 'Not fitted'}
          </span>

          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start lg:self-auto">
            {(['A', 'B', 'C'] as const).map((p) => {
              const b = bushings.find((item) => item.phase === p)
              const isWarn = b?.status === 'warning'
              return (
                <button
                  key={p}
                  onClick={() => setSelectedPhase(p)}
                  className={clsx(
                    'text-xs px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5',
                    selectedPhase === p
                      ? isWarn
                        ? 'bg-amber-600 text-white font-bold shadow-sm'
                        : 'bg-indigo-600 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  <span>Phase {p}</span>
                  {isWarn && <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* The per-phase table, PRPD scatter and trend below are FIXED REFERENCE
          VALUES illustrating how IEEE C57.19.00 assessment presents — they are
          the same numbers for every asset, and they do not change when an
          adapter is fitted. This banner is therefore unconditional: it used to
          render only when the (user-togglable) "not installed" flag was set,
          which left the identical static table looking like a live feed the
          rest of the time. */}
      <div className="rounded-xl p-3.5 bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
        <div className="p-1.5 rounded-md bg-amber-500/20 text-amber-400 mt-0.5 flex-shrink-0">
          <Zap size={15} />
        </div>
        <div className="text-xs space-y-1">
          <div className="font-bold text-amber-300 flex items-center gap-2">
            <span>
              ค่าที่แสดงด้านล่างเป็น <strong>ค่าอ้างอิงตัวอย่าง (Reference Example)</strong> ไม่ใช่ค่าที่วัดได้จากหม้อแปลงเครื่องนี้
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            {sensorInstalled
              ? 'หม้อแปลงเครื่องนี้มีชุดเซนเซอร์ Bushing Adapter ติดตั้งอยู่ แต่ตาราง 3 เฟส กราฟ PRPD และค่าแนวโน้มด้านล่างยังเป็นชุดตัวเลขตัวอย่างคงที่ ยังไม่ได้เชื่อมต่อกับค่าที่อุปกรณ์ส่งมาจริง'
              : 'หม้อแปลงเครื่องนี้ยังไม่ได้ติดตั้งชุดเซนเซอร์ Online Bushing Adapter ตัวเลขด้านล่างจึงเป็นเพียงตัวอย่างประกอบมาตรฐาน IEEE C57.19.00 เท่านั้น'}
            {' '}กรุณาใช้ผลทดสอบ Doble ประจำปีเป็นเกณฑ์ตัดสินใจ อย่าใช้ตัวเลขในหน้านี้แทนผลวัดจริง
          </p>
        </div>
      </div>

      {/* 3-Phase Bushing Health Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {bushings.map((b) => {
          const isSelected = b.phase === selectedPhase
          const drift = Number((((b.c1MeasuredPf - b.c1NominalPf) / b.c1NominalPf) * 100).toFixed(2))
          const isWarning = b.status === 'warning'

          return (
            <div
              key={b.phase}
              onClick={() => setSelectedPhase(b.phase)}
              className={clsx(
                'p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden',
                isSelected
                  ? isWarning
                    ? 'bg-amber-950/20 border-amber-500/60 ring-1 ring-amber-500/30'
                    : 'bg-indigo-950/20 border-indigo-500/60 ring-1 ring-indigo-500/30'
                  : 'bg-[#0a0e1a] border-slate-800 hover:border-slate-700'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">Bushing Phase {b.phase}</span>
                  <span className="text-[10px] text-slate-500 font-mono">({b.serialNumber})</span>
                </div>
                <span
                  className={clsx(
                    'text-[9px] px-1.5 py-0.5 rounded font-bold uppercase',
                    b.status === 'good'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-950 text-amber-300 border border-amber-500/30 animate-pulse'
                  )}
                >
                  {b.status === 'good' ? 'Healthy' : 'Deteriorated'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div>
                  <div className="text-[10px] text-slate-400">Dielectric Loss (tan δ)</div>
                  <div className={clsx('text-lg font-black font-mono mt-0.5', b.tanDeltaPct > 0.5 ? 'text-amber-400' : 'text-emerald-400')}>
                    {b.tanDeltaPct}%
                  </div>
                  <div className="text-[9px] text-slate-500">Baseline: {b.tanDeltaBaselinePct}%</div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-400">Capacitance Drift (ΔC₁)</div>
                  <div className={clsx('text-lg font-black font-mono mt-0.5', drift > 3.0 ? 'text-rose-400' : 'text-slate-200')}>
                    {drift > 0 ? `+${drift}%` : `${drift}%`}
                  </div>
                  <div className="text-[9px] text-slate-500">Meas: {b.c1MeasuredPf} pF</div>
                </div>
              </div>

              {/* Progress bar for tan delta limit */}
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                  <span>tan δ Limit (IEEE C57.19: 1.0%)</span>
                  <span>{(b.tanDeltaPct * 100).toFixed(0)}% limit</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full', b.tanDeltaPct > 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
                    style={{ width: `${Math.min(100, (b.tanDeltaPct / 1.0) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Deep-Dive Diagnostics for Active Bushing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Tan-Delta Engineering Metrics */}
        <div className="lg:col-span-5 p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <Activity size={14} className="text-amber-400" />
              <span>Phase {selectedPhase} Insulation Breakdown Diagnostic</span>
            </h4>
            <span className="text-[10px] text-slate-500 font-mono">{voltageKv} kV Bushing</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Capacitance C₁ Layer Integrity:</span>
                <span className={clsx('font-bold font-mono', c1DriftPct > 3 ? 'text-amber-400' : 'text-emerald-400')}>
                  {c1DriftPct > 0 ? `+${c1DriftPct}%` : `${c1DriftPct}%`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Drift &gt; +3.0% indicates potential partial breakdown between condenser foil grading layers (Puncture Risk).
              </p>
            </div>

            <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Dielectric Loss Factor (tan δ):</span>
                <span className={clsx('font-bold font-mono', activeBushing.tanDeltaPct > 0.5 ? 'text-amber-400' : 'text-emerald-400')}>
                  {activeBushing.tanDeltaPct}% (Limit: 1.0%)
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Higher tan δ represents dielectric moisture ingress or carbon tracking in RIP/OIP paper condenser core.
              </p>
            </div>

            <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Partial Discharge Activity (PD):</span>
                <span className={clsx('font-bold font-mono', activeBushing.pdMagnitudePc > 100 ? 'text-rose-400' : 'text-emerald-400')}>
                  {activeBushing.pdMagnitudePc} pC
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                Threshold: &lt;50 pC (Normal), 50–150 pC (Investigate), &gt;150 pC (Critical Insulation Void Hazard).
              </p>
            </div>
          </div>

          {/* Action Callout */}
          {activeBushing.status === 'warning' ? (
            <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 text-amber-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <AlertTriangle size={13} className="shrink-0" />
                <span>Action Required: Phase {selectedPhase} Bushing Degradation</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Recommend off-line C1/C2 sweep frequency dielectric testing and ultrasonic inspection during next scheduled outage.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/15 text-emerald-300 flex items-center gap-2 text-xs">
              <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
              <span>Phase {selectedPhase} insulation is healthy. Dielectric loss and capacitance within IEEE limits.</span>
            </div>
          )}
        </div>

        {/* Right Column: Phase-Resolved Partial Discharge (PRPD) Plot */}
        <div className="lg:col-span-7 p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Activity size={14} className="text-cyan-400" />
                <span>Phase-Resolved Partial Discharge (PRPD) Pattern</span>
              </h4>
              <p className="text-[10px] text-slate-400">
                Phase Angle (0°–360°) vs Discharge Magnitude (pC) signature analysis
              </p>
            </div>

            {/* PRPD Filter */}
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
              {(['all', 'internal', 'surface', 'corona'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPdFilter(mode)}
                  className={clsx(
                    'px-2 py-0.5 rounded capitalize transition-all',
                    pdFilter === mode ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" />
                <XAxis
                  type="number"
                  dataKey="phaseAngle"
                  name="Phase Angle"
                  unit="°"
                  domain={[0, 360]}
                  ticks={[0, 90, 180, 270, 360]}
                  stroke="#475569"
                  fontSize={10}
                />
                <YAxis
                  type="number"
                  dataKey="magnitude"
                  name="PD Magnitude"
                  unit=" pC"
                  domain={[0, 250]}
                  stroke="#475569"
                  fontSize={10}
                />
                <ZAxis type="number" dataKey="count" range={[20, 90]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }}
                />
                <ReferenceLine y={50} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Normal (<50 pC)', fill: '#22c55e', fontSize: 9 }} />
                <ReferenceLine y={150} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Critical (>150 pC)', fill: '#ef4444', fontSize: 9 }} />
                <Scatter name="PD Pulses" data={prpdData}>
                  {prpdData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.magnitude > 150
                          ? '#ef4444'
                          : entry.magnitude > 80
                          ? '#f59e0b'
                          : '#06b6d4'
                      }
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Low Energy (&lt;80 pC)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Void PD (80-150 pC)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Critical Cavity (&gt;150 pC)</span>
            </div>
            <span className="font-mono">PRPD Sync: 50 Hz Grid</span>
          </div>
        </div>
      </div>
    </div>
  )
}
