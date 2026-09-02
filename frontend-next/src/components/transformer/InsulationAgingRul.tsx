'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Droplets, Wrench, CheckCircle2, AlertTriangle, ShieldAlert, Clock, Settings2, Sliders, X, Flame, Snowflake } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'
import { recordAuditAction } from '@/lib/auditStore'
import LocalOnlyNotice from '@/components/transformer/LocalOnlyNotice'

interface InsulationAgingRulProps {
  /** true only when hot-spot AND service hours are real for this asset. */
  inputsMeasured?: boolean
  hotSpotTemp: number
  hoursInService: number
  oilTemp: number
  moistureInOil?: number // ppm
  assetId?: string
  assetName?: string
  orgId?: string
}

interface RulConfig {
  commissioningYear: number
  initialDp: number
  paperType: 'standard_kraft' | 'thermally_upgraded'
  eolDpThreshold: number
}

export default function InsulationAgingRul({
  inputsMeasured = false,
  hotSpotTemp,
  hoursInService,
  oilTemp,
  moistureInOil = 22,
  assetId = 'TRF-01',
  assetName = 'Transformer Unit',
  orgId = 'org-1',
}: InsulationAgingRulProps) {
  const [dispatchedWo, setDispatchedWo] = useState<string | null>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [simScenario, setSimScenario] = useState<'actual' | 'overload' | 'precool'>('actual')

  // Multi-tenant configuration persistence
  const storageKey = `pdm_rul_config_${assetId}`
  const [config, setConfig] = useState<RulConfig>({
    commissioningYear: 2016,
    initialDp: 1000,
    paperType: 'standard_kraft',
    eolDpThreshold: 200,
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        setConfig(JSON.parse(saved))
      }
    } catch {}
  }, [storageKey])

  // Form states for modal
  const [editForm, setEditForm] = useState<RulConfig>(config)

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault()
    setConfig(editForm)
    try {
      localStorage.setItem(storageKey, JSON.stringify(editForm))
    } catch {}

    // The audit entry has to describe what actually happened. This wrote
    // action 'CONFIG_CHANGE' against the asset, which reads as a platform-level
    // configuration change — but the value never leaves localStorage, so no
    // other user's view of this transformer changes and the record points at
    // something they cannot see. It also supplied a fixed justification,
    // 'Calibrated ... per factory test record', attributing to the operator a
    // reason they never gave and citing a document that may not exist. A
    // fabricated justification in an audit trail is worse than an empty one:
    // it is exactly the field a reviewer relies on.
    recordAuditAction({
      action: 'CONFIG_CHANGE',
      target: { assetId, assetName },
      before: `[browser-local] Paper: ${config.paperType}, DP0: ${config.initialDp}, Year: ${config.commissioningYear}`,
      after: `[browser-local] Paper: ${editForm.paperType}, DP0: ${editForm.initialDp}, Year: ${editForm.commissioningYear}`,
      justification:
        'RUL baseline edited in the Insulation Aging studio. Stored in this browser only — not applied to the asset for other users. No justification was captured from the operator.',
    })

    setShowConfigModal(false)
    toast.success('บันทึกไว้ในเบราว์เซอร์นี้แล้ว — ยังไม่ได้บันทึกขึ้นระบบส่วนกลาง')
  }

  // Derived effective hours based on commissioning year if provided
  const derivedHours = useMemo(() => {
    if (config.commissioningYear) {
      const years = Math.max(0.5, new Date().getFullYear() - config.commissioningYear)
      return Math.round(years * 8760)
    }
    return hoursInService
  }, [config.commissioningYear, hoursInService])

  // Simulated hot-spot offset based on what-if scenario
  const effectiveHotSpot = useMemo(() => {
    if (simScenario === 'overload') return hotSpotTemp + 15
    if (simScenario === 'precool') return Math.max(30, hotSpotTemp - 10)
    return hotSpotTemp
  }, [hotSpotTemp, simScenario])

  // IEEE C57.91 Arrhenius aging
  // Reference temp = 110°C (383.15 K) for standard kraft, 120°C (393.15 K) for thermally upgraded
  const refTempK = config.paperType === 'thermally_upgraded' ? 120 + 273.15 : 110 + 273.15
  const hotSpotK = effectiveHotSpot + 273.15
  const faa = Math.exp(15000 / refTempK - 15000 / hotSpotK)
  
  // Cumulative Equivalent Hours
  const eqHours = derivedHours * faa
  
  // DP Estimation (Chendong model adapted to initial DP)
  const EOL_HOURS = config.paperType === 'thermally_upgraded' ? 220000 : 180000
  const maxDpLoss = config.initialDp - config.eolDpThreshold
  const dpValue = Math.max(config.eolDpThreshold, Math.round(config.initialDp - (eqHours / EOL_HOURS) * maxDpLoss))
  const percentLife = Math.max(0, Math.min(100, Math.round(((dpValue - config.eolDpThreshold) / maxDpLoss) * 100)))
  
  const remainingHours = Math.max(0, EOL_HOURS - eqHours)
  const remainingYears = parseFloat((remainingHours / (365.25 * 24 * Math.max(0.1, faa))).toFixed(1))

  // ── Oommen & Fessler Moisture Equilibrium Model ───────────────────────
  const tempK = oilTemp + 273.15
  const oilSaturationPpm = Math.pow(10, 7.0895 - 1567 / tempK)
  const relativeSaturationPct = Math.min(100, Math.max(1, (moistureInOil / oilSaturationPpm) * 100))
  // Water in Paper (% dry weight) via Fessler/Oommen equilibrium equation
  const waterInPaperPct = Math.min(6.0, Math.max(0.5, 2.173e-4 * moistureInOil * Math.exp(3280 / tempK)))

  const moistureStatus = waterInPaperPct < 1.5
    ? { label: 'Dry (Healthy)', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', risk: 'Low risk of dielectric breakdown' }
    : waterInPaperPct < 2.5
    ? { label: 'Moderate', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', risk: 'Monitor during high load periods' }
    : waterInPaperPct < 3.5
    ? { label: 'Wet (Bubble Hazard)', color: '#f97316', bg: 'rgba(249,115,22,0.1)', risk: 'Steam bubble evolution hazard during emergency overload' }
    : { label: 'Critically Wet', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', risk: 'Severe dielectric flashover risk; urgent dehydration required' }

  const handleDispatchWorkOrder = (type: 'RUL' | 'DEHYD' | 'COOLING') => {
    const prefix = type === 'DEHYD' ? 'WO-DEHYD' : type === 'COOLING' ? 'WO-COOL' : 'WO-RUL'
    const woNumber = `${prefix}-${assetId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6)}-${Date.now().toString(36).toUpperCase().slice(-5)}`
    setDispatchedWo(woNumber)

    const justification = type === 'DEHYD'
      ? `Moisture in paper reached ${waterInPaperPct.toFixed(2)}% (relative saturation ${relativeSaturationPct.toFixed(1)}%). Online molecular vacuum dehydration ordered.`
      : type === 'COOLING'
      ? `Aging Acceleration Factor (FAA) elevated to ${faa.toFixed(2)}x at hot-spot ${effectiveHotSpot.toFixed(1)}°C. Radiator inspection and fan stage maintenance dispatched.`
      : `Insulation remaining life estimated at ${remainingYears} yrs (DP ${dpValue}). Life extension overhaul queued in CMMS.`

    recordAuditAction({
      action: 'THRESHOLD_CHANGE',
      target: { assetId, assetName },
      before: `DP: ${dpValue}, FAA: ${faa.toFixed(2)}, WaterInPaper: ${waterInPaperPct.toFixed(2)}%`,
      after: `Work Order ${woNumber} queued in CMMS`,
      justification,
      workOrderId: woNumber,
    })

    toast.success(`Work Order ${woNumber} queued — export to your CMMS manually (no direct integration configured)`)
  }

  // DP Gauge SVG calculations
  const cx = 100
  const cy = 90
  const r = 75
  const angle = (percentLife / 100) * 180
  const startAngle = 180
  const endAngle = 180 - angle
  const toRad = (deg: number) => (deg * Math.PI) / 180
  
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy - r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy - r * Math.sin(toRad(endAngle))
  
  // Color based on DP
  const color = dpValue > 700 ? '#4ade80' : dpValue > 400 ? '#fbbf24' : '#ef4444'

  return (
    <div className="flex flex-col gap-5 text-white">
      {/* Arrhenius aging is exponential in hot-spot, so this panel turns two
          numbers into a remaining-life-in-years figure. Both are usually
          stand-ins: hoursInService is passed as a literal 52000, and
          hotSpotTemp falls back to oilTemp + 14 — a fixed offset standing in
          for a load-dependent winding gradient — on any unit without a real
          winding sensor. A wrong hot-spot of a few degrees moves RUL by
          years, so an unlabelled figure here is a maintenance-budget decision
          made on a guess. */}
      {!inputsMeasured && (
        <DemoDataBanner
          title="ค่าอายุคงเหลือ (RUL) ด้านล่างคำนวณจากค่าตั้งต้นตัวอย่าง"
          detail="ชั่วโมงใช้งานสะสมถูกกำหนดเป็นค่าคงที่ (52,000 ชม.) และอุณหภูมิ Hot-Spot ประมาณจาก 'อุณหภูมิน้ำมัน + 14°C' เมื่อไม่มีเซนเซอร์วัดขดลวดจริง เนื่องจากสมการ Arrhenius เป็นเอ็กซ์โพเนนเชียล ความคลาดเคลื่อนของ Hot-Spot เพียงไม่กี่องศาทำให้ RUL เปลี่ยนเป็นปี ห้ามใช้ตัวเลขนี้ตั้งงบเปลี่ยนหม้อแปลง"
        />
      )}
      {/* Outside the !inputsMeasured guard on purpose: the browser-only storage
          applies whether or not the telemetry behind the RUL figure is real. */}
      <LocalOnlyNotice what="ค่าตั้งต้นอายุฉนวนที่แก้ไข" />
      {/* Header with Title and Calibrate button */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Insulation Aging & RUL</h3>
          <p className="text-xs text-slate-400">IEEE C57.91 Thermal Degradation &amp; Arrhenius Rate Model</p>
        </div>
        <button
          onClick={() => {
            setEditForm(config)
            setShowConfigModal(true)
          }}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <Settings2 size={13} className="text-indigo-400" />
          <span>ปรับเทียบปีติดตั้ง/เกรดกระดาษ</span>
        </button>
      </div>

      {/* What-If Thermal Scenario Switcher */}
      <div className="p-3 rounded-xl bg-[#0a0e1a] border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Sliders size={14} className="text-indigo-400" />
          <span className="font-semibold">แบบจำลองสภาวะอุณหภูมิ (Thermal Scenario):</span>
        </div>
        <div className="flex items-center gap-1 bg-[#0d1117] p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setSimScenario('actual')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer',
              simScenario === 'actual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            ตามเซนเซอร์จริง ({hotSpotTemp}°C)
          </button>
          <button
            onClick={() => setSimScenario('overload')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer',
              simScenario === 'overload' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Flame size={11} /> Overload (+15°C)
          </button>
          <button
            onClick={() => setSimScenario('precool')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer',
              simScenario === 'precool' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Snowflake size={11} /> Pre-Cooling (-10°C)
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 items-center">
        {/* DP Gauge */}
        <div className="flex flex-col items-center relative w-[200px]">
          <svg width="200" height="110" viewBox="0 0 200 110">
            {/* Background arc */}
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke="#1e2433"
              strokeWidth="14"
              strokeLinecap="round"
            />
            {/* Value arc */}
            {percentLife > 0 && (
              <path
                d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth="14"
                strokeLinecap="round"
              />
            )}
            {/* Labels */}
            <text x={cx - r - 10} y={cy + 15} fill="#475569" fontSize="10">200</text>
            <text x={cx + r - 10} y={cy + 15} fill="#475569" fontSize="10">1000</text>
            
            {/* Value */}
            <text x={cx} y={cy - 10} textAnchor="middle" fill={color} fontSize="28" fontWeight="bold">
              {Math.round(dpValue)}
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize="11">Est. DP Value</text>
          </svg>
        </div>

        {/* Stats Grid */}
        <div className="flex-1 grid grid-cols-2 gap-3 w-full">
          <div className="bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-3">
            <div className="text-[10px] text-slate-400 mb-1">Hot-Spot Temp (θH)</div>
            <div className="text-lg font-bold text-amber-400">{hotSpotTemp.toFixed(1)}°C</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Top Oil: {oilTemp.toFixed(1)}°C</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-3">
            <div className="text-[10px] text-slate-400 mb-1">Aging Factor (FAA)</div>
            <div className="text-lg font-bold text-indigo-400">{faa.toFixed(3)}x</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Ref: 110°C</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-3">
            <div className="text-[10px] text-slate-400 mb-1">Equivalent Hours</div>
            <div className="text-lg font-bold text-slate-200">{Math.round(eqHours).toLocaleString()}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Actual: {hoursInService.toLocaleString()} h</div>
          </div>
          <div className="bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-3">
            <div className="text-[10px] text-slate-400 mb-1">Remaining Life</div>
            <div className="text-lg font-bold" style={{ color }}>{remainingYears.toFixed(1)} yrs</div>
            <div className="text-[9px] text-slate-500 mt-0.5">At current loading</div>
          </div>
        </div>
      </div>

      {/* Timeline Bar */}
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
          <span>0% (New Insulation)</span>
          <span className="font-mono text-slate-300">Life Consumed: {(100 - percentLife).toFixed(1)}%</span>
          <span>100% (End of Life)</span>
        </div>
        <div className="h-2 w-full bg-[#1e2433] rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-all duration-500" 
            style={{ width: `${100 - percentLife}%` }} 
          />
        </div>
      </div>

      {/* ── Moisture Equilibrium Section (Oommen / Fessler Model) ─────── */}
      <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Droplets size={15} className="text-cyan-400" />
            <h4 className="text-xs font-bold text-white">Moisture in Paper Equilibrium</h4>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-mono">
              Oommen / Fessler Model
            </span>
          </div>
          <span
            className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border"
            style={{ color: moistureStatus.color, backgroundColor: moistureStatus.bg, borderColor: `${moistureStatus.color}40` }}
          >
            {moistureStatus.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
            <div className="text-[10px] text-slate-400">Moisture in Oil</div>
            <div className="text-base font-bold text-cyan-300 mt-0.5">{moistureInOil} <span className="text-xs font-normal text-slate-500">ppm</span></div>
            <div className="text-[9px] text-slate-500">Sensor reading</div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
            <div className="text-[10px] text-slate-400">Relative Saturation (%RS)</div>
            <div className="text-base font-bold text-indigo-300 mt-0.5">{relativeSaturationPct.toFixed(1)}%</div>
            <div className="text-[9px] text-slate-500">Solubility: {oilSaturationPpm.toFixed(0)} ppm</div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
            <div className="text-[10px] text-slate-400">Water in Paper (%Wp)</div>
            <div className="text-base font-bold mt-0.5" style={{ color: moistureStatus.color }}>
              {waterInPaperPct.toFixed(2)}%
            </div>
            <div className="text-[9px] text-slate-500">Cellulose dry wt.</div>
          </div>
        </div>

        <div className="text-[11px] text-slate-300/90 flex items-start gap-1.5 pt-1">
          <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <span><strong>Risk Assessment:</strong> {moistureStatus.risk}</span>
        </div>
      </div>

      {/* ── Prescriptive Maintenance Action (RxM) & CMMS Dispatch ─────── */}
      <div className="p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/20 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Wrench size={15} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white">Prescriptive Maintenance Action Plan (RxM)</h4>
          </div>
          {dispatchedWo ? (
            <span className="text-[10px] px-2.5 py-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 font-mono font-bold flex items-center gap-1">
              <CheckCircle2 size={12} /> {dispatchedWo} DISPATCHED
            </span>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {waterInPaperPct > 2.2 && (
                <button
                  onClick={() => handleDispatchWorkOrder('DEHYD')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow transition-transform active:scale-95 bg-cyan-600 hover:bg-cyan-500 cursor-pointer"
                >
                  <Droplets size={12} /> สั่งอบไล่ความชื้นน้ำมัน (Dehydration)
                </button>
              )}
              <button
                onClick={() => handleDispatchWorkOrder(faa > 1.5 ? 'COOLING' : 'RUL')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow transition-transform active:scale-95 cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                <Wrench size={12} /> Dispatch CMMS Work Order
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="text-slate-200">
            <strong>Target Asset:</strong> <span className="font-mono text-indigo-300">{assetId}</span> · {assetName}
          </div>
          <div className="text-slate-300 leading-relaxed">
            <strong>Recommended Directive:</strong>{' '}
            {waterInPaperPct > 2.5
              ? 'Schedule online vacuum oil degassing & dehydration within 14 days. Restrict maximum emergency loading to 85% until moisture in paper drops below 2.0%.'
              : faa > 1.5
              ? 'Inspect radiator forced-cooling fans and clean heat-sink fins. Verify radiator butterfly valves are 100% open to arrest Arrhenius aging.'
              : 'Normal operating envelope. Continue routine DGA monitoring interval (90-day cycle).'}
          </div>
        </div>
      </div>

      {/* Calibration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4 border border-indigo-500/50 shadow-2xl bg-[#0d1117]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-white">ปรับเทียบข้อมูลตั้งต้นและเกรดฉนวน</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">ปีที่เริ่มเดินเครื่อง (Commissioning Year):</label>
                <input
                  type="number"
                  min="1970"
                  max={new Date().getFullYear()}
                  value={editForm.commissioningYear}
                  onChange={(e) => setEditForm({ ...editForm, commissioningYear: parseInt(e.target.value) || 2016 })}
                  className="w-full px-3 py-2 rounded-lg bg-[#0a0e1a] border border-slate-700 text-white font-mono focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">คำนวณอายุสะสมจริง ({new Date().getFullYear() - editForm.commissioningYear} ปี)</span>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-semibold">ชนิดของกระดาษฉนวน (Insulation Paper Grade):</label>
                <select
                  value={editForm.paperType}
                  onChange={(e) => setEditForm({ ...editForm, paperType: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-lg bg-[#0a0e1a] border border-slate-700 text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="standard_kraft">Standard Kraft Paper (Ref Temp: 110°C · DP₀: 1,000)</option>
                  <option value="thermally_upgraded">Thermally Upgraded Kraft (Ref Temp: 120°C · DP₀: 1,200)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">ค่าเริ่มต้น DP₀:</label>
                  <input
                    type="number"
                    min="800"
                    max="1400"
                    value={editForm.initialDp}
                    onChange={(e) => setEditForm({ ...editForm, initialDp: parseInt(e.target.value) || 1000 })}
                    className="w-full px-3 py-2 rounded-lg bg-[#0a0e1a] border border-slate-700 text-white font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">เกณฑ์สิ้นสุดอายุ (EOL DP):</label>
                  <input
                    type="number"
                    min="150"
                    max="300"
                    value={editForm.eolDpThreshold}
                    onChange={(e) => setEditForm({ ...editForm, eolDpThreshold: parseInt(e.target.value) || 200 })}
                    className="w-full px-3 py-2 rounded-lg bg-[#0a0e1a] border border-slate-700 text-white font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-[11px] text-slate-300">
                ℹ️ ข้อมูลนี้จะถูกบันทึกแยกต่อหม้อแปลง (<span className="font-mono text-indigo-300">{assetId}</span>) และบันทึกลง 21 CFR Part 11 Audit Trail
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow cursor-pointer"
                >
                  บันทึกการตั้งค่า
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
