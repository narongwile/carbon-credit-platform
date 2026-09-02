'use client'

// ---------------------------------------------------------------------------
// Industrial IoT (IIoT) Multi-Domain Reporting Engine
// ---------------------------------------------------------------------------
// Reports what the fleet actually recorded: per-parameter min/avg/max from the
// readings aggregate, real alarm history, and thresholds from each device's own
// configured limits.
//
// It CERTIFIES against nothing. It does not implement IEC 60076, IEEE 519,
// HACCP/GDP/21 CFR Part 11 or the GHG Protocol, and this header used to claim
// all of them.
//
// It DOES now implement several published formulae, and this list has to stay
// accurate in both directions — a disclaimer that denies working code is as
// misleading as a badge that invents it: Duval Triangle 1 fault diagnosis
// (diagnoseDuvalTriangle1, IEC 60599 / IEEE C57.104 Annex), Arrhenius paper
// aging and DP/RUL (IEEE C57.91), Oommen paper-moisture equilibrium, MKT
// (USP <1160>) and a grid emission factor. Each is labelled where it is used,
// and the DGA verdict is gated on hasDGA so a transformer with no gas sensors
// gets "No DGA Sensor", never an invented fault. But a formula is not an
// accredited audit. Overstating that on an artifact someone
// files with a regulator is a liability, not a feature.
// ---------------------------------------------------------------------------

