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
// be actually useful: a real time range picker, the min/max band under each
// average line (readingsGetFunc already returns v_min/v_max/n per bucket —
// nothing new to fetch), the device's real alarm thresholds as reference
// lines (per PARAMETER, from the same NodeAlarmRule every other chart reads —
// a combined chart alarms identically to viewing one series alone), a
// per-series stats table weighted correctly by each bucket's sample count,
// and CSV export.
// ---------------------------------------------------------------------------

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type ChartDefinition } from '@/lib/api'
import type { AvailableParam } from './ChartBuilderModal'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { X, Loader2, Download, LayoutDashboard, Pencil } from 'lucide-react'

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

type AxisMode = 'dual' | 'shared' | 'normalize'
const AXIS_MODES: { id: AxisMode; label: string; title: string }[] = [
  { id: 'dual', label: 'Dual axis', title: 'Two Y axes, grouped by unit — values stay real' },
  { id: 'shared', label: 'Same axis', title: 'One Y axis for every series' },
  { id: 'normalize', label: 'Normalize %', title: 'Each series scaled to 0–100% of its own range — compare trends across units' },
]

interface Row { param_key: string; value: number; taken_at: string; v_min?: number; v_max?: number; n?: number }

export default function ChartAnalysisModal({
  nodeId, deviceName, chart, paramByKey, onClose, onEdit,
}: {
  nodeId: string
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
  const [axisMode, setAxisMode] = useState<AxisMode>('dual')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [win, setWin] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - 1440 * 60_000, to: Date.now() }))
  const [rule, setRule] = useState<NodeAlarmRule | null>(null)

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
      .then((r) => { if (!cancelled) { setRows((r ?? []) as Row[]); setWin(range) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [live, nodeId, chart.paramKeys, range])

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

  /** Weighted by each bucket's own sample count (n) — a straight average of
   * per-bucket averages would silently under-count a bucket that rolled up
   * thousands of raw readings next to one that rolled up a handful. Min/max
   * are the true extremes seen in the window, not extremes of the bucket
   * averages. */
  const stats = useMemo(() => {
    const m = new Map<string, { min: number; max: number; avg: number; n: number }>()
    for (const k of chart.paramKeys) {
      let min = Infinity, max = -Infinity, sum = 0, n = 0
      for (const r of rows ?? []) {
        if (r.param_key !== k) continue
        const w = r.n ?? 1
        min = Math.min(min, Number(r.v_min ?? r.value))
        max = Math.max(max, Number(r.v_max ?? r.value))
        sum += Number(r.value) * w
        n += w
      }
      if (n > 0) m.set(k, { min, max, avg: sum / n, n })
    }
    return m
  }, [rows, chart.paramKeys])

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

  const exportCsv = () => {
    downloadCSV(
      `${nodeId}_${chart.title.replace(/[^a-z0-9]+/gi, '_')}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Time', ...chart.paramKeys.flatMap((k) => [`${nameOf(k)}${unitOf(k) ? ` (${unitOf(k)})` : ''}`, `${nameOf(k)} min`, `${nameOf(k)} max`])],
      (rows ?? []).length
        ? Array.from(new Map((rows ?? []).map((r) => [r.taken_at, r])).keys()).sort().map((takenAt) => {
            const atTime = (rows ?? []).filter((r) => r.taken_at === takenAt)
            const byKey = new Map(atTime.map((r) => [r.param_key, r]))
            return [fmtDateTime(takenAt), ...chart.paramKeys.flatMap((k) => {
              const r = byKey.get(k)
              return [r ? r.value : '', r?.v_min ?? '', r?.v_max ?? '']
            })]
          })
        : [],
    )
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
          <input
            type="datetime-local"
            value={custom?.from ?? toDisplayInput(range.from)}
            onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? toDisplayInput(range.to) }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          <span className="text-slate-600 text-[11px]">→</span>
          <input
            type="datetime-local"
            value={custom?.to ?? toDisplayInput(range.to)}
            onChange={(e) => setCustom((c) => ({ from: c?.from ?? toDisplayInput(range.from), to: e.target.value }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          {custom && (
            <button onClick={() => setCustom(null)} className="text-[11px] text-slate-500 hover:text-white underline">reset</button>
          )}
          <span className="text-[10px] text-slate-600" title={`All times shown in ${DISPLAY_TZ_LABEL}`}>
            times in {DISPLAY_TZ_LABEL}
          </span>

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

          <div className="ml-auto flex items-center gap-2">
            {loading && <Loader2 size={13} className="animate-spin text-indigo-400" />}
            <button onClick={exportCsv} disabled={!rows?.length}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md text-slate-300 disabled:opacity-40" style={inset}>
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

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
            <div className="h-[380px] flex items-center justify-center text-sm text-slate-600">
              Switch to Live mode to see stored history.
            </div>
          ) : !visibleKeys.length ? (
            <div className="h-[380px] flex items-center justify-center text-sm text-slate-600">
              Every series is hidden — click a legend chip to show it again.
            </div>
          ) : data.length < 2 ? (
            <div className="h-[380px] flex items-center justify-center text-sm text-slate-600">
              {loading ? 'Loading…' : 'No readings stored in this period.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
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
                {visibleKeys.map((key) => {
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
              </ComposedChart>
            </ResponsiveContainer>
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
            <div className="rounded-xl overflow-hidden" style={inset}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500" style={{ borderBottom: '1px solid #1e2433' }}>
                    <th className="text-left font-medium px-3 py-2">Parameter</th>
                    <th className="text-right font-medium px-3 py-2">Min</th>
                    <th className="text-right font-medium px-3 py-2">Average</th>
                    <th className="text-right font-medium px-3 py-2">Max</th>
                    <th className="text-right font-medium px-3 py-2">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.paramKeys.map((k, i) => {
                    const s = stats.get(k)
                    const unit = unitOf(k)
                    return (
                      <tr key={k} style={{ borderTop: i ? '1px solid #1e2433' : undefined, opacity: hidden.has(k) ? 0.4 : 1 }}>
                        <td className="px-3 py-2 text-slate-300 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                          {nameOf(k)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">{s ? `${s.min.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-200 font-medium">{s ? `${s.avg.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{s ? `${s.max.toFixed(2)}${unit ? ` ${unit}` : ''}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{s ? s.n.toLocaleString() : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
