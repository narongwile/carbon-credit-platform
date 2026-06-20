'use client'

import { useEffect, useState } from 'react'
import { Clock, Wrench, AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { managedDevicesFromFleet } from '@/lib/fleetData'
import { api } from '@/lib/api'

const EVENTS = [
  { type: 'maintenance', icon: <Wrench size={14} className="text-cyan-400" />, title: 'Scheduled Oil Sampling', transformer: 'TR-001', date: '2024-06-01', note: 'Annual DGA oil sampling test due' },
  { type: 'alarm', icon: <AlertTriangle size={14} className="text-amber-400" />, title: 'Hydrogen Warning Acknowledged', transformer: 'TR-002', date: '2024-05-22', note: 'H2 at 145 ppm, investigation ongoing' },
  { type: 'info', icon: <Info size={14} className="text-blue-400" />, title: 'Firmware Update Deployed', transformer: 'ALL', date: '2024-05-20', note: 'Monitoring unit firmware v2.4.1 installed' },
  { type: 'maintenance', icon: <Wrench size={14} className="text-cyan-400" />, title: 'Tap Changer Inspection Due', transformer: 'TR-004', date: '2024-06-15', note: 'Bi-annual tap changer operation check' },
  { type: 'alarm', icon: <AlertTriangle size={14} className="text-red-400" />, title: 'Critical Oil Level Alert', transformer: 'TR-004', date: '2024-05-24', note: 'Oil level dropped to 55%, maintenance dispatched' },
  { type: 'info', icon: <Info size={14} className="text-blue-400" />, title: 'New Transformer Commissioned', transformer: 'TR-005', date: '2024-04-10', note: 'TR-005 successfully commissioned and added to monitoring' },
]

export default function EventsPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const nodes = managedDevicesFromFleet(orgId)
  const [events, setEvents] = useState<any[]>([])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.eventProblems(orgId).catch(() => []),
      ...nodes.map(n => api.events(n.id).catch(() => []))
    ]).then(([probs, ...res]) => {
      const probList = probs || []
      const probMap = probList.reduce((acc: any, p: any) => ({ ...acc, [p.id]: p.label }), {})
      setProblems(probMap)
      const allEvents = res.flat().sort((a: any, b: any) => new Date(b.raised_at).getTime() - new Date(a.raised_at).getTime())
      setEvents(allEvents)
      setLoading(false)
    })
  }, [nodes.length, orgId])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Events Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Maintenance schedule and historical events</p>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading events...</p> : (
      <div className="space-y-3">
        {events.length === 0 ? <p className="text-sm text-slate-500">No events found.</p> : events.slice(0, 50).map((event: any, i) => (
          <div
            key={i}
            className="flex gap-4 p-4 rounded-xl"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#0a0e1a' }}>
              {event.severity === 'critical' ? <AlertTriangle size={14} className="text-red-400" /> : event.severity === 'warning' ? <AlertTriangle size={14} className="text-amber-400" /> : <Info size={14} className="text-blue-400" />}
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{event.message || event.param_key}</div>
                  <div className="text-xs text-indigo-400 mt-0.5">{nodes.find(n => n.id === event.node_id)?.name || event.node_id}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0 ml-4">
                  <Clock size={11} />
                  {new Date(event.raised_at).toLocaleString()}
                </div>
              </div>
              {event.cleared_at && <div className="text-xs text-slate-400 mt-2">Cleared: {new Date(event.cleared_at).toLocaleString()}</div>}
              {event.event_problem_id && <div className="text-xs text-slate-400 mt-1">Root Cause: <span className="text-white">{problems[event.event_problem_id] || event.event_problem_id}</span></div>}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
