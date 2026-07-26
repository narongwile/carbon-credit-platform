'use client'

// ---------------------------------------------------------------------------
// Sensor Trends — historical charts from the stored readings.
// ---------------------------------------------------------------------------
// This page used to plot useAppStore().transformers[].sensors[].history, a
// series generated in the browser. It was labelled "24-hour historical trend
// analysis" while showing numbers no device ever produced, and it only ever
// offered transformers even for an org running fridges or blood boxes.
//
// Live mode now reads GET /api/nodes/:id/readings and renders one chart per
// parameter the device actually reports, driven by ALARM_SCHEMA so units and
// thresholds are right for any product. Demo mode keeps the generated series so
// the page still demonstrates without a backend.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { ALARM_SCHEMA, LEGACY_WIRE_KEYS } from '@/lib/alarmParams'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import { Loader2 } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

const RANGES = [
  { id: '6h', label: 'Last 6 hours', minutes: 360 },
  { id: '24h', label: 'Last 24 hours', minutes: 1440 },
  { id: '7d', label: 'Last 7 days', minutes: 10080 },
  { id: '30d', label: 'Last 30 days', minutes: 43200 },
] as const

/** Points to draw per chart. More than this is invisible and just slows recharts. */
const MAX_POINTS = 240

interface Row { param_key: string; value: number; taken_at: string }

/**
 * Bucket a parameter's readings into at most MAX_POINTS averages. A device
 * publishing every 1.5s produces ~57k points a day; plotting them raw makes the
 * line solid and the page unresponsive, and the shape is identical after
 * averaging into buckets narrower than one pixel.
 */
function series(rows: Row[], key: string, fromMs: number, toMs: number) {
  const pts = rows.filter((r) => r.param_key === key)
  if (!pts.length) return []
  const width = Math.max(1, (toMs - fromMs) / MAX_POINTS)
  const buckets = new Map<number, { sum: number; n: number }>()
  for (const p of pts) {
    const t = new Date(p.taken_at).getTime()
    if (Number.isNaN(t)) continue
    const b = Math.floor((t - fromMs) / width)
    const cur = buckets.get(b) ?? { sum: 0, n: 0 }
    cur.sum += Number(p.value)
    cur.n++
    buckets.set(b, cur)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([b, v]) => ({ ts: fromMs + b * width, value: +(v.sum / v.n).toFixed(3) }))
}

