'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { FileBarChart, Download, Clock, CheckCircle } from 'lucide-react'

const REPORT_TYPES = [
  { id: 'health', name: 'Health Status Report', desc: 'Comprehensive health index and sensor status for all transformers', icon: '🏥' },
  { id: 'alarm', name: 'Alarm History Report', desc: 'Complete alarm log with acknowledgment records', icon: '🔔' },
  { id: 'trend', name: 'Sensor Trend Report', desc: '30-day trend analysis with statistical summaries', icon: '📈' },
  { id: 'maintenance', name: 'Maintenance Schedule', desc: 'Upcoming maintenance recommendations based on condition', icon: '🔧' },
  { id: 'compliance', name: 'Compliance Report', desc: 'Regulatory compliance status for all assets', icon: '📋' },
]

const RECENT_REPORTS = [
  { name: 'Health Status Report - May 2024', date: '2024-05-01', size: '2.3 MB', type: 'PDF' },
  { name: 'Alarm History - April 2024', date: '2024-04-30', size: '1.1 MB', type: 'XLSX' },
  { name: 'Monthly Trend Analysis', date: '2024-04-15', size: '4.7 MB', type: 'PDF' },
  { name: 'Q1 Compliance Report', date: '2024-03-31', size: '0.8 MB', type: 'PDF' },
]

export default function ReportsPage() {
  const { selectedOrgId, getTransformersByOrg } = useAppStore()
  const transformers = getTransformersByOrg(selectedOrgId)
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [dateRange, setDateRange] = useState('30')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)

  const toggleType = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const generate = async () => {
    if (selected.length === 0) return
    setGenerating(true)
    setGenerated(false)
    await new Promise((r) => setTimeout(r, 2000))
    setGenerating(false)
    setGenerated(true)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Report Generator</h1>
        <p className="text-sm text-slate-500 mt-0.5">Generate and download reports for your transformers</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          {/* Report types */}
          <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-4">Select Report Types</h3>
            <div className="space-y-2">
              {REPORT_TYPES.map((rt) => (
                <div
                  key={rt.id}
                  onClick={() => toggleType(rt.id)}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                  style={
                    selected.includes(rt.id)
                      ? { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' }
                      : { background: '#0a0e1a', border: '1px solid #1e2433' }
                  }
                >
                  <div className="text-xl w-8 text-center">{rt.icon}</div>
                  <div className="flex-1">
                    <div className="text-sm text-white font-medium">{rt.name}</div>
                    <div className="text-xs text-slate-500">{rt.desc}</div>
                  </div>
                  <div
                    className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                    style={selected.includes(rt.id) ? { background: '#6366f1', border: '1px solid #6366f1' } : { border: '1px solid #1e2433' }}
                  >
                    {selected.includes(rt.id) && <CheckCircle size={12} className="text-white" />}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-4">Report Options</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-2">Date Range</label>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                  style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">Format</label>
                <div className="flex gap-2">
                  {(['PDF', 'XLSX', 'CSV'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                      style={format === f
                        ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' }
                        : { background: '#0a0e1a', color: '#6b7280', border: '1px solid #1e2433' }
                      }
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={generate}
              disabled={selected.length === 0 || generating}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              {generating ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <FileBarChart size={16} />
                  Generate Report
                </>
              )}
            </button>
            {generated && (
              <button className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>
                <Download size={16} />
                Download {format}
              </button>
            )}
          </div>
        </div>

        {/* Recent reports */}
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Recent Reports</h3>
            <div className="space-y-3">
              {RECENT_REPORTS.map((r) => (
                <div key={r.name} className="flex items-start gap-2 py-2" style={{ borderBottom: '1px solid #1e2433' }}>
                  <FileBarChart size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-300 truncate">{r.name}</div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-600 mt-0.5">
                      <Clock size={9} />
                      {r.date} · {r.size}
                    </div>
                  </div>
                  <button className="text-indigo-400 hover:text-indigo-300">
                    <Download size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Transformers in Report</h3>
            <div className="space-y-1.5">
              {transformers.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full ${t.status === 'NORMAL' ? 'bg-green-400' : t.status === 'WARNING' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <span className="text-slate-400">{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
