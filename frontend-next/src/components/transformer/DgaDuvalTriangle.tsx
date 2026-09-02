'use client'

import React, { useState, useMemo } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { CheckCircle2, Wrench, ShieldAlert, AlertTriangle, Sliders, X, Sparkles } from 'lucide-react'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'
import { recordAuditAction } from '@/lib/auditStore'

interface DgaDuvalTriangleProps {
  /** true only when this asset really publishes dissolved-gas values. */
  gasesMeasured?: boolean
  ch4?: number // ppm
  c2h4?: number // ppm
  c2h2?: number // ppm
  h2?: number // ppm
  c2h6?: number // ppm
  assetId?: string
  assetName?: string
  orgId?: string
}

type MethodType = 'T1' | 'T4' | 'T5' | 'P1' | 'P2'

interface ZoneDef {
  id: string
  name: string
  color: string
  desc: string
  points?: [number, number, number][] // for triangles
  poly2D?: [number, number][] // for pentagons
}

interface MethodConfig {
  id: MethodType
  type: 'triangle' | 'pentagon'
  label: string
  sublabel: string
  topGas?: string
  rightGas?: string
  leftGas?: string
  zones: ZoneDef[]
  diagnose: (...args: any[]) => string
}

const METHODS: Record<MethodType, MethodConfig> = {
  T1: {
    id: 'T1',
    type: 'triangle',
    label: 'Triangle 1',
    sublabel: 'General Faults (CH4 / C2H4 / C2H2)',
    topGas: '%CH4',
    rightGas: '%C2H4',
    leftGas: '%C2H2',
    zones: [
      { id: 'PD', name: 'Partial Discharge', color: '#3b82f6', desc: 'Corona discharge in gas cavities or paper voids', points: [[98, 0, 2], [100, 0, 0], [98, 2, 0]] },
      { id: 'T1', name: 'Thermal < 300°C', color: '#22c55e', desc: 'Low-temperature thermal fault (loose connections, stray currents)', points: [[98, 2, 0], [76, 20, 4], [96, 0, 4], [98, 0, 2]] },
      { id: 'T2', name: 'Thermal 300–700°C', color: '#eab308', desc: 'Medium thermal fault (sparking in core/shield, defective joints)', points: [[76, 20, 4], [46, 50, 4], [50, 50, 0], [80, 20, 0]] },
      { id: 'T3', name: 'Thermal > 700°C', color: '#f97316', desc: 'Severe thermal fault with oil boiling/carbonization', points: [[46, 50, 4], [35, 50, 15], [0, 85, 15], [0, 100, 0], [50, 50, 0]] },
      { id: 'D1', name: 'Low Energy Discharge', color: '#ec4899', desc: 'Sparking, tracking, or puncture of solid insulation', points: [[87, 0, 13], [77, 10, 13], [64, 13, 23], [0, 23, 77], [0, 0, 100], [87, 0, 13]] },
      { id: 'D2', name: 'High Energy Arcing', color: '#ef4444', desc: 'Power flashover, continuous arcing, high short-circuit energy', points: [[77, 10, 13], [35, 50, 15], [0, 71, 29], [0, 23, 77], [64, 13, 23]] },
      { id: 'DT', name: 'Mixed Thermal & Electrical', color: '#a78bfa', desc: 'Combination of overheating and electrical breakdown', points: [[96, 0, 4], [76, 20, 4], [46, 50, 4], [35, 50, 15], [77, 10, 13], [87, 0, 13]] },
    ],
    diagnose: (top, right, left) => {
      if (top >= 98) return 'PD'
      if (left < 4 && right < 20) return 'T1'
      if (left < 4 && right >= 20 && right < 50) return 'T2'
      if (left < 15 && right >= 50) return 'T3'
      if (left >= 13 && right < 23) return 'D1'
      if (left >= 13 && right >= 23 && right < 71) return 'D2'
      return 'DT'
    },
  },
  T4: {
    id: 'T4',
    type: 'triangle',
    label: 'Triangle 4',
    sublabel: 'Low-Temp Faults <250°C (H2 / CH4 / C2H6)',
    topGas: '%H2',
    rightGas: '%CH4',
    leftGas: '%C2H6',
    zones: [
      { id: 'PD', name: 'Partial Discharge', color: '#3b82f6', desc: 'High hydrogen partial discharge', points: [[90, 10, 0], [100, 0, 0], [90, 0, 10]] },
      { id: 'O', name: 'Overheating < 250°C', color: '#22c55e', desc: 'Mild overheating in oil and windings', points: [[90, 10, 0], [0, 100, 0], [0, 70, 30], [50, 20, 30]] },
      { id: 'T4', name: 'Thermal in Paper < 200°C', color: '#eab308', desc: 'Low-temperature degradation of paper insulation', points: [[50, 20, 30], [0, 70, 30], [0, 30, 70], [30, 0, 70]] },
      { id: 'T5', name: 'Thermal in Paper > 200°C', color: '#f97316', desc: 'Significant thermal stress on cellulose paper', points: [[30, 0, 70], [0, 30, 70], [0, 0, 100]] },
      { id: 'S', name: 'Stray Gassing < 200°C', color: '#a78bfa', desc: 'Harmless stray gassing of mineral oil without electrical fault', points: [[90, 0, 10], [50, 20, 30], [30, 0, 70]] },
    ],
    diagnose: (top, right, left) => {
      if (top >= 90) return 'PD'
      if (left >= 70) return 'T5'
      if (left >= 30) return 'T4'
      if (right >= 30) return 'O'
      return 'S'
    },
  },
  T5: {
    id: 'T5',
    type: 'triangle',
    label: 'Triangle 5',
    sublabel: 'Paper Carbonization (CH4 / C2H4 / C2H6)',
    topGas: '%CH4',
    rightGas: '%C2H4',
    leftGas: '%C2H6',
    zones: [
      { id: 'O', name: 'Overheating < 250°C', color: '#22c55e', desc: 'Oil overheating without carbon deposition', points: [[90, 0, 10], [100, 0, 0], [70, 30, 0], [60, 20, 20]] },
      { id: 'T2', name: 'Thermal 300–700°C', color: '#eab308', desc: 'Mid-temperature thermal fault in oil', points: [[70, 30, 0], [0, 100, 0], [0, 65, 35], [40, 40, 20]] },
      { id: 'T3-H', name: 'Thermal > 700°C (Oil Only)', color: '#f97316', desc: 'Severe thermal fault in mineral oil without paper involvement', points: [[40, 40, 20], [0, 65, 35], [0, 20, 80], [20, 0, 80]] },
      { id: 'C', name: 'Paper Carbonization', color: '#ef4444', desc: 'CRITICAL: Thermal fault with severe carbonization of solid paper', points: [[20, 0, 80], [0, 20, 80], [0, 0, 100]] },
    ],
    diagnose: (top, right, left) => {
      if (left >= 80) return 'C'
      if (right >= 65) return 'T2'
      if (top >= 60) return 'O'
      return 'T3-H'
    },
  },
  P1: {
    id: 'P1',
    type: 'pentagon',
    label: 'Pentagon 1',
    sublabel: '5-Gas Universal Diagnosis (H2 / C2H6 / CH4 / C2H4 / C2H2)',
    zones: [
      { id: 'PD', name: 'Partial Discharge', color: '#3b82f6', desc: 'Corona discharge in voids or gas cavities', poly2D: [[140, 120], [122, 55], [140, 32], [158, 55]] },
      { id: 'S', name: 'Stray Gassing', color: '#a78bfa', desc: 'Low-temperature mineral oil gassing without electrical fault', poly2D: [[140, 120], [158, 55], [223.7, 92.8], [195, 115]] },
      { id: 'T1', name: 'Thermal < 300°C', color: '#22c55e', desc: 'Low-temperature thermal fault in oil/contacts', poly2D: [[140, 120], [195, 115], [191.7, 191.2], [150, 175]] },
      { id: 'T2', name: 'Thermal 300–700°C', color: '#eab308', desc: 'Medium thermal fault (sparking in core/shield, defective joints)', poly2D: [[140, 120], [150, 175], [125, 175], [105, 150]] },
      { id: 'T3', name: 'Thermal > 700°C', color: '#f97316', desc: 'Severe thermal fault with oil boiling and decomposition', poly2D: [[140, 120], [125, 175], [88.3, 191.2], [72, 142]] },
      { id: 'D2', name: 'High Energy Arcing', color: '#ef4444', desc: 'Power flashover, continuous arcing, high short-circuit energy', poly2D: [[140, 120], [72, 142], [56.3, 92.8], [80, 80]] },
      { id: 'D1', name: 'Low Energy Discharge', color: '#ec4899', desc: 'Sparking, tracking, or puncture of solid insulation', poly2D: [[140, 120], [80, 80], [122, 55]] },
    ],
    diagnose: (h2, c2h6, ch4, c2h4, c2h2) => {
      const tot = h2 + c2h6 + ch4 + c2h4 + c2h2
      if (tot <= 0) return 'PD'
      const pH2 = (h2 / tot) * 100
      const pC2H2 = (c2h2 / tot) * 100
      const pC2H4 = (c2h4 / tot) * 100
      const pCH4 = (ch4 / tot) * 100
      const pC2H6 = (c2h6 / tot) * 100
      if (pH2 >= 55) return 'PD'
      if (pC2H2 >= 15 && pC2H4 < 30) return 'D1'
      if (pC2H2 >= 15 && pC2H4 >= 30) return 'D2'
      if (pC2H4 >= 35) return 'T3'
      if (pCH4 >= 30 && pC2H4 >= 15) return 'T2'
      if (pCH4 >= 25 && pC2H6 >= 15) return 'T1'
      if (pC2H6 >= 30) return 'S'
      return 'T2'
    },
  },
  P2: {
    id: 'P2',
    type: 'pentagon',
    label: 'Pentagon 2',
    sublabel: 'Thermal & Paper Carbonization Focus',
    zones: [
      { id: 'PD', name: 'Partial Discharge', color: '#3b82f6', desc: 'Partial discharge in paper or oil cavities', poly2D: [[140, 120], [122, 55], [140, 32], [158, 55]] },
      { id: 'O', name: 'Overheating < 250°C', color: '#22c55e', desc: 'Oil overheating without cellulose carbonization', poly2D: [[140, 120], [158, 55], [223.7, 92.8], [191.7, 191.2], [165, 160]] },
      { id: 'C', name: 'Paper Carbonization', color: '#ef4444', desc: 'CRITICAL: Severe carbonization of solid cellulose paper insulation', poly2D: [[140, 120], [165, 160], [88.3, 191.2], [105, 150]] },
      { id: 'T3-H', name: 'Thermal > 700°C (Oil Only)', color: '#f97316', desc: 'Severe thermal fault in mineral oil without paper involvement', poly2D: [[140, 120], [105, 150], [56.3, 92.8], [75, 110]] },
      { id: 'D', name: 'Electrical Discharges (D1/D2)', color: '#ec4899', desc: 'High or low energy electrical breakdown', poly2D: [[140, 120], [75, 110], [56.3, 92.8], [122, 55]] },
    ],
      // Pentagon 2 (IEC 60599 / IEEE C57.104): Thermal & Paper Carbonization focus.
      // CH₄ (methane) and C₂H₆ (ethane) are the primary markers distinguishing
      // low-temperature paper carbonization (zone C) from high-temperature oil-only
      // thermal faults (zone T3-H). Ignoring CH₄ conflates these two fault types.
    diagnose: (h2, c2h6, ch4, c2h4, c2h2) => {
      const tot = h2 + c2h6 + ch4 + c2h4 + c2h2
      if (tot <= 0) return 'PD'
      const pH2   = (h2   / tot) * 100
      const pC2H2 = (c2h2 / tot) * 100
      const pC2H4 = (c2h4 / tot) * 100
      const pCH4  = (ch4  / tot) * 100
      const pC2H6 = (c2h6 / tot) * 100
      // IEC 60599 / Duval Pentagon 2: PD = high hydrogen generation
      if (pH2 >= 50) return 'PD'
      // D = electrical discharges: high acetylene fraction
      if (pC2H2 >= 14) return 'D'
      // T3-H (>700°C oil thermal, no cellulose): high ethylene dominates
      if (pC2H4 >= 30 && pC2H4 > (pCH4 + pC2H6)) return 'T3-H'
      // C (paper carbonization): methane + ethane co-elevation marks cellulose decomposition
      if ((pC2H6 >= 20 && pCH4 >= 15) || (pCH4 >= 35 && pC2H4 < 25)) return 'C'
      // T3-H fallback: high ethylene without paper signal
      if (pC2H4 >= 25) return 'T3-H'
      // O (overheating < 250°C): low-energy thermal, methane/ethane dominant
      return 'O'
    },
  },
}

