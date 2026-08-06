'use client'

// ---------------------------------------------------------------------------
// Trends — compare ONE parameter across SEVERAL devices.
// ---------------------------------------------------------------------------
// This page used to be a device picker with one chart per parameter, which is
// exactly what the per-parameter modal on every device page now does — but with
// a custom date range, a min–max band, threshold editing and CSV on top. Keeping
// both meant maintaining the weaker copy.
//
// So it does the one thing a device page structurally cannot: put the same
// metric from several devices on one axis. "Is TR-004 running hotter than the
// rest of the site, or is the whole site hot today?" is a question about the
// fleet, and no single-device view can answer it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import { Loader2, Download, Check } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

const RANGES = [
  { id: '6h', label: 'Last 6 hours', minutes: 360 },
  { id: '24h', label: 'Last 24 hours', minutes: 1440 },
  { id: '7d', label: 'Last 7 days', minutes: 10080 },
  { id: '30d', label: 'Last 30 days', minutes: 43200 },
] as const

/** Distinguishable at a glance and colour-blind safe enough for 6 lines. */
const LINE_COLORS = ['#6366f1', '#22d3ee', '#f97316', '#a78bfa', '#4ade80', '#f472b6']
/** More lines than this is a spaghetti chart nobody can read. */
const MAX_DEVICES = 6
const MAX_POINTS = 240

interface Row { param_key: string; value: number; taken_at: string; n?: number }
interface Loaded { id: string; name: string; rows: Row[] }

// A real instant (ISO with 'Z') — see the identical fix + explanation in
// ParamHistoryModal.tsx. Chopping the zone off here compared a UTC-labelled
// window against readings.taken_at (written in +07:00 wall-clock), silently
// dropping the most recent ~7 hours of every chart ending "now".
const toUTC = (ms: number) => new Date(ms).toISOString()

