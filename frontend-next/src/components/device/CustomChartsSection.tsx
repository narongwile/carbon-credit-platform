'use client'

// ---------------------------------------------------------------------------
// Admin-configurable trend charts, rendered below the device's photo gallery.
// Unlike the two fixed 2-series charts above (CHART_ROLES, pattern-matched
// against a hardcoded set of roles), every chart here is admin-composed: any
// number of this device's own parameters, any number of charts. Each fetches
// its own window in one round trip via readingsGetFunc's paramKey=a,b,c form.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type ChartDefinition } from '@/lib/api'
import type { SensorDomain } from '@/types/fleet'
import { fmtHM, fmtDayMonth } from '@/lib/displayTime'
import ChartBuilderModal, { type AvailableParam } from './ChartBuilderModal'
import ChartAnalysisModal from './ChartAnalysisModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Plus, Pencil, LayoutDashboard, Maximize2 } from 'lucide-react'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

// A fixed, high-contrast palette rather than random colors — legible against
// the dark surface and stable across re-renders/re-orderings of the same chart.
const PALETTE = ['#6366f1', '#f97316', '#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']

const QUICK = [
  { id: '1h', label: '1h', minutes: 60 },
  { id: '24h', label: '24h', minutes: 1440 },
  { id: '7d', label: '7d', minutes: 10080 },
] as const

interface Row { param_key: string; value: number; taken_at: string }

// ---------------------------------------------------------------------------
// How several parameters with different units share one chart
// ---------------------------------------------------------------------------
// A single shared Y axis is only honest when every series has a comparable
// range. Put hydrogen (200–1000 ppm) next to oil temperature (30–80 °C) and
// load (0–100 %) on one axis and the axis spans 0–1000: temperature and load
// collapse onto the bottom gridline as flat lines, and a real excursion in
// either is invisible. Hence two modes beyond the plain shared axis:
//
//   dual      two axes. Series are grouped by UNIT — the first unit owns the
//             left axis, everything else the right. Values stay real and
//             readable off an axis; the honest limit is that a third unit
//             shares the right axis with the second.
//   normalize every series rescaled to 0–100% of its OWN min–max across the
//             window. Units stop being comparable on purpose — this answers
//             "did these move together?", not "what was the value?", so the
//             tooltip keeps showing the real reading underneath.
type AxisMode = 'dual' | 'shared' | 'normalize'

const AXIS_MODES: { id: AxisMode; label: string; title: string }[] = [
  { id: 'dual', label: 'Dual axis', title: 'Two Y axes, grouped by unit — values stay real' },
  { id: 'shared', label: 'Same axis', title: 'One Y axis for every series' },
  { id: 'normalize', label: 'Normalize %', title: 'Each series scaled to 0–100% of its own range — compare trends across units' },
]

