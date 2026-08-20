'use client'

// ---------------------------------------------------------------------------
// Export one device's readings for a chosen window, as CSV and/or PDF —
// downloaded, or sent over a configured channel with the files attached.
//
// NOT admin-only, deliberately: whoever looks after a device is the person who
// needs to send its data on, and that is usually the viewer who was called out
// to it. The backend enforces the real rule — POST /api/nodes/:id/send-export
// runs at guard()'s 'node' policy, which has already proved org + product
// level + department grant + site + per-user visibility for THIS device before
// the handler runs. So "can they open this device" and "can they export it"
// are the same question, answered in one place.
//
// Both files are built HERE and posted as base64 rather than rendered server
// side. There is no PDF generator in the backend (nothing in the Node-RED
// function libs, nothing in package.json), the frontend already builds real
// PDFs with jsPDF, and this way the attachment is byte-for-byte the file the
// user would have downloaded instead.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { X, Download, Send, Loader2, FileText, Table, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

type Channel = 'email' | 'telegram' | 'line' | 'googlechat'

// LINE Notify takes an image only and the Google Chat webhook takes a text
// card — neither can carry a CSV or PDF. Offering them for an attachment-only
// feature would be offering a button that always fails, so they are listed as
// unavailable with the reason rather than silently absent.
const CHANNELS: { id: Channel; label: string; attachments: boolean }[] = [
  { id: 'email', label: 'Email', attachments: true },
  { id: 'telegram', label: 'Telegram', attachments: true },
  { id: 'line', label: 'LINE', attachments: false },
  { id: 'googlechat', label: 'Google Chat', attachments: false },
]

const QUICK = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
]

