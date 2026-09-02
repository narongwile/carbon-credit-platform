'use client'

import React, { useState, useMemo, useEffect } from 'react'
import {
  Activity, Zap, AlertTriangle, ShieldCheck, TrendingUp,
  Radio, CheckCircle2, ArrowUpRight, Gauge, Info, Layers, Download,
  Sliders, Wrench, Check
} from 'lucide-react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Cell
} from 'recharts'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { recordAuditAction } from '@/lib/auditStore'

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

interface BushingHealthStudioProps {
  voltageKv?: number
  assetId?: string
  assetName?: string
  orgName?: string
  orgId?: string
  isSensorInstalled?: boolean
  bushingTanDeltaLive?: number | null
  partialDischargeLive?: number | null
}

export default function BushingHealthStudio({
  voltageKv = 115,
  assetId = 'TR-01',
  assetName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  orgId = 'default',
  isSensorInstalled = false,
  bushingTanDeltaLive = null,
  partialDischargeLive = null,
}: BushingHealthStudioProps) {
  const sensorInstalled = isSensorInstalled
  const storageKey = `pdm_bushing_${assetId}`
  const [baseBushings, setBaseBushings] = useState<BushingData[]>(DEFAULT_BUSHINGS)
  const [selectedPhase, setSelectedPhase] = useState<'A' | 'B' | 'C'>('B')
  const [pdFilter, setPdFilter] = useState<'all' | 'corona' | 'internal' | 'surface'>('all')
  const [showEditModal, setShowEditModal] = useState(false)
  const [dispatchedWo, setDispatchedWo] = useState<string | null>(null)

  // Edit form state
  const [editC1Nom, setEditC1Nom] = useState('380.0')
  const [editC1Meas, setEditC1Meas] = useState('393.8')
  const [editTanDelta, setEditTanDelta] = useState('0.82')
  const [editBaseline, setEditBaseline] = useState('0.33')
  const [editPd, setEditPd] = useState('195')

  // Load persistent bushing baselines
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length === 3) {
          setBaseBushings(parsed)
          return
        }
      }
    } catch (e) {
      console.error('Failed to load bushing data', e)
    }
  }, [storageKey])

  const saveBushings = (updated: BushingData[]) => {
    setBaseBushings(updated)
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated))
    } catch (e) {
      console.error('Failed to persist bushing data', e)
    }
  }

  const bushings = useMemo<BushingData[]>(() => {
    if (!sensorInstalled || bushingTanDeltaLive == null) return baseBushings
    return baseBushings.map((b) => {
      if (b.phase === 'B') {
        const td = bushingTanDeltaLive
        const pd = partialDischargeLive ?? b.pdMagnitudePc
        const status = td > 1.0 || pd > 250 ? 'critical' : td > 0.5 || pd > 100 ? 'warning' : 'good'
        return {
          ...b,
          tanDeltaPct: Number(td.toFixed(3)),
          pdMagnitudePc: Math.round(pd),
          status,
        }
      }
      return b
    })
  }, [baseBushings, sensorInstalled, bushingTanDeltaLive, partialDischargeLive])

  const activeBushing = useMemo(
    () => bushings.find((b) => b.phase === selectedPhase) || bushings[0],
    [bushings, selectedPhase]
  )

  // Capacitance Drift Calculation: Delta C1 (%) = ((C1_meas - C1_nom) / C1_nom) * 100
  const c1DriftPct = useMemo(() => {
    const delta = ((activeBushing.c1MeasuredPf - activeBushing.c1NominalPf) / activeBushing.c1NominalPf) * 100
    return Number(delta.toFixed(2))
  }, [activeBushing])

  const handleOpenEdit = (phase: 'A' | 'B' | 'C') => {
    const b = bushings.find((item) => item.phase === phase) || bushings[0]
    setEditC1Nom(String(b.c1NominalPf))
    setEditC1Meas(String(b.c1MeasuredPf))
    setEditTanDelta(String(b.tanDeltaPct))
    setEditBaseline(String(b.tanDeltaBaselinePct))
    setEditPd(String(b.pdMagnitudePc))
    setShowEditModal(true)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nom = Math.max(10, Number(editC1Nom) || 380)
    const meas = Math.max(10, Number(editC1Meas) || 380)
    const td = Math.max(0.01, Number(editTanDelta) || 0.35)
    const base = Math.max(0.01, Number(editBaseline) || 0.30)
    const pd = Math.max(0, Number(editPd) || 30)
    const drift = ((meas - nom) / nom) * 100
    const status: 'good' | 'warning' | 'critical' =
      td > 1.0 || pd > 250 || Math.abs(drift) > 5 ? 'critical' : td > 0.5 || pd > 100 || Math.abs(drift) > 3 ? 'warning' : 'good'

    const updated = baseBushings.map((b) => {
      if (b.phase === selectedPhase) {
        return {
          ...b,
          c1NominalPf: nom,
          c1MeasuredPf: meas,
          tanDeltaPct: Number(td.toFixed(3)),
          tanDeltaBaselinePct: Number(base.toFixed(3)),
          pdMagnitudePc: Math.round(pd),
          status,
        }
      }
      return b
    })

    saveBushings(updated)
    setShowEditModal(false)

    await recordAuditAction({
      action: 'CONFIG_CHANGE',
      target: { assetId, assetName },
      before: `Phase ${selectedPhase} C1: ${activeBushing.c1MeasuredPf}pF, tan δ: ${activeBushing.tanDeltaPct}%`,
      after: `Phase ${selectedPhase} C1: ${meas}pF (${drift.toFixed(2)}%), tan δ: ${td}%, PD: ${pd}pC`,
      justification: `Offline Doble / Power Factor Bushing Test Bench Update for ${assetName} (Phase ${selectedPhase}, Org: ${orgId})`,
    })

    toast.success(`Phase ${selectedPhase} test bench readings saved & logged to Audit Trail`)
  }

  const handleQueueWorkOrder = async () => {
    const woNumber = `WO-BSH-${assetId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4)}-${selectedPhase}-${Date.now().toString(36).toUpperCase().slice(-5)}`
    setDispatchedWo(woNumber)

    await recordAuditAction({
      action: 'CONFIG_CHANGE',
      target: { assetId, assetName },
      before: `Phase ${selectedPhase} Status: ${activeBushing.status.toUpperCase()}`,
      after: `Dispatched CMMS Work Order ${woNumber} (Priority: HIGH · Bushing Insulation Inspection)`,
      justification: `Elevated tan δ (${activeBushing.tanDeltaPct}%) / Capacitance Drift (${c1DriftPct}%) on Phase ${selectedPhase}`,
      workOrderId: woNumber,
    })

    toast.success(`Work Order ${woNumber} queued to CMMS for Phase ${selectedPhase}`)
  }

  // Deterministic Phase-Resolved Partial Discharge (PRPD) Scatter Cloud (0° to 360° phase angle)
  const prpdData = useMemo(() => {
    const points: { phaseAngle: number; magnitude: number; count: number; type: string }[] = []
    const isPhaseB = selectedPhase === 'B'
    const pdMag = activeBushing.pdMagnitudePc
    const pointCount = isPhaseB || pdMag > 100 ? 120 : 40

    for (let i = 0; i < pointCount; i++) {
      const pseudoRand1 = ((i * 137 + (selectedPhase.charCodeAt(0) * 19)) % 100) / 100
      const pseudoRand2 = ((i * 281 + 47) % 100) / 100
      const isPos = i % 2 === 0
      const centerAngle = isPos ? 72 : 252
      const phaseAngle = Math.round(centerAngle + (pseudoRand1 - 0.5) * 58)
      const baseMag = (pdMag * 0.6) + (pseudoRand2 * pdMag * 0.7)
      const magnitude = Math.round(baseMag * (0.65 + Math.sin((phaseAngle * Math.PI) / 180) * 0.35))
      const count = Math.round(1 + pseudoRand1 * 10)
      const type = phaseAngle > 60 && phaseAngle < 90 ? 'internal' : phaseAngle > 240 && phaseAngle < 270 ? 'surface' : 'corona'

      points.push({
        phaseAngle: Math.max(0, Math.min(360, phaseAngle)),
        magnitude: Math.max(5, magnitude),
        count,
        type,
      })
    }

    return points
  }, [selectedPhase, activeBushing.pdMagnitudePc])

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
              sensorInstalled && bushingTanDeltaLive != null
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                : sensorInstalled
                ? 'bg-blue-950/60 text-blue-300 border-blue-500/30'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
            )}>
              {sensorInstalled && bushingTanDeltaLive != null
                ? `⚡ ONLINE TELEMETRY ACTIVE — tan δ: ${bushingTanDeltaLive.toFixed(3)}%`
                : sensorInstalled
                ? '📄 REFERENCE VALUES — ADAPTER FITTED (NO TELEMETRY)'
                : '📄 REFERENCE VALUES — NO ADAPTER FITTED'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dielectric dissipation factor (tan δ), C1 capacitance drift &amp; Phase-Resolved Partial Discharge (PRPD)
          </p>
        </div>

        {/* Phase Selector & Update Button */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleOpenEdit(selectedPhase)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sliders size={13} /> อัปเดตผลทดสอบ Phase {selectedPhase}
          </button>

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

      <div className={clsx(
        'rounded-xl p-3.5 border flex items-start gap-3',
        sensorInstalled && bushingTanDeltaLive != null
          ? 'bg-emerald-950/20 border-emerald-500/30'
          : 'bg-amber-950/20 border-amber-500/30'
      )}>
        <div className={clsx(
          'p-1.5 rounded-md mt-0.5 flex-shrink-0',
          sensorInstalled && bushingTanDeltaLive != null
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-amber-500/20 text-amber-400'
        )}>
          <Zap size={15} />
        </div>
        <div className="text-xs space-y-1">
          <div className={clsx('font-bold flex items-center gap-2', sensorInstalled && bushingTanDeltaLive != null ? 'text-emerald-300' : 'text-amber-300')}>
            <span>
              {sensorInstalled && bushingTanDeltaLive != null ? (
                <>ข้อมูลเฟส B เชื่อมต่อกับค่าที่วัดได้จริงจากเซนเซอร์ (tan δ: {bushingTanDeltaLive.toFixed(3)}%)</>
              ) : (
                <>ค่าที่แสดงด้านล่างเป็น <strong>ค่าอ้างอิงตัวอย่าง (Reference Example)</strong> ไม่ใช่ค่าที่วัดได้จากหม้อแปลงเครื่องนี้</>
              )}
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            {sensorInstalled && bushingTanDeltaLive != null
              ? `ตรวจพบสัญญาณ Bushing Sensor กำลังส่งข้อมูลสด ค่า tan δ ที่เฟส B (${bushingTanDeltaLive.toFixed(3)}%) ได้รับการประเมินตามเกณฑ์ IEEE C57.19.00 ร่วมกับผลวัดจริง`
              : sensorInstalled
              ? 'หม้อแปลงเครื่องนี้มีชุดเซนเซอร์ Bushing Adapter ติดตั้งอยู่ แต่ยังไม่มีสัญญาณ telemetry tan-delta สดเข้ามา จึงแสดงชุดข้อมูลอ้างอิงประกอบมาตรฐาน'
              : 'หม้อแปลงเครื่องนี้ยังไม่ได้ติดตั้งชุดเซนเซอร์ Online Bushing Adapter ตัวเลขด้านล่างจึงเป็นเพียงตัวอย่างประกอบมาตรฐาน IEEE C57.19.00 เท่านั้น'}
            {' '}กรุณาใช้ผลทดสอบ Doble ประจำปีเป็นเกณฑ์ตัดสินใจร่วมด้วย
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

          {/* Action Callout & CMMS Work Order Dispatch */}
          {activeBushing.status !== 'good' ? (
            <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/25 text-amber-300 space-y-2.5">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <AlertTriangle size={15} className="shrink-0 text-amber-400" />
                <span>Action Required: Phase {selectedPhase} Bushing Degradation</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Recommend off-line C1/C2 sweep frequency dielectric testing and ultrasonic inspection during next scheduled outage.
              </p>
              <div className="pt-1 flex items-center justify-between flex-wrap gap-2">
                <button
                  onClick={handleQueueWorkOrder}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-slate-950 transition-all flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <Wrench size={13} /> สั่งเปิดใบแจ้งซ่อม CMMS (Dispatch Work Order)
                </button>
                {dispatchedWo && (
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">
                    ✓ {dispatchedWo}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/15 text-emerald-300 flex items-center gap-2 text-xs">
              <ShieldCheck size={18} className="text-emerald-400 shrink-0" />
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
                {/* filteredPoints, not prpdData: the refactor that split the
                    filter out of this memo left the chart bound to the
                    unfiltered set, so the corona/internal/surface filter
                    buttons highlighted but changed nothing on the plot. */}
                <Scatter name="PD Pulses" data={filteredPoints}>
                  {filteredPoints.map((entry, index) => (
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

      {/* Edit Modal for Offline Doble Test Bench */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-amber-400" />
                <h4 className="text-sm font-bold text-white">บันทึกผลทดสอบ Doble / Power Factor (Phase {selectedPhase})</h4>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">C₁ Nameplate (pF)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={editC1Nom}
                    onChange={(e) => setEditC1Nom(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">C₁ Measured (pF)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={editC1Meas}
                    onChange={(e) => setEditC1Meas(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Dielectric tan δ (%)</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={editTanDelta}
                    onChange={(e) => setEditTanDelta(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Baseline tan δ (%)</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={editBaseline}
                    onChange={(e) => setEditBaseline(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Partial Discharge (pC)</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={editPd}
                  onChange={(e) => setEditPd(e.target.value)}
                  className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ยกเลิก (Cancel)
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white rounded-lg bg-indigo-600 hover:bg-indigo-500 cursor-pointer shadow"
                >
                  บันทึกข้อมูล (Save)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
