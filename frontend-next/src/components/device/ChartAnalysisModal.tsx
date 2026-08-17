'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type ChartDefinition } from '@/lib/api'
import type { SensorDomain } from '@/types/fleet'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { downloadCSV } from '@/lib/exportFile'
import { useAlarmDB } from '@/server/alarmStore'
import { type AvailableParam } from './ChartBuilderModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush, ReferenceLine,
} from 'recharts'
import {
  X, Maximize2, Download, RefreshCw, Calendar, Sliders, TrendingUp, AlertTriangle, CheckCircle2,
  Table as TableIcon, LineChart as LineChartIcon, Pencil, Activity, Sparkles, Check, ChevronDown
} from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)' }

const PALETTE = ['#6366f1', '#f97316', '#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']

const QUICK = [
  { id: '1h', label: '1 Hour', minutes: 60 },
  { id: '6h', label: '6 Hours', minutes: 360 },
  { id: '24h', label: '24 Hours', minutes: 1440 },
  { id: '7d', label: '7 Days', minutes: 10080 },
  { id: '30d', label: '30 Days', minutes: 43200 },
] as const

type AxisMode = 'dual' | 'shared' | 'normalize'

const AXIS_MODES: { id: AxisMode; label: string; title: string }[] = [
  { id: 'dual', label: 'Dual Axis', title: 'Two Y axes, grouped by unit — values stay real' },
  { id: 'shared', label: 'Single Axis', title: 'One shared Y axis for every series' },
  { id: 'normalize', label: 'Normalize %', title: 'Each series scaled to 0–100% of its own range' },
]

interface Row {
  param_key: string
  value: number
  taken_at: string
  v_min?: number
  v_max?: number
  n?: number
}

interface ParamStat {
  key: string
  label: string
  unit: string
  color: string
  current: number | null
  min: number | null
  max: number | null
  avg: number | null
  delta: number | null
  stdDev: number | null
  warnThresh?: number
  critThresh?: number
  status: 'healthy' | 'warning' | 'critical'
}

