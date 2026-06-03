'use client'

import { useState } from 'react'
import { getAlarmSchema } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'
import { ArrowUp, ArrowDown, TrendingUp, Timer, Activity, Bell, AlertTriangle } from 'lucide-react'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Renders the alarm-parameter form for a product domain (driven by ALARM_SCHEMA).
// `advanced` adds severity routing + escalation + maintenance suppression (admin).
export default function AlarmParamConfig({ domain, advanced = false }: { domain?: SensorDomain; advanced?: boolean }) {
  const schema = getAlarmSchema(domain)

  // generic low/high fallback for unknown domains
  const [generic, setGeneric] = useState({ low: 2, high: 8 })
  const [vals, setVals] = useState(() =>
    Object.fromEntries((schema?.params ?? []).map((p) => [p.key, { warn: p.warn, critical: p.critical, rate: p.rate?.warn }])) as Record<string, { warn: number; critical: number; rate?: number }>,
  )
  const [dwell, setDwell] = useState(schema?.dwellMin ?? 3)
  const [hyst, setHyst] = useState(schema?.hysteresis ?? 1)
  const [healthIdx, setHealthIdx] = useState(schema?.healthIndexWarn ?? 60)
  const [routing, setRouting] = useState({ warn: 'email', critical: 'line', escalateMin: 15, suppress: false })

  const setVal = (key: string, field: 'warn' | 'critical' | 'rate', v: number) =>
    setVals((s) => ({ ...s, [key]: { ...s[key], [field]: v } }))

  if (!schema) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-blue-400 mb-1 uppercase tracking-wider">Lower limit</label>
          <input type="number" value={generic.low} onChange={(e) => setGeneric((g) => ({ ...g, low: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        <div>
          <label className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Upper limit</label>
          <input type="number" value={generic.high} onChange={(e) => setGeneric((g) => ({ ...g, high: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">Thresholds for <span className="text-slate-300">{schema.label}</span> — Warning &amp; Critical per parameter.</div>

      {/* Parameter table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a' }}>
              {['Parameter', 'Warning', 'Critical', 'Rate-of-rise'].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-[10px] text-slate-500 font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schema.params.map((p) => (
              <tr key={p.key} style={{ borderTop: '1px solid #1e2433' }}>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5 text-slate-200">
                    {p.direction === 'high' ? <ArrowUp size={12} className="text-red-400" /> : <ArrowDown size={12} className="text-blue-400" />}
                    {p.label}
                  </div>
                  <div className="text-[10px] text-slate-600 ml-4">{p.unit} · {p.direction === 'high' ? 'alarm above' : 'alarm below'}</div>
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={vals[p.key]?.warn ?? p.warn} onChange={(e) => setVal(p.key, 'warn', +e.target.value)}
                    className="w-20 rounded-md px-2 py-1 text-xs text-amber-300 outline-none focus:ring-1 focus:ring-amber-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={vals[p.key]?.critical ?? p.critical} onChange={(e) => setVal(p.key, 'critical', +e.target.value)}
                    className="w-20 rounded-md px-2 py-1 text-xs text-red-300 outline-none focus:ring-1 focus:ring-red-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  {p.rate ? (
                    <div className="flex items-center gap-1">
                      <TrendingUp size={11} className="text-indigo-400" />
                      <input type="number" value={vals[p.key]?.rate ?? p.rate.warn} onChange={(e) => setVal(p.key, 'rate', +e.target.value)}
                        className="w-16 rounded-md px-2 py-1 text-xs text-indigo-300 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                      <span className="text-[10px] text-slate-600">{p.rate.unit}</span>
                    </div>
                  ) : <span className="text-[10px] text-slate-700">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Timing + composite */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Timer size={11} /> Dwell (min)</label>
          <input type="number" value={dwell} onChange={(e) => setDwell(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Activity size={11} /> Hysteresis</label>
          <input type="number" value={hyst} onChange={(e) => setHyst(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        {schema.healthIndexWarn !== undefined && (
          <div>
            <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Activity size={11} /> Health Idx &lt;</label>
            <input type="number" value={healthIdx} onChange={(e) => setHealthIdx(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
          </div>
        )}
      </div>

      {/* Advanced routing (admin) */}
      {advanced && (
        <div className="rounded-lg p-3 space-y-2.5" style={inset}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white"><Bell size={12} className="text-indigo-400" /> Severity Routing &amp; Escalation</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-amber-400 mb-1 uppercase tracking-wider">Warning → channel</label>
              <select value={routing.warn} onChange={(e) => setRouting((r) => ({ ...r, warn: e.target.value }))} className="w-full rounded-md px-2 py-1.5 text-xs text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
                {['email', 'line', 'telegram', 'googlechat'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Critical → channel</label>
              <select value={routing.critical} onChange={(e) => setRouting((r) => ({ ...r, critical: e.target.value }))} className="w-full rounded-md px-2 py-1.5 text-xs text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
                {['email', 'line', 'telegram', 'googlechat', 'all'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><AlertTriangle size={11} className="text-amber-400" /> Escalate if not acknowledged in</label>
            <div className="flex items-center gap-1">
              <input type="number" value={routing.escalateMin} onChange={(e) => setRouting((r) => ({ ...r, escalateMin: +e.target.value }))} className="w-16 rounded-md px-2 py-1 text-xs text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
              <span className="text-[10px] text-slate-600">min</span>
            </div>
          </div>
          <label className="flex items-center justify-between text-[11px] text-slate-400 cursor-pointer">
            <span>Suppress during maintenance window</span>
            <input type="checkbox" checked={routing.suppress} onChange={(e) => setRouting((r) => ({ ...r, suppress: e.target.checked }))} />
          </label>
        </div>
      )}
    </div>
  )
}
