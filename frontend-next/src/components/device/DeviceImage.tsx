'use client'

// ---------------------------------------------------------------------------
// The device, as it actually looks.
// ---------------------------------------------------------------------------
// This slot used to render Transformer3D unconditionally: one hand-modelled
// unit, drawn identically for every transformer on the platform. ETERNITY's
// customers run everything from pole-mounted distribution transformers to
// 2500 kVA oil-immersed power transformers, so the render matched the asset in
// the field almost never — while presenting itself as a twin OF that asset. A
// picture that is confidently wrong is worse than no picture, because nobody
// thinks to doubt it.
//
// An admin uploads the real photo (or the nameplate, or the spec drawing) and
// EVERY role sees the same image. That symmetry is the point: a viewer sent to
// investigate an alarm at 2am has to recognise the unit they are walking up to.
//
// The generic twin stays as the fallback for devices with no photo yet — this
// deploy must not blank three hundred device pages — but it is labelled as a
// generic model rather than left to pass for the real one.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { useSessionRole } from '@/lib/auth'
import { fmtDateTime } from '@/lib/displayTime'
import { Camera, Upload, Trash2, Loader2, Pencil, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'

// Node-RED takes a 50mb body and the handler rejects over 10 MB decoded. Base64
// inflates by ~4/3, so cap the raw file below that and say so here rather than
// letting the upload fail at the API.
const MAX_BYTES = 7 * 1024 * 1024

const humanSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`

interface Meta {
  has: boolean
  caption?: string | null
  updatedBy?: string | null
  updatedAt?: string
  pending?: string
}

export default function DeviceImage({
  nodeId, deviceName, fallback,
}: {
  nodeId: string
  deviceName?: string
  /** Shown until a photo exists — the generic twin. */
  fallback: React.ReactNode
}) {
  const live = useIsLive()
  const role = useSessionRole()
  const canEdit = role === 'admin' || role === 'superadmin'
  const [meta, setMeta] = useState<Meta | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingCaption, setEditingCaption] = useState(false)
  const [draftCaption, setDraftCaption] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    if (!live || !nodeId) { setMeta(null); return }
    let cancelled = false
    api.nodeImageMeta(nodeId).then((m) => { if (!cancelled) setMeta(m ?? { has: false }) })
    return () => { cancelled = true }
  }, [live, nodeId])

  // Return load()'s own cancel, so a slow meta fetch for the previous device
  // cannot land after the page has moved to another one.
  useEffect(() => load(), [load])

  const onPick = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Pick an image file — this slot is the photo of the unit')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Image is ${humanSize(file.size)} — the limit is ${humanSize(MAX_BYTES)}`)
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
      const r = await api.setNodeImage(nodeId, {
        dataBase64,
        contentType: file.type,
        // Keep any caption already written — replacing the photo of a unit is
        // usually a better shot of the same unit, not a different one.
        caption: meta?.caption ?? null,
      })
      if (r?.ok) { toast.success('Photo updated'); load() }
      else toast.error('Upload failed — the photo was not saved')
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    const r = await api.deleteNodeImage(nodeId)
    setBusy(false)
    if (r?.ok) { toast.success('Photo removed'); load() }
    else toast.error('Could not remove the photo')
  }

  const saveCaption = async () => {
    setBusy(true)
    const r = await api.setNodeImage(nodeId, { caption: draftCaption.trim() })
    setBusy(false)
    if (r?.ok) { setEditingCaption(false); load() }
    else toast.error('Could not save the caption')
  }

  const src = meta?.has ? api.nodeImageUrl(nodeId, meta.updatedAt ?? '1') : null

  return (
    <div className="relative w-full h-full group">
      {src ? (
        // object-contain, never cover: a transformer photo cropped to fill the
        // box loses the bushings or the nameplate, which is the part someone
        // came here to read.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={deviceName ? `${deviceName} — device photo` : 'Device photo'}
          className="w-full h-full object-contain" />
      ) : (
        <>
          {fallback}
          <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-md pointer-events-none"
            style={{ background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433', color: '#64748b' }}>
            Generic model — not this unit
          </div>
        </>
      )}

      {/* Caption sits over the image so the photo keeps the whole panel. */}
      {src && (meta?.caption || canEdit) && (
        <div className="absolute bottom-0 inset-x-0 px-3 py-2 flex items-center gap-2"
          style={{ background: 'linear-gradient(to top, rgba(10,14,26,0.92), transparent)' }}>
          {editingCaption ? (
            <>
              <input autoFocus value={draftCaption} onChange={(e) => setDraftCaption(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCaption(); if (e.key === 'Escape') setEditingCaption(false) }}
                placeholder="e.g. 2500 kVA ONAN · nameplate 2019"
                maxLength={255}
                className="flex-1 text-[11px] rounded-md px-2 py-1 text-white outline-none"
                style={{ background: '#0d1117', border: '1px solid #6366f1' }} />
              <button onClick={saveCaption} disabled={busy} className="p-1 rounded text-emerald-400 hover:bg-white/10"><Check size={13} /></button>
              <button onClick={() => setEditingCaption(false)} className="p-1 rounded text-slate-400 hover:bg-white/10"><X size={13} /></button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[11px] text-slate-300 truncate" title={meta?.caption ?? ''}>
                {meta?.caption || (canEdit ? <span className="text-slate-600">Add a caption…</span> : '')}
              </span>
              {canEdit && (
                <button onClick={() => { setDraftCaption(meta?.caption ?? ''); setEditingCaption(true) }}
                  className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10" title="Edit caption">
                  <Pencil size={12} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Admin controls. Hidden entirely from a viewer, who sees only the photo. */}
      {canEdit && live && !editingCaption && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {src ? 'Replace photo' : 'Upload photo'}
          </button>
          {src && (
            <button onClick={remove} disabled={busy} title="Remove the photo (falls back to the generic model)"
              className="p-1.5 rounded-md text-slate-400 hover:text-red-400"
              style={{ background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433' }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}

      {/* An admin with no photo yet gets the ask even without hovering — the
          hover-only control is discoverable once you know it is there. */}
      {canEdit && live && !src && (
        <div className="absolute bottom-2 inset-x-2 flex items-center justify-center gap-1.5 text-[10px] text-slate-600 pointer-events-none">
          <Camera size={11} /> Upload a photo of this unit so everyone sees the real one
        </div>
      )}
      {meta?.pending && canEdit && (
        <div className="absolute bottom-2 inset-x-2 text-center text-[10px] text-amber-400">
          Device photos need migrate-v27 — run the migration first
        </div>
      )}
      {src && meta?.updatedAt && (
        <div className="absolute top-2 left-2 text-[9px] px-2 py-1 rounded-md text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433' }}>
          {meta.updatedBy ? `${meta.updatedBy} · ` : ''}{fmtDateTime(meta.updatedAt)}
        </div>
      )}
    </div>
  )
}
