import { fmtDateTime } from '@/lib/displayTime'
import { getOrgLogoDataUrl } from '@/lib/orgLogoDataUrl'

export interface DossierData {
  assetId: string
  assetName: string
  orgId?: string
  orgName?: string
  ratedKva: number
  voltageKv: number
  healthIndex: number
  oilTemp: number
  hotSpotTemp: number
  dtrCapacityKva: number
  dtrHeadroomKva: number
  duvalVerdict: string
  rttDays: number
  bushingPhaseBStatus: string
  bushingTanDelta: number
  dpAging: number
  moisturePpm: number
  /** False when the unit publishes no DGA — the gas section then says so. */
  gasesMeasured?: boolean
  gases: {
    h2: number
    ch4: number
    c2h2: number
    c2h4: number
    c2h6: number
    co: number
    co2: number
  }
}

/** SHA-256 of the exact snapshot this document was built from, hex-encoded. */
async function digestSnapshot(data: DossierData): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(data))
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return '(hash unavailable in this browser)'
  }
}

/**
 * Generate a 5-page engineering summary report from live telemetry.
 *
 * IMPORTANT — what this document is and is not:
 * This exports what the platform has actually measured or computed for this
 * asset right now. It is NOT a certified inspection, is NOT digitally signed
 * by anyone, and does NOT constitute a compliance instrument under any
 * standard it cites. Earlier revisions of this generator asserted the
 * opposite: named individuals marked "Digitally Signed", a hardcoded string
 * presented as a computed SHA-256 checksum, a fabricated maker/checker
 * authorization log with biometric verification that never occurred, and a
 * disclaimer claiming suitability for insurance underwriting and 21 CFR Part
 * 11 electronic-signature compliance. None of that was backed by anything —
 * the "checksum" did not change between runs or assets, the named signers
 * never touched this document, and several tables (lab calibration variance,
 * per-phase bushing serials/capacitance, a 24-hour dispatch profile, Duval
 * Pentagon coordinates) rendered fixed literals for every asset in every
 * organization regardless of what was actually passed in. A document that
 * gets saved and handed to a third party is exactly the wrong place for that.
 *
 * This version only prints a value it was actually given. Where the platform
 * has not (yet) computed something — a fault-zone classification from the
 * gas trajectory, a laboratory cross-check, a per-phase PD magnitude — the
 * report says so instead of inventing a plausible-looking number, and directs
 * the reader to the live in-app tool that DOES compute it interactively.
 */
