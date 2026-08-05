'use client'

// ---------------------------------------------------------------------------
// The device's face, small — for tables, lists and map popups.
// ---------------------------------------------------------------------------
// A fleet table is a wall of ids. "TRA-9F2C" tells you nothing about which grey
// box in which yard it is; a 40px picture of it does, instantly, and it is the
// difference between reading a row and recognising an asset.
//
// These render the ~320px thumbnail produced at upload time, not the full
// image. A hundred-row table therefore costs a hundred small requests the
// browser caches immutably — not a hundred 1600px photos, which is what made
// "just show the photo in the table" impossible before migrate-v36.
//
// The cover ids come from ONE org-wide request (useOrgPhotoCovers), so a table
// never asks per row whether a device has a photo.
// ---------------------------------------------------------------------------

import { api } from '@/lib/api'
import { useNodePhotos } from '@/lib/useNodePhotos'
import PhotoLightbox from '@/components/device/PhotoLightbox'
import { ImageOff } from 'lucide-react'
import { useState } from 'react'

export interface PhotoCover { photoId: string; v: string }

/**
 * One cover thumbnail. `cover` is undefined for a device with no photo, which
 * renders a muted placeholder rather than a gap — the empty slot is itself
 * information ("nobody has photographed this unit").
 */
export function NodeThumb({
  nodeId, cover, name, size = 40, onOpen,
}: {
  nodeId: string
  cover?: PhotoCover
  name?: string
  size?: number
  onOpen?: () => void
}) {
  const box = { width: size, height: size, minWidth: size }
  if (!cover) {
    return (
      <span className="rounded-md flex items-center justify-center flex-shrink-0"
        style={{ ...box, background: '#0a0e1a', border: '1px solid #1e2433' }} title="No photo yet">
        <ImageOff size={Math.round(size * 0.36)} className="text-slate-700" />
      </span>
    )
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={api.nodePhotoUrl(nodeId, cover.photoId, { thumb: true, v: cover.v })}
      alt={name ? `${name} — device photo` : 'Device photo'} loading="lazy"
      className="w-full h-full object-cover" />
  )
  if (!onOpen) {
    return <span className="rounded-md overflow-hidden flex-shrink-0 block" style={{ ...box, border: '1px solid #1e2433' }}>{img}</span>
  }
  return (
    <button type="button" title="View photos"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpen() }}
      className="rounded-md overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-indigo-500"
      style={{ ...box, border: '1px solid #1e2433' }}>
      {img}
    </button>
  )
}

/**
 * Opens the full gallery for one device from a list. Loading is deferred to
 * this component so a table mounts one hook on demand instead of one per row.
 */
export function NodePhotoPreview({
  nodeId, deviceName, canEdit = false, onClose,
}: {
  nodeId: string
  deviceName?: string
  canEdit?: boolean
  onClose: () => void
}) {
  const { photos, reload } = useNodePhotos(nodeId)
  const [index, setIndex] = useState(0)
  if (!photos.length) return null
  return (
    <PhotoLightbox
      nodeId={nodeId} deviceName={deviceName} photos={photos}
      index={Math.min(index, photos.length - 1)} canEdit={canEdit}
      onIndex={setIndex} onClose={onClose} onChanged={reload} />
  )
}
