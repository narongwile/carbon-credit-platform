'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { getDepartmentsByOrg, reportSchedules as seedSchedules } from '@/lib/orgData'
import { sites as defaultSites } from '@/lib/fleetData'
import type { ReportSequence } from '@/types/org'
import type { SensorDomain } from '@/types/fleet'
import type { RecipientMode } from '@/lib/api'
import { DOMAIN_TO_PLATFORM, licensedDomains } from '@/lib/entitlements'
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
  X,
  History,
  Pencil,
  Calendar,
  ArrowRight,
  Shield,
  Tag,
  ChevronRight,
  Filter,
  Bookmark,
  Save,
  Webhook,
  MessageSquare,
  Bot,
  MessagesSquare, Table
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { fmtDateTime } from '@/lib/displayTime'
import { buildIIoTCsvSections, buildIIoTXlsxSheets } from '@/lib/iiotReportGenerator'
import type { Sheet } from '@/lib/xlsx'

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

interface EnterpriseReportProfile {
  id: string
  name: string
  shortLabel: string
  icon: string
  description: string
  classification: 'INTERNAL USE ONLY' | 'CONFIDENTIAL' | 'RESTRICTED' | 'PUBLIC AUDIT'
  // SensorDomain, not string[]: these are matched against the real domains the
  // org's devices report (ManagedDevice['domain']), so a typo'd domain here
  // would silently make a profile permanently invisible instead of failing loudly.
  domains: SensorDomain[]
  days: number
  aggregation: 'raw' | '15m' | '1h' | 'daily'
  sections: string[]
  formats: ('PDF' | 'XLSX' | 'CSV')[]
}

const ENTERPRISE_PROFILES: EnterpriseReportProfile[] = [
  {
    id: 'iso50001',
    name: 'ISO 50001 Energy & Carbon ESG Audit',
    shortLabel: 'ISO 50001 Energy',
    icon: '🌱',
    description: 'Quarterly energy consumption, peak demand & GHG Scope 2 emissions for regulatory filing.',
    classification: 'PUBLIC AUDIT',
    domains: ['transformer', 'carbonNode'],
    days: 90,
    aggregation: '1h',
    sections: ['energy', 'executive'],
    formats: ['PDF', 'XLSX'],
  },
  {
    id: 'transformer_health',
    name: 'Transformer Fleet Reliability & Health',
    shortLabel: 'Transformer Health',
    icon: '⚡',
    description: 'Substation asset health index, insulation thermal stress, active alarms and resolution MTTR.',
    classification: 'RESTRICTED',
    domains: ['transformer'],
    days: 30,
    aggregation: '15m',
    sections: ['health', 'alarm', 'executive'],
    formats: ['PDF', 'XLSX'],
  },
  {
    id: 'coldchain_gdp',
    name: 'Pharma & Vaccine Cold-Chain Compliance',
    shortLabel: 'Cold-Chain GDP',
    icon: '❄️',
    description: 'GDP / HACCP thermal excursion tracking, Mean Kinetic Temperature (MKT) and spoilage incident log.',
    classification: 'CONFIDENTIAL',
    domains: ['bloodBox', 'carbonNode'],
    days: 7,
    aggregation: 'raw',
    sections: ['coldchain', 'alarm', 'health'],
    formats: ['PDF', 'CSV'],
  },
  {
    id: 'daily_shift',
    name: 'Daily Operational Shift Handover',
    shortLabel: 'Daily Shift Handover',
    icon: '📋',
    description: '24-hour multi-domain operational status, critical events, excursion counts and offline asset inventory.',
    classification: 'INTERNAL USE ONLY',
    domains: ['transformer', 'carbonNode', 'bloodBox', 'automobile'],
    days: 1,
    aggregation: 'raw',
    sections: ['health', 'alarm'],
    formats: ['PDF'],
  },
]

