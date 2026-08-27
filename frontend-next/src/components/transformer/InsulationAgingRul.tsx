'use client'

import React from 'react'

interface InsulationAgingRulProps {
  hotSpotTemp: number
  hoursInService: number
  oilTemp: number
}

export default function InsulationAgingRul({ hotSpotTemp, hoursInService, oilTemp }: InsulationAgingRulProps) {
  // IEEE C57.91 Arrhenius aging
  // Reference temp = 110°C (383.15 K)
  const refTempK = 110 + 273.15
  const hotSpotK = hotSpotTemp + 273.15
  const faa = Math.exp(15000 / refTempK - 15000 / hotSpotK)
  
  // Cumulative Equivalent Hours
  const eqHours = hoursInService * faa
  
  // DP Estimation (Simplified Chendong model or standard relation)
  // New = ~1000, EOL = ~200
  // Very simplified linear degradation for UI purposes:
  // Assuming 180,000 equivalent hours is EOL
  const EOL_HOURS = 180000
  const dpValue = Math.max(200, 1000 - (eqHours / EOL_HOURS) * 800)
  const percentLife = Math.max(0, 100 - (eqHours / EOL_HOURS) * 100)
  
  const remainingHours = Math.max(0, EOL_HOURS - eqHours)
  const remainingYears = remainingHours / (365.25 * 24)

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
          <span>0% (New)</span>
          <span>Life Consumed: {(100 - percentLife).toFixed(1)}%</span>
          <span>100% (EOL)</span>
        </div>
        <div className="h-2 w-full bg-[#1e2433] rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-all duration-500" 
            style={{ width: `${100 - percentLife}%` }} 
          />
        </div>
      </div>
    </div>
  )
}
