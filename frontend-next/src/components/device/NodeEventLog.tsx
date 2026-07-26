'use client'

import { useMemo, useEffect, useState, useCallback } from 'react'
import { evaluate, type AlarmEvent } from '@/server/alarmEngine'
import { useAlarmDB } from '@/server/alarmStore'
import { api, useIsLive } from '@/lib/api'
import { defaultNodeRule } from '@/lib/alarmParams'
import { downloadCSV, printTablePDF } from '@/lib/exportFile'
import { getSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { getViewerUser } from '@/lib/viewer'
import type { SensorDomain } from '@/types/fleet'
import { Check, Bell, Download, FileText } from 'lucide-react'

interface EventProblem { id: string; label: string; department_id: string | null; domain: string | null }

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const mockTransportEvents = [
  { id: '1', time: new Date(Date.now() - 25 * 60000).toISOString().slice(5, 16).replace('T', ' '), type: 'FALLBACK_4G', desc: 'WiFi lost. Switched to Cellular (4G)', isOfflineSync: false },
  { id: '2', time: new Date(Date.now() - 40 * 60000).toISOString().slice(5, 16).replace('T', ' '), type: 'OFFLINE_SYNC', desc: 'Flushed 42 offline records to cloud', isOfflineSync: true },
  { id: '3', time: new Date(Date.now() - 180 * 60000).toISOString().slice(5, 16).replace('T', ' '), type: 'LINK_RESTORE', desc: 'WiFi restored. Active link: WiFi', isOfflineSync: false },
]

// Engine-driven event log for a node — reusable on the admin/superadmin twin.
export default function NodeEventLog({ nodeId, domain, baseValue, by = 'admin' }: { nodeId: string; domain?: SensorDomain; baseValue: number; by?: string }) {
  const dbRules = useAlarmDB((s) => s.rules)
  const dbAcks = useAlarmDB((s) => s.acks)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)
  const ackEvent = useAlarmDB((s) => s.ackEvent)
  const live = useIsLive()
  // Live mode reads real rows: alarm_events for the log, transport_events +
  // offline_sync_log for connectivity. Demo mode keeps the synthetic series
  // below so the page still demonstrates the UI without a backend.
  const [liveEvents, setLiveEvents] = useState<AlarmEvent[] | null>(null)
  // Root-cause catalogue offered next to Acknowledge. An admin picks from every
  // department's problems; a viewer only sees their own department's (plus the
  // org-wide ones that carry no department).
  const [problems, setProblems] = useState<EventProblem[]>([])
  const [picked, setPicked] = useState<Record<string, string>>({})
  const viewerUserId = useAppStore((st) => st.viewerUserId)
  const [transport, setTransport] = useState<{ id: string; ts: string; type: string; desc: string; isOfflineSync: boolean }[] | null>(null)

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
        time: String(r.raised_at ?? '').replace('T', ' ').slice(5, 16),
        ts: new Date(String(r.raised_at ?? Date.now())).getTime(),
        source: (r.source as AlarmEvent['source']) ?? undefined,
        acknowledgedBy: r.acknowledged_at ? String(r.acknowledged_by ?? 'user') : undefined,
      } as AlarmEvent & { acknowledgedBy?: string })))
    })
    api.transportEvents(nodeId).then((rows) => { if (rows) setTransport(rows) })
  }, [live, nodeId])

  // Problem catalogue, scoped by role.
  useEffect(() => {
    if (!live) { setProblems([]); return }
    const session = getSession()
    const orgId = session?.orgId
    if (!orgId) return
    const isAdmin = session?.role === 'admin' || session?.role === 'superadmin'
    const myDepts = isAdmin ? null : (getViewerUser(viewerUserId)?.departmentIds ?? [])
    api.eventProblems(orgId, undefined, domain).then((rows) => {
      if (!rows) return
      setProblems(isAdmin || !myDepts
        ? rows
        // Viewer: their departments' problems + the org-wide ones (no department).
        : rows.filter((r) => r.department_id === null || myDepts.includes(r.department_id)))
    })
  }, [live, domain, viewerUserId])

  useEffect(() => { loadLive() }, [loadLive])

  // Acknowledge against the backend when live, else the local demo store.
  const onAck = useCallback(async (eventId: string) => {
    if (live) { await api.ackEvent(eventId, { by, eventProblemId: picked[eventId] || undefined }); loadLive() }
    else ackEvent(eventId, by)
  }, [live, by, ackEvent, loadLive, picked])

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
      return { time: new Date(Date.now() - (96 - i) * 15 * 60000).toISOString().slice(5, 16).replace('T', ' '), ts: Date.now() - (96 - i) * 15 * 60000, values }
    })
    return evaluate(nodeId, rule, readings).slice(0, 12)
  }, [rule, nodeId, baseValue])

  // Offline events stay in the log (so they can be acknowledged with a root
  // cause) AND appear on the connectivity timeline below.
  const shownEvents = liveEvents ?? events
  const shownTransport = transport ?? (live ? [] : mockTransportEvents)

  const EVENT_HEADERS = ['Time', 'Parameter', 'Value', 'Unit', 'Threshold', 'Severity', 'Status']
  const eventRows = () => shownEvents.map((ev) => [
    ev.time, ev.paramLabel + (ev.kind === 'rate' ? ' (rate)' : ''), ev.value, ev.unit, ev.threshold, ev.severity,
    (dbAcks[ev.id] || (ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy) ? 'Acknowledged' : 'Open',
  ])
  const TRANSPORT_HEADERS = ['Time', 'Event Type', 'Description']
  const transportRows = () => shownTransport.map((te) => [
    'time' in te ? (te as { time: string }).time : String((te as { ts: string }).ts ?? '').replace('T', ' ').slice(5, 16),
    te.type, te.desc,
  ])

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Bell size={14} className="text-indigo-400" /> Event Log</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1">{live ? 'Alarm events recorded for this device' : 'Generated by the alarm engine from the saved rule'}</span>
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
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a' }}>
              {['Time', 'Parameter', 'Value', 'Severity', 'Status', ''].map((h) => (
                <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownEvents.length ? shownEvents.map((ev) => {
              const acked = !!dbAcks[ev.id] || !!(ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy
              const sc = ev.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24'
              return (
                <tr key={ev.id} style={{ borderTop: '1px solid #1e2433' }}>
                  <td className="py-2.5 px-3 text-slate-400 text-xs">
                    {ev.time}
                    {ev.source === 'edge' && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-indigo-500/20 text-indigo-300 font-medium">EDGE</span>}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 text-xs">{ev.paramLabel}{ev.kind === 'rate' && <span className="text-indigo-400"> · rate</span>}</td>
                  <td className="py-2.5 px-3"><span style={{ color: sc }}>{ev.value} {ev.unit}</span><span className="text-slate-600 text-[10px]"> /{ev.threshold}</span></td>
                  <td className="py-2.5 px-3"><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: sc, background: `${sc}1f` }}>{ev.severity}</span></td>
                  <td className="py-2.5 px-3">{acked ? <span className="flex items-center gap-1 text-[11px] text-green-400"><Check size={12} /> {dbAcks[ev.id]?.by ?? (ev as AlarmEvent & { acknowledgedBy?: string }).acknowledgedBy}</span> : <span className="text-[11px] text-amber-400">Open</span>}</td>
                  <td className="py-2.5 px-3 text-right">
                    {acked ? <span className="text-[11px] text-slate-600">—</span>
                      : (
                        <div className="flex flex-col items-end gap-1.5">
                          {problems.length > 0 && (
                            <select
                              value={picked[ev.id] ?? ''}
                              onChange={(e) => setPicked((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                              className="text-[11px] rounded px-2 py-1 text-slate-200 w-full"
                              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                            >
                              <option value="">Select Problem</option>
                              {problems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                            </select>
                          )}
                          <button onClick={() => onAck(ev.id)} className="text-[11px] font-medium text-white px-3 py-1 rounded-md w-full" style={gradient}>Acknowledge</button>
                        </div>
                      )}
                  </td>
                </tr>
              )
            }) : <tr><td colSpan={6} className="py-6 text-center text-slate-600 text-xs">No events — readings within all alarm rules.</td></tr>}
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
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
          <table className="w-full text-sm">
            <thead>
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
                  <td className="py-2.5 px-3 text-slate-400 text-xs">{'time' in te ? (te as { time: string }).time : String((te as { ts: string }).ts ?? '').replace('T', ' ').slice(5, 16)}</td>
                  <td className="py-2.5 px-3 text-xs font-bold text-slate-300">
                    {te.type}
                    {te.isOfflineSync && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/20 text-emerald-400 font-medium animate-pulse">OFFLINE SYNCING</span>}
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
