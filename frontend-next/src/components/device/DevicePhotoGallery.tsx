'use client'

// ---------------------------------------------------------------------------
// The device, as it actually looks — all of it.
// ---------------------------------------------------------------------------
// This slot used to render Transformer3D unconditionally: one hand-modelled
// unit, drawn identically for every transformer on the platform. Then it held
// exactly one uploaded photo (migrate-v27). Neither matches how a transformer
// is actually documented. Walking one down, you take: the whole unit, the
// nameplate close-up, the tap-changer counter, an IR frame, and a condition
// shot before and after whatever you came to do. Those are not five attempts at
// one picture — they answer five questions, and forcing a choice between them
// meant the nameplate kept winning and nobody could see the unit.
//
// So: many photos, each with a kind, an admin-chosen order, and a cover (the
// lowest position) that every other surface shows. The generic twin remains the
// fallback for devices with no photo — this deploy must not blank three hundred
// device pages — but it is labelled as generic rather than left to pass for the
// real one.
//
// Upload goes through src/lib/imagePipeline.ts before it ever reaches the
// network: uprighted from EXIF, downscaled to 1600px, plus a 320px thumbnail.
// A 6 MB phone photo lands as roughly 300 KB, which is why the strip below and
// every table thumbnail can exist at all.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react'
import { api, PHOTO_KINDS, useIsLive, type NodePhoto, type NodePhotoKind } from '@/lib/api'
import { useSessionRole } from '@/lib/auth'
import { useNodePhotos } from '@/lib/useNodePhotos'
import { uploadNodePhotos, savedLine } from '@/lib/uploadNodePhotos'
import { fmtDateTime } from '@/lib/displayTime'
import PhotoLightbox from '@/components/device/PhotoLightbox'
import { Camera, Upload, Loader2, MapPin, X, Expand } from 'lucide-react'
import toast from 'react-hot-toast'

const kindLabel = (k: NodePhotoKind) => PHOTO_KINDS.find((x) => x.key === k)?.label ?? k

/**
 * What the next photo probably is. Someone documenting a unit works through the
 * set in roughly this order, so defaulting to the first kind they have not
 * uploaded yet saves the dropdown most of the time.
 */
function suggestKind(photos: NodePhoto[]): NodePhotoKind {
  const have = new Set(photos.map((p) => p.kind))
  for (const k of ['overview', 'nameplate', 'tapchanger', 'thermal'] as NodePhotoKind[]) if (!have.has(k)) return k
  return 'condition'
}