export async function generateOfficialEngineeringDossier(data: DossierData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const generatedAt = fmtDateTime(new Date().toISOString())
  const snapshotHash = await digestSnapshot(data)

  // Real Arrhenius relative-aging factor from the real hot-spot temperature —
  // same formula and 110°C/15000 constants DynamicThermalRating.tsx already
  // uses, so this document and the live DTR panel cannot disagree.
  const thetaH = data.hotSpotTemp
  const faa = Math.exp(15000 / (110 + 273.15) - 15000 / (thetaH + 273.15))
  const overloadHours = 2
  const equivalentHoursLost = Number((faa * overloadHours).toFixed(2))
  const assetReplacementCostUsd = 85000
  const designLifeHours = 180000
  const costPerLifeHour = assetReplacementCostUsd / designLifeHours
  const assetDepreciationCost = Number((equivalentHoursLost * costPerLifeHour).toFixed(2))
  const incrementalPowerKwh = data.dtrHeadroomKva * 0.95 * overloadHours
  const powerDeliveryRevenueUsd = Number((incrementalPowerKwh * 0.11).toFixed(2))
  const netEconomicBenefitUsd = Number((powerDeliveryRevenueUsd - assetDepreciationCost).toFixed(2))

  // Header/footer helpers
  const addHeader = (pageNum: number, title: string) => {
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, pageWidth, 20, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.text(`${(data.orgName || 'SUBSTATION').toUpperCase()} — ASSET TELEMETRY SUMMARY`, 14, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Doc Ref: RPT-${data.assetId}-${new Date().getFullYear()}`, 14, 17)
    doc.text(`Page ${pageNum} of 5`, pageWidth - 28, 14)

    doc.setFillColor(241, 245, 249)
    doc.rect(0, 20, pageWidth, 9, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text(title.toUpperCase(), 14, 26)
  }

  const addFooter = (pageNum: number) => {
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.4)
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(`Auto-generated for ${data.orgName || 'Enterprise Asset'} by the OneOps Platform — not a certified instrument`, 14, pageHeight - 9)
    doc.text(`Reference standards: IEEE C57.104, IEEE C57.115, IEC 60599 (cited for context, not attested compliance)`, 14, pageHeight - 5)
    doc.text(`Generated: ${generatedAt} UTC+07:00`, pageWidth - 70, pageHeight - 9)
    doc.text(`Snapshot SHA-256: ${snapshotHash.slice(0, 16)}…`, pageWidth - 70, pageHeight - 5)
  }

  // =========================================================================
  // PAGE 1: Asset Summary & Health Index
  // =========================================================================
  addHeader(1, 'Section 1: Asset Identification & Health Index')

  doc.setDrawColor(99, 102, 241)
  doc.setLineWidth(0.8)
  doc.roundedRect(14, 34, pageWidth - 28, 49, 3, 3)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text('SUBSTATION ASSET TELEMETRY SUMMARY', 20, 42)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text('Snapshot of platform-computed values at the time stated below. Not an inspection record.', 20, 47)

  if (data.orgId) {
    try {
      const orgLogo = await getOrgLogoDataUrl(data.orgId, data.orgName || 'Industrial Substation')
      if (orgLogo?.dataUrl) {
        const maxW = 28, maxH = 18
        const scale = Math.min(maxW / orgLogo.width, maxH / orgLogo.height)
        const w = orgLogo.width * scale, h = orgLogo.height * scale
        doc.addImage(orgLogo.dataUrl, orgLogo.format, pageWidth - 24 - w, 38, w, h, undefined, 'FAST')
      }
    } catch {}
  }

  doc.setFillColor(238, 242, 255)
  doc.roundedRect(pageWidth - 62, 44, 42, 36, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(99, 102, 241)
  doc.text('COMPOSITE HI', pageWidth - 56, 51)
  doc.setFontSize(20)
  doc.text(`${data.healthIndex}`, pageWidth - 56, 61)
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text('/ 100', pageWidth - 56, 68)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
  doc.text(`Organization: ${data.orgName || 'Industrial Substation'}`, 20, 54)
  doc.text(`Asset Name: ${data.assetName}`, 20, 60)
  doc.text(`Asset Identifier: ${data.assetId}`, 20, 66)
  doc.text(`Rated Power: ${data.ratedKva.toLocaleString()} kVA`, 20, 72)
  doc.text(`Operating Voltage: ${data.voltageKv} kV`, 20, 78)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(30, 41, 59)
  doc.text('Summary', 14, 91)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(51, 65, 85)
  const execSummary = [
    `Live telemetry snapshot for unit ${data.assetName} (${data.assetId}), captured ${generatedAt}.`,
    data.gasesMeasured
      ? `Dissolved gas concentrations: Acetylene (C2H2) ${data.gases.c2h2} ppm, Ethylene (C2H4) ${data.gases.c2h4} ppm — see Section 2 for the full gas table. A fault-zone classification (Duval Pentagon) is not computed by this report; use the live DGA diagnostics screen in-app for that.`
      : `This asset does not publish dissolved gas concentrations — Section 2 carries no gas data. A DGA-based fault assessment requires a laboratory oil analysis, attached separately.`,
    `Dynamic Thermal Rating headroom: +${data.dtrHeadroomKva.toLocaleString()} kVA at current ambient conditions. Bushing dielectric loss: tan δ ${data.bushingTanDelta}% (${data.bushingPhaseBStatus}).`,
  ]
  doc.text(execSummary, 14, 98, { maxWidth: pageWidth - 28, lineHeightFactor: 1.4 })

  autoTable(doc, {
    startY: 130,
    head: [['Dimension', 'Reference Standard', 'Value at Snapshot Time', 'Source']],
    body: [
      ['Composite Health Index', '—', `${data.healthIndex} / 100`, 'Platform-computed'],
      ['Dynamic Thermal Rating', 'IEEE C57.115', `${data.dtrCapacityKva.toLocaleString()} kVA (+${data.dtrHeadroomKva.toLocaleString()} kVA headroom)`, 'Platform-computed'],
      ['Bushing Dielectric Loss', 'IEEE C57.19.00', `tan δ = ${data.bushingTanDelta}%`, data.bushingPhaseBStatus],
      ['Oil / Hot-Spot Temperature', 'IEEE C57.91', `${data.oilTemp}°C / ${data.hotSpotTemp}°C`, 'Live telemetry'],
      ['Moisture in Oil', 'Oommen Equilibrium', `${data.moisturePpm} ppm`, 'Live telemetry'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
  })

  // Honest sign-off area — blank fields for a real reviewer to fill in, not a
  // pre-populated claim that anyone has already reviewed this.
  const signY = 195
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 41, 59)
  doc.text('Engineering Review (not yet completed — for manual sign-off):', 14, signY)

  const colW = (pageWidth - 28) / 2
  const reviewers = ['Reviewed By', 'Approved By']
  reviewers.forEach((label, idx) => {
    const x = 14 + idx * colW
    doc.setDrawColor(203, 213, 225)
    doc.rect(x, signY + 5, colW - 4, 32)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
    doc.text(label, x + 4, signY + 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184)
    doc.text('Name: ________________________', x + 4, signY + 22)
    doc.text('Date: ________________________', x + 4, signY + 30)
  })

  addFooter(1)

  // =========================================================================
  // PAGE 2: Dissolved Gas Analysis — measured concentrations only
  // =========================================================================
  doc.addPage()
  addHeader(2, 'Section 2: Dissolved Gas Analysis — Measured Concentrations')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Dissolved Key Gas Concentrations (per IEEE C57.104-2019 gas list)', 14, 35)

  if (!data.gasesMeasured) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(180, 83, 9)
    doc.text('NO DISSOLVED-GAS SENSOR ON THIS ASSET — NO GAS DATA TO REPORT', 14, 44)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
    doc.text(
      'This transformer does not publish dissolved gas concentrations. Attach a laboratory oil analysis ' +
      '(ASTM D3612) separately; the zeros below are placeholders, not measurements of zero gas.',
      14, 51, { maxWidth: pageWidth - 28, lineHeightFactor: 1.4 }
    )
  }

  autoTable(doc, {
    startY: data.gasesMeasured ? 40 : 62,
    head: [['Gas Species', 'Formula', data.gasesMeasured ? 'Observed (ppm)' : 'Not measured']],
    body: [
      ['Hydrogen', 'H2', `${data.gases.h2}`],
      ['Methane', 'CH4', `${data.gases.ch4}`],
      ['Acetylene', 'C2H2', `${data.gases.c2h2}`],
      ['Ethylene', 'C2H4', `${data.gases.c2h4}`],
      ['Ethane', 'C2H6', `${data.gases.c2h6}`],
      ['Carbon Monoxide', 'CO', `${data.gases.co}`],
      ['Carbon Dioxide', 'CO2', `${data.gases.co2}`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  })

  // What this report deliberately does NOT claim.
  doc.setDrawColor(203, 213, 225)
  doc.setFillColor(248, 250, 252)
  const noteY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  doc.roundedRect(14, noteY, pageWidth - 28, 42, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105)
  doc.text('Not included in this snapshot:', 20, noteY + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
  doc.text([
    '• Rate-of-gas-generation (ppm/day) — requires two or more historical samples; use the live Trends view.',
    '• Duval Triangle/Pentagon fault-zone classification — use the live DGA Diagnostics screen, which computes this interactively from the gas ratios above.',
    '• Laboratory cross-check (syringe sample vs. this sensor) — attach separately if a lab result exists for this date.',
  ], 20, noteY + 15, { lineHeightFactor: 1.5 })

  addFooter(2)

  // =========================================================================
  // PAGE 3: Bushing Dielectric — only the figure actually measured
  // =========================================================================
  doc.addPage()
  addHeader(3, 'Section 3: High-Voltage Bushing Dielectric Loss')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text(`Bushing Dielectric Loss (${data.voltageKv} kV Class — ref. IEEE C57.19.00)`, 14, 35)

  autoTable(doc, {
    startY: 40,
    head: [['Measured Value', 'Assessment', 'Threshold Reference (IEEE C57.19.00)']],
    body: [
      [`tan δ = ${data.bushingTanDelta}%`, data.bushingPhaseBStatus, 'Normal < 0.5% · Elevated 0.5–1.0% · Alarm > 1.0%'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  })

  doc.setDrawColor(203, 213, 225)
  doc.setFillColor(248, 250, 252)
  const bushNoteY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  doc.roundedRect(14, bushNoteY, pageWidth - 28, 48, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105)
  doc.text('Scope of this section:', 20, bushNoteY + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
  doc.text([
    'This snapshot carries one dielectric-loss reading for this asset. It does not include per-phase',
    'capacitance drift, partial-discharge magnitude/phase angle, or bushing serial numbers — none of',
    'that is measured by the sensors currently configured on this unit. If a Doble/PRPD test has been',
    'performed, attach the laboratory report separately rather than relying on this summary for it.',
  ], 20, bushNoteY + 15, { lineHeightFactor: 1.5 })

  addFooter(3)

  // =========================================================================
  // PAGE 4: Dynamic Thermal Rating & Loss-of-Life (real formula, real inputs)
  // =========================================================================
  doc.addPage()
  addHeader(4, 'Section 4: Dynamic Thermal Rating & Loss-of-Life Estimate')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Dynamic Thermal Rating Snapshot (ref. IEEE C57.115 / IEC 60076-7)', 14, 35)

  autoTable(doc, {
    startY: 40,
    head: [['Metric', 'Value']],
    body: [
      ['Oil Temperature', `${data.oilTemp}°C`],
      ['Hot-Spot Temperature', `${data.hotSpotTemp}°C (safety ceiling: 120°C)`],
      ['Dynamic Capacity', `${data.dtrCapacityKva.toLocaleString()} kVA`],
      ['Available Headroom', `+${data.dtrHeadroomKva.toLocaleString()} kVA`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  })

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Loss-of-Life Estimate for a 2-Hour Use of Available Headroom (IEEE C57.91)', 14, 100)

  doc.setDrawColor(148, 163, 184)
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(14, 105, pageWidth - 28, 52, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(51, 65, 85)
  doc.text('MODELLED ESTIMATE — verify against the live DTR panel before acting', 20, 113)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(51, 65, 85)
  const lolNotes = [
    `• Relative Aging Factor (F_AA) at ${thetaH}°C hot-spot: ${faa.toFixed(3)}x (IEEE C57.91, 110°C baseline).`,
    `• Equivalent insulation life consumed over 2 hours at this hot-spot: ${equivalentHoursLost} hours.`,
    `• Asset depreciation cost (@ $${assetReplacementCostUsd.toLocaleString()} replacement / ${designLifeHours.toLocaleString()}h design life): $${assetDepreciationCost}.`,
    `• Indicative energy value of using the +${data.dtrHeadroomKva.toLocaleString()} kVA headroom for 2 hours (@ $0.11/kWh): $${powerDeliveryRevenueUsd}.`,
    `• Net figure: ${netEconomicBenefitUsd >= 0 ? '+' : ''}$${netEconomicBenefitUsd}. This is an economic MODEL, not a recommendation — a real overload`,
    `  decision also needs load duration, ambient trend, and operational context this snapshot does not carry.`,
  ]
  doc.text(lolNotes, 20, 121, { lineHeightFactor: 1.4 })

  addFooter(4)

  // =========================================================================
  // PAGE 5: Snapshot Integrity — a real, verifiable hash of the real data
  // =========================================================================
  doc.addPage()
  addHeader(5, 'Section 5: Snapshot Data & Integrity')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Snapshot Integrity Hash', 14, 35)

  doc.setFillColor(15, 23, 42)
  doc.roundedRect(14, 40, pageWidth - 28, 48, 2, 2, 'F')

  doc.setFont('courier', 'bold'); doc.setFontSize(8); doc.setTextColor(56, 189, 248)
  doc.text('SHA-256 OF THE EXACT DATA THIS REPORT WAS BUILT FROM:', 20, 48)

  doc.setFont('courier', 'normal'); doc.setFontSize(7); doc.setTextColor(226, 232, 240)
  const hashLines = doc.splitTextToSize(snapshotHash, pageWidth - 48)
  doc.text(hashLines, 20, 56)
  doc.text(
    `TELEMETRY: H2:${data.gases.h2}|CH4:${data.gases.ch4}|C2H2:${data.gases.c2h2}|C2H4:${data.gases.c2h4}|` +
    `C2H6:${data.gases.c2h6}|CO:${data.gases.co}|CO2:${data.gases.co2}`,
    20, 68
  )
  doc.text(`GENERATED: ${generatedAt} UTC+07:00`, 20, 76)
  doc.setFont('courier', 'normal'); doc.setFontSize(6.5); doc.setTextColor(148, 163, 184)
  doc.text('Recompute this hash from the JSON payload above to confirm the document matches its source data.', 20, 84)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text('Review Status', 14, 100)

  autoTable(doc, {
    startY: 105,
    head: [['Step', 'Status']],
    body: [
      ['Automated telemetry snapshot', 'COMPLETE — this document'],
      ['Engineering review', 'PENDING — see Page 1 sign-off block'],
      ['Laboratory cross-check (if applicable)', 'NOT ATTACHED'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  })

  // Honest framing box — replaces the fabricated "OFFICIALLY CERTIFIED" stamp.
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(1)
  doc.roundedRect(pageWidth / 2 - 45, 160, 90, 40, 4, 4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(71, 85, 105)
  doc.text('AUTO-GENERATED TELEMETRY SUMMARY', pageWidth / 2 - 40, 172)
  doc.setFontSize(7.5)
  doc.text('Not a certified inspection or signed instrument', pageWidth / 2 - 40, 179)
  doc.text('until the review block on Page 1 is completed.', pageWidth / 2 - 40, 185)
  doc.text(`Generated: ${generatedAt.slice(0, 10)}`, pageWidth / 2 - 40, 192)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184)
  const disclaimer = [
    'This document is an automated summary of platform telemetry and platform-computed estimates at the ' +
    'stated time. It is not digitally signed, has not been reviewed by a qualified engineer unless the sign-off ' +
    'block on Page 1 has been completed by hand, and is not a certified laboratory report. It does not attest ' +
    'compliance with any cited standard and is not intended for insurance, regulatory, or legal use without ' +
    'independent professional verification. Reference standards are cited to describe the methods behind the ' +
    'figures shown, not to claim certification against them.',
  ]
  doc.text(disclaimer, 14, 215, { maxWidth: pageWidth - 28, lineHeightFactor: 1.3 })

  addFooter(5)

  const filename = `Telemetry_Summary_${data.assetId}_${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
}
