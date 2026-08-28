'use client'

import { useMemo, useEffect, useState, useCallback } from 'react'
import { evaluate, type AlarmEvent } from '@/server/alarmEngine'
import { useAlarmDB } from '@/server/alarmStore'
import { api, useIsLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { getAlarmInsight, defaultNodeRule } from '@/lib/alarmParams'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import { getSession } from '@/lib/auth'
import type { SensorDomain } from '@/types/fleet'
import { Check, Bell, Download, FileText, Clock, AlertTriangle, Info, ShieldAlert, PauseCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface EventProblem { id: string; label: string; department_id: string | null; domain: string | null }

// Timestamps arrive as UTC ISO strings. Slicing the string showed UTC verbatim
// (an event at 17:15 ICT read "10:15"), so parse and render in the viewer's own
// timezone instead.
const fmtTime = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  const d = new Date(typeof v === 'number' ? v : String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const mockTransportEvents = [
  { id: '1', time: fmtTime(Date.now() - 25 * 60000), type: 'FALLBACK_4G', desc: 'WiFi lost. Switched to Cellular (4G)', isOfflineSync: false },
  { id: '2', time: fmtTime(Date.now() - 40 * 60000), type: 'OFFLINE_SYNC', desc: 'Flushed 42 offline records to cloud', isOfflineSync: true },
  { id: '3', time: fmtTime(Date.now() - 180 * 60000), type: 'LINK_RESTORE', desc: 'WiFi restored. Active link: WiFi', isOfflineSync: false },
]

// Engine-driven event log for a node — reusable on the admin/superadmin twin.
export default function NodeEventLog({ nodeId, domain, baseValue, by = 'admin' }: { nodeId: string; domain?: SensorDomain; baseValue: number; by?: string }) {
  const dbRules = useAlarmDB((s) => s.rules)
  const dbAcks = useAlarmDB((s) => s.acks)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)
  const ackEvent = useAlarmDB((s) => s.ackEvent)
  const live = useIsLive()
  const [liveEvents, setLiveEvents] = useState<AlarmEvent[] | null>(null)
  const [problems, setProblems] = useState<EventProblem[]>([])
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [transport, setTransport] = useState<{ id: string; ts: string; type: string; desc: string; isOfflineSync: boolean }[] | null>(null)
  const [expandedSopId, setExpandedSopId] = useState<string | null>(null)
  const [shelvedMap, setShelvedMap] = useState<Record<string, { until: number; reason: string }>>({})
  const [shelvingId, setShelvingId] = useState<string | null>(null)
  const [shelveHours, setShelveHours] = useState<number>(8)
  const [shelveReason, setShelveReason] = useState<string>('')
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    if (typeof navigator !== 'undefined') setIsOffline(!navigator.onLine)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(30) } catch {}
    }
  }

  const loadLive = useCallback(() => {
    if (!live || !nodeId) { setLiveEvents(null); setTransport(null); return }
    api.events(nodeId).then((rows) => {
      if (!rows) return
      setLiveEvents((rows as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        nodeId: String(r.node_id ?? nodeId),
        paramKey: String(r.param_key ?? ''),
        paramLabel: String(r.param_label ?? r.param_key ?? ''),
        severity: (r.severity as AlarmEvent['severity']) ?? 'WARNING',
        kind: (r.kind as AlarmEvent['kind']) ?? 'threshold',
        value: Number(r.value ?? 0),
        threshold: Number(r.threshold ?? 0),
        unit: String(r.unit ?? ''),
        time: fmtTime(r.raised_at),
        ts: new Date(String(r.raised_at ?? Date.now())).getTime(),
        source: (r.source as AlarmEvent['source']) ?? undefined,
        acknowledgedBy: r.acknowledged_at ? String(r.acknowledged_by ?? 'user') : undefined,
      } as AlarmEvent & { acknowledgedBy?: string })))
    })
    api.transportEvents(nodeId).then((rows) => { if (rows) setTransport(rows) })
  }, [live, nodeId])

  useEffect(() => {
    if (!live) { setProblems([]); return }
    const session = getSession()
    const orgId = session?.orgId
    if (!orgId) return
    const isAdmin = session?.role === 'admin' || session?.role === 'superadmin';
    (async () => {
      const myDepts = isAdmin ? null : ((await api.myAccess())?.departmentIds ?? [])
      const rows = await api.eventProblems(orgId, undefined, domain)
      if (!rows) return
      setProblems(isAdmin || !myDepts
        ? rows
        : rows.filter((r) => r.department_id === null || myDepts.includes(r.department_id)))
    })()
  }, [live, domain])

  useEffect(() => {
    loadLive()
    if (!live) return
    const t = setInterval(loadLive, 20000)
    const off = subscribeTelemetry((f) => {
      if (f.type === 'alarm' && f.id === nodeId) loadLive()
    })
    return () => { clearInterval(t); off() }
  }, [loadLive, live, nodeId])

  const onAck = useCallback(async (eventId: string) => {
    if (problems.length > 0 && !picked[eventId]) return
    if (live) { await api.ackEvent(eventId, { by, eventProblemId: picked[eventId] || undefined }); loadLive() }
    else ackEvent(eventId, by)
  }, [live, by, ackEvent, loadLive, picked, problems])

  const onShelve = (eventId: string) => {
    if (!shelveReason.trim()) return
    const until = Date.now() + shelveHours * 3600 * 1000
    setShelvedMap((prev) => ({ ...prev, [eventId]: { until, reason: shelveReason.trim() } }))
    setShelvingId(null)
    setShelveReason('')
  }

  const rule = useMemo(() => (domain ? ((hasHydrated && dbRules[nodeId]) ? dbRules[nodeId] : defaultNodeRule(domain)) : null), [domain, nodeId, hasHydrated, dbRules])

  const events: AlarmEvent[] = useMemo(() => {
    if (!rule) return []
    const readings = Array.from({ length: 96 }).map((_, i) => {
      const values: Record<string, number> = {}
      rule.params.forEach((p, pi) => {
        const span = Math.max(2, Math.abs(p.critical - p.warn))
        const wave = Math.sin((i + pi * 4) * 0.45) * span * 0.95
        const noise = (((i * 7 + pi * 13) % 5) - 2) * span * 0.06
        values[p.key] = +(p.direction === 'high' ? p.warn - span * 0.25 + wave + noise : p.warn + span * 0.25 - wave - noise).toFixed(2)
      })
      return { time: fmtTime(Date.now() - (96 - i) * 15 * 60000), ts: Date.now() - (96 - i) * 15 * 60000, values }
    })
    return evaluate(nodeId, rule, readings).slice(0, 12)
  }, [rule, nodeId, baseValue])

  const shownEvents = liveEvents ?? events
  const shownTransport = transport ?? (live ? [] : mockTransportEvents)

  const EVENT_HEADERS = ['Time', 'Parameter', 'Priority', 'Value', 'Unit', 'Threshold', 'Severity', 'Status']
  const eventRows = () => shownEvents.map((ev) => {
    const insight = getAlarmInsight(ev.paramKey, domain)
    return [
      ev.time, ev.paramLabel + (ev.kind === 'rate' ? ' (rate)' : ''), insight?.priority || 'MEDIUM', ev.value, ev.unit, ev.threshold, ev.severity,
      (dbAcks[ev.id] || (ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy) ? 'Acknowledged' : 'Open',
    ]
  })
  const TRANSPORT_HEADERS = ['Time', 'Event Type', 'Description']
  const transportRows = () => shownTransport.map((te) => [
    'time' in te ? (te as { time: string }).time : fmtTime((te as { ts: string }).ts),
    te.type, te.desc,
  ])

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bell size={14} className="text-indigo-400" />
            Alarm &amp; Event Management Log
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Real-time excursion logs with Action Priority, Stale Alarm tracking &amp; SOP Guidance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadCSV(`events-${nodeId}.csv`, EVENT_HEADERS, eventRows())}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white" style={{ border: '1px solid #1e2433' }}>
            <Download size={11} /> CSV
          </button>
          <button onClick={() => printTablePDF(`Event Log — ${nodeId}`, EVENT_HEADERS, eventRows(), [`Device ${nodeId}`])}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white" style={{ border: '1px solid #1e2433' }}>
            <FileText size={11} /> PDF
          </button>
        </div>
      </div>

      {/* Shelving Modal */}
      {shelvingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl p-5 space-y-4" style={{ background: '#0d1117', border: '1px solid #3b82f6' }}>
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <PauseCircle size={16} className="text-blue-400" />
              <span>Temporary Alarm Shelving</span>
            </div>
            <p className="text-xs text-slate-300">
              Temporarily suppress audible/dispatch notifications for this nuisance alarm during maintenance.
            </p>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Shelve Duration</label>
                <select
                  value={shelveHours}
                  onChange={(e) => setShelveHours(Number(e.target.value))}
                  className="w-full rounded px-2.5 py-1.5 bg-[#0a0e1a] text-slate-200 border border-slate-700"
                >
                  <option value={2}>2 Hours (Short Maintenance / Sampling)</option>
                  <option value={8}>8 Hours (Shift Maintenance Window)</option>
                  <option value={24}>24 Hours (Full Day Overhaul)</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Audit Reason (Mandatory)</label>
                <input
                  type="text"
                  placeholder="e.g. Radiator fan replacement, DGA manual sampling"
                  value={shelveReason}
                  onChange={(e) => setShelveReason(e.target.value)}
                  className="w-full rounded px-2.5 py-1.5 bg-[#0a0e1a] text-slate-200 border border-slate-700 placeholder:text-slate-600"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShelvingId(null); setShelveReason('') }}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => onShelve(shelvingId)}
                disabled={!shelveReason.trim()}
                className="px-3 py-1.5 rounded text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
              >
                Confirm Shelve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Status Banner */}
      {isOffline && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-200 text-xs flex items-center justify-between animate-pulse">
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            Offline Mode — Showing cached events (Reconnecting...)
          </span>
          <span className="text-[10px] text-amber-300/80">Local Buffer Active</span>
        </div>
      )}

      {/* Cap the height: histories grow without bound */}
      <div className="rounded-lg overflow-auto max-h-[420px]" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: '#0a0e1a' }}>
              {['Time', 'Parameter & SOP', 'Priority', 'Value / Limit', 'Severity', 'Status', ''].map((h) => (
                <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownEvents.length ? shownEvents.map((ev) => {
              const acked = !!dbAcks[ev.id] || !!(ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy
              const isShelved = !!shelvedMap[ev.id] && shelvedMap[ev.id].until > Date.now()
              const isStale = !acked && !isShelved && (Date.now() - ev.ts > 24 * 3600 * 1000)
              const sc = ev.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24'
              const insight = getAlarmInsight(ev.paramKey, domain)
              const priority = insight?.priority || (ev.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM')
              const priorityColor = priority === 'EMERGENCY' ? '#c084fc' : priority === 'HIGH' ? '#f87171' : priority === 'MEDIUM' ? '#fbbf24' : '#94a3b8'
              const isExpanded = expandedSopId === ev.id

              return (
                <tr key={ev.id} className="border-t border-[#1e2433] hover:bg-white/[0.02] transition-colors">
                  {/* Time + Stale badge */}
                  <td className="py-2.5 px-3 text-slate-400 text-xs align-top whitespace-nowrap">
                    <div>{ev.time}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {ev.source === 'edge' && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-medium">EDGE</span>
                      )}
                      {isStale && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30 flex items-center gap-0.5">
                          <Clock size={8} /> STALE (&gt;24h)
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Parameter & SOP Drawer button */}
                  <td className="py-2.5 px-3 text-xs align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-200">{ev.paramLabel}</span>
                      {ev.kind === 'rate' && <span className="text-indigo-400 text-[10px]">· rate</span>}
                    </div>
                    {insight && (
                      <button
                        onClick={() => setExpandedSopId(isExpanded ? null : ev.id)}
                        className="mt-1 flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <Info size={10} />
                        <span>{isExpanded ? 'Hide SOP Guidance' : 'View SOP'}</span>
                        {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                    {/* Expandable SOP Card */}
                    {isExpanded && insight && (
                      <div className="mt-2 p-2.5 rounded-lg text-[11px] space-y-1.5 border border-indigo-500/30 bg-indigo-950/20 max-w-sm">
                        <div className="text-slate-400">
                          <strong className="text-white">Category:</strong> {insight.category}
                        </div>
                        <div className="text-slate-400">
                          <strong className="text-rose-300">Consequence:</strong> {insight.risk}
                        </div>
                        <div className="text-slate-300 pt-1 border-t border-indigo-800/40">
                          <strong className="text-emerald-400">SOP Action:</strong> {insight.action}
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Priority */}
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                      style={{ color: priorityColor, background: `${priorityColor}1a`, border: `1px solid ${priorityColor}33` }}
                    >
                      {priority}
                    </span>
                  </td>

                  {/* Value vs Limit */}
                  <td className="py-2.5 px-3 align-top whitespace-nowrap text-xs">
                    <span style={{ color: sc }} className="font-bold">{ev.value} {ev.unit}</span>
                    <span className="text-slate-500 text-[10px]"> /{ev.threshold}</span>
                  </td>

                  {/* Severity */}
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: sc, background: `${sc}1f` }}>
                      {ev.severity}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3 align-top whitespace-nowrap text-xs">
                    {acked ? (
                      <span className="flex items-center gap-1 text-[11px] text-green-400 font-medium">
                        <Check size={12} /> {dbAcks[ev.id]?.by ?? (ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy}
                      </span>
                    ) : isShelved ? (
                      <span className="flex items-center gap-1 text-[11px] text-blue-400 font-medium" title={`Reason: ${shelvedMap[ev.id].reason}`}>
                        <PauseCircle size={12} /> Shelved ({Math.ceil((shelvedMap[ev.id].until - Date.now()) / 3600000)}h left)
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-400 font-semibold">Active</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3 text-right align-top">
                    {acked ? (
                      <span className="text-[11px] text-slate-600">—</span>
                    ) : (
                      <div className="flex flex-col items-end gap-1.5 min-w-[140px]">
                        {problems.length > 0 ? (
                          <select
                            value={picked[ev.id] ?? ''}
                            onChange={(e) => setPicked((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                            className="text-[11px] rounded px-2 py-1 text-slate-200 w-full"
                            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                          >
                            <option value="">Select Root Cause</option>
                            {problems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                          </select>
                        ) : (
                          <div className="flex flex-wrap gap-1 justify-end max-w-[210px] mb-0.5">
                            {[
                              { label: '🌀 Fan Check', text: 'Cooling fan inspection' },
                              { label: '🔧 Tech Entry', text: 'Technician dispatched' },
                              { label: '⚡️ Load Shed', text: 'Temporary load shed' },
                              { label: '🔍 Transient', text: 'Transient surge' },
                            ].map((chip) => (
                              <button
                                key={chip.label}
                                type="button"
                                onClick={() => {
                                  triggerHaptic()
                                  onAck(ev.id)
                                }}
                                title={`Quick ACK: ${chip.text}`}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/80 transition-colors"
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 w-full">
                          <button
                            onClick={() => {
                              triggerHaptic()
                              onAck(ev.id)
                            }}
                            disabled={problems.length > 0 && !picked[ev.id]}
                            title={problems.length > 0 && !picked[ev.id] ? 'Select a root cause first' : undefined}
                            className="flex-1 text-[11px] font-medium text-white px-2.5 py-1.5 rounded-md min-h-[34px] sm:min-h-[28px] touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
                            style={gradient}
                          >
                            Ack
                          </button>
                          {!isShelved && (
                            <button
                              onClick={() => {
                                triggerHaptic()
                                setShelvingId(ev.id)
                              }}
                              title="Shelve alarm temporarily for maintenance"
                              className="px-2 py-1.5 rounded text-[11px] text-slate-400 hover:text-blue-400 bg-slate-800/60 border border-slate-700 flex items-center gap-1 min-h-[34px] sm:min-h-[28px] touch-manipulation"
                            >
                              <PauseCircle size={11} /> Shelve
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            }) : (
              <tr><td colSpan={7} className="py-6 text-center text-slate-600 text-xs">No events — readings within all alarm rules.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Bell size={14} className="text-indigo-400" /> Transport & Connectivity</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 mr-1">Link changes, offline/online transitions and backlogs</span>
            <button onClick={() => downloadCSV(`connectivity-${nodeId}.csv`, TRANSPORT_HEADERS, transportRows())}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white" style={{ border: '1px solid #1e2433' }}>
              <Download size={11} /> CSV
            </button>
            <button onClick={() => printTablePDF(`Transport & Connectivity — ${nodeId}`, TRANSPORT_HEADERS, transportRows(), [`Device ${nodeId}`])}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white" style={{ border: '1px solid #1e2433' }}>
              <FileText size={11} /> PDF
            </button>
          </div>
        </div>
        <div className="rounded-lg overflow-auto max-h-[320px]" style={{ border: '1px solid #1e2433' }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr style={{ background: '#0a0e1a' }}>
                <th className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium w-1/4">Time</th>
                <th className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">Event Type</th>
                <th className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {shownTransport.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-slate-600 text-xs">No connectivity events recorded for this device.</td></tr>
              )}
              {shownTransport.map((te) => (
                <tr key={te.id} style={{ borderTop: '1px solid #1e2433' }}>
                  <td className="py-2.5 px-3 text-slate-400 text-xs">{'time' in te ? (te as { time: string }).time : fmtTime((te as { ts: string }).ts)}</td>
                  <td className="py-2.5 px-3 text-xs font-bold text-slate-300">
                    {te.type}
                    {te.isOfflineSync && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/20 text-emerald-400 font-medium animate-pulse">OFFLINE SYNCING</span>}
                    {te.type === 'LINK_RESTORE' && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/20 text-emerald-400 font-medium animate-pulse">DEVICE SYNCING</span>}
                    {te.type === 'DEVICE_OFFLINE' && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-400 font-medium">OFFLINE</span>}
                    {te.type === 'LINK_LOST' && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-400 font-medium">LINK DOWN</span>}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-xs">{te.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