const fmtTick = (ts: number, spanMs: number) => {
  const d = new Date(ts)
  // Over a day, the hour alone is ambiguous — show the date instead.
  return spanMs > 36 * 3600_000
    ? d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function TrendsPage() {
  const live = useIsLive()
  const { selectedOrgId, getTransformersByOrg } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const { devices } = useManagedDevices(orgId)

  const [selectedId, setSelectedId] = useState('')
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('24h')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)

  // The roster arrives asynchronously, so the first device cannot seed useState.
  useEffect(() => {
    if (!selectedId && devices.length) setSelectedId(devices[0].id)
  }, [devices, selectedId])

  const device = devices.find((d) => d.id === selectedId)
  const minutes = RANGES.find((r) => r.id === rangeId)?.minutes ?? 1440

  useEffect(() => {
    if (!live || !selectedId) { setRows(null); return }
    let cancelled = false
    setLoading(true)
    // One bucket per plotted point: the browser receives ~MAX_POINTS rows per
    // parameter instead of every sample in the window.
    api.readings(selectedId, minutes, Math.max(60, (minutes * 60) / MAX_POINTS))
      .then((r) => { if (!cancelled) setRows(r ?? []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [live, selectedId, minutes])

  const toMs = Date.now()
  const fromMs = toMs - minutes * 60_000

  // One chart per parameter this device reports: schema params first (label,
  // unit and thresholds known), then anything else it publishes.
  const charts = useMemo(() => {
    if (!rows) return []
    const schema = device?.domain ? ALARM_SCHEMA[device.domain] : undefined
    const present = new Set(rows.map((r) => r.param_key))
    const out: { key: string; label: string; unit: string; warn?: number; critical?: number; data: { ts: number; value: number }[] }[] = []
    for (const p of schema?.params ?? []) {
      if (!present.has(p.key)) continue
      present.delete(p.key)
      out.push({ key: p.key, label: p.label, unit: p.unit, warn: p.warn, critical: p.critical, data: series(rows, p.key, fromMs, toMs) })
    }
    for (const k of Array.from(present)) {
      // Raw wire keys are the same metric under its pre-normalisation spelling.
      if (LEGACY_WIRE_KEYS.has(k)) continue
      out.push({ key: k, label: k, unit: '', data: series(rows, k, fromMs, toMs) })
    }
    return out.filter((c) => c.data.length > 1)
  }, [rows, device, fromMs, toMs])

  // Demo mode: the generated transformer series, as this page always showed.
  const demoTransformers = getTransformersByOrg(orgId)
  const demoTransformer = demoTransformers.find((t) => t.id === selectedId) ?? demoTransformers[0]
  const demoData = useMemo(() => {
    if (live || !demoTransformer) return []
    const s = demoTransformer.sensors
    return s.oilTemperature.history.slice(-96).map((p, i) => ({
      time: new Date(p.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }),
      oilTemp: s.oilTemperature.history[i]?.value ?? 0,
      load: s.load.history[i]?.value ?? 0,
      hydrogen: s.hydrogen.history[i]?.value ?? 0,
      moisture: s.moisture.history[i]?.value ?? 0,
    }))
  }, [live, demoTransformer])

  const spanMs = toMs - fromMs

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Sensor Trends</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {live ? 'Stored readings — averaged per bucket over the selected period' : 'Demo data — switch to Live mode for stored readings'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin text-indigo-400" />}
          <select
            value={rangeId}
            onChange={(e) => setRangeId(e.target.value as typeof rangeId)}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
            style={surface}
          >
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
            style={surface}
          >
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.location}</option>)}
          </select>
        </div>
      </div>

      {!live ? (
        [
          { title: 'Load & Oil Temperature', keys: [{ key: 'load', color: '#6366f1', name: 'Load (%)' }, { key: 'oilTemp', color: '#f97316', name: 'Oil Temp (°C)' }] },
          { title: 'Dissolved Gas Analysis', keys: [{ key: 'hydrogen', color: '#22d3ee', name: 'Hydrogen (ppm)' }, { key: 'moisture', color: '#a78bfa', name: 'Moisture (ppm)' }] },
        ].map((chart) => (
          <div key={chart.title} className="rounded-xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-4">{chart.title}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={demoData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval={11} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                {chart.keys.map((k) => (
                  <Line key={k.key} type="monotone" dataKey={k.key} stroke={k.color} strokeWidth={1.5} dot={false} name={k.name} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))
      ) : charts.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={surface}>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading readings…' : `No stored readings for ${device?.name ?? 'this device'} in the ${RANGES.find((r) => r.id === rangeId)?.label.toLowerCase()}.`}
          </p>
          {!loading && (
            <p className="text-xs text-slate-600 mt-2">
              Raw readings are kept for 30 days; older periods are available at hourly resolution from the device report.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {charts.map((c) => (
            <div key={c.key} className="rounded-xl p-5" style={surface}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">{c.label}</h3>
                <span className="text-[11px] text-slate-600">
                  {c.unit && <span className="mr-2">{c.unit}</span>}
                  {c.data.length} points
                </span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={c.data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                  <XAxis
                    dataKey="ts" type="number" scale="time" domain={[fromMs, toMs]}
                    tickFormatter={(v) => fmtTick(Number(v), spanMs)}
                    tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40}
                  />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                    formatter={(v: number | string) => [`${v}${c.unit ? ` ${c.unit}` : ''}`, c.label]}
                  />
                  {/* Thresholds on the chart: a spike only means something next to its limit. */}
                  {c.warn !== undefined && <ReferenceLine y={c.warn} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />}
                  {c.critical !== undefined && <ReferenceLine y={c.critical} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />}
                  <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={1.5} dot={false} name={c.label} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}

      {live && charts.length > 0 && (
        <p className="text-[11px] text-slate-600">
          Amber and red dashed lines are the warning and critical thresholds from the product’s alarm schema.
        </p>
      )}
    </div>
  )
}
