// ---------------------------------------------------------------------------
// Minimal .xlsx writer (multi-sheet), no dependencies.
// ---------------------------------------------------------------------------
// Reports are exported as CSV, PDF and Excel. CSV loses the sheet split and PDF
// is not editable, so an operator taking readings into their own analysis wants
// a real workbook. A .xlsx is a ZIP of XML parts — and because a ZIP entry may
// be STORED (uncompressed), the whole container is writable in a few dozen lines
// instead of pulling in a spreadsheet library (SheetJS is ~1 MB) for what is a
// handful of tables. Files are bigger than a compressed workbook; for a device
// report (thousands of rows at most) that is irrelevant.
//
// Renaming a CSV to .xls was the other option and is what most dashboards do —
// Excel then shows a "the file format and extension don't match" warning on
// every open, which looks broken to the customer.
// ---------------------------------------------------------------------------

export type CellValue = string | number | null | undefined
export interface Sheet {
  name: string
  /** First row is the header. */
  rows: CellValue[][]
}

// ── ZIP primitives ─────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry { name: string; data: Uint8Array; crc: number }

/** Build a ZIP archive with every entry STORED (compression method 0). */
function zip(files: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder()
  const entries: Entry[] = files.map((f) => {
    const data = enc.encode(f.text)
    return { name: f.name, data, crc: crc32(data) }
  })

  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]

  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    // Local file header. Date/time are fixed (1980-01-01): a report's ZIP entry
    // timestamps carry no information, and a constant keeps output reproducible.
    const local = Uint8Array.from([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0x800), ...u16(0),   // version, flags (bit 11 = UTF-8 names), method 0 = stored
      ...u16(0), ...u16(0x21),                 // mod time, mod date
      ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(nameBytes.length), ...u16(0),
      ...Array.from(nameBytes),
    ])
    parts.push(local, e.data)

    central.push(Uint8Array.from([
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(0x800), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...Array.from(nameBytes),
    ]))
    offset += local.length + e.data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = Uint8Array.from([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset),
    ...u16(0),
  ])

  return new Blob([...parts, ...central, eocd] as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ── Workbook XML ───────────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not valid XML 1.0 and make Excel reject the file.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

/** 0 -> A, 25 -> Z, 26 -> AA … */
function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Excel rejects a workbook whose sheet names clash, exceed 31 chars or use []:*?/\ */
function safeSheetName(name: string, used: Set<string>): string {
  let base = (name || 'Sheet').replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 28)}_${i++}`
  used.add(candidate.toLowerCase())
  return candidate
}

function sheetXml(rows: CellValue[][]): string {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`
      if (v === null || v === undefined || v === '') return ''
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
      // Inline strings keep the workbook to one part per sheet (no sharedStrings).
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** Build a workbook Blob from one sheet per table. */
export function buildXLSX(sheets: Sheet[]): Blob {
  const used = new Set<string>()
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }))

  const files: { name: string; text: string }[] = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${named
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
  ]

  return zip(files)
}

/** Build and save a workbook. */
export function downloadXLSX(filename: string, sheets: Sheet[]) {
  const url = URL.createObjectURL(buildXLSX(sheets))
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
