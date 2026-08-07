'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useOrgAlarms, type OrgAlarmRow } from '@/lib/useOrgAlarms'
import { getSession } from '@/lib/auth'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import { AlertTriangle, XCircle, Info, CheckCircle, Clock, Filter, Download, FileText, CalendarDays } from 'lucide-react'
import type { Alarm } from '@/types'
import { fmtDateTime, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'

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
  const cfg = {
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', icon: <XCircle size={14} className="text-red-400" /> },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.15)', icon: <AlertTriangle size={14} className="text-amber-400" /> },
    INFO: { color: '#60a5fa', bg: 'rgba(96,165,250,0.06)', border: 'rgba(96,165,250,0.15)', icon: <Info size={14} className="text-blue-400" /> },
  }
  const c = cfg[alarm.severity]

  return (
    <tr
      className="transition-colors"
      style={{
        background: alarm.acknowledged ? 'transparent' : c.bg,
        borderBottom: '1px solid #1e2433',
        opacity: alarm.acknowledged ? 0.6 : 1,
      }}
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {c.icon}
          <span className="text-xs font-bold" style={{ color: c.color }}>{alarm.severity}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className="text-xs font-semibold text-indigo-400">{alarm.transformerName}</span>
      </td>
      <td className="py-3 px-4 max-w-xs">
        <div className="text-sm text-slate-300 truncate">{alarm.message}</div>
        <div className="text-xs text-slate-600">{alarm.sensor}</div>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm font-bold text-white">{alarm.value}</span>
        <span className="text-xs text-slate-500 ml-1">{alarm.unit}</span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock size={10} />
          {fmtDateTime(alarm.timestamp)}
          {alarm.source === 'edge' && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-indigo-500/20 text-indigo-300 font-medium">EDGE</span>}
        </div>
      </td>
      <td className="py-3 px-4">
        {alarm.acknowledged ? (
          <div>
            <div className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle size={11} /> Acknowledged
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">by {alarm.acknowledgedBy}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 min-w-[150px]">
            {problems.length > 0 && (
              <select
                value={problemId}
                onChange={(e) => setProblemId(e.target.value)}
                className="text-xs rounded-lg px-2 py-1.5 text-slate-200"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
              >
                <option value="">Select Problem</option>
                {problems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
            <button
              onClick={() => onAck(alarm.id, problemId || undefined)}
              className="text-xs px-3 py-1.5 rounded-lg text-white font-medium transition-all hover:opacity-90"
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

// OrgAlarmRow (real, alarm_events) -> Alarm (this page's shape, historically
// mockData.ts's). alarm_events has no INFO severity — it is threshold/rate/
// offline detection only — so a real alarm never matches that filter button;
// that is honest, not a gap: mockData.ts invented severities the schema
// never had.
const toAlarm = (a: OrgAlarmRow, orgId: string): Alarm => ({
  id: a.id, transformerId: a.nodeId, transformerName: a.nodeName, orgId,
  severity: a.severity, message: `${a.paramLabel}: ${a.value}${a.unit} (threshold ${a.threshold}${a.unit})`,
  sensor: a.paramLabel, value: a.value, unit: a.unit, threshold: a.threshold, timestamp: a.raisedAt,
  acknowledged: !!a.acknowledgedAt, acknowledgedBy: a.acknowledgedBy ?? undefined, acknowledgedAt: a.acknowledgedAt ?? undefined,
})

export default function AlarmsPage() {
  // useAppStore().alarms is seeded ONCE from mockData.ts at store creation and
  // nothing ever refreshes it from a real endpoint — this page's list, its
  // Critical/Warning counters and every filter below used to run entirely on
  // that mock data regardless of Live/Demo mode, while Acknowledge (below)
  // already wrote through to the real backend. A real CRITICAL alarm on a
  // real device never appeared here at all.
  const { alarms: mockAlarms, acknowledgeAlarm, selectedOrgId } = useAppStore()
  const [filter, setFilter] = useState<'all' | 'CRITICAL' | 'WARNING' | 'INFO'>('all')
  const [showAcked, setShowAcked] = useState(false)
  const live = useIsLive()
  const { alarms: liveOrgAlarms, refetch: refetchAlarms } = useOrgAlarms(selectedOrgId, { pollMs: live ? 20000 : undefined })
  const alarms = live ? liveOrgAlarms.map((a) => toAlarm(a, selectedOrgId)) : mockAlarms

  // Time range: a quick preset, or explicit from/to when the operator sets them.
  const [quick, setQuick] = useState<string>('Last 24 hours')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const range = useMemo(() => {
    if (from || to) {
      // fromDisplayInput, not new Date(): a datetime-local value is the
      // BROWSER's wall clock, but every timestamp on this page is rendered in
      // DISPLAY_TZ by fmtDateTime. Reading it as browser time meant an operator
      // outside that zone picked 08:00 and got back rows this same page labels
      // 15:00 — the filter and the column disagreeing about what one number
      // means. Same conversion ParamHistoryModal's custom range already uses.
      return { start: from ? fromDisplayInput(from) : 0, end: to ? fromDisplayInput(to) : Infinity, label: `${from || '…'} → ${to || 'now'}` }
    }
    const hrs = QUICK_RANGES.find((q) => q.label === quick)?.hours ?? null
    return hrs === null
      ? { start: 0, end: Infinity, label: 'All time' }
      : { start: Date.now() - hrs * 3600_000, end: Infinity, label: quick }
  }, [quick, from, to])

  // Root causes offered on acknowledge. This page is admin/superadmin-only
  // (see admin/layout.tsx's route guard), so every department's problems
  // apply — no department scoping needed, unlike the equivalent viewer-facing
  // pickers (NodeEventLog, customer's Alarms).
  const [problems, setProblems] = useState<EventProblem[]>([])
  useEffect(() => {
    if (!live) { setProblems([]); return }
    const orgId = getSession()?.orgId ?? selectedOrgId
    if (!orgId) return
    api.eventProblems(orgId).then((rows) => { if (rows) setProblems(rows) })
  }, [live, selectedOrgId])

  const orgAlarms = alarms.filter((a) => a.orgId === selectedOrgId)
  const filtered = orgAlarms.filter((a) => {
    if (!showAcked && a.acknowledged) return false
    if (filter !== 'all' && a.severity !== filter) return false
    const ts = new Date(a.timestamp).getTime()
    if (Number.isFinite(ts) && (ts < range.start || ts > range.end)) return false
    return true
  })

  // Acknowledge writes through to the backend in Live mode (with the chosen
  // root cause) and refetches the real list; falls back to the local mock
  // store in Demo.
  const onAck = async (id: string, problemId?: string) => {
    if (live) { await api.ackEvent(id, { by: getSession()?.name ?? 'admin', eventProblemId: problemId }); refetchAlarms(); return }
    acknowledgeAlarm(id, 'admin')
  }

  const EXPORT_HEADERS = ['Severity', 'Transformer', 'Message', 'Sensor', 'Value', 'Unit', 'Timestamp', 'Status', 'Acknowledged By']
  const exportRows = () => filtered.map((a) => [
    a.severity, a.transformerName, a.message, a.sensor, a.value, a.unit,
    fmtDateTime(a.timestamp), a.acknowledged ? 'Acknowledged' : 'Open', a.acknowledgedBy ?? '',
  ])

  const critCount = orgAlarms.filter((a) => a.severity === 'CRITICAL' && !a.acknowledged).length
  const warnCount = orgAlarms.filter((a) => a.severity === 'WARNING' && !a.acknowledged).length

  return (
    <div className="p-6 space-y-5">
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

      {/* Time range + export */}
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
                  {/* datetime-local, not datetime: `datetime` was dropped from
                      the HTML spec and no browser implements it, so it rendered
                      as a bare text box the operator had to type a timestamp
                      into by hand. datetime-local is the only type in this
                      family with a real calendar/clock picker. Its value is
                      read as DISPLAY_TZ wall time — see `range` above. */}
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
                      <button key={q.label}
                        onClick={() => { setQuick(q.label); setFrom(''); setTo(''); setPickerOpen(false) }}
                        className="w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors"
                        style={!from && !to && quick === q.label
                          ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }
                          : { color: '#94a3b8' }}
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
          {(['all', 'CRITICAL', 'WARNING', 'INFO'] as const).map((f) => (
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
                  No alarms matching current filters
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