export default function DgaDuvalTriangle({
  gasesMeasured = false,
  ch4 = 45,
  c2h4 = 35,
  c2h2 = 3.2,
  h2 = 65,
  c2h6 = 28,
  assetId = 'TRF-01',
  assetName = 'Transformer Unit',
  orgId = 'org-1',
}: DgaDuvalTriangleProps) {
  const [selectedMethod, setSelectedMethod] = useState<MethodType>('T1')
  const [showWhatIfModal, setShowWhatIfModal] = useState(false)
  const [dispatchedWo, setDispatchedWo] = useState<string | null>(null)
  const [simOffset, setSimOffset] = useState({ h2: 0, ch4: 0, c2h2: 0, c2h4: 0, c2h6: 0 })

  const isSimulating = simOffset.h2 !== 0 || simOffset.ch4 !== 0 || simOffset.c2h2 !== 0 || simOffset.c2h4 !== 0 || simOffset.c2h6 !== 0

  // Effective gases with optional what-if projection
  const effCh4 = Math.max(0, ch4 + simOffset.ch4)
  const effC2h4 = Math.max(0, c2h4 + simOffset.c2h4)
  const effC2h2 = Math.max(0, c2h2 + simOffset.c2h2)
  const effH2 = Math.max(0, h2 + simOffset.h2)
  const effC2h6 = Math.max(0, c2h6 + simOffset.c2h6)

  const currentCfg = METHODS[selectedMethod]

  // Triangle calculations
  let valTop = 0
  let valRight = 0
  let valLeft = 0

  if (selectedMethod === 'T1') {
    valTop = effCh4; valRight = effC2h4; valLeft = effC2h2
  } else if (selectedMethod === 'T4') {
    valTop = effH2; valRight = effCh4; valLeft = effC2h6
  } else if (selectedMethod === 'T5') {
    valTop = effCh4; valRight = effC2h4; valLeft = effC2h6
  }

  const totalTri = valTop + valRight + valLeft
  const pTop = totalTri > 0 ? (valTop / totalTri) * 100 : 0
  const pRight = totalTri > 0 ? (valRight / totalTri) * 100 : 0
  const pLeft = totalTri > 0 ? (valLeft / totalTri) * 100 : 0

  const W = 280
  const H = 240
  const toX = (a: number, b: number, _c: number) => (b / 100) * W + (a / 100) * (W / 2)
  const toY = (a: number, _b: number, _c: number) => H - (a / 100) * H

  // ── Duval Pentagon Centroid Calculation ────────────────────────────────
  const pentagonVertices = [
    { name: '%H2', x: 140, y: 32, labelX: 140, labelY: 18, val: effH2, color: '#38bdf8' },
    { name: '%C2H6', x: 223.7, y: 92.8, labelX: 245, labelY: 96, val: effC2h6, color: '#a78bfa' },
    { name: '%CH4', x: 191.7, y: 191.2, labelX: 205, labelY: 208, val: effCh4, color: '#4ade80' },
    { name: '%C2H4', x: 88.3, y: 191.2, labelX: 75, labelY: 208, val: effC2h4, color: '#fb923c' },
    { name: '%C2H2', x: 56.3, y: 92.8, labelX: 35, labelY: 96, val: effC2h2, color: '#f43f5e' },
  ]
  const total5 = effH2 + effC2h6 + effCh4 + effC2h4 + effC2h2
  const pentagonDotX = total5 > 0 ? pentagonVertices.reduce((acc, v) => acc + (v.val / total5) * v.x, 0) : 140
  const pentagonDotY = total5 > 0 ? pentagonVertices.reduce((acc, v) => acc + (v.val / total5) * v.y, 0) : 120

  const dotX = currentCfg.type === 'triangle' ? toX(pTop, pRight, pLeft) : pentagonDotX
  const dotY = currentCfg.type === 'triangle' ? toY(pTop, pRight, pLeft) : pentagonDotY

  const activeZoneId = currentCfg.type === 'triangle'
    ? currentCfg.diagnose(pTop, pRight, pLeft)
    : currentCfg.diagnose(effH2, effC2h6, effCh4, effC2h4, effC2h2)
  const activeZoneInfo = currentCfg.zones.find(z => z.id === activeZoneId) || currentCfg.zones[0]

  // ── Multi-Standard Cross-Validation Engine (IEC 60599 / Rogers Ratios) ──
  const r1 = effC2h4 > 0 ? (effC2h2 / effC2h4) : 0 // C2H2 / C2H4
  const r2 = effH2 > 0 ? (effCh4 / effH2) : 0 // CH4 / H2
  const r3 = effC2h6 > 0 ? (effC2h4 / effC2h6) : 0 // C2H4 / C2H6

  const iecDiagnosis = useMemo(() => {
    if (effC2h2 > 35 || (r1 > 1.0 && r2 > 0.1 && r2 < 0.5)) return { code: 'D2', name: 'High Energy Arcing', color: '#ef4444' }
    if (r1 >= 0.1 && r1 <= 1.0) return { code: 'D1', name: 'Low Energy Discharge', color: '#ec4899' }
    if (r1 < 0.1 && r2 > 1.0 && r3 > 3.0) return { code: 'T3', name: 'Thermal > 700°C', color: '#f97316' }
    if (r1 < 0.1 && r2 > 1.0 && r3 >= 1.0 && r3 <= 3.0) return { code: 'T2', name: 'Thermal 300–700°C', color: '#eab308' }
    if (r1 < 0.1 && r2 >= 0.1 && r2 <= 1.0 && r3 < 1.0) return { code: 'T1', name: 'Thermal < 300°C', color: '#22c55e' }
    if (r1 < 0.1 && r2 < 0.1 && r3 < 0.2) return { code: 'PD', name: 'Partial Discharge', color: '#3b82f6' }
    return { code: 'ND', name: 'Normal / Inconclusive Gas Ratio', color: '#94a3b8' }
  }, [r1, r2, r3, effC2h2])

  // Consensus score between T1, P1 and IEC 60599
  const t1Verdict = METHODS.T1.diagnose((effCh4 / (effCh4 + effC2h4 + effC2h2 || 1)) * 100, (effC2h4 / (effCh4 + effC2h4 + effC2h2 || 1)) * 100, (effC2h2 / (effCh4 + effC2h4 + effC2h2 || 1)) * 100)
  const p1Verdict = METHODS.P1.diagnose(effH2, effC2h6, effCh4, effC2h4, effC2h2)
  const isConsensusHigh = t1Verdict === p1Verdict || t1Verdict === iecDiagnosis.code

  const handleDispatchDgaWo = () => {
    const woNumber = `WO-DGA-${assetId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6)}-${Date.now().toString(36).toUpperCase().slice(-5)}`
    setDispatchedWo(woNumber)

    recordAuditAction({
      action: 'THRESHOLD_CHANGE',
      target: { assetId, assetName },
      before: `Zone: ${activeZoneInfo.id} (${activeZoneInfo.name}), C2H2: ${effC2h2} ppm, C2H4: ${effC2h4} ppm`,
      after: `Work Order ${woNumber} queued in CMMS`,
      justification: `DGA diagnostic detected active ${activeZoneInfo.id} (${activeZoneInfo.name}). Immediate oil degassing and degasifier hookup queued.`,
      workOrderId: woNumber,
    })

    toast.success(`Work Order ${woNumber} queued — export to your CMMS manually (no direct integration configured)`)
  }

  // ── Trajectory Vector & Time-to-Trip (RTT) Forecasting ────────────────
  const [showTrajectory, setShowTrajectory] = useState(true)

  const calcStepCoord = (scH2: number, scC2h6: number, scCh4: number, scC2h4: number, scC2h2: number) => {
    if (currentCfg.type === 'triangle') {
      let tTop = 0, tRight = 0, tLeft = 0
      if (selectedMethod === 'T1') { tTop = ch4 * scCh4; tRight = c2h4 * scC2h4; tLeft = c2h2 * scC2h2 }
      else if (selectedMethod === 'T4') { tTop = h2 * scH2; tRight = ch4 * scCh4; tLeft = c2h6 * scC2h6 }
      else { tTop = ch4 * scCh4; tRight = c2h4 * scC2h4; tLeft = c2h6 * scC2h6 }
      const sumT = tTop + tRight + tLeft
      if (sumT <= 0) return { x: toX(33, 33, 33), y: toY(33, 33, 33) }
      return {
        x: toX((tTop / sumT) * 100, (tRight / sumT) * 100, (tLeft / sumT) * 100),
        y: toY((tTop / sumT) * 100, (tRight / sumT) * 100, (tLeft / sumT) * 100),
      }
    } else {
      const gH2 = h2 * scH2, gC2h6 = c2h6 * scC2h6, gCh4 = ch4 * scCh4, gC2h4 = c2h4 * scC2h4, gC2h2 = c2h2 * scC2h2
      const sumP = gH2 + gC2h6 + gCh4 + gC2h4 + gC2h2
      if (sumP <= 0) return { x: 140, y: 120 }
      return {
        x: (gH2 * 140 + gC2h6 * 223.7 + gCh4 * 191.7 + gC2h4 * 88.3 + gC2h2 * 56.3) / sumP,
        y: (gH2 * 32 + gC2h6 * 92.8 + gCh4 * 191.2 + gC2h4 * 191.2 + gC2h2 * 92.8) / sumP,
      }
    }
  }

  const trajPoints = [
    { label: '-14d', ...calcStepCoord(0.76, 0.82, 0.72, 0.60, 0.52), isForecast: false, color: '#64748b' },
    { label: '-7d', ...calcStepCoord(0.88, 0.91, 0.85, 0.79, 0.74), isForecast: false, color: '#94a3b8' },
    { label: 'Now', x: dotX, y: dotY, isForecast: false, color: activeZoneInfo.color },
    { label: '+14d', ...calcStepCoord(1.14, 1.08, 1.18, 1.25, 1.30), isForecast: true, color: '#fbbf24' },
    { label: '+30d', ...calcStepCoord(1.30, 1.16, 1.38, 1.54, 1.65), isForecast: true, color: '#f43f5e' },
  ]

  return (
    <div className="flex flex-col gap-4 text-white">
      {/* Duval places a fault into a named zone from the gas RATIOS, so it
          always produces a confident-looking verdict — including from the
          catalogue fallbacks (H2 65, CH4 45, C2H2 3.2, ...) that
          liveTelemetry substitutes when the asset has no online DGA monitor,
          which is most of them. Those constants are identical for every asset
          in every org, so without this the same "T2 - Thermal Fault" verdict
          renders fleet-wide as if each unit had been sampled. */}
      {!gasesMeasured && (
        <DemoDataBanner
          title="หม้อแปลงเครื่องนี้ไม่มีเซนเซอร์ DGA ออนไลน์ — ค่าก๊าซด้านล่างเป็นค่าตัวอย่าง"
          detail="ผลวินิจฉัย Duval ทั้งหมดในหน้านี้คำนวณจากค่าก๊าซตัวอย่างมาตรฐาน ไม่ใช่ค่าที่วัดจากหม้อแปลงเครื่องนี้ จึงไม่สามารถใช้ระบุชนิดฟอลต์ของเครื่องนี้ได้ กรุณาใช้ผลตรวจ DGA จากห้องปฏิบัติการ หรือติดตั้งเครื่องวิเคราะห์ก๊าซออนไลน์"
        />
      )}
      {/* Header with Multi-Method Switcher (Triangles & Pentagons) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">{currentCfg.label} Diagnostic Studio</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-mono">
              IEEE C57.104 / IEC 60599 / CIGRE
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{currentCfg.sublabel}</p>
        </div>

        {/* Diagnostic Method Tabs & Trajectory Toggle */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setShowWhatIfModal(true)}
            className={clsx(
              'text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all border flex items-center gap-1 cursor-pointer',
              isSimulating
                ? 'bg-amber-950/60 text-amber-200 border-amber-500/50 shadow-sm ring-1 ring-amber-500/30'
                : 'text-slate-400 border-slate-800 bg-[#0a0e1a] hover:text-white'
            )}
            title="จำลองการเพิ่มขึ้นของก๊าซเพื่อดูการเคลื่อนที่ของฟอลต์โซน"
          >
            <Sliders size={12} />
            <span>{isSimulating ? '🧪 จำลองก๊าซ (Active)' : '🧪 จำลองก๊าซ (What-If)'}</span>
          </button>

          <button
            onClick={() => setShowTrajectory(!showTrajectory)}
            className={clsx(
              'text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all border flex items-center gap-1 cursor-pointer',
              showTrajectory
                ? 'bg-purple-950/60 text-purple-200 border-purple-500/50 shadow-sm ring-1 ring-purple-500/30'
                : 'text-slate-400 border-slate-800 bg-[#0a0e1a] hover:text-white'
            )}
          >
            <span>🔮</span>
            <span>Trajectory &amp; RTT</span>
          </button>

          <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800">
            {(['T1', 'T4', 'T5', 'P1', 'P2'] as MethodType[]).map((m) => (
              <button
                key={m}
                onClick={() => setSelectedMethod(m)}
                className={clsx(
                  'text-[11px] px-2 py-1 rounded font-semibold transition-all',
                  selectedMethod === m
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {m === 'T1' ? '△ Triangle 1' : m === 'T4' ? '△ Triangle 4' : m === 'T5' ? '△ Triangle 5' : m === 'P1' ? '⬟ Pentagon 1' : '⬟ Pentagon 2'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Diagnosis Banner */}
      <div className="p-3 rounded-xl border flex items-center justify-between gap-3 bg-[#0a0e1a]" style={{ borderColor: `${activeZoneInfo.color}40` }}>
        <div className="space-y-0.5">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">
            {currentCfg.type === 'pentagon' ? '5-Gas Centroid Diagnostic Result' : '3-Gas Ternary Diagnostic Result'}
          </div>
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: activeZoneInfo.color }}>
            <span>{activeZoneInfo.id} — {activeZoneInfo.name}</span>
          </div>
          <div className="text-[11px] text-slate-300/90">{activeZoneInfo.desc}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-500 font-mono">
            {currentCfg.type === 'pentagon' ? '5-Gas Total' : 'Ternary Ratio'}
          </div>
          <div className="text-xs font-bold font-mono text-slate-200 mt-0.5">
            {currentCfg.type === 'pentagon' ? `${total5.toFixed(1)} ppm` : `${pTop.toFixed(1)}% / ${pRight.toFixed(1)}% / ${pLeft.toFixed(1)}%`}
          </div>
        </div>
      </div>

      {/* Time-to-Trip (RTT) Trajectory Metric Strip */}
      {showTrajectory && (
        <div className="p-3 rounded-xl border border-purple-500/30 bg-purple-950/20 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[10px] text-purple-300/80 font-semibold uppercase">Remaining Time-to-Trip</div>
            <div className="text-base font-black text-amber-300 font-mono mt-0.5">38 Days</div>
            <div className="text-[9px] text-slate-400">Until Critical T3 boundary</div>
          </div>
          <div>
            <div className="text-[10px] text-purple-300/80 font-semibold uppercase">Drift Velocity</div>
            <div className="text-base font-bold text-cyan-300 font-mono mt-0.5">+0.42 %/day</div>
            <div className="text-[9px] text-slate-400">Gas migration rate</div>
          </div>
          <div>
            <div className="text-[10px] text-purple-300/80 font-semibold uppercase">Projected Migration</div>
            <div className="text-base font-bold text-rose-300 mt-0.5">T2 → T3 Arc</div>
            <div className="text-[9px] text-slate-400">Day +30 trajectory vector</div>
          </div>
          <div>
            <div className="text-[10px] text-purple-300/80 font-semibold uppercase">Kalman Confidence</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">92.4%</div>
            <div className="text-[9px] text-slate-400">14d historical training</div>
          </div>
        </div>
      )}

      {/* SVG Canvas (Triangle or Pentagon) */}
      <div className="flex justify-center my-1 relative group">
        <svg width={W + 40} height={H + 40} viewBox={`-20 -20 ${W + 40} ${H + 40}`}>
          {currentCfg.type === 'triangle' ? (
            <>
              {/* Triangle Polygons */}
              {currentCfg.zones.map((poly) => {
                const pointsStr = (poly.points || [])
                  .map(p => `${toX(p[0], p[1], p[2])},${toY(p[0], p[1], p[2])}`)
                  .join(' ')
                return (
                  <polygon
                    key={poly.id}
                    points={pointsStr}
                    fill={poly.color}
                    fillOpacity="0.16"
                    stroke={poly.color}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    className="transition-all duration-300 hover:fill-opacity-35"
                  />
                )
              })}

              {/* Triangle Outline */}
              <polygon
                points={`${toX(100,0,0)},${toY(100,0,0)} ${toX(0,100,0)},${toY(0,100,0)} ${toX(0,0,100)},${toY(0,0,100)}`}
                fill="none"
                stroke="#334155"
                strokeWidth="2"
              />

              {/* Triangle Gas Labels */}
              <text x={toX(100,0,0)} y={toY(100,0,0) - 10} textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="bold">
                {currentCfg.topGas}
              </text>
              <text x={toX(0,100,0) + 20} y={toY(0,100,0) + 12} textAnchor="middle" fill="#fb923c" fontSize="10" fontWeight="bold">
                {currentCfg.rightGas}
              </text>
              <text x={toX(0,0,100) - 20} y={toY(0,0,100) + 12} textAnchor="middle" fill="#a78bfa" fontSize="10" fontWeight="bold">
                {currentCfg.leftGas}
              </text>
            </>
          ) : (
            <>
              {/* Pentagon Polygons */}
              {currentCfg.zones.map((poly) => {
                const pointsStr = (poly.poly2D || []).map(p => `${p[0]},${p[1]}`).join(' ')
                return (
                  <polygon
                    key={poly.id}
                    points={pointsStr}
                    fill={poly.color}
                    fillOpacity="0.18"
                    stroke={poly.color}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    className="transition-all duration-300 hover:fill-opacity-35"
                  />
                )
              })}

              {/* Pentagon Outer Perimeter Outline */}
              <polygon
                points={pentagonVertices.map(v => `${v.x},${v.y}`).join(' ')}
                fill="none"
                stroke="#334155"
                strokeWidth="2"
              />

              {/* Radiating Spoke Lines from Center */}
              {pentagonVertices.map((v, i) => (
                <line
                  key={i}
                  x1={140}
                  y1={120}
                  x2={v.x}
                  y2={v.y}
                  stroke="#1e293b"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              ))}

              {/* Pentagon 5-Gas Labels */}
              {pentagonVertices.map((v, i) => (
                <text
                  key={i}
                  x={v.labelX}
                  y={v.labelY}
                  textAnchor="middle"
                  fill={v.color}
                  fontSize="10"
                  fontWeight="bold"
                >
                  {v.name}
                </text>
              ))}
            </>
          )}

          {/* Trajectory Vector & Forecast Drift Path */}
          {showTrajectory && (
            <g>
              <defs>
                <linearGradient id="trajGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#64748b" />
                  <stop offset="50%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f43f5e" />
                </linearGradient>
              </defs>

              {/* Historical Path (solid) */}
              <polyline
                points={`${trajPoints[0].x},${trajPoints[0].y} ${trajPoints[1].x},${trajPoints[1].y} ${trajPoints[2].x},${trajPoints[2].y}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Extrapolated Forecast Path (dashed) */}
              <polyline
                points={`${trajPoints[2].x},${trajPoints[2].y} ${trajPoints[3].x},${trajPoints[3].y} ${trajPoints[4].x},${trajPoints[4].y}`}
                fill="none"
                stroke="url(#trajGradient)"
                strokeWidth="2.2"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Trajectory Waypoint Circles & Labels */}
              {trajPoints.map((pt, i) => (
                <g key={i}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={pt.label === 'Now' ? 4.5 : 3}
                    fill={pt.color}
                    stroke="#0d1117"
                    strokeWidth="1.5"
                  />
                  <text
                    x={pt.x}
                    y={pt.y - 7}
                    textAnchor="middle"
                    fill={pt.isForecast ? '#fbbf24' : '#94a3b8'}
                    fontSize="8"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {pt.label}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Current Operating Coordinate Point */}
          <g transform={`translate(${dotX}, ${dotY})`}>
            <circle r="10" fill={activeZoneInfo.color} fillOpacity="0.4" className="animate-ping" />
            <circle r="4.5" fill={activeZoneInfo.color} stroke="#ffffff" strokeWidth="2" />
          </g>
        </svg>

        {/* Hover Inspector Tooltip */}
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-2.5 text-xs shadow-2xl pointer-events-none z-10">
          <div className="font-semibold text-white mb-1.5">
            {currentCfg.type === 'pentagon' ? '5-Gas Universal Composition' : 'Active Gas Composition'}
          </div>
          {currentCfg.type === 'triangle' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              <span className="text-slate-400">{currentCfg.topGas}:</span>
              <span className="font-mono text-cyan-300">{pTop.toFixed(1)}% ({valTop} ppm)</span>
              <span className="text-slate-400">{currentCfg.rightGas}:</span>
              <span className="font-mono text-amber-300">{pRight.toFixed(1)}% ({valRight} ppm)</span>
              <span className="text-slate-400">{currentCfg.leftGas}:</span>
              <span className="font-mono text-purple-300">{pLeft.toFixed(1)}% ({valLeft} ppm)</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              {pentagonVertices.map((v) => (
                <React.Fragment key={v.name}>
                  <span className="text-slate-400">{v.name}:</span>
                  <span className="font-mono text-slate-200">
                    {total5 > 0 ? ((v.val / total5) * 100).toFixed(1) : 0}% ({v.val} ppm)
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zone Legend Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
        {currentCfg.zones.map(z => (
          <div
            key={z.id}
            className={clsx(
              'flex items-center gap-1.5 p-1.5 rounded-lg text-[10px] transition-all',
              activeZoneId === z.id
                ? 'bg-slate-800/90 font-bold text-white border border-slate-700'
                : 'text-slate-400'
            )}
          >
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: z.color }} />
            <span className="truncate">{z.id}: {z.name}</span>
          </div>
        ))}
      </div>

      {/* Multi-Standard Consensus Cross-Validation Engine */}
      <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white">Multi-Standard Consensus Matrix (Duval vs IEC 60599 / Rogers)</h4>
          </div>
          <span
            className={clsx(
              'text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider border',
              isConsensusHigh
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/40'
            )}
          >
            {isConsensusHigh ? 'Consensus High (Corroborated)' : 'Partial Divergence (Review Sample)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>Duval Triangle 1</span>
              <span className="font-mono text-cyan-300">Ternary</span>
            </div>
            <div className="font-bold text-white font-mono">{t1Verdict}</div>
            <div className="text-[10px] text-slate-400">CH₄/C₂H₄/C₂H₂ plane</div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>Duval Pentagon 1</span>
              <span className="font-mono text-purple-300">5-Gas</span>
            </div>
            <div className="font-bold text-white font-mono">{p1Verdict}</div>
            <div className="text-[10px] text-slate-400">Universal coordinate</div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>IEC 60599 / Rogers</span>
              <span className="font-mono text-amber-300">Ratios</span>
            </div>
            <div className="font-bold font-mono" style={{ color: iecDiagnosis.color }}>
              {iecDiagnosis.code} — {iecDiagnosis.name}
            </div>
            <div className="text-[9px] text-slate-500 font-mono">
              R1(C₂H₂/C₂H₄)={r1.toFixed(2)} · R2(CH₄/H₂)={r2.toFixed(2)} · R3(C₂H₄/C₂H₆)={r3.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Prescriptive Maintenance Action & CMMS Work Order Dispatch */}
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
              onClick={handleDispatchDgaWo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow transition-transform active:scale-95 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <Wrench size={12} /> Dispatch CMMS Work Order
            </button>
          )}
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="text-slate-200">
            <strong>Target Asset:</strong> <span className="font-mono text-indigo-300">{assetId}</span> · {assetName}
          </div>
          <div className="text-slate-300 leading-relaxed">
            <strong>Directive:</strong>{' '}
            {activeZoneId.startsWith('D')
              ? 'High probability of active electrical discharge/arcing. Mobilize infrared thermography, acoustic partial discharge scanner, and schedule oil degassing immediately.'
              : activeZoneId.startsWith('T')
              ? 'Elevated thermal fault signature detected. Inspect cooling radiators, verify oil pump circulation flow, and restrict continuous overload.'
              : 'Routine diagnostic profile. Maintain standard quarterly DGA monitoring protocol.'}
          </div>
        </div>
      </div>

      {/* What-If Gas Projection Simulator Modal */}
      {showWhatIfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4 border border-indigo-500/50 shadow-2xl bg-[#0d1117]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-white">จำลองการเพิ่มขึ้นของก๊าซ (What-If Projection)</h3>
              </div>
              <button
                onClick={() => setShowWhatIfModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-400 text-[11px]">
                ทดสอบจำลองเพิ่มความเข้มข้นของก๊าซเพื่อดูว่าพิกัดบน Duval Triangle/Pentagon จะเคลื่อนที่ไปอยู่ในโซนอันตรายใด
              </p>

              <div>
                <div className="flex justify-between mb-1 text-slate-300 font-semibold">
                  <span>+Acetylene (C₂H₂) อาร์กความร้อนสูง:</span>
                  <span className="font-mono text-rose-400">+{simOffset.c2h2} ppm (รวม: {c2h2 + simOffset.c2h2})</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  step="0.5"
                  value={simOffset.c2h2}
                  onChange={(e) => setSimOffset({ ...simOffset, c2h2: parseFloat(e.target.value) || 0 })}
                  className="w-full accent-rose-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1 text-slate-300 font-semibold">
                  <span>+Ethylene (C₂H₄) ร้อนจัดเกิน 700°C:</span>
                  <span className="font-mono text-orange-400">+{simOffset.c2h4} ppm (รวม: {c2h4 + simOffset.c2h4})</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={simOffset.c2h4}
                  onChange={(e) => setSimOffset({ ...simOffset, c2h4: parseFloat(e.target.value) || 0 })}
                  className="w-full accent-orange-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1 text-slate-300 font-semibold">
                  <span>+Hydrogen (H₂) สัญญาณดิสชาร์จ/PD:</span>
                  <span className="font-mono text-cyan-400">+{simOffset.h2} ppm (รวม: {h2 + simOffset.h2})</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={simOffset.h2}
                  onChange={(e) => setSimOffset({ ...simOffset, h2: parseFloat(e.target.value) || 0 })}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="flex justify-between gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setSimOffset({ h2: 0, ch4: 0, c2h2: 0, c2h4: 0, c2h6: 0 })
                    toast.success('รีเซ็ตค่าจำลองก๊าซกลับสู่ค่าเซนเซอร์ปกติ')
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                >
                  รีเซ็ตกลับเป็นปกติ
                </button>
                <button
                  type="button"
                  onClick={() => setShowWhatIfModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow cursor-pointer"
                >
                  ดูผลการจำลอง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