function MultiParamChart({ nodeId, chart, paramByKey }: { nodeId: string; chart: ChartDefinition; paramByKey: Map<string, AvailableParam> }) {
  const [quick, setQuick] = useState<(typeof QUICK)[number]['id']>('24h')
  const [axisMode, setAxisMode] = useState<AxisMode>('dual')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    const minutes = QUICK.find((q) => q.id === quick)?.minutes ?? 1440
    const to = Date.now()
    const from = to - minutes * 60_000
    const bucketSec = Math.max(60, (to - from) / 1000 / 200)
    api.readingsWindow(nodeId, new Date(from).toISOString(), new Date(to).toISOString(), bucketSec, chart.paramKeys.join(','))
      .then((r) => { if (!cancelled) setRows((r ?? []) as Row[]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, chart.paramKeys, quick])

  useEffect(() => load(), [load])

  const data = useMemo(() => {
    const spanHours = quick === '7d' ? 168 : quick === '24h' ? 24 : 1
    const byTime = new Map<string, Record<string, number | string>>()
    for (const r of rows ?? []) {
      const row = byTime.get(r.taken_at) ?? { time: spanHours > 36 ? fmtDayMonth(r.taken_at) : fmtHM(r.taken_at), ts: new Date(r.taken_at).getTime() }
      row[r.param_key] = Number(r.value)
      byTime.set(r.taken_at, row)
    }
    return Array.from(byTime.values()).sort((a, b) => (a.ts as number) - (b.ts as number))
  }, [rows, quick])

  const nameOf = (key: string) => {
    const p = paramByKey.get(key)
    return p ? (p.unit ? `${p.label} (${p.unit})` : p.label) : key
  }

  /** Which Y axis each series belongs to, grouped by unit (dual mode only).
   * The first unit encountered keeps the left axis so a chart's primary
   * series does not jump sides when another parameter is added to it. */
  const axisOf = useMemo(() => {
    const m = new Map<string, 'L' | 'R'>()
    if (axisMode !== 'dual') { chart.paramKeys.forEach((k) => m.set(k, 'L')); return m }
    let leftUnit: string | null = null
    for (const k of chart.paramKeys) {
      const unit = paramByKey.get(k)?.unit ?? ''
      if (leftUnit === null) leftUnit = unit
      m.set(k, unit === leftUnit ? 'L' : 'R')
    }
    return m
  }, [axisMode, chart.paramKeys, paramByKey])

  const usesRightAxis = axisMode === 'dual' && Array.from(axisOf.values()).includes('R')

  /** Per-series min/max across the window — the scale normalize mode maps onto
   * 0–100%, and what the tooltip uses to report the real value back. */
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

  /** In normalize mode every series is replaced by its 0–100 position within
   * its own range. A flat series (min === max) sits at 50% rather than
   * dividing by zero — it genuinely has no trend to show. */
  const plotted = useMemo(() => {
    if (axisMode !== 'normalize') return data
    return data.map((d) => {
      const out: Record<string, number | string> = { time: d.time, ts: d.ts }
      for (const k of chart.paramKeys) {
        const v = d[k]
        if (typeof v !== 'number' || Number.isNaN(v)) continue
        const r = ranges.get(k)
        if (!r) continue
        out[k] = r.max === r.min ? 50 : ((v - r.min) / (r.max - r.min)) * 100
        // Kept alongside so the tooltip can show what the % actually was.
        out[`${k}__raw`] = v
      }
      return out
    })
  }, [axisMode, data, chart.paramKeys, ranges])

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {QUICK.map((q) => (
          <button key={q.id} onClick={() => setQuick(q.id)}
            className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${quick === q.id ? 'text-white' : 'text-slate-500'}`}
            style={quick === q.id ? { background: '#6366f1' } : inset}>
            {q.label}
          </button>
        ))}
        {/* Only worth offering when the chart actually mixes series — a
            single-parameter chart has nothing to reconcile. */}
        {chart.paramKeys.length > 1 && (
          <div className="flex items-center gap-1 ml-1 pl-1" style={{ borderLeft: '1px solid #1e2433' }}>
            {AXIS_MODES.map((m) => (
              <button key={m.id} onClick={() => setAxisMode(m.id)} title={m.title}
                className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${axisMode === m.id ? 'text-white' : 'text-slate-500'}`}
                style={axisMode === m.id ? { background: '#4b5563' } : inset}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {loading && <span className="text-[10px] text-slate-600 ml-1">loading…</span>}
      </div>
      {!data.length ? (
        <div className="h-[140px] flex items-center justify-center text-[11px] text-slate-600">
          {loading ? 'Loading…' : 'No stored readings in this period'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={plotted} margin={{ top: 5, right: usesRightAxis ? 4 : 10, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis yAxisId="L" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false}
              domain={axisMode === 'normalize' ? [0, 100] : ['auto', 'auto']}
              tickFormatter={axisMode === 'normalize' ? (v) => `${v}%` : undefined} />
            {usesRightAxis && (
              <YAxis yAxisId="R" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            )}
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
              // In normalize mode the plotted number is a percentage of each
              // series' own range — reporting only that would hide the reading
              // the operator actually needs, so the real value comes with it.
              formatter={axisMode === 'normalize'
                ? (v: unknown, name: string, item: { payload?: Record<string, unknown>; dataKey?: string | number }) => {
                    const key = String(item?.dataKey ?? '')
                    const raw = item?.payload?.[`${key}__raw`]
                    const unit = paramByKey.get(key)?.unit ?? ''
                    const pct = typeof v === 'number' ? `${v.toFixed(0)}%` : String(v)
                    return [typeof raw === 'number' ? `${raw}${unit ? ` ${unit}` : ''} · ${pct}` : pct, name]
                  }
                : undefined} />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
            {chart.paramKeys.map((key, i) => (
              <Line key={key} yAxisId={usesRightAxis ? (axisOf.get(key) ?? 'L') : 'L'}
                type="monotone" dataKey={key} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.5}
                dot={false} name={nameOf(key)} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      {axisMode === 'normalize' && data.length > 0 && (
        <p className="text-[9px] text-slate-600 mt-1">
          Each line is scaled to 0–100% of its own range in this window — shapes are comparable, heights are not. Hover for real values.
        </p>
      )}
    </div>
  )
}

export default function CustomChartsSection({
  nodeId, orgId, domain, availableParams, canConfigure,
}: {
  nodeId: string
  orgId?: string
  domain: SensorDomain
  availableParams: AvailableParam[]
  canConfigure: boolean
}) {
  const live = useIsLive()
  const [charts, setCharts] = useState<ChartDefinition[] | null>(null)
  const [editing, setEditing] = useState<ChartDefinition | 'new' | null>(null)
  const [expanded, setExpanded] = useState<ChartDefinition | null>(null)

  const reload = useCallback(() => {
    if (!live) { setCharts([]); return }
    api.listCharts(nodeId).then((r) => setCharts(r ?? []))
  }, [nodeId, live])

  useEffect(() => { reload() }, [reload])

  const paramByKey = useMemo(() => {
    const m = new Map<string, AvailableParam>()
    for (const p of availableParams) m.set(p.key, p)
    return m
  }, [availableParams])

  // Nothing configured and the viewer cannot add one — no point showing an
  // empty section header on every device page that has never used this.
  if (!canConfigure && charts !== null && charts.length === 0) return null

  return (
    <div className="flex-shrink-0 p-3" style={{ borderTop: '1px solid #1e2433' }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <LayoutDashboard size={11} /> Custom Charts
        </div>
        {canConfigure && live && (
          <button onClick={() => setEditing('new')} title="Add a chart"
            className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400">
            <Plus size={11} /> Add chart
          </button>
        )}
      </div>

      {!live ? (
        <p className="text-[11px] text-slate-600">Switch to Live mode to configure custom charts.</p>
      ) : charts === null ? (
        <p className="text-[11px] text-slate-600">Loading…</p>
      ) : charts.length === 0 ? (
        <p className="text-[11px] text-slate-600">
          No custom charts yet{canConfigure ? ' — combine any parameters this device reports into a chart of your own.' : '.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {charts.map((c) => (
            <div key={c.id} className="rounded-xl p-3" style={inset}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-medium text-slate-200 truncate">{c.title}</div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => setExpanded(c)} title="Expand — chart visualize analysis"
                    className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-white/5">
                    <Maximize2 size={11} />
                  </button>
                  {canConfigure && (
                    <button onClick={() => setEditing(c)} title="Edit this chart"
                      className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-white/5">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
              </div>
              <MultiParamChart nodeId={nodeId} chart={c} paramByKey={paramByKey} />
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ChartBuilderModal
          nodeId={nodeId}
          orgId={orgId}
          domain={domain}
          availableParams={availableParams}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}

      {expanded && (
        <ChartAnalysisModal
          nodeId={nodeId}
          chart={expanded}
          paramByKey={paramByKey}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  )
}
