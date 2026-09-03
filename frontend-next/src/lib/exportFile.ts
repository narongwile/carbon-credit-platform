'use client'

// ---------------------------------------------------------------------------
// Small client-side export helpers shared by the alarm/event tables.
//
// CSV is a Blob download (the same pattern already used by the SQL console and
// the device detail page, centralised here so every table quotes and escapes
// the same way).
//
// PDF goes through the browser's own print-to-PDF: a hidden iframe with a
// self-contained document, printed on load. For a single on-screen table that
// matches what the user sees in the print preview and costs nothing to render.
// (Multi-section documents like the device report use jspdf instead, so they
// download straight to a file without a print dialog.)
//
// INTEGRITY HASH
// Every document produced here carries a Snapshot SHA-256 of the rows it
// contains, the same way the PdM dossier and the per-device export do. These
// files leave the platform — an alarm log attached to an incident report, a
// parameter history sent to a manufacturer — and a recipient had no way to tell
// whether what they received matched what was exported.
//
// sha256Text is the SYNCHRONOUS pure-JS digest, deliberately: crypto.subtle is
// async and is gated on a secure context, while these helpers are called
// synchronously from thirteen places. Using it keeps every signature and every
// call site unchanged, and costs a few milliseconds on a table-sized payload.
// ---------------------------------------------------------------------------

import { sha256Text } from '@/lib/sha256'

/** Quote a CSV cell: wrap in quotes and double any embedded quote. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The exact text a digest is taken over: the header row and every data row,
 * rendered the same way the CSV body is.
 *
 * Shared by the CSV and PDF paths on purpose — exporting one table in both
 * formats then yields the same hash, so the two files are visibly the same
 * snapshot. The BOM and the `#` comment lines are NOT included, so "hash
 * everything above the comment block" is a rule a reader can actually apply.
 */
function digestOf(headers: string[], rows: unknown[][]): string {
  return sha256Text([headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'))
}

/**
 * The digest over a multi-section document.
 *
 * Exported so a builder that does not go through downloadCSVSections — the
 * device Report button renders its own jsPDF and its own workbook — can print
 * the SAME value. All four formats of one report then carry one digest, and a
 * recipient holding the PDF and the CSV can see they are the same snapshot.
 */
export function sectionsDigest(
  sections: { title: string; headers: string[]; rows: unknown[][] }[],
): string {
  return sha256Text(
    sections.map((sec) => [sec.headers, ...sec.rows].map((r) => r.map(csvCell).join(',')).join('\n')).join('\n\n'),
  )
}

/** The trailer appended to a CSV, stating what the digest covers. */
function csvHashTrailer(hash: string): string[] {
  return [
    '',
    `# Snapshot SHA-256: ${hash}`,
    '# Covers the header row and every data row above, joined with newlines,',
    '# excluding these comment lines and the leading byte-order mark.',
  ]
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick — Safari needs the URL alive during the click.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadCSV(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  // The digest goes at the END, not the top. downloadCSVSections can lead with
  // `#` lines because it always has; this one has always put the header row
  // first, and prepending comments would push it down a row in Excel for all
  // thirteen callers. A trailer adds the integrity line without changing what
  // any existing consumer parses.
  const out = [body, ...csvHashTrailer(digestOf(headers, rows))].join('\n')
  // BOM so Excel opens UTF-8 (°C, Thai text) correctly.
  triggerDownload(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8;' }), filename)
}

/**
 * Several tables in one CSV. Spreadsheets have no notion of sections, so each
 * one is introduced by a `# Title` line and separated by a blank row — the
 * layout every operator already recognises from exported machine logs.
 */
export function downloadCSVSections(
  filename: string,
  sections: { title: string; headers: string[]; rows: unknown[][] }[],
  meta: string[] = [],
) {
  const lines: string[] = []
  for (const m of meta) lines.push(`# ${csvCell(m)}`)
  // Every section's header and rows, in order — one digest for the whole
  // document rather than one per section, because the document is what gets
  // sent on. Leading `#` metadata is this function's existing convention, so
  // the hash goes at the top here and no consumer contract changes.
  lines.push(`# Snapshot SHA-256: ${sectionsDigest(sections)}`)
  lines.push('# Covers every section header and data row below, joined with newlines,')
  lines.push('# excluding these comment lines, the section titles and the byte-order mark.')
  for (const s of sections) {
    if (lines.length) lines.push('')
    lines.push(`# ${csvCell(s.title)}`)
    lines.push(s.headers.map(csvCell).join(','))
    for (const r of s.rows) lines.push(r.map(csvCell).join(','))
    if (!s.rows.length) lines.push('(no rows in this period)')
  }
  triggerDownload(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), filename)
}

/** Save any text payload (used for the JSON export). */
export function downloadText(filename: string, text: string, type = 'application/json;charset=utf-8;') {
  triggerDownload(new Blob([text], { type }), filename)
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/**
 * Render a table to PDF via the print dialog. `meta` lines (time range, device,
 * filters) print under the title so an exported page is self-describing.
 */
export function printTablePDF(title: string, headers: string[], rows: unknown[][], meta: string[] = []) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; font-weight: 600; }
  tr:nth-child(even) td { background: #fafbfc; }
  /* Monospace so the hex is legible character by character, and small enough
     that 64 chars fit one printed line. */
  .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; color: #444;
          margin-bottom: 12px; word-break: break-all; }
  .hash span { color: #777; font-family: inherit; }
  @page { margin: 14mm; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${meta.map(escapeHtml).join(' &middot; ')}${meta.length ? ' &middot; ' : ''}Exported ${escapeHtml(new Date().toLocaleString())}</div>
<div class="hash">Snapshot SHA-256: ${escapeHtml(digestOf(headers, rows))}<br><span>Covers the header row and every data row in the table below. Exporting the same table as CSV yields this digest.</span></div>
<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
</body></html>`

  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) { frame.remove(); return }
  win.document.open()
  win.document.write(doc)
  win.document.close()
  // Give the iframe a tick to lay out before printing, then clean up after.
  setTimeout(() => {
    win.focus()
    win.print()
    setTimeout(() => frame.remove(), 1000)
  }, 150)
}
