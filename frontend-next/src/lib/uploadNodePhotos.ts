'use client'

// ---------------------------------------------------------------------------
// Pick files → upright, downscale, upload. Shared by every surface that takes
// a device photo (the gallery on the device page, the strip on Pending
// Devices), so the processing rules cannot drift between them — a photo added
// while approving a device has to come out identical to one added afterwards.
// ---------------------------------------------------------------------------

import { api, type NodePhotoKind } from '@/lib/api'
import { processImage, humanSize } from '@/lib/imagePipeline'

/** Refuse before the network, not after: the API caps the decoded image at 10 MB. */
export const MAX_PICK_BYTES = 25 * 1024 * 1024

export interface UploadOutcome {
  added: number
  failed: number
  /** Bytes picked vs bytes stored, so the UI can show what the downscale saved. */
  originalBytes: number
  storedBytes: number
  /** First coordinate found in EXIF, offered as the device's location. */
  geo: { lat: number; lng: number } | null
}

export async function uploadNodePhotos(
  nodeId: string,
  files: FileList | File[],
  kind: NodePhotoKind,
  onProgress?: (text: string | null) => void,
  onError?: (message: string) => void,
): Promise<UploadOutcome> {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
  const out: UploadOutcome = { added: 0, failed: 0, originalBytes: 0, storedBytes: 0, geo: null }

  for (let i = 0; i < list.length; i++) {
    const file = list[i]
    const step = (verb: string) => onProgress?.(list.length > 1 ? `${verb} ${i + 1}/${list.length}…` : `${verb}…`)
    if (file.size > MAX_PICK_BYTES) {
      out.failed++
      onError?.(`${file.name} is ${humanSize(file.size)} — too large even to downscale`)
      continue
    }
    try {
      // Decode, upright from EXIF, downscale — all in the browser. The server
      // stores bytes and never decodes an image.
      step('Processing')
      const r = await processImage(file)
      step('Uploading')
      const res = await api.addNodePhoto(nodeId, {
        dataBase64: r.full.dataBase64,
        thumbBase64: r.thumb.dataBase64,
        contentType: r.full.contentType,
        kind,
        width: r.full.width,
        height: r.full.height,
        takenAt: r.exif.takenAt ?? null,
        lat: r.exif.lat ?? null,
        lng: r.exif.lng ?? null,
      })
      if (!res?.ok) { out.failed++; onError?.(`${file.name} was not saved`); continue }
      out.added++
      out.originalBytes += r.originalBytes
      out.storedBytes += r.full.bytes + r.thumb.bytes
      if (!out.geo && r.exif.lat != null && r.exif.lng != null) out.geo = { lat: r.exif.lat, lng: r.exif.lng }
    } catch (e) {
      out.failed++
      onError?.(`${file.name}: ${(e as Error).message}`)
    }
  }
  onProgress?.(null)
  if (!list.length) onError?.('Pick an image file — this slot is the photo of the unit')
  return out
}

/** "6.2 MB → 310 KB", the line worth showing after an upload. */
export const savedLine = (o: UploadOutcome) => `${humanSize(o.originalBytes)} → ${humanSize(o.storedBytes)}`
