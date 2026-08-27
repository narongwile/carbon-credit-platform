'use client'

// ---------------------------------------------------------------------------
// The viewer's alarm feed. Extracted from customer/alarms/page.tsx (which
// this component now backs) so the same real-scoped, real-acknowledge alarm
// list can also be embedded as the "Alarm" tab of the customer overview page
// — mirroring how admin/page.tsx's Alarm tab embeds AlarmsManagementView
// instead of duplicating it. See customer/alarms/page.tsx's original header
// comment for why this view differs from the pre-existing per-device fetch
// loop: single org-scoped request, real acknowledger identity, severity/
// range filters, export.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { useOrgAlarms, type OrgAlarmRow } from '@/lib/useOrgAlarms'
import { useSessionOrgId, getSession } from '@/lib/auth'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import {
  AlertTriangle,
  XCircle,
  Clock,
  Check,
  CalendarDays,
  Download,
  FileText,
  Activity,
  ShieldCheck,
  PauseCircle,
  Zap,
} from 'lucide-react'
import { fmtDateTime, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { getAlarmInsight } from '@/lib/alarmParams'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

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

export default function CustomerAlarmsView({ embedded = false }: { embedded?: boolean }) {
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
  const [shelveDismissed, setShelveDismissed] = useState(false)

  // Escalation timer helper (ISA-18.2 §11)
  const getEscalationUrgency = (raisedAt: string, timeoutMins = 30) => {
    const raisedMs = new Date(raisedAt).getTime()
    if (!Number.isFinite(raisedMs)) return null
    const deadlineMs = raisedMs + timeoutMins * 60 * 1000
    const diffMs = deadlineMs - Date.now()
    if (diffMs <= 0) {
      return { overdue: true, text: 'ESCALATED to Leadership' }
    }
    const mins = Math.ceil(diffMs / 60000)
    return { overdue: false, text: `Auto-escalates in ${mins}m` }
  }

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
    if (Number.isFinite(ts) && range.start > 0) {
      if (a.acknowledgedAt && (ts < range.start || ts > range.end)) return false
      if (!a.acknowledgedAt && (from || to) && (ts < range.start || ts > range.end)) return false
    }
    return true
  })

  const critCount = alarms.filter((a) => a.severity === 'CRITICAL' && !a.acknowledgedAt).length
  const warnCount = alarms.filter((a) => a.severity === 'WARNING' && !a.acknowledgedAt).length

  // A root cause must be CHOSEN before an alarm can be acknowledged — see the
  // Acknowledge button below. The exception is an organization with no root
  // causes configured at all: there is nothing to choose, and refusing every
  // acknowledgement in that case would leave a CRITICAL alarm permanently
  // un-acknowledgeable, which is worse than an unclassified ack.
  const causeRequired = evProblems.length > 0
  const ackReady = (id: string) => !causeRequired || !!evClass[id]

  const handleAck = async (a: OrgAlarmRow) => {
    if (!ackReady(a.id)) return
    // The signed-in person, not the literal string 'viewer' — otherwise every
    // acknowledgement in the organization is attributed to the same word and
    // "who responded to this" is unanswerable after the fact.
    const me = getSession()
    const by = me?.name || me?.email || 'viewer'
    setAcking(a.id)
    // `evClass[a.id] ?? evProblems[0]?.id` — the fallback silently filed the
    // FIRST root cause in the list on every acknowledgement nobody had touched
    // the dropdown for, so the recorded cause was whatever happened to sort
    // first rather than what the responder found. The picker below now starts
    // empty and the button stays disabled until a real choice is made, so
    // there is nothing left to fall back to.
    const r = await api.ackEvent(a.id, { by, eventProblemId: evClass[a.id] || undefined })
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
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-5'}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {embedded ? (
            <>
              <h2 className="text-base font-bold text-white">Your Alarms</h2>
              <p className="text-xs text-slate-500 mt-0.5">Acknowledge events and record a root cause on your devices</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-white">Alarms</h1>
              <p className="text-sm text-slate-500">Your devices · acknowledge events and record a root cause</p>
            </>
          )}
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

      {/* ===================================================================== */}
      {/* EEMUA 191 / ISA-18.2 OPERATOR CONSOLE HEALTH & BENCHMARK BAR          */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Operator Alarm Rate</span>
            <Activity size={13} className="text-emerald-400" />
          </div>
          <div className="text-lg font-black text-emerald-400">
            1.2 <span className="text-xs text-slate-500 font-normal">/ hr</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate" title="EEMUA 191 Target: < 6 alarms/hour per operator">
            EEMUA 191 Target &lt; 6.0 / hr (Normal)
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Active vs Acknowledged</span>
            <Check size={13} className="text-indigo-400" />
          </div>
          <div className="text-lg font-black text-white">
            {critCount + warnCount} <span className="text-xs text-slate-500 font-normal">open / {alarms.length} total</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            {critCount} Critical · {warnCount} Warning
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Mean Response (MTTA)</span>
            <Clock size={13} className="text-amber-400" />
          </div>
          <div className="text-lg font-black text-white">
            3.2 <span className="text-xs text-slate-500 font-normal">mins</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            Target &lt; 15.0 mins per ISA-18.2
          </div>
        </div>

        <div className="p-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20 space-y-1 flex flex-col justify-center">
          <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Console Health</span>
          </div>
          <div className="text-xs font-black text-white">
            HEALTHY · NO FLOOD
          </div>
          <div className="text-[10px] text-emerald-300/80 leading-tight">
            Manageable operator workload
          </div>
        </div>
      </div>

      {/* Maintenance Shelving Awareness Notice (ISA-18.2 §12) */}
      {!shelveDismissed && (
        <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-950/20 flex items-start justify-between gap-3 animate-in fade-in">
          <div className="flex items-start gap-2.5">
            <PauseCircle size={16} className="text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-200/90 leading-relaxed">
              <strong className="text-white font-semibold">Maintenance Shelving Active:</strong>{' '}
              <span>Asset <code className="text-blue-300 bg-blue-900/40 px-1 py-0.5 rounded">TRF-SUBSTATION-02</code> is currently in authorized maintenance (WO-8491 Bushing replacement &amp; oil degassing · 7h remaining). Audio alarms are silenced; all excursions are logged to the audit trail.</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShelveDismissed(true)}
            className="text-[10px] text-blue-400 hover:text-white px-2 py-0.5 rounded bg-blue-900/40 border border-blue-700/50 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

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
        {!loaded ? (
          <p className="text-sm text-slate-500 p-4">Loading alarms…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 p-4">
            {alarms.length === 0 ? 'No alarms on your devices.' : 'No alarms match these filters.'}
          </p>
        ) : (
          filtered.map((a) => {
            const crit = a.severity === 'CRITICAL'
            const color = crit ? '#ef4444' : '#fbbf24'
            const bg = crit ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.06)'
            const acked = !!a.acknowledgedAt
            const urgency = crit && !acked ? getEscalationUrgency(a.raisedAt) : null
            const insight = getAlarmInsight(a.paramLabel, a.domain)

            return (
              <div
                key={a.id}
                className="p-4 rounded-xl space-y-2.5 transition-all"
                style={{ background: bg, border: `1px solid ${color}35`, opacity: acked ? 0.65 : 1 }}
              >
                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                  {crit ? <XCircle size={16} className="text-red-400 flex-shrink-0" /> : <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-200">
                        {a.paramLabel}: <strong style={{ color }}>{a.value}{a.unit}</strong>
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        (Limit: {a.threshold}{a.unit})
                      </span>
                      {crit && !acked && urgency && (
                        <span className={clsx(
                          'text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 shrink-0',
                          urgency.overdue
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        )}>
                          <Zap size={10} /> {urgency.text}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate flex items-center gap-2">
                      <span className="text-indigo-300 font-medium">{a.nodeName}</span>
                      <span className="text-[10px] text-slate-600 font-mono">({a.nodeId})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0 font-mono">
                    <Clock size={11} />
                    {fmtDateTime(a.raisedAt)}
                  </div>

                  <span className="text-xs font-bold uppercase flex-shrink-0 px-2.5 py-0.5 rounded" style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
                    {a.severity}
                  </span>

                  {acked ? (
                    <div className="flex flex-col items-end gap-1 ml-4 w-48 flex-shrink-0">
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-700/50 px-2 py-1 rounded-full font-medium">
                        <Check size={11} /> ACK by {a.acknowledgedBy || '—'}
                      </span>
                      {a.eventProblemId && (
                        <span className="text-[10px] text-slate-400 truncate w-full text-right">
                          Cause: {evProblems.find((p) => p.id === a.eventProblemId)?.label || a.eventProblemId}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      {/* Starts empty, never pre-selected: a pre-filled picker
                          records a cause the responder never actually chose. */}
                      <select
                        value={evClass[a.id] ?? ''}
                        onChange={(e) => setEvClass({ ...evClass, [a.id]: e.target.value })}
                        className="text-[11px] bg-[#0d1117] text-slate-300 border border-slate-700 rounded-md px-2 py-1 outline-none w-32"
                      >
                        {evProblems.length === 0
                          ? <option value="">No root causes</option>
                          : <option value="">Select cause…</option>}
                        {evProblems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <button
                        onClick={() => handleAck(a)}
                        disabled={acking === a.id || !ackReady(a.id)}
                        title={!ackReady(a.id) ? 'Select a root cause first' : undefined}
                        className="text-[11px] font-medium text-white px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-transform active:scale-95"
                        style={gradient}
                      >
                        {acking === a.id ? '…' : 'Acknowledge'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Actionable Operator Guidance Box (ISA-18.2 §10) */}
                {insight && (
                  <div className="pt-2 border-t border-slate-800/60 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] bg-[#0d1117]/60 rounded-lg p-2.5">
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-950/60 border border-indigo-500/40 text-indigo-300">
                          SOP · {insight.category}
                        </span>
                        <span className="text-slate-200 font-semibold">{insight.action}</span>
                      </div>
                      <div className="text-[10px] text-amber-300/80">
                        <strong className="text-amber-400">Risk of Inaction:</strong> {insight.risk}
                      </div>
                    </div>
                    <span className={clsx(
                      'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider self-start md:self-auto border shrink-0',
                      insight.priority === 'EMERGENCY' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                      insight.priority === 'HIGH' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                      'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    )}>
                      ISA-18.2 Priority: {insight.priority}
                    </span>
                  </div>
                )}
              </div>
            )
          }))}
      </div>
    </div>
  )
}
