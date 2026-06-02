'use client'

import { useAppStore } from '@/lib/store'
import { AlertTriangle, XCircle, Info, Clock } from 'lucide-react'

export default function CustomerAlarmsPage() {
  const { alarms } = useAppStore()
  const orgAlarms = alarms.filter((a) => a.orgId === 'org-1')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Active Alarms</h1>
        <p className="text-sm text-slate-500">Read-only alarm monitoring</p>
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
            <div key={alarm.id} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: c.bg, border: `1px solid ${c.color}25` }}>
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
              {alarm.acknowledged && (
                <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">ACK</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
