'use client'

// ---------------------------------------------------------------------------
// Turn whatever came off someone's phone into something worth storing.
// ---------------------------------------------------------------------------
// The upload path used to be `reader.readAsDataURL(file)` — the raw bytes,
// base64'd, straight into the database. Three real problems came from that:
//
//   · a phone photo is 3–8 MB, stored whole and re-served whole every time a
//     dashboard renders, for an image displayed in a ~340px box;
//   · portrait photos appeared rotated 90°, because JPEG stores the rotation
//     as an EXIF tag rather than in the pixels, and <img> honours that tag
//     inconsistently once the image has been through a canvas;
//   · nothing smaller existed, so no list, table or map popup could show a
//     preview without downloading the full thing per row.
//
// Everything here happens in the browser. The server stores bytes and never
// decodes an image — no image library on the backend, no CPU spent per view.
//
// Orientation is handled by createImageBitmap(blob, {imageOrientation:
// 'from-image'}), which bakes the EXIF rotation into the pixels. Drawing that
// to a canvas therefore produces an upright image whose EXIF is then
// irrelevant — which is also why the tags are read from the ORIGINAL file
// below, before re-encoding drops them.
// ---------------------------------------------------------------------------

/** Long edge of the stored image. Comfortably sharper than any place it renders, including the lightbox. */
const MAX_EDGE = 1600
/** Long edge of the thumbnail used by tables, the map popup and the strip. */
const THUMB_EDGE = 320
const JPEG_QUALITY = 0.82
const THUMB_QUALITY = 0.7

export interface ProcessedImage {
  dataBase64: string
  contentType: string
  width: number
  height: number
  bytes: number
}
export interface ExifFacts {
  /** DateTimeOriginal — when the shutter fired, not when it was uploaded. */
  takenAt?: string
  lat?: number
  lng?: number
}
export interface ProcessResult {
  full: ProcessedImage
  thumb: ProcessedImage
  exif: ExifFacts
  /** Original file size, so the UI can say what it saved. */
  originalBytes: number
}

const b64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

function scaleTo(w: number, h: number, edge: number) {
  const longest = Math.max(w, h)
  if (longest <= edge) return { w, h }
  const k = edge / longest
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

async function encode(bmp: ImageBitmap, edge: number, quality: number): Promise<ProcessedImage> {
  const { w, h } = scaleTo(bmp.width, bmp.height, edge)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  // A transparent PNG flattened onto nothing turns black in JPEG; white is the
  // sane background for a photograph of a physical object.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality))
  return { dataBase64: await b64(blob), contentType: 'image/jpeg', width: w, height: h, bytes: blob.size }
}

// --- Minimal EXIF reader ---------------------------------------------------
// Only three tags are wanted (DateTimeOriginal, GPSLatitude, GPSLongitude) and
// pulling in an EXIF library for them would be more code than reading them.
// Orientation is deliberately NOT read: createImageBitmap already applied it.
function readExif(buf: ArrayBuffer): ExifFacts {
  const out: ExifFacts = {}
  try {
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return out   // not a JPEG
    let off = 2
    let tiff = -1
    while (off + 4 < view.byteLength) {
      if (view.getUint8(off) !== 0xff) break
      const marker = view.getUint8(off + 1)
      const size = view.getUint16(off + 2)
      if (marker === 0xe1) {                                   // APP1
        // "Exif\0\0" then the TIFF header
        if (view.getUint32(off + 4) === 0x45786966) { tiff = off + 10; break }
      }
      if (marker === 0xda) break                               // start of scan — no more metadata
      off += 2 + size
    }
    if (tiff < 0 || tiff + 8 > view.byteLength) return out
    const le = view.getUint16(tiff) === 0x4949                 // 'II' = little-endian
    const u16 = (p: number) => view.getUint16(p, le)
    const u32 = (p: number) => view.getUint32(p, le)
    if (u16(tiff + 2) !== 0x002a) return out

    const rational = (p: number) => {
      const n = u32(p), d = u32(p + 4)
      return d ? n / d : 0
    }
    const ascii = (p: number, n: number) => {
      let s = ''
      for (let i = 0; i < n - 1 && p + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(p + i))
      return s
    }
    /** Walk one IFD, handing each (tag, type, count, valueOffset) to fn. */
    const walk = (ifd: number, fn: (tag: number, type: number, count: number, valOff: number) => void) => {
      if (ifd + 2 > view.byteLength) return
      const n = u16(ifd)
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12
        if (e + 12 > view.byteLength) return
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4)
        const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
        const total = (sizes[type] ?? 1) * count
        const valOff = total > 4 ? tiff + u32(e + 8) : e + 8
        fn(tag, type, count, valOff)
      }
    }

    let exifIfd = -1, gpsIfd = -1
    walk(tiff + u32(tiff + 4), (tag, _t, _c, v) => {
      if (tag === 0x8769) exifIfd = tiff + u32(v)
      if (tag === 0x8825) gpsIfd = tiff + u32(v)
    })
    if (exifIfd > 0) {
      walk(exifIfd, (tag, _t, count, v) => {
        // 0x9003 DateTimeOriginal, "YYYY:MM:DD HH:MM:SS"
        if (tag === 0x9003 && count >= 19) {
          const s = ascii(v, count)
          const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
          if (m) out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
        }
      })
    }
    if (gpsIfd > 0) {
      let latRef = 'N', lngRef = 'E', lat: number | undefined, lng: number | undefined
      walk(gpsIfd, (tag, _t, _c, v) => {
        const dms = () => rational(v) + rational(v + 8) / 60 + rational(v + 16) / 3600
        if (tag === 0x0001) latRef = ascii(v, 2)
        if (tag === 0x0002) lat = dms()
        if (tag === 0x0003) lngRef = ascii(v, 2)
        if (tag === 0x0004) lng = dms()
      })
      // 0/0/0 is what a phone writes when it had no fix — a real coordinate,
      // but off the coast of Africa. Treat it as absent.
      if (lat !== undefined && lng !== undefined && (lat !== 0 || lng !== 0)) {
        out.lat = latRef === 'S' ? -lat : lat
        out.lng = lngRef === 'W' ? -lng : lng
      }
    }
  } catch {
    // Malformed EXIF is not a reason to reject a usable photo.
  }
  return out
}

/**
 * Decode, upright, downscale and re-encode a picked file, and read the few
 * EXIF facts worth keeping. Throws only if the file is not a decodable image.
 */
export async function processImage(file: File): Promise<ProcessResult> {
  const buf = await file.arrayBuffer()
  const exif = readExif(buf)
  // 'from-image' bakes the EXIF rotation into the pixels — this is the whole
  // fix for sideways phone photos.
  const bmp = await createImageBitmap(new Blob([buf], { type: file.type || 'image/jpeg' }), { imageOrientation: 'from-image' })
  try {
    const [full, thumb] = await Promise.all([
      encode(bmp, MAX_EDGE, JPEG_QUALITY),
      encode(bmp, THUMB_EDGE, THUMB_QUALITY),
    ])
    return { full, thumb, exif, originalBytes: file.size }
  } finally {
    bmp.close()
  }
}

export const humanSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
