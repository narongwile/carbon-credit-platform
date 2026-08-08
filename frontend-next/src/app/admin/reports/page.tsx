'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { getDepartmentsByOrg, reportSchedules as seedSchedules } from '@/lib/orgData'
import type { ReportSequence } from '@/types/org'
import type { RecipientMode } from '@/lib/api'
import { FileBarChart, Download, Clock, CheckCircle, CalendarClock, Plus, Trash2, ToggleLeft, ToggleRight, Users, Building2, Mail, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const REPORT_TYPES = [
  { id: 'health', name: 'Health Status Report', desc: 'Health index and sensor status for all devices', icon: '🏥' },
  { id: 'alarm', name: 'Alarm History Report', desc: 'Complete alarm log with acknowledgment records', icon: '🔔' },
  { id: 'trend', name: 'Sensor Trend Report', desc: '30-day trend analysis with statistical summaries', icon: '📈' },
  { id: 'compliance', name: 'Compliance Report', desc: 'Regulatory compliance status for all assets', icon: '📋' },
]

const SEQUENCES: ReportSequence[] = ['daily', 'weekly', 'monthly']

// 1=Mon .. 7=Sun, matching the day_of_week column (MySQL WEEKDAY()+1).
const WEEKDAYS = [
  { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' }, { v: 3, label: 'Wed' }, { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' }, { v: 6, label: 'Sat' }, { v: 7, label: 'Sun' },
]
// The scheduler tick runs every 15 minutes, so these are the only minutes it
// can actually honour. Offering :07 would promise precision the cron cannot
// deliver — the backend snaps to these anyway.
const MINUTES = [0, 15, 30, 45]
// Capped at 28 so the date exists in February; the backend clamps to match.
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

type OrgUser = { id: string; name?: string | null; email?: string | null; department_ids?: string[]; department_id?: string | null }

export default function ReportsPage() {
  const live = useIsLive()
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  // Real departments (matches Pending Devices' load() pattern), mock as the
  // demo/offline fallback. Depends on `live` (reactive), not a one-time
  // isLive() snapshot: toggling Live/Demo in place, without navigating away,
  // must re-sync this back to mock rather than leaving stale real data shown
  // under a Demo-mode label.
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>(() => getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!live) { setDepartments(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setDepartments(r as { id: string; name: string }[]) })
    return () => { cancelled = true }
  }, [live, orgId])
  // Real fleet — CSV/PDF exports and the "per device" schedule scope picker
  // used to build from managedDevicesFromFleet (the demo seed) unconditionally,
  // in Live mode or not, so a downloaded "Health Status Report" for a real org
  // contained the wrong (demo) devices, not its own fleet.
  const { devices } = useManagedDevices(orgId)

  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)

  const toggleType = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const fileBase = () => {
    const names = REPORT_TYPES.filter((r) => selected.includes(r.id)).map((r) => r.name).join(', ')
    return { names, stamp: new Date().getTime() }
  }

  // Live: real readings-summary CSV from the backend (org-scoped, last 30 days).
  // Falls back to a fleet-snapshot CSV in mock mode or when there are no readings.
  const clientCSV = () => {
    const header = 'Device,Domain,Site,Status,Last Value'
    const rows = devices.map((d) => [d.name, String(d.domain ?? d.deviceType), d.location, d.status, d.lastValue ?? '—'].join(','))
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report_${orgId}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }
  const downloadCSV = async () => {
    const ok = await api.downloadReport({ days: 30 })
    if (!ok) clientCSV()
  }

  const downloadPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(18); doc.setTextColor(99, 102, 241)
    doc.text('ONEOPS — Operations Report', 14, 20)
    doc.setFontSize(10); doc.setTextColor(90, 90, 90)
    doc.text(`Organization: ${orgId}`, 14, 30)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 36)
    doc.text(`Sections: ${fileBase().names}`, 14, 42)
    autoTable(doc, {
      startY: 50,
      head: [['Device', 'Domain', 'Site', 'Status', 'Last Value']],
      body: devices.map((d) => [d.name, String(d.domain ?? d.deviceType), d.location, d.status, d.lastValue ?? '—']),
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] },
    })
    doc.save(`report_${orgId}_${fileBase().stamp}.pdf`)
  }

  const generate = async () => {
    if (!selected.length) { toast.error('Select at least one report type'); return }
    setGenerating(true); setGenerated(false)
    try {
      if (format === 'CSV') await downloadCSV()
      else await downloadPDF()
      setGenerated(true)
      toast.success(`${format} report generated — download started`)
    } catch {
      toast.error('Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  // Scheduling. Local row carries channel/recipients + the 'org' (all-devices) scope
  // that the shared ReportSchedule type doesn't model.
  type SchedRow = {
    id: string; name: string; scope: 'org' | 'department' | 'device'; scopeId: string
    sequence: ReportSequence; format: 'PDF' | 'XLSX' | 'CSV'; channel: 'email' | 'telegram'
    recipients: string; enabled: boolean
    sendHour: number; sendMinute: number; dayOfWeek: number | null; dayOfMonth: number | null
    windowDays: number | null
    recipientMode: RecipientMode; recipientDeptIds: string[]; recipientUserIds: string[]
    subjectTemplate: string; bodyTemplate: string
  }
  const blankSchedule = {
    sendHour: 7, sendMinute: 0, dayOfWeek: 1, dayOfMonth: 1, windowDays: null as number | null,
    recipientMode: 'manual' as RecipientMode, recipientDeptIds: [] as string[], recipientUserIds: [] as string[],
    subjectTemplate: '', bodyTemplate: '',
  }
  const seedRows: SchedRow[] = seedSchedules.map((r) => ({
    id: r.id, name: r.name, scope: r.scope, scopeId: r.scopeId, sequence: r.sequence,
    format: r.format, channel: 'email', recipients: '', enabled: r.enabled, ...blankSchedule,
  }))
  const [schedules, setSchedules] = useState<SchedRow[]>(seedRows)
  // format defaulted to 'PDF' here while the cron only ever produces CSV, so a
  // new schedule promised a PDF out of the box and delivered comma-separated
  // text. CSV is what is actually generated, so CSV is the default.
  const [draft, setDraft] = useState<Omit<SchedRow, 'id' | 'enabled'>>({
    name: '', scope: 'department', scopeId: departments[0]?.id ?? '', sequence: 'daily',
    format: 'CSV', channel: 'email', recipients: '', ...blankSchedule,
  })

  // The org's users, for per-user recipient targeting. department_ids comes
  // back already resolved by the backend (user_departments, falling back to the
  // legacy users.department_id), so the department chips below can show a count
  // that matches what the scheduler will actually resolve at send time.
  const [users, setUsers] = useState<OrgUser[]>([])
  useEffect(() => {
    if (!live) { setUsers([]); return }
    let cancelled = false
    api.users(orgId).then((r) => { if (!cancelled && r) setUsers(r as OrgUser[]) })
    return () => { cancelled = true }
  }, [live, orgId])

  const deptsOf = (u: OrgUser) => u.department_ids?.length ? u.department_ids : (u.department_id ? [u.department_id] : [])
  const mailableInDepts = (deptIds: string[]) =>
    users.filter((u) => (u.email || '').trim() && deptsOf(u).some((d) => deptIds.includes(d)))

  // Load schedules from the backend when reachable (else keep the seed mock).
  useEffect(() => {
    let cancelled = false
    api.listSchedules(orgId).then((rows) => {
      if (cancelled || !rows) return
      const csv = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])
      setSchedules(rows.map((r) => ({
        id: r.id, name: r.name, scope: r.scope, scopeId: r.scope_id ?? '',
        sequence: r.sequence as ReportSequence, format: r.format, channel: r.channel ?? 'email',
        recipients: r.recipients ?? '', enabled: !!r.enabled,
        sendHour: r.send_hour ?? 7, sendMinute: r.send_minute ?? 0,
        dayOfWeek: r.day_of_week ?? 1, dayOfMonth: r.day_of_month ?? 1,
        windowDays: r.window_days ?? null,
        recipientMode: (r.recipient_mode ?? 'manual') as RecipientMode,
        recipientDeptIds: csv(r.recipient_dept_ids), recipientUserIds: csv(r.recipient_user_ids),
        subjectTemplate: r.subject_template ?? '', bodyTemplate: r.body_template ?? '',
      })))
    })
    return () => { cancelled = true }
  }, [orgId])

  // 'org' = every device in the org; no per-item selector needed.
  const scopeOptions = draft.scope === 'department' ? departments.map((d) => ({ id: d.id, name: d.name })) : draft.scope === 'device' ? devices.map((d) => ({ id: d.id, name: d.name })) : []
  // scopeId (camel), not scope_id: rptPostFunc reads b.scopeId, so the old
  // snake_case key arrived undefined and every department- or device-scoped
  // schedule was stored with a NULL target — which the cron widens to the whole
  // organization. A "Line 3 daily" schedule was quietly reporting on everything.
  const persist = (r: SchedRow) => api.saveSchedule({
    id: r.id, orgId, name: r.name, scope: r.scope, scopeId: r.scopeId || undefined,
    sequence: r.sequence, format: r.format, channel: r.channel,
    recipients: r.recipients || undefined, enabled: r.enabled ? 1 : 0,
    sendHour: r.sendHour, sendMinute: r.sendMinute,
    dayOfWeek: r.sequence === 'weekly' ? r.dayOfWeek : null,
    dayOfMonth: r.sequence === 'monthly' ? r.dayOfMonth : null,
    windowDays: r.windowDays,
    recipientMode: r.recipientMode,
    recipientDeptIds: r.recipientDeptIds, recipientUserIds: r.recipientUserIds,
    subjectTemplate: r.subjectTemplate, bodyTemplate: r.bodyTemplate,
  })

  // What this draft would actually deliver to, so an empty selection is caught
  // here rather than discovered as a report nobody received.
  const draftRecipientCount = draft.channel === 'telegram'
    ? (draft.recipients.trim() ? 1 : 0)
    : draft.recipientMode === 'department' ? mailableInDepts(draft.recipientDeptIds).length
    : draft.recipientMode === 'users' ? users.filter((u) => draft.recipientUserIds.includes(u.id) && (u.email || '').trim()).length
    : draft.recipients.split(',').map((x) => x.trim()).filter(Boolean).length

  const addSchedule = async () => {
    if (!draft.name.trim()) { toast.error('Give the schedule a name'); return }
    if (draftRecipientCount === 0) {
      toast.error(draft.recipientMode === 'manual' || draft.channel === 'telegram'
        ? 'Add at least one recipient'
        : `The selected ${draft.recipientMode === 'department' ? 'departments have' : 'users have'} no email address`)
      return
    }
    const id = `rs-${Date.now()}`
    const scopeId = draft.scope === 'org' ? '' : (draft.scopeId || scopeOptions[0]?.id || '')
    const row: SchedRow = { ...draft, id, scopeId, enabled: true }
    setSchedules((s) => [...s, row])
    if (live) {
      const r = await persist(row)
      // The save result was ignored, so a rejected schedule stayed on screen
      // looking saved until a reload removed it.
      if (!r) { setSchedules((s) => s.filter((x) => x.id !== id)); toast.error('Could not save the schedule'); return }
    }
    setDraft((d) => ({ ...d, name: '', recipients: '' }))
    toast.success('Schedule added')
  }
  const toggleSchedule = async (id: string) => {
    const prev = schedules.find((x) => x.id === id)
    if (!prev) return
    const next = { ...prev, enabled: !prev.enabled }
    setSchedules((s) => s.map((x) => (x.id === id ? next : x)))
    if (live && !(await persist(next))) {
      setSchedules((s) => s.map((x) => (x.id === id ? prev : x)))
      toast.error('Could not change the schedule')
    }
  }
  const removeSchedule = async (id: string) => {
    const prev = schedules
    setSchedules((s) => s.filter((x) => x.id !== id))
    if (live && !(await api.deleteSchedule(id))) { setSchedules(prev); toast.error('Could not delete the schedule') }
  }
  const scopeName = (s: SchedRow) => s.scope === 'org' ? 'All devices' : (s.scope === 'department' ? departments.find((d) => d.id === s.scopeId)?.name : devices.find((d) => d.id === s.scopeId)?.name) ?? s.scopeId

  // How a saved row will actually behave, in words — the table showed
  // "daily" and nothing about when or to whom.
  const whenText = (s: SchedRow) => {
    const t = `${String(s.sendHour).padStart(2, '0')}:${String(s.sendMinute).padStart(2, '0')}`
    if (s.sequence === 'weekly') return `${WEEKDAYS.find((w) => w.v === s.dayOfWeek)?.label ?? 'Mon'} ${t}`
    if (s.sequence === 'monthly') return `day ${s.dayOfMonth ?? 1} · ${t}`
    return `daily ${t}`
  }
  const toText = (s: SchedRow) => {
    if (s.channel === 'telegram') return s.recipients || null
    if (s.recipientMode === 'department') {
      const names = s.recipientDeptIds.map((id) => departments.find((d) => d.id === id)?.name ?? id)
      const n = mailableInDepts(s.recipientDeptIds).length
      return names.length ? `${names.join(', ')} (${n} recipient${n === 1 ? '' : 's'})` : null
    }
    if (s.recipientMode === 'users') {
      const names = s.recipientUserIds.map((id) => users.find((u) => u.id === id)?.name ?? id)
      return names.length ? names.join(', ') : null
    }
    return s.recipients || null
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Report Management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Generate on-demand reports and schedule recurring sequences</p>
      </div>

      {/* Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-4">Report Setting (device / department)</h3>
            <div className="space-y-2">
              {REPORT_TYPES.map((rt) => (
                <div key={rt.id} onClick={() => toggleType(rt.id)} className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                  style={selected.includes(rt.id) ? { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' } : inset}>
                  <div className="text-xl w-8 text-center">{rt.icon}</div>
                  <div className="flex-1"><div className="text-sm text-white font-medium">{rt.name}</div><div className="text-xs text-slate-500">{rt.desc}</div></div>
                  <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={selected.includes(rt.id) ? { background: '#6366f1', border: '1px solid #6366f1' } : { border: '1px solid #1e2433' }}>
                    {selected.includes(rt.id) && <CheckCircle size={12} className="text-white" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <span className="text-xs text-slate-400">Format:</span>
              {(['PDF', 'XLSX', 'CSV'] as const).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={format === f ? { background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid #6366f1' } : inset}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={generate} disabled={!selected.length || generating} className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
              <FileBarChart size={16} /> {generating ? 'Generating…' : 'Generate Report'}
            </button>
            {generated && <button onClick={() => (format === 'CSV' ? downloadCSV() : downloadPDF())} className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}><Download size={16} /> Download {format}</button>}
          </div>
        </div>

        {/* Create schedule */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><CalendarClock size={15} className="text-indigo-400" /> Sequence Setting</h3>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Schedule name"
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <div className="flex gap-2">
            {([['org', 'All devices'], ['department', 'Department'], ['device', 'Per device']] as const).map(([sc, label]) => (
              <button key={sc} onClick={() => setDraft((d) => ({ ...d, scope: sc, scopeId: '' }))} className={clsx('flex-1 py-1.5 rounded-lg text-[11px] font-semibold', draft.scope === sc ? 'text-white' : 'text-slate-500')} style={draft.scope === sc ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{label}</button>
            ))}
          </div>
          {draft.scope !== 'org' && (
            <select value={draft.scopeId} onChange={(e) => setDraft((d) => ({ ...d, scopeId: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
              {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {/* --- WHEN ------------------------------------------------------ */}
          <div className="pt-1" style={{ borderTop: '1px solid #1e2433' }}>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 mt-2">Frequency</label>
            <div className="flex gap-2">
              {SEQUENCES.map((s) => (
                <button key={s} onClick={() => setDraft((d) => ({ ...d, sequence: s }))} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize', draft.sequence === s ? 'text-white' : 'text-slate-500')} style={draft.sequence === s ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{s}</button>
              ))}
            </div>
          </div>

          {draft.sequence === 'weekly' && (
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">On</label>
              <div className="flex gap-1">
                {WEEKDAYS.map((w) => (
                  <button key={w.v} onClick={() => setDraft((d) => ({ ...d, dayOfWeek: w.v }))}
                    className={clsx('flex-1 py-1.5 rounded-lg text-[10px] font-semibold', draft.dayOfWeek === w.v ? 'text-white' : 'text-slate-500')}
                    style={draft.dayOfWeek === w.v ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{w.label}</button>
                ))}
              </div>
            </div>
          )}

          {draft.sequence === 'monthly' && (
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Day of month</label>
              <select value={draft.dayOfMonth ?? 1} onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
                {MONTH_DAYS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <p className="text-[10px] text-slate-600 mt-1">Capped at 28 so it exists in every month.</p>
            </div>
          )}

          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Send at</label>
            <div className="flex gap-2 items-center">
              <select value={draft.sendHour} onChange={(e) => setDraft((d) => ({ ...d, sendHour: Number(e.target.value) }))}
                className="flex-1 rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
              </select>
              <span className="text-slate-600">:</span>
              <select value={draft.sendMinute} onChange={(e) => setDraft((d) => ({ ...d, sendMinute: Number(e.target.value) }))}
                className="flex-1 rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
                {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              Local time. The scheduler checks every 15 minutes, so delivery lands within a quarter hour of this.
            </p>
          </div>

          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Data window</label>
            <select value={draft.windowDays ?? ''} onChange={(e) => setDraft((d) => ({ ...d, windowDays: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
              <option value="">Match frequency ({draft.sequence === 'weekly' ? '7' : draft.sequence === 'monthly' ? '30' : '1'} day{draft.sequence === 'daily' ? '' : 's'})</option>
              {[1, 3, 7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} day{n === 1 ? '' : 's'}</option>)}
            </select>
            <p className="text-[10px] text-slate-600 mt-1">How much history each report covers, independent of how often it arrives.</p>
          </div>

          {/* --- WHO ------------------------------------------------------- */}
          <div className="pt-3" style={{ borderTop: '1px solid #1e2433' }}>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Deliver by</label>
            <div className="flex gap-2">
              {([['email', 'Email'], ['telegram', 'Telegram']] as const).map(([ch, label]) => (
                <button key={ch} onClick={() => setDraft((d) => ({ ...d, channel: ch }))} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold', draft.channel === ch ? 'text-white' : 'text-slate-500')} style={draft.channel === ch ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>{label}</button>
              ))}
            </div>
          </div>

          {draft.channel === 'telegram' ? (
            // A telegram destination is a chat id, not a directory entry — the
            // department/user modes below have nothing to resolve to.
            <input value={draft.recipients} onChange={(e) => setDraft((d) => ({ ...d, recipients: e.target.value }))}
              placeholder="Telegram chat id"
              className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          ) : (
            <>
              <div className="flex gap-2">
                {([['manual', 'Addresses', Mail], ['department', 'Department', Building2], ['users', 'People', Users]] as const).map(([m, label, Icon]) => (
                  <button key={m} onClick={() => setDraft((d) => ({ ...d, recipientMode: m }))}
                    className={clsx('flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold', draft.recipientMode === m ? 'text-white' : 'text-slate-500')}
                    style={draft.recipientMode === m ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                    <Icon size={11} /> {label}
                  </button>
                ))}
              </div>

              {draft.recipientMode === 'manual' && (
                <input value={draft.recipients} onChange={(e) => setDraft((d) => ({ ...d, recipients: e.target.value }))}
                  placeholder="Email(s), comma-separated"
                  className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
              )}

              {draft.recipientMode === 'department' && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg p-2" style={inset}>
                  {departments.length === 0 ? <p className="text-xs text-slate-600">No departments yet.</p> : departments.map((dep) => {
                    const on = draft.recipientDeptIds.includes(dep.id)
                    const n = mailableInDepts([dep.id]).length
                    return (
                      <button key={dep.id} onClick={() => setDraft((d) => ({ ...d, recipientDeptIds: on ? d.recipientDeptIds.filter((x) => x !== dep.id) : [...d.recipientDeptIds, dep.id] }))}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-white/5">
                        <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white' : 'text-slate-400')}>
                          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }} />
                          {dep.name}
                        </span>
                        <span className={clsx('flex-shrink-0', n === 0 ? 'text-amber-500/80' : 'text-slate-600')}>{n} with email</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {draft.recipientMode === 'users' && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg p-2" style={inset}>
                  {users.length === 0 ? <p className="text-xs text-slate-600">{live ? 'No users in this organization.' : 'Live mode required to list users.'}</p> : users.map((u) => {
                    const on = draft.recipientUserIds.includes(u.id)
                    const mailable = !!(u.email || '').trim()
                    return (
                      <button key={u.id} disabled={!mailable}
                        onClick={() => setDraft((d) => ({ ...d, recipientUserIds: on ? d.recipientUserIds.filter((x) => x !== u.id) : [...d.recipientUserIds, u.id] }))}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent">
                        <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white' : 'text-slate-400')}>
                          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }} />
                          {u.name || u.id}
                        </span>
                        <span className="text-slate-600 truncate flex-shrink-0">{mailable ? u.email : 'no email'}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {draft.recipientMode !== 'manual' && (
                <p className="text-[10px] text-slate-600">
                  Resolved each time the report runs, so people who join or leave are picked up without editing this schedule.
                </p>
              )}
            </>
          )}

          {/* --- MESSAGE ---------------------------------------------------
              The subject and body were hardcoded ("ONEOPS Report: <name>" /
              "Automated daily org report."), so every customer's every report
              arrived with our product name in the subject and a sentence of
              English boilerplate — unusable for a Thai team forwarding it on,
              and unchangeable. Blank keeps that original wording, so existing
              schedules are untouched. */}
          <div className="pt-3" style={{ borderTop: '1px solid #1e2433' }}>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
              {draft.channel === 'telegram' ? 'Message' : 'Email subject'}
            </label>
            <input value={draft.subjectTemplate} onChange={(e) => setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))}
              placeholder={`ONEOPS Report: ${draft.name || '<name>'}`}
              className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
              {draft.channel === 'telegram' ? 'Caption (second line)' : 'Email body'}
            </label>
            <textarea value={draft.bodyTemplate} onChange={(e) => setDraft((d) => ({ ...d, bodyTemplate: e.target.value }))}
              rows={2} placeholder={`Automated ${draft.sequence} ${draft.scope} report.`}
              className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-y" style={inset} />
            <p className="text-[10px] text-slate-600 mt-1">
              Leave blank for the default. Placeholders:{' '}
              <span className="font-mono text-slate-500">{'{name} {sequence} {scope} {org} {date} {devices} {rows}'}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            {draftRecipientCount === 0
              ? <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={11} /> No one would receive this</span>
              : <span className="text-slate-500">{draftRecipientCount} recipient{draftRecipientCount === 1 ? '' : 's'}</span>}
          </div>

          <button onClick={addSchedule} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}><Plus size={15} /> Add Schedule</button>
        </div>
      </div>

      {/* Scheduled reports list */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <h3 className="text-sm font-semibold text-white">Scheduled Reports</h3>
        </div>
        <table className="w-full text-sm" style={{ background: '#0d1117' }}>
          <thead><tr style={{ borderBottom: '1px solid #1e2433' }}>{['Name', 'Scope', 'When', 'Covers', 'Delivery', 'Enabled', ''].map((h) => <th key={h} className="py-2.5 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {schedules.length === 0 && (
              <tr><td colSpan={7} className="py-6 px-4 text-center text-sm text-slate-600">No schedules yet.</td></tr>
            )}
            {schedules.map((s) => {
              const to = toText(s)
              return (
              <tr key={s.id} style={{ borderBottom: '1px solid #1e2433' }}>
                <td className="py-3 px-4 text-white font-medium">
                  {s.name}
                  {/* Only CSV is ever generated by the scheduler (there is no
                      PDF/XLSX writer in the backend), so a row still carrying
                      an older format is flagged rather than displayed as if it
                      were honoured. */}
                  {s.format !== 'CSV' && (
                    <span className="ml-2 text-[10px] text-amber-500/80" title={`Stored as ${s.format}, but scheduled reports are delivered as CSV`}>
                      sent as CSV
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-slate-400"><span className="capitalize text-slate-500">{s.scope}:</span> {scopeName(s)}</td>
                <td className="py-3 px-4"><span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{whenText(s)}</span></td>
                <td className="py-3 px-4 text-slate-400 text-xs">
                  last {s.windowDays ?? (s.sequence === 'weekly' ? 7 : s.sequence === 'monthly' ? 30 : 1)}d
                </td>
                <td className="py-3 px-4 text-slate-400">
                  <span className="capitalize">{s.channel}</span>
                  {s.channel === 'email' && s.recipientMode !== 'manual' && (
                    <span className="text-slate-600"> · {s.recipientMode === 'department' ? 'dept' : 'people'}</span>
                  )}
                  {to ? <span className="text-slate-600"> · {to}</span> : <span className="text-amber-500/70"> · nobody</span>}
                </td>
                <td className="py-3 px-4"><button onClick={() => toggleSchedule(s.id)}>{s.enabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}</button></td>
                <td className="py-3 px-4 text-right"><button onClick={() => removeSchedule(s.id)} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={13} /></button></td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
