'use client'

// ---------------------------------------------------------------------------
// The viewer's alarm feed. Brought up to the same capability as admin/alarms,
// which it lagged behind in four ways that mattered:
//
//   · It fetched GET /api/nodes/:id/events ONCE PER DEVICE — an org with 80
//     devices fired 80 requests on every load, and the list could not be
//     refreshed without repeating all of them. admin/alarms has always used
//     the single org endpoint (useOrgAlarms → GET /api/orgs/:orgId/alarms),
//     which is department/site/product/per-user scoped server-side, so a
//     viewer reading it sees exactly their own devices' alarms and no more.
//   · Acknowledge recorded the literal string 'viewer' as the actor, so
//     alarm_events.acknowledged_by said "viewer" for every person in the
//     organization and it was impossible to tell who had actually responded.
//   · No severity filter, no quick ranges, no open/acknowledged toggle and no
//     counts — the admin page has all four.
//   · No export, while the admin page offers CSV and PDF.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { useOrgAlarms, type OrgAlarmRow } from '@/lib/useOrgAlarms'
import { useSessionOrgId, getSession } from '@/lib/auth'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import { AlertTriangle, XCircle, Clock, Check, CalendarDays, Download, FileText } from 'lucide-react'
import { fmtDateTime, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Same presets and order as admin/alarms — the two are views of the same rows.
const QUICK_RANGES: { label: string; hours: number | null }[] = [
  { label: 'Last 1 hour', hours: 1 },
  { label: 'Last 6 hours', hours: 6 },
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', hours: 24 * 7 },
  { label: 'Last 30 days', hours: 24 * 30 },
  { label: 'All time', hours: null },
]

interface EventProblem { id: string; label: string }

export default function CustomerAlarmsPage() {
  const orgId = useSessionOrgId()
  const live = useIsLive()
  // One scoped request, polled — not one request per device.
  const { alarms, loaded, refetch } = useOrgAlarms(orgId, { pollMs: live ? 20000 : undefined })

  const [evProblems, setEvProblems] = useState<EventProblem[]>([])
  const [evClass, setEvClass] = useState<Record<string, string>>({})
  const [acking, setAcking] = useState<string | null>(null)

  const [filterEvent, setFilterEvent] = useState('all')
  const [severity, setSeverity] = useState<'all' | 'CRITICAL' | 'WARNING'>('all')
  const [showAcked, setShowAcked] = useState(false)
  const [quick, setQuick] = useState<string>('Last 24 hours')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Root-cause catalogue for the filter and each row's ack picker. A viewer
  // only sees their own department's problems + org-wide ones — otherwise
  // picking "Cooling fan failure" from Substation A could file an alarm on a
  // Substation B device under a cause that department never defined.
  useEffect(() => {
    if (!live) { setEvProblems([]); return }
    let cancelled = false
    ;(async () => {
      const myDepts = (await api.myAccess())?.departmentIds ?? []
      const rows = await api.eventProblems(orgId).catch(() => null)
      if (cancelled || !rows) return
      setEvProblems(rows.filter((r) => r.department_id === null || myDepts.includes(r.department_id)))
    })()
    return () => { cancelled = true }
  }, [live, orgId])

  const range = useMemo(() => {
    if (from || to) {
      // fromDisplayInput, not new Date(): a datetime-local value is the
      // BROWSER's wall clock while every timestamp here renders in DISPLAY_TZ,
      // so reading it raw made the filter and the visible column disagree.
      return { start: from ? fromDisplayInput(from) : 0, end: to ? fromDisplayInput(to) : Infinity, label: `${from || '…'} → ${to || 'now'}` }
    }
    const hrs = QUICK_RANGES.find((q) => q.label === quick)?.hours ?? null
    return hrs === null
      ? { start: 0, end: Infinity, label: 'All time' }
      : { start: Date.now() - hrs * 3600_000, end: Infinity, label: quick }
  }, [quick, from, to])

  const filtered = alarms.filter((a) => {
    if (!showAcked && a.acknowledgedAt) return false
    if (severity !== 'all' && a.severity !== severity) return false
    if (filterEvent !== 'all' && (a.eventProblemId || evClass[a.id]) !== filterEvent) return false
    const ts = new Date(a.raisedAt).getTime()
    if (Number.isFinite(ts) && (ts < range.start || ts > range.end)) return false
    return true
  })

  const critCount = alarms.filter((a) => a.severity === 'CRITICAL' && !a.acknowledgedAt).length
  const warnCount = alarms.filter((a) => a.severity === 'WARNING' && !a.acknowledgedAt).length

  const handleAck = async (a: OrgAlarmRow) => {
    // The signed-in person, not the literal string 'viewer' — otherwise every
    // acknowledgement in the organization is attributed to the same word and
    // "who responded to this" is unanswerable after the fact.
    const me = getSession()
    const by = me?.name || me?.email || 'viewer'
    setAcking(a.id)
    const r = await api.ackEvent(a.id, { by, eventProblemId: evClass[a.id] ?? evProblems[0]?.id })
    setAcking(null)
    // The result was ignored and local state updated regardless, so a rejected
    // ack still showed as acknowledged until the next reload.
    if (!r) { return }
    refetch()
  }

  const EXPORT_HEADERS = ['Severity', 'Device', 'Parameter', 'Value', 'Unit', 'Threshold', 'Raised', 'Status', 'Acknowledged By']
  const exportRows = () => filtered.map((a) => [
    a.severity, a.nodeName, a.paramLabel, a.value, a.unit, a.threshold,
    fmtDateTime(a.raisedAt), a.acknowledgedAt ? 'Acknowledged' : 'Open', a.acknowledgedBy ?? '',
  ])

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Alarms</h1>
          <p className="text-sm text-slate-500">Your devices · acknowledge events and record a root cause</p>
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

      {/* Time range + export */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <button onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300" style={surface}>
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
                    className="w-full text-xs rounded-lg px-2 py-1.5 text-slate-200 mb-2" style={inset} />
                  <label className="block text-[10px] text-slate-500 mb-1">To</label>
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                    className="w-full text-xs rounded-lg px-2 py-1.5 text-slate-200" style={inset} />
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
                      <button key={q.label}
                        onClick={() => { setQuick(q.label); setFrom(''); setTo(''); setPickerOpen(false) }}
                        className={clsx('w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors',
                          !from && !to && quick === q.label ? 'text-white' : 'text-slate-400 hover:text-slate-200')}
                        style={!from && !to && quick === q.label
                          ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' }
                          : inset}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => downloadCSV('alarms', EXPORT_HEADERS, exportRows())}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-300 disabled:opacity-40" style={surface}>
          <Download size={12} /> CSV
        </button>
        <button onClick={() => printTablePDF('Alarms', EXPORT_HEADERS, exportRows())}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-300 disabled:opacity-40" style={surface}>
          <FileText size={12} /> PDF
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl" style={inset}>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Severity</label>
          <div className="flex gap-1.5">
            {(['all', 'CRITICAL', 'WARNING'] as const).map((s) => (
              <button key={s} onClick={() => setSeverity(s)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', severity === s ? 'text-white' : 'text-slate-400')}
                style={severity === s ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                {s === 'all' ? 'All' : s === 'CRITICAL' ? 'Critical' : 'Warning'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Root cause</label>
          <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs text-white outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <option value="all">All events</option>
            {evProblems.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 pb-1.5 cursor-pointer">
          <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} />
          Show acknowledged
        </label>
      </div>

      <div className="space-y-2">
        {!loaded ? <p className="text-sm text-slate-500 p-4">Loading alarms…</p> :
         filtered.length === 0 ? (
           <p className="text-sm text-slate-500 p-4">
             {alarms.length === 0 ? 'No alarms on your devices.' : 'No alarms match these filters.'}
           </p>
         ) :
         filtered.map((a) => {
          const crit = a.severity === 'CRITICAL'
          const color = crit ? '#ef4444' : '#fbbf24'
          const bg = crit ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.06)'
          const acked = !!a.acknowledgedAt
          return (
            <div key={a.id} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: bg, border: `1px solid ${color}25`, opacity: acked ? 0.6 : 1 }}>
              {crit ? <XCircle size={14} className="text-red-400 flex-shrink-0" /> : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-300 truncate">
                  {a.paramLabel}: {a.value}{a.unit} (threshold {a.threshold}{a.unit})
                </div>
                <div className="text-xs text-slate-600 mt-0.5 truncate">{a.nodeName}</div>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">
                <Clock size={10} />
                {fmtDateTime(a.raisedAt)}
              </div>
              <span className="text-xs font-bold uppercase flex-shrink-0" style={{ color }}>{a.severity}</span>
              {acked ? (
                <div className="flex flex-col items-end gap-1 ml-4 w-48 flex-shrink-0">
                  <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                    <Check size={11} /> ACK by {a.acknowledgedBy || '—'}
                  </span>
                  {a.eventProblemId && (
                    <span className="text-[10px] text-slate-500 truncate w-full text-right">
                      Cause: {evProblems.find((p) => p.id === a.eventProblemId)?.label || a.eventProblemId}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <select value={evClass[a.id] ?? evProblems[0]?.id ?? ''}
                    onChange={(e) => setEvClass({ ...evClass, [a.id]: e.target.value })}
                    className="text-[11px] bg-[#0d1117] text-slate-300 border border-slate-700 rounded-md px-2 py-1 outline-none w-32">
                    {evProblems.length === 0 && <option value="">No root causes</option>}
                    {evProblems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <button onClick={() => handleAck(a)} disabled={acking === a.id}
                    className="text-[11px] font-medium text-white px-3 py-1.5 rounded-lg disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                    {acking === a.id ? '…' : 'Acknowledge'}
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
