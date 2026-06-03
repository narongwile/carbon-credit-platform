'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { AlertTriangle, XCircle, Info, CheckCircle, Clock, Filter } from 'lucide-react'
import type { Alarm } from '@/types'

function AlarmRow({ alarm, onAck }: { alarm: Alarm; onAck: (id: string) => void }) {
  const cfg = {
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', icon: <XCircle size={14} className="text-red-400" /> },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.15)', icon: <AlertTriangle size={14} className="text-amber-400" /> },
    INFO: { color: '#60a5fa', bg: 'rgba(96,165,250,0.06)', border: 'rgba(96,165,250,0.15)', icon: <Info size={14} className="text-blue-400" /> },
  }
  const c = cfg[alarm.severity]

  return (
    <tr
      className="transition-colors"
      style={{
        background: alarm.acknowledged ? 'transparent' : c.bg,
        borderBottom: '1px solid #1e2433',
        opacity: alarm.acknowledged ? 0.6 : 1,
      }}
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {c.icon}
          <span className="text-xs font-bold" style={{ color: c.color }}>{alarm.severity}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className="text-xs font-semibold text-indigo-400">{alarm.transformerName}</span>
      </td>
      <td className="py-3 px-4 max-w-xs">
        <div className="text-sm text-slate-300 truncate">{alarm.message}</div>
        <div className="text-xs text-slate-600">{alarm.sensor}</div>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm font-bold text-white">{alarm.value}</span>
        <span className="text-xs text-slate-500 ml-1">{alarm.unit}</span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock size={10} />
          {new Date(alarm.timestamp).toLocaleString()}
        </div>
      </td>
      <td className="py-3 px-4">
        {alarm.acknowledged ? (
          <div>
            <div className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle size={11} /> Acknowledged
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">by {alarm.acknowledgedBy}</div>
          </div>
        ) : (
          <button
            onClick={() => onAck(alarm.id)}
            className="text-xs px-3 py-1.5 rounded-lg text-white font-medium transition-all hover:opacity-90"
            style={{ background: '#6366f1' }}
          >
            Acknowledge
          </button>
        )}
      </td>
    </tr>
  )
}

export default function AlarmsPage() {
  const { alarms, acknowledgeAlarm, selectedOrgId } = useAppStore()
  const [filter, setFilter] = useState<'all' | 'CRITICAL' | 'WARNING' | 'INFO'>('all')
  const [showAcked, setShowAcked] = useState(false)

  const orgAlarms = alarms.filter((a) => a.orgId === selectedOrgId)
  const filtered = orgAlarms.filter((a) => {
    if (!showAcked && a.acknowledged) return false
    if (filter !== 'all' && a.severity !== filter) return false
    return true
  })

  const critCount = orgAlarms.filter((a) => a.severity === 'CRITICAL' && !a.acknowledged).length
  const warnCount = orgAlarms.filter((a) => a.severity === 'WARNING' && !a.acknowledged).length

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Alarm Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Monitor and acknowledge system alarms</p>
        </div>
        <div className="flex items-center gap-3">
          {critCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <XCircle size={14} className="text-red-400" />
              <span className="text-red-400 text-sm font-semibold">{critCount} Critical</span>
            </div>
          )}
          {warnCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-amber-400 text-sm font-semibold">{warnCount} Warning</span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {(['all', 'CRITICAL', 'WARNING', 'INFO'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
              style={filter === f
                ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' }
                : { background: '#0d1117', color: '#6b7280', border: '1px solid #1e2433' }
              }
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAcked(!showAcked)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ml-auto transition-all"
          style={showAcked
            ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' }
            : { background: '#0d1117', color: '#6b7280', border: '1px solid #1e2433' }
          }
        >
          <Filter size={12} />
          {showAcked ? 'Hide Acknowledged' : 'Show Acknowledged'}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Severity', 'Transformer', 'Message', 'Value', 'Timestamp', 'Status'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-600">
                  <CheckCircle size={24} className="mx-auto mb-2 text-green-400 opacity-50" />
                  No alarms matching current filters
                </td>
              </tr>
            ) : (
              filtered.map((alarm) => (
                <AlarmRow
                  key={alarm.id}
                  alarm={alarm}
                  onAck={(id) => acknowledgeAlarm(id, 'admin')}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
