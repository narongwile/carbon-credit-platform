'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getDepartmentsByOrg, getDevicesByOrg, reportSchedules as seedSchedules } from '@/lib/orgData'
import type { ReportSchedule, ReportSequence } from '@/types/org'
import { FileBarChart, Download, Clock, CheckCircle, CalendarClock, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const REPORT_TYPES = [
  { id: 'health', name: 'Health Status Report', desc: 'Health index and sensor status for all devices', icon: '🏥' },
  { id: 'alarm', name: 'Alarm History Report', desc: 'Complete alarm log with acknowledgment records', icon: '🔔' },
  { id: 'trend', name: 'Sensor Trend Report', desc: '30-day trend analysis with statistical summaries', icon: '📈' },
  { id: 'compliance', name: 'Compliance Report', desc: 'Regulatory compliance status for all assets', icon: '📋' },
]

const SEQUENCES: ReportSequence[] = ['daily', 'weekly', 'monthly']

export default function ReportsPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const departments = getDepartmentsByOrg(orgId)
  const devices = getDevicesByOrg(orgId)

  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)

  const toggleType = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const generate = async () => {
    if (!selected.length) return
    setGenerating(true); setGenerated(false)
    await new Promise((r) => setTimeout(r, 1500))
    setGenerating(false); setGenerated(true)
  }

  // Scheduling
  const [schedules, setSchedules] = useState<ReportSchedule[]>(seedSchedules)
  const [draft, setDraft] = useState<{ name: string; scope: 'device' | 'department'; scopeId: string; sequence: ReportSequence; format: 'PDF' | 'XLSX' | 'CSV' }>({
    name: '', scope: 'department', scopeId: departments[0]?.id ?? '', sequence: 'daily', format: 'PDF',
  })
  const scopeOptions = draft.scope === 'department' ? departments.map((d) => ({ id: d.id, name: d.name })) : devices.map((d) => ({ id: d.id, name: d.name }))
  const addSchedule = () => {
    if (!draft.name.trim()) return
    setSchedules((s) => [...s, { id: `rs-${Date.now()}`, ...draft, scopeId: draft.scopeId || scopeOptions[0]?.id || '', enabled: true }])
    setDraft((d) => ({ ...d, name: '' }))
  }
  const toggleSchedule = (id: string) => setSchedules((s) => s.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const removeSchedule = (id: string) => setSchedules((s) => s.filter((x) => x.id !== id))
  const scopeName = (s: ReportSchedule) => (s.scope === 'department' ? departments.find((d) => d.id === s.scopeId)?.name : devices.find((d) => d.id === s.scopeId)?.name) ?? s.scopeId

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Report Management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Generate on-demand reports and schedule recurring sequences</p>
      </div>

      {/* Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-4">Report Setting (device / department)</h3>
            <div className="space-y-2">
              {REPORT_TYPES.map((rt) => (
                <div key={rt.id} onClick={() => toggleType(rt.id)} className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                  style={selected.includes(rt.id) ? { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' } : inset}>
                  <div className="text-xl w-8 text-center">{rt.icon}</div>
                  <div className="flex-1"><div className="text-sm text-white font-medium">{rt.name}</div><div className="text-xs text-slate-500">{rt.desc}</div></div>
                  <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={selected.includes(rt.id) ? { background: '#6366f1', border: '1px solid #6366f1' } : { border: '1px solid #1e2433' }}>
                    {selected.includes(rt.id) && <CheckCircle size={12} className="text-white" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <span className="text-xs text-slate-400">Format:</span>
              {(['PDF', 'XLSX', 'CSV'] as const).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={format === f ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' } : inset}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={generate} disabled={!selected.length || generating} className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
              <FileBarChart size={16} /> {generating ? 'Generating…' : 'Generate Report'}
            </button>
            {generated && <button className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}><Download size={16} /> Download {format}</button>}
          </div>
        </div>

        {/* Create schedule */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><CalendarClock size={15} className="text-indigo-400" /> Sequence Setting</h3>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Schedule name"
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <div className="flex gap-2">
            {(['department', 'device'] as const).map((sc) => (
              <button key={sc} onClick={() => setDraft((d) => ({ ...d, scope: sc, scopeId: '' }))} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize', draft.scope === sc ? 'text-white' : 'text-slate-500')} style={draft.scope === sc ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{sc}</button>
            ))}
          </div>
          <select value={draft.scopeId} onChange={(e) => setDraft((d) => ({ ...d, scopeId: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
            {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex gap-2">
            {SEQUENCES.map((s) => (
              <button key={s} onClick={() => setDraft((d) => ({ ...d, sequence: s }))} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize', draft.sequence === s ? 'text-white' : 'text-slate-500')} style={draft.sequence === s ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{s}</button>
            ))}
          </div>
          <button onClick={addSchedule} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}><Plus size={15} /> Add Schedule</button>
        </div>
      </div>

      {/* Scheduled reports list */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <h3 className="text-sm font-semibold text-white">Scheduled Reports</h3>
        </div>
        <table className="w-full text-sm" style={{ background: '#0d1117' }}>
          <thead><tr style={{ borderBottom: '1px solid #1e2433' }}>{['Name', 'Scope', 'Sequence', 'Format', 'Enabled', ''].map((h) => <th key={h} className="py-2.5 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #1e2433' }}>
                <td className="py-3 px-4 text-white font-medium">{s.name}</td>
                <td className="py-3 px-4 text-slate-400"><span className="capitalize text-slate-500">{s.scope}:</span> {scopeName(s)}</td>
                <td className="py-3 px-4"><span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{s.sequence}</span></td>
                <td className="py-3 px-4 text-slate-400">{s.format}</td>
                <td className="py-3 px-4"><button onClick={() => toggleSchedule(s.id)}>{s.enabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}</button></td>
                <td className="py-3 px-4 text-right"><button onClick={() => removeSchedule(s.id)} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
