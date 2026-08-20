'use client'

// ---------------------------------------------------------------------------
// Customer Trends — compare ONE parameter across SEVERAL devices.
// ---------------------------------------------------------------------------
// Scoped to the customer's signed-in organization and accessible products.
// Multi-device parameter visualizer with advanced layout modes:
// 1. Combined View: Single shared-axis chart with interactive line isolation
// 2. Split Stacked View: Separate row per device with synced time-axis (no overlap)
// 3. Grid View: Side-by-side comparative cards
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useSessionOrgId } from '@/lib/auth'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { viewerDomains } from '@/lib/viewer'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Brush, AreaChart, Area,
} from 'recharts'
import {
  Loader2, Download, Check, Layers, LayoutGrid, Rows, TrendingUp, Activity, Sparkles, Calendar, RefreshCw
} from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)' }

const RANGES = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '6h', label: '6 hours', minutes: 360 },
  { id: '24h', label: '24 hours', minutes: 1440 },
  { id: '7d', label: '7 days', minutes: 10080 },
  { id: '30d', label: '30 days', minutes: 43200 },
] as const

type LayoutMode = 'combined' | 'split' | 'grid'

const LINE_COLORS = ['#6366f1', '#22d3ee', '#f97316', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']
const MAX_DEVICES = 8
const MAX_POINTS = 300

interface Row { param_key: string; value: number; taken_at: string; n?: number }
interface Loaded { id: string; name: string; rows: Row[] }

const toUTC = (ms: number) => new Date(ms).toISOString()

function customerDeviceDetailRoute(domain: SensorDomain, id: string): string {
  return domain === 'transformer' ? `/customer/transformers/detail?id=${encodeURIComponent(id)}` : `/customer/devices/detail?id=${encodeURIComponent(id)}`
}

function TrendsLegend({
  payload, focusId, hiddenIds, onFocus, onToggleHidden,
}: {
  payload?: { value?: string; dataKey?: unknown; color?: string }[]
  focusId: string | null
  hiddenIds: Set<string>
  onFocus: (id: string | null) => void
  onToggleHidden: (id: string) => void
}) {
  if (!payload?.length) return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-2" role="group" aria-label="Devices — click to hide, hover to isolate">
      {payload.map((entry) => {
        const id = String(entry.dataKey ?? entry.value ?? '')
        const hidden = hiddenIds.has(id)
        const active = focusId === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggleHidden(id)}
            onMouseEnter={() => !hidden && onFocus(id)}
            onMouseLeave={() => onFocus(null)}
            title={hidden ? `${entry.value} — hidden, click to show` : `${entry.value} — click to hide, hover to isolate`}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-all border"
            style={{
              opacity: hidden ? 0.4 : 1,
              background: active ? 'rgba(99,102,241,0.15)' : '#0a0e1a',
              borderColor: active ? '#6366f1' : '#1e2433',
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: entry.color, opacity: hidden ? 0.3 : 1 }}
            />
            <span className={`text-xs ${hidden ? 'line-through text-slate-500' : 'text-slate-300 font-medium'}`}>
              {entry.value}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function CustomerTrendsPage() {
  const live = useIsLive()
  const orgId = useSessionOrgId()
  const { viewerUserId } = useAppStore()
  const allowed = viewerDomains(viewerUserId)

  const { devices } = useManagedDevices(orgId)

  const [domain, setDomain] = useState<SensorDomain>('transformer')
  const [paramKey, setParamKey] = useState('oilTemp')
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('24h')
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null)
  const [showCustomPicker, setShowCustomPicker] = useState(false)

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('combined')
  const [showThresholds, setShowThresholds] = useState(true)
  const [showBrush, setShowBrush] = useState(true)

  const [picked, setPicked] = useState<string[]>([])
  const [loaded, setLoaded] = useState<Loaded[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [win, setWin] = useState({ from: Date.now() - 1440 * 60_000, to: Date.now() })

  const [focusId, setFocusId] = useState<string | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  const schema = ALARM_SCHEMA[domain]
  const param = schema.params.find((p) => p.key === paramKey) ?? schema.params[0]
  const minutes = customRange
    ? (fromDisplayInput(customRange.to) - fromDisplayInput(customRange.from)) / 60_000
    : (RANGES.find((r) => r.id === rangeId)?.minutes ?? 1440)

  // Scope candidates to viewer's accessible domains
  const candidates = useMemo(() => {
    return devices.filter((d) => d.domain === domain && (!allowed.length || allowed.includes(d.domain as SensorDomain)))
  }, [devices, domain, allowed])

  const domainsPresent = useMemo(() => {
    const set = new Set(
      devices
        .map((d) => d.domain)
        .filter((d): d is SensorDomain => Boolean(d) && (!allowed.length || allowed.includes(d as SensorDomain)))
    )
    return set.size ? Array.from(set) : (['transformer'] as SensorDomain[])
  }, [devices, allowed])

  useEffect(() => {
    if (!domainsPresent.includes(domain)) {
      const next = domainsPresent[0]
      setDomain(next)
      setParamKey(ALARM_SCHEMA[next].params[0]?.key ?? '')
    }
  }, [domainsPresent, domain])

  useEffect(() => {
    setPicked((cur) => {
      const stillValid = cur.filter((id) => candidates.some((d) => d.id === id))
      if (stillValid.length) return stillValid
      return candidates.slice(0, 3).map((d) => d.id)
    })
  }, [candidates])

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id)
      ? cur.filter((x) => x !== id)
      : cur.length >= MAX_DEVICES ? cur : [...cur, id]))

  useEffect(() => {
    setHiddenIds((cur) => {
      const next = new Set(Array.from(cur).filter((id) => picked.includes(id)))
      return next.size === cur.size ? cur : next
    })
    setFocusId((cur) => (cur && !picked.includes(cur) ? null : cur))
  }, [picked])

  const toggleHidden = (id: string) =>
    setHiddenIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const load = useCallback(() => {
    if (!live || !picked.length || !paramKey) { setLoaded(null); return }
    let cancelled = false
    setLoading(true)

    let to: number
    let from: number

    if (customRange) {
      from = fromDisplayInput(customRange.from)
      to = fromDisplayInput(customRange.to)
    } else {
      to = Date.now()
      from = to - minutes * 60_000
    }

    const bucketSec = Math.max(60, Math.floor(((to - from) / 1000) / MAX_POINTS))

    Promise.all(picked.map((id) =>
      api.readingsWindow(id, toUTC(from), toUTC(to), bucketSec, paramKey)
        .then((rows) => ({ id, name: devices.find((d) => d.id === id)?.name ?? id, rows: (rows ?? []) as Row[] }))))
      .then((res) => { if (!cancelled) { setLoaded(res); setWin({ from, to }) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [live, picked, paramKey, minutes, devices, customRange])

  useEffect(() => { load() }, [load])

  // Merge into one row per bucket: { ts, [deviceId]: value }
  const data = useMemo(() => {
    if (!loaded) return []
    const byTs = new Map<number, Record<string, any>>()
    for (const d of loaded) {
      for (const r of d.rows) {
        const ts = new Date(r.taken_at).getTime()
        if (Number.isNaN(ts)) continue
        const slot = byTs.get(ts) ?? { ts, fullTime: fmtDateTime(ts), time: (win.to - win.from > 36 * 3600000) ? fmtDayMonth(ts) : fmtHM(ts) }
        slot[d.id] = Number(r.value)
        byTs.set(ts, slot)
      }
    }
    return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts)
  }, [loaded, win])

  // Per-device statistics
  const stats = useMemo(() => (loaded ?? []).map((d) => {
    if (!d.rows.length) return { id: d.id, name: d.name, n: 0, min: null as number | null, avg: null as number | null, max: null as number | null, last: null as number | null, delta: null as number | null }
    let min = Infinity, max = -Infinity, sum = 0, n = 0
    for (const r of d.rows) {
      const w = r.n ?? 1
      const v = Number(r.value)
      min = Math.min(min, v); max = Math.max(max, v); sum += v * w; n += w
    }
    return {
      id: d.id,
      name: d.name,
      n,
      min,
      avg: sum / n,
      max,
      delta: max - min,
      last: Number(d.rows[d.rows.length - 1].value),
    }
  }), [loaded])

  // Fleet-wide summary metrics
  const fleetSummary = useMemo(() => {
    const validStats = stats.filter((s) => s.avg !== null)
    if (!validStats.length) return null
    const fleetAvg = validStats.reduce((acc, s) => acc + (s.avg ?? 0), 0) / validStats.length
    const maxDevice = [...validStats].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
    const minDevice = [...validStats].sort((a, b) => (a.last ?? 0) - (b.last ?? 0))[0]
    return { fleetAvg, maxDevice, minDevice }
  }, [stats])

  const spanMs = win.to - win.from
  const fmtTick = (ts: number) => (spanMs > 36 * 3600_000 ? fmtDayMonth(ts) : fmtHM(ts))

  const exportCsv = () => {
    downloadCSV(
      `compare_${paramKey}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Timestamp', 'Date & Time', ...picked.map((id) => devices.find((d) => d.id === id)?.name ?? id)],
      data.map((row) => [new Date(row.ts).toISOString(), fmtDateTime(row.ts), ...picked.map((id) => (row as Record<string, number>)[id] ?? '')]),
    )
    toast.success('Comparison dataset downloaded')
  }

  const anyData = data.length > 0
  const emptyDevices = stats.filter((s) => s.n === 0)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">Compare Devices</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
              Fleet Analysis
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Synchronized multi-device telemetry comparison across the same parameter ({DISPLAY_TZ_LABEL})
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-indigo-400" />}
          <button
            onClick={exportCsv}
            disabled={!anyData}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-slate-300 hover:text-white disabled:opacity-40 transition-colors"
            style={surface}
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter Controls Card */}
      <div className="rounded-xl p-4 space-y-3.5" style={surface}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {domainsPresent.length > 1 && (
              <select
                value={domain}
                onChange={(e) => {
                  const d = e.target.value as SensorDomain
                  setDomain(d)
                  setParamKey(ALARM_SCHEMA[d].params[0]?.key ?? '')
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                style={inset}
              >
                {domainsPresent.map((d) => <option key={d} value={d}>{DOMAIN_META[d].label}</option>)}
              </select>
            )}

            <select
              value={paramKey}
              onChange={(e) => setParamKey(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
              style={inset}
            >
              {schema.params.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit && ` (${p.unit})`}</option>)}
            </select>

            {/* Quick Time Range Selector */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg" style={inset}>
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { setRangeId(r.id); setCustomRange(null); setShowCustomPicker(false) }}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                    rangeId === r.id && !customRange ? 'text-white bg-indigo-600' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={() => setShowCustomPicker(!showCustomPicker)}
                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                  customRange ? 'text-white bg-indigo-600' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Layout Mode Switcher */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-800" style={inset}>
            <button
              onClick={() => setLayoutMode('combined')}
              title="Combined Overlay View (All devices on single chart)"
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                layoutMode === 'combined' ? 'text-white bg-slate-700' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers size={13} /> Overlay
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              title="Split Stacked View (Row per device - eliminates line overlap!)"
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                layoutMode === 'split' ? 'text-white bg-indigo-600' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Rows size={13} /> Split Rows
            </button>
            <button
              onClick={() => setLayoutMode('grid')}
              title="Grid Matrix View (Side-by-side cards)"
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                layoutMode === 'grid' ? 'text-white bg-slate-700' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid size={13} /> Grid
            </button>
          </div>
        </div>

        {/* Custom DateTime Range Drawer */}
        {showCustomPicker && (
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-3 flex-wrap text-xs">
            <span className="text-slate-400">Start:</span>
            <input
              type="datetime-local"
              defaultValue={customRange?.from || toDisplayInput(Date.now() - 24 * 3600000)}
              id="cust-trends-from-dt"
              className="rounded-md px-2 py-1 text-slate-200 outline-none"
              style={inset}
            />
            <span className="text-slate-400">End:</span>
            <input
              type="datetime-local"
              defaultValue={customRange?.to || toDisplayInput(Date.now())}
              id="cust-trends-to-dt"
              className="rounded-md px-2 py-1 text-slate-200 outline-none"
              style={inset}
            />
            <button
              onClick={() => {
                const f = (document.getElementById('cust-trends-from-dt') as HTMLInputElement)?.value
                const t = (document.getElementById('cust-trends-to-dt') as HTMLInputElement)?.value
                if (!f || !t) return
                setCustomRange({ from: f, to: t })
                setShowCustomPicker(false)
              }}
              className="px-3 py-1 rounded-md text-white font-medium shadow"
              style={{ background: '#6366f1' }}
            >
              Apply Window
            </button>
          </div>
        )}

        {/* Device Selection Chips */}
        <div>
          <div className="text-[11px] text-slate-500 mb-1.5 flex items-center justify-between">
            <span>Select devices to compare ({picked.length}/{MAX_DEVICES}):</span>
            <span className="text-[10px] text-slate-600">Click to toggle device</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.length === 0 && (
              <span className="text-xs text-slate-600">No devices available for this category in your access permissions.</span>
            )}
            {candidates.map((d) => {
              const on = picked.includes(d.id)
              const color = LINE_COLORS[picked.indexOf(d.id) % LINE_COLORS.length]
              const full = !on && picked.length >= MAX_DEVICES
              return (
                <button
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  disabled={full}
                  title={full ? `Deselect one first — ${MAX_DEVICES} devices maximum` : d.location}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40"
                  style={on
                    ? { background: `${color}22`, border: `1px solid ${color}`, color: '#ffffff' }
                    : { ...inset, color: '#94a3b8' }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: on ? color : '#475569' }}
                  />
                  {d.name}
                  {on && <Check size={12} style={{ color }} />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Fleet Executive Summary Deck */}
      {fleetSummary && anyData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Fleet Mean (Avg)</div>
              <div className="text-lg font-bold text-white mt-0.5">
                {fleetSummary.fleetAvg.toFixed(2)} {param?.unit}
              </div>
            </div>
            <Activity size={20} className="text-indigo-400" />
          </div>

          <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Peak Active Device</div>
              <div className="text-sm font-bold text-amber-300 mt-0.5 truncate max-w-[180px]">
                {fleetSummary.maxDevice.name} ({fleetSummary.maxDevice.last?.toFixed(2)} {param?.unit})
              </div>
            </div>
            <TrendingUp size={20} className="text-amber-400" />
          </div>

          <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Lowest Active Device</div>
              <div className="text-sm font-bold text-emerald-300 mt-0.5 truncate max-w-[180px]">
                {fleetSummary.minDevice.name} ({fleetSummary.minDevice.last?.toFixed(2)} {param?.unit})
              </div>
            </div>
            <Sparkles size={20} className="text-emerald-400" />
          </div>
        </div>
      )}

      {/* Main Chart Section */}
      <div className="rounded-xl p-4 sm:p-5 space-y-4" style={surface}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">
              {param?.label}{param?.unit && <span className="text-slate-400 font-normal"> ({param.unit})</span>}
            </h3>
            <span className="text-xs text-slate-500">· {data.length} telemetry points</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowThresholds(!showThresholds)}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                showThresholds ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-slate-800 text-slate-500'
              }`}
            >
              Thresholds
            </button>
          </div>
        </div>

        {!live ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-slate-600">
            Switch to Live mode to compare stored readings.
          </div>
        ) : !anyData ? (
          <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-center">
            <Activity size={32} className="text-slate-700 animate-pulse" />
            <p className="text-sm text-slate-400 font-medium">
              {loading ? 'Loading fleet telemetry readings…'
                : !picked.length ? 'Select at least one device above to begin comparison.'
                : `No stored ${param?.label.toLowerCase()} readings for the selected devices in this period.`}
            </p>
            {!loading && picked.length > 0 && (
              <p className="text-xs text-slate-600">Try widening the window or selecting another date range.</p>
            )}
          </div>
        ) : layoutMode === 'combined' ? (
          /* 1. Combined Overlay Chart */
          <div>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={[win.from, win.to]}
                  tickFormatter={(v) => fmtTick(Number(v))}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#1e2433' }}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#1e2433' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
                  labelFormatter={(v) => fmtDateTime(Number(v))}
                  itemSorter={(item) => (item.dataKey === focusId ? -1 : 0)}
                  formatter={(v: number | string, name: string, item: { dataKey?: string | number }) =>
                    hiddenIds.has(String(item?.dataKey)) ? [null, null] : [`${typeof v === 'number' ? v.toFixed(2) : v}${param?.unit ? ` ${param.unit}` : ''}`, name]}
                />
                <Legend
                  content={(props) => (
                    <TrendsLegend
                      {...props}
                      payload={picked.map((id, i) => ({
                        value: devices.find((d) => d.id === id)?.name ?? id,
                        dataKey: id,
                        color: LINE_COLORS[i % LINE_COLORS.length],
                      }))}
                      focusId={focusId}
                      hiddenIds={hiddenIds}
                      onFocus={setFocusId}
                      onToggleHidden={toggleHidden}
                    />
                  )}
                />
                {/* Alarm Thresholds */}
                {showThresholds && param && (
                  <>
                    <ReferenceLine y={param.warn} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} label={{ value: `Warn: ${param.warn}`, fill: '#f59e0b', fontSize: 10, position: 'insideBottomRight' }} />
                    <ReferenceLine y={param.critical} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: `Crit: ${param.critical}`, fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }} />
                  </>
                )}
                {/* Device Lines */}
                {picked
                  .map((id, i) => ({ id, color: LINE_COLORS[i % LINE_COLORS.length] }))
                  .sort((a, b) => (a.id === focusId ? 1 : b.id === focusId ? -1 : 0))
                  .map(({ id, color }) => {
                    const hidden = hiddenIds.has(id)
                    const dimmed = !hidden && focusId !== null && focusId !== id
                    return (
                      <Line
                        key={id}
                        type="monotone"
                        dataKey={id}
                        name={devices.find((d) => d.id === id)?.name ?? id}
                        stroke={color}
                        strokeWidth={focusId === id ? 3 : 2}
                        strokeOpacity={hidden ? 0 : dimmed ? 0.18 : 1}
                        dot={false}
                        activeDot={hidden ? false : { r: focusId === id ? 5 : 3 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    )
                  })}
                {showBrush && (
                  <Brush dataKey="ts" height={28} stroke="#6366f1" fill="#0d1117" tickFormatter={() => ''} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : layoutMode === 'split' ? (
          /* 2. Split Stacked Rows View — Separate chart per device */
          <div className="space-y-4">
            {picked.map((id, i) => {
              const dev = devices.find((d) => d.id === id)
              const color = LINE_COLORS[i % LINE_COLORS.length]
              const devStat = stats.find((s) => s.id === id)
              const isHidden = hiddenIds.has(id)
              if (isHidden) return null

              return (
                <div key={id} className="rounded-xl p-3.5 border border-slate-800" style={{ background: '#0a0e1a' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      <span className="text-xs font-bold text-white">{dev?.name ?? id}</span>
                      <span className="text-[11px] text-slate-500">· {dev?.location}</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span>Latest: <strong className="text-white">{devStat?.last != null ? `${devStat.last.toFixed(2)} ${param?.unit}` : '—'}</strong></span>
                      <span className="text-slate-400">Avg: <strong className="text-indigo-300">{devStat?.avg != null ? `${devStat.avg.toFixed(2)} ${param?.unit}` : '—'}</strong></span>
                      <span className="text-slate-400">Δ: <strong className="text-slate-300">{devStat?.delta != null ? `${devStat.delta.toFixed(2)} ${param?.unit}` : '—'}</strong></span>
                      <Link href={customerDeviceDetailRoute(domain, id)} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-sans">
                        Details →
                      </Link>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <defs>
                        <linearGradient id={`cust-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={[win.from, win.to]}
                        tickFormatter={(v) => fmtTick(Number(v))}
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        tickLine={false}
                        axisLine={{ stroke: '#1e2433' }}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        tickLine={false}
                        axisLine={{ stroke: '#1e2433' }}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: '#94a3b8' }}
                        labelFormatter={(v) => fmtDateTime(Number(v))}
                        formatter={(v: any) => [`${typeof v === 'number' ? v.toFixed(2) : v} ${param?.unit}`, dev?.name ?? id]}
                      />
                      {showThresholds && param && (
                        <>
                          <ReferenceLine y={param.warn} stroke="#f59e0b" strokeDasharray="3 3" />
                          <ReferenceLine y={param.critical} stroke="#ef4444" strokeDasharray="3 3" />
                        </>
                      )}
                      <Area
                        type="monotone"
                        dataKey={id}
                        stroke={color}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill={`url(#cust-grad-${id})`}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        ) : (
          /* 3. Grid Matrix View */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {picked.map((id, i) => {
              const dev = devices.find((d) => d.id === id)
              const color = LINE_COLORS[i % LINE_COLORS.length]
              const devStat = stats.find((s) => s.id === id)
              return (
                <div key={id} className="rounded-xl p-3.5 border border-slate-800" style={{ background: '#0a0e1a' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      <span className="text-xs font-bold text-white truncate max-w-[160px]">{dev?.name ?? id}</span>
                    </div>
                    <div className="text-xs font-mono font-bold text-white">
                      {devStat?.last != null ? `${devStat.last.toFixed(2)} ${param?.unit}` : '—'}
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                      <XAxis dataKey="ts" type="number" scale="time" domain={[win.from, win.to]} tickFormatter={(v) => fmtTick(Number(v))} tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDateTime(Number(v))} formatter={(v: any) => [`${Number(v).toFixed(2)} ${param?.unit}`, dev?.name ?? id]} />
                      {showThresholds && param && (
                        <>
                          <ReferenceLine y={param.warn} stroke="#f59e0b" strokeDasharray="3 3" />
                          <ReferenceLine y={param.critical} stroke="#ef4444" strokeDasharray="3 3" />
                        </>
                      )}
                      <Line type="monotone" dataKey={id} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-Device Statistical Metric Table */}
      {live && stats.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-slate-800" style={surface}>
          <div className="p-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" />
              Device Comparison Metrics
            </span>
            <span className="text-[11px] text-slate-500">Telemetry aggregated per device</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-xs">
                  <th className="text-left py-2.5 px-4 font-semibold">Device Name</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Data Points</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Min</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Average (Mean)</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Max</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Delta (Δ)</th>
                  <th className="text-left py-2.5 px-4 font-semibold">Latest</th>
                  <th className="text-right py-2.5 px-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                {stats.map((s, i) => {
                  const over = (v: number | null) => v !== null && param && (param.direction === 'high' ? v >= param.warn : v <= param.warn)
                  const crit = (v: number | null) => v !== null && param && (param.direction === 'high' ? v >= param.critical : v <= param.critical)
                  return (
                    <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-200">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: LINE_COLORS[picked.indexOf(s.id) % LINE_COLORS.length] }} />
                          {s.name}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400">{s.n.toLocaleString()}</td>
                      <td className="py-2.5 px-4 text-slate-300">{s.min === null ? '—' : s.min.toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-indigo-300 font-bold">{s.avg === null ? '—' : s.avg.toFixed(2)}</td>
                      <td className={`py-2.5 px-4 font-semibold ${crit(s.max) ? 'text-red-400' : over(s.max) ? 'text-amber-400' : 'text-slate-300'}`}>
                        {s.max === null ? '—' : s.max.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">{s.delta === null ? '—' : s.delta.toFixed(2)}</td>
                      <td className={`py-2.5 px-4 font-bold ${crit(s.last) ? 'text-red-400' : over(s.last) ? 'text-amber-400' : 'text-white'}`}>
                        {s.last === null ? '—' : s.last.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-sans">
                        <Link href={customerDeviceDetailRoute(domain, s.id)} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium">
                          Open Device →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {live && emptyDevices.length > 0 && anyData && (
        <p className="text-[11px] text-slate-500">
          * No readings stored in this period for: {emptyDevices.map((d) => d.name).join(', ')}.
        </p>
      )}
    </div>
  )
}
