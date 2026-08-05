'use client'

// ---------------------------------------------------------------------------
// Fetch a device photo's bytes as a data: URL, for the one consumer that can't
// just use an <img> — jsPDF's addImage() takes a data URL or raw bytes, not a
// src to fetch itself, so a report is the one place the browser has to fetch
// the same photo the gallery lightbox already renders.
// ---------------------------------------------------------------------------

import { apiImageUrl } from '@/lib/api'

export interface PhotoBlob {
  dataUrl: string
  /** 'JPEG' — every stored photo is re-encoded to JPEG by imagePipeline.ts. */
  format: 'JPEG'
  width: number
  height: number
}

const blobToDataUrl = (b: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

/**
 * Downloads one photo (the ~320px thumbnail by default — plenty for a report
 * page, and far less to fetch than the 1600px original) and returns it ready
 * for jsPDF.addImage(). Returns null on any failure: a report must still
 * generate for a device with no photo, or if the fetch fails.
 */
export async function fetchPhotoDataUrl(
  nodeId: string, photoId: string, opts: { thumb?: boolean; v?: string | number; width?: number; height?: number } = {},
): Promise<PhotoBlob | null> {
  try {
    const q: string[] = []
    if (opts.thumb !== false) q.push('thumb=1')
    if (opts.v) q.push(`v=${encodeURIComponent(String(opts.v))}`)
    const url = apiImageUrl(`/api/nodes/${nodeId}/photos/${photoId}${q.length ? `?${q.join('&')}` : ''}`)
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUrl = await blobToDataUrl(blob)
    if (opts.width && opts.height) return { dataUrl, format: 'JPEG', width: opts.width, height: opts.height }
    // No stored dimensions (a photo carried over from node_images pre-v36) —
    // decode once to learn them rather than guessing an aspect ratio.
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth || 4, height: img.naturalHeight || 3 })
      img.onerror = () => resolve({ width: 4, height: 3 })
      img.src = dataUrl
    })
    return { dataUrl, format: 'JPEG', ...dims }
  } catch {
    return null
  }
}
