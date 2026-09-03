// Proves the dossier's integrity hash is real in every browsing context.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// officialDossierGenerator hashed its snapshot with crypto.subtle.digest and
// caught failures into the literal string:
//
//     return '(hash unavailable in this browser)'
//
// which is what operators saw on the exported PdM Asset Intelligence Executive
// Summary: "Snapshot SHA-256: (hash unavailabl…".
//
// crypto.subtle is not a browser-capability question — it is gated on the page
// being a SECURE CONTEXT. Over plain HTTP `window.crypto.subtle` is undefined,
// so the property access throws and the catch swallows the reason. This cluster
// publishes the frontend on :30443 (TLS) and :30080 (plain), and the notify
// link builder's own last-resort URL is
// http://<org>.iiotplatform.<ip>.nip.io:30080 — so reaching the dashboard over
// http is ordinary here. Every export made that way carried no hash at all, on
// the one page whose purpose is to let a reader verify the document against its
// source data. Worse, the page still printed "Recompute this hash from the JSON
// payload above to confirm the document matches its source data" directly above
// the word "unavailable".
//
// A pure-JS SHA-256 removes the dependency on how the page was served. It is
// only trustworthy if it is byte-identical to a reference implementation, which
// is what this checks — against Node's own crypto, over inputs chosen to hit
// the padding edges where a hand-written SHA-256 usually breaks.
//
// Run from the repo root: node e2e/proofs/test-sha256-fallback.mjs

import { readFileSync } from 'fs'
import { createHash } from 'crypto'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const src = readFileSync(new URL('frontend-next/src/lib/sha256.ts', root), 'utf8')

// Transpile the TS by stripping the type annotations this file uses. Keeps the
// proof dependency-free while still executing the SHIPPED implementation rather
// than a copy of it.
const js = src
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/export (function|async function|const)/g, '$1')
  .replace(/: Uint8Array|: number|: string|: unknown|: boolean/g, '')
  .replace(/: Promise<string>/g, '')
  .replace(/: Record<string, unknown>/g, '')
  .replace(/\(globalThis\.crypto as Crypto \| undefined\)/g, '(globalThis.crypto)')
  .replace(/ as Record<string, unknown>/g, '')

const mod = new Function(`${js}; return { sha256Bytes, sha256Text, canonicalJson };`)()

const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

// ── 1. Byte-identical to Node, including at the padding boundaries ────────
// A block is 64 bytes and the length field takes the last 8, so inputs of
// length 55/56/57 and 63/64/65 are where a hand-rolled implementation most
// often gets the extra block wrong.
const CASES = [
  ['empty', ''],
  ['short', 'abc'],
  ['55 bytes (last that fits one block)', 'a'.repeat(55)],
  ['56 bytes (forces a second block)', 'a'.repeat(56)],
  ['57 bytes', 'a'.repeat(57)],
  ['63 bytes', 'a'.repeat(63)],
  ['64 bytes (exact block)', 'a'.repeat(64)],
  ['65 bytes', 'a'.repeat(65)],
  ['119 bytes', 'x'.repeat(119)],
  ['120 bytes', 'x'.repeat(120)],
  ['1000 bytes', 'z'.repeat(1000)],
  ['multibyte utf-8', 'หม้อแปลง °C — Δ 92.4 ✓'],
  ['a realistic snapshot', JSON.stringify({
    assetId: 'TR-SUBSTATION-01', orgName: 'Eternity Transformers', healthIndex: 87.4,
    gases: { h2: 65, ch4: 45, c2h2: 3.2, c2h4: 12, c2h6: 8, co: 320, co2: 2600 },
  })],
]
for (const [label, input] of CASES) {
  t(`sha256 matches node for ${label}`, mod.sha256Text(input) === ref(input),
    `got ${mod.sha256Text(input).slice(0, 16)}… want ${ref(input).slice(0, 16)}…`)
}

