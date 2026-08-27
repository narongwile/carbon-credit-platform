'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { getDepartmentsByOrg, reportSchedules as seedSchedules } from '@/lib/orgData'
import { sites as defaultSites } from '@/lib/fleetData'
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
  Car,
  MapPin,
  Sparkles,
  Send,
  Eye,
  RefreshCw,
  Play,
  Check,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const REPORT_TOKENS = [
  { key: '{{name}}', label: 'Schedule Name' },
  { key: '{{org}}', label: 'Organization' },
  { key: '{{sequence}}', label: 'Frequency' },
  { key: '{{scope}}', label: 'Scope' },
  { key: '{{domain}}', label: 'Product Domain' },
  { key: '{{date}}', label: 'Current Date' },
  { key: '{{devices}}', label: 'Devices Count' },
  { key: '{{rows}}', label: 'Reading Rows' },
]

const PRESET_SUBJECTS = [
  { label: 'Executive Operations Audit (Standard)', val: '[{{org}} Audit] {{name}} - {{sequence}} Operations Report ({{date}})' },
  { label: 'Shift Handover Digest', val: '[{{sequence}}] Fleet Operations & Compliance Digest - {{scope}}' },
  { label: 'Asset Health & Telemetry Log', val: '[{{org}} IIoT] {{domain}} Automated {{sequence}} Telemetry Log' },
]

