'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { eventProblems } from '@/lib/orgData'
import { viewerEventProblems } from '@/lib/viewer'
import { AlertTriangle, XCircle, Info, Clock, Check } from 'lucide-react'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

export default function CustomerAlarmsPage() {
  const { alarms, acknowledgeAlarm, viewerUserId } = useAppStore()
  const evProblems = viewerEventProblems(viewerUserId).length ? viewerEventProblems(viewerUserId) : eventProblems
  const [event, setEvent] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const orgAlarms = alarms.filter((a) => a.orgId === 'org-1')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Alarms</h1>
        <p className="text-sm text-slate-500">All devices · acknowledge events and filter by problem type</p>
      </div>

      {/* Filters: event selection dropdown + date-time select */}
      <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl" style={inset}>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Event Selection</label>
          <select value={event} onChange={(e) => setEvent(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <option value="all">All events</option>
            {evProblems.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">From</label>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">To</label>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
        </div>
      </div>

      <div className="space-y-2">
        {orgAlarms.map((alarm) => {
          const cfg = {
            CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', icon: <XCircle size={14} className="text-red-400" /> },
            WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', icon: <AlertTriangle size={14} className="text-amber-400" /> },
            INFO: { color: '#60a5fa', bg: 'rgba(96,165,250,0.06)', icon: <Info size={14} className="text-blue-400" /> },
          }
          const c = cfg[alarm.severity]
          return (
            <div key={alarm.id} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: c.bg, border: `1px solid ${c.color}25`, opacity: alarm.acknowledged ? 0.6 : 1 }}>
              {c.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-300">{alarm.message}</div>
                <div className="text-xs text-slate-600 mt-0.5">{alarm.transformerName}</div>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Clock size={10} />
                {new Date(alarm.timestamp).toLocaleTimeString()}
              </div>
              <span className="text-xs font-bold" style={{ color: c.color }}>{alarm.severity}</span>
              {alarm.acknowledged ? (
                <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                  <Check size={11} /> ACK by {alarm.acknowledgedBy ?? 'viewer'}
                </span>
              ) : (
                <button onClick={() => acknowledgeAlarm(alarm.id, 'viewer')}
                  className="text-xs font-medium text-white px-3 py-1.5 rounded-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  Acknowledge
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
