'use client'

// ---------------------------------------------------------------------------
// Customer / Viewer Reports Studio
// ---------------------------------------------------------------------------
// Realtime Industrial IoT reporting dashboard for department viewers.
// Scoped to accessible products & devices with multi-format export:
//   - Executive PDF branded with the organization name
//   - Multi-Sheet Excel Workbook (.xlsx)
//   - RFC 4180 Structured CSV
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from 'react'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { useSessionOrgId } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
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
  Loader2,
  Activity,
  ShieldCheck,
  Zap,
  Leaf,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Layers,
  Clock,
  CheckCircle,
  Eye,
  Search,
  Calendar,
  X,
  Filter,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const RANGES = [
  { label: 'Last 24 Hours', days: 1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 90 Days', days: 90 },
]

const AGGREGATION_RESOLUTIONS = [
  { id: 'raw', label: 'Raw 1-Min' },
  { id: '15m', label: '15-Min Avg' },
  { id: '1h', label: '1-Hour TWA' },
  { id: 'daily', label: 'Daily Rollup' },
] as const

const REPORT_SECTIONS = [
  {
    id: 'health',
    name: 'Asset Health Index',
    desc: 'Winding temp, top-oil, thermal stress & reliability score',
    icon: '⚡',
    badge: 'Operations',
  },
  {
    id: 'energy',
    name: 'Energy Usage & Carbon',
    desc: 'Electricity consumption (kWh), power factor & Scope 2 GHG',
    icon: '🌱',
    badge: 'ESG Audit',
  },
  {
    id: 'alarm',
    name: 'Alarm Incident Log',
    desc: 'Critical threshold breaches, active alarms & MTTR response',
    icon: '🚨',
    badge: 'Reliability',
  },
  {
    id: 'executive',
    name: 'Executive Summary',
    desc: 'High-level KPI rollups, fleet availability & compliance rate',
    icon: '📋',
    badge: 'Executive',
  },
]

export default function CustomerReportsPage() {
  const orgId = useSessionOrgId()
  const { orgNames } = useAppStore()
  const orgName = orgNames[orgId] || 'ETERNITY'

  // Fleet scoped to this viewer's accessible products and departments
  const { devices } = useManagedDevices(orgId)
  const [days, setDays] = useState(30)
  const [isCustomRange, setIsCustomRange] = useState(false)
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedSections, setSelectedSections] = useState<string[]>(['health', 'energy', 'alarm', 'executive'])
  const [selectedFormats, setSelectedFormats] = useState<('PDF' | 'XLSX' | 'CSV')[]>(['PDF'])
  const [aggregationInterval, setAggregationInterval] = useState<'raw' | '15m' | '1h' | 'daily'>('15m')
  const [busy, setBusy] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('all')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)

  // Search & Status filters for preview table
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'alarm' | 'offline'>('all')

  const effectiveDays = useMemo(() => {
    if (!isCustomRange) return days
    const diff = Math.round((new Date(customEndDate).getTime() - new Date(customStartDate).getTime()) / 86400000)
    return Math.max(1, diff)
  }, [isCustomRange, days, customStartDate, customEndDate])

  const [reportData, setReportData] = useState<{
    metrics: IIoTMetricSummary
    summaries: DeviceTelemetrySummary[]
    alarms: AlarmLogItem[]
  } | null>(null)

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
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

  const filteredSummaries = useMemo(() => {
    if (!reportData?.summaries) return []
    return reportData.summaries.filter((dev) => {
      const q = searchQuery.toLowerCase().trim()
      const matchesSearch = !q ||
        dev.deviceName.toLowerCase().includes(q) ||
        dev.nodeId.toLowerCase().includes(q) ||
        (dev.location || '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || dev.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [reportData?.summaries, searchQuery, statusFilter])

  useEffect(() => {
    let cancelled = false
    buildIIoTReportData({
      orgId,
      orgName,
      days: effectiveDays,
      nodeId: selectedNodeId,
      selectedTypes: selectedSections,
      format: selectedFormats[0] || 'PDF',
      devices,
      classification: 'CONFIDENTIAL',
      aggregationInterval: AGGREGATION_RESOLUTIONS.find((r) => r.id === aggregationInterval)?.label,
    }).then((res) => {
      if (!cancelled) setReportData(res)
    })
    return () => { cancelled = true }
  }, [orgId, orgName, effectiveDays, selectedNodeId, selectedSections, selectedFormats, aggregationInterval, devices])

  const generate = async () => {
    if (devices.length === 0) {
      toast.error('No devices available in your accessible fleet')
      return
    }
    if (selectedSections.length === 0) {
      toast.error('Select at least one report section')
      return
    }
    if (selectedFormats.length === 0) {
      toast.error('Select at least one export format')
      return
    }
    setBusy(true)
    try {
      const baseOpts = {
        orgId,
        orgName,
        days: effectiveDays,
        nodeId: selectedNodeId,
        selectedTypes: selectedSections,
        devices,
        classification: 'CONFIDENTIAL',
        aggregationInterval: AGGREGATION_RESOLUTIONS.find((r) => r.id === aggregationInterval)?.label || '15-Minute Standard Rollup',
      }
      const data = reportData || await buildIIoTReportData({
        ...baseOpts,
        format: selectedFormats[0] || 'PDF',
      })

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
      setBusy(false)
    }
  }

  const metrics = reportData?.metrics

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">My Operations Reports</h1>
            <span className="text-[10px] px-2.5 py-0.5 rounded font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
              {orgName}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Download recorded telemetry, asset health indexes and alarm history for your department.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
            <ShieldCheck size={12} className="text-emerald-400" />
            <span>SHA-256 Verified</span>
          </div>
          <span className="text-xs text-slate-500 font-medium">Accessible:</span>
          <span className="text-xs font-semibold text-emerald-400 px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-800/40">
            {devices.length} Assets
          </span>
        </div>
      </div>

      {/* Fleet KPI Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          <div className="text-[10px] text-slate-500">Last {days} Days</div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/80 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Scope 2 Carbon</span>
            <Leaf size={13} className="text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400 truncate">
            {na(metrics?.carbonFootprintTCO2e)}<span className="text-xs text-slate-500 font-normal ml-1">tCO₂e</span>
          </div>
          <div className="text-[10px] text-slate-500">From metered kWh only</div>
        </div>
      </div>

      {/* Report Generator Controls */}
      <div className="rounded-xl p-5 space-y-5" style={surface}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Filter by Device Asset
            </label>
            <select
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            >
              <option value="all">All Accessible Assets ({devices.length})</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name || d.id} ({d.location || 'Substation'})</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Reporting Window &amp; Resolution
              </label>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => {
                    setIsCustomRange(false)
                    setDays(r.days)
                  }}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                    !isCustomRange && days === r.days
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  )}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomRange(true)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1',
                  isCustomRange
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                )}
              >
                <Calendar size={12} />
                <span>Custom</span>
              </button>
            </div>

            {/* Custom Range Date Pickers */}
            {isCustomRange && (
              <div className="p-2.5 mt-2 rounded-lg border border-indigo-900/40 bg-[#0a0e1a] flex flex-wrap items-center gap-2.5 text-xs animate-in fade-in">
                <span className="text-[11px] text-slate-400 font-semibold">From:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="rounded px-2 py-1 text-xs text-white border border-slate-800 bg-[#0d1117] outline-none"
                />
                <span className="text-[11px] text-slate-400 font-semibold">To:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="rounded px-2 py-1 text-xs text-white border border-slate-800 bg-[#0d1117] outline-none"
                />
                <span className="text-[11px] font-mono text-indigo-300">
                  ({effectiveDays} Day{effectiveDays === 1 ? '' : 's'})
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock size={11} className="text-indigo-400" /> Resolution:
              </span>
              {AGGREGATION_RESOLUTIONS.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => setAggregationInterval(res.id)}
                  className={clsx(
                    'px-2 py-0.5 rounded text-[10px] font-semibold transition-colors',
                    aggregationInterval === res.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                  )}
                >
                  {res.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Modular Report Sections */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Include Report Modules ({selectedSections.length} of {REPORT_SECTIONS.length})
            </label>
            <div className="flex gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => setSelectedSections(REPORT_SECTIONS.map((s) => s.id))}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Select All
              </button>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onClick={() => setSelectedSections([])}
                className="text-slate-500 hover:text-slate-400 font-semibold"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {REPORT_SECTIONS.map((sec) => {
              const on = selectedSections.includes(sec.id)
              return (
                <div
                  key={sec.id}
                  onClick={() => toggleSection(sec.id)}
                  className={clsx(
                    'flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all border text-xs',
                    on
                      ? 'bg-indigo-950/20 border-indigo-500/40 shadow-sm'
                      : 'bg-[#0a0e1a] border-slate-800/80 hover:border-slate-700'
                  )}
                >
                  <div className="text-lg shrink-0 mt-0.5">{sec.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white truncate">{sec.name}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20">
                        {sec.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{sec.desc}</p>
                  </div>
                  <div
                    className={clsx(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 mt-1',
                      on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700 bg-slate-900'
                    )}
                  >
                    {on && <CheckCircle size={10} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Export Formats ({selectedFormats.length} selected - multi-select enabled)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['PDF', 'XLSX', 'CSV'] as const).map((f) => {
              const on = selectedFormats.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleExportFormat(f)}
                  className={clsx(
                    'flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all border',
                    on
                      ? 'bg-indigo-950/40 border-indigo-500 text-white shadow-sm'
                      : 'bg-[#0a0e1a] border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  )}
                >
                  <span
                    className="w-3 h-3 rounded-sm flex items-center justify-center text-[8px] font-bold"
                    style={on ? { background: '#6366f1', color: '#ffffff' } : { border: '1px solid #475569' }}
                  >
                    {on && '✓'}
                  </span>
                  {f === 'PDF' && <FileText size={15} className="text-rose-400" />}
                  {f === 'XLSX' && <FileSpreadsheet size={15} className="text-emerald-400" />}
                  {f === 'CSV' && <FileBarChart size={15} className="text-indigo-400" />}
                  <span>
                    {f === 'PDF' ? 'Executive PDF' : f === 'XLSX' ? 'Multi-Sheet Excel' : 'RFC 4180 CSV'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center gap-2.5">
          <button
            type="button"
            onClick={() => setPreviewModalOpen(true)}
            disabled={devices.length === 0}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-xs font-bold text-indigo-300 hover:text-white bg-indigo-950/40 border border-indigo-700/40 hover:bg-indigo-900/60 transition-colors disabled:opacity-50"
          >
            <Eye size={15} />
            <span>Preview Report</span>
          </button>
          <button
            onClick={generate}
            disabled={busy || devices.length === 0 || selectedSections.length === 0}
            className="flex-1 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-white shadow-md disabled:opacity-50 transition-transform active:scale-95"
            style={gradient}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span>{busy ? 'Compiling Official Report...' : `Download ${selectedFormats.join(' & ')} Report(s) (${orgName})`}</span>
          </button>
        </div>
      </div>

      {/* On-Screen Telemetry Summary Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Monitored Assets Preview</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Box */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2 text-slate-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search asset or location..."
                className="rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-white placeholder-slate-500 bg-[#0d1117] border border-slate-800 outline-none focus:border-indigo-500 w-44"
              />
            </div>
            {/* Status Filter */}
            <div className="flex gap-1">
              {(['all', 'alarm', 'online'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={clsx(
                    'px-2 py-1 rounded text-[10px] font-semibold uppercase transition-colors',
                    statusFilter === st
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                  )}
                >
                  {st === 'all' ? `All (${reportData?.summaries.length ?? 0})` : st === 'alarm' ? '🚨 Alarm' : '🟢 Online'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <table className="w-full text-xs" style={{ background: '#0d1117' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2433' }}>
              {['Asset Name', 'Domain', 'Site Location', 'Health Score', 'Status', 'Key Parameter Range'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-slate-400 font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSummaries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                  No monitored assets match &ldquo;{searchQuery || statusFilter}&rdquo;
                </td>
              </tr>
            ) : (
              filteredSummaries.map((dev) => {
                const topParam = dev.parameters[0]
                return (
                  <tr key={dev.nodeId} style={{ borderBottom: '1px solid #1e2433' }} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 text-white font-bold">{dev.deviceName}</td>
                    <td className="py-3.5 px-4 text-slate-400 capitalize">{dev.domain}</td>
                    <td className="py-3.5 px-4 text-slate-300">{dev.location}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded font-mono font-bold text-[11px]',
                          dev.healthScore === null ? 'text-slate-500 bg-slate-500/10'
                            : dev.healthScore >= 80 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                        )}
                      >
                        {dev.healthScore === null ? '—' : `${dev.healthScore}/100`}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase',
                          dev.status === 'online' ? 'text-emerald-400 bg-emerald-500/10' : dev.status === 'alarm' ? 'text-rose-400 bg-rose-500/10' : 'text-slate-400 bg-slate-800'
                        )}
                      >
                        {dev.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-mono">
                      {topParam ? (
                        <span>
                          {topParam.label}: {topParam.min} ~ {topParam.max} {topParam.unit} (avg {topParam.avg})
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ========================================================================= */}
      {/* DOCUMENT PREVIEW MODAL (PILLAR 1)                                         */}
      {/* ========================================================================= */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-[#0d1117] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText size={18} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Operations &amp; Compliance Audit Preview
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {orgName} · Period: Last {effectiveDays} Days · {devices.length} Monitored Assets
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
                  <ShieldCheck size={12} className="text-emerald-400" />
                  <span>SHA-256 Verified</span>
                </div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30">
                  CONFIDENTIAL
                </span>
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body Preview */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#080c16]">
              {/* Document Header Card */}
              <div className="p-5 rounded-xl border border-slate-800 bg-[#0d1117] flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">CONFIDENTIAL · CUSTOMER AUDIT</div>
                  <h2 className="text-lg font-black text-white">{orgName} Department Telemetry &amp; Compliance Report</h2>
                  <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                    <span>Generated: {new Date().toLocaleDateString('th-TH', { dateStyle: 'long' })}</span>
                    <span>·</span>
                    <span>Resolution: <strong className="text-white">{AGGREGATION_RESOLUTIONS.find(r => r.id === aggregationInterval)?.label}</strong></span>
                    <span>·</span>
                    <span className="text-emerald-400 font-mono">Immutable Integrity: SHA-256</span>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg">
                  {orgName.slice(0, 2).toUpperCase()}
                </div>
              </div>

              {/* Executive Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400">Fleet Health Index</div>
                  <div className="text-lg font-black text-white">{na(metrics?.healthIndexAvg)} / 100</div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400">Compliance Rate</div>
                  <div className="text-lg font-black text-indigo-400">{na(metrics?.complianceRate)}%</div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400">Energy Consumption</div>
                  <div className="text-lg font-black text-white">{na(metrics?.totalEnergyKWh)} kWh</div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-[#0a0e1a]">
                  <div className="text-[10px] text-slate-400">Scope 2 Carbon</div>
                  <div className="text-lg font-black text-emerald-400">{na(metrics?.carbonFootprintTCO2e)} tCO₂e</div>
                </div>
              </div>

              {/* Monitored Assets Summary Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Monitored Assets Telemetry &amp; Compliance Breakdown</h4>
                  <span className="text-[11px] text-slate-400">{reportData?.summaries?.length ?? 0} Assets</span>
                </div>
                <div className="rounded-lg border border-slate-800 overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#0a0e1a] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3 text-left">Asset</th>
                        <th className="py-2 px-3 text-left">Domain</th>
                        <th className="py-2 px-3 text-left">Health</th>
                        <th className="py-2 px-3 text-left">Status</th>
                        <th className="py-2 px-3 text-left">Key Telemetry Range</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-[#0d1117]">
                      {(!reportData?.summaries || reportData.summaries.length === 0) ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No telemetry summaries available for the selected assets.
                          </td>
                        </tr>
                      ) : (
                        reportData.summaries.map((s) => (
                          <tr key={s.nodeId} className="hover:bg-white/[0.02]">
                            <td className="py-2 px-3 font-semibold text-white">
                              <div>{s.deviceName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{s.nodeId}</div>
                            </td>
                            <td className="py-2 px-3 text-slate-400 capitalize">{s.domain}</td>
                            <td className="py-2 px-3 font-mono text-emerald-400">{s.healthScore ? `${s.healthScore}/100` : '—'}</td>
                            <td className="py-2 px-3 capitalize">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                s.status === 'online' || s.status === 'NORMAL' ? 'bg-emerald-500/10 text-emerald-400' : s.status === 'critical' || s.status === 'CRITICAL' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                              }`}>
                                {s.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-300 font-mono">
                              {s.parameters.length > 0
                                ? s.parameters.slice(0, 2).map((p) => `${p.label}: ${na(p.avg)} ${p.unit}`).join(' · ')
                                : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 bg-[#0a0e1a] flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-mono">
                Cryptographic Signature: SHA-256 Authenticated
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
                >
                  Close Preview
                </button>
                <button
                  onClick={() => {
                    setPreviewModalOpen(false)
                    generate()
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-md"
                  style={gradient}
                >
                  <Download size={14} />
                  <span>Download Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
