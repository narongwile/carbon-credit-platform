'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, AlertTriangle, CalendarDays, Filter } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useOrgAlarms } from '@/lib/useOrgAlarms'
import { api, useIsLive } from '@/lib/api'
import { fmtDateTime, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import clsx from 'clsx'

// Same presets, same order as admin/alarms — this log and that page are two
// views of the same alarm_events rows, so a range meaning one thing here and
// another there would be its own bug.
const QUICK_RANGES: { label: string; hours: number | null }[] = [
  { label: 'Last 1 hour', hours: 1 },
  { label: 'Last 6 hours', hours: 6 },
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', hours: 24 * 7 },
  { label: 'Last 30 days', hours: 24 * 30 },
  { label: 'All time', hours: null },
]

/** How many rows to render at once — the list is unpaginated. */
const PAGE_CAP = 50

type Severity = 'all' | 'CRITICAL' | 'WARNING'
type Status = 'all' | 'active' | 'cleared' | 'acknowledged'

const STATUSES: { id: Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'cleared', label: 'Cleared' },
  { id: 'acknowledged', label: 'Acknowledged' },
]

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

  // Time range: a quick preset, or an explicit from/to when the operator sets
  // one. Mirrors admin/alarms, including reading the datetime-local inputs as
  // DISPLAY_TZ wall time rather than the browser's — every timestamp in this
  // list is rendered in DISPLAY_TZ by fmtDateTime, so a filter on browser time
  // would disagree with the column right next to it.
  const [quick, setQuick] = useState<string>('Last 7 days')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Event type: severity, lifecycle status, and the root-cause catalogue the
  // page already resolves for its "Root Cause" line.
  const [severity, setSeverity] = useState<Severity>('all')
  const [status, setStatus] = useState<Status>('all')
  const [problemId, setProblemId] = useState('all')

  useEffect(() => {
    if (!live) return
    api.eventProblems(orgId).then((rows) => {
      if (!rows) return
      setProblems(Object.fromEntries(rows.map((p) => [p.id, p.label])))
    })
  }, [live, orgId])

  const range = useMemo(() => {
    if (from || to) {
      return {
        start: from ? fromDisplayInput(from) : 0,
        end: to ? fromDisplayInput(to) : Infinity,
        label: `${from || '…'} → ${to || 'now'}`,
      }
    }
    const hrs = QUICK_RANGES.find((q) => q.label === quick)?.hours ?? null
    return hrs === null
      ? { start: 0, end: Infinity, label: 'All time' }
      : { start: Date.now() - hrs * 3600_000, end: Infinity, label: quick }
  }, [quick, from, to])

  const filtered = useMemo(() => alarms.filter((e) => {
    const t = new Date(e.raisedAt).getTime()
    if (t < range.start || t > range.end) return false
    if (severity !== 'all' && e.severity !== severity) return false
    if (status === 'active' && (e.clearedAt || e.acknowledgedAt)) return false
    if (status === 'cleared' && !e.clearedAt) return false
    if (status === 'acknowledged' && !e.acknowledgedAt) return false
    if (problemId !== 'all' && e.eventProblemId !== problemId) return false
    return true
  }), [alarms, range, severity, status, problemId])

  const problemEntries = Object.entries(problems)
  const filtersActive = severity !== 'all' || status !== 'all' || problemId !== 'all'

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Events Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Maintenance schedule and historical events</p>
      </div>

      {/* Time range */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}
          >
            <CalendarDays size={12} className="text-slate-500" />
            {range.label}
            <span className="text-slate-600">▾</span>
          </button>
          {pickerOpen && (
            <div className="absolute left-0 mt-2 z-20 rounded-xl p-3 w-[420px]" style={{ background: '#0d1117', border: '1px solid #1e2433', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Absolute range</div>
                  <label className="block text-[10px] text-slate-500 mb-1">From</label>
                  <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="w-full text-xs rounded-lg px-2 py-1.5 text-slate-200 mb-2" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }} />
                  <label className="block text-[10px] text-slate-500 mb-1">To</label>
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                    className="w-full text-xs rounded-lg px-2 py-1.5 text-slate-200" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }} />
                  <p className="mt-1.5 text-[10px] text-slate-600">times in {DISPLAY_TZ_LABEL}</p>
                  <button onClick={() => setPickerOpen(false)}
                    className="mt-3 w-full text-xs font-medium text-white px-3 py-1.5 rounded-lg" style={{ background: '#6366f1' }}>
                    Apply range
                  </button>
                  {(from || to) && (
                    <button onClick={() => { setFrom(''); setTo('') }} className="mt-1.5 w-full text-[11px] text-slate-500 hover:text-slate-300">
                      Clear absolute range
                    </button>
                  )}
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Quick ranges</div>
                  <div className="space-y-1">
                    {QUICK_RANGES.map((q) => (
                      <button
                        key={q.label}
                        onClick={() => { setQuick(q.label); setFrom(''); setTo(''); setPickerOpen(false) }}
                        className={clsx('w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors',
                          !from && !to && quick === q.label ? 'text-white' : 'text-slate-400 hover:text-slate-200')}
                        style={!from && !to && quick === q.label
                          ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' }
                          : { background: '#0a0e1a', border: '1px solid #1e2433' }}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event type filters */}
      <div className="flex items-end gap-3 flex-wrap p-4 rounded-xl" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Severity</label>
          <div className="flex gap-1.5">
            {(['all', 'CRITICAL', 'WARNING'] as Severity[]).map((s) => (
              <button key={s} onClick={() => setSeverity(s)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', severity === s ? 'text-white' : 'text-slate-400')}
                style={severity === s ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                {s === 'all' ? 'All' : s === 'CRITICAL' ? 'Critical' : 'Warning'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Status</label>
          <div className="flex gap-1.5">
            {STATUSES.map((s) => (
              <button key={s.id} onClick={() => setStatus(s.id)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', status === s.id ? 'text-white' : 'text-slate-400')}
                style={status === s.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Root cause</label>
          <select value={problemId} onChange={(e) => setProblemId(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <option value="all">All root causes</option>
            {problemEntries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {problemEntries.length === 0 && (
            <p className="text-[10px] text-slate-600 mt-1">No root causes defined yet.</p>
          )}
        </div>

        {filtersActive && (
          <button onClick={() => { setSeverity('all'); setStatus('all'); setProblemId('all') }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <Filter size={11} /> Clear filters
          </button>
        )}
      </div>

      {!loaded ? <p className="text-sm text-slate-500">Loading events...</p> : (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          {filtered.length === 0 ? 'No events match these filters.'
            : `Showing ${Math.min(filtered.length, PAGE_CAP)} of ${filtered.length} event${filtered.length === 1 ? '' : 's'}`}
        </p>
        {filtered.slice(0, PAGE_CAP).map((event) => (
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
                  {fmtDateTime(event.raisedAt)}
                </div>
              </div>
              {event.clearedAt && <div className="text-xs text-slate-400 mt-2">Cleared: {fmtDateTime(event.clearedAt)}</div>}
              {event.eventProblemId && <div className="text-xs text-slate-400 mt-1">Root Cause: <span className="text-white">{problems[event.eventProblemId] || event.eventProblemId}</span></div>}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
