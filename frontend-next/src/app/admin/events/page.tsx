'use client'

import { useEffect, useState } from 'react'
import { Clock, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useOrgAlarms } from '@/lib/useOrgAlarms'
import { api, useIsLive } from '@/lib/api'

export default function EventsPage() {
  const live = useIsLive()
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  // One real, department/domain-scoped query (GET /api/orgs/:orgId/alarms)
  // instead of fanning out GET /api/nodes/:id/events over managedDevicesFromFleet
  // (the mock seed, read unconditionally regardless of Live/Demo mode) — a
  // real device never appeared in this log at all, in either mode.
  const { alarms, loaded } = useOrgAlarms(orgId)
  const [problems, setProblems] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!live) return
    api.eventProblems(orgId).then((rows) => {
      if (!rows) return
      setProblems(Object.fromEntries(rows.map((p) => [p.id, p.label])))
    })
  }, [live, orgId])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Events Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Maintenance schedule and historical events</p>
      </div>

      {!loaded ? <p className="text-sm text-slate-500">Loading events...</p> : (
      <div className="space-y-3">
        {alarms.length === 0 ? <p className="text-sm text-slate-500">No events found.</p> : alarms.slice(0, 50).map((event) => (
          <div
            key={event.id}
            className="flex gap-4 p-4 rounded-xl"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}
          >
            {/* alarm_events.severity is WARNING/CRITICAL only — no INFO exists at
                any layer (DB enum, API type), so there is no third case here. */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#0a0e1a' }}>
              <AlertTriangle size={14} className={event.severity === 'CRITICAL' ? 'text-red-400' : 'text-amber-400'} />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{event.paramLabel}</div>
                  <div className="text-xs text-indigo-400 mt-0.5">{event.nodeName || event.nodeId}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0 ml-4">
                  <Clock size={11} />
                  {new Date(event.raisedAt).toLocaleString()}
                </div>
              </div>
              {event.clearedAt && <div className="text-xs text-slate-400 mt-2">Cleared: {new Date(event.clearedAt).toLocaleString()}</div>}
              {event.eventProblemId && <div className="text-xs text-slate-400 mt-1">Root Cause: <span className="text-white">{problems[event.eventProblemId] || event.eventProblemId}</span></div>}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
