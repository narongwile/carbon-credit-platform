'use client'

import { Clock, Wrench, AlertTriangle, Info } from 'lucide-react'

const EVENTS = [
  { type: 'maintenance', icon: <Wrench size={14} className="text-cyan-400" />, title: 'Scheduled Oil Sampling', transformer: 'TR-001', date: '2024-06-01', note: 'Annual DGA oil sampling test due' },
  { type: 'alarm', icon: <AlertTriangle size={14} className="text-amber-400" />, title: 'Hydrogen Warning Acknowledged', transformer: 'TR-002', date: '2024-05-22', note: 'H2 at 145 ppm, investigation ongoing' },
  { type: 'info', icon: <Info size={14} className="text-blue-400" />, title: 'Firmware Update Deployed', transformer: 'ALL', date: '2024-05-20', note: 'Monitoring unit firmware v2.4.1 installed' },
  { type: 'maintenance', icon: <Wrench size={14} className="text-cyan-400" />, title: 'Tap Changer Inspection Due', transformer: 'TR-004', date: '2024-06-15', note: 'Bi-annual tap changer operation check' },
  { type: 'alarm', icon: <AlertTriangle size={14} className="text-red-400" />, title: 'Critical Oil Level Alert', transformer: 'TR-004', date: '2024-05-24', note: 'Oil level dropped to 55%, maintenance dispatched' },
  { type: 'info', icon: <Info size={14} className="text-blue-400" />, title: 'New Transformer Commissioned', transformer: 'TR-005', date: '2024-04-10', note: 'TR-005 successfully commissioned and added to monitoring' },
]

export default function EventsPage() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Events Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Maintenance schedule and historical events</p>
      </div>

      <div className="space-y-3">
        {EVENTS.map((event, i) => (
          <div
            key={i}
            className="flex gap-4 p-4 rounded-xl"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#0a0e1a' }}>
              {event.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{event.title}</div>
                  <div className="text-xs text-indigo-400 mt-0.5">{event.transformer}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0 ml-4">
                  <Clock size={11} />
                  {event.date}
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">{event.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
