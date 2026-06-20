'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

export default function TrendsPage() {
  const { selectedOrgId, getTransformersByOrg } = useAppStore()
  const transformers = getTransformersByOrg(selectedOrgId)
  const [selectedId, setSelectedId] = useState(transformers[0]?.id || '')

  const transformer = transformers.find((t) => t.id === selectedId)
  if (!transformer) return null

  const s = transformer.sensors
  const history = s.oilTemperature.history.slice(-96)
  const data = history.map((p, i) => {
    const t = new Date(p.time)
    return {
      time: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`,
      oilTemp: s.oilTemperature.history[i]?.value || 0,
      load: s.load.history[i]?.value || 0,
      hydrogen: s.hydrogen.history[i]?.value || 0,
      moisture: s.moisture.history[i]?.value || 0,
    }
  })

  const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Sensor Trends</h1>
          <p className="text-sm text-slate-500 mt-0.5">24-hour historical trend analysis</p>
        </div>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ background: '#0d1117', border: '1px solid #1e2433' }}
        >
          {transformers.map((t) => (
            <option key={t.id} value={t.id}>{t.name} — {t.location}</option>
          ))}
        </select>
      </div>

      {[
        { title: 'Load & Oil Temperature', keys: [{ key: 'load', color: '#6366f1', name: 'Load (%)' }, { key: 'oilTemp', color: '#f97316', name: 'Oil Temp (°C)' }] },
        { title: 'Dissolved Gas Analysis', keys: [{ key: 'hydrogen', color: '#22d3ee', name: 'Hydrogen (ppm)' }, { key: 'moisture', color: '#a78bfa', name: 'Moisture (ppm)' }] },
      ].map((chart) => (
        <div key={chart.title} className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <h3 className="text-sm font-semibold text-white mb-4">{chart.title}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval={11} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              {chart.keys.map((k) => (
                <Line key={k.key} type="monotone" dataKey={k.key} stroke={k.color} strokeWidth={1.5} dot={false} name={k.name} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  )
}
