'use client'

import React, { useState } from 'react'
import { Layers, AlertTriangle, CheckCircle2, ShieldAlert, DollarSign, TrendingDown, Building, FileSpreadsheet } from 'lucide-react'
import clsx from 'clsx'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'

interface FleetTransformerRisk {
  id: string
  name: string
  site: string
  healthIndex: number
  rulYears: number
  pof: number // 1 to 5
  cof: number // 1 to 5
  loadCriticality: string
  capexAction: string
  budgetEstUsd: number
  fiscalYear: string
  status: 'CRITICAL' | 'WARNING' | 'NORMAL'
}

const FLEET_DATA: FleetTransformerRisk[] = [
  {
    id: 'tr-004',
    name: 'TR-004',
    site: 'Substation 1A',
    healthIndex: 45,
    rulYears: 2.8,
    pof: 5,
    cof: 4,
    loadCriticality: 'Tier-1 Petrochemical Feed',
    capexAction: 'Emergency Unit Replacement (New 30MVA Core)',
    budgetEstUsd: 185000,
    fiscalYear: 'FY2026',
    status: 'CRITICAL',
  },
  {
    id: 'tr-101',
    name: 'TR-101',
    site: 'Substation 2A',
    healthIndex: 58,
    rulYears: 5.2,
    pof: 4,
    cof: 5,
    loadCriticality: 'Data Center Primary Bus',
    capexAction: 'Complete Core Overhaul & Rewinding',
    budgetEstUsd: 85000,
    fiscalYear: 'FY2027',
    status: 'CRITICAL',
  },
  {
    id: 'tr-002',
    name: 'TR-002',
    site: 'Substation 1A',
    healthIndex: 74,
    rulYears: 9.6,
    pof: 3,
    cof: 3,
    loadCriticality: 'Industrial Plant Line B',
    capexAction: 'Online Vacuum Dehydration & Bushing Retrofit',
    budgetEstUsd: 14000,
    fiscalYear: 'FY2026',
    status: 'WARNING',
  },
  {
    id: 'tr-102',
    name: 'TR-102',
    site: 'Substation 2A',
    healthIndex: 68,
    rulYears: 8.1,
    pof: 3,
    cof: 4,
    loadCriticality: 'Regional Hospital Feeder',
    capexAction: 'Full Oil Reclamation & Tap Changer Service',
    budgetEstUsd: 22000,
    fiscalYear: 'FY2027',
    status: 'WARNING',
  },
  {
    id: 'tr-302',
    name: 'TR-302',
    site: 'Substation 3A',
    healthIndex: 71,
    rulYears: 10.4,
    pof: 2,
    cof: 3,
    loadCriticality: 'Commercial Logistics Center',
    capexAction: 'Radiator Cleaning & Gasket Replacement',
    budgetEstUsd: 8500,
    fiscalYear: 'FY2028',
    status: 'WARNING',
  },
  {
    id: 'tr-001',
    name: 'TR-001',
    site: 'Substation 1A',
    healthIndex: 92,
    rulYears: 18.5,
    pof: 1,
    cof: 4,
    loadCriticality: 'Main Grid Interconnect',
    capexAction: 'Routine Condition-Based Maintenance',
    budgetEstUsd: 2500,
    fiscalYear: 'FY2029+',
    status: 'NORMAL',
  },
  {
    id: 'tr-003',
    name: 'TR-003',
    site: 'Substation 1B',
    healthIndex: 88,
    rulYears: 16.2,
    pof: 1,
    cof: 3,
    loadCriticality: 'Secondary Industrial Zone',
    capexAction: 'Routine DGA Oil Sampling (Annual)',
    budgetEstUsd: 1200,
    fiscalYear: 'FY2029+',
    status: 'NORMAL',
  },
  {
    id: 'tr-005',
    name: 'TR-005',
    site: 'Substation 1B',
    healthIndex: 96,
    rulYears: 22.0,
    pof: 1,
    cof: 2,
    loadCriticality: 'Residential Distribution Bus',
    capexAction: 'Routine Inspection',
    budgetEstUsd: 800,
    fiscalYear: 'FY2030+',
    status: 'NORMAL',
  },
]

