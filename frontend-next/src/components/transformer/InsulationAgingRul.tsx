'use client'

import React, { useState } from 'react'
import { Droplets, Wrench, CheckCircle2, AlertTriangle, ShieldAlert, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'

interface InsulationAgingRulProps {
  /** true only when hot-spot AND service hours are real for this asset. */
  inputsMeasured?: boolean
  hotSpotTemp: number
  hoursInService: number
  oilTemp: number
  moistureInOil?: number // ppm
  assetId?: string
}

export default function InsulationAgingRul({
  inputsMeasured = false,
  hotSpotTemp,
  hoursInService,
  oilTemp,
  moistureInOil = 22,
  assetId = 'TRF-01',
}: InsulationAgingRulProps) {
  const [dispatchedWo, setDispatchedWo] = useState<string | null>(null)

  // IEEE C57.91 Arrhenius aging
  // Reference temp = 110°C (383.15 K)
  const refTempK = 110 + 273.15
  const hotSpotK = hotSpotTemp + 273.15
  const faa = Math.exp(15000 / refTempK - 15000 / hotSpotK)
  
  // Cumulative Equivalent Hours
  const eqHours = hoursInService * faa
  
  // DP Estimation (Simplified Chendong model)
  const EOL_HOURS = 180000
  const dpValue = Math.max(200, 1000 - (eqHours / EOL_HOURS) * 800)
  const percentLife = Math.max(0, 100 - (eqHours / EOL_HOURS) * 100)
  
  const remainingHours = Math.max(0, EOL_HOURS - eqHours)
  const remainingYears = remainingHours / (365.25 * 24)

  // ── Oommen & Fessler Moisture Equilibrium Model ───────────────────────
  // Saturation concentration in mineral oil: So = 10^(7.0895 - 1567 / T_kelvin)
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

  const handleDispatchWorkOrder = () => {
    const woNumber = `WO-${Math.floor(1000 + Math.random() * 9000)}`
    setDispatchedWo(woNumber)
    toast.success(`Work Order ${woNumber} dispatched to CMMS (Priority: High · Dehydration & Degassing)`)
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
      <div>
        <h3 className="text-sm font-semibold">Insulation Aging & RUL</h3>
        <p className="text-xs text-slate-400">IEEE C57.91 Thermal Degradation Model</p>
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
            <button
              onClick={handleDispatchWorkOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow transition-transform active:scale-95"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <Wrench size={12} /> Dispatch CMMS Work Order
            </button>
          )}
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="text-slate-200">
            <strong>Target Asset:</strong> <span className="font-mono text-indigo-300">{assetId}</span> · Substation Main Transformer
          </div>
          <div className="text-slate-300 leading-relaxed">
            <strong>Recommended Directive:</strong>{' '}
            {waterInPaperPct > 2.5
              ? 'Schedule online vacuum oil degassing & dehydration within 14 days. Restrict maximum loading to 85% until moisture in paper drops below 2.0%.'
              : faa > 1.5
              ? 'Inspect radiator forced-cooling fans and clean heat-sink fins. Verify radiator butterfly valves are 100% open.'
              : 'Normal operating envelope. Continue routine DGA monitoring interval (90-day cycle).'}
          </div>
        </div>
      </div>
    </div>
  )
}