export default function DeviceExportDialog({
  nodeId, deviceName, onClose,
}: { nodeId: string; deviceName: string; onClose: () => void }) {
  const { selectedOrgId, orgNames } = useAppStore()
  const orgName = orgNames[selectedOrgId] || 'ETERNITY'

  // Default to the last 24h, expressed in DISPLAY_TZ wall clock so the pickers
  // agree with every timestamp shown elsewhere on the page.
  const [from, setFrom] = useState(() => toDisplayInput(Date.now() - 24 * 3600_000))
  const [to, setTo] = useState(() => toDisplayInput(Date.now()))
  const [wantCsv, setWantCsv] = useState(true)
  const [wantPdf, setWantPdf] = useState(true)
  const [channel, setChannel] = useState<Channel>('email')
  const [target, setTarget] = useState('')
  const [subject, setSubject] = useState(`${orgName} export — ${deviceName}`)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<{ param_key: string; value: number; taken_at: string }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const range = useMemo(() => ({ start: fromDisplayInput(from), end: fromDisplayInput(to) }), [from, to])
  const validRange = Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end

  // Preview the row count before anyone commits to a send — an empty window is
  // the commonest surprise, and it is far better seen here than received as an
  // email containing a header line and nothing else.
  useEffect(() => {
    if (!validRange) { setRows(null); return }
    let cancelled = false
    setLoading(true)
    const iso = (ms: number) => new Date(ms).toISOString()
    api.readingsWindow(nodeId, iso(range.start), iso(range.end))
      .then((r) => { if (!cancelled) setRows(r ?? []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, range.start, range.end, validRange])

  const buildCsv = () => {
    const header = 'device,param_key,value,taken_at'
    const body = (rows ?? []).map((r) => [deviceName, r.param_key, r.value, fmtDateTime(r.taken_at)].join(','))
    return [header, ...body].join('\n')
  }

  const buildPdf = async (): Promise<Blob> => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    doc.setFontSize(16); doc.setTextColor(99, 102, 241)
    doc.text(`${orgName} — Device Export`, 14, 18)
    doc.setFontSize(10); doc.setTextColor(90, 90, 90)
    doc.text(`Device: ${deviceName}`, 14, 27)
    doc.text(`Window: ${from} → ${to} (${DISPLAY_TZ_LABEL})`, 14, 33)
    doc.text(`Readings: ${(rows ?? []).length}`, 14, 39)
    if ((rows ?? []).length) {
      autoTable(doc, {
        startY: 46,
        head: [['Parameter', 'Value', 'Taken at']],
        body: (rows ?? []).map((r) => [r.param_key, String(r.value), fmtDateTime(r.taken_at)]),
        theme: 'striped',
        headStyles: { fillColor: [99, 102, 241] },
      })
    } else {
      doc.setTextColor(140, 140, 140)
      doc.text('No readings in this window.', 14, 50)
    }
    return doc.output('blob')
  }

  const blobToBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(b)
  })

  const stamp = `${orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_${deviceName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_${from.slice(0, 10)}_${to.slice(0, 10)}`

  const download = async () => {
    if (!wantCsv && !wantPdf) { toast.error('Pick at least one format'); return }
    setBusy(true)
    try {
      if (wantCsv) {
        const url = URL.createObjectURL(new Blob([buildCsv()], { type: 'text/csv;charset=utf-8;' }))
        const a = document.createElement('a'); a.href = url; a.download = `${stamp}.csv`
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      }
      if (wantPdf) {
        const url = URL.createObjectURL(await buildPdf())
        const a = document.createElement('a'); a.href = url; a.download = `${stamp}.pdf`
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      }
      toast.success('Downloaded')
    } finally { setBusy(false) }
  }

  const send = async () => {
    if (!wantCsv && !wantPdf) { toast.error('Pick at least one format'); return }
    const chan = CHANNELS.find((c) => c.id === channel)
    if (chan && !chan.attachments) { toast.error(`${chan.label} cannot carry file attachments — use Email or Telegram`); return }
    setBusy(true)
    try {
      const attachments: { filename: string; contentType?: string; dataBase64: string }[] = []
      if (wantCsv) {
        attachments.push({
          filename: `${stamp}.csv`, contentType: 'text/csv',
          dataBase64: await blobToBase64(new Blob([buildCsv()], { type: 'text/csv' })),
        })
      }
      if (wantPdf) {
        attachments.push({
          filename: `${stamp}.pdf`, contentType: 'application/pdf',
          dataBase64: await blobToBase64(await buildPdf()),
        })
      }
      const r = await api.sendNodeExport(nodeId, { channel, to: target.trim() || undefined, subject, body: note, attachments })
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Sent ${r.sent} file${r.sent === 1 ? '' : 's'} by ${channel}`)
      onClose()
    } finally { setBusy(false) }
  }

  const count = rows?.length ?? 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" style={surface}>
        <div className="flex items-center justify-between p-5 sticky top-0" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
          <div>
            <h2 className="text-base font-bold text-white">Export device data</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{deviceName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Range</label>
            <div className="flex gap-2 mb-2">
              {QUICK.map((q) => (
                <button key={q.label}
                  onClick={() => { setFrom(toDisplayInput(Date.now() - q.hours * 3600_000)); setTo(toDisplayInput(Date.now())) }}
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white" style={inset}>
                  Last {q.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-600 mb-1">From</label>
                <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none" style={inset} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-600 mb-1">To</label>
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none" style={inset} />
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mt-1">times in {DISPLAY_TZ_LABEL}</p>
            {!validRange && <p className="text-[11px] text-amber-400 mt-1">The From time must be before the To time.</p>}
            {validRange && (
              <p className={clsx('text-[11px] mt-1', count === 0 && !loading ? 'text-amber-400' : 'text-slate-500')}>
                {loading ? 'Counting readings…'
                  : count === 0 ? '⚠ No readings in this window — the export would be empty.'
                  : `${count.toLocaleString()} reading${count === 1 ? '' : 's'} in this window.`}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Files</label>
            <div className="flex gap-2">
              <button onClick={() => setWantCsv((v) => !v)}
                className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold', wantCsv ? 'text-white' : 'text-slate-500')}
                style={wantCsv ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : inset}>
                <Table size={13} /> CSV
              </button>
              <button onClick={() => setWantPdf((v) => !v)}
                className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold', wantPdf ? 'text-white' : 'text-slate-500')}
                style={wantPdf ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : inset}>
                <FileText size={13} /> PDF
              </button>
            </div>
          </div>

          <div className="pt-3" style={{ borderTop: '1px solid #1e2433' }}>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Send by</label>
            <div className="grid grid-cols-4 gap-1.5">
              {CHANNELS.map((c) => (
                <button key={c.id} onClick={() => setChannel(c.id)}
                  title={c.attachments ? undefined : `${c.label} cannot carry file attachments`}
                  className={clsx('py-1.5 rounded-lg text-[11px] font-semibold', channel === c.id ? 'text-white' : c.attachments ? 'text-slate-400' : 'text-slate-600')}
                  style={channel === c.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                  {c.label}
                </button>
              ))}
            </div>
            {!CHANNELS.find((c) => c.id === channel)?.attachments && (
              <p className="text-[11px] text-amber-400 mt-1.5 flex items-start gap-1">
                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                {CHANNELS.find((c) => c.id === channel)?.label} cannot carry file attachments — use Email or Telegram, or download and share the file yourself.
              </p>
            )}
            <input value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder={channel === 'telegram' ? 'Telegram chat id (blank = the configured one)' : 'Email address'}
              className="w-full mt-2 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
              className="w-full mt-2 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Message (optional)"
              className="w-full mt-2 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-y" style={inset} />
          </div>
        </div>

        <div className="p-5 flex gap-2" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={download} disabled={busy || !validRange}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-slate-200 disabled:opacity-50" style={inset}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download
          </button>
          <button onClick={send} disabled={busy || !validRange}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
          </button>
        </div>
      </div>
    </div>
  )
}
