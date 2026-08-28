'use client'

import React, { useState, useMemo } from 'react'
import {
  Zap, ShieldAlert, AlertTriangle, CheckCircle2, Activity,
  Sliders, ArrowUpRight, Clock, RefreshCw, Layers, ShieldCheck,
  TrendingUp, Sparkles, Battery, Thermometer
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts'
import clsx from 'clsx'

interface SubstationThreatsStudioProps {
  assetId?: string
  assetName?: string
  orgName?: string
  voltageKv?: number
  mainOilTemp?: number
  bushingTanDelta?: number
  hasArresterSensor?: boolean
  hasOltcSensor?: boolean
}

// Surge Arrester Phases
interface ArresterPhaseData {
  phase: 'A' | 'B' | 'C'
  totalCurrentUa: number
  resistiveCurrentUa: number // Ir3
  status: 'good' | 'caution' | 'critical'
  lastStrikeKa: number
  strikeCount: number
  healthPct: number
}

export default function SubstationThreatsStudio({
  assetId = 'TR-01',
  assetName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  voltageKv = 115,
  mainOilTemp = 64,
  bushingTanDelta = 0.82,
  hasArresterSensor = false,
  hasOltcSensor = false,
}: SubstationThreatsStudioProps) {
  const [activeSection, setActiveSection] = useState<'surge' | 'oltc' | 'wildlife'>('surge')
  // Whether a surge-arrester CT or an OLTC monitoring kit is fitted is a fact
  // about the DEVICE, not a view option. These were local state behind buttons,
  // so any user could flip the badge to "ONLINE SURGE CT SENSOR CONNECTED" over
  // the same static arrester table below.
  const arresterInstalled = hasArresterSensor
  const oltcInstalled = hasOltcSensor

  // Surge Arrester State (IEC 60099-5)
  const [arresters, setArresters] = useState<ArresterPhaseData[]>([
    { phase: 'A', totalCurrentUa: 245, resistiveCurrentUa: 28, status: 'good', lastStrikeKa: 12.4, strikeCount: 8, healthPct: 94 },
    { phase: 'B', totalCurrentUa: 480, resistiveCurrentUa: 62, status: 'caution', lastStrikeKa: 24.8, strikeCount: 14, healthPct: 76 },
    { phase: 'C', totalCurrentUa: 260, resistiveCurrentUa: 31, status: 'good', lastStrikeKa: 9.8, strikeCount: 7, healthPct: 92 },
  ])

  // OLTC Tap Changer State (IEEE C57.131)
  const [oltcTapPosition, setOltcTapPosition] = useState(14) // Step 14 of 33
  const [oltcOilTemp, setOltcOilTemp] = useState(67.8) // °C
  const [oltcMotorCurrent, setOltcMotorCurrent] = useState(3.4) // Amperes
  const [tapTransitionSec, setTapTransitionSec] = useState(3.8) // Nominal: 3.5 - 4.2 s
  const [oltcOperationsCount, setOltcOperationsCount] = useState(42680)

  // Wildlife / Optical Arc-Flash State
  const [arcFlashStatus, setArcFlashStatus] = useState<'armed' | 'triggered'>('armed')
  const [enclosureTemp, setEnclosureTemp] = useState(38.2) // °C
  const [enclosureHumidity, setEnclosureHumidity] = useState(64) // %

  // Co-Calculation 1: OLTC Diverter Compartment vs Main Tank Delta T
  //
  // This differenced the asset's REAL main-tank oil temperature against a
  // HARDCODED 67.8 degC diverter temperature, so the verdict was driven
  // entirely by a constant — and inverted: a healthy transformer running at
  // 40 degC produced deltaT 27.8 and a "CRITICAL — Severe Contact Coking"
  // alarm, while a genuinely hot unit at 75 degC produced -7.2 and was called
  // "NORMAL", rendered as the literal string "+-7.2 °C".
  //
  // deltaT is only meaningful when BOTH temperatures are measured. Without an
  // OLTC compartment sensor there is no delta to report, so the panel now says
  // so instead of manufacturing a verdict.
  const deltaT = useMemo(() => {
    if (!oltcInstalled || oltcOilTemp == null) return null
    return Number((oltcOilTemp - mainOilTemp).toFixed(1))
  }, [oltcInstalled, oltcOilTemp, mainOilTemp])

  const oltcCokingRisk = useMemo(() => {
    if (deltaT === null) {
      return { level: 'NO DATA', text: 'No OLTC compartment sensor — ΔT cannot be assessed', color: '#64748b' }
    }
    // Bands aligned with the 4.0 degC figure this panel itself attributes to
    // IEEE C57.131 in the note below; they previously read 3.5 / 6.0 and
    // contradicted that text.
    if (deltaT > 8.0) return { level: 'CRITICAL', text: 'Severe Contact Coking & Resistance Heating', color: '#ef4444' }
    if (deltaT > 4.0) return { level: 'CAUTION', text: 'Elevated Transition Contact Degradation', color: '#f59e0b' }
    return { level: 'NORMAL', text: 'Normal Differential Dissipation', color: '#10b981' }
  }, [deltaT])

  // Co-Calculation 2: BESS Tap Shaving Relief
  // When BESS provides dynamic voltage regulation, it prevents 12-18 tap operations/day
  const bessTapRelief = useMemo(() => {
    const avoidedCyclesPerYear = 14 * 365
    const extendedLifeYears = (avoidedCyclesPerYear / 50000) * 12
    return {
      dailyAvoidedOps: 14,
      yearlyAvoidedOps: avoidedCyclesPerYear,
      extendedLifeYears: Number(extendedLifeYears.toFixed(1)),
      capexSavingsUsd: 42000,
    }
  }, [])

  // Co-Calculation 3: Surge Strike correlation with Bushing Degradation
  const surgeBushingCorrelation = useMemo(() => {
    const phaseBArrester = arresters.find((a) => a.phase === 'B')
    // Both operands are fixed reference values (arresters[] is a constant array
    // and bushingTanDelta defaults to 0.82), so this predicate was true for
    // every asset — the panel issued the same "HIGH CORRELATION" MOV-stress
    // finding and IEC 60099-5 inspection order to every transformer on the
    // platform. Gated on real instrumentation instead.
    const isCorrelated = arresterInstalled
      && (phaseBArrester?.resistiveCurrentUa ?? 0) > 50
      && bushingTanDelta > 0.7
    return {
      isCorrelated,
      severity: isCorrelated ? 'HIGH CORRELATION' : 'BASELINE',
      insight: isCorrelated
        ? `Phase B received ${phaseBArrester?.lastStrikeKa} kA surge pulse, correlating with Bushing Phase B tan δ elevated reading (${bushingTanDelta}%). MOV block stress detected.`
        : arresterInstalled
          ? 'Surge arresters and condenser bushings show nominal impulse withstand balance.'
          : 'No surge-arrester CT fitted — correlation between impulse history and bushing dielectric loss cannot be assessed on this asset.',
    }
  }, [arresters, bushingTanDelta, arresterInstalled])

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <ShieldAlert size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Advanced Substation Threat Vectors & Multi-Hazard Co-Calculations
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase">
                  IEEE C57.131 · IEC 60099-5
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono">
                  {orgName}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Co-calculating Lightning Surge Degradation, OLTC Contact Coking, and Wildlife Optical Arc Protection.
              </p>
            </div>
          </div>

          {/* Section Switcher */}
          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800">
            {[
              { id: 'surge' as const, label: '⚡ Surge Arrester & Lightning', icon: Zap },
              { id: 'oltc' as const, label: '⚙️ OLTC Tap Changer & Coking', icon: Sliders },
              { id: 'wildlife' as const, label: '🐍 Wildlife & Optical Arc-Flash', icon: ShieldCheck },
            ].map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={clsx(
                    'text-xs px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap',
                    activeSection === tab.id
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  <Icon size={13} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* SECTION 1: Surge Arrester & Lightning Analysis (IEC 60099-5) */}
      {activeSection === 'surge' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className={clsx(
              'text-[10px] px-2 py-0.5 rounded font-mono font-bold border',
              arresterInstalled
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
            )}>
              📄 REFERENCE VALUES — NOT MEASURED ON THIS ASSET
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-800">
              Surge CT: {arresterInstalled ? 'Fitted' : 'Not fitted'}
            </span>
          </div>

          {/* Unconditional: the three phase cards below are fixed literals that
              do not change when a CT is fitted, so gating this notice on the
              flag left identical numbers reading as a live feed. */}
          {(
            <div className="rounded-xl p-3.5 bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-amber-500/20 text-amber-400 mt-0.5 flex-shrink-0">
                <Zap size={15} />
              </div>
              <div className="text-xs space-y-1">
                <div className="font-bold text-amber-300">
                  ค่ากระแสรั่วไหล 3 เฟสด้านล่างเป็น <strong>ค่าอ้างอิงตัวอย่าง</strong> ไม่ใช่ค่าที่วัดได้จากกับดักฟ้าผ่าของหม้อแปลงเครื่องนี้
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {arresterInstalled
                    ? 'หม้อแปลงเครื่องนี้มี CT วัดกระแสรั่วไหลติดตั้งอยู่ แต่ตัวเลข It / Ir3 / จำนวนครั้งฟ้าผ่า และ MOV Health ด้านล่างยังเป็นชุดตัวอย่างคงที่ ยังไม่ได้เชื่อมต่อกับค่าที่อุปกรณ์ส่งมาจริง'
                    : 'หม้อแปลงเครื่องนี้ยังไม่ได้ติดตั้ง CT วัดกระแสรั่วไหลของกับดักฟ้าผ่า ตัวเลขด้านล่างจึงเป็นเพียงตัวอย่างประกอบมาตรฐาน IEC 60099-5 เท่านั้น'}
                  {' '}สถิติความหนาแน่นฟ้าผ่า ~85 ครั้ง/ปี/ตร.กม. เป็นค่าเฉลี่ยของประเทศไทย ไม่ใช่ค่าเฉพาะพิกัดของสถานีนี้
                </p>
              </div>
            </div>
          )}

          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {arresters.map((arr) => (
              <div
                key={arr.phase}
                className={clsx(
                  'rounded-xl p-4 border transition-all',
                  arr.status === 'caution'
                    ? 'bg-amber-950/20 border-amber-500/40'
                    : 'bg-[#0d1117] border-slate-800'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center">
                      {arr.phase}
                    </span>
                    <span className="text-xs font-bold text-slate-300">Phase {arr.phase} Arrester ({voltageKv} kV)</span>
                  </div>
                  <span
                    className={clsx(
                      'text-[10px] px-2 py-0.5 rounded font-bold uppercase',
                      arr.status === 'caution'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    )}
                  >
                    {arr.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-800/60 font-mono text-xs">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Total Leakage (It)</div>
                    <div className="text-sm font-bold text-white">{arr.totalCurrentUa} μA</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Resistive (Ir3)</div>
                    <div className={clsx('text-sm font-bold', arr.resistiveCurrentUa > 50 ? 'text-amber-400' : 'text-emerald-400')}>
                      {arr.resistiveCurrentUa} μA
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Last Strike Peak</div>
                    <div className="text-sm font-bold text-cyan-300">{arr.lastStrikeKa} kA</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Surge Counter</div>
                    <div className="text-sm font-bold text-slate-200">{arr.strikeCount} strikes</div>
                  </div>
                </div>

                {/* Progress Health */}
                <div className="mt-3 pt-2 border-t border-slate-800/40">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>MOV Block Varistor Health</span>
                    <span className="font-mono font-bold text-white">{arr.healthPct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={clsx('h-full transition-all', arr.healthPct < 80 ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{ width: `${arr.healthPct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Co-Calculation Correlation Banner */}
          <div className="rounded-xl p-4 bg-gradient-to-r from-amber-950/30 via-[#0d1117] to-indigo-950/20 border border-amber-500/30">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300">
                <Sparkles size={18} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Cross-Hazard Fusion: Lightning Surge vs Bushing Dielectric Loss
                  </h4>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                    {surgeBushingCorrelation.severity}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {surgeBushingCorrelation.insight}
                </p>
                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  IEC 60099-5 Recommendation: Inspect Phase B Surge Arrester grounding clamp and perform offline 10 kV watt-loss verification during next planned outage.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: OLTC Tap Changer & Contact Coking (IEEE C57.131) */}
      {activeSection === 'oltc' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className={clsx(
              'text-[10px] px-2 py-0.5 rounded font-mono font-bold border',
              oltcInstalled
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
            )}>
              📄 REFERENCE VALUES — NOT MEASURED ON THIS ASSET
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-800">
              OLTC MCSA: {oltcInstalled ? 'Fitted' : 'Not fitted'}
            </span>
          </div>

          {/* Unconditional, same reasoning as the arrester notice above. */}
          {(
            <div className="rounded-xl p-3.5 bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-amber-500/20 text-amber-400 mt-0.5 flex-shrink-0">
                <Sliders size={15} />
              </div>
              <div className="text-xs space-y-1">
                <div className="font-bold text-amber-300">
                  ค่า OLTC ด้านล่าง (ΔT, กระแสมอเตอร์, จำนวนครั้งการทำงาน) เป็น <strong>ค่าอ้างอิงตัวอย่าง</strong> ไม่ใช่ค่าที่วัดได้จริง
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {oltcInstalled
                    ? 'หม้อแปลงเครื่องนี้มีชุดเซนเซอร์ OLTC ติดตั้งอยู่ แต่ตัวเลขด้านล่างยังเป็นชุดตัวอย่างคงที่ ยังไม่ได้เชื่อมต่อกับค่าที่อุปกรณ์ส่งมาจริง'
                    : 'หม้อแปลงเครื่องนี้ยังไม่ได้ติดตั้งชุดเซนเซอร์วัดกระแสมอเตอร์ OLTC และอุณหภูมิน้ำมันเฉพาะถัง'}
                  {' '}กรุณาใช้ตารางบำรุงรักษาเชิงเวลา (50,000 ไซเคิล) และผลตรวจหน้างานเป็นเกณฑ์ตัดสินใจ
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Diverter Tank Delta T Monitor */}
            <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Thermometer size={16} className="text-rose-400" />
                  <h4 className="text-xs font-bold text-white">OLTC Compartment Differential Temp (ΔT)</h4>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-bold"
                  style={{ color: oltcCokingRisk.color, backgroundColor: `${oltcCokingRisk.color}20`, border: `1px solid ${oltcCokingRisk.color}40` }}
                >
                  {oltcCokingRisk.level}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0a0e1a] border border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Main Tank Oil</div>
                  <div className="text-base font-bold font-mono text-white">{mainOilTemp} °C</div>
                </div>
                <div className="text-slate-600 font-bold">vs</div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">OLTC Diverter Oil</div>
                  <div className="text-base font-bold font-mono text-amber-400">
                    {oltcInstalled && oltcOilTemp != null ? `${oltcOilTemp} °C` : '—'}
                  </div>
                </div>
                <div className="text-right border-l border-slate-800 pl-3">
                  <div className="text-[10px] text-slate-500 uppercase">ΔT Differential</div>
                  <div className="text-lg font-bold font-mono text-rose-400">
                    {/* Signed explicitly: this printed "+{deltaT}" and so
                        rendered a negative delta as "+-7.2 °C". */}
                    {deltaT === null ? '—' : `${deltaT > 0 ? '+' : ''}${deltaT} °C`}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span>Contact Status: {oltcCokingRisk.text}</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Per IEEE C57.131, ΔT &gt; 4.0 °C indicates excessive contact resistance or pyrolytic carbon coking on diverter tungsten contacts.
                  {deltaT === null && ' This unit has no OLTC compartment temperature sensor, so ΔT is not available and no coking assessment is made.'}
                </p>
              </div>
            </div>

            {/* Motor Drive & Mechanism Metrics */}
            <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-indigo-400" />
                  <h4 className="text-xs font-bold text-white">Motor Drive Current Signature (MCSA)</h4>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                  NOMINAL
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Current Tap Step</div>
                  <div className="text-base font-bold text-white">Step {oltcTapPosition} / 33</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Drive Motor RMS</div>
                  <div className="text-base font-bold text-emerald-400">{oltcMotorCurrent} A</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Transition Time</div>
                  <div className="text-base font-bold text-cyan-300">{tapTransitionSec} s</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Total Operations</div>
                  <div className="text-base font-bold text-slate-200">{oltcOperationsCount.toLocaleString()}</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                Brake holding torque and Geneva drive gear alignment verified normal.
              </div>
            </div>

            {/* Co-Calculation with BESS Peak Shaving & Tap Reliever */}
            <div className="rounded-xl p-4 bg-gradient-to-br from-indigo-950/30 via-[#0d1117] to-emerald-950/20 border border-indigo-500/30 space-y-3">
              <div className="flex items-center gap-2">
                <Battery size={16} className="text-emerald-400" />
                <h4 className="text-xs font-bold text-white">BESS Co-Op Tap Wear Reliever</h4>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                By coordinating Substation BESS inverter reactive power (VAR) injection, voltage fluctuations are smoothed out before triggering physical mechanical tap changes.
              </p>

              <div className="p-3 rounded-lg bg-[#0a0e1a] border border-slate-800/80 space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Avoided Tap Cycles:</span>
                  <span className="font-bold text-emerald-400">~{bessTapRelief.dailyAvoidedOps} steps/day</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">OLTC Overhaul Life Extension:</span>
                  <span className="font-bold text-cyan-300">+{bessTapRelief.extendedLifeYears} years</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Avoided Diverter Refurbishment:</span>
                  <span className="font-bold text-amber-400">+${bessTapRelief.capexSavingsUsd.toLocaleString()} USD</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: Wildlife Intrusion & Optical Arc-Flash Protection */}
      {activeSection === 'wildlife' && (
        <div className="space-y-4">
          {/* This section asserted "ARMED (< 2 ms)", 99.8% fiber continuity,
              a live lux level, "SEALED (IP56)" and four barrier checks all
              PASS — every one a constant, with no sensor behind any of them
              and, unlike the arrester and OLTC sections, no disclosure at all.
              Telling an engineer that optical arc-flash protection is armed
              and will trip in under 2 ms, when nothing is monitored, is a
              personnel-safety claim this platform cannot make. */}
          <div className="rounded-xl p-3.5 bg-rose-950/20 border border-rose-500/40 flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-rose-500/20 text-rose-300 mt-0.5 flex-shrink-0">
              <ShieldAlert size={15} />
            </div>
            <div className="text-xs space-y-1">
              <div className="font-bold text-rose-300">
                ⚠️ ส่วนนี้ทั้งหมดเป็น <strong>ค่าอ้างอิงตัวอย่าง</strong> — ระบบยังไม่ได้เชื่อมต่อกับอุปกรณ์ป้องกัน Arc-Flash หรือเซนเซอร์ใดๆ จริง
              </div>
              <p className="text-slate-300 leading-relaxed">
                สถานะ &quot;ARMED&quot;, ความต่อเนื่องของสาย Fiber, ระดับแสง, สถานะซีล IP56 และผลตรวจแนวป้องกันสัตว์ทั้งหมดด้านล่าง
                เป็นข้อความตัวอย่างคงที่ <strong>ห้ามใช้เป็นหลักฐานว่าระบบป้องกัน Arc-Flash พร้อมทำงาน</strong>
                กรุณาตรวจสอบกับรีเลย์ป้องกันและผลตรวจหน้างานจริงก่อนเข้าปฏิบัติงานใกล้อุปกรณ์แรงสูงทุกครั้ง
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Optical Arc Flash Loop */}
            <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={16} className="text-amber-400" />
                  <h4 className="text-xs font-bold text-white">Optical Arc-Flash Fiber Loop</h4>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-bold">
                  EXAMPLE — NOT MONITORED
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Point sensors and continuous fiber optic loops positioned in terminal boxes and 22 kV busbar ducts detect light bursts from animal intrusion flashovers in &lt; 2 milliseconds.
              </p>
              <div className="p-3 rounded-lg bg-[#0a0e1a] border border-slate-800 font-mono text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Fiber Loop Continuity:</span>
                  <span className="font-bold text-emerald-400">99.8% (Healthy)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Light Intensity Threshold:</span>
                  <span className="font-bold text-white">10,000 Lux</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Light Level:</span>
                  <span className="font-bold text-slate-300">42 Lux</span>
                </div>
              </div>
            </div>

            {/* Enclosure Microclimate & Tamper Monitor */}
            <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-indigo-400" />
                  <h4 className="text-xs font-bold text-white">Enclosure Microclimate & Seals</h4>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-bold">
                  EXAMPLE — NOT MONITORED
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Maintains positive pressure and humidity control to deter insects, snakes, and rodents from nesting near high-voltage terminal junctions.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Cabinet Temp</div>
                  <div className="text-sm font-bold text-white">{enclosureTemp} °C</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Relative Humidity</div>
                  <div className="text-sm font-bold text-cyan-300">{enclosureHumidity}%</div>
                </div>
              </div>
            </div>

            {/* Animal Intrusion Hardening Checklist */}
            <div className="rounded-xl p-4 bg-[#0d1117] border border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <h4 className="text-xs font-bold text-white">Physical Defense Barrier Status</h4>
              </div>
              <div className="space-y-2 text-xs">
                {[
                  { name: 'Silicone Bushing Boot Animal Guards (22 kV)', ok: true },
                  { name: 'Cable Duct Expanding Polyurethane Foam Seals', ok: true },
                  { name: 'Ultrasonic Wildlife Deterrent Frequency Pulse', ok: true },
                  { name: 'Secondary Breather Silica Gel Saturation Check', ok: true },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-[#0a0e1a] border border-slate-800/80">
                    <span className="text-slate-300">{item.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">EXAMPLE</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