// Known-answer test, so a bug that happened to affect both sides identically
// would still be caught.
t('sha256("abc") equals the FIPS 180-4 published vector',
  mod.sha256Text('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

// ── 2. Canonical JSON is order-independent ───────────────────────────────
// A hash is only checkable if the reader can reproduce the exact bytes. Plain
// JSON.stringify keeps insertion order, so the same snapshot built by two code
// paths could serialise — and therefore hash — differently.
{
  const a = { b: 1, a: { z: [3, { y: 1, x: 2 }], y: 2 } }
  const b = { a: { y: 2, z: [3, { x: 2, y: 1 }] }, b: 1 }
  t('canonicalJson is independent of key insertion order',
    mod.canonicalJson(a) === mod.canonicalJson(b),
    `${mod.canonicalJson(a)} vs ${mod.canonicalJson(b)}`)
  t('canonicalJson preserves array order',
    mod.canonicalJson({ v: [3, 1, 2] }) === '{"v":[3,1,2]}')
}

// ── 3. The generator no longer ships an "unavailable" placeholder ─────────
const gen = readFileSync(new URL('frontend-next/src/lib/officialDossierGenerator.ts', root), 'utf8')
const code = gen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('the dossier has no "hash unavailable" fallback left',
  !/hash unavailable/i.test(code),
  'an integrity hash that can be absent is not an integrity hash')
t('the dossier hashes through the context-independent helper',
  /from '@\/lib\/sha256'/.test(gen) && /sha256\(/.test(code))
t('the dossier hashes a canonical serialisation',
  /canonicalJson\(/.test(code),
  'plain JSON.stringify is insertion-ordered, so the reader could not reproduce it')


// ── 4. No caller substitutes a weaker hash under the SHA-256 label ───────
// Both of these tried crypto.subtle and, when it was unavailable, returned a
// NON-CRYPTOGRAPHIC value under the same name and the same rendered length:
//   iiotReportGenerator: a 32-bit string hash zero-padded to 32 hex chars,
//     printed as "DOCUMENT INTEGRITY (SHA-256): sha256:<hash>" with
//     "(Verified)" beside it;
//   auditStore: a 53-bit mix rendered as 16 hex chars and repeated four times
//     to fill 64, so it is indistinguishable on sight from a real digest.
// That is worse than printing nothing — a reader seeing "sha256:" has no way
// to tell, and the property the checksum exists to provide is gone while its
// appearance remains.
for (const [file, label] of [
  ['frontend-next/src/lib/iiotReportGenerator.ts', 'report document hash'],
  ['frontend-next/src/lib/auditStore.ts', 'audit record checksum'],
  ['frontend-next/src/lib/officialDossierGenerator.ts', 'dossier snapshot hash'],
]) {
  const body = readFileSync(new URL(file, root), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  t(`${label} computes a real SHA-256 in every context`,
    /sha256\(/.test(body) && !/crypto\.subtle/.test(body))
  t(`${label} has no non-cryptographic fallback`,
    !/\(hash << 5\) - hash/.test(body) &&
    !/hex \+ hex \+ hex \+ hex/.test(body) &&
    !/Math\.imul/.test(body),
    'a 32/53-bit value rendered at 64 hex chars reads as a digest and is not one')
}

// ── 5. The per-device export carries the same integrity hash ─────────────
// The PdM dossier from the transformer dashboard prints a Snapshot SHA-256;
// the per-device date-range export from the SAME dashboard printed none, in
// either format — and that is the file an engineer actually forwards, and the
// one the dialog can also email as an attachment. A recipient had no way to
// check it against what the platform produced.
{
  const dlg = readFileSync(new URL('frontend-next/src/components/device/DeviceExportDialog.tsx', root), 'utf8')
  const code = dlg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  t('the device export computes a snapshot hash',
    /from '@\/lib\/sha256'/.test(dlg) && /await sha256\(payload\)/.test(code))
  t('it hashes a canonical serialisation of the exported rows',
    /canonicalJson\(\{/.test(code) && /rows: \(rows \?\? \[\]\)\.map/.test(code),
    'the digest has to cover the data, not just the header fields')

  t('the CSV prints the hash', /# Snapshot SHA-256: \$\{snap\.hash\}/.test(code))
  t('the PDF prints the hash', /doc\.text\('Snapshot SHA-256:'/.test(code))

  // One snapshot per action: the CSV and the PDF of a single export describe
  // the same data, so they must carry the same digest — and Exported At must
  // stop differing between them. buildCsv() stamped new Date() on every call,
  // so the downloaded CSV and the emailed CSV of one action already disagreed.
  t('both formats are built from ONE snapshot',
    /const buildCsv = \(snap: Snapshot\)/.test(code) &&
    /const buildPdf = async \(snap: Snapshot\)/.test(code) &&
    !/buildCsv\(\)/.test(code) && !/buildPdf\(\)/.test(code))
  t('the export timestamp comes from the snapshot, not a fresh clock read',
    /# Exported At: \$\{snap\.exportedAt\}/.test(code) &&
    !/# Exported At: \$\{fmtDateTime\(new Date\(\)\)\}/.test(code))

  // Both the download path and the send-as-attachment path.
  t('the downloaded files and the emailed attachments use the same snapshot',
    (code.match(/const snap = await buildSnapshot\(\)/g) || []).length === 2,
    'download() and send() must each take one snapshot and use it for both files')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