export default function TrendsPage() {
  const live = useIsLive()
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = selectedOrgId || 'org-1'
  const { devices } = useManagedDevices(orgId)

  const [domain, setDomain] = useState<SensorDomain>('transformer')
  const [paramKey, setParamKey] = useState('oilTemp')
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('24h')
  const [picked, setPicked] = useState<string[]>([])
  const [loaded, setLoaded] = useState<Loaded[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [win, setWin] = useState({ from: Date.now() - 1440 * 60_000, to: Date.now() })

  const schema = ALARM_SCHEMA[domain]
  const param = schema.params.find((p) => p.key === paramKey) ?? schema.params[0]
  const minutes = RANGES.find((r) => r.id === rangeId)?.minutes ?? 1440

  // Comparing across domains is meaningless — °C against ppm against % on one
  // axis — so the device list is narrowed to the chosen product.
  const candidates = useMemo(() => devices.filter((d) => d.domain === domain), [devices, domain])
  const domainsPresent = useMemo(() => {
    const set = new Set(devices.map((d) => d.domain).filter(Boolean) as SensorDomain[])
    return set.size ? Array.from(set) : (['transformer'] as SensorDomain[])
  }, [devices])

  // Follow the org: an org with no transformers should not open on an empty
  // transformer list.
  useEffect(() => {
    if (!domainsPresent.includes(domain)) {
      const next = domainsPresent[0]
      setDomain(next)
      setParamKey(ALARM_SCHEMA[next].params[0]?.key ?? '')
    }
  }, [domainsPresent, domain])

  // Preselect the first few so the page shows something on arrival.
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

  const load = useCallback(() => {
    if (!live || !picked.length || !paramKey) { setLoaded(null); return }
    let cancelled = false
    setLoading(true)
    const to = Date.now()
    const from = to - minutes * 60_000
    // Same bucket width for every device, and the server floors on a fixed grid
    // (FLOOR(unix/bucket)*bucket), so the bucket timestamps line up exactly
    // across devices and can be merged by key instead of interpolated.
    const bucketSec = Math.max(60, (minutes * 60) / MAX_POINTS)
    Promise.all(picked.map((id) =>
      api.readingsWindow(id, toUTC(from), toUTC(to), bucketSec, paramKey)
        .then((rows) => ({ id, name: devices.find((d) => d.id === id)?.name ?? id, rows: (rows ?? []) as Row[] }))))
      .then((res) => { if (!cancelled) { setLoaded(res); setWin({ from, to }) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [live, picked, paramKey, minutes, devices])

  useEffect(() => { load() }, [load])

  // Merge into one row per bucket: { ts, [deviceId]: value }.
  const data = useMemo(() => {
    if (!loaded) return []
    const byTs = new Map<number, Record<string, number>>()
    for (const d of loaded) {
      for (const r of d.rows) {
        const ts = new Date(r.taken_at).getTime()
        if (Number.isNaN(ts)) continue
        const slot = byTs.get(ts) ?? {}
        slot[d.id] = Number(r.value)
        byTs.set(ts, slot)
      }
    }
    return Array.from(byTs.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, vals]) => ({ ts, ...vals }))
  }, [loaded])

  const stats = useMemo(() => (loaded ?? []).map((d) => {
    if (!d.rows.length) return { id: d.id, name: d.name, n: 0, min: null as number | null, avg: null as number | null, max: null as number | null, last: null as number | null }
    let min = Infinity, max = -Infinity, sum = 0, n = 0
    for (const r of d.rows) {
      const w = r.n ?? 1
      const v = Number(r.value)
      min = Math.min(min, v); max = Math.max(max, v); sum += v * w; n += w
    }
    return { id: d.id, name: d.name, n, min, avg: sum / n, max, last: Number(d.rows[d.rows.length - 1].value) }
  }), [loaded])

  const spanMs = win.to - win.from
  // Pinned to DISPLAY_TZ, not the browser — identical fix to ParamHistoryModal.
  // Readings are +07:00 events; a laptop set to UTC read every axis on this
  // page seven hours off.
  const fmtTick = (ts: number) => (spanMs > 36 * 3600_000 ? fmtDayMonth(ts) : fmtHM(ts))

  const exportCsv = () => {
    downloadCSV(
      `compare_${paramKey}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Time', ...picked.map((id) => devices.find((d) => d.id === id)?.name ?? id)],
      data.map((row) => [fmtDateTime(row.ts), ...picked.map((id) => (row as Record<string, number>)[id] ?? '')]),
    )
  }

  const anyData = data.length > 0
  const emptyDevices = stats.filter((s) => s.n === 0)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Compare Devices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            One parameter, several devices, one axis — the view a single device page cannot give you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-indigo-400" />}
          <button onClick={exportCsv} disabled={!anyData}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-2 rounded-lg text-slate-300 disabled:opacity-40" style={surface}>
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-xl p-4 space-y-3" style={surface}>
        <div className="flex flex-wrap items-center gap-2">
          {domainsPresent.length > 1 && (
            <select
              value={domain}
              onChange={(e) => {
                const d = e.target.value as SensorDomain
                setDomain(d)
                setParamKey(ALARM_SCHEMA[d].params[0]?.key ?? '')
              }}
              className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            >
              {domainsPresent.map((d) => <option key={d} value={d}>{DOMAIN_META[d].label}</option>)}
            </select>
          )}
          <select
            value={paramKey}
            onChange={(e) => setParamKey(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
            style={inset}
          >
            {schema.params.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit && ` (${p.unit})`}</option>)}
          </select>
          <select
            value={rangeId}
            onChange={(e) => setRangeId(e.target.value as typeof rangeId)}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
            style={inset}
          >
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <span className="text-[11px] text-slate-600">
            {picked.length}/{MAX_DEVICES} devices
          </span>
          {/* Which zone the axis is in — the readings are Thai-time events. */}
          <span className="text-[10px] text-slate-600" title={`All times shown in ${DISPLAY_TZ_LABEL}`}>
            times in {DISPLAY_TZ_LABEL}
          </span>
        </div>

        {/* Device chips */}
        <div className="flex flex-wrap gap-1.5">
          {candidates.length === 0 && (
            <span className="text-xs text-slate-600">No {DOMAIN_META[domain].label.toLowerCase()} devices in this organization.</span>
          )}
          {candidates.map((d, i) => {
            const on = picked.includes(d.id)
            const color = LINE_COLORS[picked.indexOf(d.id) % LINE_COLORS.length]
            const full = !on && picked.length >= MAX_DEVICES
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                disabled={full}
                title={full ? `Deselect one first — ${MAX_DEVICES} lines is the readable maximum` : d.location}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md font-medium disabled:opacity-40"
                style={on
                  ? { background: `${color}22`, border: `1px solid ${color}`, color }
                  : { ...inset, color: '#94a3b8' }}
              >
                {on && <Check size={11} />}
                {d.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl p-4 sm:p-5" style={surface}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            {param?.label}{param?.unit && <span className="text-slate-500 font-normal"> · {param.unit}</span>}
          </h3>
          <span className="text-[11px] text-slate-600">{data.length} points</span>
        </div>

        {!live ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-slate-600">
            Switch to Live mode to compare stored readings.
          </div>
        ) : !anyData ? (
          <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-slate-500">
              {loading ? 'Loading readings…'
                : !picked.length ? 'Select at least one device above.'
                : `No stored ${param?.label.toLowerCase()} readings for the selected devices in this period.`}
            </p>
            {!loading && picked.length > 0 && (
              <p className="text-xs text-slate-600">Try a wider range — raw readings are kept for 30 days.</p>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={[win.from, win.to]}
                tickFormatter={(v) => fmtTick(Number(v))}
                tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                labelFormatter={(v) => fmtDateTime(Number(v))}
                formatter={(v: number | string, name: string) => [`${v}${param?.unit ? ` ${param.unit}` : ''}`, name]} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              {/* Shared thresholds: the point of one axis is seeing which device
                  crosses the line the others do not. */}
              {param && <ReferenceLine y={param.warn} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />}
              {param && <ReferenceLine y={param.critical} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />}
              {picked.map((id, i) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={devices.find((d) => d.id === id)?.name ?? id}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={1.6}
                  dot={false}
                  // A device that stopped reporting must leave a gap, not a
                  // straight line pretending it kept the last value.
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-device summary */}
      {live && stats.length > 0 && (
        <div className="rounded-xl overflow-x-auto" style={surface}>
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr style={{ background: '#0a0e1a' }}>
                {['Device', 'Samples', 'Min', 'Average', 'Max', 'Latest', ''].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => {
                const over = (v: number | null) => v !== null && param && (param.direction === 'high' ? v >= param.warn : v <= param.warn)
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #1e2433' }}>
                    <td className="py-2.5 px-3">
                      <span className="flex items-center gap-2 text-xs text-slate-200">
                        <span className="w-2 h-2 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
                        {s.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-500">{s.n.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-400">{s.min === null ? '—' : s.min.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-400">{s.avg === null ? '—' : s.avg.toFixed(2)}</td>
                    <td className={`py-2.5 px-3 text-xs ${over(s.max) ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                      {s.max === null ? '—' : s.max.toFixed(2)}
                    </td>
                    <td className={`py-2.5 px-3 text-xs ${over(s.last) ? 'text-amber-400 font-semibold' : 'text-slate-300'}`}>
                      {s.last === null ? '—' : s.last.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Link href={`/admin/nodes/detail?id=${s.id}`} className="text-[11px] text-indigo-400 hover:text-indigo-300">
                        Open device →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {live && emptyDevices.length > 0 && anyData && (
        <p className="text-[11px] text-slate-600">
          No readings in this period for {emptyDevices.map((d) => d.name).join(', ')} — those lines are absent rather than flat.
        </p>
      )}
      {live && (
        <p className="text-[11px] text-slate-600">
          Amber and red dashed lines are the product’s warning and critical thresholds. For one device in depth — custom date range,
          min–max band and threshold editing — open the device and click the parameter’s card.
        </p>
      )}
    </div>
  )
}
