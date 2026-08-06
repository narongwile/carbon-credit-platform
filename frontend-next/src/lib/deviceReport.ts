// ---------------------------------------------------------------------------
// Per-device report: turn GET /api/nodes/:id/report into printable sections.
// ---------------------------------------------------------------------------
// One builder shared by every export format, so the PDF, the workbook, the CSV
// and the JSON all contain exactly the same numbers — a report that disagrees
// with itself depending on which button was pressed is worse than no report.
// ---------------------------------------------------------------------------

import type { NodeReport } from './api'
import { DOC_KINDS } from './api'
import { ALARM_SCHEMA } from './alarmParams'
import type { SensorDomain } from '@/types/fleet'

const docKindLabel = (k: string) => DOC_KINDS.find((x) => x.key === k)?.label ?? k

export type Cell = string | number | null
export interface ReportSection {
  title: string
  headers: string[]
  rows: Cell[][]
}
export interface DeviceReport {
  title: string
  filenameBase: string
  meta: string[]
  sections: ReportSection[]
}

/**
 * Stored timestamps are UTC; reports read in the viewer's own timezone.
 *
 * Two shapes arrive from the API: DATETIME columns come back through mysql2 as
 * Date objects and serialise to ISO with a Z, while the hourly buckets built by
 * DATE_FORMAT (and the echoed from/to) are bare 'YYYY-MM-DD HH:MM:SS' strings.
 * `new Date()` reads that bare form as LOCAL time, which would shift every raw
 * bucket by the UTC offset — the same class of bug that made the event log read
 * 10:15 for an event at 17:15. Pin the zone before parsing.
 */
const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  let s = String(v)
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

const round = (v: number, dp = 2) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : null)