export default function DevicePhotoGallery({
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
  const { photos, pending, reload } = useNodePhotos(nodeId)
  const [kindFilter, setKindFilter] = useState<NodePhotoKind | 'all'>('all')
  const [selected, setSelected] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadKind, setUploadKind] = useState<NodePhotoKind | null>(null)
  const [geoOffer, setGeoOffer] = useState<{ lat: number; lng: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const kindsPresent = useMemo(
    () => PHOTO_KINDS.filter((k) => photos.some((p) => p.kind === k.key)),
    [photos])

  const shown = useMemo(
    () => (kindFilter === 'all' ? photos : photos.filter((p) => p.kind === kindFilter)),
    [photos, kindFilter])

  const current = shown[Math.min(selected, Math.max(0, shown.length - 1))] ?? null
  const nextKind = uploadKind ?? suggestKind(photos)

  const onPick = async (files: FileList) => {
    const r = await uploadNodePhotos(nodeId, files, nextKind, setBusy, (m) => toast.error(m))
    if (fileRef.current) fileRef.current.value = ''
    if (!r.added) return
    toast.success(`${r.added === 1 ? 'Photo' : `${r.added} photos`} added · ${savedLine(r)}`)
    setUploadKind(null)
    // Reset alongside the filter, same as every other place kindFilter
    // changes — otherwise `selected` still indexes into the PREVIOUS
    // (possibly filtered) list, and against the new unfiltered `photos` that
    // numeric index can land on an unrelated photo until something else
    // changes it.
    setKindFilter('all')
    setSelected(0)
    reload()
    // The coordinate the camera recorded standing in front of the unit is very
    // often the coordinate the device should have — but it is an offer, never
    // an automatic overwrite of a surveyed position.
    if (r.geo) setGeoOffer(r.geo)
  }

  const applyGeo = async () => {
    if (!geoOffer) return
    const r = await api.setNodeLocation(nodeId, { lat: geoOffer.lat, lng: geoOffer.lng })
    if (r?.ok) toast.success('Device location set from the photo')
    else toast.error('Could not set the device location')
    setGeoOffer(null)
  }

  const src = current ? api.nodePhotoUrl(nodeId, current.id, { v: current.updatedAt }) : null

  return (
    <div className="relative w-full h-full group overflow-hidden">
      {src && current ? (
        <button type="button" onClick={() => setLightbox(photos.findIndex((p) => p.id === current.id))}
          className="absolute inset-0 w-full h-full cursor-zoom-in" title="Open full size">
          {/* object-contain, never cover: a transformer photo cropped to fill
              the box loses the bushings or the nameplate, which is the part
              someone came here to read. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={current.caption || `${deviceName ?? nodeId} — ${kindLabel(current.kind)}`}
            className="w-full h-full object-contain" />
          {/* Markers ride along at panel size so a flagged hotspot is visible
              without opening anything. */}
          {current.annotations.length > 0 && (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-90">
              {current.annotations.map((m, i) => {
                const c = m.color || '#f43f5e'
                if (m.type === 'dot') return <circle key={i} cx={m.x} cy={m.y} r={0.016} fill="none" stroke={c} strokeWidth={0.006} />
                if (m.type === 'box') {
                  const x = Math.min(m.x, m.x2 ?? m.x), y = Math.min(m.y, m.y2 ?? m.y)
                  return <rect key={i} x={x} y={y} width={Math.abs((m.x2 ?? m.x) - m.x)} height={Math.abs((m.y2 ?? m.y) - m.y)} fill="none" stroke={c} strokeWidth={0.006} />
                }
                const x2 = m.x2 ?? m.x, y2 = m.y2 ?? m.y
                const a = Math.atan2(y2 - m.y, x2 - m.x)
                return (
                  <g key={i}>
                    <line x1={m.x} y1={m.y} x2={x2} y2={y2} stroke={c} strokeWidth={0.006} />
                    <polygon points={`${x2},${y2} ${x2 - 0.03 * Math.cos(a - 0.4)},${y2 - 0.03 * Math.sin(a - 0.4)} ${x2 - 0.03 * Math.cos(a + 0.4)},${y2 - 0.03 * Math.sin(a + 0.4)}`} fill={c} />
                  </g>
                )
              })}
            </svg>
          )}
          <span className="absolute top-2 right-2 p-1.5 rounded-md text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433' }}>
            <Expand size={12} />
          </span>
        </button>
      ) : (
        <>
          {fallback}
          <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-md pointer-events-none"
            style={{ background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433', color: '#64748b' }}>
            Generic model — not this unit
          </div>
        </>
      )}

      {/* Kind filter — only the kinds this device actually has, so a unit with
          one photo gets no chrome it does not need. */}
      {kindsPresent.length > 1 && (
        <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[70%]">
          <button onClick={() => { setKindFilter('all'); setSelected(0) }}
            className="text-[9px] px-2 py-1 rounded-md"
            style={kindFilter === 'all'
              ? { background: 'rgba(99,102,241,0.9)', color: '#fff' }
              : { background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433', color: '#94a3b8' }}>
            All {photos.length}
          </button>
          {kindsPresent.map((k) => (
            <button key={k.key} onClick={() => { setKindFilter(k.key); setSelected(0) }} title={k.hint}
              className="text-[9px] px-2 py-1 rounded-md"
              style={kindFilter === k.key
                ? { background: 'rgba(99,102,241,0.9)', color: '#fff' }
                : { background: 'rgba(10,14,26,0.85)', border: '1px solid #1e2433', color: '#94a3b8' }}>
              {k.label}
            </button>
          ))}
        </div>
      )}

      {/* Caption + provenance over the image, so the photo keeps the panel. */}
      {current && (current.caption || current.takenAt) && (
        <div className="absolute inset-x-0 px-3 py-2 pointer-events-none"
          style={{ bottom: shown.length > 1 ? 56 : 0, background: 'linear-gradient(to top, rgba(10,14,26,0.92), transparent)' }}>
          <div className="text-[11px] text-slate-200 truncate">{current.caption}</div>
          {current.takenAt && <div className="text-[9px] text-slate-500">Taken {fmtDateTime(current.takenAt)}</div>}
        </div>
      )}

      {/* Filmstrip. Thumbnails are the 320px copies — twelve of them cost less
          than one of the full images. */}
      {shown.length > 1 && (
        <div className="absolute bottom-0 inset-x-0 flex gap-1.5 px-2 py-2 overflow-x-auto"
          style={{ background: 'linear-gradient(to top, rgba(10,14,26,0.95), rgba(10,14,26,0.6))' }}>
          {shown.map((p, i) => (
            <button key={p.id} onClick={() => setSelected(i)}
              title={`${kindLabel(p.kind)}${p.caption ? ` — ${p.caption}` : ''}`}
              className="flex-shrink-0 w-12 h-9 rounded overflow-hidden"
              style={{ border: current?.id === p.id ? '2px solid #6366f1' : '1px solid #1e2433', opacity: current?.id === p.id ? 1 : 0.55 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={api.nodePhotoUrl(nodeId, p.id, { thumb: true, v: p.updatedAt })} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Admin controls. Hidden entirely from a viewer, who sees only the photos. */}
      {canEdit && live && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { const f = e.target.files; if (f?.length) onPick(f) }} />
          <select value={nextKind} onChange={(e) => setUploadKind(e.target.value as NodePhotoKind)}
            title="What the next upload is a photo of"
            className="text-[10px] rounded-md px-1.5 py-1.5 text-slate-300 outline-none"
            style={{ background: 'rgba(10,14,26,0.9)', border: '1px solid #1e2433' }}>
            {PHOTO_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {busy || 'Add photo'}
          </button>
        </div>
      )}

      {/* An admin with no photo yet gets the ask without hovering — the
          hover-only control is discoverable only once you know it is there. */}
      {canEdit && live && !src && !busy && (
        <div className="absolute bottom-2 inset-x-2 flex items-center justify-center gap-1.5 text-[10px] text-slate-600 pointer-events-none">
          <Camera size={11} /> Add the overview, the nameplate and the tap changer — everyone sees the real unit
        </div>
      )}

      {geoOffer && (
        <div className="absolute bottom-3 inset-x-3 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: 'rgba(10,14,26,0.96)', border: '1px solid #10b98155' }}>
          <MapPin size={13} className="text-emerald-400 flex-shrink-0" />
          <span className="text-[10px] text-slate-300 flex-1 min-w-0">
            That photo was taken at {geoOffer.lat.toFixed(5)}, {geoOffer.lng.toFixed(5)} — use it as this device&apos;s location?
          </span>
          <button onClick={applyGeo} className="text-[10px] px-2.5 py-1 rounded-md text-white flex-shrink-0" style={{ background: '#059669' }}>Use it</button>
          <button onClick={() => setGeoOffer(null)} className="p-1 text-slate-500 hover:text-white flex-shrink-0"><X size={12} /></button>
        </div>
      )}

      {pending && canEdit && (
        <div className="absolute bottom-2 inset-x-2 text-center text-[10px] text-amber-400">
          Device photos need migrate-v36 — run the migration first
        </div>
      )}

      {lightbox !== null && photos[lightbox] && (
        <PhotoLightbox
          nodeId={nodeId} deviceName={deviceName} photos={photos} index={lightbox}
          canEdit={canEdit} onIndex={setLightbox} onClose={() => setLightbox(null)}
          onChanged={reload} />
      )}
    </div>
  )
}
