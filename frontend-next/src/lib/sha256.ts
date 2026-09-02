// SHA-256 that works in EVERY browsing context.
//
// WHY THIS EXISTS
// ---------------
// officialDossierGenerator hashed its snapshot with crypto.subtle.digest and
// fell back to the literal string "(hash unavailable in this browser)". That
// string is what operators actually saw on the exported PdM Asset Intelligence
// Executive Summary.
//
// crypto.subtle is not a browser-capability question — it is gated on the page
// being a SECURE CONTEXT. On plain HTTP `window.crypto.subtle` is undefined, so
// the property access throws and the catch swallows it. The cluster publishes
// the frontend on both :30443 (TLS) and :30080 (plain), and the notify link
// builder's own last-resort URL is http://<org>.iiotplatform.<ip>.nip.io:30080
// — so reaching the dashboard over http is an ordinary thing to do here, not an
// edge case. Every export made that way carried no integrity hash at all, on
// the one page whose entire purpose is to let a reader verify the document
// against its source data.
//
// A document-integrity hash must not depend on how the page was served. This is
// a plain implementation of FIPS 180-4 §6.2 with no dependencies, used whenever
// crypto.subtle is unavailable. It is verified byte-identical to Node's
// createHash('sha256') by e2e/proofs/test-sha256-fallback.mjs.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** Hex SHA-256 of the given bytes. Pure JS — no Web Crypto, no dependencies. */
export function sha256Bytes(input: Uint8Array): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  // Pad: 0x80, then zeros, then the 64-bit big-endian bit length.
  const bitLen = input.length * 8
  const withOne = input.length + 1
  const blocks = Math.ceil((withOne + 8) / 64)
  const buf = new Uint8Array(blocks * 64)
  buf.set(input)
  buf[input.length] = 0x80
  // Lengths beyond 2^32 bits (512 MB) are not reachable for a JSON snapshot,
  // but write the full 64-bit field so the padding is spec-correct regardless.
  const dv = new DataView(buf.buffer)
  dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000), false)
  dv.setUint32(buf.length - 4, bitLen >>> 0, false)

  const w = new Uint32Array(64)
  for (let b = 0; b < blocks; b++) {
    const off = b * 64
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    // Indexed rather than destructured: the project's tsconfig target predates
    // es2015 iteration over a typed array.
    let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & bb) ^ (a & c) ^ (bb & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e
      e = (d + t1) >>> 0
      d = c; c = bb; bb = a
      a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }

  let out = ''
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0')
  return out
}

/** Hex SHA-256 of a string, encoded UTF-8. */
export function sha256Text(text: string): string {
  return sha256Bytes(new TextEncoder().encode(text))
}

/**
 * Hex SHA-256, preferring the platform implementation and falling back to the
 * one above.
 *
 * The fallback is not a lesser result — both produce the same digest — it just
 * costs a few milliseconds more. What matters is that a caller never has to
 * present "unavailable" in place of an integrity hash because of how the page
 * happened to be served.
 */
export async function sha256(text: string): Promise<string> {
  const subtle = typeof globalThis !== 'undefined'
    ? (globalThis.crypto as Crypto | undefined)?.subtle
    : undefined
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // Fall through — a secure-context or policy failure is not a reason to
      // ship a document with no hash.
    }
  }
  return sha256Text(text)
}

/**
 * Deterministic JSON: object keys sorted at every depth.
 *
 * A hash is only checkable if the reader can reproduce the exact bytes that
 * were hashed, and plain JSON.stringify preserves insertion order — so the same
 * snapshot reached by two code paths could serialise differently and hash
 * differently, with nothing on the page to explain the mismatch.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = sortDeep(src[key])
    return out
  }
  return value
}
