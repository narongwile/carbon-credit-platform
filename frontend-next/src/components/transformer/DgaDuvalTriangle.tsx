'use client'

import React, { useState } from 'react'
import clsx from 'clsx'

interface DgaDuvalTriangleProps {
  ch4?: number // ppm
  c2h4?: number // ppm
  c2h2?: number // ppm
  h2?: number // ppm
  c2h6?: number // ppm
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
    diagnose: (h2, c2h6, ch4, c2h4, c2h2) => {
      const tot = h2 + c2h6 + ch4 + c2h4 + c2h2
      if (tot <= 0) return 'PD'
      const pH2 = (h2 / tot) * 100
      const pC2H2 = (c2h2 / tot) * 100
      const pC2H4 = (c2h4 / tot) * 100
      const pCH4 = (ch4 / tot) * 100
      const pC2H6 = (c2h6 / tot) * 100
      if (pH2 >= 55) return 'PD'
      if (pC2H2 >= 15) return 'D'
      if (pC2H6 >= 35) return 'C'
      if (pC2H4 >= 30) return 'T3-H'
      return 'O'
    },
  },
}

export default function DgaDuvalTriangle({
  ch4 = 45,
  c2h4 = 35,
  c2h2 = 3.2,
  h2 = 65,
  c2h6 = 28,
}: DgaDuvalTriangleProps) {
  const [selectedMethod, setSelectedMethod] = useState<MethodType>('T1')
  const currentCfg = METHODS[selectedMethod]

  // Triangle calculations
  let valTop = 0
  let valRight = 0
  let valLeft = 0

  if (selectedMethod === 'T1') {
    valTop = ch4; valRight = c2h4; valLeft = c2h2
  } else if (selectedMethod === 'T4') {
    valTop = h2; valRight = ch4; valLeft = c2h6
  } else if (selectedMethod === 'T5') {
    valTop = ch4; valRight = c2h4; valLeft = c2h6
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
  // 5 Vertices: Top (H2), Top-Right (C2H6), Bottom-Right (CH4), Bottom-Left (C2H4), Top-Left (C2H2)
  const pentagonVertices = [
    { name: '%H2', x: 140, y: 32, labelX: 140, labelY: 18, val: h2, color: '#38bdf8' },
    { name: '%C2H6', x: 223.7, y: 92.8, labelX: 245, labelY: 96, val: c2h6, color: '#a78bfa' },
    { name: '%CH4', x: 191.7, y: 191.2, labelX: 205, labelY: 208, val: ch4, color: '#4ade80' },
    { name: '%C2H4', x: 88.3, y: 191.2, labelX: 75, labelY: 208, val: c2h4, color: '#fb923c' },
    { name: '%C2H2', x: 56.3, y: 92.8, labelX: 35, labelY: 96, val: c2h2, color: '#f43f5e' },
  ]
  const total5 = h2 + c2h6 + ch4 + c2h4 + c2h2
  const pentagonDotX = total5 > 0 ? pentagonVertices.reduce((acc, v) => acc + (v.val / total5) * v.x, 0) : 140
  const pentagonDotY = total5 > 0 ? pentagonVertices.reduce((acc, v) => acc + (v.val / total5) * v.y, 0) : 120

  const dotX = currentCfg.type === 'triangle' ? toX(pTop, pRight, pLeft) : pentagonDotX
  const dotY = currentCfg.type === 'triangle' ? toY(pTop, pRight, pLeft) : pentagonDotY

  const activeZoneId = currentCfg.type === 'triangle'
    ? currentCfg.diagnose(pTop, pRight, pLeft)
    : currentCfg.diagnose(h2, c2h6, ch4, c2h4, c2h2)
  const activeZoneInfo = currentCfg.zones.find(z => z.id === activeZoneId) || currentCfg.zones[0]

  return (
    <div className="flex flex-col gap-4 text-white">
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

        {/* Diagnostic Method Tabs */}
        <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start sm:self-auto flex-wrap">
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
    </div>
  )
}