const INDUSTRIAL_DOMAINS = [
  { id: 'all', label: 'All Fleet Assets', icon: Layers },
  { id: 'transformer', label: 'Transformers (ETERNITY)', icon: Zap },
  { id: 'carbonNode', label: 'Cold-Chain (Refrigeration)', icon: Activity },
  { id: 'bloodBox', label: 'BloodBOX (Cold Transit)', icon: ShieldCheck },
  { id: 'automobile', label: 'Formula EV Telemetry', icon: Car },
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

function ReportsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlSiteId = searchParams.get('siteId')
  const urlDomain = searchParams.get('domain')

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

  // Compute available sites for this organization's devices
  const availableSites = useMemo(() => {
    const siteMap = new Map<string, { id: string; name: string; count: number }>()
    devices.forEach((d) => {
      if (d.siteId) {
        const existing = siteMap.get(d.siteId)
        if (existing) {
          existing.count++
        } else {
          const meta = defaultSites.find((s) => s.id === d.siteId)
          siteMap.set(d.siteId, {
            id: d.siteId,
            name: meta?.name || d.siteId,
            count: 1,
          })
        }
      }
    })
    return Array.from(siteMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [devices])

  // Filter & Studio State
  const [selectedDomain, setSelectedDomain] = useState<string>(urlDomain || 'all')
  const [selectedSite, setSelectedSite] = useState<string>(urlSiteId || 'all')
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

  const activeSiteName = selectedSite !== 'all' ? availableSites.find((s) => s.id === selectedSite)?.name : undefined

  useEffect(() => {
    let cancelled = false
    buildIIoTReportData({
      orgId,
      orgName,
      days: selectedDays,
      domain: selectedDomain,
      siteId: selectedSite,
      siteName: activeSiteName,
      departmentId: selectedDept,
      selectedTypes: selectedSections,
      format: exportFormat,
      devices,
    }).then((res) => {
      if (!cancelled) setReportData(res)
    })
    return () => { cancelled = true }
  }, [orgId, orgName, selectedDays, selectedDomain, selectedSite, activeSiteName, selectedDept, selectedSections, exportFormat, devices])

  // Cold-Chain Temperature Summary (MKT) is strictly for refrigeration/bloodBox assets.
  // Never show or apply it for transformers (ETERNITY) or Formula EV telemetry.
  const visibleSections = useMemo(() => {
    return REPORT_SECTIONS.filter((sec) => {
      if (sec.id === 'coldchain') {
        if (selectedDomain === 'transformer' || selectedDomain === 'automobile') return false
        if (selectedDomain === 'all') {
          return devices.some((d) => d.domain === 'carbonNode' || d.domain === 'bloodBox')
        }
      }
      return true
    })
  }, [selectedDomain, devices])

  // Automatically drop 'coldchain' from selected modules when switching to transformer or automobile
  useEffect(() => {
    if (selectedDomain === 'transformer' || selectedDomain === 'automobile') {
      setSelectedSections((prev) => prev.filter((x) => x !== 'coldchain'))
    }
  }, [selectedDomain])

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
      const reportOpts = {
        orgId,
        orgName,
        days: selectedDays,
        domain: selectedDomain,
        siteId: selectedSite,
        siteName: activeSiteName,
        departmentId: selectedDept,
        departmentName: departments.find(d => d.id === selectedDept)?.name,
        selectedTypes: selectedSections,
        format: exportFormat,
        devices,
      }
      const data = reportData || await buildIIoTReportData(reportOpts)

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
    id: string; name: string; scope: 'org' | 'site' | 'department' | 'device'; scopeId: string
    domain: string
    sequence: ReportSequence; format: 'PDF' | 'XLSX' | 'CSV'; channel: 'email' | 'telegram'
    recipients: string; enabled: boolean
    sendHour: number; sendMinute: number
    dayOfWeek: number | string | null
    dayOfMonth: number | string | null
    windowDays: number | null
    recipientMode: RecipientMode; recipientDeptIds: string[]; recipientUserIds: string[]
    subjectTemplate: string; bodyTemplate: string
  }

  const [activeTab, setActiveTab] = useState<'studio' | 'sequence'>('studio')
  const [previewChannel, setPreviewChannel] = useState<'email' | 'telegram'>('email')
  const [testingScheduleId, setTestingScheduleId] = useState<string | null>(null)

  const blankSchedule = {
    domain: 'all',
    sendHour: 7, sendMinute: 0, dayOfWeek: '1' as number | string | null, dayOfMonth: '1' as number | string | null, windowDays: null as number | null,
    recipientMode: 'manual' as RecipientMode, recipientDeptIds: [] as string[], recipientUserIds: [] as string[],
    subjectTemplate: '', bodyTemplate: '',
  }

  const seedRows: SchedRow[] = seedSchedules.map((r) => ({
    id: r.id, name: r.name, scope: r.scope, scopeId: r.scopeId, domain: 'all', sequence: r.sequence,
    format: r.format, channel: 'email', recipients: '', enabled: r.enabled, ...blankSchedule,
  }))

  const [schedules, setSchedules] = useState<SchedRow[]>(seedRows)
  const [draft, setDraft] = useState<Omit<SchedRow, 'id' | 'enabled'>>({
    name: '', scope: 'department', scopeId: departments[0]?.id ?? '', domain: 'all', sequence: 'daily',
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
        domain: (r.domain as string) || 'all',
        sequence: r.sequence as ReportSequence, format: r.format, channel: r.channel ?? 'email',
        recipients: r.recipients ?? '', enabled: !!r.enabled,
        sendHour: r.send_hour ?? 7, sendMinute: r.send_minute ?? 0,
        dayOfWeek: r.day_of_week ?? '1', dayOfMonth: r.day_of_month ?? '1',
        windowDays: r.window_days ?? null,
        recipientMode: (r.recipient_mode ?? 'manual') as RecipientMode,
        recipientDeptIds: csv(r.recipient_dept_ids), recipientUserIds: csv(r.recipient_user_ids),
        subjectTemplate: r.subject_template ?? '', bodyTemplate: r.body_template ?? '',
      })))
    })
    return () => { cancelled = true }
  }, [orgId])

  const draftDeviceIds = useMemo(() =>
    draft.scopeId.split(',').map((x) => x.trim()).filter(Boolean),
    [draft.scopeId]
  )

  const draftWeeklyDays = useMemo(() =>
    String(draft.dayOfWeek ?? '1').split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= 7),
    [draft.dayOfWeek]
  )

  const draftMonthlyDays = useMemo(() =>
    String(draft.dayOfMonth ?? '1').split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= 28),
    [draft.dayOfMonth]
  )

  const insertToken = (token: string, target: 'subject' | 'body') => {
    if (target === 'subject') {
      setDraft((d) => ({ ...d, subjectTemplate: d.subjectTemplate ? `${d.subjectTemplate} ${token}` : token }))
    } else {
      setDraft((d) => ({ ...d, bodyTemplate: d.bodyTemplate ? `${d.bodyTemplate} ${token}` : token }))
    }
  }

  const previewSubject = useMemo(() => {
    const raw = draft.subjectTemplate || `[${orgName} Audit] {{name}} - {{sequence}} Operations Report`
    const devCount = draft.scope === 'device'
      ? draftDeviceIds.length || 1
      : draft.scope === 'site'
      ? availableSites.find(s => s.id === draft.scopeId)?.count ?? devices.length
      : devices.length
    return raw
      .replace(/{{name}}/g, draft.name || 'Daily Operations Audit')
      .replace(/{{org}}/g, orgName)
      .replace(/{{sequence}}/g, draft.sequence)
      .replace(/{{scope}}/g, draft.scope)
      .replace(/{{domain}}/g, INDUSTRIAL_DOMAINS.find(d => d.id === draft.domain)?.label || draft.domain || 'All Assets')
      .replace(/{{date}}/g, new Date().toISOString().slice(0, 10))
      .replace(/{{devices}}/g, String(devCount))
      .replace(/{{rows}}/g, String(devCount * 24))
  }, [draft.subjectTemplate, draft.name, draft.sequence, draft.scope, draft.domain, draftDeviceIds, draft.scopeId, availableSites, devices, orgName])

  const previewBody = useMemo(() => {
    const raw = draft.bodyTemplate || `Automated {{sequence}} {{scope}} operations report generated for ${orgName}. Attached CSV file contains aggregated telemetry readings, excursion counts, and SLA compliance metrics.`
    const devCount = draft.scope === 'device'
      ? draftDeviceIds.length || 1
      : draft.scope === 'site'
      ? availableSites.find(s => s.id === draft.scopeId)?.count ?? devices.length
      : devices.length
    return raw
      .replace(/{{name}}/g, draft.name || 'Daily Operations Audit')
      .replace(/{{org}}/g, orgName)
      .replace(/{{sequence}}/g, draft.sequence)
      .replace(/{{scope}}/g, draft.scope)
      .replace(/{{domain}}/g, INDUSTRIAL_DOMAINS.find(d => d.id === draft.domain)?.label || draft.domain || 'All Assets')
      .replace(/{{date}}/g, new Date().toISOString().slice(0, 10))
      .replace(/{{devices}}/g, String(devCount))
  }, [draft.bodyTemplate, draft.name, draft.sequence, draft.scope, draft.domain, draftDeviceIds, draft.scopeId, availableSites, devices, orgName])

  const testScheduleRun = async (sched: SchedRow) => {
    setTestingScheduleId(sched.id)
    try {
      await new Promise(r => setTimeout(r, 600))
      toast.success(`Test report dispatched for "${sched.name}" to ${sched.channel.toUpperCase()}!`, { icon: '⚡' })
    } catch {
      toast.error('Test dispatch failed')
    } finally {
      setTestingScheduleId(null)
    }
  }

  const scopeOptions = draft.scope === 'site'
    ? availableSites.map((s) => ({ id: s.id, name: s.name }))
    : draft.scope === 'department'
    ? departments.map((d) => ({ id: d.id, name: d.name }))
    : draft.scope === 'device' ? devices.map((d) => ({ id: d.id, name: d.name })) : []

  const persist = (r: SchedRow) => api.saveSchedule({
    id: r.id, orgId, name: r.name, scope: r.scope, scopeId: r.scopeId || undefined,
    domain: r.domain || 'all',
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
    if (draft.scope === 'device' && !draft.scopeId.trim()) {
      toast.error('Select at least one device')
      return
    }
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

  const scopeName = (s: SchedRow) => {
    if (s.scope === 'org') return 'All devices'
    if (s.scope === 'site') return availableSites.find((st) => st.id === s.scopeId)?.name ?? s.scopeId
    if (s.scope === 'department') return departments.find((d) => d.id === s.scopeId)?.name ?? s.scopeId
    const ids = String(s.scopeId || '').split(',').map((x) => x.trim()).filter(Boolean)
    if (ids.length === 0) return 'All devices'
    if (ids.length === 1) return devices.find((d) => d.id === ids[0])?.name ?? ids[0]
    const names = ids.map((id) => devices.find((d) => d.id === id)?.name ?? id)
    return `${ids.length} Devices: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
  }

  const whenText = (s: SchedRow) => {
    const t = `${String(s.sendHour).padStart(2, '0')}:${String(s.sendMinute).padStart(2, '0')}`
    if (s.sequence === 'weekly') {
      const dows = String(s.dayOfWeek ?? '1').split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= 7)
      const labels = dows.map((d) => WEEKDAYS.find((w) => w.v === d)?.label ?? `Day ${d}`).join(', ')
      return `${labels || 'Mon'} ${t}`
    }
    if (s.sequence === 'monthly') {
      const doms = String(s.dayOfMonth ?? '1').split(',').map((x) => x.trim()).filter(Boolean)
      return `day ${doms.join(', ') || '1'} · ${t}`
    }
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
            Reports what the fleet actually recorded — telemetry summaries, alarm history and asset health, measured against each device’s own configured limits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Scope:</span>
          <span className="text-xs font-semibold text-indigo-400 px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-800/40">
            {devices.length} Monitored Assets
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('studio')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all',
            activeTab === 'studio'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <FileBarChart size={14} className={activeTab === 'studio' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>On-Demand Report Studio</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
            Interactive Studio
          </span>
        </button>

        <button
          onClick={() => setActiveTab('sequence')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all',
            activeTab === 'sequence'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <CalendarClock size={14} className={activeTab === 'sequence' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Automated Sequences</span>
          {schedules.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {schedules.filter((s) => s.enabled).length} Active Crons
            </span>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ON-DEMAND REPORT STUDIO                                            */}
      {/* ========================================================================= */}
      {activeTab === 'studio' && (
        <div className="space-y-6">
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

          {/* Full-Width Report Generator & Scope */}
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

            {/* Domain, Site & Department Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1">
                  <Building2 size={12} className="text-indigo-400" />
                  Site Facility Scope
                </label>
                <select
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  className={`w-full rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer transition-all ${
                    selectedSite !== 'all'
                      ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-500/60 ring-1 ring-indigo-500/40'
                      : 'text-white'
                  }`}
                  style={selectedSite === 'all' ? inset : undefined}
                >
                  <option value="all">All Sites ({devices.length} assets)</option>
                  {availableSites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.count} assets)</option>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleSections.map((sec) => {
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

          {/* Live Parameter Telemetry Preview Table */}
          {reportData?.summaries && reportData.summaries.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-indigo-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Asset Telemetry &amp; Excursion Preview</h3>
                </div>
                <span className="text-[11px] text-slate-400">{reportData.summaries.length} Parameter Series Monitored</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs" style={{ background: '#0d1117' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e2433' }} className="text-slate-400 font-semibold uppercase text-[10px]">
                      <th className="py-2.5 px-4 text-left">Asset / Node</th>
                      <th className="py-2.5 px-4 text-left">Parameter</th>
                      <th className="py-2.5 px-4 text-right">Samples</th>
                      <th className="py-2.5 px-4 text-right">Min</th>
                      <th className="py-2.5 px-4 text-right">Avg</th>
                      <th className="py-2.5 px-4 text-right">Max</th>
                      <th className="py-2.5 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.summaries.map((s, idx) => (
                      <tr key={`${s.nodeId}-${s.paramKey}-${idx}`} style={{ borderBottom: '1px solid #1e2433' }} className="hover:bg-white/[0.02]">
                        <td className="py-2 px-4 text-white font-medium">
                          {s.deviceName} <span className="text-slate-500 font-mono text-[10px]">({s.nodeId})</span>
                        </td>
                        <td className="py-2 px-4 text-slate-300">
                          {s.paramLabel} <span className="text-slate-500 font-mono">({s.unit})</span>
                        </td>
                        <td className="py-2 px-4 text-right font-mono text-slate-400">{s.samples}</td>
                        <td className="py-2 px-4 text-right font-mono text-slate-300">{Number(s.min).toFixed(1)}</td>
                        <td className="py-2 px-4 text-right font-mono text-white font-semibold">{Number(s.avg).toFixed(1)}</td>
                        <td className="py-2 px-4 text-right font-mono text-slate-300">{Number(s.max).toFixed(1)}</td>
                        <td className="py-2 px-4 text-center">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-[9px] font-bold',
                            s.status === 'NORMAL' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            s.status === 'WARNING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          )}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AUTOMATED SEQUENCES & CRON DELIVERY                                */}
      {/* ========================================================================= */}
      {activeTab === 'sequence' && (
        <div className="space-y-6">
          {/* Top Section: Form (7 cols) & Live Simulator (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Schedule Configuration Form (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="rounded-xl p-5 space-y-4" style={surface}>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={16} className="text-indigo-400" />
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Automated Sequence Scheduler</h3>
                      <p className="text-[11px] text-slate-400">Configure recurring cron report dispatch with multi-device and multi-day cadence</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-mono">
                    15-min Cron Engine (DB_TZ +07:00)
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Schedule Name */}
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

                  {/* Product / Asset Domain Filter */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                      Product Domain Filter (Multi-Product Org)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {INDUSTRIAL_DOMAINS.map((dm) => {
                        const on = (draft.domain || 'all') === dm.id
                        return (
                          <button
                            key={dm.id}
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, domain: dm.id }))}
                            className={clsx(
                              'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5',
                              on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                            )}
                          >
                            <dm.icon size={12} />
                            <span>{dm.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Target Scope */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Target Scope</label>
                    <div className="flex gap-1.5 mb-2">
                      {([['org', 'All Assets'], ['site', 'Site Facility'], ['department', 'Department'], ['device', 'Per Device']] as const).map(([sc, label]) => (
                        <button
                          key={sc}
                          onClick={() => setDraft((d) => ({ ...d, scope: sc, scopeId: '' }))}
                          className={clsx(
                            'flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors',
                            draft.scope === sc ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {draft.scope === 'device' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-slate-300">
                            Select Monitored Devices ({draftDeviceIds.length} of {devices.length} selected)
                          </span>
                          <div className="flex gap-2 text-[10px]">
                            <button
                              type="button"
                              onClick={() => setDraft((d) => ({ ...d, scopeId: devices.map((x) => x.id).join(',') }))}
                              className="text-indigo-400 hover:text-indigo-300 font-semibold"
                            >
                              Select All
                            </button>
                            <span className="text-slate-600">·</span>
                            <button
                              type="button"
                              onClick={() => setDraft((d) => ({ ...d, scopeId: '' }))}
                              className="text-slate-500 hover:text-slate-400 font-semibold"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                          {devices.map((dev) => {
                            const on = draftDeviceIds.includes(dev.id)
                            return (
                              <button
                                key={dev.id}
                                type="button"
                                onClick={() => {
                                  const next = on ? draftDeviceIds.filter((x) => x !== dev.id) : [...draftDeviceIds, dev.id]
                                  setDraft((d) => ({ ...d, scopeId: next.join(',') }))
                                }}
                                className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5 transition-colors"
                              >
                                <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                                  <span className="w-2.5 h-2.5 rounded-sm flex items-center justify-center text-[8px]" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>
                                    {on && '✓'}
                                  </span>
                                  {dev.name || dev.id}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">{dev.id}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : draft.scope !== 'org' ? (
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
                    ) : null}
                  </div>

                  {/* Frequency */}
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Frequency Cadence</label>
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
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          Weekdays ({draftWeeklyDays.length} selected)
                        </label>
                        <span className="text-[9px] text-indigo-400 font-medium">Multi-day enabled</span>
                      </div>
                      <div className="flex gap-1">
                        {WEEKDAYS.map((w) => {
                          const on = draftWeeklyDays.includes(w.v)
                          return (
                            <button
                              key={w.v}
                              type="button"
                              onClick={() => {
                                let next = on ? draftWeeklyDays.filter((x) => x !== w.v) : [...draftWeeklyDays, w.v]
                                if (!next.length) next = [w.v]
                                setDraft((d) => ({ ...d, dayOfWeek: next.sort((a, b) => a - b).join(',') }))
                              }}
                              className={clsx(
                                'flex-1 py-1 rounded text-[10px] font-semibold transition-colors',
                                on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                              )}
                            >
                              {w.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {draft.sequence === 'monthly' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          Days of Month ({draftMonthlyDays.length} selected)
                        </label>
                        <div className="flex gap-1.5 text-[9px] text-indigo-400 font-medium">
                          <button
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, dayOfMonth: '1,15' }))}
                            className="hover:underline"
                          >
                            1st &amp; 15th
                          </button>
                          <span className="text-slate-600">·</span>
                          <button
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, dayOfMonth: '1' }))}
                            className="hover:underline"
                          >
                            1st only
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-7 gap-1 max-h-28 overflow-y-auto p-1.5 rounded-lg" style={inset}>
                        {MONTH_DAYS.map((n) => {
                          const on = draftMonthlyDays.includes(n)
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => {
                                let next = on ? draftMonthlyDays.filter((x) => x !== n) : [...draftMonthlyDays, n]
                                if (!next.length) next = [n]
                                setDraft((d) => ({ ...d, dayOfMonth: next.sort((a, b) => a - b).join(',') }))
                              }}
                              className={clsx(
                                'py-1 rounded text-[10px] font-semibold transition-colors text-center',
                                on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800/80'
                              )}
                            >
                              {n}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Send Time & Delivery Channel */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                        Send Time (Bangkok +07:00)
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={draft.sendHour}
                          onChange={(e) => setDraft((d) => ({ ...d, sendHour: Number(e.target.value) }))}
                          className="flex-1 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                          style={inset}
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                          ))}
                        </select>
                        <select
                          value={draft.sendMinute}
                          onChange={(e) => setDraft((d) => ({ ...d, sendMinute: Number(e.target.value) }))}
                          className="w-16 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                          style={inset}
                        >
                          {[0, 15, 30, 45].map((m) => (
                            <option key={m} value={m}>:{String(m).padStart(2, '0')}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">Delivery Channel</label>
                      <div className="flex gap-1">
                        {(['email', 'telegram'] as const).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, channel: ch }))}
                            className={clsx(
                              'flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors',
                              draft.channel === ch ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                            )}
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Recipient Targeting */}
                  {draft.channel === 'telegram' ? (
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                        Telegram Chat / Channel ID
                      </label>
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
                              type="button"
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
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-semibold text-slate-300">
                              Target Departments ({draft.recipientDeptIds.length} of {departments.length} selected)
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDraft((d) => ({ ...d, recipientDeptIds: departments.map((x) => x.id) }))}
                                className="text-indigo-400 hover:text-indigo-300 font-semibold"
                              >
                                Select All
                              </button>
                              <span className="text-slate-600">·</span>
                              <button
                                type="button"
                                onClick={() => setDraft((d) => ({ ...d, recipientDeptIds: [] }))}
                                className="text-slate-500 hover:text-slate-400 font-semibold"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                            {departments.map((dep) => {
                              const on = draft.recipientDeptIds.includes(dep.id)
                              const n = mailableInDepts([dep.id]).length
                              return (
                                <button
                                  key={dep.id}
                                  type="button"
                                  onClick={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      recipientDeptIds: on
                                        ? d.recipientDeptIds.filter((x) => x !== dep.id)
                                        : [...d.recipientDeptIds, dep.id],
                                    }))
                                  }
                                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5 transition-colors"
                                >
                                  <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                                    <span className="w-2.5 h-2.5 rounded-sm flex items-center justify-center text-[8px]" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>
                                      {on && '✓'}
                                    </span>
                                    {dep.name}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono">{n} staff emails</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {draft.recipientMode === 'users' && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-semibold text-slate-300">
                              Target Staff Users ({draft.recipientUserIds.length} of {users.length} selected)
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDraft((d) => ({ ...d, recipientUserIds: users.filter((u) => (u.email || '').trim()).map((x) => x.id) }))}
                                className="text-indigo-400 hover:text-indigo-300 font-semibold"
                              >
                                Select All
                              </button>
                              <span className="text-slate-600">·</span>
                              <button
                                type="button"
                                onClick={() => setDraft((d) => ({ ...d, recipientUserIds: [] }))}
                                className="text-slate-500 hover:text-slate-400 font-semibold"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                            {users.map((u) => {
                              const on = draft.recipientUserIds.includes(u.id)
                              const mailable = !!(u.email || '').trim()
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  disabled={!mailable}
                                  onClick={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      recipientUserIds: on
                                        ? d.recipientUserIds.filter((x) => x !== u.id)
                                        : [...d.recipientUserIds, u.id],
                                    }))
                                  }
                                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5 disabled:opacity-30 transition-colors"
                                >
                                  <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                                    <span className="w-2.5 h-2.5 rounded-sm flex items-center justify-center text-[8px]" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>
                                      {on && '✓'}
                                    </span>
                                    {u.name || u.id}
                                  </span>
                                  <span className="text-[10px] text-slate-500 truncate">{u.email || 'no email'}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Email & SOP Template Configurator (matching admin/notifications) */}
                  <div className="p-3.5 rounded-xl border border-indigo-900/40 bg-[#0a0e1a]/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Sparkles size={13} className="text-indigo-400" />
                        <span>Email Subject &amp; Custom Message Template</span>
                      </div>
                      <span className="text-[10px] text-indigo-400 font-mono">Dynamic Tokens</span>
                    </div>

                    {/* Presets */}
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preset Subject Wording</label>
                      <select
                        onChange={(e) => {
                          if (e.target.value) setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))
                        }}
                        className="w-full rounded-lg px-2.5 py-1.5 text-xs text-slate-300 outline-none"
                        style={inset}
                      >
                        <option value="">Choose a corporate preset...</option>
                        {PRESET_SUBJECTS.map((ps) => (
                          <option key={ps.label} value={ps.val}>{ps.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Dynamic Token Pills */}
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                        Click Token to Insert
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {REPORT_TOKENS.map((tk) => (
                          <button
                            key={tk.key}
                            type="button"
                            onClick={() => insertToken(tk.key, 'subject')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-medium text-indigo-300 bg-indigo-950/70 border border-indigo-700/50 hover:bg-indigo-900/80 transition-colors"
                            title={`Insert ${tk.key} (${tk.label})`}
                          >
                            + {tk.key}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Subject Input */}
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                        Subject Line Template
                      </label>
                      <input
                        value={draft.subjectTemplate}
                        onChange={(e) => setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))}
                        placeholder={`[${orgName} Audit] {{name}} - {{sequence}} Report`}
                        className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        style={inset}
                      />
                    </div>

                    {/* Custom Message / Body Note */}
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                        Custom Message / SOP Operational Note
                      </label>
                      <textarea
                        rows={2}
                        value={draft.bodyTemplate}
                        onChange={(e) => setDraft((d) => ({ ...d, bodyTemplate: e.target.value }))}
                        placeholder="e.g. Please review the attached CSV report and confirm compliance before shift handover."
                        className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
                        style={inset}
                      />
                    </div>
                  </div>

                  {/* Add Button */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                    <span className="text-[11px] text-slate-400">
                      Recipients: <span className="font-bold text-white">{draftRecipientCount}</span> destination(s)
                    </span>
                    <button
                      onClick={addSchedule}
                      className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
                      style={gradient}
                    >
                      <Plus size={15} /> Save &amp; Activate Sequence
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Live Delivery Simulator & Preview (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-xl p-5 space-y-4" style={surface}>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Eye size={16} className="text-indigo-400" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Live Delivery Simulator</h3>
                  </div>
                  <div className="flex gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setPreviewChannel('email')}
                      className={clsx(
                        'px-2.5 py-1 rounded font-semibold transition-colors',
                        previewChannel === 'email' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                      )}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewChannel('telegram')}
                      className={clsx(
                        'px-2.5 py-1 rounded font-semibold transition-colors',
                        previewChannel === 'telegram' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
                      )}
                    >
                      Telegram
                    </button>
                  </div>
                </div>

                {previewChannel === 'email' ? (
                  <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#080c16] text-xs font-sans">
                    {/* Simulated Email Client Header */}
                    <div className="p-3 bg-[#0d121f] border-b border-slate-800/80 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span><strong>From:</strong> ONEOPS Operations &lt;reports@oneops.io&gt;</span>
                        <span className="font-mono text-indigo-400">SMTP TLS Verified</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        <strong>To:</strong> {draft.recipients || (draft.recipientMode === 'department' ? `${draft.recipientDeptIds.length} Selected Departments` : `${draft.recipientUserIds.length} Selected Staff`)}
                      </div>
                      <div className="text-xs font-bold text-white pt-1 truncate">
                        <strong>Subject:</strong> {previewSubject}
                      </div>
                    </div>

                    {/* Email Body Card */}
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                        <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center font-black text-[10px] text-white">
                          {orgName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-white">{orgName} Fleet Monitoring</div>
                          <div className="text-[9px] text-slate-400">Automated Industrial Report Delivery</div>
                        </div>
                      </div>

                      <div className="text-slate-300 text-[11px] leading-relaxed">
                        {previewBody}
                      </div>

                      <div className="grid grid-cols-2 gap-2 p-2 rounded bg-slate-900/60 border border-slate-800/80 text-[10px]">
                        <div>
                          <span className="text-slate-500">Frequency:</span> <span className="text-indigo-300 font-semibold capitalize">{draft.sequence}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Product:</span> <span className="text-white font-semibold">{INDUSTRIAL_DOMAINS.find(d => d.id === draft.domain)?.label}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Scope:</span> <span className="text-slate-300 font-medium capitalize">{draft.scope}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Timing:</span> <span className="text-slate-300 font-mono">{String(draft.sendHour).padStart(2,'0')}:{String(draft.sendMinute).padStart(2,'0')} ICT</span>
                        </div>
                      </div>

                      {/* Attachment Card */}
                      <div className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-950/20 flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate">
                          <FileBarChart size={16} className="text-indigo-400 shrink-0" />
                          <div className="truncate">
                            <div className="text-[11px] font-bold text-white truncate">
                              {draft.name ? `${draft.name.replace(/\s+/g, '_')}.csv` : 'operations_audit.csv'}
                            </div>
                            <div className="text-[9px] text-slate-400">Structured RFC-4180 CSV with Corporate Metadata Header</div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 font-bold">CSV</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Telegram Simulated Bubble */
                  <div className="rounded-xl p-4 border border-slate-800 bg-[#080c16] space-y-3 text-xs">
                    <div className="flex items-center gap-2 text-[10px] text-sky-400 font-semibold">
                      <span>✈️ Telegram Bot Dispatch</span>
                      <span className="text-slate-500">· Channel {draft.recipients || '@channel_or_chat_id'}</span>
                    </div>

                    <div className="p-3 rounded-2xl rounded-tl-none bg-[#17212b] border border-sky-900/30 space-y-2 text-white">
                      <div className="font-bold text-sky-300">📊 {orgName} — {draft.name || 'Automated Operations Digest'}</div>
                      <p className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {previewBody}
                      </p>
                      <div className="text-[10px] text-slate-400 border-t border-slate-700/60 pt-1.5 flex justify-between">
                        <span>🗓 Cadence: {draft.sequence}</span>
                        <span>⏰ {String(draft.sendHour).padStart(2, '0')}:{String(draft.sendMinute).padStart(2, '0')} ICT</span>
                      </div>
                    </div>

                    <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 flex items-center gap-2">
                      <FileBarChart size={14} className="text-sky-400" />
                      <span>Attached document: {draft.name ? `${draft.name.replace(/\s+/g, '_')}.csv` : 'report.csv'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active Recurring Schedules Table (Full 12 cols) */}
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
                  {['Schedule Name', 'Product Domain', 'Scope Target', 'Frequency & Timing', 'History Window', 'Delivery Channel', 'Active', 'Test Dispatch', 'Actions'].map((h) => (
                    <th key={h} className="py-3 px-4 text-left text-slate-400 font-semibold uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No automated schedules defined. Create one in the form above.
                    </td>
                  </tr>
                ) : (
                  schedules.map((s) => {
                    const to = toText(s)
                    const isTesting = testingScheduleId === s.id
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
                        <td className="py-3.5 px-4">
                          <span className="text-[10px] px-2 py-0.5 rounded font-medium text-slate-300 bg-slate-800 border border-slate-700">
                            {INDUSTRIAL_DOMAINS.find((d) => d.id === s.domain)?.label ?? s.domain ?? 'All Assets'}
                          </span>
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
                            disabled={isTesting}
                            onClick={() => testScheduleRun(s)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 hover:bg-indigo-900/80 transition-colors disabled:opacity-50"
                            title="Trigger immediate simulated test dispatch"
                          >
                            <Play size={11} className={isTesting ? 'animate-spin' : ''} />
                            <span>{isTesting ? 'Sending...' : 'Test'}</span>
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
      )}
    </div>
  )
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsPageContent />
    </Suspense>
  )
}
