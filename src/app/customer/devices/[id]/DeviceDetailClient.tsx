'use client'

import { useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { defaultNotificationChannels, eventProblems } from '@/lib/orgData'
import { allManagedDevices } from '@/lib/fleetData'
import { useAppStore } from '@/lib/store'
import { viewerEventProblems, viewerCanManage, viewerCanAccess, viewerDepartments, getViewerUser } from '@/lib/viewer'
import type { ManagedDevice, NotificationChannelConfig } from '@/types/org'
import FixDashboard from '@/components/device/FixDashboard'
import FreestyleDashboard from '@/components/device/FreestyleDashboard'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import { evaluate, type AlarmEvent } from '@/server/alarmEngine'
import { useAlarmDB } from '@/server/alarmStore'
import { defaultNodeRule } from '@/lib/alarmParams'
import {
  ArrowLeft, Upload, Download, FileText, Mail, FileSpreadsheet, Trash2, Users, Bell,
  ToggleLeft, ToggleRight, Wifi, WifiOff, Save, Check, LayoutGrid, Sparkles, Lock, Eye,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const managedDevices = allManagedDevices()

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

function genHistory(seed: number) {
  const out: { time: string; value: number }[] = []
  const now = Date.now(); let v = seed
  for (let i = 96; i >= 0; i--) { v += (Math.random() - 0.5) * 1.5; out.push({ time: new Date(now - i * 15 * 60 * 1000).toISOString().slice(5, 16).replace('T', ' '), value: +v.toFixed(1) }) }
  return out
}

export default function DeviceDetailClient() {
  const params = useParams()
  const id = String(params?.id ?? '')
  const device: ManagedDevice = managedDevices.find((d) => d.id === id) ?? managedDevices[0]

  // Viewer -> department -> product access
  const { viewerUserId, documents, addDocument, removeDocument } = useAppStore()
  const domain = device.domain
  const canAccess = !domain || viewerCanAccess(viewerUserId, domain)
  const canManage = !domain || viewerCanManage(viewerUserId, domain)
  const deptEvents = viewerEventProblems(viewerUserId)
  const evProblems = deptEvents.length ? deptEvents : eventProblems

  // viewer identity + department(s) for document scoping & email export
  const me = getViewerUser(viewerUserId)
  const myDepts = viewerDepartments(viewerUserId)
  const myDeptIds = myDepts.map((d) => d.id)
  const primaryDept = myDepts[0]
  // documents for THIS node, visible only to the viewer's department(s)
  const nodeDocs = documents.filter((d) => d.nodeId === id && myDeptIds.includes(d.departmentId))

  const [view, setView] = useState<'fix' | 'freestyle'>(device.theme)
  const baseTemp = useMemo(() => parseFloat(device.lastValue ?? '5') || 5, [device])
  const history = useMemo(() => genHistory(baseTemp), [baseTemp])

  const [range, setRange] = useState({ start: '2026-05-01', end: '2026-06-01' })
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [limits, setLimits] = useState({ low: 2, high: 8 })
  const [email, setEmail] = useState(me?.email ?? 'viewer@customer.com')
  const [savedSetting, setSavedSetting] = useState(false)
  const [exported, setExported] = useState('')
  const docRef = useRef<HTMLInputElement>(null)

  // --- Department document upload / download -----
  const uploadDoc = (file?: File) => {
    if (!file) return
    if (!primaryDept) { toast.error('You are not in a department'); return }
    const reader = new FileReader()
    reader.onload = () => {
      addDocument({
        id: `doc-${Date.now()}`, nodeId: id, departmentId: primaryDept.id,
        name: file.name, size: `${(file.size / 1024).toFixed(0)} KB`,
        date: new Date().toLocaleString(), uploadedBy: me?.name ?? 'user',
        dataUrl: String(reader.result),
      })
      toast.success(`Uploaded to ${primaryDept.name}`)
    }
    reader.readAsDataURL(file)
  }
  const downloadDoc = (d: { name: string; dataUrl: string }) => {
    const a = document.createElement('a'); a.href = d.dataUrl; a.download = d.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // --- Export node detail (date range) -> CSV / PDF / email -----
  const rangeRows = useMemo(() => history.map((h, i) => ({
    time: `${range.start} ${String(6 + (i % 18)).padStart(2, '0')}:00`, value: h.value,
    status: h.value > limits.high ? 'HIGH' : h.value < limits.low ? 'LOW' : 'OK',
  })), [history, range, limits])

  const exportCSV = () => {
    const header = 'Time,Value,Status'
    const rows = rangeRows.map((r) => `${r.time},${r.value},${r.status}`)
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${device.name.replace(/\s+/g, '_')}_${range.start}_${range.end}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setExported('csv'); toast.success('CSV downloaded')
  }
  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(16); doc.setTextColor(99, 102, 241)
    doc.text(`Node Report — ${device.name}`, 14, 18)
    doc.setFontSize(10); doc.setTextColor(90, 90, 90)
    doc.text(`Serial: ${device.serial}  ·  ${device.location}`, 14, 26)
    doc.text(`Range: ${range.start} → ${range.end}  ·  Last value: ${device.lastValue ?? '—'}`, 14, 32)
    autoTable(doc, { startY: 40, head: [['Time', 'Value', 'Status']], body: rangeRows.slice(0, 40).map((r) => [r.time, String(r.value), r.status]), theme: 'striped', headStyles: { fillColor: [99, 102, 241] } })
    doc.save(`${device.name.replace(/\s+/g, '_')}_${range.start}_${range.end}.pdf`)
    setExported('pdf'); toast.success('PDF downloaded')
  }
  const sendEmail = () => {
    if (!email) { toast.error('Enter an email'); return }
    setExported('email'); toast.success(`Node detail (${range.start}→${range.end}) sent to ${email}`)
  }

  // --- Alarm engine: real events from the saved rule (config drives the log) ---
  const dbRules = useAlarmDB((s) => s.rules)
  const dbAcks = useAlarmDB((s) => s.acks)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)
  const ackEvent = useAlarmDB((s) => s.ackEvent)
  const rule = useMemo(() => {
    if (!domain) return null
    return (hasHydrated && dbRules[id]) ? dbRules[id] : defaultNodeRule(domain)
  }, [domain, id, hasHydrated, dbRules])

  // Synthesize a multi-parameter telemetry series around each rule threshold so
  // the engine produces a realistic event mix that RESPONDS to threshold edits.
  const events: AlarmEvent[] = useMemo(() => {
    if (!rule) return []
    const readings = history.map((h, i) => {
      const values: Record<string, number> = {}
      rule.params.forEach((p, pi) => {
        const span = Math.max(2, Math.abs(p.critical - p.warn))
        const wave = Math.sin((i + pi * 4) * 0.45) * span * 0.95
        const noise = (((i * 7 + pi * 13) % 5) - 2) * span * 0.06
        values[p.key] = +(p.direction === 'high' ? p.warn - span * 0.25 + wave + noise : p.warn + span * 0.25 - wave - noise).toFixed(2)
      })
      return { time: h.time, ts: Date.now() - (history.length - i) * 15 * 60000, values }
    })
    return evaluate(id, rule, readings).slice(0, 12)
  }, [rule, history, id])

  // per-event classification (department event-problem)
  const [evClass, setEvClass] = useState<Record<string, string>>({})

  const toggleChannel = (cid: string) => setChannels((c) => c.map((x) => (x.id === cid ? { ...x, enabled: !x.enabled } : x)))
  const saveSetting = async () => { await new Promise((r) => setTimeout(r, 300)); setSavedSetting(true); setTimeout(() => setSavedSetting(false), 2000) }
  const status = device.status === 'online' ? 'NORMAL' : 'OFFLINE'

  if (!canAccess) {
    return (
      <div className="p-6">
        <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back</Link>
        <div className="max-w-lg mx-auto mt-12 rounded-2xl p-8 text-center" style={surface}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.12)' }}><Lock size={26} className="text-red-400" /></div>
          <h2 className="text-lg font-bold text-white">No access to this device</h2>
          <p className="text-sm text-slate-500 mt-2">Your department is not permitted to view this product. Contact your organization admin.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
          <ArrowLeft size={15} /> Back
        </Link>
        <span className="text-base font-bold text-white">{device.name}</span>
        <span className={clsx('flex items-center gap-1 text-xs font-medium', device.status === 'online' ? 'text-green-400' : 'text-slate-500')}>
          {device.status === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />} {status}
        </span>
        <span className="text-xs text-slate-500">{device.location}</span>

        {/* Theme preview toggle */}
        <div className="ml-auto flex items-center gap-1 p-1 rounded-lg" style={inset}>
          <button onClick={() => setView('fix')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'fix' ? 'text-white' : 'text-slate-500')} style={view === 'fix' ? { background: '#6366f1' } : {}}>
            <LayoutGrid size={13} /> FIX
          </button>
          <button onClick={() => setView('freestyle')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'freestyle' ? 'text-white' : 'text-slate-500')} style={view === 'freestyle' ? { background: '#f55f3e' } : {}}>
            <Sparkles size={13} /> Free Style
          </button>
        </div>
      </div>
      <div className="text-[11px] text-slate-600 -mt-3">
        {view === device.theme ? 'Showing this device’s configured dashboard.' : 'Previewing alternate theme (device default: ' + device.theme.toUpperCase() + ').'}
      </div>

      {/* Dashboard (distinct per theme) */}
      {view === 'fix' ? <FixDashboard device={device} /> : <FreestyleDashboard device={device} />}

      {/* Common viewer tools */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Event log — same Acknowledge table as admin, with the viewer's
            DEPARTMENT-specific event-problem dropdown */}
        <div className="rounded-xl p-5 lg:col-span-2" style={surface}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Event Log</h3>
            <span className="text-[11px] text-slate-500">Generated by the alarm engine from your saved rules · classify ({evProblems.length})</span>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#0a0e1a' }}>
                  {['Time', 'Parameter', 'Value', 'Severity', 'Event (department)', 'Status', ''].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.length ? events.map((ev) => {
                  const acked = !!dbAcks[ev.id]
                  const sc = ev.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24'
                  return (
                    <tr key={ev.id} style={{ borderTop: '1px solid #1e2433' }}>
                      <td className="py-2.5 px-3 text-slate-400 text-xs">{ev.time}</td>
                      <td className="py-2.5 px-3 text-slate-300 text-xs">{ev.paramLabel}{ev.kind === 'rate' && <span className="text-indigo-400"> · rate</span>}</td>
                      <td className="py-2.5 px-3"><span style={{ color: sc }}>{ev.value} {ev.unit}</span><span className="text-slate-600 text-[10px]"> /{ev.threshold}</span></td>
                      <td className="py-2.5 px-3"><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: sc, background: `${sc}1f` }}>{ev.severity}</span></td>
                      <td className="py-2.5 px-3">
                        <select value={evClass[ev.id] ?? evProblems[0]?.id ?? ''} onChange={(e) => setEvClass((s) => ({ ...s, [ev.id]: e.target.value }))} disabled={acked}
                          className="rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60" style={inset}>
                          {evProblems.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        {acked ? <span className="flex items-center gap-1 text-[11px] text-green-400"><Check size={12} /> {dbAcks[ev.id].by}</span> : <span className="text-[11px] text-amber-400">Open</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {acked ? <span className="text-[11px] text-slate-600">—</span>
                          : canManage
                            ? <button onClick={() => ackEvent(ev.id, me?.name ?? 'viewer')} className="text-[11px] font-medium text-white px-3 py-1 rounded-md" style={gradient}>Acknowledge</button>
                            : <span className="text-[11px] text-slate-600 flex items-center gap-1 justify-end"><Eye size={11} /> view-only</span>}
                      </td>
                    </tr>
                  )
                }) : <tr><td colSpan={7} className="py-6 text-center text-slate-600 text-xs">No events — readings are within all alarm rules.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Department documents — upload/download, visible only within your department */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Documents</h3>
            <span className="flex items-center gap-1 text-[10px] text-slate-500"><Users size={11} /> {primaryDept?.name ?? 'no department'} only</span>
          </div>
          <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white cursor-pointer" style={gradient}>
            <Upload size={14} /> Upload Document
            <input ref={docRef} type="file" className="hidden" onChange={(e) => { uploadDoc(e.target.files?.[0]); if (docRef.current) docRef.current.value = '' }} />
          </label>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-xs">
              <thead><tr style={{ background: '#0a0e1a' }}>{['File', 'By', 'Size', ''].map((h) => <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {nodeDocs.length ? nodeDocs.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid #1e2433' }}>
                    <td className="py-2 px-3 text-slate-300 flex items-center gap-1.5"><FileText size={12} className="text-indigo-400" /><span className="truncate max-w-[120px]">{f.name}</span></td>
                    <td className="py-2 px-3 text-slate-500">{f.uploadedBy}</td>
                    <td className="py-2 px-3 text-slate-500">{f.size}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button onClick={() => downloadDoc(f)} className="text-indigo-400 hover:text-indigo-300 mr-2"><Download size={13} /></button>
                      <button onClick={() => removeDocument(f.id)} className="text-slate-600 hover:text-red-400"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={4} className="py-4 text-center text-slate-600">No documents shared in your department yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Export node detail — date range -> CSV / PDF / email to the user */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">Export Node Detail</h3>
          <div className="flex items-center gap-2">
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} className="flex-1 rounded-lg px-2.5 py-2 text-xs text-white outline-none" style={inset} />
            <span className="text-slate-600 text-xs">to</span>
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} className="flex-1 rounded-lg px-2.5 py-2 text-xs text-white outline-none" style={inset} />
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Send to email" className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <div className="grid grid-cols-3 gap-2">
            <button onClick={sendEmail} className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium text-white" style={gradient}><Mail size={13} /> Email</button>
            <button onClick={exportCSV} className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium text-slate-300" style={inset}><FileSpreadsheet size={13} /> CSV</button>
            <button onClick={exportPDF} className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium text-slate-300" style={inset}><FileText size={13} /> PDF</button>
          </div>
          {exported && <p className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> {exported === 'email' ? `Sent to ${email}` : `${exported.toUpperCase()} downloaded`}</p>}
        </div>

        {/* Personal alarm / notification — every viewer can set this; alerts ONLY this user */}
        <div className="rounded-xl p-5 space-y-3 lg:col-span-2" style={surface}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">My Alert Settings</h3>
            <span className="text-[10px] text-slate-500 flex items-center gap-1"><Bell size={11} /> personal — alerts only you · {email}</span>
          </div>
          <AlarmParamConfig domain={device.domain} nodeId={id} />
          <div className="space-y-1.5">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
                <span className="text-sm text-slate-300">{ch.name}</span>
                <button onClick={() => toggleChannel(ch.id)}>
                  {ch.enabled ? <ToggleRight size={20} className="text-indigo-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
                </button>
              </div>
            ))}
          </div>
          <button onClick={saveSetting} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={savedSetting ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
            <Save size={14} /> {savedSetting ? 'Saved!' : 'Save My Alert'}
          </button>
        </div>
        {!canManage && (
          <div className="lg:col-span-2 rounded-lg px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2" style={inset}>
            <Eye size={13} /> You have view access — your alert settings here are personal. Org-wide alarm rules are configured by your admin.
          </div>
        )}
      </div>
    </div>
  )
}
