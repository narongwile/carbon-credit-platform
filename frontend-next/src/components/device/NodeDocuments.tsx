'use client'

// ---------------------------------------------------------------------------
// Maintenance documents for a device — service reports, photos, invoices,
// calibration certificates. Works for every product domain (transformer,
// carbonNode, bloodBox) because it keys off the node id alone.
//
// Any file type is accepted: the browser reads it as base64 and the MIME type
// travels with it, so downloads open in the right application. Viewers upload
// into their own department; an admin (who has no department) files under the
// node's department and sees every department's documents.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { getSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { getViewerUser } from '@/lib/viewer'
import { FileText, Upload, Download, Loader2, Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

// Node-RED accepts a 50mb body; base64 inflates by ~33%, so cap the raw file
// well under that and tell the user instead of failing at the API.
const MAX_BYTES = 20 * 1024 * 1024

interface DocRow {
  id: string
  name: string
  size: string | null
  uploaded_by: string | null
  content_type?: string | null
  department_id?: string | null
  created_at: string
}

const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`

export default function NodeDocuments({ nodeId }: { nodeId: string }) {
  const live = useIsLive()
  const viewerUserId = useAppStore((s) => s.viewerUserId)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // A viewer is scoped to their department; an admin passes none and the API
  // returns every department's documents for this node.
  const departmentId = (() => {
    const session = getSession()
    if (session?.role === 'admin' || session?.role === 'superadmin') return ''
    return getViewerUser(viewerUserId)?.departmentIds?.[0] ?? ''
  })()

  const load = useCallback(() => {
    if (!live || !nodeId) { setDocs([]); return }
    setLoading(true)
    api.getNodeDocuments(nodeId, departmentId)
      .then((rows) => { if (rows) setDocs(rows as unknown as DocRow[]) })
      .finally(() => setLoading(false))
  }, [live, nodeId, departmentId])

  useEffect(() => { load() }, [load])

  const onPick = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(`File is ${humanSize(file.size)} — the limit is ${humanSize(MAX_BYTES)}`)
      return
    }
    setBusy(true)
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const res = await api.uploadNodeDocument(nodeId, {
        departmentId,
        name: file.name,
        size: humanSize(file.size),
        uploadedBy: getSession()?.name ?? 'user',
        contentType: file.type || 'application/octet-stream',
        dataBase64,
      })
      if (res?.ok) { toast.success(`Uploaded ${file.name}`); load() }
      else toast.error('Upload failed')
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Paperclip size={14} className="text-indigo-400" /> Maintenance Documents
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Service reports, photos, certificates — any file type</span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!live || busy}
            className="flex items-center gap-1.5 text-[11px] font-medium text-white px-3 py-1.5 rounded-md disabled:opacity-50"
            style={gradient}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {!live ? (
        <p className="text-xs text-slate-600 py-4 text-center">Switch to Live mode to upload and view maintenance documents.</p>
      ) : (
        <div className="rounded-lg overflow-auto max-h-[280px]" style={{ border: '1px solid #1e2433' }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr style={{ background: '#0a0e1a' }}>
                {['Document', 'Size', 'Uploaded by', 'Date', ''].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && docs.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-slate-600 text-xs">Loading…</td></tr>
              )}
              {!loading && docs.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-slate-600 text-xs">
                  No maintenance documents yet — upload the first service report for this device.
                </td></tr>
              )}
              {docs.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid #1e2433' }}>
                  <td className="py-2.5 px-3">
                    <span className="flex items-center gap-2 text-xs text-slate-200">
                      <FileText size={12} className="text-slate-500 shrink-0" />
                      <span className="truncate max-w-[260px]" title={d.name}>{d.name}</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-500">{d.size ?? '—'}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-400">{d.uploaded_by ?? '—'}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-500">
                    {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => api.downloadNodeDocument(nodeId, d.id, d.name)}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white"
                      style={{ border: '1px solid #1e2433' }}
                    >
                      <Download size={11} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
