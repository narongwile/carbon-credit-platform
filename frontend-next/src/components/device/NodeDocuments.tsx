'use client'

// ---------------------------------------------------------------------------
// Maintenance documents for a device — service reports, invoices, calibration
// certificates, test results. Works for every product domain (transformer,
// carbonNode, bloodBox) because it keys off the node id alone.
//
// Any file type is accepted: the browser reads it as base64 and the MIME type
// travels with it, so downloads open in the right application. Viewers upload
// into their own department; an admin (who has no department) files under the
// node's department and sees every department's documents.
//
// PHOTOS are not uploaded here a second time — they already have a home (the
// device's photo gallery, node_photos / DevicePhotoGallery) with the upright/
// downscale pipeline, thumbnails and annotation this table has none of. What
// this list DOES do is show them alongside the paperwork: an "as-found" and
// "after-repair" condition photo IS maintenance documentation, and finding it
// meant knowing to look in a different tab before this. The merged list below
// is read-only for photos — click one to open the real gallery/lightbox,
// where deleting or re-captioning it actually belongs.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, useIsLive, DOC_KINDS, type DocKind } from '@/lib/api'
import { getSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { useMyAccess } from '@/lib/useMyAccess'
import { getViewerUser } from '@/lib/viewer'
import { useNodePhotos } from '@/lib/useNodePhotos'
import { PHOTO_KINDS } from '@/lib/api'
import PhotoLightbox from '@/components/device/PhotoLightbox'
import { useSessionRole } from '@/lib/auth'
import { fmtDateTime } from '@/lib/displayTime'
import { FileText, Upload, Download, Loader2, Paperclip, Image as ImageIcon } from 'lucide-react'
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
  kind: DocKind
  department_id?: string | null
  created_at: string
}

/** One row of the merged table — a real uploaded document, or a photo standing in for one. */
type Row =
  | { type: 'doc'; id: string; name: string; size: string | null; uploadedBy: string | null; kind: DocKind; createdAt: string }
  | { type: 'photo'; id: string; name: string; uploadedBy: string | null; kind: string; createdAt: string; photoId: string }

const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`

const docKindLabel = (k: DocKind) => DOC_KINDS.find((x) => x.key === k)?.label ?? k
const photoKindLabel = (k: string) => PHOTO_KINDS.find((x) => x.key === k)?.label ?? k

export default function NodeDocuments({ nodeId, deviceName }: { nodeId: string; deviceName?: string }) {
  const live = useIsLive()
  const viewerUserId = useAppStore((s) => s.viewerUserId)
  // The real signed-in user's own department(s) — see useMyAccess for why this
  // replaces viewer.ts directly: viewerUserId is a demo-only id a real login
  // never sets, so a real viewer's documents request always asked for
  // departmentId='' (nobody's) and got back nothing, silently.
  const myAccess = useMyAccess()
  const role = useSessionRole()
  const canEditPhotos = role === 'admin' || role === 'superadmin'
  const [docs, setDocs] = useState<DocRow[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadKind, setUploadKind] = useState<DocKind>('service_report')
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // A viewer is scoped to their department; an admin passes none and the API
  // returns every department's documents for this node.
  const departmentId = (() => {
    const session = getSession()
    if (session?.role === 'admin' || session?.role === 'superadmin') return ''
    if (myAccess) return myAccess.departmentIds[0] ?? ''
    // Demo/offline mode only — no real session to read from.
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

  // Photos merge in read-only. condition-kind ones are the clearest fit
  // (before/after-repair IS a maintenance record), but the whole set is
  // included — a service report that references "see attached nameplate
  // photo" should find it in the same list it is filed next to.
  const { photos, reload: reloadPhotos } = useNodePhotos(nodeId)

  const rows: Row[] = useMemo(() => {
    const docRows: Row[] = docs.map((d) => ({
      type: 'doc', id: d.id, name: d.name, size: d.size, uploadedBy: d.uploaded_by, kind: d.kind, createdAt: d.created_at,
    }))
    const photoRows: Row[] = photos.map((p) => ({
      type: 'photo',
      id: `photo-${p.id}`,
      name: p.caption || `${photoKindLabel(p.kind)} photo`,
      uploadedBy: p.updatedBy ?? null,
      kind: p.kind,
      createdAt: p.takenAt || p.updatedAt,
      photoId: p.id,
    }))
    return [...docRows, ...photoRows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [docs, photos])

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
        kind: uploadKind,
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
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Paperclip size={14} className="text-indigo-400" /> Maintenance Documents
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 hidden lg:inline">Service reports, certificates — any file type. Photos come from the gallery.</span>
          <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value as DocKind)}
            disabled={!live} title="What kind of document this upload is"
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-300 outline-none disabled:opacity-50"
            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
            {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
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
                {['Document', 'Type', 'Size', 'Uploaded by', 'Date', ''].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-600 text-xs">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-600 text-xs">
                  No maintenance documents yet — upload the first service report for this device.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #1e2433' }}>
                  <td className="py-2.5 px-3">
                    <span className="flex items-center gap-2 text-xs text-slate-200">
                      {r.type === 'photo'
                        ? <ImageIcon size={12} className="text-slate-500 shrink-0" />
                        : <FileText size={12} className="text-slate-500 shrink-0" />}
                      <span className="truncate max-w-[220px]" title={r.name}>{r.name}</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={r.type === 'photo'
                        ? { color: '#a78bfa', background: 'rgba(167,139,250,0.12)' }
                        : { color: '#818cf8', background: 'rgba(99,102,241,0.12)' }}>
                      {r.type === 'photo' ? photoKindLabel(r.kind) : docKindLabel(r.kind)}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-500">{r.type === 'doc' ? (r.size ?? '—') : '—'}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-400">{r.uploadedBy ?? '—'}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-500">
                    {r.createdAt ? fmtDateTime(r.createdAt) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {r.type === 'photo' ? (
                      <button
                        onClick={() => setLightboxId(r.photoId)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white"
                        style={{ border: '1px solid #1e2433' }}
                      >
                        <ImageIcon size={11} /> View
                      </button>
                    ) : (
                      <button
                        onClick={() => api.downloadNodeDocument(nodeId, r.id, r.name)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-white"
                        style={{ border: '1px solid #1e2433' }}
                      >
                        <Download size={11} /> Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lightboxId && (() => {
        const idx = photos.findIndex((p) => p.id === lightboxId)
        if (idx < 0) return null
        return (
          <PhotoLightbox
            nodeId={nodeId} deviceName={deviceName} photos={photos} index={idx}
            canEdit={canEditPhotos}
            onIndex={(i) => setLightboxId(photos[i]?.id ?? null)}
            onClose={() => setLightboxId(null)}
            onChanged={reloadPhotos}
          />
        )
      })()}
    </div>
  )
}
