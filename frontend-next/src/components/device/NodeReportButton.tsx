'use client'

// ---------------------------------------------------------------------------
// Download a report for one device, from the device page header.
// ---------------------------------------------------------------------------
// Pick a period and a file type; the data comes from GET /api/nodes/:id/report
// (hourly min/avg/max per parameter, alarms, connectivity) and the same builder
// feeds every format, so a PDF and a workbook of the same period always agree.
//
// History is real: raw readings are kept for READINGS_RETENTION_DAYS (30) and
// hourly buckets in readings_rollup after that, so periods longer than a month
// still report — at hourly resolution.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { buildDeviceReport, type DeviceReport } from '@/lib/deviceReport'
import { fetchPhotoDataUrl } from '@/lib/photoDataUrl'
import { getOrgLogoDataUrl } from '@/lib/orgLogoDataUrl'
import { useAppStore } from '@/lib/store'
import { downloadCSVSections, downloadText, sectionsDigest } from '@/lib/exportFile'
import { downloadXLSX } from '@/lib/xlsx'
import type { SensorDomain } from '@/types/fleet'
import { Download, FileText, FileSpreadsheet, FileJson, Loader2, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

type Format = 'pdf' | 'xlsx' | 'csv' | 'json'

const RANGES = [
  { id: '24h', label: 'Last 24 hours', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'custom', label: 'Custom range', days: 0 },
] as const

const FORMATS: { id: Format; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Printable summary', icon: <FileText size={13} /> },
  { id: 'xlsx', label: 'Excel', hint: 'One sheet per section', icon: <FileSpreadsheet size={13} /> },
  { id: 'csv', label: 'CSV', hint: 'All sections, one file', icon: <FileSpreadsheet size={13} /> },
  { id: 'json', label: 'JSON', hint: 'Raw payload', icon: <FileJson size={13} /> },
]

/** Local date (yyyy-mm-dd) for the <input type="date"> defaults. */
const dayInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// A real instant (ISO with 'Z') — see the identical fix in ParamHistoryModal.tsx.
// Every reportFunc window (readings, alarm_events, transport_events,
// offline_sync_log) is written in the DB's own +07:00 wall-clock, not UTC;
// sending a zone-stripped string here silently truncated every report to data
// no more recent than roughly (now - 7h), including the "last 7 days" default.
const toUTC = (d: Date) => d.toISOString()

export default function NodeReportButton({
  nodeId, deviceName, domain,
}: { nodeId: string; deviceName?: string; domain?: SensorDomain }) {
  const live = useIsLive()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Format | null>(null)
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('7d')
  const [from, setFrom] = useState(dayInput(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(dayInput(new Date()))
  const boxRef = useRef<HTMLDivElement>(null)

  // Close on an outside click — the panel overlays the page content.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const period = (): { from: string; to: string } => {
    if (range === 'custom') {
      // Whole local days, inclusive of the end date.
      const start = new Date(`${from}T00:00:00`)
      const end = new Date(`${to}T23:59:59`)
      return { from: toUTC(start), to: toUTC(end) }
    }
    const days = RANGES.find((r) => r.id === range)?.days ?? 7
    return { from: toUTC(new Date(Date.now() - days * 86400000)), to: toUTC(new Date()) }
  }

  const exportPDF = async (report: DeviceReport) => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF({ orientation: 'landscape' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // The photo goes in the top-right corner: whoever reads a printed report
    // away from the dashboard — a contractor, an insurer — gets the same "is
    // this the right unit" recognition the live pages give, on paper. Fetched
    // at report time, not baked into buildDeviceReport, since only the PDF
    // format can hold an image; CSV/XLSX/JSON stay data-only.
    const cover = await api.nodePhotos(nodeId).then((r) => r?.photos?.[0] ?? null)
    let photoBottom = 0
    if (cover) {
      const photo = await fetchPhotoDataUrl(nodeId, cover.id, { thumb: true, v: cover.updatedAt, width: cover.width ?? undefined, height: cover.height ?? undefined })
      if (photo) {
        const maxW = 46, maxH = 32
        const scale = Math.min(maxW / photo.width, maxH / photo.height)
        const w = photo.width * scale, h = photo.height * scale
        const x = pageWidth - 14 - w
        try {
          doc.addImage(photo.dataUrl, photo.format, x, 12, w, h)
          doc.setDrawColor(200, 200, 200)
          doc.rect(x, 12, w, h)
          photoBottom = 12 + h
          if (cover.caption) {
            // slate-600, not (120,120,120): at 7pt on this page's white
            // background that measured 4.42:1 — under the 4.5:1 AA floor for
            // normal-size text. slate-600 (71,85,105) is 7.58:1.
            doc.setFontSize(7); doc.setTextColor(71, 85, 105)
            doc.text(cover.caption, x + w / 2, photoBottom + 4, { align: 'center', maxWidth: w })
            photoBottom += 4
          }
        } catch {
          // A malformed data URL must not fail the whole report — the tables
          // are the substance; the photo is a bonus.
        }
      }
    }

    // Render Organization Logo on the top left
    let textLeftX = 14
    let logoBottom = 0
    try {
      const orgId = useAppStore.getState().selectedOrgId
      const orgName = useAppStore.getState().orgNames[orgId]
      const orgLogo = await getOrgLogoDataUrl(orgId, orgName)
      if (orgLogo?.dataUrl) {
        const maxW = 24, maxH = 20
        const scale = Math.min(maxW / orgLogo.width, maxH / orgLogo.height)
        const w = orgLogo.width * scale, h = orgLogo.height * scale
        doc.addImage(orgLogo.dataUrl, orgLogo.format, 14, 12, w, h, undefined, 'FAST')
        textLeftX = 14 + w + 5
        logoBottom = 12 + h
      }
    } catch {}

    doc.setFontSize(16); doc.setTextColor(99, 102, 241)
    doc.text(report.title, textLeftX, 16)
    // slate-600, matching the same fix in DeviceExportDialog.tsx and
    // iiotReportGenerator.ts — this meta block is the closest thing this
    // report has to a subheading, and (90,90,90) undershoots the AA floor
    // once font size and print reproduction are taken into account.
    doc.setFontSize(9); doc.setTextColor(71, 85, 105)
    report.meta.forEach((line, i) => doc.text(line, textLeftX, 23 + i * 4.8))
    // Leave room for the photo and the logo if either is taller than the meta block, so the
    // first table never starts underneath them.
    let y = Math.max(26 + report.meta.length * 5, photoBottom + 10, logoBottom + 10)

    for (const section of report.sections) {
      doc.setFontSize(11); doc.setTextColor(30, 30, 30)
      // A section heading must not be the last thing on a page.
      if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 20 }
      doc.text(section.title, 14, y)
      autoTable(doc, {
        startY: y + 3,
        head: [section.headers],
        // autoTable prints an empty table as a bare header; say so instead.
        body: section.rows.length ? section.rows.map((r) => r.map((c) => (c === null ? '—' : String(c)))) : [[`No data in this period`, ...section.headers.slice(1).map(() => '')]],
        theme: 'striped',
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [99, 102, 241], fontSize: 7 },
        margin: { left: 14, right: 14 },
      })
      // jspdf-autotable records where it stopped on the doc it just drew into.
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 10
    }
    // Same digest the CSV of this report prints, on every page.
    //
    // This button's PDF renders its own jsPDF document rather than going
    // through printTablePDF, so the integrity line added to the shared
    // exporters never reached it — the report an engineer downloads from the
    // dashboard's Report menu went out with nothing a recipient could check it
    // against, while the CSV of the very same report carried one.
    const digest = sectionsDigest(report.sections)
    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFont('courier', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(120, 130, 145)
      doc.text(
        `Snapshot SHA-256: ${digest}  ·  covers every section header and data row in this report`,
        14,
        doc.internal.pageSize.getHeight() - 6,
      )
    }
    doc.save(`${report.filenameBase}.pdf`)
  }

  const run = async (format: Format) => {
    if (!live) { toast.error('Switch to Live mode to download a device report'); return }
    setBusy(format)
    try {
      const p = period()
      const raw = await api.nodeReport(nodeId, p.from, p.to)
      if (!raw) { toast.error('Report data unavailable'); return }
      const orgId = useAppStore.getState().selectedOrgId
      const orgName = useAppStore.getState().orgNames[orgId] || 'ONEOPS'
      const report = buildDeviceReport(raw, { deviceName, domain, orgName })
      if (!raw.series.length && !raw.events.length) {
        toast('No readings stored for this period', { icon: '📭' })
      }
      if (format === 'pdf') await exportPDF(report)
      // One digest for all four formats of this report, so a recipient holding
      // the PDF and the CSV can see they describe the same snapshot.
      else if (format === 'xlsx') downloadXLSX(`${report.filenameBase}.xlsx`, [
        {
          name: 'Report',
          rows: [
            ['Device report'],
            ...report.meta.map((m) => [m]),
            ['Snapshot SHA-256', sectionsDigest(report.sections)],
            ['', 'Covers every section header and data row in the sheets that follow.'],
          ],
        },
        ...report.sections.map((s) => ({ name: s.title, rows: [s.headers, ...s.rows] })),
      ])
      else if (format === 'csv') downloadCSVSections(`${report.filenameBase}.csv`, report.sections, report.meta)
      // The digest sits BESIDE the data, not over the whole file: hashing a
      // document that contains its own hash is not reproducible. `covers` says
      // exactly what to recompute, so a reader can actually check it.
      else downloadText(`${report.filenameBase}.json`, JSON.stringify({
        meta: report.meta,
        integrity: {
          algorithm: 'SHA-256',
          value: sectionsDigest(report.sections),
          covers: 'every section header and data row of this report, rendered as CSV rows and joined — identical to the digest printed in the PDF, CSV and XLSX exports of the same report',
        },
        ...raw,
      }, null, 2))
      setOpen(false)
    } catch (e) {
      toast.error(`Report failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-white px-2.5 py-1.5 rounded-md disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
        title="Download a report for this device"
      >
        <Download size={12} /> Report <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-xl p-3 z-50 shadow-xl"
          style={{ background: '#0d1117', border: '1px solid #1e2433' }}
        >
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Period</div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as typeof range)}
            className="w-full text-xs rounded-md px-2 py-1.5 text-slate-200 mb-2"
            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
          >
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>

          {range === 'custom' && (
            <div className="flex items-center gap-1.5 mb-2">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                className="flex-1 text-[11px] rounded-md px-2 py-1.5 text-slate-200"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }} />
              <span className="text-slate-600 text-[11px]">→</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                className="flex-1 text-[11px] rounded-md px-2 py-1.5 text-slate-200"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }} />
            </div>
          )}

          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">File type</div>
          <div className="space-y-1">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => run(f.id)}
                disabled={busy !== null}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/5 disabled:opacity-50"
              >
                <span className="text-indigo-400">{busy === f.id ? <Loader2 size={13} className="animate-spin" /> : f.icon}</span>
                <span className="text-xs text-slate-200">{f.label}</span>
                <span className="ml-auto text-[10px] text-slate-600">{f.hint}</span>
              </button>
            ))}
          </div>

          {!live && (
            <p className="text-[10px] text-slate-600 mt-2">Live mode required — demo mode has no stored history.</p>
          )}
        </div>
      )}
    </div>
  )
}
