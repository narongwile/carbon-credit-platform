'use client'

import { FileBarChart, Download, Clock } from 'lucide-react'

const REPORTS = [
  { name: 'Health Status Report - May 2024', date: '2024-05-01', size: '2.3 MB' },
  { name: 'Alarm History - April 2024', date: '2024-04-30', size: '1.1 MB' },
  { name: 'Monthly Trend Analysis', date: '2024-04-15', size: '4.7 MB' },
]

export default function CustomerReportsPage() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Reports</h1>
        <p className="text-sm text-slate-500">Download available reports</p>
      </div>

      <div className="space-y-3">
        {REPORTS.map((r) => (
          <div key={r.name} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <FileBarChart size={16} className="text-indigo-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm text-white">{r.name}</div>
              <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                <Clock size={10} />
                {r.date} · {r.size}
              </div>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-indigo-400 hover:text-white transition-colors" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <Download size={12} />
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
