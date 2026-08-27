'use client'

import React, { useMemo } from 'react'

interface DgaDuvalTriangleProps {
  ch4: number // ppm
  c2h4: number // ppm
  c2h2: number // ppm
}

const ZONES = [
  { id: 'PD', name: 'Partial Discharge', color: '#3b82f6' },
  { id: 'T1', name: 'Thermal < 300°C', color: '#22c55e' },
  { id: 'T2', name: 'Thermal 300-700°C', color: '#eab308' },
  { id: 'T3', name: 'Thermal > 700°C', color: '#f97316' },
  { id: 'D1', name: 'Low Energy Discharge', color: '#ec4899' },
  { id: 'D2', name: 'High Energy Discharge', color: '#ef4444' },
  { id: 'DT', name: 'Mixed (Thermal & Electrical)', color: '#a78bfa' },
]

export default function DgaDuvalTriangle({ ch4, c2h4, c2h2 }: DgaDuvalTriangleProps) {
  const total = ch4 + c2h4 + c2h2
  const pCh4 = total > 0 ? (ch4 / total) * 100 : 0
  const pC2h4 = total > 0 ? (c2h4 / total) * 100 : 0
  const pC2h2 = total > 0 ? (c2h2 / total) * 100 : 0

  // Barycentric to Cartesian coordinates
  // Top: CH4 (0.5, sqrt(3)/2), Bottom Right: C2H4 (1, 0), Bottom Left: C2H2 (0, 0)
  // We'll scale to a 300x260 SVG coordinate system
  const W = 300
  const H = 260
  
  const toX = (a: number, b: number, c: number) => (b / 100) * W + (a / 100) * (W / 2)
  const toY = (a: number, b: number, c: number) => H - (a / 100) * H

  const dotX = toX(pCh4, pC2h4, pC2h2)
  const dotY = toY(pCh4, pC2h4, pC2h2)

  // Polygons for the zones (approximated for Duval Triangle 1)
  const polygons = [
    // PD: CH4 >= 98
    { id: 'PD', points: [[98,0,2], [100,0,0], [98,2,0]] },
    // T1: C2H2 < 4, C2H4 < 20, CH4 < 98
    { id: 'T1', points: [[98,2,0], [76,20,4], [96,0,4], [98,0,2]] },
    // T2: C2H2 < 4, C2H4 20-50
    { id: 'T2', points: [[76,20,4], [46,50,4], [50,50,0], [80,20,0]] },
    // T3: C2H2 < 15, C2H4 > 50
    { id: 'T3', points: [[46,50,4], [35,50,15], [0,85,15], [0,100,0], [50,50,0]] },
    // D1: C2H2 > 13 (approx for D1)
    { id: 'D1', points: [[87,0,13], [77,10,13], [64,13,23], [0,23,77], [0,0,100], [87,0,13]] }, // Simplified
    // D2: High Energy
    { id: 'D2', points: [[77,10,13], [35,50,15], [0,71,29], [0,23,77], [64,13,23]] }, // Simplified
    // DT: Mixed
    { id: 'DT', points: [[96,0,4], [76,20,4], [46,50,4], [35,50,15], [77,10,13], [87,0,13]] }, // Simplified
  ]

  // Find active zone
  let activeZone = 'Unknown'
  if (pCh4 >= 98) activeZone = 'PD'
  else if (pC2h2 < 4 && pC2h4 < 20) activeZone = 'T1'
  else if (pC2h2 < 4 && pC2h4 >= 20 && pC2h4 < 50) activeZone = 'T2'
  else if (pC2h2 < 15 && pC2h4 >= 50) activeZone = 'T3'
  else if (pC2h2 >= 13 && pC2h4 < 23) activeZone = 'D1'
  else if (pC2h2 >= 13 && pC2h4 >= 23 && pC2h4 < 71) activeZone = 'D2'
  else activeZone = 'DT'

  const activeZoneInfo = ZONES.find(z => z.id === activeZone) || ZONES[0]

  return (
    <div className="flex flex-col gap-4 text-white">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">Duval Triangle 1</h3>
          <p className="text-xs text-slate-400">IEEE C57.104 / IEC 60599 Diagnostics</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Diagnosis</div>
          <div className="text-sm font-bold" style={{ color: activeZoneInfo.color }}>
            {activeZone} - {activeZoneInfo.name}
          </div>
        </div>
      </div>

      <div className="flex justify-center my-2 relative group">
        <svg width={W + 40} height={H + 40} viewBox={`-20 -20 ${W + 40} ${H + 40}`}>
          {/* Polygons */}
          {polygons.map((poly) => {
            const pointsStr = poly.points
              .map(p => `${toX(p[0], p[1], p[2])},${toY(p[0], p[1], p[2])}`)
              .join(' ')
            const zoneInfo = ZONES.find(z => z.id === poly.id)
            return (
              <polygon
                key={poly.id}
                points={pointsStr}
                fill={zoneInfo?.color}
                fillOpacity="0.15"
                stroke={zoneInfo?.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                className="transition-all duration-300"
              />
            )
          })}

          {/* Triangle Outline */}
          <polygon
            points={`${toX(100,0,0)},${toY(100,0,0)} ${toX(0,100,0)},${toY(0,100,0)} ${toX(0,0,100)},${toY(0,0,100)}`}
            fill="none"
            stroke="#1e2433"
            strokeWidth="2"
          />

          {/* Labels */}
          <text x={toX(100,0,0)} y={toY(100,0,0) - 10} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="bold">%CH4</text>
          <text x={toX(0,100,0) + 15} y={toY(0,100,0) + 10} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="bold">%C2H4</text>
          <text x={toX(0,0,100) - 15} y={toY(0,0,100) + 10} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="bold">%C2H2</text>

          {/* Plot Point */}
          {total > 0 && (
            <g transform={`translate(${dotX}, ${dotY})`}>
              <circle r="8" fill={activeZoneInfo.color} fillOpacity="0.4" className="animate-ping" />
              <circle r="4" fill={activeZoneInfo.color} stroke="#fff" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {/* Hover Tooltip */}
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0a0e1a] border border-[#1e2433] rounded-lg p-2 text-xs shadow-xl pointer-events-none z-10">
          <div className="font-semibold mb-1">Concentrations</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <span className="text-slate-400">CH4:</span>
            <span>{pCh4.toFixed(1)}% ({ch4} ppm)</span>
            <span className="text-slate-400">C2H4:</span>
            <span>{pC2h4.toFixed(1)}% ({c2h4} ppm)</span>
            <span className="text-slate-400">C2H2:</span>
            <span>{pC2h2.toFixed(1)}% ({c2h2} ppm)</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        {ZONES.map(z => (
          <div key={z.id} className="flex items-center gap-1.5 text-[10px] text-slate-300">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: z.color }}></div>
            <span>{z.id}: {z.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
