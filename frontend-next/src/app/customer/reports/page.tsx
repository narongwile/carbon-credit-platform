'use client'

// ---------------------------------------------------------------------------
// Was entirely fabricated: three hardcoded report rows dated May/April 2024,
// and a Download button with no onClick at all — it did not do anything.
//
// Rebuilt on the same real generator admin/reports/page.tsx already uses
// (GET /api/reports/download, with a client-side jsPDF fallback), which is
// now safe to expose to a viewer: it used to enforce no department/product
// scoping beyond a bare login, so a viewer could set scope/scopeId directly
// and read another department's — or, via scope=device with a guessed node
// id, another ORGANIZATION's — telemetry. Fixed server-side (reportsDownloadFunc)
// before wiring this page to it: a non-admin caller's result is now narrowed
// to exactly the devices useManagedDevices() already limits this page to.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { useSessionOrgId } from '@/lib/auth'
import { api } from '@/lib/api'
import { FileBarChart, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

export default function CustomerReportsPage() {
  const orgId = useSessionOrgId()
  // GET /api/fleet, already scoped to this viewer's accessible products —
  // the same source every other real page on this portal uses, so this page
  // can never list or summarise a device the viewer could not otherwise see.
  const { devices } = useManagedDevices(orgId)
  const [days, setDays] = useState(30)
  const [format, setFormat] = useState<'CSV' | 'PDF'>('CSV')
  const [busy, setBusy] = useState(false)

  const clientCSV = () => {
    const header = 'Device,Domain,Site,Status,Last Value'
    const rows = devices.map((d) => [d.name, String(d.domain ?? d.deviceType), d.location, d.status, d.lastValue ?? '—'].join(','))
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report_${orgId}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // The PDF used to table the device ROSTER (name/site/status/last value) while
  // the CSV returned the readings SUMMARY — two different reports behind one
  // "Range: last N days" control, and the roster ignored the range entirely.
  // Both now render the same readings summary the backend computes, so the
  // format picker changes the file type and nothing else.
  const downloadPDF = async () => {
    const summary = await api.reportSummary({ days })
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(18); doc.setTextColor(99, 102, 241)
    doc.text('ONEOPS — My Devices Report', 14, 20)
    doc.setFontSize(10); doc.setTextColor(90, 90, 90)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30)
    doc.text(`Range: last ${days} days`, 14, 36)

    const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id
    if (summary && summary.length) {
      autoTable(doc, {
        startY: 44,
        head: [['Device', 'Parameter', 'Samples', 'Avg', 'Min', 'Max']],
        body: summary.map((r) => [nameOf(r.node_id), r.param_key, r.samples, r.avg, r.min, r.max]),
        theme: 'striped',
        headStyles: { fillColor: [99, 102, 241] },
      })
    } else {
      // Explicit, rather than an empty table that reads as a broken export.
      doc.setFontSize(11); doc.setTextColor(140, 140, 140)
      doc.text(`No readings recorded in the last ${days} days for your ${devices.length} device(s).`, 14, 50)
    }
    doc.save(`report_${orgId}_${Date.now()}.pdf`)
  }

  const generate = async () => {
    if (devices.length === 0) { toast.error('No devices available to report on'); return }
    setBusy(true)
    try {
      if (format === 'CSV') {
        // The real readings-summary CSV (samples/avg/min/max per parameter),
        // narrowed server-side to this viewer's accessible devices; falls
        // back to a device-snapshot CSV built client-side if the API is
        // unreachable, so a real click still produces a real file.
        const ok = await api.downloadReport({ days })
        if (!ok) clientCSV()
      } else {
        await downloadPDF()
      }
      toast.success(`${format} report downloaded`)
    } catch {
      toast.error('Failed to generate report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Reports</h1>
        <p className="text-sm text-slate-500">Download a summary of your devices&apos; readings</p>
      </div>

      <div className="rounded-xl p-5 space-y-4 max-w-lg" style={surface}>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Range</label>
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <button key={r.days} onClick={() => setDays(r.days)}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={days === r.days ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1', color: '#fff' } : { ...inset, color: '#94a3b8' }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Format</label>
          <div className="flex gap-2">
            {(['CSV', 'PDF'] as const).map((f) => (
              <button key={f} onClick={() => setFormat(f)}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={format === f ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1', color: '#fff' } : { ...inset, color: '#94a3b8' }}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {busy ? 'Generating…' : `Download ${format}`}
        </button>
        <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
          <FileBarChart size={12} className="mt-0.5 flex-shrink-0" />
          Covers {devices.length} device{devices.length === 1 ? '' : 's'} you have access to.
        </p>
      </div>
    </div>
  )
}
