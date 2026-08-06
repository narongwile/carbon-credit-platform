'use client'

// ---------------------------------------------------------------------------
// One photo, full screen, with the things a dashboard-sized <img> cannot do.
// ---------------------------------------------------------------------------
// Four complaints drove what is in here, and each maps to one control:
//
//   "can't read the nameplate"  → wheel/pinch zoom to 6x with drag-pan, and a
//                                 double-click that toggles 1x ⇄ 3x. The stored
//                                 image is 1600px on the long edge precisely so
//                                 there is something to zoom INTO.
//   "deleted the wrong one"     → delete is two-step and the confirmation says
//                                 which photo, by kind and caption. There is no
//                                 undo on the server, so the stop has to be in
//                                 front of the action.
//   "which bit is hot?"         → arrows and boxes drawn on the image, stored
//                                 normalised (0..1) so they stay on target at
//                                 every size, including inside the PDF.
//   "is that hotspot real?"     → an IR frame means little alone. Compare fades
//                                 the thermal shot over the visible-light one
//                                 of the same unit.
//
// Annotations live under the same transform as the image, so zooming into a
// marked hotspot keeps the marker exactly on it — the alternative (overlaying
// the untransformed container) drifts the moment anyone zooms.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type NodePhoto, type NodePhotoKind, type PhotoAnnotation } from '@/lib/api'
import { useKindCatalog } from '@/lib/useKindCatalog'
import { humanSize } from '@/lib/imagePipeline'
import { fmtDateTime } from '@/lib/displayTime'
import PhotoAnnotationOverlay, { aspectBox } from '@/components/device/PhotoAnnotationOverlay'
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2, Pencil, Check, Star,
  MapPin, Layers, MousePointer2, Loader2, AlertTriangle, Undo2,
} from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const MARKER_COLOR = '#f43f5e'
/** Below this drag distance a gesture is a tap, so it marks a point rather than drawing a 2px arrow. */
const DOT_THRESHOLD = 0.02
const MAX_ZOOM = 6

