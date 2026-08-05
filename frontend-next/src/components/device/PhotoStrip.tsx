'use client'

// ---------------------------------------------------------------------------
// A row of a device's photos, small enough to sit inside another page's card.
// ---------------------------------------------------------------------------
// Used where the photos are supporting evidence rather than the subject:
// Pending Devices (what am I about to approve?) and the Device Management row
// expander. The full gallery lives on the device page — this is the strip plus
// the same lightbox, so nothing is a second-class view of the same photos.
//
// It also takes uploads, which is the point for pending devices: the installer
// sends the site photo, the admin attaches it to the pending row, and it is
// already on the device the moment it is approved — node_photos is keyed by
// node_id, and approval does not change the id.
// ---------------------------------------------------------------------------

import { useRef, useState } from 'react'
import { api, PHOTO_KINDS, useIsLive, type NodePhotoKind } from '@/lib/api'
import { useNodePhotos } from '@/lib/useNodePhotos'
import { uploadNodePhotos, savedLine } from '@/lib/uploadNodePhotos'
import PhotoLightbox from '@/components/device/PhotoLightbox'
import { Camera, Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

export default function PhotoStrip({
  nodeId, deviceName, canEdit = false, emptyHint = 'No photo of this unit yet',
}: {
  nodeId: string
  deviceName?: string
  canEdit?: boolean
  emptyHint?: string
}) {
  const live = useIsLive()
  const { photos, pending, reload } = useNodePhotos(nodeId)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [kind, setKind] = useState<NodePhotoKind>('overview')
  const fileRef = useRef<HTMLInputElement>(null)

  const onPick = async (files: FileList) => {
    const r = await uploadNodePhotos(nodeId, files, kind, setBusy, (m) => toast.error(m))
    if (fileRef.current) fileRef.current.value = ''
    if (!r.added) return
    toast.success(`${r.added === 1 ? 'Photo' : `${r.added} photos`} added · ${savedLine(r)}`)
    reload()
  }

  if (!live) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Camera size={12} className="text-slate-600 flex-shrink-0" />
      {photos.map((p, i) => (
        <button key={p.id} type="button" onClick={() => setLightbox(i)}
          title={`${PHOTO_KINDS.find((k) => k.key === p.kind)?.label ?? p.kind}${p.caption ? ` — ${p.caption}` : ''}`}
          className="w-11 h-9 rounded-md overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-indigo-500"
          style={{ border: '1px solid #1e2433' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={api.nodePhotoUrl(nodeId, p.id, { thumb: true, v: p.updatedAt })} alt="" loading="lazy"
            className="w-full h-full object-cover" />
        </button>
      ))}
      {photos.length === 0 && !pending && (
        <span className="text-[10px] text-slate-600">{emptyHint}</span>
      )}
      {pending && <span className="text-[10px] text-amber-500">photos need migrate-v36</span>}

      {canEdit && !pending && (
        <>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { const f = e.target.files; if (f?.length) onPick(f) }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as NodePhotoKind)} title="What this photo shows"
            className="text-[10px] rounded-md px-1.5 py-1 text-slate-400 outline-none"
            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
            {PHOTO_KINDS.map((k) => <option key={k.key} value={k.key} className="bg-[#0d1117]">{k.label}</option>)}
          </select>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-slate-300 disabled:opacity-50"
            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}{busy || 'Photo'}
          </button>
        </>
      )}

      {lightbox !== null && photos[lightbox] && (
        <PhotoLightbox nodeId={nodeId} deviceName={deviceName} photos={photos} index={lightbox}
          canEdit={canEdit} onIndex={setLightbox} onClose={() => setLightbox(null)} onChanged={reload} />
      )}
    </div>
  )
}
