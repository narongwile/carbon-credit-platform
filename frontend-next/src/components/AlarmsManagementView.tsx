'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useOrgAlarms, type OrgAlarmRow } from '@/lib/useOrgAlarms'
import { getSession, useSessionOrgId } from '@/lib/auth'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import { AlertTriangle, XCircle, Info, CheckCircle, Clock, Filter, Download, FileText, CalendarDays } from 'lucide-react'
import type { Alarm } from '@/types'
import { fmtDateTime, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import toast from 'react-hot-toast'
import { recordAuditAction } from '@/lib/auditStore'
import clsx from 'clsx'

// Only id/label are ever read (the ack picker); department_id/domain came
// along in the API response but nothing here scopes by them — this page is
// admin/superadmin-only, so every department's catalog applies.
interface EventProblem { id: string; label: string }

// Quick ranges mirror the operator-facing picker: a label plus how many hours
// back it covers. 'all' disables the time filter entirely.
const QUICK_RANGES: { label: string; hours: number | null }[] = [
  { label: 'Last 1 hour', hours: 1 },
  { label: 'Last 6 hours', hours: 6 },
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', hours: 24 * 7 },
  { label: 'Last 30 days', hours: 24 * 30 },
  { label: 'All time', hours: null },
]

function AlarmRow({ alarm, onAck, problems }: { alarm: Alarm; onAck: (id: string, problemId?: string) => void; problems: EventProblem[] }) {
  const [problemId, setProblemId] = useState('')

  return (
    <tr
      key={alarm.id}
      className="transition-colors border-b"
      style={{
        borderColor: '#1e2433',
        // Only a still-breaching critical gets the red wash. A recovered one
        // kept it, which is the strongest "act now" signal on the row.
        background: alarm.severity === 'CRITICAL' && !alarm.acknowledged && !alarm.clearedAt ? 'rgba(239,68,68,0.03)' : 'transparent',
      }}
    >
      <td className="py-3 px-4">
        <span
          className="text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1.5"
          style={
            alarm.severity === 'CRITICAL'
              ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }
              : alarm.severity === 'WARNING'
              ? { background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }
              : { background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }
          }
        >
          {alarm.severity === 'CRITICAL' && <XCircle size={10} />}
          {alarm.severity === 'WARNING' && <AlertTriangle size={10} />}
          {alarm.severity === 'INFO' && <Info size={10} />}
          {alarm.severity}
        </span>
      </td>
      <td className="py-3 px-4 font-medium text-white text-xs">{alarm.transformerName}</td>
      <td className="py-3 px-4 text-xs text-slate-300 max-w-xs truncate">{alarm.message}</td>
      <td className="py-3 px-4 text-xs font-mono font-semibold text-white">
        {alarm.value != null ? `${alarm.value}${alarm.unit || ''}` : '—'}
      </td>
      <td className="py-3 px-4 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <Clock size={11} className="text-slate-600" />
          {fmtDateTime(alarm.timestamp)}
        </span>
      </td>
      <td className="py-3 px-4">
        {alarm.acknowledged ? (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle size={12} />
            Ack by {alarm.acknowledgedBy || 'Admin'}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {/* Recovered-but-unacknowledged is its own state (ISA-18.2 RTN
                unack): the condition is gone, but nobody has confirmed seeing
                it, so it still needs an acknowledgement — it just must not
                read as an ongoing emergency. */}
            {alarm.clearedAt && (
              <span
                className="text-[10px] px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}
                title={`Returned to normal at ${fmtDateTime(alarm.clearedAt)}`}
              >
                <CheckCircle size={9} />
                Recovered
              </span>
            )}
            {problems.length > 0 && (
              <select
                value={problemId}
                onChange={(e) => setProblemId(e.target.value)}
                className="text-xs rounded-lg px-2 py-1 text-slate-200 outline-none max-w-[160px]"
                style={{
                  background: '#0a0e1a',
                  border: `1px solid ${problemId ? '#1e2433' : 'rgba(251, 191, 36, 0.5)'}`,
                }}
              >
                <option value="">Select root cause…</option>
                {problems.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => onAck(alarm.id, problemId || undefined)}
              disabled={problems.length > 0 && !problemId}
              title={problems.length > 0 && !problemId ? 'Select a root cause first' : undefined}
              className="text-xs px-3 py-1.5 rounded-lg text-white font-medium transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
              style={{ background: '#6366f1' }}
            >
              Acknowledge
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

const toAlarm = (a: OrgAlarmRow, orgId: string): Alarm => ({
  id: a.id, transformerId: a.nodeId, transformerName: a.nodeName || a.nodeId, orgId,
  severity: a.severity, message: `${a.paramLabel}: ${a.value}${a.unit} (threshold ${a.threshold}${a.unit})`,
  sensor: a.paramLabel, value: a.value, unit: a.unit, threshold: a.threshold, timestamp: a.raisedAt,
  acknowledged: !!a.acknowledgedAt, acknowledgedBy: a.acknowledgedBy ?? undefined, acknowledgedAt: a.acknowledgedAt ?? undefined,
  // Was fetched by useOrgAlarms and then dropped here, so nothing downstream
  // could tell an active breach from one that recovered.
  clearedAt: a.clearedAt ?? undefined,
})

export default function AlarmsManagementView({ embedded = false }: { embedded?: boolean }) {
  const { alarms: mockAlarms, acknowledgeAlarm, selectedOrgId } = useAppStore()
  const sessionOrgId = useSessionOrgId('org-1')
  const effOrgId = selectedOrgId || sessionOrgId || 'org-1'
  // No 'INFO': alarm_events.severity is ENUM('WARNING','CRITICAL') in the
  // schema, nothing in the Go worker or Node-RED ever writes another value,
  // and the mock set has none either. The INFO button could therefore only
  // ever produce an empty table — a control whose sole effect was to make the
  // console look broken. The Alarm type still allows INFO, so the badge branch
  // in AlarmRow stays; only the unusable filter is gone.
  const [filter, setFilter] = useState<'all' | 'CRITICAL' | 'WARNING'>('all')
  const [showAcked, setShowAcked] = useState(false)
  const live = useIsLive()

  const [quick, setQuick] = useState<string>('Last 24 hours')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // A relative window ("Last 1 hour") has to keep moving, but its start is a
  // FETCH input now — recomputing it every render would give `load` a new
  // identity every render and spin the effect forever. Advancing it once a
  // minute keeps the window honest while costing at most one extra refetch a
  // minute, against a poll that already runs every 5s.
  const [nowMinute, setNowMinute] = useState(() => Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const t = setInterval(() => setNowMinute(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(t)
  }, [])

  const range = useMemo(() => {
    if (from || to) {
      const s = from ? fromDisplayInput(from) : NaN
      const e = to ? fromDisplayInput(to) : NaN
      return {
        start: Number.isFinite(s) ? s : 0,
        end: Number.isFinite(e) ? e : Infinity,
        label: `${from || '…'} → ${to || 'now'}`,
      }
    }
    const hrs = QUICK_RANGES.find((q) => q.label === quick)?.hours ?? null
    return hrs === null
      ? { start: 0, end: Infinity, label: 'All time' }
      : { start: nowMinute * 60_000 - hrs * 3600_000, end: Infinity, label: quick }
  }, [quick, from, to, nowMinute])

  // The range is pushed into the query, not applied to an already-truncated
  // page: the endpoint returns the newest `limit` rows, so filtering a fixed
  // newest-N window client-side could never reach the older events a wider
  // range actually covers.
  //
  // The severity and Show-Acknowledged controls go into the query for the same
  // reason: filtering them client-side over a capped page means a CRITICAL
  // further back inside the chosen range is silently dropped, because the cap
  // was already spent on newer rows of other severities.
  const { alarms: liveOrgAlarms, refetch: refetchAlarms } = useOrgAlarms(effOrgId, {
    pollMs: live ? 5000 : undefined,
    fromMs: range.start > 0 ? range.start : undefined,
    toMs: Number.isFinite(range.end) ? range.end : undefined,
    severity: filter === 'all' ? undefined : filter,
    unacked: !showAcked,
    limit: 1000,
  })
  const alarms = live ? liveOrgAlarms.map((a) => toAlarm(a, effOrgId)) : mockAlarms

  // Feeds the header's Critical/Warning badges only — same range, but never
  // narrowed by severity or the ack toggle. `unacked: true` keeps it to the
  // rows the badges actually count, so it stays a cheap query rather than the
  // full history.
  const { alarms: badgeAlarms } = useOrgAlarms(effOrgId, {
    pollMs: live ? 5000 : undefined,
    fromMs: range.start > 0 ? range.start : undefined,
    toMs: Number.isFinite(range.end) ? range.end : undefined,
    unacked: true,
    limit: 1000,
  })

  const [problems, setProblems] = useState<EventProblem[]>([])
  useEffect(() => {
    if (!live) { setProblems([]); return }
    const orgId = getSession()?.orgId ?? effOrgId
    if (!orgId) return
    api.eventProblems(orgId).then((rows) => { if (rows) setProblems(rows) })
  }, [live, effOrgId])

  const orgAlarms = alarms.filter((a) => !a.orgId || a.orgId === effOrgId)
  const filtered = orgAlarms.filter((a) => {
    if (!showAcked && a.acknowledged) return false
    if (filter !== 'all' && a.severity !== filter) return false
    // One rule for every row. This used to read:
    //
    //   if (Number.isFinite(ts) && range.start > 0) {
    //     if (a.acknowledged && (ts < start || ts > end)) return false
    //     if (!a.acknowledged && (from || to) && (...)) return false
    //   }
    //
    // which made the picker a no-op in the default view. `showAcked` starts
    // false, so the table shows UNacknowledged alarms — and for those the
    // range was only honoured when `from`/`to` were set. Every quick range
    // left both empty, so choosing "Last 1 hour" filtered nothing at all and
    // week-old alarms stayed on screen. The `range.start > 0` guard also
    // dropped the whole check when only "To" was set (start falls back to 0),
    // so an upper bound on its own was ignored too.
    const ts = new Date(a.timestamp).getTime()
    if (Number.isFinite(ts) && (ts < range.start || ts > range.end)) return false
    return true
  })

  const onAck = async (id: string, problemId?: string) => {
    // Guarded here as well as on the button: a disabled attribute is a UI
    // affordance, not a rule — this is the one path that actually writes.
    if (problems.length > 0 && !problemId) {
      toast.error('Please select a root cause first')
      return
    }
    try {
      if (live) {
        const r = await api.ackEvent(id, { by: getSession()?.name ?? 'admin', eventProblemId: problemId })
        if (r === null) {
          toast.error('Failed to acknowledge alarm')
          return
        }
        toast.success('Alarm acknowledged')
        recordAuditAction({
          action: 'ALARM_SHELVE',
          target: { assetId: id, assetName: `Alarm #${id}` },
          before: 'Alarm State: Active Unacknowledged',
          after: 'Alarm State: Acknowledged & Shelved',
          justification: problems.find((p) => p.id === problemId)?.label || 'Operator manual acknowledgement in Alarm Console',
        }).catch(() => {})
        refetchAlarms()
        return
      }
      acknowledgeAlarm(id, 'admin')
      toast.success('Alarm acknowledged')
      recordAuditAction({
        action: 'ALARM_SHELVE',
        target: { assetId: id, assetName: `Alarm #${id}` },
        before: 'Alarm State: Active Unacknowledged',
        after: 'Alarm State: Acknowledged & Shelved',
        justification: problems.find((p) => p.id === problemId)?.label || 'Operator manual acknowledgement in Alarm Console',
      }).catch(() => {})
    } catch {
      toast.error('Failed to acknowledge alarm')
    }
  }

  const EXPORT_HEADERS = ['Severity', 'Transformer', 'Message', 'Sensor', 'Value', 'Unit', 'Timestamp', 'Status', 'Acknowledged By']
  const exportRows = () => filtered.map((a) => [
    a.severity, a.transformerName, a.message, a.sensor, a.value, a.unit,
    fmtDateTime(a.timestamp),
    a.acknowledged ? 'Acknowledged' : a.clearedAt ? 'Recovered (unacknowledged)' : 'Open',
    a.acknowledgedBy ?? '',
  ])

  // Counted from a set that follows the TIME RANGE but not the severity or
  // Show-Acknowledged controls. Those two narrow the table on purpose; the
  // header badges answer "what is outstanding", and computing them from the
  // narrowed set would make selecting CRITICAL hide the Warning badge
  // altogether — indistinguishable on screen from "there are no warnings".
  const badgeSource = live ? badgeAlarms.map((a) => toAlarm(a, effOrgId)) : mockAlarms
  const inRange = badgeSource.filter((a) => {
    if (a.orgId && a.orgId !== effOrgId) return false
    const ts = new Date(a.timestamp).getTime()
    return !(Number.isFinite(ts) && (ts < range.start || ts > range.end))
  })
  // Still breaching AND unacknowledged. A recovered alarm is no longer open,
  // so counting it inflated the headline with conditions that had passed.
  const critCount = inRange.filter((a) => a.severity === 'CRITICAL' && !a.acknowledged && !a.clearedAt).length
  const warnCount = inRange.filter((a) => a.severity === 'WARNING' && !a.acknowledged && !a.clearedAt).length

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-5"}>
      {!embedded && (
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
      )}
      {embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">All-device Alarms</h2>
            <p className="text-xs text-slate-500 mt-0.5">Monitor and acknowledge system alarms across all devices</p>
          </div>
          <div className="flex items-center gap-3">
            {critCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <XCircle size={14} className="text-red-400" />
                <span className="text-red-400 text-xs font-semibold">{critCount} Critical</span>
              </div>
            )}
            {warnCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-amber-400 text-xs font-semibold">{warnCount} Warning</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Time range + quick pills + export */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Quick Range Pills for 1-click selection */}
        <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-800 bg-[#0a0e1a]">
          {QUICK_RANGES.map((q) => {
            const active = !from && !to && quick === q.label
            const shortLabel = q.hours === 1 ? '1h' : q.hours === 6 ? '6h' : q.hours === 24 ? '24h' : q.hours === 168 ? '7d' : q.hours === 720 ? '30d' : 'All'
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setQuick(q.label)
                  setFrom('')
                  setTo('')
                  setPickerOpen(false)
                }}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs font-semibold transition-all',
                  active
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                )}
                title={q.label}
              >
                {shortLabel}
              </button>
            )
          })}
        </div>

        {/* Custom Date Range Popover */}
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              (from || to)
                ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/50 shadow-sm'
                : 'text-slate-300 bg-[#0d1117] border border-slate-800 hover:text-white'
            )}
          >
            <CalendarDays size={13} className={(from || to) ? 'text-indigo-400' : 'text-slate-400'} />
            <span>{(from || to) ? range.label : 'Custom Dates'}</span>
            <span className="text-slate-500 text-[10px]">▾</span>
          </button>
          {pickerOpen && (
            <div className="absolute left-0 mt-2 z-30 rounded-xl p-3.5 w-[420px]" style={{ background: '#0d1117', border: '1px solid #1e2433', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">Absolute Range</div>
                  <label className="block text-[10px] text-slate-400 mb-1">From Date/Time</label>
                  <input
                    type="datetime-local"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full text-xs rounded-lg px-2.5 py-1.5 text-slate-100 mb-2.5 outline-none focus:ring-1 focus:ring-indigo-500"
                    style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                  />
                  <label className="block text-[10px] text-slate-400 mb-1">To Date/Time</label>
                  <input
                    type="datetime-local"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full text-xs rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:ring-1 focus:ring-indigo-500"
                    style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                  />
                  <p className="mt-1.5 text-[10px] text-slate-500 font-mono">timezone: {DISPLAY_TZ_LABEL}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setPickerOpen(false)}
                      className="flex-1 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors shadow"
                    >
                      Apply Range
                    </button>
                    {(from || to) && (
                      <button
                        onClick={() => { setFrom(''); setTo(''); setQuick('Last 24 hours'); setPickerOpen(false) }}
                        className="text-xs text-slate-400 hover:text-white px-2 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">Quick Presets</div>
                  <div className="space-y-1">
                    {QUICK_RANGES.map((q) => (
                      <button
                        key={q.label}
                        onClick={() => { setQuick(q.label); setFrom(''); setTo(''); setPickerOpen(false) }}
                        className={clsx(
                          'w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-between',
                          !from && !to && quick === q.label
                            ? 'bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/40'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        )}
                      >
                        <span>{q.label}</span>
                        {!from && !to && quick === q.label && <span className="text-[10px] text-indigo-400">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); setQuick('Last 24 hours') }}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-900 border border-slate-800"
            title="Clear custom range"
          >
            <span>✕ Reset Range</span>
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => downloadCSV(`alarms-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, exportRows())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <Download size={12} /> Export CSV
          </button>
          <button onClick={() => printTablePDF('Alarm Management', EXPORT_HEADERS, exportRows(), [range.label, filter === 'all' ? 'All severities' : filter, showAcked ? 'Including acknowledged' : 'Open only'])}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <FileText size={12} /> Export PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {(['all', 'CRITICAL', 'WARNING'] as const).map((f) => (
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
                  No alarms in {range.label}
                  {/* Naming the window matters: an empty table under a narrow
                      range means "nothing happened recently", not "this org is
                      clear". Widening is the next thing the operator wants. */}
                  <div className="text-[11px] text-slate-700 mt-1">
                    matching current filters — try a wider range
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((alarm) => (
                <AlarmRow
                  key={alarm.id}
                  alarm={alarm}
                  problems={problems}
                  onAck={onAck}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

