'use client'

// ---------------------------------------------------------------------------
// Trends — compare ONE parameter across SEVERAL devices.
// ---------------------------------------------------------------------------
// Multi-device parameter visualizer with advanced layout modes:
// 1. Combined View: Single shared-axis chart with interactive line isolation
// 2. Split Stacked View: Separate row per device with synced time-axis (prevents overlap)
// 3. Grid View: Side-by-side comparative cards
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { sites as defaultSites } from '@/lib/fleetData'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Brush, AreaChart, Area, ComposedChart
} from 'recharts'
import {
  Loader2, Download, Check, Layers, LayoutGrid, Rows, TrendingUp, Activity, Sparkles, AlertTriangle, Calendar, RefreshCw, Eye, EyeOff, Building2, X,
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

/** High-contrast, distinguishable palette for up to 8 lines. */
const LINE_COLORS = ['#6366f1', '#22d3ee', '#f97316', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']
const MAX_DEVICES = 8
const MAX_POINTS = 300

interface Row { param_key: string; value: number; taken_at: string; n?: number }
interface Loaded { id: string; name: string; rows: Row[]; secRows?: Row[] }

const toUTC = (ms: number) => new Date(ms).toISOString()

function deviceDetailRoute(domain: SensorDomain, id: string): string {
  if (domain === 'transformer') return `/admin/transformers/detail?id=${encodeURIComponent(id)}`
  if (domain === 'automobile') return `/admin/automobile?id=${encodeURIComponent(id)}`
  return `/admin/nodes/detail?id=${encodeURIComponent(id)}`
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

function TrendsPageContent() {
  const searchParams = useSearchParams()
  const urlSiteId = searchParams.get('siteId')
  const urlDomain = searchParams.get('domain') as SensorDomain | null
  const urlParam = searchParams.get('param')
  const urlDevices = searchParams.get('devices')
  const urlRange = searchParams.get('range') as (typeof RANGES)[number]['id'] | null

  const live = useIsLive()
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = selectedOrgId || 'org-1'
  const { devices } = useManagedDevices(orgId)

  const [siteFilter, setSiteFilter] = useState<string>(urlSiteId || 'all')
  const [domain, setDomain] = useState<SensorDomain>(urlDomain || 'transformer')
  const [paramKey, setParamKey] = useState(urlParam || 'oilTemp')
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>(urlRange || '24h')
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null)
  const [showCustomPicker, setShowCustomPicker] = useState(false)

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('combined')
  const [showThresholds, setShowThresholds] = useState(true)
  const [showBrush, setShowBrush] = useState(true)

  const [dualAxis, setDualAxis] = useState(false)
  const [secondaryParam, setSecondaryParam] = useState('')
  const [showBaseline, setShowBaseline] = useState(false)
  const [showSigmaBands, setSigmaBands] = useState(false)

  const [picked, setPicked] = useState<string[]>(() => {
    if (urlDevices) {
      return urlDevices.split(',').filter(Boolean).slice(0, MAX_DEVICES)
    }
    return []
  })
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

  const candidates = useMemo(() => {
    return devices.filter((d) => {
      if (d.domain !== domain) return false
      if (siteFilter !== 'all' && d.siteId !== siteFilter) return false
      return true
    })
  }, [devices, domain, siteFilter])

  const availableSites = useMemo(() => {
    const siteMap = new Map<string, { id: string; name: string; count: number }>()
    devices.forEach((d) => {
      if (d.domain === domain && d.siteId) {
        const existing = siteMap.get(d.siteId)
        if (existing) {
          existing.count++
        } else {
          const meta = defaultSites.find((s) => s.id === d.siteId)
          siteMap.set(d.siteId, {
            id: d.siteId,
            name: meta?.name || d.siteId,
            count: 1,
          })
        }
      }
    })
    return Array.from(siteMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [devices, domain])

  const domainsPresent = useMemo(() => {
    const set = new Set(devices.map((d) => d.domain).filter(Boolean) as SensorDomain[])
    return set.size ? Array.from(set) : (['transformer'] as SensorDomain[])
  }, [devices])

  useEffect(() => {
    if (!domainsPresent.includes(domain)) {
      const next = domainsPresent[0]
      setDomain(next)
      setParamKey(ALARM_SCHEMA[next].params[0]?.key ?? '')
    }
  }, [domainsPresent, domain])

  // Sync schema changes if paramKey is not valid for domain
  useEffect(() => {
    if (!schema.params.some((p) => p.key === paramKey)) {
      setParamKey(schema.params[0]?.key ?? '')
    }
  }, [domain, schema, paramKey])

  useEffect(() => {
    setPicked((cur) => {
      const stillValid = cur.filter((id) => candidates.some((d) => d.id === id))
      if (stillValid.length) return stillValid
      return candidates.slice(0, 3).map((d) => d.id)
    })
  }, [candidates])

  // Keep the URL in sync with the current comparison, not just read it once
  // on load — otherwise "deep-linking" only works for the state the page
  // happened to open with, and there's nothing to copy/bookmark/share once
  // the user actually picks devices or changes the filters.
  //
  // next/navigation's router.replace() silently drops the query string here
  // (confirmed by intercepting history.replaceState in a real browser: it
  // fires exactly once, with the path and NO search params) — this app
  // builds with output:'export'/trailingSlash:true (next.config.js), a
  // combination App Router's client-side query-string navigation does not
  // handle reliably. The raw History API is also the more honest tool for
  // this anyway: nothing needs to re-render off the URL after mount (every
  // value driving the page is already React state), this is purely
  // "keep the address bar shareable," so it bypasses Next's router instead
  // of fighting it.
  useEffect(() => {
    const params = new URLSearchParams()
    if (siteFilter !== 'all') params.set('siteId', siteFilter)
    params.set('domain', domain)
    if (paramKey) params.set('param', paramKey)
    if (picked.length) params.set('devices', picked.join(','))
    params.set('range', rangeId)
    const qs = params.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [siteFilter, domain, paramKey, picked, rangeId])

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id)
      ? cur.filter((x) => x !== id)
      : cur.length >= MAX_DEVICES ? cur : [...cur, id]))

  const selectAllCandidates = () => {
    setPicked(candidates.map((d) => d.id).slice(0, MAX_DEVICES))
  }

  const clearAllSelection = () => {
    setPicked([])
  }

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
      Promise.all([
        api.readingsWindow(id, toUTC(from), toUTC(to), bucketSec, paramKey),
        (dualAxis && secondaryParam) ? api.readingsWindow(id, toUTC(from), toUTC(to), bucketSec, secondaryParam) : Promise.resolve([])
      ]).then(([rows, secRows]) => ({
        id,
        name: devices.find((d) => d.id === id)?.name ?? id,
        rows: (rows ?? []) as Row[],
        secRows: (secRows ?? []) as Row[]
      }))
    ))
      .then((res) => { if (!cancelled) { setLoaded(res); setWin({ from, to }) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [live, picked, paramKey, minutes, devices, customRange, dualAxis, secondaryParam])

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
      if (d.secRows) {
        for (const r of d.secRows) {
          const ts = new Date(r.taken_at).getTime()
          if (Number.isNaN(ts)) continue
          const slot = byTs.get(ts) ?? { ts, fullTime: fmtDateTime(ts), time: (win.to - win.from > 36 * 3600000) ? fmtDayMonth(ts) : fmtHM(ts) }
          slot[`${d.id}_sec`] = Number(r.value)
          byTs.set(ts, slot)
        }
      }
    }
    return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts)
  }, [loaded, win])

  const processedData = useMemo(() => {
    let res = [...data]
    if (!res.length) return res

    const fleetMeans = res.map(row => {
      let sum = 0, count = 0
      picked.forEach(id => {
        if (row[id] != null) { sum += row[id]; count++ }
      })
      return count > 0 ? sum / count : null
    })

    const validMeans = fleetMeans.filter(m => m !== null) as number[]

    if (showBaseline && validMeans.length > 0) {
      const n20 = Math.max(1, Math.floor(validMeans.length * 0.2))
      const first20 = validMeans.slice(0, n20)
      const baselineVal = first20.reduce((a, b) => a + b, 0) / first20.length
      const upper = baselineVal * 1.05
      const lower = baselineVal * 0.95
      res = res.map(row => ({ ...row, _baseline: baselineVal, _baselineRange: [lower, upper] }))
    }

    if (showSigmaBands && validMeans.length > 0) {
      const mu = validMeans.reduce((a, b) => a + b, 0) / validMeans.length
      const variance = validMeans.reduce((a, b) => a + Math.pow(b - mu, 2), 0) / validMeans.length
      const sigma = Math.sqrt(variance)
      const upper = mu + 3 * sigma
      const lower = mu - 3 * sigma
      res = res.map(row => ({ ...row, _sigmaRange: [lower, upper], _mu: mu }))
    }

    return res
  }, [data, picked, showBaseline, showSigmaBands])

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

            {/* Site Scope Selector */}
            {availableSites.length > 0 && (
              <div className="relative flex items-center">
                <Building2 size={12} className="absolute left-2.5 text-indigo-400 pointer-events-none" />
                <select
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                  className={`text-xs font-semibold pl-7 pr-6 py-1.5 rounded-lg border outline-none cursor-pointer transition-all ${
                    siteFilter !== 'all'
                      ? 'bg-indigo-950/90 text-indigo-200 border-indigo-500/60 shadow-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'text-white border-[#1e2433]'
                  }`}
                  style={siteFilter === 'all' ? inset : undefined}
                  title="Filter devices by site (กรองอุปกรณ์ตามไซต์)"
                >
                  <option value="all">All Sites ({devices.filter((d) => d.domain === domain).length})</option>
                  {availableSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.count})
                    </option>
                  ))}
                </select>
                {siteFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSiteFilter('all')}
                    className="ml-1 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Clear site filter (แสดงทุกไซต์)"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
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

          {/* Advanced Analytics Toolbar */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-800" style={inset}>
            <button onClick={() => setDualAxis(!dualAxis)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${dualAxis ? 'text-white bg-indigo-600' : 'text-slate-400 hover:text-slate-200'}`}>🔀 Dual-Axis</button>
            <button onClick={() => setShowBaseline(!showBaseline)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${showBaseline ? 'text-white bg-amber-600' : 'text-slate-400 hover:text-slate-200'}`}>🌟 Baseline</button>
            <button onClick={() => setSigmaBands(!showSigmaBands)} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${showSigmaBands ? 'text-white bg-red-600' : 'text-slate-400 hover:text-slate-200'}`}>📊 ±3σ</button>
          </div>

          {/* Secondary Param Select (If Dual Axis) */}
          {dualAxis && (
            <select
              value={secondaryParam}
              onChange={(e) => setSecondaryParam(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500 border border-indigo-500/30"
              style={inset}
            >
              <option value="">-- Secondary --</option>
              {schema.params.filter(p => p.key !== paramKey).map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit && ` (${p.unit})`}</option>)}
            </select>
          )}

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
              id="trends-from-dt"
              className="rounded-md px-2 py-1 text-slate-200 outline-none"
              style={inset}
            />
            <span className="text-slate-400">End:</span>
            <input
              type="datetime-local"
              defaultValue={customRange?.to || toDisplayInput(Date.now())}
              id="trends-to-dt"
              className="rounded-md px-2 py-1 text-slate-200 outline-none"
              style={inset}
            />
            <button
              onClick={() => {
                const f = (document.getElementById('trends-from-dt') as HTMLInputElement)?.value
                const t = (document.getElementById('trends-to-dt') as HTMLInputElement)?.value
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
            <div className="flex items-center gap-2">
              <span>Select devices to compare ({picked.length}/{MAX_DEVICES}):</span>
              {candidates.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectAllCandidates}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium underline cursor-pointer"
                  >
                    Select All ({Math.min(candidates.length, MAX_DEVICES)})
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={clearAllSelection}
                    className="text-[10px] text-slate-400 hover:text-slate-300 font-medium underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <span className="text-[10px] text-slate-600">Click to toggle device</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.length === 0 && (
              <span className="text-xs text-slate-600">No {DOMAIN_META[domain].label.toLowerCase()} devices found matching this site filter.</span>
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
              <ComposedChart data={processedData} margin={{ top: 10, right: 10, bottom: 5, left: -10 }}>
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
                  yAxisId="left"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#1e2433' }}
                  domain={['auto', 'auto']}
                />
                {dualAxis && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: '#f97316', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e2433' }}
                    domain={['auto', 'auto']}
                  />
                )}
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
                  labelFormatter={(v) => fmtDateTime(Number(v))}
                  itemSorter={(item) => (item.dataKey === focusId ? -1 : 0)}
                  formatter={(v: number | string, name: string, item: { dataKey?: string | number }) => {
                    const dk = String(item?.dataKey)
                    if (dk.endsWith('_sec')) {
                      const secP = schema.params.find(p => p.key === secondaryParam)
                      return [`${typeof v === 'number' ? v.toFixed(2) : v}${secP?.unit ? ` ${secP.unit}` : ''}`, name]
                    }
                    if (dk === '_baseline' || dk === '_mu' || dk === '_sigmaRange' || dk === '_baselineRange') {
                      if (Array.isArray(v)) return [`${v[0].toFixed(2)} - ${v[1].toFixed(2)}`, name]
                      return [`${typeof v === 'number' ? v.toFixed(2) : v}`, name]
                    }
                    return hiddenIds.has(dk) ? [null, null] : [`${typeof v === 'number' ? v.toFixed(2) : v}${param?.unit ? ` ${param.unit}` : ''}`, name]
                  }}
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
                    <ReferenceLine yAxisId="left" y={param.warn} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} label={{ value: `Warn: ${param.warn}`, fill: '#f59e0b', fontSize: 10, position: 'insideBottomRight' }} />
                    <ReferenceLine yAxisId="left" y={param.critical} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: `Crit: ${param.critical}`, fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }} />
                  </>
                )}

                {/* Sigma Bands */}
                {showSigmaBands && (
                  <Area yAxisId="left" type="step" dataKey="_sigmaRange" stroke="none" fill="rgba(239,68,68,0.06)" name="±3σ Band" activeDot={false} />
                )}

                {/* Baseline */}
                {showBaseline && (
                  <>
                    <Area yAxisId="left" type="step" dataKey="_baselineRange" stroke="none" fill="rgba(234,179,8,0.08)" name="Baseline ±5%" activeDot={false} />
                    <Line yAxisId="left" type="step" dataKey="_baseline" stroke="#eab308" strokeDasharray="8 4" strokeWidth={2} dot={false} isAnimationActive={false} name="Baseline (First 20%)" activeDot={false} />
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
                        yAxisId="left"
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

                {/* Secondary Device Lines */}
                {dualAxis && secondaryParam && picked
                  .map((id) => {
                    const hidden = hiddenIds.has(id)
                    const dimmed = !hidden && focusId !== null && focusId !== id
                    return (
                      <Line
                        key={`${id}_sec`}
                        yAxisId="right"
                        type="monotone"
                        dataKey={`${id}_sec`}
                        name={`[Secondary] ${devices.find((d) => d.id === id)?.name ?? id}`}
                        stroke="#f97316"
                        strokeDasharray="4 4"
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
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : layoutMode === 'split' ? (
          /* 2. Split Stacked Rows View — Separate chart per device (Zero Overlapping Lines!) */
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
                      <Link href={deviceDetailRoute(domain, id)} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-sans">
                        Details →
                      </Link>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <defs>
                        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
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
                        fill={`url(#grad-${id})`}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        ) : (
          /* 3. Grid Matrix View (Side by side cards) */
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
                        <Link href={deviceDetailRoute(domain, s.id)} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium">
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

export default function TrendsPage() {
  return (
    <Suspense fallback={null}>
      <TrendsPageContent />
    </Suspense>
  )
}
