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
// ---------------------------------------------------------------------------

/** Quote a CSV cell: wrap in quotes and double any embedded quote. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  // BOM so Excel opens UTF-8 (°C, Thai text) correctly.
  triggerDownload(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }), filename)
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
  @page { margin: 14mm; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${meta.map(escapeHtml).join(' &middot; ')}${meta.length ? ' &middot; ' : ''}Exported ${escapeHtml(new Date().toLocaleString())}</div>
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