export function buildDeviceReport(
  rep: NodeReport,
  opts: { deviceName?: string; domain?: SensorDomain },
): DeviceReport {
  const domain = (opts.domain ?? (rep.node?.domain as SensorDomain | undefined))
  const schema = domain ? ALARM_SCHEMA[domain] : undefined
  const paramMeta = new Map((schema?.params ?? []).map((p) => [p.key, p]))
  const name = opts.deviceName ?? rep.node?.name ?? rep.nodeId

  // ── Summary: one row per parameter, aggregated over the whole window ──
  interface Agg { n: number; bad: number; min: number; max: number; sum: number; first: string; last: string }
  const agg = new Map<string, Agg>()
  for (const s of rep.series) {
    const a = agg.get(s.param_key) ?? { n: 0, bad: 0, min: Infinity, max: -Infinity, sum: 0, first: s.bucket, last: s.bucket }
    a.n += s.n
    a.bad += s.bad_n
    a.min = Math.min(a.min, s.v_min)
    a.max = Math.max(a.max, s.v_max)
    // Weight each hour by its sample count so a quiet hour can't drag the mean.
    a.sum += s.v_avg * s.n
    a.last = s.bucket
    agg.set(s.param_key, a)
  }
  const alarmCount = new Map<string, { warn: number; crit: number }>()
  for (const e of rep.events) {
    const c = alarmCount.get(e.param_key) ?? { warn: 0, crit: 0 }
    if (e.severity === 'CRITICAL') c.crit++
    else c.warn++
    alarmCount.set(e.param_key, c)
  }

  const summaryRows: Cell[][] = Array.from(agg.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, a]) => {
      const p = paramMeta.get(key)
      const c = alarmCount.get(key) ?? { warn: 0, crit: 0 }
      return [
        p?.label ?? key,
        p?.unit ?? '',
        a.n,
        round(a.min),
        round(a.n ? a.sum / a.n : NaN),
        round(a.max),
        p ? `${p.direction === 'high' ? '≥' : '≤'} ${p.warn} / ${p.critical}` : '—',
        c.warn,
        c.crit,
        fmt(a.first),
        fmt(a.last),
      ]
    })

  const sections: ReportSection[] = [
    {
      title: 'Parameter Summary',
      headers: ['Parameter', 'Unit', 'Samples', 'Min', 'Average', 'Max', 'Warn / Critical limit', 'Warnings', 'Criticals', 'First reading', 'Last reading'],
      rows: summaryRows,
    },
    {
      title: 'Hourly Readings',
      headers: ['Hour', 'Parameter', 'Unit', 'Samples', 'Min', 'Average', 'Max', 'Bad samples'],
      rows: rep.series.map((s) => {
        const p = paramMeta.get(s.param_key)
        return [fmt(s.bucket), p?.label ?? s.param_key, p?.unit ?? '', s.n, round(s.v_min), round(s.v_avg), round(s.v_max), s.bad_n]
      }),
    },
    {
      title: 'Alarm Events',
      headers: ['Raised', 'Parameter', 'Severity', 'Kind', 'Value', 'Threshold', 'Acknowledged', 'By', 'Problem'],
      rows: rep.events.map((e) => [
        fmt(e.raised_at),
        e.kind === 'offline' ? 'Device offline' : (e.param_label || e.param_key),
        e.severity,
        e.kind,
        e.kind === 'offline' ? '—' : `${e.value}${e.unit ?? ''}`,
        e.kind === 'offline' ? '—' : `${e.threshold}${e.unit ?? ''}`,
        e.acknowledged_at ? fmt(e.acknowledged_at) : 'No',
        e.acknowledged_by ?? '—',
        e.event_problem_id ?? '—',
      ]),
    },
    {
      title: 'Connectivity',
      headers: ['Time', 'Event', 'Detail', 'RSSI'],
      // Sort on the raw timestamp, not the formatted one — "26/07/2026, 21:00"
      // strings do not order chronologically.
      rows: [
        ...rep.transport.map((t) => ({
          at: t.ts,
          row: [
            fmt(t.ts),
            t.to_transport === 'none' ? 'LINK_LOST' : t.from_transport === 'none' ? 'LINK_RESTORE' : `FALLBACK_${String(t.to_transport).toUpperCase()}`,
            `Link ${t.from_transport} → ${t.to_transport}${t.reason ? ` (${t.reason})` : ''}`,
            t.rssi ?? '—',
          ] as Cell[],
        })),
        ...(rep.offlineSync ?? []).map((s) => ({
          at: s.sync_at,
          row: [
            fmt(s.sync_at),
            'OFFLINE_SYNC',
            `Flushed ${s.records_count} offline record${s.records_count === 1 ? '' : 's'}${s.oldest_ts ? ` (${fmt(s.oldest_ts)} → ${fmt(s.newest_ts)})` : ''}`,
            '—',
          ] as Cell[],
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).map((x) => x.row),
    },
  ]

  // Only added when there is something to show — an empty section here would
  // read as "nothing was ever filed", rather than "nothing in THIS window",
  // which is what an absent section-with-no-rows actually means once autoTable
  // prints its own "No data in this period" placeholder for an empty array.
  // Kept anyway, deliberately: an admin scanning a printed report for "was
  // this serviced this quarter?" should see the section exists even on a
  // quiet period, not wonder whether documents are tracked here at all.
  if (rep.documents !== undefined) {
    sections.push({
      title: 'Maintenance Documents',
      // Document date first — it is what the period is about. The upload time
      // is kept beside it because the two routinely differ by months and the
      // gap itself is worth seeing on an audit trail.
      headers: ['Document date', 'Document', 'Type', 'Size', 'Uploaded by', 'Uploaded'],
      rows: rep.documents.map((d) => [
        d.doc_date ? String(d.doc_date).slice(0, 10) : '—',
        d.name,
        docKindLabel(d.kind),
        d.size ?? '—',
        d.uploaded_by ?? '—',
        fmt(d.created_at),
      ]),
    })
  }

  const stamp = (v: string) => fmt(v)
  const meta = [
    `Device: ${name} (${rep.nodeId})`,
    schema ? `Product: ${schema.label}` : '',
    rep.node?.org_id ? `Organization: ${rep.node.org_id}` : '',
    `Period: ${stamp(rep.from)} — ${stamp(rep.to)}`,
    rep.presence ? `Presence: ${rep.presence.online ? 'online' : 'offline'}, last seen ${fmt(rep.presence.last_seen)}${rep.presence.fw ? `, fw ${rep.presence.fw}` : ''}` : '',
    `Readings: ${rep.series.reduce((n, s) => n + s.n, 0)} samples in ${rep.series.length} hourly buckets`,
  ].filter(Boolean)

  // Filenames carry the period so two exports of the same device don't collide.
  const day = (v: string) => String(v).slice(0, 10).replace(/-/g, '')
  return {
    title: `Device Report — ${name}`,
    filenameBase: `report_${rep.nodeId}_${day(rep.from)}-${day(rep.to)}`,
    meta,
    sections,
  }
}
