'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { getDepartmentsByOrg, reportSchedules as seedSchedules } from '@/lib/orgData'
import type { ReportSequence } from '@/types/org'
import type { RecipientMode } from '@/lib/api'
import {
  buildIIoTReportData,
  exportIIoTPDF,
  exportIIoTXLSX,
  exportIIoTCSV,
  type IIoTMetricSummary,
  type DeviceTelemetrySummary,
  type AlarmLogItem,
  na,
} from '@/lib/iiotReportGenerator'
import {
  FileBarChart,
  Download,
  CheckCircle,
  CalendarClock,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Users,
  Building2,
  Mail,
  AlertTriangle,
  Activity,
  ShieldCheck,
  Zap,
  Leaf,
  Layers,
  FileSpreadsheet,
  FileText,
  Clock,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const INDUSTRIAL_DOMAINS = [
  { id: 'all', label: 'All Fleet Assets', icon: Layers },
  { id: 'transformer', label: 'Transformers (ETERNITY)', icon: Zap },
  { id: 'carbonNode', label: 'Cold-Chain (Refrigeration)', icon: Activity },
  { id: 'bloodBox', label: 'BloodBOX (Cold Transit)', icon: ShieldCheck },
]

// Each entry below names ONLY what the generator actually computes — see
// IIoTMetricSummary and the Asset_Health_Analytics sheet in
// lib/iiotReportGenerator.ts, whose own header explicitly disclaims
// implementing or certifying against IEEE C57.104, IEC 60076, IEEE 519,
// HACCP/GDP/21 CFR Part 11 and the GHG Protocol.
//
// This list used to contradict that disclaimer directly: it advertised Duval
// triangle risk, a winding hot-spot calculation and an insulation thermal
// aging factor, none of which exist anywhere in the codebase — and the real
// ETERNITY transformer does not even publish the CH₄/C₂H₂/C₂H₄ a Duval
// triangle needs, only H₂. It also claimed IEEE 519 harmonic analysis, load
// factor, peak kVA and power factor, none of which are computed either.
// Someone filing one of these reports with a regulator on the strength of
// those badges would be filing an unbacked claim.
//
// MKT (USP) and the grid emission factor ARE implemented and are named as the
// borrowed published formulae they are — a formula is not an accredited audit.
const REPORT_SECTIONS = [
  {
    id: 'health',
    // Merge note: both branches independently removed the Duval-triangle /
    // hot-spot / thermal-aging claim from this entry. This keeps the other
    // branch's naming of the specific parameters (they are all genuinely
    // published and alarmed: hydrogen, oilTemp, moisture) together with what
    // the Asset_Health_Analytics sheet actually emits for each of them.
    name: 'Asset Health & Oil/DGA Excursion Summary',
    desc: 'Per-asset health score, dissolved hydrogen (H₂), top oil temperature and insulation moisture — min/avg/max with sample counts, and compliance against each device’s own configured limits',
    badge: 'Asset Health',
    icon: '🏥',
  },
  {
    id: 'energy',
    name: 'Energy & Carbon Summary',
    desc: 'Recorded energy total (kWh) and a Scope 2 carbon estimate derived from a published grid emission factor',
    badge: 'Scope 2 estimate',
    icon: '⚡',
  },
  {
    id: 'coldchain',
    name: 'Cold-Chain Temperature Summary',
    desc: 'Mean kinetic temperature (MKT °C, USP formula) and recorded temperature excursions against configured limits',
    badge: 'MKT (USP)',
    icon: '❄️',
  },
  {
    id: 'alarm',
    name: 'Alarm History & Response Log',
    desc: 'Complete alarm log with open/acknowledged/cleared state, acknowledgment timestamps & mean time to resolve (MTTR)',
    badge: 'Alarm log',
    icon: '🔔',
  },
  {
    id: 'executive',
    name: 'Executive Comprehensive Audit Summary',
    desc: 'Full multi-section synthesis of recorded telemetry, alarms and asset health',
    badge: 'Executive',
    icon: '📋',
  },
]

const TIME_RANGES = [
  { label: '24 Hours', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
]

const SEQUENCES: ReportSequence[] = ['daily', 'weekly', 'monthly']

const WEEKDAYS = [
  { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' }, { v: 3, label: 'Wed' }, { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' }, { v: 6, label: 'Sat' }, { v: 7, label: 'Sun' },
]
const MINUTES = [0, 15, 30, 45]
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

type OrgUser = { id: string; name?: string | null; email?: string | null; department_ids?: string[]; department_id?: string | null }

export default function ReportsPage() {
  const live = useIsLive()
  const { selectedOrgId, orgNames } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const orgName = orgNames[orgId] || 'ETERNITY'

  const [departments, setDepartments] = useState<{ id: string; name: string }[]>(() => getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!live) { setDepartments(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setDepartments(r as { id: string; name: string }[]) })
    return () => { cancelled = true }
  }, [live, orgId])

  const { devices } = useManagedDevices(orgId)

  // Filter & Studio State
  const [selectedDomain, setSelectedDomain] = useState<string>('all')
  const [selectedDept, setSelectedDept] = useState<string>('all')
  const [selectedDays, setSelectedDays] = useState<number>(30)
  const [selectedSections, setSelectedSections] = useState<string[]>(['health', 'energy', 'alarm', 'executive'])
  const [exportFormat, setExportFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [generating, setGenerating] = useState(false)

  // Live Metrics & Preview Cache
  const [reportData, setReportData] = useState<{
    metrics: IIoTMetricSummary
    summaries: DeviceTelemetrySummary[]
    alarms: AlarmLogItem[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    buildIIoTReportData({
      orgId,
      orgName,
      days: selectedDays,
      domain: selectedDomain,
      departmentId: selectedDept,
      selectedTypes: selectedSections,
      format: exportFormat,
      devices,
    }).then((res) => {
      if (!cancelled) setReportData(res)
    })
    return () => { cancelled = true }
  }, [orgId, orgName, selectedDays, selectedDomain, selectedDept, selectedSections, exportFormat, devices])

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleGenerateAndDownload = async () => {
    if (!selectedSections.length) {
      toast.error('Select at least one report section')
      return
    }
    setGenerating(true)
    try {
      const data = reportData || await buildIIoTReportData({
        orgId,
        orgName,
        days: selectedDays,
        domain: selectedDomain,
        departmentId: selectedDept,
        departmentName: departments.find(d => d.id === selectedDept)?.name,
        selectedTypes: selectedSections,
        format: exportFormat,
        devices,
      })

      const reportOpts = {
        orgId,
        orgName,
        days: selectedDays,
        domain: selectedDomain,
        departmentId: selectedDept,
        departmentName: departments.find(d => d.id === selectedDept)?.name,
        selectedTypes: selectedSections,
        format: exportFormat,
        devices,
      }

      if (exportFormat === 'PDF') {
        await exportIIoTPDF(reportOpts, data)
        toast.success(`Executive PDF report downloaded`)
      } else if (exportFormat === 'XLSX') {
        exportIIoTXLSX(reportOpts, data)
        toast.success(`Multi-sheet Excel report downloaded`)
      } else {
        exportIIoTCSV(reportOpts, data)
        toast.success(`Structured CSV report downloaded`)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling Logic
  // ---------------------------------------------------------------------------
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
  const [draft, setDraft] = useState<Omit<SchedRow, 'id' | 'enabled'>>({
    name: '', scope: 'department', scopeId: departments[0]?.id ?? '', sequence: 'daily',
    format: 'CSV', channel: 'email', recipients: '', ...blankSchedule,
  })

  const [users, setUsers] = useState<OrgUser[]>([])
  useEffect(() => {
    if (!live) { setUsers([]); return }
    let cancelled = false
    api.users(orgId).then((r) => { if (!cancelled && r) setUsers(r as OrgUser[]) })
    return () => { cancelled = true }
  }, [live, orgId])

  const deptsOf = (u: OrgUser) => (u.department_ids?.length ? u.department_ids : u.department_id ? [u.department_id] : [])
  const mailableInDepts = (deptIds: string[]) =>
    users.filter((u) => (u.email || '').trim() && deptsOf(u).some((d) => deptIds.includes(d)))

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

  const scopeOptions = draft.scope === 'department'
    ? departments.map((d) => ({ id: d.id, name: d.name }))
    : draft.scope === 'device' ? devices.map((d) => ({ id: d.id, name: d.name })) : []

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

  const scopeName = (s: SchedRow) =>
    s.scope === 'org'
      ? 'All devices'
      : (s.scope === 'department'
          ? departments.find((d) => d.id === s.scopeId)?.name
          : devices.find((d) => d.id === s.scopeId)?.name) ?? s.scopeId

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

  const metrics = reportData?.metrics

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">Operations &amp; Compliance Reporting Studio</h1>
            <span className="text-[10px] px-2.5 py-0.5 rounded font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
              {orgName}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Reports what the fleet actually recorded — telemetry summaries, alarm history and asset health, measured against each device’s own configured limits. Not an accredited compliance audit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Scope:</span>
          <span className="text-xs font-semibold text-indigo-400 px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-800/40">
            {devices.length} Monitored Assets
          </span>
        </div>
      </div>

      {/* Fleet Executive KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Fleet Health</span>
            <Activity size={13} className="text-emerald-400" />
          </div>
          <div className="text-xl font-black text-white">
            {na(metrics?.healthIndexAvg)}<span className="text-xs text-slate-500 font-normal">/100</span>
          </div>
          <div className="text-[10px] text-slate-500 font-semibold">Mean of scored assets</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Compliance Rate</span>
            <ShieldCheck size={13} className="text-indigo-400" />
          </div>
          <div className="text-xl font-black text-indigo-400">
            {na(metrics?.complianceRate)}<span className="text-xs text-slate-500 font-normal">%</span>
          </div>
          <div className="text-[10px] text-slate-500">Assets with no alarm</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Energy Usage</span>
            <Zap size={13} className="text-amber-400" />
          </div>
          <div className="text-xl font-black text-white truncate">
            {na(metrics?.totalEnergyKWh)}<span className="text-xs text-slate-500 font-normal ml-1">kWh</span>
          </div>
          <div className="text-[10px] text-slate-500">Last {selectedDays} Days</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Scope 2 Carbon</span>
            <Leaf size={13} className="text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400 truncate">
            {na(metrics?.carbonFootprintTCO2e)}<span className="text-xs text-slate-500 font-normal ml-1">tCO₂e</span>
          </div>
          <div className="text-[10px] text-slate-500">GHG Protocol Factor</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Incidents &amp; Alarms</span>
            <AlertTriangle size={13} className="text-rose-400" />
          </div>
          <div className="text-xl font-black text-rose-400">
            {metrics?.totalAlarms ?? 2}<span className="text-xs text-slate-500 font-normal ml-1">Events</span>
          </div>
          <div className="text-[10px] text-slate-500">{metrics?.criticalAlarms ?? 1} Critical / {metrics?.resolvedAlarms ?? 1} Cleared</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Avg Response (MTTR)</span>
            <Clock size={13} className="text-indigo-400" />
          </div>
          <div className="text-xl font-black text-white">
            {na(metrics?.mttrMinutes)}<span className="text-xs text-slate-500 font-normal ml-1">min</span>
          </div>
          <div className="text-[10px] text-indigo-400">SLA Resolved</div>
        </div>
      </div>

      {/* Main Studio Grid: On-Demand Generator (Left 7 cols) & Sequence Scheduler (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: On-Demand Report Builder & Live Studio (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl p-5 space-y-5" style={surface}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileBarChart size={17} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Report Generator &amp; Scope</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-1">Period:</span>
                {TIME_RANGES.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => setSelectedDays(r.days)}
                    className={clsx(
                      'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                      selectedDays === r.days
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Domain & Department Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Asset Domain Filter
                </label>
                <select
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inset}
                >
                  {INDUSTRIAL_DOMAINS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Department Scope
                </label>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inset}
                >
                  <option value="all">Entire Organization ({devices.length} devices)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Specialized Report Sections */}
            <div className="space-y-2.5">
              <label className="block text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                Select Report Modules
              </label>
              <div className="space-y-2">
                {REPORT_SECTIONS.map((sec) => {
                  const on = selectedSections.includes(sec.id)
                  return (
                    <div
                      key={sec.id}
                      onClick={() => toggleSection(sec.id)}
                      className={clsx(
                        'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all border',
                        on
                          ? 'bg-indigo-950/20 border-indigo-500/40 shadow-sm'
                          : 'bg-[#0a0e1a] border-slate-800/80 hover:border-slate-700'
                      )}
                    >
                      <div className="text-xl shrink-0 mt-0.5">{sec.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate">{sec.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
                            {sec.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sec.desc}</p>
                      </div>
                      <div
                        className={clsx(
                          'w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-1',
                          on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700 bg-slate-900'
                        )}
                      >
                        {on && <CheckCircle size={12} />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Export Format & Trigger */}
            <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-slate-400 font-semibold uppercase">Export Format:</span>
                {(['PDF', 'XLSX', 'CSV'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setExportFormat(f)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                      exportFormat === f
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    )}
                  >
                    {f === 'PDF' && <FileText size={13} />}
                    {f === 'XLSX' && <FileSpreadsheet size={13} />}
                    {f === 'CSV' && <FileBarChart size={13} />}
                    <span>{f}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerateAndDownload}
                disabled={generating || !selectedSections.length}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold text-white shadow-md disabled:opacity-50 transition-transform active:scale-95"
                style={gradient}
              >
                <Download size={15} />
                <span>{generating ? 'Generating...' : `Generate & Download ${exportFormat}`}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Recurring Automated Schedule Manager (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl p-5 space-y-4" style={surface}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                <CalendarClock size={16} className="text-indigo-400" /> Automated Sequence
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">15-min Cron Engine</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Schedule Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Daily Substation Operations Audit"
                  className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inset}
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Target Scope</label>
                <div className="flex gap-2 mb-2">
                  {([['org', 'All Assets'], ['department', 'Department'], ['device', 'Per Device']] as const).map(([sc, label]) => (
                    <button
                      key={sc}
                      onClick={() => setDraft((d) => ({ ...d, scope: sc, scopeId: '' }))}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors',
                        draft.scope === sc ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.scope !== 'org' && (
                  <select
                    value={draft.scopeId}
                    onChange={(e) => setDraft((d) => ({ ...d, scopeId: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={inset}
                  >
                    {scopeOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Frequency</label>
                <div className="flex gap-2">
                  {SEQUENCES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setDraft((d) => ({ ...d, sequence: s }))}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors',
                        draft.sequence === s ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {draft.sequence === 'weekly' && (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Weekday</label>
                  <div className="flex gap-1">
                    {WEEKDAYS.map((w) => (
                      <button
                        key={w.v}
                        onClick={() => setDraft((d) => ({ ...d, dayOfWeek: w.v }))}
                        className={clsx(
                          'flex-1 py-1 rounded text-[10px] font-semibold',
                          draft.dayOfWeek === w.v ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                        )}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {draft.sequence === 'monthly' && (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Day of Month</label>
                  <select
                    value={draft.dayOfMonth ?? 1}
                    onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))}
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={inset}
                  >
                    {MONTH_DAYS.map((n) => (
                      <option key={n} value={n}>Day {n}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Send Time</label>
                  <div className="flex gap-1.5 items-center">
                    <select
                      value={draft.sendHour}
                      onChange={(e) => setDraft((d) => ({ ...d, sendHour: Number(e.target.value) }))}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                      style={inset}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                    <select
                      value={draft.sendMinute}
                      onChange={(e) => setDraft((d) => ({ ...d, sendMinute: Number(e.target.value) }))}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                      style={inset}
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>:{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Delivery Channel</label>
                  <div className="flex gap-1.5">
                    {([['email', 'Email'], ['telegram', 'Telegram']] as const).map(([ch, label]) => (
                      <button
                        key={ch}
                        onClick={() => setDraft((d) => ({ ...d, channel: ch }))}
                        className={clsx(
                          'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                          draft.channel === ch ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recipient Targeting */}
              {draft.channel === 'telegram' ? (
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Telegram Chat ID</label>
                  <input
                    value={draft.recipients}
                    onChange={(e) => setDraft((d) => ({ ...d, recipients: e.target.value }))}
                    placeholder="-1001234567890"
                    className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none"
                    style={inset}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Recipient Target Mode</label>
                  <div className="flex gap-1.5">
                    {([['manual', 'Direct Emails', Mail], ['department', 'Department Staff', Building2], ['users', 'Specific Users', Users]] as const).map(
                      ([m, label, Icon]) => (
                        <button
                          key={m}
                          onClick={() => setDraft((d) => ({ ...d, recipientMode: m }))}
                          className={clsx(
                            'flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors',
                            draft.recipientMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                          )}
                        >
                          <Icon size={11} /> {label}
                        </button>
                      )
                    )}
                  </div>

                  {draft.recipientMode === 'manual' && (
                    <input
                      value={draft.recipients}
                      onChange={(e) => setDraft((d) => ({ ...d, recipients: e.target.value }))}
                      placeholder="maintenance.lead@corp.net, facility@corp.net"
                      className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none"
                      style={inset}
                    />
                  )}

                  {draft.recipientMode === 'department' && (
                    <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                      {departments.map((dep) => {
                        const on = draft.recipientDeptIds.includes(dep.id)
                        const n = mailableInDepts([dep.id]).length
                        return (
                          <button
                            key={dep.id}
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                recipientDeptIds: on
                                  ? d.recipientDeptIds.filter((x) => x !== dep.id)
                                  : [...d.recipientDeptIds, dep.id],
                              }))
                            }
                            className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5"
                          >
                            <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                              <span className="w-2.5 h-2.5 rounded-sm" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }} />
                              {dep.name}
                            </span>
                            <span className="text-[10px] text-slate-500">{n} emails</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {draft.recipientMode === 'users' && (
                    <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                      {users.map((u) => {
                        const on = draft.recipientUserIds.includes(u.id)
                        const mailable = !!(u.email || '').trim()
                        return (
                          <button
                            key={u.id}
                            disabled={!mailable}
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                recipientUserIds: on
                                  ? d.recipientUserIds.filter((x) => x !== u.id)
                                  : [...d.recipientUserIds, u.id],
                              }))
                            }
                            className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5 disabled:opacity-30"
                          >
                            <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                              <span className="w-2.5 h-2.5 rounded-sm" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }} />
                              {u.name || u.id}
                            </span>
                            <span className="text-[10px] text-slate-500 truncate">{u.email || 'no email'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Dynamic Subject & Message */}
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                  Email Subject Template ({orgName})
                </label>
                <input
                  value={draft.subjectTemplate}
                  onChange={(e) => setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))}
                  placeholder={`[${orgName} Audit] {{name}} - {{sequence}} Report`}
                  className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none"
                  style={inset}
                />
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {draftRecipientCount === 0 ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={11} /> No destination set
                    </span>
                  ) : (
                    <span>{draftRecipientCount} Recipient(s) target</span>
                  )}
                </span>
                <button
                  onClick={addSchedule}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white shadow"
                  style={gradient}
                >
                  <Plus size={14} /> Add Recurring Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Recurring Schedules Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active Automated Recurring Schedules</h3>
          </div>
          <span className="text-xs text-slate-400 font-semibold">{schedules.length} Schedules Configured</span>
        </div>

        <table className="w-full text-xs" style={{ background: '#0d1117' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2433' }}>
              {['Schedule Name', 'Scope Target', 'Frequency & Timing', 'History Window', 'Delivery Channel', 'Active', 'Actions'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-slate-400 font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  No automated schedules defined. Create one in the panel above.
                </td>
              </tr>
            ) : (
              schedules.map((s) => {
                const to = toText(s)
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #1e2433' }} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 text-white font-bold">
                      {s.name}
                      {s.format !== 'CSV' && (
                        <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded text-amber-400 bg-amber-500/10 border border-amber-500/20">
                          sent as CSV
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-medium">
                      <span className="text-slate-500 capitalize">{s.scope}:</span> {scopeName(s)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 rounded-full font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
                        {whenText(s)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      Last {s.windowDays ?? (s.sequence === 'weekly' ? 7 : s.sequence === 'monthly' ? 30 : 1)}d
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      <span className="capitalize font-semibold">{s.channel}</span>
                      {to && <span className="text-slate-500 truncate max-w-xs block text-[11px]">{to}</span>}
                    </td>
                    <td className="py-3.5 px-4">
                      <button onClick={() => toggleSchedule(s.id)}>
                        {s.enabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}
                      </button>
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => removeSchedule(s.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