export default function ChartAnalysisModal({
  nodeId,
  orgId,
  domain,
  chart,
  availableParams,
  canConfigure,
  onClose,
  onEdit,
}: {
  nodeId: string
  orgId?: string
  domain: SensorDomain
  chart: ChartDefinition
  availableParams: AvailableParam[]
  canConfigure: boolean
  onClose: () => void
  onEdit?: () => void
}) {
  const live = useIsLive()
  const rules = useAlarmDB((s) => s.rules)
  const nodeRule = rules[nodeId]

  const [quick, setQuick] = useState<string>('24h')
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null)
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [axisMode, setAxisMode] = useState<AxisMode>('dual')
  const [showBrush, setShowBrush] = useState(true)
  const [showThresholds, setShowThresholds] = useState(true)
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())

  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())

  const paramByKey = useMemo(() => {
    const m = new Map<string, AvailableParam>()
    for (const p of availableParams) m.set(p.key, p)
    return m
  }, [availableParams])

  const nameOf = useCallback((key: string) => {
    const p = paramByKey.get(key)
    return p ? p.label : key
  }, [paramByKey])

  const unitOf = useCallback((key: string) => {
    return paramByKey.get(key)?.unit ?? ''
  }, [paramByKey])

  // Load data for the chosen window
  const loadData = useCallback(() => {
    let cancelled = false
    setLoading(true)

    let fromMs: number
    let toMs: number

    if (customRange) {
      fromMs = fromDisplayInput(customRange.from)
      toMs = fromDisplayInput(customRange.to)
    } else {
      const q = QUICK.find((x) => x.id === quick) ?? QUICK[2]
      toMs = Date.now()
      fromMs = toMs - q.minutes * 60_000
    }

    const bucketSec = Math.max(60, Math.floor((toMs - fromMs) / 1000 / 300))
    const fromISO = new Date(fromMs).toISOString()
    const toISO = new Date(toMs).toISOString()

    api.readingsWindow(nodeId, fromISO, toISO, bucketSec, chart.paramKeys.join(','))
      .then((res) => {
        if (cancelled) return
        setRows((res ?? []) as Row[])
        setLastRefreshed(new Date())
      })
      .catch((err) => {
        if (!cancelled) toast.error('Failed to load chart telemetry data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [nodeId, chart.paramKeys, quick, customRange])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Map rows by timestamp into chart points
  const { data, rawByTime } = useMemo(() => {
    const byTime = new Map<string, Record<string, any>>()
    const rawMap = new Map<string, Record<string, number>>()

    const q = QUICK.find((x) => x.id === quick)
    const minutes = customRange
      ? (fromDisplayInput(customRange.to) - fromDisplayInput(customRange.from)) / 60_000
      : (q?.minutes ?? 1440)
    const spanHours = minutes / 60

    for (const r of rows ?? []) {
      const ts = new Date(r.taken_at).getTime()
      const timeLabel = spanHours > 36 ? fmtDayMonth(r.taken_at) : fmtHM(r.taken_at)
      const fullTime = fmtDateTime(r.taken_at)

      const row = byTime.get(r.taken_at) ?? {
        time: timeLabel,
        fullTime,
        taken_at: r.taken_at,
        ts,
      }
      row[r.param_key] = Number(r.value)
      byTime.set(r.taken_at, row)

      const rawRow = rawMap.get(r.taken_at) ?? {}
      rawRow[r.param_key] = Number(r.value)
      rawMap.set(r.taken_at, rawRow)
    }

    const sorted = Array.from(byTime.values()).sort((a, b) => a.ts - b.ts)
    return { data: sorted, rawByTime: rawMap }
  }, [rows, quick, customRange])

  // Axis determination (dual axis groups by unit, or splits series if same unit)
  const axisOf = useMemo(() => {
    const m = new Map<string, 'L' | 'R'>()
    if (axisMode !== 'dual') {
      chart.paramKeys.forEach((k) => m.set(k, 'L'))
      return m
    }
    const distinctUnits = new Set(chart.paramKeys.map((k) => unitOf(k)))
    if (distinctUnits.size > 1) {
      let leftUnit: string | null = null
      for (const k of chart.paramKeys) {
        const unit = unitOf(k)
        if (leftUnit === null) leftUnit = unit
        m.set(k, unit === leftUnit ? 'L' : 'R')
      }
    } else {
      // All have the same unit: assign 1st param to Left, and remaining to Right
      chart.paramKeys.forEach((k, idx) => {
        m.set(k, idx === 0 ? 'L' : 'R')
      })
    }
    return m
  }, [axisMode, chart.paramKeys, unitOf])

  const usesRightAxis = axisMode === 'dual' && Array.from(axisOf.values()).includes('R')
  const leftKey = chart.paramKeys.find((k) => axisOf.get(k) === 'L')
  const rightKey = chart.paramKeys.find((k) => axisOf.get(k) === 'R')
  const leftColor = usesRightAxis && leftKey ? PALETTE[chart.paramKeys.indexOf(leftKey) % PALETTE.length] : '#64748b'
  const rightColor = usesRightAxis && rightKey ? PALETTE[chart.paramKeys.indexOf(rightKey) % PALETTE.length] : '#64748b'

  // Min / Max ranges per series for normalization and stats
  const ranges = useMemo(() => {
    const m = new Map<string, { min: number; max: number; avg: number; count: number; sum: number; values: number[] }>()
    for (const k of chart.paramKeys) {
      let min = Infinity, max = -Infinity, sum = 0, count = 0
      const values: number[] = []
      for (const d of data) {
        const v = d[k]
        if (typeof v !== 'number' || Number.isNaN(v)) continue
        if (v < min) min = v
        if (v > max) max = v
        sum += v
        count++
        values.push(v)
      }
      if (count > 0 && Number.isFinite(min) && Number.isFinite(max)) {
        m.set(k, { min, max, avg: sum / count, count, sum, values })
      }
    }
    return m
  }, [data, chart.paramKeys])

  // Calculate deep stats for each parameter
  const stats: ParamStat[] = useMemo(() => {
    return chart.paramKeys.map((key, i) => {
      const r = ranges.get(key)
      const color = PALETTE[i % PALETTE.length]
      const label = nameOf(key)
      const unit = unitOf(key)

      // Find threshold in alarm_rules if any
      const paramRule = nodeRule?.params?.find((p: any) => p.key === key)
      const warnThresh = paramRule?.warn
      const critThresh = paramRule?.critical

      if (!r || r.count === 0) {
        return {
          key, label, unit, color,
          current: null, min: null, max: null, avg: null, delta: null, stdDev: null,
          warnThresh, critThresh, status: 'healthy',
        }
      }

      // Latest reading
      const lastPoint = [...data].reverse().find((d) => typeof d[key] === 'number')
      const current = lastPoint ? Number(lastPoint[key]) : null

      // Standard deviation
      const avg = r.avg
      const variance = r.values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / r.count
      const stdDev = Math.sqrt(variance)
      const delta = r.max - r.min

      let status: 'healthy' | 'warning' | 'critical' = 'healthy'
      if (current !== null) {
        if (critThresh != null && current >= critThresh) status = 'critical'
        else if (warnThresh != null && current >= warnThresh) status = 'warning'
      }

      return {
        key, label, unit, color, current,
        min: r.min, max: r.max, avg, delta, stdDev,
        warnThresh, critThresh, status,
      }
    })
  }, [chart.paramKeys, ranges, data, nameOf, unitOf, nodeRule])

  // Normalized data for % mode
  const plotted = useMemo(() => {
    if (axisMode !== 'normalize') return data
    return data.map((d) => {
      const out: Record<string, any> = { time: d.time, fullTime: d.fullTime, ts: d.ts }
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

  // Toggle series visibility
  const toggleSeries = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else {
        // Don't hide all series
        if (next.size < chart.paramKeys.length - 1) next.add(key)
      }
      return next
    })
  }

  // Export CSV
  const handleExportCSV = () => {
    if (!data.length) {
      toast.error('No data available to export')
      return
    }
    const headers = ['Timestamp', 'Date & Time', ...chart.paramKeys.map((k) => `${nameOf(k)}${unitOf(k) ? ` (${unitOf(k)})` : ''}`)]
    const exportRows = data.map((d) => [
      d.taken_at || new Date(d.ts).toISOString(),
      d.fullTime || '',
      ...chart.paramKeys.map((k) => {
        const v = axisMode === 'normalize' ? d[`${k}__raw`] : d[k]
        return v != null ? String(v) : ''
      }),
    ])
    const safeTitle = chart.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    downloadCSV(`${nodeId}-${safeTitle}-${quick}.csv`, headers, exportRows)
    toast.success('CSV dataset downloaded')
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4"
      style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[95vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={surface}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <TrendingUp size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">{chart.title}</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                  Visualizer & Analysis Studio
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Multi-parameter correlation, historical telemetry trends, and threshold diagnostics ({DISPLAY_TZ_LABEL})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={!data.length}
              title="Download Telemetry CSV"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-40 transition-colors"
              style={inset}
            >
              <Download size={13} /> <span className="hidden sm:inline">Export CSV</span>
            </button>
            {canConfigure && onEdit && (
              <button
                onClick={onEdit}
                title="Edit parameters & thresholds"
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 border border-indigo-500/20 transition-colors"
              >
                <Pencil size={13} /> <span className="hidden sm:inline">Edit Chart</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar & Controls Bar */}
        <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Time Range Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-slate-500 mr-1 flex items-center gap-1">
              <Calendar size={12} /> Window:
            </span>
            {QUICK.map((q) => (
              <button
                key={q.id}
                onClick={() => { setQuick(q.id); setCustomRange(null); setShowCustomPicker(false) }}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                  quick === q.id && !customRange
                    ? 'text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                style={quick === q.id && !customRange ? { background: '#6366f1' } : inset}
              >
                {q.label}
              </button>
            ))}
            <button
              onClick={() => setShowCustomPicker(!showCustomPicker)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                customRange ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              style={customRange ? { background: '#6366f1' } : inset}
            >
              Custom Range
            </button>
          </div>

          {/* Visualization Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Axis Modes */}
            {chart.paramKeys.length > 1 && (
              <div className="flex items-center gap-1 p-0.5 rounded-lg" style={inset}>
                {AXIS_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setAxisMode(m.id)}
                    title={m.title}
                    className={`text-[11px] px-2 py-1 rounded font-medium transition-colors ${
                      axisMode === m.id ? 'text-white bg-slate-700' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* Toggle Thresholds */}
            <button
              onClick={() => setShowThresholds(!showThresholds)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                showThresholds
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-slate-800 text-slate-500'
              }`}
              title="Toggle Warning / Critical threshold lines"
            >
              Thresholds
            </button>

            {/* Toggle View: Chart vs Raw Table */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg" style={inset}>
              <button
                onClick={() => setViewMode('chart')}
                className={`p-1 rounded ${viewMode === 'chart' ? 'text-white bg-slate-700' : 'text-slate-500'}`}
                title="Chart View"
              >
                <LineChartIcon size={14} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1 rounded ${viewMode === 'table' ? 'text-white bg-slate-700' : 'text-slate-500'}`}
                title="Raw Telemetry Table"
              >
                <TableIcon size={14} />
              </button>
            </div>

            {/* Reload Button */}
            <button
              onClick={loadData}
              disabled={loading}
              title="Refresh telemetry readings"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
              style={inset}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-400' : ''} />
            </button>
          </div>
        </div>

        {/* Custom Range Picker Drawer */}
        {showCustomPicker && (
          <div className="px-5 py-3 bg-slate-900 border-b border-slate-800 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-400">Start:</span>
            <input
              type="datetime-local"
              defaultValue={customRange?.from || toDisplayInput(Date.now() - 24 * 3600000)}
              id="chart-from-dt"
              className="text-xs rounded-md px-2.5 py-1 text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            />
            <span className="text-xs text-slate-400">End:</span>
            <input
              type="datetime-local"
              defaultValue={customRange?.to || toDisplayInput(Date.now())}
              id="chart-to-dt"
              className="text-xs rounded-md px-2.5 py-1 text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            />
            <button
              onClick={() => {
                const f = (document.getElementById('chart-from-dt') as HTMLInputElement)?.value
                const t = (document.getElementById('chart-to-dt') as HTMLInputElement)?.value
                if (!f || !t) return
                setCustomRange({ from: f, to: t })
                setQuick('custom')
                setShowCustomPicker(false)
              }}
              className="text-xs px-3 py-1 rounded-md text-white font-medium shadow"
              style={{ background: '#6366f1' }}
            >
              Apply Range
            </button>
          </div>
        )}

        {/* Modal Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {viewMode === 'chart' ? (
            <>
              {/* Main Visualizer Chart Area */}
              <div className="rounded-xl p-4 relative" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                {loading && (
                  <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[11px] text-indigo-400 bg-slate-900/80 px-2 py-1 rounded border border-indigo-500/20">
                    <RefreshCw size={11} className="animate-spin" /> Updating series…
                  </div>
                )}

                {!data.length ? (
                  <div className="h-[360px] flex flex-col items-center justify-center text-slate-500 space-y-2">
                    <Activity size={28} className="text-slate-600 animate-pulse" />
                    <p className="text-sm font-medium">No stored telemetry points in this time range</p>
                    <p className="text-xs text-slate-600">Try widening the window or selecting another date.</p>
                  </div>
                ) : (
                  <div>
                    <ResponsiveContainer width="100%" height={380}>
                      <LineChart data={plotted} margin={{ top: 10, right: usesRightAxis ? 10 : 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                        <XAxis
                          dataKey="time"
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: '#1e2433' }}
                          interval="preserveStartEnd"
                          minTickGap={32}
                        />
                        <YAxis
                          yAxisId="L"
                          tick={{ fill: leftColor, fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: usesRightAxis ? leftColor : '#1e2433' }}
                          domain={axisMode === 'normalize' ? [0, 100] : ['auto', 'auto']}
                          tickFormatter={axisMode === 'normalize' ? (v) => `${v}%` : undefined}
                        />
                        {usesRightAxis && (
                          <YAxis
                            yAxisId="R"
                            orientation="right"
                            tick={{ fill: rightColor, fontSize: 11 }}
                            tickLine={false}
                            axisLine={{ stroke: rightColor }}
                            domain={['auto', 'auto']}
                          />
                        )}

                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelStyle={{ color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}
                          formatter={(value: any, name: string, item: any) => {
                            const key = String(item?.dataKey ?? '')
                            const raw = item?.payload?.[`${key}__raw`]
                            const unit = unitOf(key)
                            if (axisMode === 'normalize') {
                              const pct = typeof value === 'number' ? `${value.toFixed(1)}%` : String(value)
                              return [typeof raw === 'number' ? `${raw}${unit ? ` ${unit}` : ''} (${pct})` : pct, name]
                            }
                            return [typeof value === 'number' ? `${value.toFixed(2)}${unit ? ` ${unit}` : ''}` : String(value), name]
                          }}
                          labelFormatter={(label, payload) => {
                            const fullTime = payload?.[0]?.payload?.fullTime
                            return fullTime || label
                          }}
                        />

                        <Legend
                          wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                          onClick={(e) => {
                            if (e && e.dataKey) toggleSeries(String(e.dataKey))
                          }}
                        />

                        {/* Threshold Reference Lines */}
                        {showThresholds && axisMode !== 'normalize' && stats.map((s) => (
                          <g key={`thresh-${s.key}`}>
                            {s.critThresh != null && (
                              <ReferenceLine
                                yAxisId={usesRightAxis ? (axisOf.get(s.key) ?? 'L') : 'L'}
                                y={s.critThresh}
                                stroke="#ef4444"
                                strokeDasharray="4 4"
                                label={{
                                  value: `Crit ${s.critThresh}${s.unit}`,
                                  fill: '#ef4444',
                                  fontSize: 10,
                                  position: 'insideTopRight',
                                }}
                              />
                            )}
                            {s.warnThresh != null && (
                              <ReferenceLine
                                yAxisId={usesRightAxis ? (axisOf.get(s.key) ?? 'L') : 'L'}
                                y={s.warnThresh}
                                stroke="#f59e0b"
                                strokeDasharray="3 3"
                                label={{
                                  value: `Warn ${s.warnThresh}${s.unit}`,
                                  fill: '#f59e0b',
                                  fontSize: 10,
                                  position: 'insideBottomRight',
                                }}
                              />
                            )}
                          </g>
                        ))}

                        {/* Parameter Series Lines */}
                        {chart.paramKeys.map((key, i) => {
                          const isHidden = hiddenKeys.has(key)
                          const color = PALETTE[i % PALETTE.length]
                          return (
                            <Line
                              key={key}
                              yAxisId={usesRightAxis ? (axisOf.get(key) ?? 'L') : 'L'}
                              type="monotone"
                              dataKey={key}
                              stroke={color}
                              strokeWidth={2}
                              dot={false}
                              name={`${nameOf(key)}${unitOf(key) ? ` (${unitOf(key)})` : ''}`}
                              hide={isHidden}
                              connectNulls
                              isAnimationActive={false}
                            />
                          )
                        })}

                        {/* Micro-Investigation Brush Slider */}
                        {showBrush && (
                          <Brush
                            dataKey="time"
                            height={28}
                            stroke="#6366f1"
                            fill="#0d1117"
                            tickFormatter={() => ''}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Statistical Metrics Deck */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={13} className="text-indigo-400" />
                    Parameter Statistical Insights
                  </div>
                  <span className="text-[11px] text-slate-500">Calculated over {data.length} telemetry samples</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stats.map((s) => (
                    <div
                      key={s.key}
                      className="rounded-xl p-3.5 transition-all border"
                      style={{
                        background: '#0d1117',
                        borderColor: hiddenKeys.has(s.key) ? '#1e2433' : '#2d3748',
                        opacity: hiddenKeys.has(s.key) ? 0.5 : 1,
                      }}
                    >
                      {/* Metric Header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                          <span className="text-xs font-bold text-slate-200 truncate">{s.label}</span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            s.status === 'critical'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : s.status === 'warning'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>

                      {/* Current Reading Hero */}
                      <div className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-2xl font-black text-white">
                          {s.current != null ? s.current.toFixed(2) : '—'}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">{s.unit}</span>
                        <span className="text-[10px] text-slate-500 ml-auto">Latest</span>
                      </div>

                      {/* Metrics 4-Box Grid */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] pt-2.5 border-t border-slate-800/80">
                        <div className="p-1.5 rounded bg-slate-950/60">
                          <div className="text-[10px] text-slate-500">Min</div>
                          <div className="font-semibold text-slate-300">
                            {s.min != null ? `${s.min.toFixed(2)} ${s.unit}` : '—'}
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/60">
                          <div className="text-[10px] text-slate-500">Max</div>
                          <div className="font-semibold text-slate-300">
                            {s.max != null ? `${s.max.toFixed(2)} ${s.unit}` : '—'}
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/60">
                          <div className="text-[10px] text-slate-500">Mean (Avg)</div>
                          <div className="font-semibold text-indigo-300">
                            {s.avg != null ? `${s.avg.toFixed(2)} ${s.unit}` : '—'}
                          </div>
                        </div>
                        <div className="p-1.5 rounded bg-slate-950/60">
                          <div className="text-[10px] text-slate-500">Delta (Δ Span)</div>
                          <div className="font-semibold text-slate-300">
                            {s.delta != null ? `${s.delta.toFixed(2)} ${s.unit}` : '—'}
                          </div>
                        </div>
                      </div>

                      {/* Threshold info if exists */}
                      {(s.warnThresh != null || s.critThresh != null) && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                          <span>Thresholds:</span>
                          <span className="flex items-center gap-2">
                            {s.warnThresh != null && <span className="text-amber-400">Warn ≥ {s.warnThresh}</span>}
                            {s.critThresh != null && <span className="text-red-400">Crit ≥ {s.critThresh}</span>}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Raw Telemetry Data Table View */
            <div className="rounded-xl overflow-hidden border border-slate-800" style={{ background: '#0a0e1a' }}>
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <span className="text-xs font-semibold text-white">Recorded Telemetry Samples ({data.length} rows)</span>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  <Download size={12} /> Download CSV
                </button>
              </div>

              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 sticky top-0 z-10">
                      <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                      {chart.paramKeys.map((k, i) => (
                        <th key={k} className="py-2.5 px-4 font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                            {nameOf(k)} {unitOf(k) ? `(${unitOf(k)})` : ''}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {data.map((d, i) => (
                      <tr key={i} className="hover:bg-slate-800/40 transition-colors text-slate-300">
                        <td className="py-2 px-4 text-slate-400 font-sans">{d.fullTime || d.time}</td>
                        {chart.paramKeys.map((k) => {
                          const val = axisMode === 'normalize' ? d[`${k}__raw`] : d[k]
                          return (
                            <td key={k} className="py-2 px-4 font-semibold text-white">
                              {val != null && typeof val === 'number' ? val.toFixed(2) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-500">
          <div>
            Last updated: <span className="text-slate-400">{lastRefreshed.toLocaleTimeString()}</span> · Multi-series downsampling active
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  )
}
