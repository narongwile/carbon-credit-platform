'use client'

import React, { useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea
} from 'recharts'
import { Leaf, Factory, Zap, Truck, Target, TrendingDown, Info, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const SCOPE_DATA = [
  { name: 'Scope 1 (Direct)', value: 12.4, color: '#f43f5e' },
  { name: 'Scope 2 (Grid)', value: 847.2, color: '#6366f1' },
  { name: 'Scope 3 (Value Chain)', value: 156.8, color: '#fbbf24' },
]

const TOU_DATA = Array.from({ length: 24 }).map((_, i) => {
  let intensity = 0.45;
  if (i >= 9 && i <= 15) {
    intensity = 0.38 + Math.random() * 0.02 - 0.01;
  } else if (i >= 18 && i <= 22) {
    intensity = 0.58 + Math.random() * 0.04 - 0.02;
  } else {
    intensity = 0.45 + Math.random() * 0.02 - 0.01;
  }
  return {
    hour: `${i.toString().padStart(2, '0')}:00`,
    intensity: parseFloat(intensity.toFixed(3)),
  }
})

const TRAJECTORY_DATA = [
  { year: '2020', actual: 1200, target: 1200 },
  { year: '2021', actual: 1150, target: 1140 },
  { year: '2022', actual: 1080, target: 1080 },
  { year: '2023', actual: 1050, target: 1020 },
  { year: '2024', actual: 1016.4, target: 960 },
  { year: '2025', actual: null, target: 900 },
  { year: '2026', actual: null, target: 840 },
  { year: '2030', actual: null, target: 600 },
  { year: '2040', actual: null, target: 0 },
]

type Tab = 'scope' | 'tou' | 'sbti'

export default function CarbonPage() {
  const [activeTab, setActiveTab] = useState<Tab>('scope')

  const totalEmissions = SCOPE_DATA.reduce((acc, curr) => acc + curr.value, 0)

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <Leaf className="w-6 h-6 text-emerald-400" />
              Carbon & ESG Net-Zero Accounting
            </h1>
            <p className="text-slate-500 mt-1">
              Comprehensive greenhouse gas accounting, grid carbon intensity tracking, and SBTi alignment.
            </p>
          </div>
          <div className="flex gap-2 p-1 rounded-lg" style={inset}>
            {[
              { id: 'scope', label: 'Scope Breakdown', icon: Factory },
              { id: 'tou', label: 'TOU Intensity', icon: Zap },
              { id: 'sbti', label: 'SBTi Trajectory', icon: Target },
            ].map((t) => {
              const Icon = t.icon
              const isActive = activeTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as Tab)}
                  className={clsx(
                    "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content Tabs */}
        {activeTab === 'scope' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-xl flex flex-col gap-4" style={surface}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                    <Factory className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">Scope 1 (Direct)</h3>
                    <p className="text-xs text-slate-500">SF6 leakage, onsite diesel generators</p>
                  </div>
                </div>
                <div className="text-3xl font-bold text-white">12.4 <span className="text-sm font-normal text-slate-500">tCO₂e</span></div>
              </div>
              <div className="p-6 rounded-xl flex flex-col gap-4" style={surface}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">Scope 2 (Grid Electricity)</h3>
                    <p className="text-xs text-slate-500">Purchased electricity from transformers</p>
                  </div>
                </div>
                <div className="text-3xl font-bold text-white">847.2 <span className="text-sm font-normal text-slate-500">tCO₂e</span></div>
              </div>
              <div className="p-6 rounded-xl flex flex-col gap-4" style={surface}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">Scope 3 (Value Chain)</h3>
                    <p className="text-xs text-slate-500">Cold-chain transport, fleet vehicles</p>
                  </div>
                </div>
                <div className="text-3xl font-bold text-white">156.8 <span className="text-sm font-normal text-slate-500">tCO₂e</span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="col-span-1 p-6 rounded-xl flex flex-col items-center justify-center relative" style={surface}>
                <h3 className="text-lg font-medium text-white w-full text-left mb-4">Total Emissions</h3>
                <div className="w-full h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={SCOPE_DATA}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                      >
                        {SCOPE_DATA.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                        itemStyle={{ color: '#cbd5e1' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold text-white">{totalEmissions.toFixed(1)}</span>
                    <span className="text-xs text-slate-500">tCO₂e</span>
                  </div>
                </div>
              </div>
              
              <div className="col-span-2 p-6 rounded-xl" style={surface}>
                <h3 className="text-lg font-medium text-white mb-4">Emissions Log</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-[#0a0e1a]">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">Source</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Value</th>
                        <th className="px-4 py-3 rounded-tr-lg">Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433]">
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-300">Transformer Substation A</td>
                        <td className="px-4 py-3">Scope 2</td>
                        <td className="px-4 py-3">450.5</td>
                        <td className="px-4 py-3 text-slate-500">tCO₂e</td>
                      </tr>
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-300">Transformer Substation B</td>
                        <td className="px-4 py-3">Scope 2</td>
                        <td className="px-4 py-3">396.7</td>
                        <td className="px-4 py-3 text-slate-500">tCO₂e</td>
                      </tr>
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-300">Logistics Fleet (EV & ICE)</td>
                        <td className="px-4 py-3">Scope 3</td>
                        <td className="px-4 py-3">120.3</td>
                        <td className="px-4 py-3 text-slate-500">tCO₂e</td>
                      </tr>
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-300">Cold-chain Transport (bloodBox)</td>
                        <td className="px-4 py-3">Scope 3</td>
                        <td className="px-4 py-3">36.5</td>
                        <td className="px-4 py-3 text-slate-500">tCO₂e</td>
                      </tr>
                      <tr className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-300">SF6 Switchgear Leakage</td>
                        <td className="px-4 py-3">Scope 1</td>
                        <td className="px-4 py-3">12.4</td>
                        <td className="px-4 py-3 text-slate-500">tCO₂e</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tou' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-6 rounded-xl" style={surface}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-medium text-white">24-Hour Grid Carbon Intensity</h3>
                  <p className="text-sm text-slate-500">Marginal emissions factor (kgCO₂e/kWh) based on regional grid mix.</p>
                </div>
                <div className="flex gap-4 text-xs">
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500"></div> Solar Peak</div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500"></div> Evening Peak</div>
                </div>
              </div>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={TOU_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorIntensity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                    <XAxis dataKey="hour" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} domain={['dataMin - 0.05', 'dataMax + 0.05']} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                      itemStyle={{ color: '#cbd5e1' }}
                    />
                    <ReferenceArea x1="09:00" x2="15:00" fill="#10b981" fillOpacity={0.1} />
                    <ReferenceArea x1="18:00" x2="22:00" fill="#f43f5e" fillOpacity={0.1} />
                    <Area type="monotone" dataKey="intensity" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorIntensity)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="p-6 rounded-xl" style={surface}>
              <h3 className="text-lg font-medium text-white flex items-center gap-2 mb-4">
                <TrendingDown className="w-5 h-5 text-indigo-400" />
                Carbon Arbitrage Recommendations
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex gap-4">
                  <div className="mt-1"><CheckCircle className="w-5 h-5 text-emerald-400" /></div>
                  <div>
                    <h4 className="font-medium text-emerald-300">Shift load to Solar Hours (09:00 - 15:00)</h4>
                    <p className="text-sm text-slate-400 mt-1">Grid intensity is ~15% lower during mid-day. Schedule heavy cold-chain pre-chilling or non-critical batch processes here.</p>
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-rose-500/20 bg-rose-500/5 flex gap-4">
                  <div className="mt-1"><AlertTriangle className="w-5 h-5 text-rose-400" /></div>
                  <div>
                    <h4 className="font-medium text-rose-300">Avoid Evening Peak (18:00 - 22:00)</h4>
                    <p className="text-sm text-slate-400 mt-1">Fossil-fuel peaker plants drive intensity up by 25%. Defer EV fleet charging until after 22:00 to reduce Scope 2.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sbti' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-6 rounded-xl" style={surface}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-medium text-white flex items-center gap-2">
                    <Target className="w-5 h-5 text-emerald-400" />
                    Net-Zero Trajectory (SBTi 1.5°C Aligned)
                  </h3>
                  <p className="text-sm text-slate-500">Tracking cumulative tCO₂e against science-based reduction targets.</p>
                </div>
                <div className="px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Behind Target (+5.8%)
                </div>
              </div>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={TRAJECTORY_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                    <XAxis dataKey="year" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d1117', borderColor: '#1e2433', color: '#fff' }}
                      itemStyle={{ color: '#cbd5e1' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', color: '#cbd5e1' }} />
                    <Line type="monotone" dataKey="target" name="SBTi Target Path" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    <Line type="monotone" dataKey="actual" name="Actual Emissions" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-white">2026 Near-Term Target</span>
                  <span className="text-slate-500">840 tCO₂e</span>
                </div>
                <div className="w-full h-2 bg-[#1e2433] rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 w-[85%] rounded-full"></div>
                </div>
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>30% reduction from 2020</span>
                  <span className="text-rose-400">At Risk</span>
                </div>
              </div>
              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-white">2030 Interim Target</span>
                  <span className="text-slate-500">600 tCO₂e</span>
                </div>
                <div className="w-full h-2 bg-[#1e2433] rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 w-[50%] rounded-full"></div>
                </div>
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>50% reduction from 2020</span>
                  <span>Pending</span>
                </div>
              </div>
              <div className="p-5 rounded-xl flex flex-col gap-3" style={inset}>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-white">2040 Net-Zero</span>
                  <span className="text-slate-500">0 tCO₂e</span>
                </div>
                <div className="w-full h-2 bg-[#1e2433] rounded-full overflow-hidden">
                  <div className="h-full bg-slate-700 w-[15%] rounded-full"></div>
                </div>
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>100% reduction</span>
                  <span>Long-term</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
