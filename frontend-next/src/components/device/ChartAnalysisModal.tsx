'use client'

// ---------------------------------------------------------------------------
// "Chart Visualize Analysis" — the expanded view of one admin-composed
// Custom Chart. Opened from the Expand button on its card, for every role
// (admin and viewer/customer alike — this is a read-only analysis surface,
// nothing here can edit the chart or its thresholds).
//
// The inline card chart (MultiParamChart, 180px, no min-max band, no
// thresholds, quick-range only) is deliberately light so a page with several
// charts stays scannable. This modal is where the same data gets the room to
// be actually useful:
//
//   - a real time range picker (1h…30d + an explicit from/to)
//   - the min/max band under each average line, from the v_min/v_max/n
//     readingsGetFunc already returns per bucket — nothing new to fetch
//   - the device's real alarm thresholds as reference lines, per PARAMETER,
//     from the same NodeAlarmRule every other chart reads (so a combined
//     chart alarms identically to viewing one series alone), toggleable
//   - a brush to narrow to a sub-range without refetching
//   - chart view OR the raw bucketed samples behind it, sharing one pivot
//     with the CSV export so the file always matches the screen
//   - per-series stats weighted by each bucket's own sample count, with
//     direction-aware alarm status and a peak-breach marker
//   - Pearson correlation across every parameter pair, stated with its own
//     limits rather than presented as fact
// ---------------------------------------------------------------------------

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type ChartDefinition } from '@/lib/api'
import type { AvailableParam } from './ChartBuilderModal'
import type { NodeAlarmRule, ParamRule } from '@/server/alarmEngine'
import { paramStatus, type ParamStatus } from '@/lib/alarmParams'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush,
} from 'recharts'
import {
  X, Loader2, Download, LayoutDashboard, Pencil, CalendarRange, ChevronDown,
  RefreshCw, Table as TableIcon, LineChart as LineChartIcon,
  Camera, Target, Sliders, Check, AlertCircle,
} from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

const PALETTE = ['#6366f1', '#f97316', '#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']

const QUICK = [
  { id: '1h', label: '1h', minutes: 60 },
  { id: '6h', label: '6h', minutes: 360 },
  { id: '24h', label: '24h', minutes: 1440 },
  { id: '7d', label: '7d', minutes: 10080 },
  { id: '30d', label: '30d', minutes: 43200 },
] as const

const MAX_POINTS = 360
const toUTC = (ms: number) => new Date(ms).toISOString()

/** Below this many overlapping buckets an r is noise dressed as a finding, so
 * the pair is withheld rather than reported with a confident-looking number. */
const MIN_PAIR_POINTS = 5
/** How many pairs the panel lists. Anything dropped is stated explicitly — a
 * silent top-N reads as "these are all of them" when it is not. */
const MAX_PAIRS_SHOWN = 12

/** Conventional descriptive bands for |r|. Deliberately worded as strength of
 * ASSOCIATION: two parameters can track each other perfectly because both
 * follow load or ambient temperature, with no causal link between them. */
function rLabel(r: number): string {
  const a = Math.abs(r)
  const dir = r > 0 ? 'together' : 'inversely'
  if (a >= 0.8) return `strong, ${dir}`
  if (a >= 0.5) return `moderate, ${dir}`
  if (a >= 0.3) return `weak, ${dir}`
  return 'negligible'
}

const STATUS_STYLE: Record<ParamStatus, { color: string; bg: string }> = {
  NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
}

type AxisMode = 'dual' | 'shared' | 'normalize'
const AXIS_MODES: { id: AxisMode; label: string; title: string }[] = [
  { id: 'dual', label: 'Dual axis', title: 'Two Y axes, grouped by unit — values stay real' },
  { id: 'shared', label: 'Same axis', title: 'One Y axis for every series' },
  { id: 'normalize', label: 'Normalize %', title: 'Each series scaled to 0–100% of its own range — compare trends across units' },
]

interface Row { param_key: string; value: number; taken_at: string; v_min?: number; v_max?: number; n?: number }

