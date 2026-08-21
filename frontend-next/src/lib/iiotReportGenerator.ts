'use client'

// ---------------------------------------------------------------------------
// Industrial IoT (IIoT) Multi-Domain Reporting Engine
// ---------------------------------------------------------------------------
// Reports what the fleet actually recorded: per-parameter min/avg/max from the
// readings aggregate, real alarm history, and thresholds from each device's own
// configured limits.
//
// It does NOT implement or certify against IEEE C57.104, IEC 60076, IEEE 519,
// HACCP/GDP/21 CFR Part 11 or the GHG Protocol, and this header used to claim
// all five. Two helpers below borrow published formulae — MKT (USP) and a grid
// emission factor — and are labelled as such where they are used, but a
// formula is not an accredited audit. Overstating that on an artifact someone
// files with a regulator is a liability, not a feature.
// ---------------------------------------------------------------------------

import { api } from '@/lib/api'
import { downloadXLSX, type Sheet } from '@/lib/xlsx'
import { downloadCSVSections } from '@/lib/exportFile'
import { fmtDateTime, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { ALARM_SCHEMA, paramStatus } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'

export interface IIoTReportOptions {
  orgId: string
  orgName: string
  title?: string
  days: number
  domain?: string
  departmentId?: string
  departmentName?: string
  nodeId?: string
  selectedTypes: string[]
  format: 'PDF' | 'XLSX' | 'CSV'
  devices: ManagedDevice[]
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
 * Calculate Mean Kinetic Temperature (MKT) per USP/HACCP guidelines
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
      if (devDomain !== opts.domain) return false
    }
    if (opts.departmentId && opts.departmentId !== 'all') {
      const depts = d.departmentIds || ((d as any).departmentId ? [(d as any).departmentId] : [])
      if (depts.length > 0 && !depts.includes(opts.departmentId)) return false
    }
    if (opts.nodeId && opts.nodeId !== 'all') {
      if (d.id !== opts.nodeId) return false
    }
    return true
  })

  // ---------------------------------------------------------------------
  // Everything below reports MEASURED values only.
  //
  // This function used to substitute invented numbers wherever the backend
  // returned nothing: a fixed four-parameter transformer profile ("samples:
  // 720, min 42.5, avg 65.2, max 84.1, COMPLIANT") for any device with no
  // stored aggregate, a fabricated CRITICAL alarm with a named acknowledging
  // engineer, alarm counts floored at `|| 2`, energy as assets x days x 1250,
  // and a compliance rate clamped up to a minimum of 85%. Those values were
  // printed under IEEE C57.104 / IEC 60076 / HACCP / GHG Scope 2 headings and
  // a "certified" sign-off block.
  //
  // A report that invents measurements is worse than one that fails, because
  // nothing about it looks wrong. Anything not actually measured is null here
  // and renders as an explicit dash downstream.
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

    const parameters = devReadings.map((r) => {
      const min = Number(r.min), avg = Number(r.avg), max = Number(r.max)
      // Compliance is judged against this parameter's OWN configured limit and
      // direction. The previous rule was `max < 95` applied to every parameter
      // whatever its unit — which marked a 230 V phase voltage as an excursion
      // and a 94 % overload as compliant.
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

    return {
      nodeId: dev.id,
      deviceName: dev.name || dev.id,
      domain: domain || '—',
      location: dev.location || '—',
      // No invented 96/68/0: an unknown score stays unknown.
      healthScore: typeof (dev as { healthScore?: number }).healthScore === 'number'
        ? (dev as { healthScore?: number }).healthScore as number
        : null,
      status: dev.status,
      parameters,
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

  // Energy is only reportable if a device actually meters it. Nothing in this
  // platform measures kWh today, so rather than multiplying assets by a made-up
  // 1,250 kWh/day and labelling the result a GHG Scope 2 figure, an absent
  // meter reads as absent.
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

  // Share of assets that recorded no alarm in the window. Reported only when
  // there are assets to judge, and never floored: an all-breaching fleet used
  // to still print 85%.
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

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // ── Header Banner ──
  doc.setFillColor(13, 17, 23)
  doc.rect(0, 0, pageWidth, 28, 'F')

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(99, 102, 241)
  doc.text(`${opts.orgName} — Industrial IoT Operations Report`, 14, 12)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(148, 163, 184)
  doc.text(
    `Scope: ${opts.departmentName ? `${opts.departmentName} · ` : ''}Last ${opts.days} Days (${DISPLAY_TZ_LABEL}) · Generated: ${new Date().toLocaleString()}`,
    14,
    20
  )

  // ── Executive KPI Summary Cards ──
  let y = 35
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(241, 245, 249)
  doc.text('1. Executive Fleet KPIs & Compliance Overview', 14, y)

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

  // ── Telemetry & Parameter Statistics Table ──
  y = (doc as any).lastAutoTable.finalY + 10
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(241, 245, 249)
  doc.text('2. Monitored Asset Health & Telemetry Summary', 14, y)

  const devRows = data.summaries.flatMap((dev) =>
    // A device that stored nothing in the window gets one honest row saying
    // exactly that, instead of silently contributing no rows (which reads as
    // "nothing to report") or inheriting a fabricated parameter profile.
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

  // ── Alarms & Incident SLA Audit ──
  y = (doc as any).lastAutoTable.finalY + 10
  if (y > 240) {
    doc.addPage()
    y = 20
  }

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(241, 245, 249)
  doc.text('3. Alarm Incident Log & SOP Resolution', 14, y)

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

  // ── Footer / Signature Block ──
  y = (doc as any).lastAutoTable.finalY + 12
  if (y > 250) {
    doc.addPage()
    y = 20
  }

  doc.setDrawColor(203, 213, 225)
  doc.line(14, y, pageWidth - 14, y)
  y += 6

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 116, 139)
  doc.text(
    `Generated by the ONEOPS monitoring platform for ${opts.orgName}. Values are as recorded by the devices; `
      + `a dash means the platform holds no measurement for that item. Not an accredited compliance certificate.`,
    14,
    y
  )

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.pdf`
  doc.save(filename)
}

/**
 * Generate and trigger download of Multi-Sheet Excel Workbook
 */
export function exportIIoTXLSX(
  opts: IIoTReportOptions,
  data: { metrics: IIoTMetricSummary; summaries: DeviceTelemetrySummary[]; alarms: AlarmLogItem[] }
) {
  const sheets: Sheet[] = [
    {
      name: 'Executive_Summary',
      rows: [
        ['ORGANIZATION', opts.orgName],
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
    },
    {
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
    },
    {
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
    },
  ]

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.xlsx`
  downloadXLSX(filename, sheets)
}

/**
 * Generate and trigger download of Multi-Section CSV
 */
export function exportIIoTCSV(
  opts: IIoTReportOptions,
  data: { metrics: IIoTMetricSummary; summaries: DeviceTelemetrySummary[]; alarms: AlarmLogItem[] }
) {
  const sections = [
    {
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
    },
    {
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
    },
    {
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
    },
  ]

  const filename = `${opts.orgName.replace(/[^a-zA-Z0-9_-]+/g, '_')}_Operations_Report_${opts.days}d_${Date.now()}.csv`
  downloadCSVSections(filename, sections, [
    `Organization: ${opts.orgName}`,
    `Reporting Window: Last ${opts.days} Days`,
    `Generated At: ${fmtDateTime(new Date())} (${DISPLAY_TZ_LABEL})`,
  ])
}
