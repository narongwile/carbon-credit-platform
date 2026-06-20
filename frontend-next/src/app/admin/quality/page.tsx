'use client'

import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ShieldCheck, Layers, CheckCircle2, TrendingUp } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }

const qualityData = [
  { day: 'Mon', Bronze: 95, Silver: 98, Gold: 100 },
  { day: 'Tue', Bronze: 92, Silver: 97, Gold: 100 },
  { day: 'Wed', Bronze: 98, Silver: 99, Gold: 100 },
  { day: 'Thu', Bronze: 88, Silver: 95, Gold: 99 },
  { day: 'Fri', Bronze: 94, Silver: 98, Gold: 100 },
  { day: 'Sat', Bronze: 97, Silver: 99, Gold: 100 },
  { day: 'Sun', Bronze: 99, Silver: 100, Gold: 100 },
]

const LAYERS = [
  { name: 'Bronze', status: 'Healthy', quality: '98%', records: '1.2M', icon: Layers, color: '#d97706' },
  { name: 'Silver', status: 'Scanning', quality: '99.5%', records: '850K', icon: ShieldCheck, color: '#3b82f6' },
  { name: 'Gold', status: 'Healthy', quality: '100%', records: '45K', icon: CheckCircle2, color: '#22c55e' },
] as const

export default function DataQualityPage() {
  const [active, setActive] = useState<'Bronze' | 'Silver' | 'Gold'>('Silver')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Data Quality</h1>
        <p className="text-sm text-slate-500 mt-0.5">Medallion data-lake health across Bronze / Silver / Gold layers</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LAYERS.map((l) => (
          <button key={l.name} onClick={() => setActive(l.name)} className="text-left rounded-2xl p-5 transition-all"
            style={{ ...surface, borderColor: active === l.name ? l.color : '#1e2433', boxShadow: active === l.name ? `0 0 0 3px ${l.color}22` : 'none' }}>
            <div className="flex justify-between items-start mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${l.color}1f`, color: l.color }}><l.icon size={20} /></div>
              <TrendingUp size={18} style={{ color: l.color }} />
            </div>
            <h3 className="text-lg font-bold text-white">{l.name} Layer</h3>
            <div className="mt-4 space-y-2.5">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Data Health</span><span className="font-bold" style={{ color: l.status === 'Healthy' ? '#4ade80' : '#3b82f6' }}>{l.status}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Quality Score</span><span className="font-bold text-white">{l.quality}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Records</span><span className="font-bold text-white">{l.records}</span></div>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl p-5" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-4">7-day Quality Trend</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={qualityData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              {LAYERS.map((l) => (
                <linearGradient key={l.name} id={`q-${l.name}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={l.color} stopOpacity={0.35} /><stop offset="100%" stopColor={l.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
            <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={11} domain={[80, 100]} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
            <Area type="monotone" dataKey={active} stroke={LAYERS.find((l) => l.name === active)!.color} strokeWidth={2.5} fill={`url(#q-${active})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