export default function ChartAnalysisModal({
  nodeId, orgId, deviceName, chart, paramByKey, onClose, onEdit,
}: {
  nodeId: string
  orgId?: string
  deviceName?: string
  chart: ChartDefinition
  paramByKey: Map<string, AvailableParam>
  onClose: () => void
  /** Present only when the caller has already gated this on canConfigure — a
   * viewer/customer session never receives it, so the button below simply
   * doesn't render rather than needing its own role check here. */
  onEdit?: () => void
}) {
  const live = useIsLive()
  const [quick, setQuick] = useState<string>('24h')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  /** Phones only — the date inputs are always visible from sm up. */
  const [showRange, setShowRange] = useState(false)
  const [axisMode, setAxisMode] = useState<AxisMode>('dual')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  /** Chart vs the raw sample table behind it. An operator writing up an
   * excursion needs the actual numbers at the actual timestamps, not a
   * reading taken off a pixel. */
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  /** Threshold reference lines can be switched off: on a chart mixing several
   * parameters that each carry warn+critical, the lines can outnumber the
   * data and bury the trend they exist to contextualise. */
  const [showThresholds, setShowThresholds] = useState(true)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  /** Bumped to force a refetch of the SAME window — the range-derived effect
   * below can't see that new samples have landed since it last ran. */
  const [reloadTick, setReloadTick] = useState(0)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [win, setWin] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - 1440 * 60_000, to: Date.now() }))
  const [rule, setRule] = useState<NodeAlarmRule | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Inline Threshold Tuning State
  const [tuningParam, setTuningParam] = useState<{
    key: string
    label: string
    unit: string
    direction: 'high' | 'low'
    warn: number
    critical: number
  } | null>(null)
  const [tuningError, setTuningError] = useState<string | null>(null)
  const [tuningSaving, setTuningSaving] = useState(false)

  // Auto-clear toast after 3s
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // Esc closes, and the page behind must not scroll under the overlay — same
  // contract every other modal on this page follows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Thresholds live in the device's ONE NodeAlarmRule regardless of which
  // combined chart a parameter appears on (see ChartDefinition's doc comment
  // in lib/api.ts) — GET /api/nodes/:id/rule uses the 'node' guard policy,
  // which any role with at least view access to this device may call, so a
  // viewer sees the same real limits an admin does.
  useEffect(() => {
    let cancelled = false
    if (live) api.getRule(nodeId).then((r) => { if (!cancelled) setRule(r) })
    return () => { cancelled = true }
  }, [nodeId, live])

  const range = useMemo(() => {
    if (custom) {
      const from = fromDisplayInput(custom.from)
      const to = fromDisplayInput(custom.to)
      if (!Number.isNaN(from) && !Number.isNaN(to) && to > from) return { from, to }
    }
    const minutes = QUICK.find((q) => q.id === quick)?.minutes ?? 1440
    const to = Date.now()
    return { from: to - minutes * 60_000, to }
  }, [custom, quick])

  const load = useCallback(() => {
    if (!live) { setRows(null); return }
    let cancelled = false
    setLoading(true)
    const bucketSec = Math.max(60, (range.to - range.from) / 1000 / MAX_POINTS)
    api.readingsWindow(nodeId, toUTC(range.from), toUTC(range.to), bucketSec, chart.paramKeys.join(','))
      .then((r) => { if (!cancelled) { setRows((r ?? []) as Row[]); setWin(range); setLastLoadedAt(new Date()) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // reloadTick is a deliberate dependency with no other use: it is what lets
    // the Refresh button re-run this for an unchanged range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, nodeId, chart.paramKeys, range, reloadTick])

  useEffect(() => load(), [load])

  const spanMs = win.to - win.from
  const fmtTick = (ts: number) => (spanMs > 36 * 3600_000 ? fmtDayMonth(ts) : fmtHM(ts))

  const nameOf = (key: string) => paramByKey.get(key)?.label ?? key
  const unitOf = (key: string) => paramByKey.get(key)?.unit ?? ''

  const data = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string | [number, number]>>()
    for (const r of rows ?? []) {
      const ts = new Date(r.taken_at).getTime()
      if (Number.isNaN(ts)) continue
      const row = byTime.get(r.taken_at) ?? { time: fmtTick(ts), ts }
      row[r.param_key] = Number(r.value)
      row[`${r.param_key}__band`] = [Number(r.v_min ?? r.value), Number(r.v_max ?? r.value)]
      byTime.set(r.taken_at, row)
    }
    return Array.from(byTime.values()).sort((a, b) => (a.ts as number) - (b.ts as number))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, spanMs])

  /** Which Y axis each series belongs to, grouped by unit — identical rule to
   * the inline card chart, so a series does not appear to "move" between the
   * two views. */
  const axisOf = useMemo(() => {
    const m = new Map<string, 'L' | 'R'>()
    if (axisMode !== 'dual') { chart.paramKeys.forEach((k) => m.set(k, 'L')); return m }
    let leftUnit: string | null = null
    for (const k of chart.paramKeys) {
      const unit = unitOf(k)
      if (leftUnit === null) leftUnit = unit
      m.set(k, unit === leftUnit ? 'L' : 'R')
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisMode, chart.paramKeys, paramByKey])

  const usesRightAxis = axisMode === 'dual' && Array.from(axisOf.values()).includes('R')

  /** Per-series min/max across the window, from the value series (not the
   * band) — what normalize mode maps onto 0–100%, and the source of the
   * stats table below. */
  const ranges = useMemo(() => {
    const m = new Map<string, { min: number; max: number }>()
    for (const k of chart.paramKeys) {
      let min = Infinity, max = -Infinity
      for (const d of data) {
        const v = d[k]
        if (typeof v !== 'number' || Number.isNaN(v)) continue
        if (v < min) min = v
        if (v > max) max = v
      }
      if (Number.isFinite(min) && Number.isFinite(max)) m.set(k, { min, max })
    }
    return m
  }, [data, chart.paramKeys])

  const plotted = useMemo(() => {
    if (axisMode !== 'normalize') return data
    return data.map((d) => {
      const out: Record<string, number | string | [number, number]> = { time: d.time, ts: d.ts }
      for (const k of chart.paramKeys) {
        const v = d[k]
        const r = ranges.get(k)
        if (typeof v === 'number' && !Number.isNaN(v) && r) {
          out[k] = r.max === r.min ? 50 : ((v - r.min) / (r.max - r.min)) * 100
          out[`${k}__raw`] = v
        }
        const band = d[`${k}__band`]
        if (Array.isArray(band) && r && r.max !== r.min) {
          out[`${k}__band`] = [((band[0] - r.min) / (r.max - r.min)) * 100, ((band[1] - r.min) / (r.max - r.min)) * 100]
        } else if (Array.isArray(band)) {
          out[`${k}__band`] = [50, 50]
        }
      }
      return out
    })
  }, [axisMode, data, chart.paramKeys, ranges])

  /** Per-series statistics AND threshold diagnostics.
   *
   * Averages are weighted by each bucket's own sample count (n) — a straight
   * average of per-bucket averages would silently under-count a bucket that
   * rolled up thousands of raw readings next to one that rolled up a handful.
   * Min/max are the true extremes seen in the window, not extremes of the
   * bucket averages.
   *
   * The threshold half evaluates through paramStatus, which honours the rule's
   * OWN direction: a 'low' parameter (oil level, battery) alarms when it drops,
   * and hardcoding a >= comparison would report it as healthy at its worst
   * moment. Two different questions get two different answers:
   *   pctAlarm   how much of the window sat in breach, by bucket MEAN
   *   peakStatus whether the worst single moment breached at all — the mean of
   *              a bucket can sit safely inside limits while one sample inside
   *              that same bucket spiked past critical, and that spike is
   *              precisely the event worth surfacing.
   */
  const stats = useMemo(() => {
    const m = new Map<string, {
      min: number; max: number; avg: number; n: number
      latest: number | null; latestStatus: ParamStatus | null; peakStatus: ParamStatus | null
      pctAlarm: number; rule: ParamRule | null; delta: number
    }>()
    for (const k of chart.paramKeys) {
      const p = rule?.params.find((x) => x.key === k) ?? null
      let min = Infinity, max = -Infinity, sum = 0, n = 0, breachN = 0
      let latestTs = -Infinity, latest: number | null = null
      for (const r of rows ?? []) {
        if (r.param_key !== k) continue
        const w = r.n ?? 1
        const v = Number(r.value)
        min = Math.min(min, Number(r.v_min ?? v))
        max = Math.max(max, Number(r.v_max ?? v))
        sum += v * w
        n += w
        const ts = new Date(r.taken_at).getTime()
        if (ts > latestTs) { latestTs = ts; latest = v }
        if (p && paramStatus(v, p) !== 'NORMAL') breachN += w
      }
      if (n <= 0) continue
      // For a 'high' rule the worst moment in the window is the maximum; for a
      // 'low' rule it is the minimum.
      const peak = p ? (p.direction === 'high' ? max : min) : null
      m.set(k, {
        min, max, avg: sum / n, n, latest,
        latestStatus: p && latest !== null ? paramStatus(latest, p) : null,
        peakStatus: p && peak !== null ? paramStatus(peak, p) : null,
        pctAlarm: (breachN / n) * 100,
        rule: p,
        // Peak-to-trough swing across the window. Two parameters can share a
        // mean and behave completely differently — one steady, one oscillating
        // hard — and this is the column that separates them.
        delta: max - min,
      })
    }
    return m
  }, [rows, chart.paramKeys, rule])

  /** Pearson r for every pair of parameters, on the time-aligned bucket means
   * this chart already plots — the actual "do these move together?" answer the
   * eye is trying to estimate from overlaid lines.
   *
   * Stated limits rather than buried ones: this correlates BUCKETED means, not
   * raw samples, so a coarser bucket smooths away short divergence and
   * generally inflates |r|. r is invariant to positive linear rescaling, so it
   * is identical in all three axis modes — normalize % changes the picture, not
   * the number. A pair is reported only when enough buckets carry BOTH values
   * and both series actually vary: a flat series has no correlation to measure,
   * which is not the same as a correlation of zero.
   */
  const correlations = useMemo(() => {
    const keys = chart.paramKeys
    const out: { a: string; b: string; r: number; n: number }[] = []
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const xs: number[] = [], ys: number[] = []
        for (const d of data) {
          const x = d[keys[i]], y = d[keys[j]]
          if (typeof x === 'number' && !Number.isNaN(x) && typeof y === 'number' && !Number.isNaN(y)) { xs.push(x); ys.push(y) }
        }
        const n = xs.length
        if (n < MIN_PAIR_POINTS) continue
        let mx = 0, my = 0
        for (let t = 0; t < n; t++) { mx += xs[t]; my += ys[t] }
        mx /= n; my /= n
        let sxy = 0, sxx = 0, syy = 0
        for (let t = 0; t < n; t++) {
          const dx = xs[t] - mx, dy = ys[t] - my
          sxy += dx * dy; sxx += dx * dx; syy += dy * dy
        }
        if (sxx === 0 || syy === 0) continue   // flat series — undefined, not zero
        out.push({ a: keys[i], b: keys[j], r: sxy / Math.sqrt(sxx * syy), n })
      }
    }
    return out.sort((p, q) => Math.abs(q.r) - Math.abs(p.r))
  }, [data, chart.paramKeys])

  const totalPairs = (chart.paramKeys.length * (chart.paramKeys.length - 1)) / 2

  const toggleHidden = (key: string) => setHidden((h) => {
    const next = new Set(h)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const visibleKeys = chart.paramKeys.filter((k) => !hidden.has(k))
  // Draw the hovered series last (on top), everything else in its declared
  // order — the only series affected is the one the legend is isolating.
  const drawOrder = focusKey && visibleKeys.includes(focusKey)
    ? [...visibleKeys.filter((k) => k !== focusKey), focusKey]
    : visibleKeys

  /** The long readings list pivoted to one row per timestamp — built ONCE and
   * shared by the table view and the CSV export, so the file always matches
   * what is on screen. (It also replaces a filter-inside-map that rescanned
   * every reading for every timestamp: quadratic in the row count, which a
   * 30-day window at 360 buckets across several parameters makes felt.) */
  const tableRows = useMemo(() => {
    const byTime = new Map<string, { takenAt: string; values: Record<string, number>; mins: Record<string, number>; maxes: Record<string, number> }>()
    for (const r of rows ?? []) {
      let slot = byTime.get(r.taken_at)
      if (!slot) { slot = { takenAt: r.taken_at, values: {}, mins: {}, maxes: {} }; byTime.set(r.taken_at, slot) }
      slot.values[r.param_key] = Number(r.value)
      if (r.v_min !== undefined) slot.mins[r.param_key] = Number(r.v_min)
      if (r.v_max !== undefined) slot.maxes[r.param_key] = Number(r.v_max)
    }
    return Array.from(byTime.values())
      .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime())
  }, [rows])

  const exportCsv = () => {
    downloadCSV(
      `${nodeId}_${chart.title.replace(/[^a-z0-9]+/gi, '_')}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Time', ...chart.paramKeys.flatMap((k) => [`${nameOf(k)}${unitOf(k) ? ` (${unitOf(k)})` : ''}`, `${nameOf(k)} min`, `${nameOf(k)} max`])],
      tableRows.map((r) => [
        fmtDateTime(r.takenAt),
        ...chart.paramKeys.flatMap((k) => [r.values[k] ?? '', r.mins[k] ?? '', r.maxes[k] ?? '']),
      ]),
    )
  }

  const saveTunedThreshold = async () => {
    if (!tuningParam || !rule) return
    const { key, direction, warn, critical } = tuningParam
    if (direction === 'high' && critical <= warn) {
      setTuningError('Critical limit must be greater than Warning limit for High alarm')
      return
    }
    if (direction === 'low' && critical >= warn) {
      setTuningError('Critical limit must be less than Warning limit for Low alarm')
      return
    }
    setTuningSaving(true)
    setTuningError(null)
    try {
      const updatedParams = rule.params.map((p) =>
        p.key === key ? { ...p, warn, critical, direction } : p
      )
      if (!updatedParams.some((p) => p.key === key)) {
        updatedParams.push({
          key,
          label: nameOf(key),
          unit: unitOf(key),
          direction,
          warn,
          critical,
        })
      }
      const updatedRule: NodeAlarmRule = {
        ...rule,
        params: updatedParams,
      }
      const res = await api.putRule(nodeId, { orgId: orgId ?? 'org-1', rule: updatedRule })
      if (res && (res as unknown as { ok?: boolean }).ok !== false) {
        setRule(updatedRule)
        setTuningParam(null)
        setToast(`Thresholds updated for ${nameOf(key)}`)
      } else {
        setTuningError('Failed to save threshold changes to server')
      }
    } catch (e) {
      setTuningError(String(e || 'Save failed'))
    } finally {
      setTuningSaving(false)
    }
  }

  const copyChartImage = async () => {
    try {
      const svg = document.querySelector('div[role="dialog"] .recharts-surface') as SVGGraphicsElement | null
      if (!svg) {
        setToast('No chart to export')
        return
      }
      const svgData = new XMLSerializer().serializeToString(svg)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const URL = window.URL || window.webkitURL || window
      const blobURL = URL.createObjectURL(svgBlob)

      const img = new Image()
      img.onload = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = (svg.clientWidth || 800) * 2
        canvas.height = (svg.clientHeight || 400) * 2
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#0d1117'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          canvas.toBlob(async (pngBlob) => {
            if (!pngBlob) return
            try {
              if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
                setToast('Chart image copied to clipboard!')
              } else {
                const a = document.createElement('a')
                a.href = URL.createObjectURL(pngBlob)
                a.download = `${chart.title || 'chart'}-${quick}.png`
                a.click()
                setToast('Chart PNG downloaded!')
              }
            } catch {
              const a = document.createElement('a')
              a.href = URL.createObjectURL(pngBlob)
              a.download = `${chart.title || 'chart'}-${quick}.png`
              a.click()
              setToast('Chart PNG downloaded!')
            }
          }, 'image/png')
        }
      }
      img.src = blobURL
    } catch {
      setToast('Could not copy chart image')
    }
  }

  const jumpToPeak = () => {
    if (!data.length) return
    let peakTs = 0
    let maxRatio = -Infinity

    for (const d of data) {
      for (const k of visibleKeys) {
        const v = d[k]
        if (typeof v !== 'number' || Number.isNaN(v)) continue
        const p = rule?.params.find((x) => x.key === k)
        if (p) {
          const ratio = p.direction === 'high' ? v / (p.warn || 1) : (p.warn || 1) / Math.max(0.001, v)
          if (ratio > maxRatio) {
            maxRatio = ratio
            peakTs = Number(d.ts)
          }
        } else {
          const r = ranges.get(k)
          if (r && r.max > r.min) {
            const ratio = (v - r.min) / (r.max - r.min)
            if (ratio > maxRatio) {
              maxRatio = ratio
              peakTs = Number(d.ts)
            }
          }
        }
      }
    }

    if (peakTs > 0) {
      const padMs = Math.max(30 * 60_000, spanMs * 0.15)
      const newFrom = Math.max(win.from, peakTs - padMs)
      const newTo = Math.min(win.to, peakTs + padMs)
      setCustom({ from: toDisplayInput(newFrom), to: toDisplayInput(newTo) })
      setToast('Zoomed to peak excursion!')
    } else {
      setToast('No peak excursion found')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-2xl my-auto"
        style={surface}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${chart.title} — chart visualize analysis`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate flex items-center gap-2">
              <LayoutDashboard size={15} className="text-indigo-400 shrink-0" /> {chart.title}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {deviceName ?? nodeId} · {nodeId} · {chart.paramKeys.length} parameter{chart.paramKeys.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onEdit && (
              <button onClick={onEdit} title="Edit this chart's parameters"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white" style={inset}>
                <Pencil size={12} /> Edit chart
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Range + axis mode controls */}
        <div className="px-5 flex flex-wrap items-center gap-2 pb-3">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={inset}>
            {QUICK.map((q) => (
              <button
                key={q.id}
                onClick={() => { setCustom(null); setQuick(q.id) }}
                className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${!custom && quick === q.id ? 'text-white' : 'text-slate-500'}`}
                style={!custom && quick === q.id ? { background: '#6366f1' } : {}}
              >
                {q.label}
              </button>
            ))}
          </div>
          {/* A datetime-local input is ~200px wide, so the pair plus the zone
              note takes three full rows on a 360px phone and pushes the chart
              itself off the first screen. On phones they collapse behind this
              toggle — the quick ranges above cover the common case — while
              sm+ keeps them inline where there is room. */}
          <button
            onClick={() => setShowRange((v) => !v)}
            aria-expanded={showRange}
            className={`sm:hidden flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md ${custom ? 'text-indigo-300' : 'text-slate-400'}`}
            style={inset}
          >
            <CalendarRange size={12} /> {custom ? 'Custom range' : 'Pick dates'}
            <ChevronDown size={12} className={showRange ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          <div className={`${showRange ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-2 w-full sm:w-auto`}>
            <input
              type="datetime-local"
              value={custom?.from ?? toDisplayInput(range.from)}
              onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? toDisplayInput(range.to) }))}
              className="text-[11px] rounded-md px-2 py-1.5 text-slate-200 min-w-0 flex-1 sm:flex-none" style={inset}
            />
            <span className="text-slate-600 text-[11px]">→</span>
            <input
              type="datetime-local"
              value={custom?.to ?? toDisplayInput(range.to)}
              onChange={(e) => setCustom((c) => ({ from: c?.from ?? toDisplayInput(range.from), to: e.target.value }))}
              className="text-[11px] rounded-md px-2 py-1.5 text-slate-200 min-w-0 flex-1 sm:flex-none" style={inset}
            />
            {custom && (
              <button onClick={() => setCustom(null)} className="text-[11px] text-slate-500 hover:text-white underline">reset</button>
            )}
            <span className="text-[10px] text-slate-600" title={`All times shown in ${DISPLAY_TZ_LABEL}`}>
              times in {DISPLAY_TZ_LABEL}
            </span>
          </div>

          {chart.paramKeys.length > 1 && (
            <div className="flex items-center gap-1 ml-1 pl-2" style={{ borderLeft: '1px solid #1e2433' }}>
              {AXIS_MODES.map((m) => (
                <button key={m.id} onClick={() => setAxisMode(m.id)} title={m.title}
                  className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${axisMode === m.id ? 'text-white' : 'text-slate-500'}`}
                  style={axisMode === m.id ? { background: '#4b5563' } : inset}>
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Thresholds on/off — only meaningful when this device actually has
              saved limits for at least one of the plotted parameters, and
              never in normalize mode where the lines are hidden anyway
              (they are real-unit values against a 0–100% axis). */}
          {axisMode !== 'normalize' && chart.paramKeys.some((k) => stats.get(k)?.rule) && (
            <button
              onClick={() => setShowThresholds((v) => !v)}
              aria-pressed={showThresholds}
              title="Show or hide the warning/critical reference lines"
              className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${showThresholds ? 'text-amber-300' : 'text-slate-500'}`}
              style={showThresholds ? { background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)' } : inset}
            >
              Thresholds
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {loading && <Loader2 size={13} className="animate-spin text-indigo-400" />}

            {/* Jump to peak excursion */}
            <button
              onClick={jumpToPeak}
              disabled={!data.length}
              title="Jump to Peak / Excursion — focus zoom around the maximum deviation in this window"
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md text-amber-300 hover:text-amber-200 disabled:opacity-40"
              style={inset}
            >
              <Target size={12} className="text-amber-400" /> <span className="hidden md:inline">Jump Peak</span>
            </button>

            {/* 1-click Copy chart image / download */}
            <button
              onClick={copyChartImage}
              disabled={!data.length}
              title="Copy Chart Image (PNG) to clipboard or download snapshot"
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md text-slate-300 hover:text-white disabled:opacity-40"
              style={inset}
            >
              <Camera size={12} className="text-indigo-400" /> <span className="hidden md:inline">Snapshot</span>
            </button>

            {/* Chart / raw-samples toggle */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-md" style={inset}>
              <button onClick={() => setViewMode('chart')} title="Chart view" aria-pressed={viewMode === 'chart'}
                className={`p-1 rounded ${viewMode === 'chart' ? 'text-white bg-slate-700' : 'text-slate-500'}`}>
                <LineChartIcon size={13} />
              </button>
              <button onClick={() => setViewMode('table')} title="Raw telemetry samples" aria-pressed={viewMode === 'table'}
                className={`p-1 rounded ${viewMode === 'table' ? 'text-white bg-slate-700' : 'text-slate-500'}`}>
                <TableIcon size={13} />
              </button>
            </div>

            <button onClick={() => setReloadTick((t) => t + 1)} disabled={loading}
              title="Refresh — re-read this same window" aria-label="Refresh"
              className="p-1.5 rounded-md text-slate-400 disabled:opacity-40" style={inset}>
              <RefreshCw size={12} className={loading ? 'animate-spin text-indigo-400' : ''} />
            </button>

            <button onClick={exportCsv} disabled={!rows?.length}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md text-slate-300 disabled:opacity-40" style={inset}>
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

        {/* Floating Toast Notification */}
        {toast && (
          <div className="mx-5 mb-2 py-1.5 px-3 rounded-lg text-xs bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 flex items-center justify-between animate-fade-in">
            <span className="flex items-center gap-1.5 font-medium">
              <Check size={13} className="text-emerald-400" /> {toast}
            </span>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Legend — hover isolates a series, click hides/shows it. Series stay
            hidden by simply not rendering their Area/Line/ReferenceLine; this
            legend is the single source of truth for what's drawn, so there is
            no separate Recharts auto-legend to fall out of sync with it. */}
        <div className="px-5 flex flex-wrap gap-1.5 pb-2">
          {chart.paramKeys.map((k, i) => {
            const isHidden = hidden.has(k)
            return (
              <button
                key={k}
                onClick={() => toggleHidden(k)}
                onMouseEnter={() => setFocusKey(k)}
                onMouseLeave={() => setFocusKey((f) => (f === k ? null : f))}
                className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
                style={inset}
                title={isHidden ? `Show ${nameOf(k)}` : `Hide ${nameOf(k)} · hover to isolate`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isHidden ? '#374151' : PALETTE[i % PALETTE.length] }} />
                <span className={isHidden ? 'text-slate-600 line-through' : 'text-slate-300'}>{nameOf(k)}</span>
              </button>
            )
          })}
        </div>

        {/* Chart */}
        <div className="px-5">
          {!live ? (
            <div className="h-[260px] sm:h-[380px] flex items-center justify-center text-center px-4 text-sm text-slate-600">
              Switch to Live mode to see stored history.
            </div>
          ) : viewMode === 'table' ? (
            /* The numbers behind the line. Same rows, same bucketing, same
               order as the CSV export — so what an operator reads here is
               exactly what they will hand over in the file. */
            <div className="rounded-xl overflow-hidden" style={inset}>
              <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: '1px solid #1e2433' }}>
                <span className="text-[11px] font-semibold text-slate-200">
                  Recorded telemetry samples ({tableRows.length.toLocaleString()} row{tableRows.length === 1 ? '' : 's'})
                </span>
                <button onClick={exportCsv} disabled={!rows?.length}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40">
                  <Download size={11} /> Download CSV
                </button>
              </div>
              <div className="overflow-auto max-h-[380px]">
                <table className="w-full text-[11px]" style={{ minWidth: 120 + chart.paramKeys.length * 110 }}>
                  <thead className="sticky top-0 z-10" style={{ background: '#0d1117' }}>
                    <tr className="text-slate-500" style={{ borderBottom: '1px solid #1e2433' }}>
                      <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Timestamp</th>
                      {chart.paramKeys.map((k, i) => (
                        <th key={k} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                            {nameOf(k)}{unitOf(k) ? ` (${unitOf(k)})` : ''}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.length === 0 ? (
                      <tr><td colSpan={1 + chart.paramKeys.length} className="px-3 py-6 text-center text-slate-600">
                        {loading ? 'Loading…' : 'No readings stored in this period.'}
                      </td></tr>
                    ) : tableRows.map((r, i) => (
                      <tr key={r.takenAt} style={{ borderTop: i ? '1px solid #1e2433' : undefined }}>
                        <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{fmtDateTime(r.takenAt)}</td>
                        {chart.paramKeys.map((k) => (
                          <td key={k} className="px-3 py-1.5 text-right text-slate-200 whitespace-nowrap tabular-nums">
                            {typeof r.values[k] === 'number' ? (r.values[k] as number).toFixed(2) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : !visibleKeys.length ? (
            <div className="h-[260px] sm:h-[380px] flex items-center justify-center text-center px-4 text-sm text-slate-600">
              Every series is hidden — click a legend chip to show it again.
            </div>
          ) : data.length < 2 ? (
            <div className="h-[260px] sm:h-[380px] flex items-center justify-center text-center px-4 text-sm text-slate-600">
              {loading ? 'Loading…' : 'No readings stored in this period.'}
            </div>
          ) : (
            // min-w-0 matters inside the flex/grid ancestors this modal sits
            // in: without it a flex child's default min-width:auto floors at
            // its content width, and ResponsiveContainer measures that instead
            // of the real column — the chart then overflows on iOS Safari
            // rather than shrinking. The height steps down on phones so the
            // chart and the stats under it are not separated by a full screen
            // of scrolling.
            <div className="w-full min-w-0 h-[260px] sm:h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={plotted} margin={{ top: 5, right: usesRightAxis ? 8 : 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis dataKey="ts" type="number" scale="time" domain={[win.from, win.to]}
                  tickFormatter={(v) => fmtTick(Number(v))}
                  tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis yAxisId="L" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false}
                  domain={axisMode === 'normalize' ? [0, 100] : ['auto', 'auto']}
                  tickFormatter={axisMode === 'normalize' ? (v) => `${v}%` : undefined} />
                {usesRightAxis && (
                  <YAxis yAxisId="R" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                )}
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                  labelFormatter={(v) => fmtDateTime(Number(v))}
                  formatter={(v: unknown, name: string, item: { payload?: Record<string, unknown>; dataKey?: string | number }) => {
                    const key = String(item?.dataKey ?? '')
                    if (key.endsWith('__band')) {
                      const baseKey = key.slice(0, -'__band'.length)
                      if (Array.isArray(v)) {
                        const unit = axisMode === 'normalize' ? '%' : unitOf(baseKey)
                        return [`${Number(v[0]).toFixed(2)} – ${Number(v[1]).toFixed(2)}${unit ? ` ${unit}` : ''}`, `${nameOf(baseKey)} min–max`]
                      }
                    }
                    if (axisMode === 'normalize') {
                      const raw = item?.payload?.[`${key}__raw`]
                      const unit = unitOf(key)
                      const pct = typeof v === 'number' ? `${v.toFixed(0)}%` : String(v)
                      return [typeof raw === 'number' ? `${raw}${unit ? ` ${unit}` : ''} · ${pct}` : pct, name]
                    }
                    const unit = unitOf(key)
                    return [`${v}${unit ? ` ${unit}` : ''}`, name]
                  }} />
                {drawOrder.map((key) => {
                  const i = chart.paramKeys.indexOf(key)
                  const color = PALETTE[i % PALETTE.length]
                  const yAxisId = usesRightAxis ? (axisOf.get(key) ?? 'L') : 'L'
                  const dim = focusKey && focusKey !== key
                  return (
                    <Area key={`${key}__band`} yAxisId={yAxisId} dataKey={`${key}__band`}
                      stroke="none" fill={color} fillOpacity={dim ? 0.04 : 0.14}
                      name={`${nameOf(key)} min–max`} isAnimationActive={false} legendType="none" />
                  )
                })}
                {drawOrder.map((key) => {
                  const i = chart.paramKeys.indexOf(key)
                  const color = PALETTE[i % PALETTE.length]
                  const yAxisId = usesRightAxis ? (axisOf.get(key) ?? 'L') : 'L'
                  const dim = focusKey && focusKey !== key
                  return (
                    <Line key={key} yAxisId={yAxisId} type="monotone" dataKey={key}
                      stroke={color} strokeWidth={focusKey === key ? 2.4 : 1.5} strokeOpacity={dim ? 0.3 : 1}
                      dot={false} name={nameOf(key)} connectNulls isAnimationActive={false} />
                  )
                })}
                {/* Alarm thresholds — one pair of reference lines per series
                    that (a) is not hidden and (b) actually has a saved rule.
                    Drawing every device's built-in schema default here would
                    show limits nobody actually configured for THIS chart's
                    parameters; only real, saved rule entries are rendered. */}
                {(showThresholds ? visibleKeys : []).map((key) => {
                  const p = rule?.params.find((x) => x.key === key)
                  if (!p || axisMode === 'normalize') return null
                  const i = chart.paramKeys.indexOf(key)
                  const color = PALETTE[i % PALETTE.length]
                  const yAxisId = usesRightAxis ? (axisOf.get(key) ?? 'L') : 'L'
                  return (
                    <Fragment key={key}>
                      <ReferenceLine yAxisId={yAxisId} y={p.warn} stroke={color} strokeOpacity={0.55} strokeDasharray="4 4"
                        label={{ value: `${nameOf(key)} warn`, fill: color, fontSize: 9, position: 'insideTopRight' }} />
                      <ReferenceLine yAxisId={yAxisId} y={p.critical} stroke={color} strokeDasharray="2 2"
                        label={{ value: `${nameOf(key)} crit`, fill: color, fontSize: 9, position: 'insideBottomRight' }} />
                    </Fragment>
                  )
                })}
                {/* Drag to narrow the view to a sub-range without refetching —
                    the excursion is usually minutes wide inside a window
                    measured in hours. travellerWidth is bumped from the 5px
                    default because the handles are a touch target on a phone. */}
                <Brush dataKey="ts" height={22} travellerWidth={10}
                  stroke="#6366f1" fill="#0d1117"
                  tickFormatter={(v) => fmtTick(Number(v))} />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          )}
          {axisMode === 'normalize' && data.length > 0 && (
            <p className="text-[9px] text-slate-600 mt-1">
              Each line is scaled to 0–100% of its own range in this window — shapes are comparable, heights are not. Alarm thresholds are hidden in this mode since they are real-unit values. Hover for real readings.
            </p>
          )}
        </div>

        {/* Per-series stats — weighted by each bucket's own sample count, not
            a plain average of bucket averages. */}
        {stats.size > 0 && (
          <div className="px-5 pt-4 pb-5">
            {/* Five columns of numbers do not fit a phone: the table's own
                min-content width is ~340px against a ~294px container on a
                360px Android, so with the rounded card's overflow-hidden alone
                the Samples column was silently CLIPPED — cut off with no way
                to reach it. The inner overflow-x-auto lets the table scroll
                inside itself instead, leaving the page's own horizontal scroll
                (and the rounded corners) intact. */}
            <div className="rounded-xl overflow-hidden" style={inset}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] min-w-[620px]">
                  <thead>
                    <tr className="text-slate-500" style={{ borderBottom: '1px solid #1e2433' }}>
                      <th className="text-left font-medium px-3 py-2">Parameter</th>
                      <th className="text-right font-medium px-3 py-2">Min</th>
                      <th className="text-right font-medium px-3 py-2">Average</th>
                      <th className="text-right font-medium px-3 py-2">Max</th>
                      <th className="text-right font-medium px-3 py-2 whitespace-nowrap" title="Peak-to-trough swing across this window (max − min)">Δ Span</th>
                      <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Samples</th>
                      <th className="text-left font-medium px-3 py-2 whitespace-nowrap" title="Status of the most recent reading in this window, evaluated against this device's saved rule">Latest</th>
                      <th className="text-right font-medium px-3 py-2 whitespace-nowrap" title="Share of the window whose bucket average sat in warning or critical">In alarm</th>
                      <th className="text-center font-medium px-3 py-2 whitespace-nowrap" title="Engineered warning / critical alarm thresholds">Thresholds</th>
                      {onEdit && <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.paramKeys.map((k, i) => {
                      const s = stats.get(k)
                      const unit = unitOf(k)
                      const p = rule?.params.find((x) => x.key === k)
                      return (
                        <tr key={k} style={{ borderTop: i ? '1px solid #1e2433' : undefined, opacity: hidden.has(k) ? 0.4 : 1 }}>
                          {/* The flex lives on an inner span, NOT the td: a
                              display:flex td stops being a table-cell, which
                              drops it out of the column sizing algorithm and
                              lets this column drift out of line with its own
                              header. */}
                          <td className="px-3 py-2 text-slate-300">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                              {nameOf(k)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{s ? `${s.min.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-200 font-medium whitespace-nowrap">{s ? `${s.avg.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{s ? `${s.max.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{s ? `${s.delta.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{s ? s.n.toLocaleString() : '—'}</td>
                          {/* No saved rule for this parameter means there is
                              nothing to diagnose against — an em dash, not a
                              reassuring green "normal" it has not earned. */}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {s?.latestStatus ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide"
                                style={{ color: STATUS_STYLE[s.latestStatus].color, background: STATUS_STYLE[s.latestStatus].bg }}>
                                {s.latestStatus}
                              </span>
                            ) : <span className="text-slate-600" title="No alarm threshold saved for this parameter">no rule</span>}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {s?.rule ? (
                              <span className={s.pctAlarm > 0 ? 'text-amber-300' : 'text-slate-500'}>
                                {s.pctAlarm.toFixed(1)}%
                                {/* Every bucket average stayed inside limits, yet
                                    the window's worst single moment did not —
                                    a spike averaged away is exactly what a
                                    percentage alone would hide. */}
                                {s.pctAlarm === 0 && s.peakStatus && s.peakStatus !== 'NORMAL' && (
                                  <span className="ml-1 text-[9px]" style={{ color: STATUS_STYLE[s.peakStatus].color }}
                                    title={`No bucket average breached, but the window's peak reached ${s.peakStatus}`}>
                                    ⚠ peak
                                  </span>
                                )}
                              </span>
                            ) : <span className="text-slate-600">—</span>}
                          </td>
                          {/* Warn / Crit limits */}
                          <td className="px-3 py-2 text-center whitespace-nowrap text-[10px]">
                            {p ? (
                              <span className="inline-flex items-center gap-1 font-mono">
                                <span className="text-amber-300/90">{p.warn}</span>
                                <span className="text-slate-600">/</span>
                                <span className="text-rose-400/90">{p.critical}</span>
                                <span className="text-slate-500 text-[9px]">{unit}</span>
                              </span>
                            ) : (
                              <span className="text-slate-600">None</span>
                            )}
                          </td>
                          {/* Inline Tune Action */}
                          {onEdit && (
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => {
                                  const cur = rule?.params.find((x) => x.key === k)
                                  setTuningParam({
                                    key: k,
                                    label: nameOf(k),
                                    unit: unitOf(k),
                                    direction: cur?.direction ?? 'high',
                                    warn: cur?.warn ?? (s ? +(s.avg * 1.15).toFixed(1) : 80),
                                    critical: cur?.critical ?? (s ? +(s.avg * 1.3).toFixed(1) : 90),
                                  })
                                  setTuningError(null)
                                }}
                                title={`Tune alarm thresholds for ${nameOf(k)}`}
                                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded text-indigo-300 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/30 transition-colors"
                              >
                                <Sliders size={10} /> Tune
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Correlation — only meaningful once there are two series to
                relate. A single-parameter chart has no pair to report. */}
            {chart.paramKeys.length > 1 && (
              <div className="mt-3 rounded-xl p-3" style={inset}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                  <h3 className="text-[11px] font-semibold text-slate-200">How these parameters moved together</h3>
                  <span className="text-[9px] text-slate-600">
                    Pearson r over {data.length} buckets · same in every axis mode
                  </span>
                </div>

                {!correlations.length ? (
                  <p className="text-[10px] text-slate-500">
                    Not enough overlapping data yet — a pair needs at least {MIN_PAIR_POINTS} buckets carrying both
                    values, and both series must actually vary. Try a longer window.
                  </p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      {correlations.slice(0, MAX_PAIRS_SHOWN).map((c) => {
                        const pct = Math.min(100, Math.abs(c.r) * 100)
                        const col = c.r >= 0 ? '#6366f1' : '#f97316'
                        return (
                          <div key={`${c.a}|${c.b}`} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-300 truncate flex-1 min-w-0" title={`${nameOf(c.a)} vs ${nameOf(c.b)}`}>
                              {nameOf(c.a)} <span className="text-slate-600">vs</span> {nameOf(c.b)}
                            </span>
                            <span className="h-1.5 rounded-full shrink-0" style={{ width: 60, background: '#1e2433' }}>
                              <span className="block h-1.5 rounded-full" style={{ width: `${pct}%`, background: col }} />
                            </span>
                            <span className="text-[10px] font-medium tabular-nums w-11 text-right shrink-0" style={{ color: col }}>
                              {c.r >= 0 ? '+' : ''}{c.r.toFixed(2)}
                            </span>
                            <span className="text-[9px] text-slate-500 w-28 shrink-0 hidden sm:inline">{rLabel(c.r)}</span>
                          </div>
                        )
                      })}
                    </div>
                    {/* Never let a top-N read as "this is all of them". */}
                    {correlations.length > MAX_PAIRS_SHOWN && (
                      <p className="text-[9px] text-slate-600 mt-2">
                        Showing the {MAX_PAIRS_SHOWN} strongest of {correlations.length} reportable pairs
                        {totalPairs > correlations.length ? ` (${totalPairs - correlations.length} more had too little overlapping data or a flat series)` : ''}.
                      </p>
                    )}
                    {correlations.length <= MAX_PAIRS_SHOWN && totalPairs > correlations.length && (
                      <p className="text-[9px] text-slate-600 mt-2">
                        {totalPairs - correlations.length} of {totalPairs} pairs are not reportable — too little overlapping data, or one series never varied.
                      </p>
                    )}
                    <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">
                      Measured on bucketed averages, so a coarser window smooths out brief divergence and tends to push
                      values toward ±1. Association is not causation — two readings often track each other because both
                      follow load or ambient temperature.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer — when this data was actually read, and how it was reduced.
            Both matter for trusting what is on screen: a chart with no
            timestamp could be minutes stale, and a 30-day window is bucketed
            hard enough that "no spike visible" needs the caveat that the
            min–max band, not the line, is what preserves one. */}
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3"
          style={{ borderTop: '1px solid #1e2433' }}>
          <span className="text-[10px] text-slate-500">
            {lastLoadedAt
              ? <>Last updated {fmtDateTime(lastLoadedAt)}{rows?.length ? ` · ${tableRows.length.toLocaleString()} buckets, averaged per bucket` : ''}</>
              : 'Not loaded yet'}
          </span>
          <button onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-lg font-medium text-slate-300 hover:text-white" style={inset}>
            Close analysis
          </button>
        </div>
        {/* Inline Threshold Tuning Modal */}
        {tuningParam && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => setTuningParam(null)}>
            <div className="w-full max-w-sm rounded-xl p-5 space-y-4 shadow-2xl border border-indigo-500/50" style={{ background: '#0d1117' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-indigo-400" />
                  <h4 className="text-sm font-bold text-white">Tune Alarm Thresholds</h4>
                </div>
                <button onClick={() => setTuningParam(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="text-xs text-slate-300">
                Parameter: <span className="font-semibold text-white">{tuningParam.label}</span> {tuningParam.unit && `(${tuningParam.unit})`}
              </div>
              {tuningError && (
                <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{tuningError}</span>
                </div>
              )}
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Alarm Direction</label>
                  <select
                    value={tuningParam.direction}
                    onChange={(e) => setTuningParam({ ...tuningParam, direction: e.target.value as 'high' | 'low' })}
                    className="w-full rounded-lg px-3 py-2 bg-[#0a0e1a] text-slate-200 border border-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="high">High Alarm (Triggers when value rises above limit)</option>
                    <option value="low">Low Alarm (Triggers when value drops below limit)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-amber-300 block mb-1 font-medium">Warning Limit</label>
                    <input
                      type="number"
                      step="any"
                      value={tuningParam.warn}
                      onChange={(e) => setTuningParam({ ...tuningParam, warn: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg px-3 py-2 bg-[#0a0e1a] text-slate-200 border border-amber-500/40 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-rose-400 block mb-1 font-medium">Critical Limit</label>
                    <input
                      type="number"
                      step="any"
                      value={tuningParam.critical}
                      onChange={(e) => setTuningParam({ ...tuningParam, critical: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg px-3 py-2 bg-[#0a0e1a] text-slate-200 border border-rose-500/40 focus:border-rose-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => setTuningParam(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTunedThreshold}
                  disabled={tuningSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                >
                  {tuningSaving && <Loader2 size={12} className="animate-spin" />}
                  Save &amp; Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