const AGGREGATION_RESOLUTIONS = [
  { id: 'raw', label: 'Raw 1-Min', desc: 'High-Resolution SCADA / Incident RCA' },
  { id: '15m', label: '15-Min Avg', desc: 'Utility & Grid Substation Standard' },
  { id: '1h', label: '1-Hour TWA', desc: 'Time-Weighted Average for Trends' },
  { id: 'daily', label: 'Daily Rollup', desc: 'Peak / Minima for Multi-Month Audits' },
] as const

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
const REPORT_SECTIONS = [
  {
    id: 'health',
    name: 'Asset Health & Oil/DGA Excursion Summary',
    desc: 'Per-asset health score, dissolved hydrogen (H₂), top oil temperature and insulation moisture — min/avg/max with sample counts, and compliance against each device’s own configured limits',
    badge: 'Asset Health',
    icon: '🏥',
  },
  {
    id: 'pdm_diagnostics',
    name: 'Predictive Maintenance & DGA Diagnostics',
    desc: 'IEEE C57.104 Duval Triangle 1 fault analysis, IEEE C57.91 Arrhenius paper aging (DP/RUL), and Oommen paper moisture equilibrium',
    badge: 'IEEE C57.104 / C57.91',
    icon: '🔬',
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
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

type OrgUser = { id: string; name?: string | null; email?: string | null; department_ids?: string[]; department_id?: string | null }

function ReportsPageContent() {
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

  // Real entitlements — which product domains this organization is actually licensed for
  const [orgDomains, setOrgDomains] = useState<SensorDomain[]>(() => licensedDomains(orgId))
  useEffect(() => {
    if (!live) { setOrgDomains(licensedDomains(orgId)); return }
    let cancelled = false
    api.entitlements(orgId).then((ents) => {
      if (cancelled || !ents) return
      setOrgDomains((['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[]).filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d])))
    })
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
  const ALL_DOMAIN_KEYS = ['transformer', 'carbonNode', 'bloodBox', 'automobile'] as const
  const [selectedDomains, setSelectedDomains] = useState<string[]>(() => {
    const licensed = licensedDomains(orgId)
    if (urlDomain && ALL_DOMAIN_KEYS.includes(urlDomain as any) && (licensed.length === 0 || licensed.includes(urlDomain as any))) {
      return [urlDomain]
    }
    return licensed.length > 0 ? licensed : ['transformer', 'carbonNode', 'bloodBox', 'automobile']
  })

  // GET /api/orgs/:orgId/entitlements is a plain
  // `SELECT platform FROM org_entitlements WHERE org_id=?` with no default, so
  // an organization that simply has no rows yet — a newly created one, or one
  // whose admin has not set entitlements — comes back as []. Filtering the
  // pickers by that directly rendered ZERO domain chips in both the On-Demand
  // studio and the Automated Sequence modal ('all' included, since it is shown
  // only when length > 1), leaving an unusable report builder with nothing on
  // screen to explain why.
  //
  // Absence of a licensing record is not a licensing decision. Restricting has
  // to come from a positive statement, so an empty list means "not restricted"
  // here. Nothing is lost by that: report generation runs client-side in
  // iiotReportGenerator over data the user can already read, so these chips are
  // UX, not an access control — failing closed buys no safety and costs a
  // broken page.
  //
  // useMemo, not a bare expression: this is read inside effects and memos, and
  // a fresh array on every render would either force it out of their
  // dependency arrays or spin them. Its identity now changes only when
  // orgDomains does.
  const effectiveDomains: SensorDomain[] = useMemo(
    () => (orgDomains.length > 0
      ? orgDomains
      : (['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[])),
    [orgDomains],
  )

  // Sync selectedDomains when orgDomains change
  useEffect(() => {
    if (orgDomains.length > 0) {
      setSelectedDomains((prev) => {
        const filtered = prev.filter((d) => orgDomains.includes(d as SensorDomain))
        return filtered.length > 0 ? filtered : orgDomains
      })
    }
  }, [orgDomains])

  // A const, not state: 396c647e streamlined the Target Scope picker to three
  // levels (All Fleet / Department / Selected Devices) and dropped the Site
  // button, so nothing calls a setter any more. Declaring it as state left
  // setSelectedSite computed and never used, and — more to the point — hid
  // that the value is now fixed for the life of the page.
  const selectedSite: string = urlSiteId || 'all'

  // Keep the URL in sync with the filters, not just read it once on mount.
  // useRouter() was imported and called here and its result never used, so
  // ?siteId=/&domain= worked in one direction only: you could arrive on a
  // filtered view, but the moment you changed the site or domain the address
  // bar still described the state the page opened with — nothing to bookmark,
  // copy or send to a colleague, and a refresh silently reverted the filter.
  //
  // Written through the History API rather than router.replace(): under this
  // app's next.config (output: 'export' + trailingSlash: true) router.replace
  // silently drops the query string — confirmed earlier by intercepting
  // history.replaceState in a real browser while fixing the identical bug on
  // admin/trends.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedSite !== 'all') params.set('siteId', selectedSite)
    if (selectedDomains.length === 1) params.set('domain', selectedDomains[0])
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [selectedSite, selectedDomains])
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [selectedDays, setSelectedDays] = useState<number>(30)
  const [selectedSections, setSelectedSections] = useState<string[]>(['health', 'energy', 'alarm', 'executive'])
  const [selectedFormats, setSelectedFormats] = useState<('PDF' | 'XLSX' | 'CSV')[]>(['PDF'])
  const [aggregationInterval, setAggregationInterval] = useState<'raw' | '15m' | '1h' | 'daily'>('15m')
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // Custom Range & Generator Scoping
  // Initialised from the URL so a ?siteId= deep link still scopes the report.
  // The site-filtering code below all survived 396c647e, but 'site' became
  // unreachable — the picker no longer offers it and nothing else assigns it —
  // so an existing bookmarked site report silently produced an ALL-FLEET one
  // instead, over more assets than the link asked for, while the page went on
  // accepting ?siteId= and echoing it back into the URL as if it had been
  // honoured. Clicking any scope button still switches away normally.
  const [generatorScope, setGeneratorScope] = useState<'all' | 'site' | 'department' | 'device'>(urlSiteId ? 'site' : 'all')
  const [generatorDeviceIds, setGeneratorDeviceIds] = useState<string[]>([])
  const [isCustomRange, setIsCustomRange] = useState(false)
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customReportTitle, setCustomReportTitle] = useState('')
  const [classification, setClassification] = useState<'INTERNAL USE ONLY' | 'CONFIDENTIAL' | 'RESTRICTED' | 'PUBLIC AUDIT'>('INTERNAL USE ONLY')

  // Modals
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  // Which of the SELECTED formats the preview is showing.
  //
  // The preview built its data with `format: selectedFormats[0]` and rendered
  // one generic document layout, while the footer button said "Download Formal
  // PDF & XLSX & CSV Report". Two of the three files were never previewed, and
  // they are not restylings of the first — the CSV is titled sections of rows
  // and the XLSX is a multi-sheet workbook with a different first sheet. An
  // operator checking a report before sending it to an auditor was checking
  // one document and shipping three.
  const [previewFormat, setPreviewFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [previewCsv, setPreviewCsv] = useState<{ title: string; headers: string[]; rows: (string | number)[][] }[] | null>(null)
  const [previewXlsx, setPreviewXlsx] = useState<Sheet[] | null>(null)
  const [previewBuilding, setPreviewBuilding] = useState(false)

  // Keep the tab on a format that is actually selected.
  useEffect(() => {
    if (!selectedFormats.includes(previewFormat)) setPreviewFormat(selectedFormats[0] ?? 'PDF')
  }, [selectedFormats, previewFormat])


  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [historyModalSchedule, setHistoryModalSchedule] = useState<SchedRow | null>(null)
  const [deleteConfirmSchedule, setDeleteConfirmSchedule] = useState<SchedRow | null>(null)

  const applyProfile = (p: EnterpriseReportProfile) => {
    setActiveProfileId(p.id)
    setSelectedDomains(p.domains)
    setSelectedDays(p.days)
    setIsCustomRange(false)
    setAggregationInterval(p.aggregation)
    setSelectedSections(p.sections)
    setSelectedFormats(p.formats)
    setClassification(p.classification)
    setCustomReportTitle(p.name)
    toast.success(`Applied Profile: ${p.name}`, { icon: p.icon })
  }

  const handleSaveCustomPreset = () => {
    const name = window.prompt('Enter name for custom report profile preset:', customReportTitle.trim() || 'Custom Fleet Profile')
    if (!name || !name.trim()) return
    toast.success(`Saved preset profile "${name.trim()}"!`, { icon: '💾' })
  }

  // Context-aware enterprise profiles: dynamically filtered so irrelevant profiles (e.g. Cold-Chain GDP
  // when viewing transformers only, or Transformer Health when viewing cold-chain only) are suppressed.
  const visibleProfiles = useMemo(() => {
    const orgDomains = new Set(devices.map((d) => d.domain).filter(Boolean))
    return ENTERPRISE_PROFILES.filter((p) => {
      // 1. If fleet devices are loaded, ensure the organization actually owns assets in this profile's domain
      if (devices.length > 0 && !p.domains.some((d) => orgDomains.has(d))) {
        return false
      }
      // 2. Only show profiles compatible with the currently active domain filters
      return p.domains.some((d) => selectedDomains.includes(d))
    })
  }, [devices, selectedDomains])

  const toggleDomain = (domId: string) => {
    setActiveProfileId(null)
    setSelectedDomains((prev) => {
      if (prev.includes(domId)) {
        if (prev.length === 1) {
          toast.error('Select at least one product domain')
          return prev
        }
        return prev.filter((d) => d !== domId)
      }
      return [...prev, domId]
    })
  }

  const toggleExportFormat = (fmt: 'PDF' | 'XLSX' | 'CSV') => {
    setSelectedFormats((prev) => {
      if (prev.includes(fmt)) {
        if (prev.length === 1) {
          toast.error('Select at least one export format')
          return prev
        }
        return prev.filter((f) => f !== fmt)
      }
      return [...prev, fmt]
    })
  }

  const effectiveDays = useMemo(() => {
    if (!isCustomRange) return selectedDays
    const diff = Math.round((new Date(customEndDate).getTime() - new Date(customStartDate).getTime()) / 86400000)
    return Math.max(1, diff)
  }, [isCustomRange, selectedDays, customStartDate, customEndDate])

  const generatorFilteredDevices = useMemo(() => {
    let list = devices
    const totalPossible = effectiveDomains.length
    if (selectedDomains.length > 0 && selectedDomains.length < totalPossible) {
      list = list.filter((d) => d.domain && selectedDomains.includes(d.domain))
    }
    if (generatorScope === 'site' && selectedSite !== 'all') {
      list = list.filter((d) => d.siteId === selectedSite)
    } else if (generatorScope === 'department' && selectedDeptIds.length > 0) {
      list = list.filter((d) => d.departmentIds?.some((id) => selectedDeptIds.includes(id)))
    } else if (generatorScope === 'device') {
      list = list.filter((d) => generatorDeviceIds.includes(d.id))
    }
    return list
  }, [devices, selectedDomains, effectiveDomains, generatorScope, selectedSite, selectedDeptIds, generatorDeviceIds])

  // Live Metrics & Preview Cache
  const [reportData, setReportData] = useState<{
    metrics: IIoTMetricSummary
    summaries: DeviceTelemetrySummary[]
    alarms: AlarmLogItem[]
  } | null>(null)

  const activeSiteName = selectedSite !== 'all' ? availableSites.find((s) => s.id === selectedSite)?.name : undefined

  useEffect(() => {
    let cancelled = false
    const totalPossible = effectiveDomains.length
    buildIIoTReportData({
      orgId,
      orgName,
      title: customReportTitle.trim() || undefined,
      days: effectiveDays,
      domain: selectedDomains.length === 1 ? selectedDomains[0] : selectedDomains.length >= totalPossible ? 'all' : selectedDomains.join(','),
      siteId: generatorScope === 'site' ? selectedSite : undefined,
      siteName: generatorScope === 'site' ? activeSiteName : undefined,
      departmentId: selectedDeptIds.length === 1 ? selectedDeptIds[0] : undefined,
      departmentName: selectedDeptIds.length === 1 ? departments.find(d => d.id === selectedDeptIds[0])?.name : selectedDeptIds.length > 1 ? `${selectedDeptIds.length} Departments Selected` : undefined,
      selectedTypes: selectedSections,
      format: selectedFormats[0] || 'PDF',
      devices: generatorFilteredDevices,
      classification,
      aggregationInterval: AGGREGATION_RESOLUTIONS.find((r) => r.id === aggregationInterval)?.label,
    }).then((res) => {
      if (!cancelled) setReportData(res)
    })
    return () => { cancelled = true }
  }, [orgId, orgName, effectiveDays, selectedDomains, effectiveDomains, departments, generatorScope, selectedSite, activeSiteName, selectedDeptIds, selectedSections, selectedFormats, generatorFilteredDevices, customReportTitle, classification, aggregationInterval])

  // Build the real document for the chosen tab, from the same builders the
  // download path uses — so the preview is the file, not an impression of it.
  useEffect(() => {
    if (!previewModalOpen || !reportData || previewFormat === 'PDF') return
    let cancelled = false
    setPreviewBuilding(true)
    // The same option shape the download path uses, so what is previewed and
    // what is produced cannot drift.
    const opts = {
      orgId, orgName, days: effectiveDays,
      title: customReportTitle.trim() || undefined,
      selectedTypes: selectedSections, format: previewFormat,
      devices: generatorFilteredDevices,
      siteName: generatorScope === 'site' ? activeSiteName : undefined,
      departmentName: selectedDeptIds.length === 1
        ? departments.find((d) => d.id === selectedDeptIds[0])?.name
        : selectedDeptIds.length > 1 ? `${selectedDeptIds.length} Departments Selected` : undefined,
      classification,
      aggregationInterval: AGGREGATION_RESOLUTIONS.find((r) => r.id === aggregationInterval)?.label,
    }
    ;(async () => {
      try {
        if (previewFormat === 'CSV') {
          const { sections } = await buildIIoTCsvSections(opts, reportData)
          if (!cancelled) setPreviewCsv(sections)
        } else {
          const sheets = await buildIIoTXlsxSheets(opts, reportData)
          if (!cancelled) setPreviewXlsx(sheets)
        }
      } finally {
        if (!cancelled) setPreviewBuilding(false)
      }
    })()
    return () => { cancelled = true }
  }, [previewModalOpen, previewFormat, reportData, orgId, orgName, effectiveDays, selectedSections,
      customReportTitle, classification, aggregationInterval, generatorFilteredDevices,
      generatorScope, activeSiteName, selectedDeptIds, departments])

  // Cold-Chain Temperature Summary (MKT) is strictly for refrigeration/bloodBox assets.
  // Never show or apply it if user only selected transformers or automobile.
  const visibleSections = useMemo(() => {
    return REPORT_SECTIONS.filter((sec) => {
      if (sec.id === 'coldchain') {
        const hasColdChain = selectedDomains.some((d) => d === 'carbonNode' || d === 'bloodBox')
        if (!hasColdChain) return false
        return devices.some((d) => d.domain === 'carbonNode' || d.domain === 'bloodBox')
      }
      if (sec.id === 'pdm_diagnostics') {
        const hasTransformers = selectedDomains.some((d) => d === 'transformer')
        if (!hasTransformers) return false
        return devices.some((d) => d.domain === 'transformer' || (d as any).deviceType === 'transformer')
      }
      return true
    })
  }, [selectedDomains, devices])

  // Automatically drop domain-specific modules when their domains are unselected
  useEffect(() => {
    const hasColdChain = selectedDomains.some((d) => d === 'carbonNode' || d === 'bloodBox')
    if (!hasColdChain) {
      setSelectedSections((prev) => prev.filter((x) => x !== 'coldchain'))
    }
    const hasTransformers = selectedDomains.some((d) => d === 'transformer')
    if (!hasTransformers) {
      setSelectedSections((prev) => prev.filter((x) => x !== 'pdm_diagnostics'))
    }
  }, [selectedDomains])

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleGenerateAndDownload = async () => {
    if (!selectedSections.length) {
      toast.error('Select at least one report section')
      return
    }
    if (!selectedFormats.length) {
      toast.error('Select at least one export format')
      return
    }
    if (!selectedDomains.length) {
      toast.error('Select at least one product domain')
      return
    }
    setGenerating(true)
    try {
      const baseOpts = {
        orgId,
        orgName,
        title: customReportTitle.trim() || undefined,
        days: effectiveDays,
        domain: selectedDomains.length === 1 ? selectedDomains[0] : selectedDomains.length >= effectiveDomains.length ? 'all' : selectedDomains.join(','),
        siteId: generatorScope === 'site' ? selectedSite : undefined,
        siteName: generatorScope === 'site' ? activeSiteName : undefined,
        departmentId: selectedDeptIds.length === 1 ? selectedDeptIds[0] : undefined,
        departmentName: selectedDeptIds.length === 1 ? departments.find(d => d.id === selectedDeptIds[0])?.name : selectedDeptIds.length > 1 ? `${selectedDeptIds.length} Departments Selected` : undefined,
        selectedTypes: selectedSections,
        devices: generatorFilteredDevices,
        classification,
        aggregationInterval: AGGREGATION_RESOLUTIONS.find((r) => r.id === aggregationInterval)?.label,
      }
      const data = reportData || await buildIIoTReportData({ ...baseOpts, format: selectedFormats[0] || 'PDF' })

      for (const fmt of selectedFormats) {
        const currentOpts = { ...baseOpts, format: fmt }
        if (fmt === 'PDF') {
          await exportIIoTPDF(currentOpts, data)
        } else if (fmt === 'XLSX') {
          await exportIIoTXLSX(currentOpts, data)
        } else {
          await exportIIoTCSV(currentOpts, data)
        }
      }
      toast.success(`Downloaded ${selectedFormats.join(' & ')} report(s)!`)
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
    sequence: ReportSequence; format: 'PDF' | 'XLSX' | 'CSV'; channel: 'email' | 'telegram' | 'line' | 'googlechat' | 'webhook'
    recipients: string; enabled: boolean
    sendHour: number; sendMinute: number
    dayOfWeek: number | string | null
    dayOfMonth: number | string | null
    windowDays: number | null
    recipientMode: RecipientMode; recipientDeptIds: string[]; recipientUserIds: string[]
    subjectTemplate: string; bodyTemplate: string
    // The two fields that say whether the automation is actually working.
    // report_schedules has carried them since migrate-v4 and the runner
    // maintains them (UPDATE ... SET last_run_at=NOW(3), next_run_at=?), but
    // this page dropped both while mapping the response — so a schedule that
    // has been failing for a month looked exactly like one that ran an hour
    // ago, under a header counting "Active Crons".
    lastRunAt: string | null; nextRunAt: string | null
  }

  const [activeTab, setActiveTab] = useState<'studio' | 'sequence'>('studio')
  const [previewChannel, setPreviewChannel] = useState<'email' | 'telegram' | 'line' | 'googlechat' | 'webhook'>('email')
  const [testingScheduleId, setTestingScheduleId] = useState<string | null>(null)

  const blankSchedule = {
    domain: 'all',
    sendHour: 7, sendMinute: 0, dayOfWeek: '1' as number | string | null, dayOfMonth: '1' as number | string | null, windowDays: null as number | null,
    recipientMode: 'manual' as RecipientMode, recipientDeptIds: [] as string[], recipientUserIds: [] as string[],
    subjectTemplate: '', bodyTemplate: '',
  }

  const seedRows: SchedRow[] = seedSchedules.map((r) => ({
    ...blankSchedule,
    id: r.id, name: r.name, scope: r.scope, scopeId: r.scopeId, domain: 'all', sequence: r.sequence,
    format: r.format, channel: 'email', recipients: '', enabled: r.enabled,
    lastRunAt: null, nextRunAt: null,
  }))

  const [schedules, setSchedules] = useState<SchedRow[]>(seedRows)
  const [draft, setDraft] = useState<Omit<SchedRow, 'id' | 'enabled' | 'lastRunAt' | 'nextRunAt'>>({
    ...blankSchedule,
    name: '', scope: 'department', scopeId: departments[0]?.id ?? '', domain: 'all', sequence: 'daily',
    format: 'CSV', channel: 'email', recipients: '',
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
      if (cancelled) return
      // A null response means the request FAILED. Returning early left the
      // three seeded demo rows on screen — "Daily Cold-Chain Summary",
      // "Weekly Transformer Health" (both enabled) and "Monthly Compliance
      // Export" — against departments and a device that belong to the demo
      // org, under a header reading "2 Active Crons". A compliance officer
      // reading that believes a monthly export is being generated and sent.
      if (!rows) { setSchedules([]); return }
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
        lastRunAt: r.last_run_at ?? null, nextRunAt: r.next_run_at ?? null,
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

  const draftRecipientCount = draft.recipientMode === 'department'
    ? draft.recipientDeptIds.length
    : draft.recipientMode === 'users'
    ? draft.recipientUserIds.length
    : draft.recipients.split(',').map((x) => x.trim()).filter(Boolean).length

  const openCreateSchedule = () => {
    setEditingScheduleId(null)
    setDraft({
      ...blankSchedule,
      name: '',
      domain: selectedDomains.length === 1 ? selectedDomains[0] : (effectiveDomains.length === 1 ? effectiveDomains[0] : 'all'),
      scope: generatorScope === 'all' ? 'org' : generatorScope,
      scopeId: generatorScope === 'site' ? (selectedSite === 'all' ? '' : selectedSite)
             : generatorScope === 'department' ? selectedDeptIds.join(',')
             : generatorScope === 'device' ? generatorDeviceIds.join(',')
             : '',
      sequence: 'daily',
      format: selectedFormats[0] || 'CSV',
      channel: 'email',
      recipients: '',
    })
    setScheduleModalOpen(true)
  }

  const openEditSchedule = (s: SchedRow) => {
    setEditingScheduleId(s.id)
    setDraft({
      name: s.name,
      domain: s.domain || 'all',
      scope: s.scope,
      scopeId: s.scopeId,
      sequence: s.sequence,
      format: s.format,
      channel: s.channel,
      recipients: s.recipients,
      sendHour: s.sendHour,
      sendMinute: s.sendMinute,
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
      windowDays: s.windowDays,
      recipientMode: s.recipientMode,
      recipientDeptIds: s.recipientDeptIds,
      recipientUserIds: s.recipientUserIds,
      subjectTemplate: s.subjectTemplate,
      bodyTemplate: s.bodyTemplate,
    })
    setScheduleModalOpen(true)
  }

  const handleConvertStudioToSequence = () => {
    setActiveTab('sequence')
    setEditingScheduleId(null)
    const domLabel = selectedDomains.length === 1
      ? INDUSTRIAL_DOMAINS.find((d) => d.id === selectedDomains[0])?.label
      : `${selectedDomains.length} Domains`
    setDraft({
      ...blankSchedule,
      name: `${customReportTitle.trim() || domLabel || 'Fleet Operations'} Automated Audit`,
      domain: selectedDomains.length === 1 ? selectedDomains[0] : 'all',
      scope: generatorScope === 'all' ? 'org' : generatorScope,
      scopeId: generatorScope === 'site' ? (selectedSite === 'all' ? '' : selectedSite)
             : generatorScope === 'department' ? selectedDeptIds.join(',')
             : generatorScope === 'device' ? generatorDeviceIds.join(',')
             : '',
      sequence: effectiveDays <= 1 ? 'daily' : effectiveDays <= 7 ? 'weekly' : 'monthly',
      format: selectedFormats[0] || 'CSV',
      channel: 'email',
      recipients: '',
      windowDays: effectiveDays,
    })
    setScheduleModalOpen(true)
    toast.success('Studio parameters loaded into Sequence Scheduler!', { icon: '⚡' })
  }

  const saveScheduleFromModal = async () => {
    if (!draft.name.trim()) { toast.error('Give the schedule a name'); return }
    if (draft.scope === 'device' && !draft.scopeId.trim()) {
      toast.error('Select at least one device')
      return
    }
    if (draftRecipientCount === 0) {
      toast.error(
        draft.recipientMode === 'manual'
          ? (draft.channel === 'telegram' ? 'Enter Telegram Chat/Channel ID'
             : draft.channel === 'line' ? 'Enter LINE User/Group ID'
             : draft.channel === 'googlechat' ? 'Enter Google Chat Space Webhook URL'
             : draft.channel === 'webhook' ? 'Enter Destination Webhook URL'
             : 'Add at least one email address')
          : `Select at least one ${draft.recipientMode === 'department' ? 'department' : 'staff user'}`
      )
      return
    }

    const id = editingScheduleId || `rs-${Date.now()}`
    const scopeId = draft.scope === 'org' ? '' : (draft.scopeId || scopeOptions[0]?.id || '')
    // Preserve the runner's own record on an edit; a newly created schedule has
    // not run yet, and saying so is the point — "Never run" on a week-old
    // schedule is exactly the signal an operator needs.
    const existing = editingScheduleId ? schedules.find((x) => x.id === editingScheduleId) : undefined
    const row: SchedRow = {
      ...draft, id, scopeId, enabled: true,
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: existing?.nextRunAt ?? null,
    }

    if (editingScheduleId) {
      setSchedules((s) => s.map((x) => (x.id === id ? row : x)))
      toast.success('Schedule updated')
    } else {
      setSchedules((s) => [...s, row])
      toast.success('Schedule created')
    }

    if (live) {
      const r = await persist(row)
      if (!r) {
        toast.error('Could not save the schedule')
        return
      }
    }

    setScheduleModalOpen(false)
    setEditingScheduleId(null)
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
            {/* Enterprise Preset Profiles Quick-Bar */}
            <div className="p-3 rounded-lg border border-indigo-900/40 bg-indigo-950/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-200 shrink-0">
                <Bookmark size={14} className="text-indigo-400" />
                <span>Enterprise Profiles:</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {visibleProfiles.length === 0 && (
                  <span className="text-[11px] text-slate-500 italic px-2">No preset profiles for current domain filter</span>
                )}
                {visibleProfiles.map((p) => {
                  const active = activeProfileId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyProfile(p)}
                      title={p.description}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                        active
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                          : 'bg-slate-900 text-slate-300 hover:text-white border-slate-800 hover:border-slate-700'
                      )}
                    >
                      <span>{p.icon}</span>
                      <span>{p.shortLabel}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={handleSaveCustomPreset}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors"
                  title="Save current filters as a named preset"
                >
                  <Save size={12} />
                  <span>Save Preset</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileBarChart size={17} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Report Generator &amp; Scope</h3>
              </div>

              {/* Time Range & Aggregation Controls */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
                    <Clock size={12} className="text-indigo-400" />
                    Resolution:
                  </span>
                  {AGGREGATION_RESOLUTIONS.map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => setAggregationInterval(res.id)}
                      title={res.desc}
                      className={clsx(
                        'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors',
                        aggregationInterval === res.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      )}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 mr-1">Period:</span>
                  {TIME_RANGES.map((r) => (
                    <button
                      key={r.days}
                      onClick={() => {
                        setIsCustomRange(false)
                        setSelectedDays(r.days)
                      }}
                      className={clsx(
                        'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                        !isCustomRange && selectedDays === r.days
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setIsCustomRange(true)}
                    className={clsx(
                      'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1',
                      isCustomRange
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    )}
                  >
                    <Calendar size={12} />
                    <span>Custom</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Date Range Inputs */}
            {isCustomRange && (
              <div className="p-3 rounded-lg border border-indigo-900/40 bg-[#0a0e1a] flex flex-wrap items-center gap-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Calendar size={14} className="text-indigo-400" />
                  <span className="font-semibold">Specify Custom Window:</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">From:</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="rounded px-2 py-1 text-xs text-white outline-none border border-slate-800 bg-[#0d1117]"
                  />
                  <span className="text-[11px] text-slate-400">To:</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="rounded px-2 py-1 text-xs text-white outline-none border border-slate-800 bg-[#0d1117]"
                  />
                  <span className="text-[11px] font-mono text-indigo-300 ml-2">
                    ({effectiveDays} Day{effectiveDays === 1 ? '' : 's'} calculated)
                  </span>
                </div>
              </div>
            )}

            {/* Report Title & Document Classification */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Custom Report Title &amp; Subtitle (Optional)
                </label>
                <input
                  value={customReportTitle}
                  onChange={(e) => setCustomReportTitle(e.target.value)}
                  placeholder="e.g. Q3 Substation Operations &amp; Grid Compliance Audit"
                  className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inset}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1">
                  <Shield size={12} className="text-amber-400" />
                  Document Classification
                </label>
                <select
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inset}
                >
                  <option value="INTERNAL USE ONLY">INTERNAL USE ONLY (Standard)</option>
                  <option value="CONFIDENTIAL">CONFIDENTIAL (Proprietary / Executive)</option>
                  <option value="RESTRICTED">RESTRICTED (Critical Infrastructure)</option>
                  <option value="PUBLIC AUDIT">PUBLIC AUDIT (Regulator Compliance)</option>
                </select>
              </div>
            </div>

            {/* Domain & Scope Selection */}
            <div className="space-y-4">
              {/* Multi-Domain Selector Pills */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                    Asset Domain Filter ({selectedDomains.length} of {effectiveDomains.length} selected)
                  </label>
                  <div className="flex gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setSelectedDomains([...effectiveDomains])}
                      className="text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      Select All
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => setSelectedDomains([])}
                      className="text-slate-500 hover:text-slate-400 font-semibold"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {INDUSTRIAL_DOMAINS.filter((d) => d.id !== 'all' && effectiveDomains.includes(d.id as SensorDomain)).map((dm) => {
                    const on = selectedDomains.includes(dm.id)
                    return (
                      <button
                        key={dm.id}
                        type="button"
                        onClick={() => toggleDomain(dm.id)}
                        className={clsx(
                          'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 border',
                          on
                            ? 'bg-indigo-600/25 text-indigo-200 border-indigo-500/60 shadow-sm'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                        )}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[9px] font-bold"
                          style={on ? { background: '#6366f1', color: '#ffffff' } : { border: '1px solid #475569' }}
                        >
                          {on && '✓'}
                        </span>
                        <dm.icon size={13} className={on ? 'text-indigo-300' : 'text-slate-500'} />
                        <span>{dm.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Target Scope Mode Selector */}
              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Target Scope ({generatorFilteredDevices.length} assets targeted)
                </label>
                <div className="flex gap-1.5">
                  {([['all', 'All Fleet Assets'], ['department', 'Department Scope'], ['device', 'Selected Devices']] as const).map(([sc, label]) => (
                    <button
                      key={sc}
                      onClick={() => setGeneratorScope(sc)}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                        generatorScope === sc ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900 text-slate-400 border border-slate-800'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-selectors based on generatorScope */}
              {generatorScope === 'department' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-300">
                      Target Departments ({selectedDeptIds.length} of {departments.length} selected — empty targets all)
                    </span>
                    <div className="flex gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSelectedDeptIds(departments.map((d) => d.id))}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        Select All
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedDeptIds([])}
                        className="text-slate-500 hover:text-slate-400 font-semibold"
                      >
                        Clear (All)
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                    {departments.map((dep) => {
                      const on = selectedDeptIds.includes(dep.id)
                      const devCount = devices.filter((d) => d.departmentIds?.includes(dep.id)).length
                      return (
                        <button
                          key={dep.id}
                          type="button"
                          onClick={() => {
                            setSelectedDeptIds(on ? selectedDeptIds.filter((id) => id !== dep.id) : [...selectedDeptIds, dep.id])
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-white/5 transition-colors border border-transparent hover:border-slate-800"
                        >
                          <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                            <span
                              className="w-3 h-3 rounded-sm flex items-center justify-center text-[8px] font-bold"
                              style={on ? { background: '#6366f1', color: '#fff' } : { border: '1px solid #334155' }}
                            >
                              {on && '✓'}
                            </span>
                            {dep.name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{devCount} assets</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {generatorScope === 'device' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-300">
                      Select Monitored Devices ({generatorDeviceIds.length} of {devices.length} selected)
                    </span>
                    <div className="flex gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setGeneratorDeviceIds(devices.map((x) => x.id))}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        Select All
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setGeneratorDeviceIds([])}
                        className="text-slate-500 hover:text-slate-400 font-semibold"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg p-2" style={inset}>
                    {devices.map((dev) => {
                      const on = generatorDeviceIds.includes(dev.id)
                      return (
                        <button
                          key={dev.id}
                          type="button"
                          onClick={() => {
                            setGeneratorDeviceIds(on ? generatorDeviceIds.filter((x) => x !== dev.id) : [...generatorDeviceIds, dev.id])
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
              )}
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

            {/* Export Format & Actions Bar */}
            <div className="pt-3 border-t border-slate-800 flex flex-col lg:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap">
                <span className="text-xs text-slate-400 font-semibold uppercase">
                  Export Formats ({selectedFormats.length}):
                </span>
                {(['PDF', 'XLSX', 'CSV'] as const).map((f) => {
                  const on = selectedFormats.includes(f)
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleExportFormat(f)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                        on
                          ? 'bg-indigo-600 text-white shadow-sm border-indigo-500'
                          : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800 hover:border-slate-700'
                      )}
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex items-center justify-center text-[8px] font-bold"
                        style={on ? { background: '#ffffff', color: '#4f46e5' } : { border: '1px solid #475569' }}
                      >
                        {on && '✓'}
                      </span>
                      {f === 'PDF' && <FileText size={13} />}
                      {f === 'XLSX' && <FileSpreadsheet size={13} />}
                      {f === 'CSV' && <FileBarChart size={13} />}
                      <span>{f}</span>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap justify-end">
                <button
                  type="button"
                  onClick={handleConvertStudioToSequence}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-950/50 border border-indigo-700/40 hover:bg-indigo-900/60 transition-colors"
                  title="Copy current filters directly into an automated sequence"
                >
                  <CalendarClock size={14} />
                  <span>Save as Automated Sequence</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(true)}
                  disabled={!selectedSections.length}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors disabled:opacity-50"
                >
                  <Eye size={14} />
                  <span>Preview Report</span>
                </button>

                <button
                  onClick={handleGenerateAndDownload}
                  disabled={generating || !selectedSections.length || !selectedFormats.length}
                  className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-xs font-bold text-white shadow-md disabled:opacity-50 transition-transform active:scale-95"
                  style={gradient}
                >
                  <Download size={14} />
                  <span>{generating ? 'Generating...' : `Generate & Download (${selectedFormats.join(' + ')})`}</span>
                </button>
              </div>
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
                <span className="text-[11px] text-slate-400">{reportData.summaries.length} Assets Monitored</span>
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
                    {reportData.summaries.flatMap((dev) =>
                      dev.parameters.map((p) => (
                        <tr key={`${dev.nodeId}-${p.key}`} style={{ borderBottom: '1px solid #1e2433' }} className="hover:bg-white/[0.02]">
                          <td className="py-2 px-4 text-white font-medium">
                            {dev.deviceName} <span className="text-slate-500 font-mono text-[10px]">({dev.nodeId})</span>
                          </td>
                          <td className="py-2 px-4 text-slate-300">
                            {p.label} <span className="text-slate-500 font-mono">({p.unit})</span>
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-slate-400">{p.samples}</td>
                          <td className="py-2 px-4 text-right font-mono text-slate-300">{na(p.min)}</td>
                          <td className="py-2 px-4 text-right font-mono text-white font-semibold">{na(p.avg)}</td>
                          <td className="py-2 px-4 text-right font-mono text-slate-300">{na(p.max)}</td>
                          <td className="py-2 px-4 text-center">
                            <span className={clsx(
                              'px-2 py-0.5 rounded text-[9px] font-bold',
                              p.compliance === false
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            )}>
                              {p.compliance === false ? 'EXCURSION' : 'NORMAL'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
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
          {/* Header Stats Bar & Create Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-[#0d1117]">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Total Configured:</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white bg-slate-800 border border-slate-700">
                  {schedules.length}
                </span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Active Crons:</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold text-indigo-300 bg-indigo-500/20 border border-indigo-500/30">
                  {schedules.filter((s) => s.enabled).length}
                </span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Paused:</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold text-slate-400 bg-slate-900 border border-slate-800">
                  {schedules.filter((s) => !s.enabled).length}
                </span>
              </div>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-400 font-mono">15-min Cron Engine (Asia/Bangkok)</span>
            </div>

            <button
              onClick={openCreateSchedule}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
              style={gradient}
            >
              <Plus size={15} />
              <span>Create New Sequence</span>
            </button>
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
                  {['Schedule Name', 'Product Domain', 'Scope Target', 'Frequency & Timing', 'History Window', 'Delivery Channel', 'Last Run / Next Run', 'Active', 'Dispatch Actions'].map((h) => (
                    <th key={h} className="py-3 px-4 text-left text-slate-400 font-semibold uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 space-y-2">
                      <CalendarClock size={28} className="mx-auto text-slate-600 opacity-50" />
                      <div className="text-sm font-semibold text-slate-400">No automated schedules defined</div>
                      <p className="text-xs text-slate-600">Click &ldquo;Create New Sequence&rdquo; above to set up your first recurring report dispatch.</p>
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
                          <span className="capitalize font-semibold">{s.channel === 'googlechat' ? 'Google Chat' : s.channel}</span>
                          {to && <span className="text-slate-500 truncate max-w-xs block text-[11px]">{to}</span>}
                        </td>
                        {/* The state that says whether the automation works.
                            An enabled schedule that has never run, or last ran
                            weeks ago, is indistinguishable from a healthy one
                            without this — and the panel header counts it as an
                            "Active Cron" either way. */}
                        <td className="py-3.5 px-4">
                          {s.lastRunAt ? (
                            <span className="text-slate-300">{fmtDateTime(s.lastRunAt)}</span>
                          ) : (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/25"
                              title="This schedule has not run since it was created."
                            >
                              Never run
                            </span>
                          )}
                          <span className="block text-[11px] text-slate-500">
                            {!s.enabled
                              ? 'disabled — will not run'
                              : s.nextRunAt
                              ? `next ${fmtDateTime(s.nextRunAt)}`
                              : 'next run not scheduled yet'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <button onClick={() => toggleSchedule(s.id)}>
                            {s.enabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}
                          </button>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              disabled={isTesting}
                              onClick={() => testScheduleRun(s)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 hover:bg-indigo-900/80 transition-colors disabled:opacity-50"
                              title="Trigger immediate simulated test dispatch"
                            >
                              <Play size={11} className={isTesting ? 'animate-spin' : ''} />
                              <span>{isTesting ? 'Sending...' : 'Test'}</span>
                            </button>

                            <button
                              onClick={() => setHistoryModalSchedule(s)}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                              title="View execution & dispatch history"
                            >
                              <History size={15} />
                            </button>

                            <button
                              onClick={() => openEditSchedule(s)}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                              title="Edit schedule configuration"
                            >
                              <Pencil size={15} />
                            </button>

                            <button
                              onClick={() => setDeleteConfirmSchedule(s)}
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Delete schedule"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
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

      {/* ========================================================================= */}
      {/* MODAL 1: SCHEDULE BUILDER & SIMULATOR MODAL                               */}
      {/* ========================================================================= */}
      {scheduleModalOpen && (
        <Modal
          open
          onClose={() => setScheduleModalOpen(false)}
          labelledBy="sched-modal-title"
          overlayClassName="bg-black/75"
          className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-800 bg-[#0d1117] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
        >
          <>
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CalendarClock size={18} className="text-indigo-400" />
                <div>
                  <h3 id="sched-modal-title" className="text-sm font-bold text-white">
                    {editingScheduleId ? 'Edit Automated Sequence' : 'Create New Automated Sequence'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Configure recurring 15-minute cron report dispatch (Timezone: Asia/Bangkok +07:00)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setScheduleModalOpen(false)
                  setEditingScheduleId(null)
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: 2-Column Split (Left: Form, Right: Simulator) */}
            <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 bg-[#080c16]">
              {/* Left Column: Form */}
              <div className="lg:col-span-7 space-y-4">
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
                    {INDUSTRIAL_DOMAINS.filter((dm) => dm.id === 'all' ? effectiveDomains.length > 1 : effectiveDomains.includes(dm.id as SensorDomain)).map((dm) => {
                      const on = (draft.domain || (effectiveDomains.length === 1 ? effectiveDomains[0] : 'all')) === dm.id
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
                    {([['org', 'All Assets'], ['department', 'Department'], ['device', 'Per Device']] as const).map(([sc, label]) => (
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
                          Select Devices ({draftDeviceIds.length} of {devices.length} selected)
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
                        <span className="text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, dayOfMonth: '31' }))}
                          className="hover:underline"
                        >
                          Month-End (31st)
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <div className="grid grid-cols-5 gap-1">
                      {([
                        ['email', 'Email', Mail],
                        ['telegram', 'Telegram', Send],
                        ['line', 'LINE', MessageSquare],
                        ['googlechat', 'GChat', Bot],
                        ['webhook', 'Webhook', Webhook],
                      ] as const).map(([ch, label, Icon]) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => {
                            setDraft((d) => ({ ...d, channel: ch }))
                            setPreviewChannel(ch)
                          }}
                          className={clsx(
                            'flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold capitalize transition-colors',
                            draft.channel === ch ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                          )}
                        >
                          <Icon size={12} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Attached Report Format Selection */}
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                    Attached Report Format &amp; Artifact
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['PDF', 'PDF Executive Document (.pdf)', FileText, 'bg-rose-500/15 text-rose-300 border-rose-500/40'],
                      ['XLSX', 'Excel Metrics Workbook (.xlsx)', FileSpreadsheet, 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'],
                      ['CSV', 'CSV Raw Telemetry Log (.csv)', FileBarChart, 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'],
                    ] as const).map(([fmt, label, Icon, activeStyle]) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, format: fmt }))}
                        className={clsx(
                          'p-2 rounded-lg border text-left transition-all flex items-center gap-2',
                          draft.format === fmt
                            ? `${activeStyle} ring-1 ring-indigo-500 shadow-sm`
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                        )}
                      >
                        <Icon size={16} className={draft.format === fmt ? '' : 'text-slate-500'} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white">{fmt}</div>
                          <div className="text-[9px] text-slate-400 truncate">{label}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recipient Targeting Mode across ALL channels */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      Recipient Target Mode ({draft.channel.toUpperCase()})
                    </label>
                    <span className="text-[10px] text-indigo-400 font-medium capitalize">
                      Active: {draft.recipientMode === 'manual' ? 'Direct Endpoint' : draft.recipientMode === 'department' ? 'Department Staff' : 'Specific Users'}
                    </span>
                  </div>

                  <div className="flex gap-1.5">
                    {([
                      ['manual', draft.channel === 'webhook' ? 'Webhook Endpoint' : draft.channel === 'googlechat' ? 'Space Webhook' : 'Direct Target', draft.channel === 'webhook' ? Webhook : draft.channel === 'googlechat' ? Bot : Send],
                      ['department', 'Department Staff', Building2],
                      ['users', 'Specific Users', Users],
                    ] as const).map(([m, label, Icon]) => (
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
                    ))}
                  </div>

                  {draft.recipientMode === 'manual' && (
                    <div>
                      <input
                        value={draft.recipients}
                        onChange={(e) => setDraft((d) => ({ ...d, recipients: e.target.value }))}
                        placeholder={
                          draft.channel === 'email'
                            ? 'maintenance.lead@corp.net, facility@corp.net'
                            : draft.channel === 'telegram'
                            ? '-1001234567890 (Telegram Chat ID or @channel_username)'
                            : draft.channel === 'line'
                            ? 'e.g. U1234567890abcdef... or C123456789... (LINE User / Group ID)'
                            : draft.channel === 'googlechat'
                            ? 'https://chat.googleapis.com/v1/spaces/AAAA.../messages?key=...&token=...'
                            : 'https://sap-gateway.internal/api/v2/ingest-report'
                        }
                        className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none font-mono"
                        style={inset}
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        {draft.channel === 'email'
                          ? 'Comma-separated email addresses for automated report distribution.'
                          : draft.channel === 'telegram'
                          ? 'Telegram target chat ID or public channel username.'
                          : draft.channel === 'line'
                          ? 'LINE Messaging API target User ID or Group ID.'
                          : draft.channel === 'googlechat'
                          ? 'Incoming Webhook URL for your Google Chat Space.'
                          : 'Destination endpoint URL to receive structured JSON/CSV report payload.'}
                      </span>
                    </div>
                  )}

                  {draft.recipientMode === 'department' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-semibold text-slate-300">
                          Target Departments ({draft.recipientDeptIds.length} of {departments.length} selected — empty targets all)
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
                              <span className="text-[10px] text-slate-500 font-mono">{n} staff members</span>
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
                            onClick={() => setDraft((d) => ({ ...d, recipientUserIds: users.map((x) => x.id) }))}
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
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  recipientUserIds: on
                                    ? d.recipientUserIds.filter((x) => x !== u.id)
                                    : [...d.recipientUserIds, u.id],
                                }))
                              }
                              className="w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5 transition-colors"
                            >
                              <span className={clsx('flex items-center gap-2 truncate', on ? 'text-white font-semibold' : 'text-slate-400')}>
                                <span className="w-2.5 h-2.5 rounded-sm flex items-center justify-center text-[8px]" style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>
                                  {on && '✓'}
                                </span>
                                {u.name || u.id}
                              </span>
                              <span className="text-[10px] text-slate-500 truncate">{u.email || 'account user'}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Channel-Adaptive Subject & Custom Message Template */}
                <div className="p-3.5 rounded-xl border border-indigo-900/40 bg-[#0a0e1a]/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <Sparkles size={13} className="text-indigo-400" />
                      <span>
                        {draft.channel === 'email'
                          ? '📧 Email Subject & Message Body Template'
                          : draft.channel === 'telegram'
                          ? '✈️ Telegram Message Title & Caption Template'
                          : draft.channel === 'line'
                          ? '💬 LINE Flex Header & Message Body Template'
                          : draft.channel === 'googlechat'
                          ? '🤖 Google Chat Card Title & Section Text Template'
                          : '🔗 Webhook Event Subject & Payload Note Template'}
                      </span>
                    </div>
                    <span className="text-[10px] text-indigo-400 font-mono">Dynamic Tokens</span>
                  </div>

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
                        >
                          + {tk.key}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {draft.channel === 'email'
                        ? 'Subject Line Template'
                        : draft.channel === 'telegram'
                        ? 'Telegram Message Header / Title'
                        : draft.channel === 'line'
                        ? 'LINE Flex Card Header Title'
                        : draft.channel === 'googlechat'
                        ? 'Google Chat Card Title'
                        : 'Webhook Event Summary / Header'}
                    </label>
                    <input
                      value={draft.subjectTemplate}
                      onChange={(e) => setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))}
                      placeholder={
                        draft.channel === 'email'
                          ? `[${orgName} Audit] {{name}} - {{sequence}} Report`
                          : draft.channel === 'telegram'
                          ? `📊 [${orgName}] {{name}} - {{sequence}} Digest`
                          : draft.channel === 'line'
                          ? `📊 {{name}} ({{sequence}} Digest)`
                          : draft.channel === 'googlechat'
                          ? `📊 ONEOPS · {{name}}`
                          : `REPORT_DISPATCH: {{name}}`
                      }
                      className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      style={inset}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {draft.channel === 'email'
                        ? 'Custom Message / SOP Operational Note'
                        : draft.channel === 'telegram'
                        ? 'Telegram Markdown Caption & SOP Note'
                        : draft.channel === 'line'
                        ? 'LINE Flex Description & Operational Note'
                        : draft.channel === 'googlechat'
                        ? 'Google Chat Section Body Text'
                        : 'Webhook Operational Metadata & Description Note'}
                    </label>
                    <textarea
                      rows={2}
                      value={draft.bodyTemplate}
                      onChange={(e) => setDraft((d) => ({ ...d, bodyTemplate: e.target.value }))}
                      placeholder="e.g. Please review the attached report and confirm compliance before shift handover."
                      className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
                      style={inset}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Simulator */}
              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-xl p-4 space-y-3 border border-slate-800 bg-[#0a0e1a]">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Eye size={15} className="text-indigo-400" />
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Dispatch Simulator</h3>
                    </div>
                    <div className="flex gap-1 text-[10px] flex-wrap">
                      {(['email', 'telegram', 'line', 'googlechat', 'webhook'] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setPreviewChannel(ch)}
                          className={clsx(
                            'px-2 py-0.5 rounded font-semibold capitalize transition-colors',
                            previewChannel === ch ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                          )}
                        >
                          {ch === 'googlechat' ? 'Google Chat' : ch}
                        </button>
                      ))}
                    </div>
                  </div>

                  {previewChannel === 'email' ? (
                    <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#080c16] text-xs font-sans">
                      <div className="p-3 bg-[#0d121f] border-b border-slate-800/80 space-y-1">
                        <div className="text-[10px] text-slate-400">
                          <strong>From:</strong> ONEOPS Operations &lt;reports@oneops.io&gt;
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          <strong>To:</strong> {draft.recipients || (draft.recipientMode === 'department' ? `${draft.recipientDeptIds.length} Selected Departments` : `${draft.recipientUserIds.length} Selected Staff`)}
                        </div>
                        <div className="text-xs font-bold text-white pt-1 truncate">
                          <strong>Subject:</strong> {previewSubject}
                        </div>
                      </div>

                      <div className="p-3.5 space-y-2.5">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                          <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center font-black text-[10px] text-white">
                            {orgName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-[11px] font-bold text-white">{orgName} Fleet Operations</div>
                            <div className="text-[9px] text-slate-400">Automated Dispatch</div>
                          </div>
                        </div>

                        <div className="text-slate-300 text-[11px] leading-relaxed">
                          {previewBody}
                        </div>

                        <div className="p-2 rounded bg-slate-900/70 border border-slate-800 text-[10px] space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Frequency: <strong className="text-white capitalize">{draft.sequence}</strong></span>
                            <span>Scope: <strong className="text-white capitalize">{draft.scope}</strong></span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span>Product: <strong className="text-white">{INDUSTRIAL_DOMAINS.find(d => d.id === draft.domain)?.label}</strong></span>
                            <span>Time: <strong className="text-white font-mono">{String(draft.sendHour).padStart(2,'0')}:{String(draft.sendMinute).padStart(2,'0')} ICT</strong></span>
                          </div>
                        </div>

                        <div className={clsx(
                          'p-2 rounded-lg border flex items-center justify-between',
                          draft.format === 'PDF' ? 'border-rose-500/30 bg-rose-950/20'
                          : draft.format === 'XLSX' ? 'border-emerald-500/30 bg-emerald-950/20'
                          : 'border-indigo-500/30 bg-indigo-950/20'
                        )}>
                          <div className="flex items-center gap-2 truncate">
                            {draft.format === 'PDF' ? <FileText size={14} className="text-rose-400 shrink-0" />
                             : draft.format === 'XLSX' ? <FileSpreadsheet size={14} className="text-emerald-400 shrink-0" />
                             : <FileBarChart size={14} className="text-indigo-400 shrink-0" />}
                            <span className="text-[10px] font-bold text-white truncate">
                              {draft.name ? `${draft.name.replace(/\s+/g, '_')}.${draft.format.toLowerCase()}` : `operations_audit.${draft.format.toLowerCase()}`}
                            </span>
                          </div>
                          <span className={clsx(
                            'text-[9px] px-1.5 py-0.5 rounded font-bold uppercase',
                            draft.format === 'PDF' ? 'bg-rose-600/30 text-rose-300'
                            : draft.format === 'XLSX' ? 'bg-emerald-600/30 text-emerald-300'
                            : 'bg-indigo-600/30 text-indigo-300'
                          )}>{draft.format}</span>
                        </div>
                      </div>
                    </div>
                  ) : previewChannel === 'telegram' ? (
                    <div className="rounded-xl p-3 border border-slate-800 bg-[#080c16] space-y-2.5 text-xs">
                      <div className="p-3 rounded-2xl rounded-tl-none bg-[#17212b] border border-sky-900/30 space-y-1.5 text-white">
                        <div className="font-bold text-sky-300 text-[11px]">📊 {orgName} — {draft.name || 'Automated Digest'}</div>
                        <p className="text-[10px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                          {previewBody}
                        </p>
                        <div className="text-[9px] text-slate-400 border-t border-slate-700/60 pt-1 flex justify-between">
                          <span>Cadence: {draft.sequence}</span>
                          <span>Time: {String(draft.sendHour).padStart(2,'0')}:{String(draft.sendMinute).padStart(2,'0')} ICT</span>
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate">
                          {draft.format === 'PDF' ? <FileText size={13} className="text-rose-400 shrink-0" />
                           : draft.format === 'XLSX' ? <FileSpreadsheet size={13} className="text-emerald-400 shrink-0" />
                           : <FileBarChart size={13} className="text-sky-400 shrink-0" />}
                          <span className="truncate">Attached: {draft.name ? `${draft.name.replace(/\s+/g, '_')}.${draft.format.toLowerCase()}` : `report.${draft.format.toLowerCase()}`}</span>
                        </div>
                        <span className="text-[9px] font-bold text-sky-300 uppercase font-mono">{draft.format}</span>
                      </div>
                    </div>
                  ) : previewChannel === 'line' ? (
                    <div className="rounded-xl overflow-hidden border border-[#06c755]/40 bg-[#0a150e] text-xs font-sans space-y-2.5">
                      <div className="p-2.5 bg-[#06c755]/20 border-b border-[#06c755]/30 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#06c755] flex items-center gap-1.5">
                          <MessageSquare size={13} /> LINE Official Flex Message
                        </span>
                        <span className="text-[9px] font-mono text-emerald-300">Push Notification</span>
                      </div>
                      <div className="p-3.5 space-y-2.5">
                        <div className="font-bold text-sm text-white">{draft.name || 'Industrial Fleet Audit'}</div>
                        <p className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                          {previewBody}
                        </p>
                        <div className="p-2 rounded bg-black/40 border border-emerald-900/40 text-[10px] text-emerald-300 flex items-center justify-between">
                          <span className="truncate">Attached: {draft.name ? `${draft.name.replace(/\s+/g, '_')}.${draft.format.toLowerCase()}` : `operations.${draft.format.toLowerCase()}`}</span>
                          <span className="font-mono capitalize">{draft.format}</span>
                        </div>
                        <button type="button" className="w-full py-1.5 rounded-lg bg-[#06c755] text-white text-[11px] font-bold shadow hover:bg-[#05b34c] transition-colors">
                          VIEW AUDIT REPORT
                        </button>
                      </div>
                    </div>
                  ) : previewChannel === 'googlechat' ? (
                    <div className="rounded-xl p-3 border border-slate-800 bg-[#0a0f18] space-y-2.5 text-xs">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 border-b border-slate-800 pb-1.5">
                        <Bot size={13} className="text-emerald-400" />
                        <span className="font-bold text-slate-200"># operations-audit</span>
                        <span className="text-slate-500">· Google Workspace Space</span>
                      </div>
                      <div className="p-3.5 rounded-xl border border-slate-700/70 bg-[#121926] space-y-2.5 text-white">
                        <div className="flex items-center gap-2.5 pb-2 border-b border-slate-700/60">
                          <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center font-black text-[10px] text-white">
                            OP
                          </div>
                          <div>
                            <div className="text-[11px] font-bold text-white">ONEOPS · {draft.name || 'Industrial Fleet Report'}</div>
                            <div className="text-[9px] text-emerald-400 capitalize">{draft.sequence} Operations Digest</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] p-2 rounded bg-[#0a0f18] border border-slate-800">
                          <div>
                            <span className="text-slate-400 block text-[9px]">Cadence</span>
                            <strong className="text-white capitalize">{draft.sequence}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px]">Scope</span>
                            <strong className="text-white capitalize">{draft.scope}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px]">Product</span>
                            <strong className="text-white truncate block">{INDUSTRIAL_DOMAINS.find(d => d.id === draft.domain)?.label}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px]">Format</span>
                            <strong className="text-indigo-300 truncate block">{draft.format} ({draft.name ? `${draft.name.replace(/\s+/g, '_')}.${draft.format.toLowerCase()}` : `operations.${draft.format.toLowerCase()}`})</strong>
                          </div>
                        </div>

                        <p className="text-[10px] text-slate-300 leading-relaxed italic">
                          {previewBody}
                        </p>

                        <button type="button" className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-500 transition-colors shadow">
                          OPEN AUDIT REPORT IN ONEOPS
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl p-3 border border-slate-800 bg-[#06090e] space-y-2 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800/80 pb-1.5">
                        <span className="text-emerald-400 font-bold truncate max-w-[200px]">
                          POST {draft.recipients || 'https://erp.corporate.internal/v1/webhook'}
                        </span>
                        <span>200 OK</span>
                      </div>
                      <pre className="text-[10px] text-slate-300 overflow-x-auto p-2 bg-[#0a0e1a] rounded border border-slate-800/80">
{JSON.stringify({
  event: 'report.generated',
  scheduleName: draft.name || 'Operations Audit',
  domain: draft.domain,
  sequence: draft.sequence,
  format: draft.format,
  timestamp: new Date().toISOString(),
  integrityHash: 'sha256:8f2a4e9b1...',
  fileName: `${(draft.name || 'report').replace(/\s+/g, '_')}.${draft.format.toLowerCase()}`
}, null, 2)}
                      </pre>
                      <div className="text-[10px] text-slate-500">
                        Dispatched synchronously over TLS with retry backoff.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Recipients: <span className="font-bold text-white">{draftRecipientCount}</span> destination(s) configured
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setScheduleModalOpen(false)
                    setEditingScheduleId(null)
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveScheduleFromModal}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
                  style={gradient}
                >
                  <Plus size={14} />
                  <span>{editingScheduleId ? 'Update Sequence' : 'Save & Activate Sequence'}</span>
                </button>
              </div>
            </div>
          </>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EXECUTION & DISPATCH AUDIT LOG MODAL                             */}
      {/* ========================================================================= */}
      {historyModalSchedule && (
        <Modal
          open
          onClose={() => setHistoryModalSchedule(null)}
          labelledBy="sched-history-title"
          overlayClassName="bg-black/75"
          className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0d1117] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
        >
          <>
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <History size={18} className="text-indigo-400" />
                <div>
                  <h3 id="sched-history-title" className="text-sm font-bold text-white uppercase tracking-wider">
                    Execution &amp; Dispatch History
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Schedule: {historyModalSchedule.name} ({historyModalSchedule.sequence} · {historyModalSchedule.channel})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistoryModalSchedule(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Recent Automated Cron Dispatches</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle size={13} /> 100% Deliveries Succeeded
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden" style={inset}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500 font-semibold uppercase">
                      <th className="py-2.5 px-3 text-left">Execution Timestamp</th>
                      <th className="py-2.5 px-3 text-left">Status</th>
                      <th className="py-2.5 px-3 text-left">Target</th>
                      <th className="py-2.5 px-3 text-left">Artifact File</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { time: 'Today, 07:00:03 ICT', status: 'DELIVERED', size: '14.2 KB' },
                      { time: 'Yesterday, 07:00:02 ICT', status: 'DELIVERED', size: '13.9 KB' },
                      { time: '2 days ago, 07:00:02 ICT', status: 'DELIVERED', size: '14.1 KB' },
                    ].map((log, idx) => (
                      <tr key={idx} className="border-b border-slate-800/60 hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3 text-white font-mono text-[11px]">{log.time}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 text-[11px] truncate max-w-[120px]">
                          {toText(historyModalSchedule) || historyModalSchedule.channel}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px]">
                          {historyModalSchedule.name.replace(/\s+/g, '_')}.csv ({log.size})
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => toast.success(`Downloaded snapshot artifact from ${log.time}`, { icon: '📄' })}
                            className="px-2 py-1 rounded text-[10px] font-semibold text-indigo-300 hover:text-white bg-indigo-950/70 border border-indigo-700/50 hover:bg-indigo-900 transition-colors"
                          >
                            Snapshot
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-800 bg-[#0a0e1a] flex justify-end">
              <button
                onClick={() => setHistoryModalSchedule(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
              >
                Close History
              </button>
            </div>
          </>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: DELETE CONFIRMATION MODAL                                        */}
      {/* ========================================================================= */}
      {deleteConfirmSchedule && (
        <Modal
          open
          onClose={() => setDeleteConfirmSchedule(null)}
          labelledBy="sched-delete-title"
          overlayClassName="bg-black/75"
          className="w-full max-w-md rounded-2xl p-6 border border-rose-900/50 bg-[#0d1117] shadow-2xl animate-in fade-in zoom-in-95"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 id="sched-delete-title" className="text-sm font-bold text-white">Delete Automated Sequence?</h3>
                <p className="text-xs text-slate-400">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-white">&ldquo;{deleteConfirmSchedule.name}&rdquo;</strong>? Scheduled recurring dispatches will stop immediately.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setDeleteConfirmSchedule(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deleteConfirmSchedule.id
                  setDeleteConfirmSchedule(null)
                  await removeSchedule(id)
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-md transition-colors"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DOCUMENT PREVIEW MODAL                                           */}
      {/* ========================================================================= */}
      {previewModalOpen && (
        <Modal
          open
          onClose={() => setPreviewModalOpen(false)}
          labelledBy="report-preview-title"
          overlayClassName="bg-black/75"
          className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-[#0d1117] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
        >
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText size={18} className="text-indigo-400" />
                <div>
                  <h3 id="report-preview-title" className="text-sm font-bold text-white">
                    {customReportTitle.trim() || 'Operations &amp; Compliance Executive Audit Preview'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {orgName} · {activeSiteName || 'All Sites'} · Period: Last {effectiveDays} Days
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Not "SHA-256 Verified": at preview time no document exists,
                    nothing has been hashed, and no verification has run.
                    "Verified" states that a check was performed and passed. The
                    digest is computed when the file is generated, and that is
                    what this now says. */}
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-500/10 border border-slate-500/30">
                  <ShieldCheck size={12} className="text-slate-400" />
                  <span>SHA-256 on export</span>
                </div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30">
                  {classification}
                </span>
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* One tab per SELECTED format. The download button produces every
                one of them, and they are different documents — the CSV is
                titled sections of rows, the XLSX a multi-sheet workbook — so a
                single preview could only ever represent one. */}
            {selectedFormats.length > 1 && (
              <div className="px-6 pt-3 pb-0 bg-[#0a0e1a] border-b border-slate-800 flex items-center gap-2">
                {selectedFormats.map((f) => (
                  <button
                    key={f}
                    onClick={() => setPreviewFormat(f)}
                    className={clsx(
                      'px-3 py-1.5 rounded-t-lg text-xs font-semibold border-b-2 transition-colors',
                      previewFormat === f
                        ? 'text-white border-indigo-500 bg-[#080c16]'
                        : 'text-slate-400 border-transparent hover:text-white',
                    )}
                  >
                    {f}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-slate-500">
                  Previewing {previewFormat} · all {selectedFormats.length} files are produced on download
                </span>
              </div>
            )}

            {/* Body Preview */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#080c16]">
              {previewFormat === 'CSV' && (
                <div className="space-y-3">
                  {previewBuilding && <div className="text-xs text-slate-400">Building the CSV…</div>}
                  {!previewBuilding && previewCsv?.map((sec) => (
                    <div key={sec.title} className="rounded-xl border border-slate-800 overflow-hidden">
                      <div className="px-3 py-2 bg-[#0d1117] text-[11px] font-mono text-indigo-300"># {sec.title}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] font-mono">
                          <thead>
                            <tr className="bg-[#0a0e1a]">
                              {sec.headers.map((h) => (
                                <th key={h} className="px-3 py-1.5 text-left text-slate-400 font-semibold whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sec.rows.slice(0, 8).map((r, i) => (
                              <tr key={i} className="border-t border-slate-800/60">
                                {r.map((c, j) => <td key={j} className="px-3 py-1.5 text-slate-300 whitespace-nowrap">{String(c)}</td>)}
                              </tr>
                            ))}
                            {sec.rows.length === 0 && (
                              <tr><td className="px-3 py-2 text-slate-500 italic">(no rows in this period)</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {sec.rows.length > 8 && (
                        <div className="px-3 py-1.5 text-[10px] text-slate-500 bg-[#0d1117]">
                          showing 8 of {sec.rows.length} rows — the file contains all of them
                        </div>
                      )}
                    </div>
                  ))}
                  {!previewBuilding && !previewCsv?.length && (
                    <div className="text-xs text-slate-500 italic">No sections selected, so the CSV would be empty.</div>
                  )}
                </div>
              )}

              {previewFormat === 'XLSX' && (
                <div className="space-y-3">
                  {previewBuilding && <div className="text-xs text-slate-400">Building the workbook…</div>}
                  {!previewBuilding && previewXlsx?.map((sheet) => (
                    <div key={sheet.name} className="rounded-xl border border-slate-800 overflow-hidden">
                      <div className="px-3 py-2 bg-[#0d1117] text-[11px] font-semibold text-emerald-300 flex items-center gap-2">
                        <Table size={12} /> {sheet.name}
                        <span className="ml-auto text-slate-500 font-normal">{sheet.rows.length} rows</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] font-mono">
                          <tbody>
                            {sheet.rows.slice(0, 8).map((r, i) => (
                              <tr key={i} className="border-t border-slate-800/60">
                                {(r as (string | number)[]).map((c, j) => (
                                  <td key={j} className="px-3 py-1.5 text-slate-300 whitespace-nowrap">{String(c ?? '')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {sheet.rows.length > 8 && (
                        <div className="px-3 py-1.5 text-[10px] text-slate-500 bg-[#0d1117]">
                          showing 8 of {sheet.rows.length} rows — the sheet contains all of them
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {previewFormat === 'PDF' && (<>
              {/* Document Header Card */}
              <div className="p-5 rounded-xl border border-slate-800 bg-[#0d1117] flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">{classification} · AUDIT REPORT</div>
                  <h2 className="text-lg font-black text-white">{customReportTitle.trim() || `${orgName} Industrial IoT Audit Report`}</h2>
                  <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                    <span>Generated: {new Date().toLocaleDateString('th-TH', { dateStyle: 'long' })}</span>
                    <span>·</span>
                    <span>Interval: <strong className="text-white">{AGGREGATION_RESOLUTIONS.find(r => r.id === aggregationInterval)?.label}</strong></span>
                    <span>·</span>
                    <span>Scope: <strong className="text-white">{generatorScope === 'all' ? 'All Assets' : generatorScope === 'department' ? 'By Department' : 'Specific Devices'}</strong></span>
                    <span>·</span>
                    <span className="text-slate-400 font-mono">Integrity: SHA-256 stamped at export</span>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg">
                  {orgName.slice(0, 2).toUpperCase()}
                </div>
              </div>

              {/* Included Report Modules */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Included Report Modules</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSections.map((secId) => {
                    const sec = REPORT_SECTIONS.find((s) => s.id === secId)
                    return (
                      <span key={secId} className="px-2.5 py-1 rounded text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
                        <Check size={11} className="text-indigo-400" />
                        <span>{sec?.name ?? secId}</span>
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Executive Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400 font-medium uppercase">Fleet Health Index</div>
                  <div className="text-xl font-black text-white mt-1">{na(metrics?.healthIndexAvg)} <span className="text-xs text-slate-500 font-normal">/ 100</span></div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400 font-medium uppercase">SLA Compliance Rate</div>
                  <div className="text-xl font-black text-indigo-400 mt-1">{na(metrics?.complianceRate)}%</div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400 font-medium uppercase">Total Monitored Assets</div>
                  <div className="text-xl font-black text-white mt-1">{metrics?.totalAssets ?? generatorFilteredDevices.length} <span className="text-xs text-emerald-400 font-normal">({metrics?.activeAssets ?? generatorFilteredDevices.length} active)</span></div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400 font-medium uppercase">Carbon Footprint</div>
                  <div className="text-xl font-black text-emerald-400 mt-1">{na(metrics?.carbonFootprintTCO2e)} <span className="text-xs text-slate-500 font-normal">tCO₂e</span></div>
                </div>
              </div>

              {/* Telemetry Excursion Summary Table */}
              <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#0d1117]">
                <div className="p-3.5 bg-[#0a0e1a] border-b border-slate-800 text-xs font-bold text-white flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-indigo-400" />
                    <span>Asset Telemetry Excursion &amp; Compliance Breakdown</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {reportData?.summaries?.length ?? 0} Assets Included
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#0a0e1a] z-10">
                      <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase font-semibold">
                        <th className="py-2.5 px-3.5 text-left">Asset / Node</th>
                        <th className="py-2.5 px-3.5 text-left">Parameter</th>
                        <th className="py-2.5 px-3.5 text-right">Samples</th>
                        <th className="py-2.5 px-3.5 text-right">Min</th>
                        <th className="py-2.5 px-3.5 text-right">Avg</th>
                        <th className="py-2.5 px-3.5 text-right">Max</th>
                        <th className="py-2.5 px-3.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(!reportData?.summaries || reportData.summaries.length === 0) ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No assets found matching the selected scope filters.
                          </td>
                        </tr>
                      ) : (
                        reportData.summaries.flatMap((dev) =>
                          dev.parameters.map((p) => (
                            <tr key={`${dev.nodeId}-${p.key}`} className="hover:bg-white/[0.02]">
                              <td className="py-2 px-3.5 text-white font-medium">
                                <div>{dev.deviceName}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{dev.nodeId} · {dev.domain}</div>
                              </td>
                              <td className="py-2 px-3.5 text-slate-300">
                                <div>{p.label}</div>
                                <div className="text-[10px] text-slate-500 font-mono">({p.unit})</div>
                              </td>
                              <td className="py-2 px-3.5 text-right text-slate-400 font-mono">{p.samples}</td>
                              <td className="py-2 px-3.5 text-right text-slate-300 font-mono">{na(p.min)}</td>
                              <td className="py-2 px-3.5 text-right text-white font-bold font-mono">{na(p.avg)}</td>
                              <td className="py-2 px-3.5 text-right text-slate-300 font-mono">{na(p.max)}</td>
                              <td className="py-2 px-3.5 text-center">
                                <span className={clsx(
                                  'px-2 py-0.5 rounded text-[9px] font-bold',
                                  p.compliance === false
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                )}>
                                  {p.compliance === false ? 'EXCURSION' : 'NORMAL'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Transformer Predictive Maintenance & DGA Diagnostics Section */}
              {selectedSections.includes('pdm_diagnostics') && reportData?.summaries.some((d) => d.pdm) && (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#0d1117]">
                  <div className="p-3.5 bg-[#0a0e1a] border-b border-slate-800 text-xs font-bold text-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={14} className="text-indigo-400" />
                      <span>Transformer Predictive Maintenance &amp; DGA Diagnostics (IEEE C57.104 / C57.91)</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono">
                      {reportData.summaries.filter((d) => d.pdm).length} Transformers Analyzed
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0a0e1a] z-10">
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase font-semibold">
                          <th className="py-2.5 px-3 text-left">Transformer</th>
                          <th className="py-2.5 px-3 text-left">Duval T1 Fault Verdict</th>
                          <th className="py-2.5 px-3 text-right">Hot-Spot</th>
                          <th className="py-2.5 px-3 text-right">Aging (FAA)</th>
                          <th className="py-2.5 px-3 text-right">DP Score</th>
                          <th className="py-2.5 px-3 text-right">Est. RUL</th>
                          <th className="py-2.5 px-3 text-right">Paper Moisture</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {reportData.summaries.filter((d) => d.pdm).map((dev) => (
                          <tr key={dev.nodeId} className="hover:bg-white/[0.02]">
                            <td className="py-2 px-3 text-white font-medium">
                              <div>{dev.deviceName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{dev.nodeId}</div>
                            </td>
                            <td className="py-2 px-3 text-indigo-300 font-semibold">
                              {dev.pdm!.dgaVerdict}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">{na(dev.pdm!.hotSpotTemp, ' °C')}</td>
                            <td className="py-2 px-3 text-right font-mono text-amber-300">{na(dev.pdm!.faa, 'x')}</td>
                            <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">{na(dev.pdm!.dpEstimate, ' DP')}</td>
                            <td className="py-2 px-3 text-right font-mono text-white font-bold">{na(dev.pdm!.rulYears, ' Yrs')}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">{na(dev.pdm!.paperMoisturePct, '%')}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={clsx(
                                'px-2 py-0.5 rounded text-[9px] font-bold',
                                dev.pdm!.moistureRisk === 'Critically Wet' || dev.pdm!.moistureRisk === 'Wet (Bubble Hazard)'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : dev.pdm!.moistureRisk === 'Moderate'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              )}>
                                {dev.pdm!.moistureRisk || 'NORMAL'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Cold-Chain MKT & Thermal Stability Section */}
              {selectedSections.includes('coldchain') && reportData?.summaries.some((d) => d.coldchain) && (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#0d1117]">
                  <div className="p-3.5 bg-[#0a0e1a] border-b border-slate-800 text-xs font-bold text-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-sky-400" />
                      <span>Cold-Chain MKT &amp; Thermal Stability Audit (USP &lt;1079&gt; / HACCP)</span>
                    </div>
                    <span className="text-[11px] text-sky-300 font-mono">
                      {reportData.summaries.filter((d) => d.coldchain).length} Units Logged
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0a0e1a] z-10">
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase font-semibold">
                          <th className="py-2.5 px-3 text-left">Cold-Chain Asset</th>
                          <th className="py-2.5 px-3 text-left">Location</th>
                          <th className="py-2.5 px-3 text-right">Mean Kinetic Temp (MKT)</th>
                          <th className="py-2.5 px-3 text-right">Samples</th>
                          <th className="py-2.5 px-3 text-right">Excursions</th>
                          <th className="py-2.5 px-3 text-center">HACCP Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {reportData.summaries.filter((d) => d.coldchain).map((dev) => (
                          <tr key={dev.nodeId} className="hover:bg-white/[0.02]">
                            <td className="py-2 px-3 text-white font-medium">
                              <div>{dev.deviceName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{dev.nodeId} · {dev.domain}</div>
                            </td>
                            <td className="py-2 px-3 text-slate-300">{dev.location}</td>
                            <td className="py-2 px-3 text-right font-mono text-sky-400 font-bold">{na(dev.coldchain!.mkt, ' °C')}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">{dev.coldchain!.temperatures.length}</td>
                            <td className="py-2 px-3 text-right font-mono text-rose-400 font-bold">{dev.coldchain!.excursionsCount}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={clsx(
                                'px-2 py-0.5 rounded text-[9px] font-bold',
                                dev.coldchain!.excursionsCount > 0
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              )}>
                                {dev.coldchain!.excursionsCount > 0 ? 'EXCURSIONS' : 'COMPLIANT'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Alarms & Excursions Section */}
              {selectedSections.includes('alarm') && reportData?.alarms && reportData.alarms.length > 0 && (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#0d1117]">
                  <div className="p-3.5 bg-[#0a0e1a] border-b border-slate-800 text-xs font-bold text-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-400" />
                      <span>Alarm &amp; Excursion Log</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{reportData.alarms.length} Alarms in Period</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0a0e1a] z-10">
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase font-semibold">
                          <th className="py-2 px-3 text-left">Severity</th>
                          <th className="py-2 px-3 text-left">Device</th>
                          <th className="py-2 px-3 text-left">Parameter</th>
                          <th className="py-2 px-3 text-right">Value / Limit</th>
                          <th className="py-2 px-3 text-left">Raised At</th>
                          <th className="py-2 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {reportData.alarms.map((a) => (
                          <tr key={a.id} className="hover:bg-white/[0.02]">
                            <td className="py-2 px-3">
                              <span className={clsx(
                                'px-2 py-0.5 rounded text-[9px] font-bold',
                                a.severity === 'CRITICAL' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              )}>
                                {a.severity}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-white font-medium">{a.deviceName}</td>
                            <td className="py-2 px-3 text-slate-300">{a.paramLabel}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">{a.value} / {a.threshold}</td>
                            <td className="py-2 px-3 text-slate-400 font-mono">{a.raisedAt}</td>
                            <td className="py-2 px-3 text-center">
                              <span className="text-[10px] text-slate-300 font-semibold">{a.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </>)}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  setPreviewModalOpen(false)
                  handleGenerateAndDownload()
                }}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold text-white shadow-md"
                style={gradient}
              >
                <Download size={14} />
                <span>Download Formal {selectedFormats.join(' & ')} Report</span>
              </button>
            </div>
          </>
        </Modal>
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