export default function PhotoLightbox({
  nodeId, orgId, deviceName, photos, index, canEdit, onIndex, onClose, onChanged,
}: {
  nodeId: string
  /** The device's org — its photo types (migrate-v40) drive the type picker below. */
  orgId?: string
  deviceName?: string
  photos: NodePhoto[]
  index: number
  canEdit: boolean
  onIndex: (i: number) => void
  onClose: () => void
  /** Refetch the list — the server owns position and updatedAt. */
  onChanged: () => void
}) {
  const photo = photos[index]
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [draftCaption, setDraftCaption] = useState('')
  const [draftKind, setDraftKind] = useState<NodePhotoKind>('overview')
  const [drawing, setDrawing] = useState(false)
  const [marks, setMarks] = useState<PhotoAnnotation[]>([])
  const [pendingMark, setPendingMark] = useState<PhotoAnnotation | null>(null)
  const [compare, setCompare] = useState(false)
  const [blend, setBlend] = useState(0.6)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const { options: kindOptions, labelOf: kindLabel } = useKindCatalog(orgId, 'photo')
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // Every per-photo view state resets when the photo changes — carrying a 4x
  // zoom or a half-drawn arrow onto the next image is never what was meant.
  useEffect(() => {
    setZoom(1); setPan({ x: 0, y: 0 })
    setConfirmDelete(false); setEditingMeta(false); setDrawing(false)
    setPendingMark(null); setCompare(false); setNatural(null)
    setMarks(photo?.annotations ?? [])
  }, [photo?.id, photo?.annotations])

  // The photo-change effect above wipes `marks`/the caption draft on every
  // index change with no warning — fine for a clean navigation, silent data
  // loss for one mid-edit. Every way to change photos (arrow keys, the
  // chevrons, the filmstrip) funnels through this so none of them can bypass
  // the guard the others respect.
  const tryIndex = useCallback((i: number) => {
    if (drawing || editingMeta) {
      toast.error(drawing ? 'Save or discard the markers first' : 'Save or cancel the caption edit first')
      return
    }
    onIndex(i)
  }, [drawing, editingMeta, onIndex])

  const go = useCallback((d: number) => {
    if (photos.length < 2) return
    tryIndex((index + d + photos.length) % photos.length)
  }, [index, photos.length, tryIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (drawing) setDrawing(false); else onClose() }
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, drawing])

  /** The visible-light counterpart of a thermal shot, or vice versa. */
  const pair = useMemo(() => {
    if (!photo) return null
    if (photo.kind === 'thermal') return photos.find((p) => p.kind === 'overview' || p.kind === 'condition') ?? null
    if (photo.kind === 'overview' || photo.kind === 'condition') return photos.find((p) => p.kind === 'thermal') ?? null
    return null
  }, [photo, photos])

  if (!photo) return null

  const w = photo.width || natural?.w || 4
  const h = photo.height || natural?.h || 3
  const src = api.nodePhotoUrl(nodeId, photo.id, { v: photo.updatedAt })

  // --- image gestures ------------------------------------------------------
  const onWheel = (e: React.WheelEvent) => {
    if (drawing) return
    e.preventDefault()
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
  }
  const onDoubleClick = () => {
    if (drawing) return
    setZoom((z) => (z > 1 ? 1 : 3))
    setPan({ x: 0, y: 0 })
  }

  /** Pointer position as a 0..1 fraction of the image, independent of zoom/pan. */
  const norm = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (drawing) {
      const p = norm(e)
      setPendingMark({ type: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y, color: MARKER_COLOR })
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (zoom <= 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing && pendingMark) {
      const p = norm(e)
      setPendingMark({ ...pendingMark, x2: p.x, y2: p.y })
      return
    }
    const d = dragRef.current
    if (!d) return
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
  }
  const onPointerUp = () => {
    if (drawing && pendingMark) {
      const dx = (pendingMark.x2 ?? 0) - pendingMark.x
      const dy = (pendingMark.y2 ?? 0) - pendingMark.y
      // A tap is a point of interest; a drag is an arrow that points at one.
      const mark: PhotoAnnotation = Math.hypot(dx, dy) < DOT_THRESHOLD
        ? { type: 'dot', x: pendingMark.x, y: pendingMark.y, color: MARKER_COLOR }
        : pendingMark
      setMarks((m) => [...m, mark])
      setPendingMark(null)
      return
    }
    dragRef.current = null
  }

  // --- mutations -----------------------------------------------------------
  const saveMarks = async () => {
    setBusy(true)
    const r = await api.patchNodePhoto(nodeId, photo.id, { annotations: marks })
    setBusy(false)
    if (r?.ok) { toast.success(marks.length ? `${marks.length} marker${marks.length > 1 ? 's' : ''} saved` : 'Markers cleared'); setDrawing(false); onChanged() }
    else toast.error('Could not save the markers')
  }

  const saveMeta = async () => {
    setBusy(true)
    const r = await api.patchNodePhoto(nodeId, photo.id, { caption: draftCaption.trim() || null, kind: draftKind })
    setBusy(false)
    if (r?.ok) { setEditingMeta(false); onChanged() }
    else toast.error('Could not save')
  }

  const remove = async () => {
    setBusy(true)
    const r = await api.deleteNodePhoto(nodeId, photo.id)
    setBusy(false)
    if (!r?.ok) { toast.error('Could not delete the photo'); return }
    toast.success('Photo deleted')
    onChanged()
    if (photos.length <= 1) onClose()
    else onIndex(Math.max(0, index - 1))
  }

  const makeCover = async () => {
    setBusy(true)
    const r = await api.orderNodePhotos(nodeId, [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)])
    setBusy(false)
    if (r?.ok) { toast.success('Now the cover photo'); onChanged(); onIndex(0) }
    else toast.error('Could not reorder')
  }

  const useLocation = async () => {
    if (photo.lat == null || photo.lng == null) return
    setBusy(true)
    const r = await api.setNodeLocation(nodeId, { lat: photo.lat, lng: photo.lng })
    setBusy(false)
    if (r?.ok) toast.success(`Device located at ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`)
    else toast.error('Could not set the device location')
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col" style={{ background: 'rgba(5,8,16,0.97)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid #1e2433' }}>
        <span className="text-[10px] px-2 py-1 rounded-md font-bold uppercase tracking-wider"
          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{kindLabel(photo.kind)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white truncate">{photo.caption || deviceName || nodeId}</div>
          <div className="text-[10px] text-slate-500 truncate">
            {index + 1} of {photos.length}
            {photo.width ? ` · ${photo.width}×${photo.height}` : ''}
            {photo.bytes ? ` · ${humanSize(photo.bytes)}` : ''}
            {photo.takenAt ? ` · taken ${fmtDateTime(photo.takenAt)}` : ''}
            {photo.updatedBy ? ` · by ${photo.updatedBy}` : ''}
          </div>
        </div>

        {pair && (
          <button onClick={() => setCompare((c) => !c)} title={`Fade against the ${kindLabel(pair.kind).toLowerCase()} shot`}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md"
            style={compare ? { background: 'rgba(249,115,22,0.15)', color: '#fb923c', border: '1px solid #f9731644' } : { ...surface, color: '#94a3b8' }}>
            <Layers size={12} /> Compare
          </button>
        )}
        {!drawing && (
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom((z) => Math.max(1, z / 1.4))} className="p-1.5 rounded-md text-slate-400 hover:text-white" style={surface}><ZoomOut size={13} /></button>
            <span className="text-[10px] text-slate-500 w-9 text-center tabular-nums">{zoom.toFixed(1)}×</span>
            <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.4))} className="p-1.5 rounded-md text-slate-400 hover:text-white" style={surface}><ZoomIn size={13} /></button>
          </div>
        )}
        <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-white" style={surface}><X size={15} /></button>
      </div>

      {/* Stage */}
      <div ref={stageRef} className="flex-1 relative flex items-center justify-center overflow-hidden select-none" onWheel={onWheel}>
        {photos.length > 1 && !drawing && (
          <>
            <button onClick={() => go(-1)} className="absolute left-3 z-10 p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"><ChevronLeft size={22} /></button>
            <button onClick={() => go(1)} className="absolute right-3 z-10 p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"><ChevronRight size={22} /></button>
          </>
        )}

        {/* The wrapper carries the image's exact aspect ratio, so the SVG at
            inset-0 lines up with the pixels rather than with the letterboxing. */}
        <div
          className="relative"
          style={{
            ...aspectBox(w, h),
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center',
            cursor: drawing ? 'crosshair' : zoom > 1 ? 'grab' : 'zoom-in',
            touchAction: 'none',
          }}
          onDoubleClick={onDoubleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {compare && pair && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={api.nodePhotoUrl(nodeId, pair.id, { v: pair.updatedAt })} alt=""
              className="absolute inset-0 w-full h-full object-contain pointer-events-none" draggable={false} />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={photo.caption || `${deviceName ?? nodeId} — ${kindLabel(photo.kind)}`}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute inset-0 w-full h-full object-contain" draggable={false}
            style={compare ? { opacity: blend } : undefined} />

          <PhotoAnnotationOverlay annotations={[...marks, ...(pendingMark ? [pendingMark] : [])]}
            width={w} height={h} zoom={zoom} />
        </div>

        {compare && pair && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl pointer-events-auto" style={surface}>
              <span className="text-[10px] text-slate-400">{kindLabel(pair.kind)}</span>
              <input type="range" min={0} max={1} step={0.02} value={blend}
                onChange={(e) => setBlend(Number(e.target.value))} className="w-52 accent-orange-500" />
              <span className="text-[10px] text-orange-400">{kindLabel(photo.kind)}</span>
            </div>
          </div>
        )}

        {drawing && (
          <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
            <div className="text-[11px] px-3 py-1.5 rounded-lg text-slate-300 pointer-events-auto" style={surface}>
              <MousePointer2 size={11} className="inline mr-1.5 -mt-0.5" />
              Drag to point an arrow at a hotspot · click to mark a spot
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-2.5 space-y-2.5" style={{ borderTop: '1px solid #1e2433' }}>
        {drawing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400">{marks.length} marker{marks.length === 1 ? '' : 's'}</span>
            {marks.map((m, i) => (
              <span key={i} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-md" style={surface}>
                <input value={m.label ?? ''} onChange={(e) => setMarks((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={`${m.type} ${i + 1}`} maxLength={40}
                  className="text-[10px] bg-transparent outline-none text-white w-24" />
                <button onClick={() => setMarks((all) => all.filter((_, j) => j !== i))} className="p-0.5 text-slate-500 hover:text-red-400"><X size={11} /></button>
              </span>
            ))}
            <div className="flex-1" />
            <button onClick={() => { setMarks(photo.annotations ?? []); setDrawing(false) }}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-slate-400" style={surface}>
              <Undo2 size={12} /> Discard
            </button>
            <button onClick={saveMarks} disabled={busy}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save markers
            </button>
          </div>
        ) : editingMeta ? (
          <div className="flex flex-wrap items-center gap-2">
            <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as NodePhotoKind)}
              className="text-[11px] rounded-md px-2 py-1.5 text-white outline-none" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
              {kindOptions.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <input autoFocus value={draftCaption} onChange={(e) => setDraftCaption(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditingMeta(false) }}
              placeholder="e.g. HV bushing, as found 2026-08-04" maxLength={255}
              className="flex-1 min-w-[200px] text-[11px] rounded-md px-2 py-1.5 text-white outline-none"
              style={{ background: '#0a0e1a', border: '1px solid #6366f1' }} />
            <button onClick={saveMeta} disabled={busy} className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
            <button onClick={() => setEditingMeta(false)} className="text-[11px] px-3 py-1.5 rounded-md text-slate-400" style={surface}>Cancel</button>
          </div>
        ) : confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            <span className="text-[11px] text-slate-300">
              Delete the <b>{kindLabel(photo.kind).toLowerCase()}</b> photo{photo.caption ? <> “{photo.caption}”</> : ''}? This cannot be undone.
            </span>
            <div className="flex-1" />
            <button onClick={() => setConfirmDelete(false)} className="text-[11px] px-3 py-1.5 rounded-md text-slate-300" style={surface}>Keep it</button>
            <button onClick={remove} disabled={busy}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete permanently
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {photo.lat != null && photo.lng != null && (
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <MapPin size={11} className="text-emerald-400" />
                {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)}
                {canEdit && (
                  <button onClick={useLocation} disabled={busy}
                    className="ml-1 px-2 py-0.5 rounded text-[10px] text-emerald-300" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid #10b98144' }}>
                    Use as the device location
                  </button>
                )}
              </span>
            )}
            <div className="flex-1" />
            {canEdit && (
              <>
                {index !== 0 && (
                  <button onClick={makeCover} disabled={busy} title="Show this one on the dashboard, tables and map"
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-amber-300" style={surface}>
                    <Star size={12} /> Set as cover
                  </button>
                )}
                <button onClick={() => setDrawing(true)}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-slate-300" style={surface}>
                  <MousePointer2 size={12} /> Annotate{photo.annotations.length ? ` (${photo.annotations.length})` : ''}
                </button>
                <button onClick={() => { setDraftCaption(photo.caption ?? ''); setDraftKind(photo.kind); setEditingMeta(true) }}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-slate-300" style={surface}>
                  <Pencil size={12} /> Caption &amp; type
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md text-slate-400 hover:text-red-400" style={surface}>
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
        )}

        {/* Filmstrip — always visible, so moving between the nameplate and the
            thermal shot is one click rather than an arrow-key hunt. */}
        {photos.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => tryIndex(i)} title={`${kindLabel(p.kind)}${p.caption ? ` — ${p.caption}` : ''}`}
                className="flex-shrink-0 w-16 h-12 rounded-md overflow-hidden"
                style={{ border: i === index ? '2px solid #6366f1' : '1px solid #1e2433', opacity: i === index ? 1 : 0.6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api.nodePhotoUrl(nodeId, p.id, { thumb: true, v: p.updatedAt })} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
