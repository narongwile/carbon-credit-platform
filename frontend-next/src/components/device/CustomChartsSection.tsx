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

type AxisMode = 'dual' | 'shared' | 'normalize'

const AXIS_MODES: { id: AxisMode; label: string; title: string }[] = [
  { id: 'dual', label: 'Dual axis', title: 'Two Y axes, grouped by unit — values stay real' },
  { id: 'shared', label: 'Same axis', title: 'One Y axis for every series' },
  { id: 'normalize', label: 'Normalize %', title: 'Each series scaled to 0–100% of its own range — compare trends across units' },
]

function MultiParamChart({
  nodeId,
  chart,
  paramByKey,
  onExpand,
}: {
  nodeId: string
  chart: ChartDefinition
  paramByKey: Map<string, AvailableParam>
  onExpand?: () => void
}) {
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

  const axisOf = useMemo(() => {
    const m = new Map<string, 'L' | 'R'>()
    if (axisMode !== 'dual') { chart.paramKeys.forEach((k) => m.set(k, 'L')); return m }
    const distinctUnits = new Set(chart.paramKeys.map((k) => paramByKey.get(k)?.unit ?? ''))
    if (distinctUnits.size > 1) {
      let leftUnit: string | null = null
      for (const k of chart.paramKeys) {
        const unit = paramByKey.get(k)?.unit ?? ''
        if (leftUnit === null) leftUnit = unit
        m.set(k, unit === leftUnit ? 'L' : 'R')
      }
    } else {
      chart.paramKeys.forEach((k, idx) => {
        m.set(k, idx === 0 ? 'L' : 'R')
      })
    }
    return m
  }, [axisMode, chart.paramKeys, paramByKey])

  const usesRightAxis = axisMode === 'dual' && Array.from(axisOf.values()).includes('R')

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
      const out: Record<string, number | string> = { time: d.time, ts: d.ts }
      for (const k of chart.paramKeys) {
        const v = d[k]
        if (typeof v !== 'number' || Number.isNaN(v)) continue
        const r = ranges.get(k)
        if (!r) continue
        out[k] = r.max === r.min ? 50 : ((v - r.min) / (r.max - r.min)) * 100
        out[`${k}__raw`] = v
      }
      return out
    })
  }, [axisMode, data, chart.paramKeys, ranges])

  const leftKey = chart.paramKeys.find((k) => axisOf.get(k) === 'L')
  const rightKey = chart.paramKeys.find((k) => axisOf.get(k) === 'R')
  const leftColor = usesRightAxis && leftKey ? PALETTE[chart.paramKeys.indexOf(leftKey) % PALETTE.length] : '#64748b'
  const rightColor = usesRightAxis && rightKey ? PALETTE[chart.paramKeys.indexOf(rightKey) % PALETTE.length] : '#64748b'

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1 flex-wrap">
          {QUICK.map((q) => (
            <button key={q.id} onClick={() => setQuick(q.id)}
              className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${quick === q.id ? 'text-white' : 'text-slate-500'}`}
              style={quick === q.id ? { background: '#6366f1' } : inset}>
              {q.label}
            </button>
          ))}
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

        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand & Analyze Chart"
            className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium px-1.5 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
          >
            <Maximize2 size={10} /> Expand
          </button>
        )}
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
            <YAxis yAxisId="L" tick={{ fill: leftColor, fontSize: 10 }} tickLine={false} axisLine={false}
              domain={axisMode === 'normalize' ? [0, 100] : ['auto', 'auto']}
              tickFormatter={axisMode === 'normalize' ? (v) => `${v}%` : undefined} />
            {usesRightAxis && (
              <YAxis yAxisId="R" orientation="right" tick={{ fill: rightColor, fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            )}
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
              formatter={(v: unknown, name: string, item: { payload?: Record<string, unknown>; dataKey?: string | number }) => {
                const key = String(item?.dataKey ?? '')
                const unit = paramByKey.get(key)?.unit ?? ''
                if (axisMode === 'normalize') {
                  const raw = item?.payload?.[`${key}__raw`]
                  const pct = typeof v === 'number' ? `${v.toFixed(0)}%` : String(v)
                  return [typeof raw === 'number' ? `${raw}${unit ? ` ${unit}` : ''} · ${pct}` : pct, name]
                }
                return [typeof v === 'number' ? `${v.toFixed(2)}${unit ? ` ${unit}` : ''}` : String(v), name]
              }} />
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
  const [analyzing, setAnalyzing] = useState<ChartDefinition | null>(null)

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

  if (!canConfigure && charts !== null && charts.length === 0) return null

  return (
    <div className="flex-shrink-0 p-3" style={{ borderTop: '1px solid #1e2433' }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <LayoutDashboard size={11} /> Custom Charts
        </div>
        {canConfigure && live && (
          <button onClick={() => setEditing('new')} title="Add a chart"
            className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400 transition-colors">
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
                <div className="flex items-center gap-1">
                  {/* Universal Expand button for BOTH admin and viewer/customer */}
                  <button
                    onClick={() => setAnalyzing(c)}
                    title="Expand & Analyze Chart"
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 shrink-0 transition-colors"
                  >
                    <Maximize2 size={12} />
                  </button>
                  {canConfigure && (
                    <button
                      onClick={() => setEditing(c)}
                      title="Edit this chart"
                      className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-white/5 shrink-0 transition-colors"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
              </div>
              <MultiParamChart
                nodeId={nodeId}
                chart={c}
                paramByKey={paramByKey}
                onExpand={() => setAnalyzing(c)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Deep Visualizer & Analysis Studio Modal */}
      {analyzing && (
        <ChartAnalysisModal
          nodeId={nodeId}
          orgId={orgId}
          domain={domain}
          chart={analyzing}
          availableParams={availableParams}
          canConfigure={canConfigure}
          onClose={() => setAnalyzing(null)}
          onEdit={canConfigure ? () => {
            const target = analyzing
            setAnalyzing(null)
            setEditing(target)
          } : undefined}
        />
      )}

      {/* Chart Builder / Editor Modal */}
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
    </div>
  )
}