export default function FleetRiskMatrix() {
  const [selectedAsset, setSelectedAsset] = useState<FleetTransformerRisk | null>(FLEET_DATA[0])

  const totalBudgetReqUsd = FLEET_DATA.reduce((acc, a) => acc + a.budgetEstUsd, 0)
  const criticalCount = FLEET_DATA.filter(a => a.status === 'CRITICAL').length
  const warningCount = FLEET_DATA.filter(a => a.status === 'WARNING').length

  return (
    <div className="rounded-2xl p-5 space-y-5 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <DemoDataBanner
        title="หน้าจอนี้ไม่ได้ดึงข้อมูลจากฟลีทจริงขององค์กรคุณ"
        detail="หม้อแปลงทุกเครื่องในตาราง (TR-004, TR-101, ...) ค่า Health Index, RUL, ตำแหน่ง PoF/CoF และโดยเฉพาะ 'งบประมาณที่ต้องใช้' ทั้งหมด เป็นชุดข้อมูลตัวอย่างที่ฝังอยู่ในโค้ด — ทุกองค์กรที่เปิดหน้านี้จะเห็นตัวเลขชุดเดียวกัน ห้ามนำยอดงบประมาณรวมนี้ไปใช้ตั้งงบหรือจัดลำดับการเปลี่ยนหม้อแปลงจริง"
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-rose-400" />
            <h3 className="text-sm font-bold text-white">Fleet Risk Matrix & CapEx Investment Planning</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-500/30 font-mono font-bold">
              ISO 55000 / IEEE 1459
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Asset investment prioritization: 9-Box Matrix mapping Probability of Failure (PoF) vs Consequence (CoF)
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs self-start sm:self-auto font-mono">
          <div className="text-right">
            <div className="text-[10px] text-slate-400">Total CapEx Pipeline</div>
            <div className="font-bold text-emerald-400">${totalBudgetReqUsd.toLocaleString()} USD</div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Section: 9-Box Matrix + Priority Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 5 Cols: 9-Box Grid */}
        <div className="lg:col-span-5 flex flex-col gap-2">
          <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>9-Box Risk Matrix</span>
            <span className="text-[10px] text-slate-500 font-mono">ISO 55001 Risk Portfolio</span>
          </div>

          <div className="relative p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            {/* Y-Axis Label */}
            <div className="absolute -left-5 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] font-bold text-slate-500 uppercase tracking-widest pointer-events-none">
              Consequence of Failure (CoF) →
            </div>

            {/* 3x3 Grid */}
            <div className="grid grid-cols-3 gap-1.5 h-64">
              {/* Row 3 (High CoF) */}
              <div className="p-2 rounded bg-amber-950/20 border border-amber-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-amber-300 font-mono block w-full mb-1">Med Risk</span>
                {FLEET_DATA.filter(a => a.pof <= 2 && a.cof >= 4).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-rose-950/30 border border-rose-500/40 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-rose-300 font-mono block w-full mb-1">High Risk</span>
                {FLEET_DATA.filter(a => a.pof === 3 && a.cof >= 4).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-rose-500 text-white ring-2 ring-rose-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-rose-950/60 border border-rose-500/80 flex flex-wrap content-start gap-1 shadow-inner">
                <span className="text-[8px] text-rose-200 font-mono font-bold block w-full mb-1">CRITICAL (Tier-1)</span>
                {FLEET_DATA.filter(a => a.pof >= 4 && a.cof >= 4).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono animate-pulse',
                      selectedAsset?.id === a.id ? 'bg-rose-500 text-white ring-2 ring-white' : 'bg-rose-900 text-rose-100 border border-rose-400'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>

              {/* Row 2 (Med CoF) */}
              <div className="p-2 rounded bg-emerald-950/20 border border-emerald-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-emerald-300 font-mono block w-full mb-1">Low Risk</span>
                {FLEET_DATA.filter(a => a.pof <= 2 && a.cof === 3).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-amber-950/20 border border-amber-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-amber-300 font-mono block w-full mb-1">Med Risk</span>
                {FLEET_DATA.filter(a => a.pof === 3 && a.cof === 3).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-rose-950/30 border border-rose-500/40 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-rose-300 font-mono block w-full mb-1">High Risk</span>
                {FLEET_DATA.filter(a => a.pof >= 4 && a.cof === 3).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-rose-500 text-white ring-2 ring-rose-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>

              {/* Row 1 (Low CoF) */}
              <div className="p-2 rounded bg-emerald-950/20 border border-emerald-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-emerald-300 font-mono block w-full mb-1">Low Risk</span>
                {FLEET_DATA.filter(a => a.pof <= 2 && a.cof <= 2).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-emerald-950/20 border border-emerald-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-emerald-300 font-mono block w-full mb-1">Low Risk</span>
                {FLEET_DATA.filter(a => a.pof === 3 && a.cof <= 2).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="p-2 rounded bg-amber-950/20 border border-amber-500/30 flex flex-wrap content-start gap-1">
                <span className="text-[8px] text-amber-300 font-mono block w-full mb-1">Med Risk</span>
                {FLEET_DATA.filter(a => a.pof >= 4 && a.cof <= 2).map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAsset(a)}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-all font-mono',
                      selectedAsset?.id === a.id ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300' : 'bg-slate-800 text-slate-200'
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>

            {/* X-Axis Label */}
            <div className="text-center text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-2">
              Probability of Failure (PoF / Condition Score) →
            </div>
          </div>
        </div>

        {/* Right 7 Cols: CapEx Investment Priority Table */}
        <div className="lg:col-span-7 flex flex-col gap-2">
          <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Asset Replacement & Overhaul Priority Queue</span>
            <span className="text-[10px] text-slate-500 font-mono">{criticalCount} Critical / {warningCount} Warning</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-2">Health</th>
                  <th className="py-2.5 px-2">RUL</th>
                  <th className="py-2.5 px-3">Recommended Action</th>
                  <th className="py-2.5 px-2">FY</th>
                  <th className="py-2.5 px-3 text-right">Est. Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {FLEET_DATA.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedAsset(item)}
                    className={clsx(
                      'cursor-pointer transition-colors',
                      selectedAsset?.id === item.id ? 'bg-slate-800/80 font-bold' : 'hover:bg-slate-900/50'
                    )}
                  >
                    <td className="py-2 px-3 font-sans">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.status === 'CRITICAL' ? '#ef4444' : item.status === 'WARNING' ? '#fbbf24' : '#4ade80' }}
                        />
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal">{item.site}</div>
                    </td>
                    <td className="py-2 px-2">
                      <span className={item.healthIndex < 60 ? 'text-rose-400' : item.healthIndex < 80 ? 'text-amber-400' : 'text-emerald-400'}>
                        {item.healthIndex}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-slate-300">{item.rulYears} yrs</td>
                    <td className="py-2 px-3 font-sans text-slate-200 text-[10px]">
                      {item.capexAction}
                    </td>
                    <td className="py-2 px-2 text-indigo-300 font-bold">{item.fiscalYear}</td>
                    <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                      ${item.budgetEstUsd.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Selected Asset Spotlight */}
          {selectedAsset && (
            <div className="p-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Building size={14} className="text-indigo-400" />
                  Spotlight: {selectedAsset.name} ({selectedAsset.site})
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-200 font-mono">
                  Criticality: {selectedAsset.loadCriticality}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                <strong>CapEx Rationale:</strong> Asset condition (Health Index {selectedAsset.healthIndex}%, RUL {selectedAsset.rulYears} years) threatens high-consequence feeder. Allocating ${selectedAsset.budgetEstUsd.toLocaleString()} in {selectedAsset.fiscalYear} mitigates a projected downtime loss of $1.4M USD.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