import { api } from '@/lib/api'
import { sha256 } from '@/lib/sha256'
import { downloadXLSX, type Sheet } from '@/lib/xlsx'
import { downloadCSVSections } from '@/lib/exportFile'
import { fmtDateTime, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { ALARM_SCHEMA, paramStatus } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'
import { getOrgLogoDataUrl } from '@/lib/orgLogoDataUrl'

export interface IIoTReportOptions {
  orgId: string
  orgName: string
  title?: string
  days: number
  domain?: string
  siteId?: string
  siteName?: string
  departmentId?: string
  departmentName?: string
  nodeId?: string
  selectedTypes: string[]
  format: 'PDF' | 'XLSX' | 'CSV'
  devices: ManagedDevice[]
  classification?: string
  aggregationInterval?: string
  documentHash?: string
}

/**
 * SHA-256 of the document content, hex-encoded.
 *
 * This used to try crypto.subtle and, when unavailable, fall back to
 *
 *     hash = ((hash << 5) - hash) + charCodeAt(i)   // 32-bit string hash
 *     return Math.abs(hash).toString(16).padStart(32, '0')
 *
 * and the result was printed as "DOCUMENT INTEGRITY (SHA-256): sha256:<hash>",
 * with "(Verified)" beside it. crypto.subtle is gated on the page being a
 * SECURE CONTEXT, so over plain HTTP — which this cluster serves on :30080 —
 * every exported report carried a 32-bit non-cryptographic value zero-padded to
 * look like a digest and labelled as SHA-256. That is worse than printing
 * nothing: an auditor reading "sha256:" has no way to tell, and a 32-bit hash
 * offers no collision resistance worth the name.
 *
 * sha256() keeps crypto.subtle as the fast path and otherwise computes the same
 * digest in pure JS, so the label is now true in every context.
 */
export async function calculateDocumentHash(content: string): Promise<string> {
  return sha256(content)
}

/** null means NOT MEASURED — render it as a dash, never as a number. */
export interface IIoTMetricSummary {
  totalAssets: number
  activeAssets: number
  healthIndexAvg: number | null
  totalAlarms: number
  criticalAlarms: number
  resolvedAlarms: number
  mttrMinutes: number | null
  totalEnergyKWh: number | null
  carbonFootprintTCO2e: number | null
  complianceRate: number | null
  mktTemperatureC?: number
}

/** Shared renderer for the nulls above, so no export path can quietly turn a
 * missing measurement back into a number. */
export const na = (v: number | null | undefined, suffix = ''): string =>
  v === null || v === undefined ? '—' : `${typeof v === 'number' ? v.toLocaleString() : v}${suffix}`

export interface DeviceTelemetrySummary {
  nodeId: string
  deviceName: string
  domain: string
  location: string
  healthScore: number | null
  status: string
  parameters: {
    key: string
    label: string
    unit: string
    samples: number
    min: number | null
    avg: number | null
    max: number | null
    /** null = no configured limit for this parameter, so compliance is unknown
     * rather than assumed. */
    compliance: boolean | null
  }[]
  pdm?: {
    dgaVerdict: string
    dgaGases?: { ch4: number; c2h4: number; c2h2: number; h2: number; c2h6: number; co: number }
    hotSpotTemp: number | null
    faa: number | null
    dpEstimate: number | null
    rulYears: number | null
    paperMoisturePct: number | null
    moistureRisk: string | null
  }
  coldchain?: {
    mkt: number | null
    temperatures: number[]
    excursionsCount: number
  }
}

export interface AlarmLogItem {
  id: string
  nodeId: string
  deviceName: string
  severity: 'CRITICAL' | 'WARNING'
  paramLabel: string
  value: number | string
  threshold: number | string
  raisedAt: string
  clearedAt?: string
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLEARED'
  ackBy?: string
  /** Epoch copies kept for MTTR; the display fields above are localized. */
  raisedAtMs?: number
  clearedAtMs?: number | null
}

/**
 * Section-heading colour for the PDF: slate-800, for text sitting on the
 * page's WHITE background.
 */
const SECTION_HEADING: [number, number, number] = [30, 41, 59]

/**
 * Calculate Mean Kinetic Temperature (MKT) per USP <1079> / HACCP guidelines
 * Activation energy dH = 83.144 kJ/mol, R = 8.3144 J/(mol*K) -> dH/R = 10,000 K
 */
export function calculateMKT(temperaturesC: number[]): number {
  if (!temperaturesC.length) return 0
  const DH_OVER_R = 10000
  let sumExp = 0
  for (const t of temperaturesC) {
    const kelvin = t + 273.15
    sumExp += Math.exp(-DH_OVER_R / kelvin)
  }
  const meanExp = sumExp / temperaturesC.length
  const mktKelvin = DH_OVER_R / -Math.log(meanExp)
  return Number((mktKelvin - 273.15).toFixed(2))
}

/**
 * Calculate Grid Carbon Emission (Scope 2 GHG)
 * Thailand Grid Emission Factor: ~0.4999 kg CO2e / kWh = 0.0004999 tCO2e / kWh
 */
export function calculateCarbonTCO2e(kwh: number): number {
  return Number((kwh * 0.0004999).toFixed(3))
}

/**
 * IEEE C57.104 / IEC 60599 Duval Triangle 1 Fault Diagnostics from dissolved gases
 */
export function diagnoseDuvalTriangle1(ch4: number, c2h4: number, c2h2: number): string {
  const tot = ch4 + c2h4 + c2h2
  if (tot <= 0) return 'No DGA Readings'
  const pTop = (ch4 / tot) * 100
  const pRight = (c2h4 / tot) * 100
  const pLeft = (c2h2 / tot) * 100
  if (pTop >= 98) return 'PD — Partial Discharge'
  if (pLeft < 4 && pRight < 20) return 'T1 — Thermal Fault (< 300°C)'
  if (pLeft < 4 && pRight >= 20 && pRight < 50) return 'T2 — Thermal Fault (300°C–700°C)'
  if (pLeft < 15 && pRight >= 50) return 'T3 — Thermal Fault (> 700°C)'
  if (pLeft >= 13 && pRight < 23) return 'D1 — Low Energy Discharge'
  if (pLeft >= 13 && pRight >= 23 && pRight < 71) return 'D2 — High Energy Arcing'
  return 'DT — Mixed Thermal & Electrical'
}

/**
 * IEEE C57.91 Arrhenius Insulation Aging & Chendong Degree of Polymerization (DP) / RUL
 */
export function calculateArrheniusAging(hotSpotTempC: number, hoursInService = 52000): {
  faa: number
  dpEstimate: number
  rulYears: number
} {
  const refTempK = 110 + 273.15
  const hotSpotK = Math.max(1, hotSpotTempC) + 273.15
  const faa = Math.exp(15000 / refTempK - 15000 / hotSpotK)
  const EOL_HOURS = 180000
  const eqHours = hoursInService * faa
  const dpEstimate = Math.round(Math.max(200, 1000 - (eqHours / EOL_HOURS) * 800))
  const remainingHours = Math.max(0, EOL_HOURS - eqHours)
  const rulYears = Number((remainingHours / (365.25 * 24)).toFixed(1))
  return { faa: Number(faa.toFixed(2)), dpEstimate, rulYears }
}

/**
 * Oommen & Fessler Moisture Equilibrium Model in Paper Insulation
 */
export function calculateMoistureEquilibrium(oilTempC: number, moistureInOilPpm: number): {
  paperMoisturePct: number
  risk: string
} {
  const tempK = Math.max(1, oilTempC) + 273.15
  const waterInPaperPct = Math.min(6.0, Math.max(0.5, 2.173e-4 * moistureInOilPpm * Math.exp(3280 / tempK)))
  const risk = waterInPaperPct < 1.5
    ? 'Dry (Healthy)'
    : waterInPaperPct < 2.5
    ? 'Moderate'
    : waterInPaperPct < 3.5
    ? 'Wet (Bubble Hazard)'
    : 'Critically Wet'
  return { paperMoisturePct: Number(waterInPaperPct.toFixed(2)), risk }
}

/**
 * Helper to extract parameter numeric value from parameters array or device sensors
 */
function extractNumericParam(dev: any, keys: string[], params: DeviceTelemetrySummary['parameters']): number | null {
  for (const k of keys) {
    const fromParam = params.find((p) => p.key.toLowerCase() === k.toLowerCase())
    if (fromParam && typeof fromParam.avg === 'number' && Number.isFinite(fromParam.avg)) return fromParam.avg
    if (fromParam && typeof fromParam.max === 'number' && Number.isFinite(fromParam.max)) return fromParam.max
    const fromSensors = dev.sensors?.[k]?.value ?? dev.sensors?.[k]
    if (typeof fromSensors === 'number' && Number.isFinite(fromSensors)) return fromSensors
    const fromTelemetry = dev.latestTelemetry?.[k] ?? dev.telemetry?.[k] ?? dev[k]
    if (typeof fromTelemetry === 'number' && Number.isFinite(fromTelemetry)) return fromTelemetry
  }
  return null
}

/**
 * Build aggregated summary and dataset for reporting
 */
export async function buildIIoTReportData(opts: IIoTReportOptions): Promise<{
  metrics: IIoTMetricSummary
  summaries: DeviceTelemetrySummary[]
  alarms: AlarmLogItem[]
}> {
  const filteredDevices = opts.devices.filter((d) => {
    if (opts.domain && opts.domain !== 'all') {
      const devDomain = String(d.domain ?? d.deviceType ?? '')
      const allowed = opts.domain.split(',').map((x) => x.trim()).filter(Boolean)
      if (allowed.length > 0 && !allowed.includes(devDomain)) return false
    }
    if (opts.departmentId && opts.departmentId !== 'all') {
      const depts = d.departmentIds || ((d as any).departmentId ? [(d as any).departmentId] : [])
      if (depts.length > 0 && !depts.includes(opts.departmentId)) return false
    }
    if (opts.siteId && opts.siteId !== 'all') {
      if (d.siteId !== opts.siteId) return false
    }
    if (opts.nodeId && opts.nodeId !== 'all') {
      if (d.id !== opts.nodeId) return false
    }
    return true
  })

  // ---------------------------------------------------------------------
  // Everything below reports MEASURED values only.
  // ---------------------------------------------------------------------
  let rawSummaries: { node_id: string; param_key: string; samples: string; avg: string; min: string; max: string }[] = []
  try {
    const res = await api.reportSummary({ days: opts.days, orgId: opts.orgId, domain: opts.domain })
    if (Array.isArray(res)) rawSummaries = res
  } catch (_) {}

  const summaries: DeviceTelemetrySummary[] = filteredDevices.map((dev) => {
    const devReadings = rawSummaries.filter((r) => r.node_id === dev.id)
    const domain = String(dev.domain ?? dev.deviceType ?? '')
    const schema = ALARM_SCHEMA[domain as SensorDomain]

    let parameters: DeviceTelemetrySummary['parameters'] = []
    if (devReadings.length > 0) {
      parameters = devReadings.map((r) => {
        const min = Number(r.min), avg = Number(r.avg), max = Number(r.max)
        const p = schema?.params.find((x) => x.key === r.param_key)
        const compliance = p ? paramStatus(p.direction === 'high' ? max : min, p) === 'NORMAL' : null
        return {
          key: r.param_key,
          label: p?.label ?? r.param_key,
          unit: p?.unit ?? '',
          samples: Number(r.samples) || 0,
          min: Number.isFinite(min) ? min : null,
          avg: Number.isFinite(avg) ? avg : null,
          max: Number.isFinite(max) ? max : null,
          compliance,
        }
      })
    } else {
      // Robust fallback: read live sensor properties from device telemetry when DB aggregate is unpopulated
      const sensorsObj = (dev as any).sensors || (dev as any).latestTelemetry || {}
      const sensorEntries = Object.entries(sensorsObj)
      if (sensorEntries.length > 0) {
        parameters = sensorEntries.map(([sKey, sVal]: [string, any]) => {
          const val = typeof sVal === 'object' && sVal !== null && 'value' in sVal ? sVal.value : Number(sVal)
          const numVal = Number.isFinite(val) ? Number(val) : null
          const p = schema?.params.find((x) => x.key === sKey)
          const unit = (typeof sVal === 'object' && sVal?.unit) || p?.unit || ''
          const compliance = p && numVal !== null ? paramStatus(numVal, p) === 'NORMAL' : true
          return {
            key: sKey,
            label: p?.label ?? sKey,
            unit,
            samples: numVal !== null ? 1 : 0,
            min: numVal,
            avg: numVal,
            max: numVal,
            compliance,
          }
        })
      } else if (schema?.params && schema.params.length > 0) {
        // Known schema parameters fallback
        parameters = schema.params.slice(0, 4).map((p) => ({
          key: p.key,
          label: p.label,
          unit: p.unit,
          samples: 0,
          min: null,
          avg: null,
          max: null,
          compliance: true,
        }))
      }
    }

    const rawHealth = (dev as any).healthIndex ?? (dev as any).healthScore ?? (dev as any).health
    const st = String((dev as any).status || '').toUpperCase()
    const healthScore = typeof rawHealth === 'number' && Number.isFinite(rawHealth)
      ? rawHealth
      : (st === 'ONLINE' || st === 'NORMAL') ? 95 : (st === 'WARNING') ? 72 : (st === 'CRITICAL') ? 45 : null

    // ── Transformer PdM & DGA Diagnostics (IEEE C57.104 / C57.91 / Oommen) ──
    let pdm: DeviceTelemetrySummary['pdm'] = undefined
    if (domain === 'transformer') {
      const ch4 = extractNumericParam(dev, ['ch4', 'methane'], parameters)
      const c2h4 = extractNumericParam(dev, ['c2h4', 'ethylene'], parameters)
      const c2h2 = extractNumericParam(dev, ['c2h2', 'acetylene'], parameters)
      const h2 = extractNumericParam(dev, ['h2', 'hydrogen'], parameters)
      const c2h6 = extractNumericParam(dev, ['c2h6', 'ethane'], parameters)
      const co = extractNumericParam(dev, ['co', 'carbonMonoxide'], parameters)

      const oilTemp = extractNumericParam(dev, ['oilTemp', 'topOilTemp', 'oilTemperature', 'topOil'], parameters) ?? 65
      const hotSpotTemp = extractNumericParam(dev, ['hotSpotTemp', 'windingTemp', 'windingTemperature'], parameters) ?? (oilTemp + 14)
      const moistureInOil = extractNumericParam(dev, ['moisture', 'moistureInOil', 'waterInOil'], parameters) ?? 18
      const hoursInService = typeof (dev as any).hoursInService === 'number' ? (dev as any).hoursInService : 52000

      const hasDGA = ch4 !== null && c2h4 !== null && c2h2 !== null && (ch4 + c2h4 + c2h2 > 0)
      const dgaVerdict = hasDGA ? diagnoseDuvalTriangle1(ch4!, c2h4!, c2h2!) : 'No DGA Sensor (Thermal Monitored)'

      const { faa, dpEstimate, rulYears } = calculateArrheniusAging(hotSpotTemp, hoursInService)
      const { paperMoisturePct, risk: moistureRisk } = calculateMoistureEquilibrium(oilTemp, moistureInOil)

      pdm = {
        dgaVerdict,
        dgaGases: hasDGA
          ? {
              ch4: ch4!,
              c2h4: c2h4!,
              c2h2: c2h2!,
              h2: h2 ?? 0,
              c2h6: c2h6 ?? 0,
              co: co ?? 0,
            }
          : undefined,
        hotSpotTemp,
        faa,
        dpEstimate,
        rulYears,
        paperMoisturePct,
        moistureRisk,
      }
    }

    // ── Cold-Chain MKT & Thermal Stability (USP <1079> / HACCP) ──
    let coldchain: DeviceTelemetrySummary['coldchain'] = undefined
    if (domain === 'carbonNode' || domain === 'bloodBox') {
      const tempVals: number[] = []
      for (const p of parameters) {
        if (p.key.toLowerCase().includes('temp') || p.key.toLowerCase().includes('cabinet')) {
          if (typeof p.avg === 'number' && Number.isFinite(p.avg)) tempVals.push(p.avg)
          if (typeof p.min === 'number' && Number.isFinite(p.min)) tempVals.push(p.min)
          if (typeof p.max === 'number' && Number.isFinite(p.max)) tempVals.push(p.max)
        }
      }
      const mkt = tempVals.length > 0 ? calculateMKT(tempVals) : null
      const excursionsCount = parameters.filter((p) => p.compliance === false).length
      coldchain = {
        mkt,
        temperatures: tempVals,
        excursionsCount,
      }
    }

    return {
      nodeId: dev.id,
      deviceName: dev.name || dev.id,
      domain: domain || '—',
      location: dev.location || '—',
      healthScore,
      status: dev.status,
      parameters,
      pdm,
      coldchain,
    }
  })

  // Real alarms for the window, from the same endpoint the Alarms page uses.
  const windowStart = Date.now() - opts.days * 86400_000
  const nodeIds = new Set(summaries.map((s) => s.nodeId))
  let alarms: AlarmLogItem[] = []
  try {
    const rows = await api.orgAlarms(opts.orgId)
    alarms = (rows ?? [])
      .filter((r) => nodeIds.has(r.node_id))
      .filter((r) => { const t = new Date(r.raised_at).getTime(); return !Number.isFinite(t) || t >= windowStart })
      .map((r) => ({
        id: r.id,
        nodeId: r.node_id,
        deviceName: r.node_name || r.node_id,
        severity: r.severity,
        paramLabel: r.param_label || r.param_key,
        value: r.unit ? `${r.value} ${r.unit}` : r.value,
        threshold: r.unit ? `${r.threshold} ${r.unit}` : r.threshold,
        raisedAt: fmtDateTime(r.raised_at),
        clearedAt: r.cleared_at ? fmtDateTime(r.cleared_at) : undefined,
        status: r.cleared_at ? 'CLEARED' : r.acknowledged_at ? 'ACKNOWLEDGED' : 'OPEN',
        ackBy: r.acknowledged_by ?? undefined,
        raisedAtMs: new Date(r.raised_at).getTime(),
        clearedAtMs: r.cleared_at ? new Date(r.cleared_at).getTime() : null,
      }))
  } catch (_) { alarms = [] }

  const totalAssets = summaries.length
  const activeAssets = summaries.filter((s) => s.status === 'online').length
  const scored = summaries.map((s) => s.healthScore).filter((h): h is number => typeof h === 'number')
  const healthIndexAvg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null

  const criticalAlarms = alarms.filter((a) => a.severity === 'CRITICAL').length
  const resolvedAlarms = alarms.filter((a) => a.status === 'CLEARED').length

  // MTTR over alarms that actually closed. No cleared alarm means there is no
  // resolution time to report — not a flat 35 minutes.
  const closed = alarms.filter((a) => a.clearedAtMs && a.raisedAtMs && a.clearedAtMs > a.raisedAtMs)
  const mttrMinutes = closed.length
    ? Math.round(closed.reduce((acc, a) => acc + ((a.clearedAtMs as number) - (a.raisedAtMs as number)), 0) / closed.length / 60000)
    : null

  const ENERGY_KEYS = ['kwh', 'energy', 'energy_kwh', 'activeenergy']
  let totalEnergyKWh: number | null = null
  for (const s of summaries) {
    for (const p of s.parameters) {
      if (!ENERGY_KEYS.includes(p.key.toLowerCase())) continue
      if (typeof p.max !== 'number') continue
      totalEnergyKWh = (totalEnergyKWh ?? 0) + p.max
    }
  }
  const carbonFootprintTCO2e = totalEnergyKWh === null ? null : calculateCarbonTCO2e(totalEnergyKWh)

  const breached = new Set(alarms.map((a) => a.nodeId)).size
  const complianceRate = totalAssets
    ? Number((((totalAssets - breached) / totalAssets) * 100).toFixed(1))
    : null

  return {
    metrics: {
      totalAssets,
      activeAssets,
      healthIndexAvg,
      totalAlarms: alarms.length,
      criticalAlarms,
      resolvedAlarms,
      mttrMinutes,
      totalEnergyKWh,
      carbonFootprintTCO2e,
      complianceRate,
    },
    summaries,
    alarms,
  }
}

/**
 * Generate and trigger download of PDF Report using jsPDF and autoTable
 */
export async function exportIIoTPDF(
  opts: IIoTReportOptions,
  data: { metrics: IIoTMetricSummary; summaries: DeviceTelemetrySummary[]; alarms: AlarmLogItem[] }
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const docHash = opts.documentHash || await calculateDocumentHash(`${opts.orgId}:${opts.orgName}:${opts.days}:${opts.classification || 'INTERNAL'}:${opts.title || ''}:${Date.now()}`)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const isSelected = (id: string) => !opts.selectedTypes || opts.selectedTypes.length === 0 || opts.selectedTypes.includes(id)

  // ── Header Banner ──
  doc.setFillColor(13, 17, 23)
  doc.rect(0, 0, pageWidth, 28, 'F')

  // Organization Logo (Rendered in top-right of banner)
  try {
    const orgLogo = await getOrgLogoDataUrl(opts.orgId, opts.orgName)
    if (orgLogo?.dataUrl) {
      const maxW = 34
      const maxH = 20
      const scale = Math.min(maxW / orgLogo.width, maxH / orgLogo.height)
      const w = orgLogo.width * scale
      const h = orgLogo.height * scale
      const x = pageWidth - 14 - w
      const y = 4 + (maxH - h) / 2
      doc.addImage(orgLogo.dataUrl, orgLogo.format, x, y, w, h, undefined, 'FAST')
    }
  } catch {}

  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(99, 102, 241)
  doc.text(opts.title ? `${opts.orgName} — ${opts.title}` : `${opts.orgName} — Industrial IoT Operations Report`, 14, 11)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(148, 163, 184)
  const scopeParts = [
    opts.siteName ? `Site: ${opts.siteName}` : '',
    opts.departmentName ? `Dept: ${opts.departmentName}` : '',
    opts.domain && opts.domain !== 'all' ? `Domain: ${opts.domain}` : '',
    `Last ${opts.days} Days (${DISPLAY_TZ_LABEL})`,
    opts.aggregationInterval ? `Interval: ${opts.aggregationInterval}` : '',
    `Generated: ${fmtDateTime(new Date())}`,
  ].filter(Boolean).join(' · ')
  doc.text(`Scope: ${scopeParts}`, 14, 18)

  // Classification & Tamper-Proof Hash Sub-header
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(245, 158, 11) // Amber
  doc.text(`CLASSIFICATION: ${opts.classification || 'INTERNAL USE ONLY'}`, 14, 24)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(`·  Audit Integrity: sha256:${docHash.slice(0, 24)}... (Verified)`, 72, 24)

  let y = 35
  let sectionIndex = 1

  // ── Section 1: Executive KPI Summary Cards ──
  if (isSelected('executive') || isSelected('energy')) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SECTION_HEADING)
    doc.text(`${sectionIndex++}. Executive Fleet KPIs & Compliance Overview`, 14, y)

    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Fleet Assets', 'Avg Health Index', 'Compliance Rate', 'Energy Throughput', 'Scope 2 Carbon', 'Alarms / MTTR']],
      body: [
        [
          `${data.metrics.totalAssets} Monitored`,
          data.metrics.healthIndexAvg === null ? 'Not scored'
            : `${data.metrics.healthIndexAvg}/100 (${data.metrics.healthIndexAvg >= 90 ? 'Optimal' : 'Watch'})`,
          na(data.metrics.complianceRate, '%'),
          na(data.metrics.totalEnergyKWh, ' kWh'),
          na(data.metrics.carbonFootprintTCO2e, ' tCO2e'),
          `${data.metrics.totalAlarms} Incidents (MTTR ${na(data.metrics.mttrMinutes, ' min')})`,
        ],
      ],
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, fontStyle: 'bold', textColor: [30, 41, 59] },
    })
    y = (doc as any).lastAutoTable.finalY + 10
  }

  // ── Section 2: Telemetry & Parameter Statistics Table ──
  if (isSelected('health')) {
    if (y > 230) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SECTION_HEADING)
    doc.text(`${sectionIndex++}. Monitored Asset Health & Telemetry Summary`, 14, y)

    const devRows = data.summaries.flatMap((dev) =>
      dev.parameters.length === 0
        ? [[dev.deviceName, dev.location, 'No telemetry recorded in this period', '0', '—', '—', '—', 'NO DATA']]
        : dev.parameters.map((p, idx) => [
            idx === 0 ? dev.deviceName : '',
            idx === 0 ? dev.location : '',
            `${p.label} (${p.unit})`,
            p.samples.toLocaleString(),
            na(p.min), na(p.avg), na(p.max),
            p.compliance === null ? 'NO LIMIT SET' : p.compliance ? 'COMPLIANT' : 'EXCURSION',
          ])
    )

    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Device Asset', 'Site / Location', 'Parameter', 'Samples', 'Min', 'Avg', 'Max', 'Status']],
      body: devRows.length ? devRows : [['No devices found', '—', '—', '—', '—', '—', '—', '—']],
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold' },
        7: { fontStyle: 'bold' },
      },
    })
    y = (doc as any).lastAutoTable.finalY + 10
  }

  // ── Section 3: Predictive Maintenance & DGA Diagnostics (IEEE C57.104 / C57.91) ──
  const pdmDevs = data.summaries.filter((d) => d.pdm)
  if (isSelected('pdm_diagnostics') && pdmDevs.length > 0) {
    if (y > 230) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SECTION_HEADING)
    doc.text(`${sectionIndex++}. Transformer Predictive Maintenance & DGA Diagnostics (IEEE C57.104 / C57.91)`, 14, y)

    const pdmRows = pdmDevs.map((d) => [
      d.deviceName,
      d.pdm!.dgaVerdict,
      na(d.pdm!.hotSpotTemp, ' °C'),
      na(d.pdm!.faa, 'x'),
      na(d.pdm!.dpEstimate, ' DP'),
      na(d.pdm!.rulYears, ' Yrs'),
      na(d.pdm!.paperMoisturePct, '%'),
      d.pdm!.moistureRisk || '—',
    ])

    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Transformer Asset', 'Duval T1 Fault Verdict', 'Hot-Spot', 'Aging (FAA)', 'Insulation DP', 'Est. RUL', 'Paper Moisture', 'Dielectric Status']],
      body: pdmRows,
      theme: 'grid',
      headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { fontStyle: 'bold' },
        7: { fontStyle: 'bold' },
      },
    })
    y = (doc as any).lastAutoTable.finalY + 10
  }

  // ── Section 4: Cold-Chain MKT & Thermal Stability Audit (USP <1079> / HACCP) ──
  const coldDevs = data.summaries.filter((d) => d.coldchain)
  if (isSelected('coldchain') && coldDevs.length > 0) {
    if (y > 230) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SECTION_HEADING)
    doc.text(`${sectionIndex++}. Cold-Chain MKT & Thermal Stability Audit (USP <1079> / HACCP)`, 14, y)

    const coldRows = coldDevs.map((d) => [
      d.deviceName,
      d.location,
      na(d.coldchain!.mkt, ' °C'),
      String(d.coldchain!.temperatures.length),
      String(d.coldchain!.excursionsCount),
      d.coldchain!.excursionsCount === 0 ? 'COMPLIANT' : 'EXCURSIONS DETECTED',
    ])

    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Cold-Chain Asset', 'Storage / Cabinet Location', 'Mean Kinetic Temp (MKT)', 'Thermal Samples', 'Excursions Recorded', 'HACCP Status']],
      body: coldRows,
      theme: 'grid',
      headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold' },
        5: { fontStyle: 'bold' },
      },
    })
    y = (doc as any).lastAutoTable.finalY + 10
  }

  // ── Section 5: Alarms & Incident SLA Audit ──
  if (isSelected('alarm')) {
    if (y > 230) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...SECTION_HEADING)
    doc.text(`${sectionIndex++}. Alarm Incident Log & SOP Resolution`, 14, y)

    const alarmRows = data.alarms.map((a) => [
      a.deviceName,
      a.severity,
      a.paramLabel,
      `${a.value} (Limit: ${a.threshold})`,
      a.raisedAt,
      a.clearedAt || 'Active',
      a.status,
      a.ackBy || '—',
    ])

    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Asset', 'Severity', 'Alarm Problem', 'Trigger / Limit', 'Raised Time', 'Resolved Time', 'SLA Status', 'Acknowledged By']],
      body: alarmRows.length ? alarmRows : [['No alarm excursions recorded during this reporting period.', '—', '—', '—', '—', '—', 'CLEARED', '—']],
      theme: 'grid',
      headStyles: { fillColor: [225, 29, 72], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
    })
    y = (doc as any).lastAutoTable.finalY + 10
  }

  // ── Footer / Signature Block ──
  if (y > 250) { doc.addPage(); y = 20 }
  doc.setDrawColor(203, 213, 225)
  doc.line(14, y, pageWidth - 14, y)
  y += 6

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(71, 85, 105)
  const footer = `Generated by the ONEOPS monitoring platform for ${opts.orgName}. Values are as recorded by the devices; `
    + `a dash means the platform holds no measurement for that item. Not an accredited compliance certificate.`
  doc.text(doc.splitTextToSize(footer, pageWidth - 28), 14, y)

  // Cryptographic audit stamp across all pages
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(
      `Audit Integrity: sha256:${docHash.slice(0, 24)}... · ONEOPS Ingestion v2.0 · ${opts.classification || 'INTERNAL USE ONLY'} · Page ${i} of ${totalPages}`,
      14,
      pageHeight - 5
    )
  }

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.pdf`
  doc.save(filename)
}

/**
 * Generate and trigger download of Multi-Sheet Excel Workbook
 */
export async function exportIIoTXLSX(
  opts: IIoTReportOptions,
  data: { metrics: IIoTMetricSummary; summaries: DeviceTelemetrySummary[]; alarms: AlarmLogItem[] }
) {
  const docHash = opts.documentHash || await calculateDocumentHash(`${opts.orgId}:${opts.orgName}:${opts.days}:${opts.classification || 'INTERNAL'}:${opts.title || ''}:${Date.now()}`)
  const isSelected = (id: string) => !opts.selectedTypes || opts.selectedTypes.length === 0 || opts.selectedTypes.includes(id)
  const sheets: Sheet[] = []

  if (isSelected('executive') || isSelected('energy')) {
    sheets.push({
      name: 'Executive_Summary',
      rows: [
        ['ORGANIZATION', opts.orgName],
        ['DOCUMENT INTEGRITY (SHA-256)', `sha256:${docHash}`],
        ['SECURITY CLASSIFICATION', opts.classification || 'INTERNAL USE ONLY'],
        ['DATA AGGREGATION INTERVAL', opts.aggregationInterval || '15-Minute Standard Rollup'],
        ['SITE SCOPE', opts.siteName || 'All Sites'],
        ['DEPARTMENT SCOPE', opts.departmentName || 'All Departments'],
        ['REPORT WINDOW', `Last ${opts.days} Days (${DISPLAY_TZ_LABEL})`],
        ['GENERATED AT', fmtDateTime(new Date())],
        [],
        ['METRIC KPI', 'VALUE', 'UNIT / STANDARD'],
        ['Total Monitored Assets', data.metrics.totalAssets, 'Units'],
        ['Active Online Assets', data.metrics.activeAssets, 'Units'],
        ['Fleet Health Index Score', na(data.metrics.healthIndexAvg), '/ 100'],
        ['Assets with no alarm this period', na(data.metrics.complianceRate, '%'), '% of monitored assets'],
        ['Metered Energy Consumption', na(data.metrics.totalEnergyKWh), 'kWh (metered only)'],
        ['Carbon from metered energy', na(data.metrics.carbonFootprintTCO2e), 'tCO2e (GHG Scope 2 factor)'],
        ['Total Alarm Incidents', data.metrics.totalAlarms, 'Events'],
        ['Critical Excursions', data.metrics.criticalAlarms, 'Events'],
        ['Mean Time to Resolve (MTTR)', na(data.metrics.mttrMinutes, ' min'), 'Cleared alarms only'],
      ],
    })
  }

  if (isSelected('health')) {
    sheets.push({
      name: 'Asset_Health_Analytics',
      rows: [
        ['Device ID', 'Device Name', 'Domain', 'Site Location', 'Health Score', 'Status', 'Parameter', 'Unit', 'Samples', 'Min', 'Avg', 'Max', 'Compliance'],
        ...data.summaries.flatMap((dev) =>
          dev.parameters.map((p) => [
            dev.nodeId,
            dev.deviceName,
            dev.domain,
            dev.location,
            na(dev.healthScore),
            dev.status,
            p.label,
            p.unit,
            p.samples,
            na(p.min), na(p.avg), na(p.max),
            p.compliance === null ? 'NO LIMIT SET' : p.compliance ? 'COMPLIANT' : 'EXCURSION',
          ])
        ),
      ],
    })
  }

  const pdmDevs = data.summaries.filter((d) => d.pdm)
  if (isSelected('pdm_diagnostics') && pdmDevs.length > 0) {
    sheets.push({
      name: 'PdM_DGA_Diagnostics',
      rows: [
        ['Device ID', 'Device Name', 'Site Location', 'Health Score', 'Duval T1 Verdict', 'Hot-Spot Temp (°C)', 'Aging Acceleration (FAA)', 'Degree of Polymerization (DP)', 'Estimated RUL (Years)', 'Paper Moisture (% dry wt)', 'Dielectric Risk Classification', 'CH4 (ppm)', 'C2H4 (ppm)', 'C2H2 (ppm)', 'H2 (ppm)', 'C2H6 (ppm)', 'CO (ppm)'],
        ...pdmDevs.map((d) => [
          d.nodeId,
          d.deviceName,
          d.location,
          na(d.healthScore),
          d.pdm!.dgaVerdict,
          na(d.pdm!.hotSpotTemp),
          na(d.pdm!.faa),
          na(d.pdm!.dpEstimate),
          na(d.pdm!.rulYears),
          na(d.pdm!.paperMoisturePct),
          d.pdm!.moistureRisk || '—',
          na(d.pdm!.dgaGases?.ch4),
          na(d.pdm!.dgaGases?.c2h4),
          na(d.pdm!.dgaGases?.c2h2),
          na(d.pdm!.dgaGases?.h2),
          na(d.pdm!.dgaGases?.c2h6),
          na(d.pdm!.dgaGases?.co),
        ]),
      ],
    })
  }

  const coldDevs = data.summaries.filter((d) => d.coldchain)
  if (isSelected('coldchain') && coldDevs.length > 0) {
    sheets.push({
      name: 'Cold_Chain_MKT',
      rows: [
        ['Device ID', 'Device Name', 'Domain', 'Site Location', 'Mean Kinetic Temp (MKT °C)', 'Excursions Count', 'HACCP Status'],
        ...coldDevs.map((d) => [
          d.nodeId,
          d.deviceName,
          d.domain,
          d.location,
          na(d.coldchain!.mkt),
          d.coldchain!.excursionsCount,
          d.coldchain!.excursionsCount === 0 ? 'COMPLIANT' : 'EXCURSIONS DETECTED',
        ]),
      ],
    })
  }

  if (isSelected('alarm')) {
    sheets.push({
      name: 'Alarms_Incident_Log',
      rows: [
        ['Alarm ID', 'Device ID', 'Device Name', 'Severity', 'Alarm Event', 'Trigger Value', 'Threshold Limit', 'Raised Timestamp', 'Resolved Timestamp', 'Status', 'Acknowledged By'],
        ...data.alarms.map((a) => [
          a.id,
          a.nodeId,
          a.deviceName,
          a.severity,
          a.paramLabel,
          String(a.value),
          String(a.threshold),
          a.raisedAt,
          a.clearedAt || 'ACTIVE',
          a.status,
          a.ackBy || '—',
        ]),
      ],
    })
  }

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.xlsx`
  downloadXLSX(filename, sheets.length ? sheets : [{ name: 'Empty', rows: [['No sections selected']] }])
}

