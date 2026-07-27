'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { viewerDomains } from '@/lib/viewer'
import { managedDevicesFromFleet } from '@/lib/fleetData'
import { api } from '@/lib/api'
import { AlertTriangle, XCircle, Info, Clock, Check } from 'lucide-react'
import { useSessionOrgId } from '@/lib/auth'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

export default function CustomerAlarmsPage() {
  const { viewerUserId } = useAppStore()
  const orgId = useSessionOrgId()
  
  // Filter devices by viewer domain access
  const allowed = viewerDomains(viewerUserId)
  const devices = managedDevicesFromFleet(orgId).filter((d) => !d.domain || allowed.includes(d.domain))

  const [events, setEvents] = useState<any[]>([])
  const [evProblems, setEvProblems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [evClass, setEvClass] = useState<Record<string, string>>({}) // alarm id -> selected problem id

  const [filterEvent, setFilterEvent] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.eventProblems(orgId).catch(() => []),
      ...devices.map(d => api.events(d.id).catch(() => []))
    ]).then(([probs, ...res]) => {
      setEvProblems(probs || [])
      const allEvents = res.flat().filter(Boolean).sort((a: any, b: any) => new Date(b.raised_at).getTime() - new Date(a.raised_at).getTime())
      setEvents(allEvents)
      setLoading(false)
    })
  }, [devices.length, orgId])

  const handleAck = async (eventId: string) => {
    try {
      const selectedProblem = evClass[eventId] ?? evProblems[0]?.id
      await api.ackEvent(eventId, { by: 'viewer', eventProblemId: selectedProblem })
      // Update local state to reflect ack
      setEvents(events.map(ev => ev.id === eventId ? { ...ev, acknowledged_by: 'viewer' } : ev))
    } catch (e) {
      console.error('Failed to ack event', e)
    }
  }

  const filteredEvents = events.filter((a) => {
    if (filterEvent !== 'all') {
      const pId = a.event_problem_id || evClass[a.id]
      if (pId !== filterEvent) return false
    }
    if (from && new Date(a.raised_at).getTime() < new Date(from).getTime()) return false
    if (to && new Date(a.raised_at).getTime() > new Date(to).getTime()) return false
    return true
  })

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
          <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}
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
        {loading ? <p className="text-sm text-slate-500 p-4">Loading events...</p> : 
         filteredEvents.length === 0 ? <p className="text-sm text-slate-500 p-4">No alarms found.</p> :
         filteredEvents.map((alarm) => {
          const cfg = {
            critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', icon: <XCircle size={14} className="text-red-400" /> },
            warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', icon: <AlertTriangle size={14} className="text-amber-400" /> },
            info: { color: '#60a5fa', bg: 'rgba(96,165,250,0.06)', icon: <Info size={14} className="text-blue-400" /> },
          }
          const severity = alarm.severity?.toLowerCase() || 'info'
          const c = (cfg as any)[severity] || cfg.info
          const acked = !!alarm.acknowledged_by
          const nodeName = devices.find(n => n.id === alarm.node_id)?.name || alarm.node_id
          
          return (
            <div key={alarm.id} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: c.bg, border: `1px solid ${c.color}25`, opacity: acked ? 0.6 : 1 }}>
              {c.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-300">{alarm.message || alarm.param_key}</div>
                <div className="text-xs text-slate-600 mt-0.5">{nodeName}</div>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Clock size={10} />
                {new Date(alarm.raised_at).toLocaleString()}
              </div>
              <span className="text-xs font-bold uppercase" style={{ color: c.color }}>{alarm.severity}</span>
              {acked ? (
                <div className="flex flex-col items-end gap-1 ml-4 w-48">
                  <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                    <Check size={11} /> ACK by {alarm.acknowledged_by}
                  </span>
                  {alarm.event_problem_id && (
                     <span className="text-[10px] text-slate-500 truncate w-full text-right">
                       Cause: {evProblems.find(p => p.id === alarm.event_problem_id)?.label || alarm.event_problem_id}
                     </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 ml-4">
                  <select 
                    value={evClass[alarm.id] ?? evProblems[0]?.id ?? ''} 
                    onChange={e => setEvClass({ ...evClass, [alarm.id]: e.target.value })}
                    className="text-[11px] bg-[#0d1117] text-slate-300 border border-slate-700 rounded-md px-2 py-1 outline-none w-32"
                  >
                    {evProblems.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <button onClick={() => handleAck(alarm.id)}
                    className="text-[11px] font-medium text-white px-3 py-1.5 rounded-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                    Acknowledge
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
