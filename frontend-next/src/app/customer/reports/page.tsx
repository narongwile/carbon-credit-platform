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

import { useState, useEffect } from 'react'
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

export default function CustomerReportsPage() {
  const orgId = useSessionOrgId()
  const { orgNames } = useAppStore()
  const orgName = orgNames[orgId] || 'ETERNITY'

  // Fleet scoped to this viewer's accessible products and departments
  const { devices } = useManagedDevices(orgId)
  const [days, setDays] = useState(30)
  const [format, setFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF')
  const [busy, setBusy] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('all')

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
      days,
      nodeId: selectedNodeId,
      selectedTypes: ['health', 'energy', 'alarm', 'executive'],
      format,
      devices,
    }).then((res) => {
      if (!cancelled) setReportData(res)
    })
    return () => { cancelled = true }
  }, [orgId, orgName, days, selectedNodeId, format, devices])

  const generate = async () => {
    if (devices.length === 0) {
      toast.error('No devices available in your accessible fleet')
      return
    }
    setBusy(true)
    try {
      const data = reportData || await buildIIoTReportData({
        orgId,
        orgName,
        days,
        nodeId: selectedNodeId,
        selectedTypes: ['health', 'energy', 'alarm', 'executive'],
        format,
        devices,
      })

      const reportOpts = {
        orgId,
        orgName,
        days,
        nodeId: selectedNodeId,
        selectedTypes: ['health', 'energy', 'alarm', 'executive'],
        format,
        devices,
      }

      if (format === 'PDF') {
        await exportIIoTPDF(reportOpts, data)
        toast.success(`Executive PDF report downloaded`)
      } else if (format === 'XLSX') {
        exportIIoTXLSX(reportOpts, data)
        toast.success(`Multi-sheet Excel report downloaded`)
      } else {
        exportIIoTCSV(reportOpts, data)
        toast.success(`Structured CSV report downloaded`)
      }
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
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Reporting Time Window
            </label>
            <div className="flex gap-2">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={clsx(
                    'flex-1 py-2 rounded-lg text-xs font-semibold transition-colors',
                    days === r.days
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Export Format &amp; Document Type
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['PDF', 'XLSX', 'CSV'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={clsx(
                  'flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all border',
                  format === f
                    ? 'bg-indigo-950/40 border-indigo-500 text-white shadow-sm'
                    : 'bg-[#0a0e1a] border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                )}
              >
                {f === 'PDF' && <FileText size={15} className="text-rose-400" />}
                {f === 'XLSX' && <FileSpreadsheet size={15} className="text-emerald-400" />}
                {f === 'CSV' && <FileBarChart size={15} className="text-indigo-400" />}
                <span>
                  {f === 'PDF' ? 'Executive PDF Report' : f === 'XLSX' ? 'Multi-Sheet Excel (.xlsx)' : 'RFC 4180 CSV'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-3 border-t border-slate-800">
          <button
            onClick={generate}
            disabled={busy || devices.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-white shadow-md disabled:opacity-50 transition-transform active:scale-95"
            style={gradient}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span>{busy ? 'Compiling Official Report...' : `Download ${format} Report (${orgName})`}</span>
          </button>
        </div>
      </div>

      {/* On-Screen Telemetry Summary Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Monitored Assets Preview</h3>
          </div>
          <span className="text-xs text-slate-400 font-semibold">
            {reportData?.summaries.length ?? 0} Assets Loaded
          </span>
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
            {reportData?.summaries.map((dev) => {
              const topParam = dev.parameters[0]
              return (
                <tr key={dev.nodeId} style={{ borderBottom: '1px solid #1e2433' }} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 px-4 text-white font-bold">{dev.deviceName}</td>
                  <td className="py-3.5 px-4 text-slate-400 capitalize">{dev.domain}</td>
                  <td className="py-3.5 px-4 text-slate-300">{dev.location}</td>
                  <td className="py-3.5 px-4">
                    {/* An unscored device reads as unscored — a grey dash, not
                        a red 0/100 that looks like a measured failure. */}
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