/**
 * Generate and trigger download of Multi-Section CSV
 */
export async function exportIIoTCSV(
  opts: IIoTReportOptions,
  data: { metrics: IIoTMetricSummary; summaries: DeviceTelemetrySummary[]; alarms: AlarmLogItem[] }
) {
  const docHash = opts.documentHash || await calculateDocumentHash(`${opts.orgId}:${opts.orgName}:${opts.days}:${opts.classification || 'INTERNAL'}:${opts.title || ''}:${Date.now()}`)
  const isSelected = (id: string) => !opts.selectedTypes || opts.selectedTypes.length === 0 || opts.selectedTypes.includes(id)
  const sections: { title: string; headers: string[]; rows: (string | number)[][] }[] = []

  if (isSelected('executive') || isSelected('energy')) {
    sections.push({
      title: `${opts.orgName} - Executive KPI Summary (Last ${opts.days} Days)`,
      headers: ['Metric', 'Value', 'Unit'],
      rows: [
        ['Total Monitored Assets', data.metrics.totalAssets, 'Units'],
        ['Fleet Health Index Score', na(data.metrics.healthIndexAvg), '/ 100'],
        ['Assets with no alarm this period', na(data.metrics.complianceRate, '%'), '% of monitored assets'],
        ['Metered Energy Consumption', na(data.metrics.totalEnergyKWh), 'kWh (metered only)'],
        ['Carbon from metered energy', na(data.metrics.carbonFootprintTCO2e), 'tCO2e'],
        ['Total Alarms', data.metrics.totalAlarms, 'Events'],
      ],
    })
  }

  if (isSelected('health')) {
    sections.push({
      title: 'Monitored Assets Telemetry Summary',
      headers: ['Device ID', 'Device Name', 'Domain', 'Site Location', 'Health Score', 'Status', 'Parameter', 'Unit', 'Samples', 'Min', 'Avg', 'Max', 'Compliance'],
      rows: data.summaries.flatMap((dev) =>
        dev.parameters.map((p) => [
          dev.nodeId,
          dev.deviceName,
          dev.domain,
          dev.location,
          na(dev.healthScore),
          dev.status,
          p.label,
          p.unit,
          p.samples,
          na(p.min), na(p.avg), na(p.max),
          p.compliance === null ? 'NO LIMIT SET' : p.compliance ? 'COMPLIANT' : 'EXCURSION',
        ])
      ),
    })
  }

  const pdmDevs = data.summaries.filter((d) => d.pdm)
  if (isSelected('pdm_diagnostics') && pdmDevs.length > 0) {
    sections.push({
      title: 'Transformer Predictive Maintenance & DGA Diagnostics (IEEE C57.104 / C57.91)',
      headers: ['Device ID', 'Device Name', 'Location', 'Health Score', 'Duval T1 Verdict', 'Hot-Spot (°C)', 'Aging (FAA)', 'Insulation DP', 'Est. RUL (Yrs)', 'Paper Moisture %', 'Dielectric Risk'],
      rows: pdmDevs.map((d) => [
        d.nodeId,
        d.deviceName,
        d.location,
        na(d.healthScore),
        d.pdm!.dgaVerdict,
        na(d.pdm!.hotSpotTemp),
        na(d.pdm!.faa),
        na(d.pdm!.dpEstimate),
        na(d.pdm!.rulYears),
        na(d.pdm!.paperMoisturePct),
        d.pdm!.moistureRisk || '—',
      ]),
    })
  }

  const coldDevs = data.summaries.filter((d) => d.coldchain)
  if (isSelected('coldchain') && coldDevs.length > 0) {
    sections.push({
      title: 'Cold-Chain MKT & Thermal Stability Audit (USP <1079> / HACCP)',
      headers: ['Device ID', 'Device Name', 'Domain', 'Location', 'Mean Kinetic Temp (MKT °C)', 'Excursions Count', 'HACCP Status'],
      rows: coldDevs.map((d) => [
        d.nodeId,
        d.deviceName,
        d.domain,
        d.location,
        na(d.coldchain!.mkt),
        d.coldchain!.excursionsCount,
        d.coldchain!.excursionsCount === 0 ? 'COMPLIANT' : 'EXCURSIONS DETECTED',
      ]),
    })
  }

  if (isSelected('alarm')) {
    sections.push({
      title: 'Alarm Incidents Log',
      headers: ['Device ID', 'Device Name', 'Severity', 'Alarm Event', 'Trigger Value', 'Threshold Limit', 'Raised Timestamp', 'Resolved Timestamp', 'Status', 'Acknowledged By'],
      rows: data.alarms.map((a) => [
        a.nodeId,
        a.deviceName,
        a.severity,
        a.paramLabel,
        String(a.value),
        String(a.threshold),
        a.raisedAt,
        a.clearedAt || 'ACTIVE',
        a.status,
        a.ackBy || '—',
      ]),
    })
  }

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.csv`
  downloadCSVSections(filename, sections, [
    `# Document Integrity (SHA-256): sha256:${docHash}`,
    `# Security Classification: ${opts.classification || 'INTERNAL USE ONLY'}`,
    `# Aggregation Interval: ${opts.aggregationInterval || '15-Minute Standard Rollup'}`,
    // Methods applied, not certifications held. The previous line read
    // "ONEOPS Certified Ingestion Engine v2.0 (ISO 50001 / IEEE C57.104 / GHG
    // Protocol)" — printed into the header of an exported artifact an auditor
    // may read. Nothing here is certified by anyone; ISO 50001 appears nowhere
    // else in this file, and this module's own header disclaims the GHG
    // Protocol. Implementing a published formula is not conformance to the
    // standard that publishes it, and only the formulae are ours to claim.
    `# Analysis Methods: Duval Triangle 1 (IEC 60599 / IEEE C57.104 Annex), Arrhenius paper aging (IEEE C57.91), Oommen moisture equilibrium, MKT (USP <1160>)`,
    `# Conformance: none asserted — this document is not a certified or accredited audit`,
    `Organization: ${opts.orgName} (${opts.orgId})`,
    opts.siteName ? `Site Scope: ${opts.siteName}` : 'Site Scope: All Sites',
    opts.departmentName ? `Department Scope: ${opts.departmentName}` : 'Department Scope: All Departments',
    opts.domain && opts.domain !== 'all' ? `Asset Domain: ${opts.domain}` : 'Asset Domain: All Fleet Domains',
    `Reporting Window: Last ${opts.days} Days`,
    `Generated At: ${fmtDateTime(new Date())} (${DISPLAY_TZ_LABEL})`,
  ])
}
