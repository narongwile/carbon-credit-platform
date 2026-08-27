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

type TriangleType = 'T1' | 'T4' | 'T5'

interface ZoneDef {
  id: string
  name: string
  color: string
  desc: string
  points: [number, number, number][] // [top%, right%, left%]
}

interface TriangleConfig {
  id: TriangleType
  label: string
  sublabel: string
  topGas: string
  rightGas: string
  leftGas: string
  zones: ZoneDef[]
  diagnose: (top: number, right: number, left: number) => string
}

const TRIANGLES: Record<TriangleType, TriangleConfig> = {
  T1: {
    id: 'T1',
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
}

export default function DgaDuvalTriangle({
  ch4 = 45,
  c2h4 = 35,
  c2h2 = 3,
  h2 = 65,
  c2h6 = 28,
}: DgaDuvalTriangleProps) {
  const [selectedTriangle, setSelectedTriangle] = useState<TriangleType>('T1')
  const currentCfg = TRIANGLES[selectedTriangle]

  let valTop = 0
  let valRight = 0
  let valLeft = 0

  if (selectedTriangle === 'T1') {
    valTop = ch4; valRight = c2h4; valLeft = c2h2
  } else if (selectedTriangle === 'T4') {
    valTop = h2; valRight = ch4; valLeft = c2h6
  } else {
    valTop = ch4; valRight = c2h4; valLeft = c2h6
  }

  const total = valTop + valRight + valLeft
  const pTop = total > 0 ? (valTop / total) * 100 : 0
  const pRight = total > 0 ? (valRight / total) * 100 : 0
  const pLeft = total > 0 ? (valLeft / total) * 100 : 0

  const W = 280
  const H = 240
  const toX = (a: number, b: number, _c: number) => (b / 100) * W + (a / 100) * (W / 2)
  const toY = (a: number, _b: number, _c: number) => H - (a / 100) * H

  const dotX = toX(pTop, pRight, pLeft)
  const dotY = toY(pTop, pRight, pLeft)

  const activeZoneId = currentCfg.diagnose(pTop, pRight, pLeft)
  const activeZoneInfo = currentCfg.zones.find(z => z.id === activeZoneId) || currentCfg.zones[0]

  return (
    <div className="flex flex-col gap-4 text-white">
      {/* Header with Multi-Triangle Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">{currentCfg.label} Diagnostic Studio</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-mono">
              IEEE C57.104 / IEC 60599
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{currentCfg.sublabel}</p>
        </div>

        {/* Triangle Mode Tabs */}
        <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          {(['T1', 'T4', 'T5'] as TriangleType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTriangle(t)}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded font-semibold transition-all',
                selectedTriangle === t
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {t === 'T1' ? 'Triangle 1 (General)' : t === 'T4' ? 'Triangle 4 (<250°C)' : 'Triangle 5 (Paper)'}
            </button>
          ))}
        </div>
      </div>

      {/* Diagnosis Banner */}
      <div className="p-3 rounded-xl border flex items-center justify-between gap-3 bg-[#0a0e1a]" style={{ borderColor: `${activeZoneInfo.color}40` }}>
        <div className="space-y-0.5">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Active Classification</div>
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: activeZoneInfo.color }}>
            <span>{activeZoneInfo.id} — {activeZoneInfo.name}</span>
          </div>
          <div className="text-[11px] text-slate-300/90">{activeZoneInfo.desc}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-500 font-mono">Normalized Gas Ratio</div>
          <div className="text-xs font-bold font-mono text-slate-200 mt-0.5">
            {pTop.toFixed(1)}% / {pRight.toFixed(1)}% / {pLeft.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex justify-center my-1 relative group">
        <svg width={W + 40} height={H + 40} viewBox={`-20 -20 ${W + 40} ${H + 40}`}>
          {/* Polygons */}
          {currentCfg.zones.map((poly) => {
            const pointsStr = poly.points
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

          {/* Outer Triangle Outline */}
          <polygon
            points={`${toX(100,0,0)},${toY(100,0,0)} ${toX(0,100,0)},${toY(0,100,0)} ${toX(0,0,100)},${toY(0,0,100)}`}
            fill="none"
            stroke="#334155"
            strokeWidth="2"
          />

          {/* Gas Labels */}
          <text x={toX(100,0,0)} y={toY(100,0,0) - 10} textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="bold">
            {currentCfg.topGas}
          </text>
          <text x={toX(0,100,0) + 20} y={toY(0,100,0) + 12} textAnchor="middle" fill="#fb923c" fontSize="10" fontWeight="bold">
            {currentCfg.rightGas}
          </text>
          <text x={toX(0,0,100) - 20} y={toY(0,0,100) + 12} textAnchor="middle" fill="#a78bfa" fontSize="10" fontWeight="bold">
            {currentCfg.leftGas}
          </text>

          {/* Current Operating Point */}
          {total > 0 && (
            <g transform={`translate(${dotX}, ${dotY})`}>
              <circle r="10" fill={activeZoneInfo.color} fillOpacity="0.4" className="animate-ping" />
              <circle r="4.5" fill={activeZoneInfo.color} stroke="#ffffff" strokeWidth="2" />
            </g>
          )}
        </svg>

        {/* Hover Inspector Tooltip */}
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-2 text-xs shadow-2xl pointer-events-none z-10">
          <div className="font-semibold text-white mb-1">Active Gas Composition</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <span className="text-slate-400">{currentCfg.topGas}:</span>
            <span className="font-mono text-cyan-300">{pTop.toFixed(1)}% ({valTop} ppm)</span>
            <span className="text-slate-400">{currentCfg.rightGas}:</span>
            <span className="font-mono text-amber-300">{pRight.toFixed(1)}% ({valRight} ppm)</span>
            <span className="text-slate-400">{currentCfg.leftGas}:</span>
            <span className="font-mono text-purple-300">{pLeft.toFixed(1)}% ({valLeft} ppm)</span>
          </div>
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
