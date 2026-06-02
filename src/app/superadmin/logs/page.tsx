'use client'

import { auditLogs } from '@/lib/mockData'
import { CheckCircle, XCircle, Clock, User, Filter } from 'lucide-react'
import { useState } from 'react'

export default function LogsPage() {
  const [filter, setFilter] = useState<'all' | 'success' | 'failure'>('all')

  const filtered = auditLogs.filter((l) => filter === 'all' || l.status === filter)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">System Logs</h1>
          <p className="text-sm text-slate-500 mt-1">Audit trail of all system and user actions</p>
        </div>
        <div className="flex gap-2">
          {(['all', 'success', 'failure'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
              style={filter === f ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' } : { background: '#0d1117', color: '#6b7280', border: '1px solid #1e2433' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Actor', 'Action', 'Target', 'IP Address', 'Timestamp', 'Status'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {filtered.map((log) => (
              <tr key={log.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #1e2433' }}>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-2">
                    <User size={12} className="text-indigo-400" />
                    <span className="text-indigo-400 font-medium">{log.actor}</span>
                  </div>
                </td>
                <td className="py-3.5 px-4 text-slate-300">{log.action}</td>
                <td className="py-3.5 px-4 text-slate-400">{log.target}</td>
                <td className="py-3.5 px-4 text-slate-500 font-mono text-xs">{log.ipAddress}</td>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1 text-slate-500 text-xs">
                    <Clock size={10} />
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  {log.status === 'success' ? (
                    <div className="flex items-center gap-1 text-green-400 text-xs">
                      <CheckCircle size={12} /> Success
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-red-400 text-xs">
                      <XCircle size={12} /> Failed
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
