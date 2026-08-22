'use client'

import { useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { makeTransformer } from '@/lib/mockData'
import type { TransformerHost } from '@/types/fleet'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeSitePanel from '@/components/device/NodeSitePanel'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import MyAlertSettings from '@/components/device/MyAlertSettings'
import ParamHistoryModal, { type ModalParam } from '@/components/device/ParamHistoryModal'
import DisplayParamPicker from '@/components/device/DisplayParamPicker'
import NameplateEditor from '@/components/device/NameplateEditor'
import DepartmentAccessEditor from '@/components/device/DepartmentAccessEditor'
import DeviceExportDialog from '@/components/device/DeviceExportDialog'
import DevicePhotoGallery from '@/components/device/DevicePhotoGallery'
import DeviceLocationCard from '@/components/device/DeviceLocationCard'
import CustomChartsSection from '@/components/device/CustomChartsSection'
import SensorListSection from '@/components/device/SensorList'
import { useShow3dFallback } from '@/lib/useOrgDisplaySettings'
import { useNodeNameplate } from '@/lib/useNodeNameplate'
import { useParamLabels } from '@/lib/useParamLabels'
import { classifyByKva, TRANSFORMER_CLASS_LABEL } from '@/lib/transformerClass'
import { useSessionRole } from '@/lib/auth'
import { api, useIsLive, type ParamLayout, type DisplayParamScope } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { ALARM_SCHEMA, healthFromValues, paramStatus } from '@/lib/alarmParams'
import { fmtHM, fmtDateTime } from '@/lib/displayTime'
import dynamic from 'next/dynamic'
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
  Thermometer, Droplets, Gauge, Activity, Zap, Wind,
  MapPin, Calendar, Building2, Hash, CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronLeft, Maximize2, SlidersHorizontal, Pencil, Camera, Users, Share2,
  BarChart2, FileText, GripVertical, X,
} from 'lucide-react'
import clsx from 'clsx'
import Link from 'next/link'
import type { SensorData, SensorReading, TrendPoint, Transformer } from '@/types'

const Transformer3D = dynamic(() => import('@/components/transformer/Transformer3D'), { ssr: false })

// Shown instead of the generic 3D model when an org has turned it off
// (migrate-v33) and this device has no uploaded photo yet.
function NoPhotoPlaceholder() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-600">
      <Camera size={28} className="opacity-40" />
      <span className="text-xs">No photo uploaded yet</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live data overlay
// ---------------------------------------------------------------------------
// Everything on this page used to come from the demo store, so in Live mode the
// sensor cards, health gauge, 3D twin and trend charts showed fabricated values
// while the Event Log right below them showed the real device. The hook below
// replaces the readings with what the device actually published — canonical
// param keys from the ingest worker — and leaves the demo series untouched when
// Live is off or the device has reported nothing yet.

/** SensorData field ← canonical param key (see paramMap in backend/worker/main.go). */
const LIVE_PARAM: Record<keyof SensorData, string> = {
  oilTemperature: 'oilTemp',
  hydrogen: 'hydrogen',
  moisture: 'moisture',
  oilLevel: 'oilLevel',
  load: 'load',
  ambientTemperature: 'ambientTemp',
}

/** A device is considered online while it reported within the sweep window. */
const ONLINE_WITHIN_MS = 90_000
/** Points kept per param — the charts read the last 48, the sparklines the last 12. */
const HISTORY_POINTS = 48

// ---------------------------------------------------------------------------
// Which parameters the two trend charts draw
// ---------------------------------------------------------------------------
// Both charts used to be hardwired to the four canonical schema keys
// (oilTemp / load / hydrogen / moisture). A real transformer very often
// publishes none of them under those names — tr-222 reports CurrentAVG, H2,
// Hz, kWh and OilMoisture — so every line was drawn from the SEEDED demo
// series while the cards above showed the device's real values, and clicking
// a chart opened the history modal on a key with no stored rows at all, which
// is the "no real values" the charts were reported for.
//
// Each role now resolves against what the device ACTUALLY reports: the exact
// canonical key when it is there, otherwise a loose name match, otherwise
// whatever real parameter is still unclaimed. A device whose names match
// nothing still gets four real lines rather than four fabricated ones.
const CHART_ROLES: { exact: string; test: RegExp; color: string }[] = [
  { exact: 'oilTemp', test: /temp/i, color: '#f97316' },
  { exact: 'load', test: /load|current|power|kva|kwh|kw\b|amp/i, color: '#6366f1' },
  { exact: 'hydrogen', test: /^h2|hydrogen|gas/i, color: '#22d3ee' },
  { exact: 'moisture', test: /moist|humid|^rh/i, color: '#a78bfa' },
]

export interface ChartSlot {
  key: string
  label: string
  unit?: string
  color: string
  history: TrendPoint[]
}

/** Fill the four chart roles from the parameters this device really has. */
function resolveChartSlots(
  available: { key: string; label: string; unit?: string; history: TrendPoint[] }[],
): (ChartSlot | null)[] {
  const used = new Set<string>()
  const slots: (ChartSlot | null)[] = CHART_ROLES.map((role) => {
    const hit =
      available.find((c) => c.key === role.exact && !used.has(c.key)) ??
      available.find((c) => role.test.test(c.key) && !used.has(c.key))
    if (!hit) return null
    used.add(hit.key)
    return { ...hit, color: role.color }
  })
  // Anything still empty takes the next unclaimed parameter, so a device that
  // matches no pattern charts its real values instead of an empty frame.
  const rest = available.filter((c) => !used.has(c.key))
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue
    const next = rest.shift()
    if (!next) break
    used.add(next.key)
    slots[i] = { ...next, color: CHART_ROLES[i].color }
  }
  return slots
}

function historyByParam(rows: { param_key: string; value: number; taken_at: string }[]) {
  const out: Record<string, TrendPoint[]> = {}
  for (const r of rows) {
    (out[r.param_key] ||= []).push({ time: r.taken_at, value: Number(r.value) })
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(-HISTORY_POINTS)
  return out
}

function useLiveTransformer(base: Transformer | undefined) {
  const live = useIsLive()
  const id = base?.id
  const [values, setValues] = useState<Record<string, number> | null>(null)
  const [lastReadingAt, setLastReadingAt] = useState<string | null>(null)
  const [series, setSeries] = useState<Record<string, TrendPoint[]>>({})

  // Poll the stored readings, then let WS frames update the current values in
  // real time — the same pattern the generic device dashboard uses.
  //
  // The two reads are on deliberately different clocks. /latest is one row per
  // param and is what every number and status colour on this page is drawn
  // from, so it is the one worth polling briskly. /readings is a 12h window
  // bucketed into 48 points of 15 MINUTES each — re-fetching that on the same
  // fast tick cost a heavy query per tick and could not move a chart any
  // sooner, because a 15-minute bucket does not change 12 times a minute.
  // Both used to share a single 10s interval, which was simultaneously too
  // slow for the live numbers and far too fast for the history.
  const VALUES_POLL_MS = 4000
  const SERIES_POLL_MS = 30000
  useEffect(() => {
    if (!live || !id) { setValues(null); setLastReadingAt(null); setSeries({}); return }
    let cancelled = false
    const loadLatest = () => {
      api.latest(id).then((r) => {
        if (cancelled || !r) return
        if (r.values && Object.keys(r.values).length > 0) {
          setValues((prev) => ({ ...(prev || {}), ...r.values }))
        }
        if (r.lastReadingAt) setLastReadingAt(r.lastReadingAt)
      })
    }
    // 48 buckets over 12h = one point per 15 minutes, which is exactly what the
    // sparklines and both trend charts draw.
    const loadSeries = () => {
      api.readings(id, 720, (720 * 60) / HISTORY_POINTS).then((rows) => { if (!cancelled && rows) setSeries(historyByParam(rows)) })
    }
    loadLatest()
    loadSeries()
    const tv = setInterval(loadLatest, VALUES_POLL_MS)
    const ts = setInterval(loadSeries, SERIES_POLL_MS)
    // The socket is the actual real-time path — the poll above is only the
    // fallback for when it is down. A frame lands the moment the device
    // publishes, with no interval in between.
    const off = subscribeTelemetry((f) => {
      if (f.id !== id || f.type === 'alarm' || !f.values || !Object.keys(f.values).length) return
      setValues((prev) => ({ ...(prev || {}), ...f.values }))
      setLastReadingAt(new Date().toISOString())
    })
    // A tab in the background has its timers throttled to ~1/min by the
    // browser, so coming back to this page used to show a value minutes stale
    // until the next tick happened to fire. Refresh the moment it is looked at.
    const onVisible = () => { if (document.visibilityState === 'visible') { loadLatest(); loadSeries() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(tv); clearInterval(ts); off()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [live, id])

  const online = live
    ? !!lastReadingAt && Date.now() - new Date(lastReadingAt).getTime() < ONLINE_WITHIN_MS
    : true

  const transformer = useMemo(() => {
    if (!base) return base
    if (!live || !values || !Object.keys(values).length) return base

    const byKey = Object.fromEntries(ALARM_SCHEMA.transformer.params.map((p) => [p.key, p]))
    const sensors = { ...base.sensors }
    let worst: SensorReading['status'] = 'NORMAL'

    for (const field of Object.keys(LIVE_PARAM) as (keyof SensorData)[]) {
      const key = LIVE_PARAM[field]
      const v = values[key]
      if (v === undefined) continue
      const prev = sensors[field]
      const p = byKey[key]
      // A single point can't be drawn as a sparkline (the polyline divides by
      // length-1), so only swap in live history once there are at least two.
      const points = (series[key]?.length ?? 0) >= 2 ? series[key] : prev.history
      const previous = points.length > 1 ? points[points.length - 2].value : v
      const status = p ? paramStatus(v, p) : prev.status
      if (status === 'CRITICAL' || (status === 'WARNING' && worst === 'NORMAL')) worst = status
      sensors[field] = {
        ...prev,
        value: v,
        unit: p?.unit ?? prev.unit,
        status,
        threshold: p ? { warning: p.warn, critical: p.critical } : prev.threshold,
        delta: v - previous,
        trend: Math.abs(v - previous) < 1e-6 ? 'stable' : v > previous ? 'up' : 'down',
        history: points,
      }
    }

    return {
      ...base,
      sensors,
      healthIndex: healthFromValues(values, 'transformer') ?? (online ? 100 : (base?.healthIndex || 0)),
      status: online ? worst : 'OFFLINE',
      lastUpdated: lastReadingAt ?? base.lastUpdated,
    } as Transformer
  }, [base, live, values, series, online, lastReadingAt])

  return { transformer, live, online, lastReadingAt, values, series }
}

function LiveTime() {
  const [time, setTime] = useState('')
  useEffect(() => {
    setTime(new Date().toLocaleTimeString())
    const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(id)
  }, [])
  return <div className="text-[10px] text-slate-600">Last update: {time}</div>
}

// Semi-circle health gauge
function HealthGauge({ value }: { value: number }) {
  const color = value >= 80 ? '#4ade80' : value >= 60 ? '#fbbf24' : '#ef4444'
  const angle = (value / 100) * 180
  const r = 60
  const cx = 80
  const cy = 75
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const startAngle = 180
  const endAngle = 180 - angle
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy - r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy - r * Math.sin(toRad(endAngle))
  const largeArc = angle > 180 ? 1 : 0

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#1e2433"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Value arc */}
        {value > 0 && (
          <path
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
          />
        )}
        {/* Needle tip */}
        <circle cx={x2} cy={y2} r="5" fill={color} />
        {/* Labels */}
        <text x="20" y="88" fill="#475569" fontSize="10">0</text>
        <text x="72" y="18" fill="#475569" fontSize="10">50</text>
        <text x="130" y="88" fill="#475569" fontSize="10">100</text>
        {/* Value */}
        <text x={cx} y={cy + 5} textAnchor="middle" fill={color} fontSize="22" fontWeight="bold">{value}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#475569" fontSize="9">Health Index</text>
      </svg>
    </div>
  )
}

function SensorCard({
  label, icon, sensor, onOpen, isDraggable, onDragStart, onDragOver, onDrop, onDragEnd, isOver,
}: {
  label: string
  icon: React.ReactNode
  sensor: SensorReading
  onOpen?: () => void
  isDraggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
  isOver?: boolean
}) {
  const statusConfig = {
    NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.15)' },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.15)' },
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.15)' },
  }
  const sc = statusConfig[sensor.status]
  const recentHistory = sensor.history.slice(-12)

  // Mini sparkline points. A param with 0 or 1 stored points draws nothing
  // rather than NaN coordinates: every reported key now gets a card, and an
  // extra the device has only just started sending has no history yet.
  const max = Math.max(...recentHistory.map((p) => p.value))
  const min = Math.min(...recentHistory.map((p) => p.value))
  const range = max - min || 1
  const w = 100
  const h = 24
  const points = recentHistory.length > 1
    ? recentHistory
        .map((p, i) => `${(i / (recentHistory.length - 1)) * w},${h - ((p.value - min) / range) * h}`)
        .join(' ')
    : ''

  return (
    <div
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`relative w-full rounded-xl transition-all ${isOver ? 'ring-2 ring-indigo-500 scale-[1.02]' : ''}`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${label} history`}
        className="w-full text-left rounded-xl p-4 transition-all hover:border-indigo-500/30 cursor-pointer"
        style={{ background: '#0d1117', border: '1px solid #1e2433' }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {isDraggable && (
              <span className="text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing mr-0.5" title="Drag to reorder">
                <GripVertical size={13} />
              </span>
            )}
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: sc.bg }}>
              <span style={{ color: sc.color }}>{icon}</span>
            </div>
            <span className="text-xs text-slate-400">{label}</span>
          </div>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
          >
            {sensor.status}
          </span>
      </div>

      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-bold text-white">{sensor.value.toFixed(1)}</span>
        <span className="text-xs text-slate-500">{sensor.unit}</span>
      </div>

      <div className="flex items-center gap-1 mb-3">
        <span
          className={`text-[10px] font-medium ${sensor.trend === 'up' ? 'text-red-400' : sensor.trend === 'down' ? 'text-blue-400' : 'text-slate-500'}`}
        >
          {sensor.trend === 'up' ? '▲' : sensor.trend === 'down' ? '▼' : '●'}
          {' '}{Math.abs(sensor.delta).toFixed(1)}{sensor.unit}
        </span>
        <span className="text-[10px] text-slate-600">vs prev</span>
      </div>

      {/* Mini sparkline */}
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={sc.color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </svg>
    </button>
  </div>
  )
}

function TrendChart({ a, b }: { a: ChartSlot | null; b: ChartSlot | null }) {
  // Keyed by timestamp rather than zipped by array index. The old version did
  // `loadHistory[i]` against `history[i]`, which silently pairs the wrong
  // samples the moment two parameters have different point counts — normal
  // whenever one of them started reporting later than the other.
  const data = useMemo(() => {
    const byTime = new Map<string, { time: string; ts: number; a?: number; b?: number }>()
    const add = (slot: ChartSlot | null, field: 'a' | 'b') => {
      if (!slot) return
      for (const p of slot.history.slice(-HISTORY_POINTS)) {
        // fmtHM, not getHours(): readings are +07:00 events, not browser-local.
        const row = byTime.get(p.time) ?? { time: fmtHM(p.time), ts: new Date(p.time).getTime() }
        row[field] = p.value
        byTime.set(p.time, row)
      }
    }
    add(a, 'a')
    add(b, 'b')
    return Array.from(byTime.values()).sort((x, y) => x.ts - y.ts)
  }, [a, b])

  const tooltipStyle = {
    background: '#0d1117',
    border: '1px solid #1e2433',
    borderRadius: '8px',
    fontSize: '11px',
  }

  const nameOf = (s: ChartSlot) => (s.unit ? `${s.label} (${s.unit})` : s.label)

  if (!data.length) {
    return (
      <div className="h-[150px] flex items-center justify-center text-[11px] text-slate-600">
        {a || b ? 'No stored readings in the last 12h' : 'This device reports no parameters yet'}
      </div>
    )
  }

  return (
    <div className="w-full h-[150px]">
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false}
            interval="preserveStartEnd" minTickGap={28} />
          <YAxis yAxisId="a" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <YAxis yAxisId="b" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '2px' }} />
          {a && <Line yAxisId="a" type="monotone" dataKey="a" stroke={a.color} strokeWidth={1.5} dot={false}
            name={nameOf(a)} connectNulls isAnimationActive={false} />}
          {b && <Line yAxisId="b" type="monotone" dataKey="b" stroke={b.color} strokeWidth={1.5} dot={false}
            name={nameOf(b)} connectNulls isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TrendChartConfigModal({
  slotIndex,
  currentA,
  currentB,
  availableCards,
  onClose,
  onSave,
  onReset,
}: {
  slotIndex: number
  currentA: string
  currentB: string
  availableCards: { key: string; label: string; unit?: string }[]
  onClose: () => void
  onSave: (paramA: string, paramB: string) => void
  onReset: () => void
}) {
  const [paramA, setParamA] = useState(currentA || availableCards[0]?.key || '')
  const [paramB, setParamB] = useState(currentB || '')

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl p-5 space-y-4 shadow-2xl border border-indigo-500/40" style={{ background: '#0d1117' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-indigo-400" />
            <h4 className="text-sm font-bold text-white">Customize Overview Chart {slotIndex + 1}</h4>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <p className="text-[11px] text-slate-400">
          Choose which parameters from this device to pin onto this overview chart.
        </p>

        <div className="space-y-3 text-xs">
          <div>
            <label className="text-amber-300 block mb-1 font-medium">Primary Series (Left Axis - {slotIndex === 0 ? 'Orange' : 'Cyan'})</label>
            <select
              value={paramA}
              onChange={(e) => setParamA(e.target.value)}
              className="w-full rounded-lg px-3 py-2 bg-[#0a0e1a] text-slate-200 border border-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              {availableCards.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} {c.unit ? `(${c.unit})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-indigo-300 block mb-1 font-medium">Secondary Series (Right Axis - {slotIndex === 0 ? 'Purple' : 'Violet'})</label>
            <select
              value={paramB}
              onChange={(e) => setParamB(e.target.value)}
              className="w-full rounded-lg px-3 py-2 bg-[#0a0e1a] text-slate-200 border border-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">(None — Single Series View)</option>
              {availableCards.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} {c.unit ? `(${c.unit})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-slate-500 hover:text-amber-300 underline"
          >
            Reset Auto
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(paramA, paramB)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
            >
              Save &amp; Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Unacknowledged alarms for this device. In Live mode these are the real
// alarm_events rows (the demo store's alarms belong to the mock fleet and would
// contradict the Event Log below); acknowledging happens in that Event Log,
// where the department problem catalogue is available.
function LiveActiveAlarms({ nodeId }: { nodeId: string }) {
  const [rows, setRows] = useState<{ id: string; message: string; severity: string; ts: number }[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      api.events(nodeId).then((raw) => {
        if (cancelled || !raw) return
        setRows((raw as Record<string, unknown>[])
          .filter((r) => !r.acknowledged_at)
          .map((r) => ({
            id: String(r.id),
            severity: String(r.severity ?? 'WARNING'),
            message: r.kind === 'offline'
              ? 'Device offline — no telemetry received'
              : `${String(r.param_label ?? r.param_key ?? 'Parameter')} ${Number(r.value ?? 0)}${String(r.unit ?? '')} (limit ${Number(r.threshold ?? 0)})`,
            ts: new Date(String(r.raised_at ?? Date.now())).getTime(),
          }))
          .slice(0, 8))
      })
    }
    load()
    const t = setInterval(load, 20000)
    const off = subscribeTelemetry((f) => { if (f.type === 'alarm' && f.id === nodeId) load() })
    return () => { cancelled = true; clearInterval(t); off() }
  }, [nodeId])

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400 py-4">
        <CheckCircle size={16} />
        No active alarms — system operating normally
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
          style={
            a.severity === 'CRITICAL'
              ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
              : { background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }
          }
        >
          {a.severity === 'CRITICAL'
            ? <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          }
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-300">{a.message}</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-600 mt-0.5">
              <Clock size={9} />
              {fmtDateTime(a.ts)}
            </div>
          </div>
        </div>
      ))}
      <div className="text-[10px] text-slate-600 pt-1">Acknowledge in the Event Log below.</div>
    </div>
  )
}

function ActiveAlarms({ transformerId }: { transformerId: string }) {
  const { alarms } = useAppStore()
  const tAlarms = alarms.filter((a) => a.transformerId === transformerId && !a.acknowledged)

  if (tAlarms.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400 py-4">
        <CheckCircle size={16} />
        No active alarms — system operating normally
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tAlarms.map((alarm) => (
        <div
          key={alarm.id}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={
            alarm.severity === 'CRITICAL'
              ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
              : { background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }
          }
        >
          {alarm.severity === 'CRITICAL'
            ? <XCircle size={14} className="text-red-400 flex-shrink-0" />
            : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-300 truncate">{alarm.message}</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-600 mt-0.5">
              <Clock size={9} />
              {fmtHM(alarm.timestamp)}
            </div>
          </div>
        </div>
      ))}
      {/* This compact widget has no root-cause picker, and acknowledging now
          requires one to be chosen — so it can no longer offer a one-click ACK
          that would file an event with no cause. Its Live counterpart
          (LiveActiveAlarms) has always pointed at the Event Log for exactly
          this reason; the demo panel now says the same thing rather than
          behaving differently from the real one. */}
      <div className="text-[10px] text-slate-600 pt-1">Acknowledge in the Event Log below.</div>
    </div>
  )
}

// Shared by both portals: the admin opens it from Overview, a viewer from their
// device list. The only differences are whose fleet to resolve the id against
// and where Back goes, so they are props rather than two copies of the page.
export default function TransformerDetailView({ orgId: orgIdProp, backHref = '/admin' }: { orgId?: string; backHref?: string } = {}) {
  const id = useSearchParams().get('id') ?? ''
  const { transformers } = useAppStore()
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = orgIdProp ?? selectedOrgId
  // The Overview lists the roster from /api/fleet, but this page used to resolve
  // the device from the seeded `transformers` array only — so every real device
  // that is not one of the demo ids (a transformer an ESP32 registered itself)
  // rendered "Transformer not found" from a card that had just linked to it.
  // Fall back to the live fleet host, projected through the same makeTransformer
  // the seed uses, so the asset frame exists and useLiveTransformer can fill it
  // with real readings.
  const { hosts, loaded: fleetLoaded, fromBackend } = useFleetHosts(orgId)
  const base = useMemo(() => {
    // The live roster FIRST, and in live mode it is the only source that may
    // resolve a device. GET /api/fleet has already applied this caller's real
    // access (org, product level, node_departments grants, site scope), so a
    // hit here is an access-checked hit.
    //
    // The seeded `transformers` array is checked only when there is no backend
    // (demo/offline). It used to be checked FIRST and unconditionally, and it
    // is a static client-side list bundled into the app — so any signed-in
    // viewer could type ?id=tr-001 (or any other seed id, including ones
    // belonging to another organization entirely) and get a fully rendered
    // transformer dashboard that /api/fleet had correctly excluded from their
    // roster. Same class of hole DeviceDetailClient already closed with its
    // `verified` flag; this page never got the equivalent.
    const host = hosts.find((h) => h.id === id && h.domain === 'transformer')
    if (host) return makeTransformer(host as TransformerHost)
    if (fromBackend) return undefined
    return transformers.find((t) => t.id === id)
  }, [transformers, hosts, id, fromBackend])
  // makeTransformer doesn't carry siteId onto the Transformer it returns (only
  // a jittered lat/lng — see DeviceLocationCard's header comment for why that
  // never was this device's real position). Pulled separately so the real
  // per-device coordinate widget below can resolve the site it belongs to.
  const siteId = useMemo(() => hosts.find((h) => h.id === id && h.domain === 'transformer')?.siteId, [hosts, id])
  const { transformer, live, online, lastReadingAt, values, series } = useLiveTransformer(base)
  const displayLocation = useMemo(() => {
    if (transformer?.location && transformer.location !== '—') return transformer.location
    const host = hosts.find((h) => h.id === id && h.domain === 'transformer')
    if (host?.lat != null && host?.lng != null) {
      return `${Number(host.lat).toFixed(4)}, ${Number(host.lng).toFixed(4)}`
    }
    if (transformer?.lat != null && transformer?.lng != null) {
      return `${Number(transformer.lat).toFixed(4)}, ${Number(transformer.lng).toFixed(4)}`
    }
    return '—'
  }, [transformer?.location, transformer?.lat, transformer?.lng, hosts, id])
  const [openParam, setOpenParam] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const role = useSessionRole()
  const canConfigure = role === 'admin' || role === 'superadmin'
  // Real nameplate — was reading transformer.model/.kva/.voltage/.manufacturer/
  // .installDate/.serialNumber, which for any real (non-seed) device fall back
  // to '—'/0 placeholders because nothing ever wrote them. Overrides those
  // fields additively when a real nameplate has been entered.
  const { data: nameplate, refetch: refetchNameplate } = useNodeNameplate(id)
  // Admin-renamed parameters (migrate-v34). The six cards below used
  // hardcoded English strings and the extras list showed the raw wire key,
  // so a rename made on this very page changed nothing on it.
  const { labelOf: paramLabel, refetch: refetchParamLabels } = useParamLabels(orgId, 'transformer', id)
  const [editingNameplate, setEditingNameplate] = useState(false)
  const [editingDeptAccess, setEditingDeptAccess] = useState(false)
  // Export is NOT gated on canConfigure: the backend's 'node' policy already
  // proves this caller may read this device, and the person who needs to send
  // its data on is usually the viewer who was called out to it.
  const [exporting, setExporting] = useState(false)
  // transformer.orgId, not the page-level orgId — a superadmin viewing
  // another org's device needs THAT org's toggle, not their own selected one.
  const show3d = useShow3dFallback(transformer?.orgId ?? '')
  const sizeClass = classifyByKva(nameplate?.ratedKva ?? undefined)
  const [mobileTab, setMobileTab] = useState<'overview' | 'visuals' | 'charts' | 'logs'>('overview')
  // card = a full SensorCard (icon, number, sparkline); list = a dense row
  // (SensorListSection) — an admin-chosen split (migrate-v37) so a merged
  // device's twenty-odd secondary values do not each cost a full card's worth
  const [paramLayout, setParamLayout] = useState<Record<string, ParamLayout>>({})
  const [paramScope, setParamScope] = useState<DisplayParamScope>('none')
  useEffect(() => {
    if (!live) return
    let cancelled = false
    api.displayParams(orgId, 'transformer', id).then((r) => {
      if (cancelled || !r) return
      setShowKeys(r.paramKeys?.length ? r.paramKeys : null)
      setParamScope(r.scope ?? 'none')
      setParamLayout(r.layout ?? {})
    })
    return () => { cancelled = true }
  }, [orgId, id, live])

  /** Admin's parameter selection; empty = unconfigured = show everything. */
  const isShown = useMemo(() => (k: string) => !showKeys?.length || showKeys.includes(k), [showKeys])
  const layoutOf = useMemo(() => (k: string): ParamLayout => paramLayout[k] ?? 'card', [paramLayout])
  // ── Sensor cards, built from what the device ACTUALLY reports ────────────
  // This panel used to be six fixed cards (the ALARM_SCHEMA slots) plus a
  // cramped one-line list for everything else. On a real transformer that is
  // backwards: a merged two-topic asset reports around forty values and the
  // six schema slots are simply the ones this platform happens to have names
  // and thresholds for — not the ones that matter most on that unit. Worse,
  // a schema slot the device does NOT report still drew a card, showing the
  // seed value as if it were live.
  //
  // Every reported key now gets the same full card. Schema params keep their
  // thresholds, status colour and unit and come first (they are the ones with
  // alarm meaning); everything else follows alphabetically with a plain
  // NORMAL card. Demo mode, which has no `values`, keeps the six seeded
  // sensors so the page still demonstrates without a backend.
  const schemaByKey = useMemo(
    () => Object.fromEntries(ALARM_SCHEMA.transformer.params.map((p) => [p.key, p])),
    [],
  )
  const cardIcon = (k: string) => {
    if (k.toLowerCase().includes('temp')) return <Thermometer size={13} />
    if (k === 'hydrogen' || k.startsWith('H2')) return <Activity size={13} />
    if (k.toLowerCase().includes('moist') || k.toLowerCase().startsWith('rh')) return <Droplets size={13} />
    if (k === 'oilLevel') return <Gauge size={13} />
    if (k === 'load' || k.toLowerCase().includes('volt') || k.toLowerCase().includes('curr') || k.toLowerCase().includes('power')) return <Zap size={13} />
    return <Activity size={13} />
  }
  const cards = useMemo(() => {
    const out: { key: string; label: string; icon: React.ReactNode; reading: SensorReading; layout: ParamLayout }[] = []
    // Runs above the not-found guard (hooks cannot be conditional), so the
    // device may not be resolved yet on the first passes.
    if (!transformer) return out
    if (live && values && Object.keys(values).length) {
      const keys = Object.keys(values)
      const ordered = [
        ...ALARM_SCHEMA.transformer.params.map((p) => p.key).filter((k) => keys.includes(k)),
        ...keys.filter((k) => !schemaByKey[k]).sort((a, b) => a.localeCompare(b)),
      ]
      for (const k of ordered) {
        if (!isShown(k)) continue
        const v = values[k]
        const p = schemaByKey[k]
        const hist = series[k] ?? []
        const prev = hist.length > 1 ? hist[hist.length - 2].value : v
        out.push({
          key: k,
          label: paramLabel(k),
          icon: cardIcon(k),
          layout: layoutOf(k),
          reading: {
            value: v,
            unit: p?.unit ?? '',
            min: 0,
            max: (p?.critical ?? Math.abs(v) * 1.5) || 100,
            status: p ? paramStatus(v, p) : 'NORMAL',
            threshold: { warning: p?.warn ?? 0, critical: p?.critical ?? 0 },
            trend: Math.abs(v - prev) < 1e-6 ? 'stable' : v > prev ? 'up' : 'down',
            delta: v - prev,
            history: hist,
          },
        })
      }
      return out
    }
    // Demo / device has reported nothing yet: the seeded six.
    for (const [field, key] of Object.entries(LIVE_PARAM) as [keyof SensorData, string][]) {
      if (!isShown(key)) continue
      out.push({ key, label: paramLabel(key), icon: cardIcon(key), layout: layoutOf(key), reading: transformer.sensors[field] })
    }
    return out
  }, [live, values, series, schemaByKey, isShown, layoutOf, paramLabel, transformer])

  const [cardOrder, setCardOrder] = useState<string[]>([])
  const [draggedCardKey, setDraggedCardKey] = useState<string | null>(null)
  const [dragOverCardKey, setDragOverCardKey] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`sensor_card_order_${id}`)
      if (saved) setCardOrder(JSON.parse(saved))
    } catch {}
  }, [id])

  const handleCardDrop = (targetKey: string) => {
    if (!draggedCardKey || draggedCardKey === targetKey) {
      setDraggedCardKey(null)
      setDragOverCardKey(null)
      return
    }
    const currentKeys = bigCards.map((c) => c.key)
    const srcIdx = currentKeys.indexOf(draggedCardKey)
    const dstIdx = currentKeys.indexOf(targetKey)
    if (srcIdx < 0 || dstIdx < 0) return
    const newOrder = [...currentKeys]
    newOrder.splice(srcIdx, 1)
    newOrder.splice(dstIdx, 0, draggedCardKey)
    setCardOrder(newOrder)
    try {
      localStorage.setItem(`sensor_card_order_${id}`, JSON.stringify(newOrder))
    } catch {}
    setDraggedCardKey(null)
    setDragOverCardKey(null)
  }

  // Split for rendering: cards keep the tiles they always had, list rows go
  // beneath as one dense block. modalParams (below) stays built from the full
  // `cards` set, so the history switcher offers a list-tier parameter too —
  // demoting a value's LAYOUT never demotes its history.
  const bigCards = useMemo(() => {
    const raw = cards.filter((c) => c.layout !== 'list')
    if (!cardOrder.length) return raw
    return [...raw].sort((a, b) => {
      const ia = cardOrder.indexOf(a.key)
      const ib = cardOrder.indexOf(b.key)
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }, [cards, cardOrder])
  const listCards = useMemo(() => cards.filter((c) => c.layout === 'list'), [cards])

  // Pinned/Customized parameter configuration for the two overview trend charts:
  // [ [slot0A, slot0B], [slot1A, slot1B] ]
  const [customTrendSlots, setCustomTrendSlots] = useState<[[string, string], [string, string]] | null>(null)
  const [editingTrendSlotIndex, setEditingTrendSlotIndex] = useState<number | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`pinned_trend_slots_${id}`)
      if (saved) setCustomTrendSlots(JSON.parse(saved))
    } catch {}
  }, [id])

  // The two trend charts, auto-resolved against this device's real parameters
  // (see CHART_ROLES). Built from `cards` so it works identically in Live
  // mode (history from the stored readings) and Demo mode (the seeded six).
  const autoChartSlots = useMemo(
    () => resolveChartSlots(cards.map((c) => ({
      key: c.key, label: c.label, unit: c.reading.unit || undefined, history: c.reading.history ?? [],
    }))),
    [cards],
  )

  const chartSlots = useMemo(() => {
    if (!customTrendSlots) return autoChartSlots
    const paramMap = new Map(cards.map((c) => [c.key, c]))
    const resolveSlot = (key: string, fallback: ChartSlot | null, color: string): ChartSlot | null => {
      if (!key) return null
      const card = paramMap.get(key)
      if (!card) return fallback
      return {
        key: card.key,
        label: card.label,
        unit: card.reading.unit || undefined,
        color,
        history: card.reading.history ?? [],
      }
    }
    return [
      resolveSlot(customTrendSlots[0][0], autoChartSlots[0], '#f97316'),
      resolveSlot(customTrendSlots[0][1], autoChartSlots[1], '#6366f1'),
      resolveSlot(customTrendSlots[1][0], autoChartSlots[2], '#22d3ee'),
      resolveSlot(customTrendSlots[1][1], autoChartSlots[3], '#a78bfa'),
    ]
  }, [customTrendSlots, autoChartSlots, cards])

  const saveTrendSlot = (slotIdx: number, paramA: string, paramB: string) => {
    const s0A = chartSlots[0]?.key ?? ''
    const s0B = chartSlots[1]?.key ?? ''
    const s1A = chartSlots[2]?.key ?? ''
    const s1B = chartSlots[3]?.key ?? ''
    const base: [[string, string], [string, string]] = customTrendSlots
      ? [[...customTrendSlots[0]], [...customTrendSlots[1]]]
      : [[s0A, s0B], [s1A, s1B]]
    base[slotIdx] = [paramA, paramB]
    setCustomTrendSlots(base)
    try {
      localStorage.setItem(`pinned_trend_slots_${id}`, JSON.stringify(base))
    } catch {}
    setEditingTrendSlotIndex(null)
  }

  const resetTrendSlots = () => {
    setCustomTrendSlots(null)
    try {
      localStorage.removeItem(`pinned_trend_slots_${id}`)
    } catch {}
    setEditingTrendSlotIndex(null)
  }

  // Everything reported by this device is switchable inside the history modal, visualizer studio,
  // and custom chart builder — including DGA (hydrogen, moisture) and raw extras (Tbox, RHamb, RHbox),
  // regardless of whether an individual sensor card is currently hidden from the compact SENSOR READINGS.
  const modalParams: ModalParam[] = useMemo(() => {
    const paramMap = new Map<string, ModalParam>()
    // 1. Add all cards currently rendered
    for (const c of cards) {
      paramMap.set(c.key, { key: c.key, label: c.label, unit: c.reading.unit || undefined })
    }
    // 2. Add all parameters this device has reported in live values
    if (values) {
      for (const k of Object.keys(values)) {
        if (!paramMap.has(k)) {
          const p = schemaByKey[k]
          paramMap.set(k, {
            key: k,
            label: paramLabel(k),
            unit: p?.unit ?? undefined,
          })
        }
      }
    }
    // 3. Fallback to schema params if empty
    if (paramMap.size === 0) {
      for (const p of ALARM_SCHEMA.transformer.params) {
        if (!paramMap.has(p.key)) {
          paramMap.set(p.key, { key: p.key, label: p.label, unit: p.unit || undefined })
        }
      }
    }
    return Array.from(paramMap.values())
  }, [cards, values, schemaByKey, paramLabel])

  // The picker offers only parameters THIS device actually reports (device-driven self-discovery).
  // If in demo mode or reporting nothing yet, falls back to canonical schema parameters.
  const available = useMemo(() => {
    if (live && values && Object.keys(values).length > 0) {
      return Object.keys(values).sort((a, b) => a.localeCompare(b))
    }
    return Array.from(new Set(ALARM_SCHEMA.transformer.params.map((p) => p.key)))
  }, [live, values])

  if (!transformer) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md text-center">
          <div className="text-slate-500">
            {fleetLoaded ? 'Transformer not found' : 'Loading transformer…'}
          </div>
          {/* Deliberately the same wording whether the id does not exist or
              exists but is not granted to this viewer's department — telling
              them apart would confirm the existence of devices they may not
              see. */}
          {fleetLoaded && (
            <p className="text-sm text-slate-600 mt-2">
              No transformer with id “{id}” is available to you.
            </p>
          )}
        </div>
      </div>
    )
  }

  // Keys already shown as one of the six named cards above.
  const CANONICAL = new Set(Object.values(LIVE_PARAM))
  /** No selection saved = not configured = show everything, never nothing. */
  const shown = isShown
  const extras = Object.entries(values ?? {})
    .filter(([k]) => !CANONICAL.has(k))
    .filter(([k]) => shown(k))
    .sort(([a], [b]) => a.localeCompare(b))

  const statusColors = {
    NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.2)' },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)' },
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
    OFFLINE: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.2)' },
  }
  const sc = statusColors[transformer.status]

  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ background: '#0a0e1a' }}>
      {/* Sticky Header Group: Top bar + Mobile Tab Switcher */}
      <div className="sticky top-0 z-30 flex-shrink-0 bg-[#0d1117] border-b border-[#1e2433] shadow-md">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5">
          <Link href={backHref} className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-500 hover:text-white transition-colors">
            <ChevronLeft size={16} />
            Back
          </Link>
          <div className="h-4 w-px hidden sm:block" style={{ background: '#1e2433' }} />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-bold text-white truncate max-w-[130px] sm:max-w-none">{transformer.name}</span>
            <span
              className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-bold"
              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
            >
              {transformer.status}
            </span>
          </div>
          <div className="h-4 w-px hidden sm:block" style={{ background: '#1e2433' }} />
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin size={11} />
            {displayLocation}
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Was a permanently spinning "Live" — it said nothing about the device. */}
            <DeviceLiveStatus nodeId={transformer.id} />
            <NodeReportButton nodeId={transformer.id} deviceName={transformer.name} domain="transformer" />
            {/* No role gate: the backend's 'node' policy has already proved this
                caller may read this device, so anyone who can see the page may
                export what is on it. */}
            <button onClick={() => setExporting(true)} title="Export this device's data for a date range"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
              <Share2 size={12} /> <span className="hidden xs:inline">Export</span>
            </button>
            <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* Mobile Tab Switcher (< lg screen) */}
        <div className="lg:hidden flex items-center justify-between border-t border-[#1e2433] p-1.5 overflow-x-auto gap-1 bg-[#0a0e1a]">
          {[
            { id: 'overview', label: 'Overview', icon: <Activity size={13} /> },
            { id: 'visuals', label: '3D & Assets', icon: <Camera size={13} /> },
            { id: 'charts', label: 'Charts', icon: <BarChart2 size={13} /> },
            { id: 'logs', label: 'Logs & Docs', icon: <FileText size={13} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id as any)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
                mobileTab === tab.id
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content - responsive layout (tabbed on mobile, 3-column on lg) */}
      <div className="flex flex-col lg:flex-row gap-0 overflow-y-auto lg:overflow-hidden min-h-0 flex-1 lg:min-h-[520px]">
        {/* Left panel - sensor cards (and mobile overview top summary) */}
        <div className={clsx(
          'w-full lg:w-56 flex-shrink-0 p-3 space-y-2 overflow-visible lg:overflow-y-auto border-b lg:border-b-0',
          mobileTab === 'overview' ? 'block' : 'hidden lg:block'
        )} style={{ borderRight: '1px solid #1e2433' }}>
          {/* Mobile-only Health & Connection Summary on Overview Tab */}
          <div className="lg:hidden space-y-2 pb-2 mb-2 border-b border-[#1e2433]">
            <div className="grid grid-cols-2 gap-2">
              {/* Connection Status */}
              <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-400">Connection</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                    <span className={`text-[11px] font-bold ${online ? 'text-green-400' : 'text-slate-500'}`}>
                      {online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>
                </div>
                {live && lastReadingAt
                  ? <div className="text-[10px] text-slate-600">{fmtDateTime(lastReadingAt)}</div>
                  : <LiveTime />}
              </div>

              {/* Health Gauge */}
              <div className="rounded-xl p-3 flex items-center justify-center" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
                <HealthGauge value={transformer.healthIndex} />
              </div>
            </div>

            {/* Active Alarms Widget */}
            <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">Active Alarms</div>
              {live ? <LiveActiveAlarms nodeId={transformer.id} /> : <ActiveAlarms transformerId={transformer.id} />}
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="text-[10px] text-slate-600 uppercase tracking-wider">Sensor Readings</div>
            {canConfigure && live && (
              <button onClick={() => setPicking(true)} title="Choose which parameters to show"
                className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400">
                <SlidersHorizontal size={11} /> Configure
              </button>
            )}
          </div>
          {/* One card per parameter the device actually reports */}
          {bigCards.map((c) => (
            <SensorCard
              key={c.key}
              label={c.label}
              icon={c.icon}
              sensor={c.reading}
              onOpen={() => setOpenParam(c.key)}
              isDraggable={canConfigure}
              onDragStart={(e) => {
                setDraggedCardKey(c.key)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragOverCardKey !== c.key) setDragOverCardKey(c.key)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleCardDrop(c.key)
              }}
              onDragEnd={() => {
                setDraggedCardKey(null)
                setDragOverCardKey(null)
              }}
              isOver={dragOverCardKey === c.key && draggedCardKey !== c.key}
            />
          ))}
          <SensorListSection
            items={listCards.map((c) => ({ key: c.key, label: c.label, value: c.reading.value, unit: c.reading.unit, status: c.reading.status }))}
            onOpen={setOpenParam} />
          {cards.length === 0 && (
            <p className="text-[11px] text-slate-600 py-4">
              {live ? 'This device has not reported any readings yet.' : 'No parameters selected for display.'}
            </p>
          )}
        </div>

        {/* Center - 3D model + charts + custom charts */}
        <div className={clsx(
          'flex-1 flex flex-col overflow-y-auto min-w-0',
          (mobileTab === 'visuals' || mobileTab === 'charts') ? 'flex' : 'hidden lg:flex'
        )}>
          {/* 3D / Photo Gallery (Visible on Desktop OR when mobileTab === 'visuals') */}
          <div className={clsx(
            'relative h-[260px] sm:h-[320px] lg:min-h-[320px] flex-shrink-0',
            mobileTab === 'visuals' ? 'block' : 'hidden lg:block'
          )}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #0d1117 50%, #0a0e1a 100%)' }}>
              <DevicePhotoGallery nodeId={id} orgId={transformer.orgId} deviceName={transformer.name}
                fallback={show3d ? <Transformer3D transformer={transformer} /> : <NoPhotoPlaceholder />} />
            </div>
          </div>

          {/* Mobile-only Asset Info & Location when mobileTab === 'visuals' */}
          <div className="lg:hidden p-3 space-y-3" style={mobileTab === 'visuals' ? { display: 'block' } : { display: 'none' }}>
            {/* Transformer info */}
            <div className="rounded-xl p-3 space-y-2" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider">Asset Info</div>
                <div className="flex items-center gap-1.5">
                  {sizeClass && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>
                      {TRANSFORMER_CLASS_LABEL[sizeClass]}
                    </span>
                  )}
                  {canConfigure && live && (
                    <button onClick={() => setEditingDeptAccess(true)} title="Configure department access"
                      className="text-slate-500 hover:text-indigo-400 flex-shrink-0">
                      <Users size={11} />
                    </button>
                  )}
                  {canConfigure && live && (
                    <button onClick={() => setEditingNameplate(true)} title="Edit nameplate"
                      className="text-slate-500 hover:text-indigo-400 flex-shrink-0">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
              </div>
              {[
                { icon: <Hash size={10} />, label: 'ID', value: transformer.name },
                { icon: <Building2 size={10} />, label: 'Model', value: nameplate?.resolved?.model || nameplate?.model || transformer.model || 'Not entered' },
                { icon: <Zap size={10} />, label: 'Rating', value: (nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva) != null ? `${nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva} kVA` : (transformer.kva ? `${transformer.kva} kVA` : 'Not entered') },
                { icon: <Activity size={10} />, label: 'Voltage', value: nameplate?.resolved?.voltageClass || nameplate?.voltageClass || transformer.voltage || 'Not entered' },
                { icon: <Wind size={10} />, label: 'Cooling', value: nameplate?.resolved?.coolingType || nameplate?.coolingType || 'Not entered' },
                { icon: <Building2 size={10} />, label: 'Mfg.', value: nameplate?.resolved?.manufacturer || nameplate?.manufacturer || transformer.manufacturer || 'Not entered' },
                { icon: <Calendar size={10} />, label: 'Installed', value: nameplate?.yearInstalled ? String(nameplate.yearInstalled) : (transformer.installDate || 'Not entered') },
                { icon: <Hash size={10} />, label: 'S/N', value: nameplate?.serialNumber || transformer.serialNumber || 'Not entered' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-2">
                  <span className="text-slate-600 mt-0.5 flex-shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-slate-600">{item.label}</div>
                    <div className={`text-[11px] truncate ${item.value === 'Not entered' ? 'text-slate-600 italic' : 'text-slate-300'}`}>{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Device Location */}
            <DeviceLocationCard nodeId={transformer.id} orgId={orgId} siteId={siteId} canConfigure={canConfigure} />
          </div>

          {/* Charts (Visible on Desktop OR when mobileTab === 'charts') */}
          <div className={clsx(
            'flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-0 border-t border-slate-800',
            mobileTab === 'charts' ? 'grid' : 'hidden lg:grid'
          )} style={{ borderTop: '1px solid #1e2433' }}>
            {[[chartSlots[0], chartSlots[1]], [chartSlots[2], chartSlots[3]]].map(([a, b], i) => {
              const title = [a?.label, b?.label].filter(Boolean).join(' & ') || 'No parameters'
              const target = a?.key ?? b?.key ?? null
              return (
                <div key={i} className="p-3" style={i === 0 ? { borderRight: '1px solid #1e2433' } : undefined}>
                  <div className="w-full flex items-center justify-between mb-2 gap-1.5">
                    <button type="button" onClick={() => target && setOpenParam(target)} disabled={!target}
                      className="flex-1 flex items-center justify-between group disabled:cursor-default min-w-0 text-left" title={target ? 'Open history' : undefined}>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider group-enabled:group-hover:text-indigo-400 truncate">{title}</div>
                      {target && <div className="text-[10px] text-slate-600 group-hover:text-indigo-400 flex-shrink-0 ml-2 hidden sm:block">Last 12h · click for history</div>}
                    </button>
                    {canConfigure && (
                      <button
                        type="button"
                        onClick={() => setEditingTrendSlotIndex(i)}
                        title={`Customize parameters for Chart ${i + 1}`}
                        className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-white/5 transition-colors shrink-0"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                  <div className="w-full min-w-0 h-[155px]">
                    <TrendChart a={a} b={b} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Custom Charts Section (Visible on Desktop OR when mobileTab === 'charts') */}
          <div className={mobileTab === 'charts' ? 'block' : 'hidden lg:block'}>
            <CustomChartsSection
              nodeId={transformer.id}
              orgId={transformer.orgId}
              domain="transformer"
              availableParams={modalParams}
              canConfigure={canConfigure}
            />
          </div>
        </div>

        {/* Right panel - info + health + alarms (Desktop 3rd column) */}
        <div className="hidden lg:block w-56 flex-shrink-0 overflow-y-auto p-3 space-y-3" style={{ borderLeft: '1px solid #1e2433' }}>
          {/* Health gauge */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <HealthGauge value={transformer.healthIndex} />
          </div>

          {/* Status */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">Connection</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className={`text-xs ${online ? 'text-green-400' : 'text-slate-500'}`}>
                  {online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>
            {live && lastReadingAt
              ? <div className="text-[10px] text-slate-600">Last reading: {fmtDateTime(lastReadingAt)}</div>
              : <LiveTime />}
          </div>

          {/* Transformer info */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider">Asset Info</div>
              <div className="flex items-center gap-1.5">
                {sizeClass && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>
                    {TRANSFORMER_CLASS_LABEL[sizeClass]}
                  </span>
                )}
                {canConfigure && live && (
                  <button onClick={() => setEditingDeptAccess(true)} title="Configure department access"
                    className="text-slate-500 hover:text-indigo-400 flex-shrink-0">
                    <Users size={11} />
                  </button>
                )}
                {canConfigure && live && (
                  <button onClick={() => setEditingNameplate(true)} title="Edit nameplate"
                    className="text-slate-500 hover:text-indigo-400 flex-shrink-0">
                    <Pencil size={11} />
                  </button>
                )}
              </div>
            </div>
            {[
              { icon: <Hash size={10} />, label: 'ID', value: transformer.name },
              { icon: <Building2 size={10} />, label: 'Model', value: nameplate?.resolved?.model || nameplate?.model || transformer.model || 'Not entered' },
              { icon: <Zap size={10} />, label: 'Rating', value: (nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva) != null ? `${nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva} kVA` : (transformer.kva ? `${transformer.kva} kVA` : 'Not entered') },
              { icon: <Activity size={10} />, label: 'Voltage', value: nameplate?.resolved?.voltageClass || nameplate?.voltageClass || transformer.voltage || 'Not entered' },
              { icon: <Wind size={10} />, label: 'Cooling', value: nameplate?.resolved?.coolingType || nameplate?.coolingType || 'Not entered' },
              { icon: <Building2 size={10} />, label: 'Mfg.', value: nameplate?.resolved?.manufacturer || nameplate?.manufacturer || transformer.manufacturer || 'Not entered' },
              { icon: <Calendar size={10} />, label: 'Installed', value: nameplate?.yearInstalled ? String(nameplate.yearInstalled) : (transformer.installDate || 'Not entered') },
              { icon: <Hash size={10} />, label: 'S/N', value: nameplate?.serialNumber || transformer.serialNumber || 'Not entered' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="text-slate-600 mt-0.5 flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-slate-600">{item.label}</div>
                  <div className={`text-[11px] truncate ${item.value === 'Not entered' ? 'text-slate-600 italic' : 'text-slate-300'}`}>{item.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Device Location */}
          <DeviceLocationCard nodeId={transformer.id} orgId={orgId} siteId={siteId} canConfigure={canConfigure} />

          {/* Active Alarms */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Active Alarms</div>
            {live ? <LiveActiveAlarms nodeId={transformer.id} /> : <ActiveAlarms transformerId={transformer.id} />}
          </div>
        </div>
      </div>

      {editingNameplate && (
        <NameplateEditor nodeId={id} orgId={transformer.orgId} current={nameplate}
          onClose={() => setEditingNameplate(false)} onSaved={refetchNameplate} />
      )}

      {editingDeptAccess && (
        <DepartmentAccessEditor nodeId={transformer.id} orgId={transformer.orgId} deviceName={transformer.name} domain="transformer"
          onClose={() => setEditingDeptAccess(false)} />
      )}

      {exporting && (
        <DeviceExportDialog nodeId={transformer.id} deviceName={transformer.name} onClose={() => setExporting(false)} />
      )}

      {picking && (
        <DisplayParamPicker
          orgId={orgId}
          domain="transformer"
          nodeId={transformer.id}
          available={available}
          onClose={() => setPicking(false)}
          onSaved={(keys) => { setShowKeys(keys.length ? keys : null); refetchParamLabels() }}
        />
      )}

      {openParam && transformer && (
        <ParamHistoryModal
          nodeId={transformer.id}
          deviceName={transformer.name}
          orgId={transformer.orgId}
          domain="transformer"
          params={modalParams}
          initialKey={openParam}
          onClose={() => setOpenParam(null)}
        />
      )}

      {editingTrendSlotIndex !== null && (
        <TrendChartConfigModal
          slotIndex={editingTrendSlotIndex}
          currentA={chartSlots[editingTrendSlotIndex * 2]?.key ?? ''}
          currentB={chartSlots[editingTrendSlotIndex * 2 + 1]?.key ?? ''}
          availableCards={modalParams}
          onClose={() => setEditingTrendSlotIndex(null)}
          onSave={(paramA, paramB) => saveTrendSlot(editingTrendSlotIndex, paramA, paramB)}
          onReset={resetTrendSlots}
        />
      )}

      {/* Site management + Alarm event log + transport/connectivity timeline (Mobile logs tab / Desktop bottom) */}
      <div className={clsx('p-4 space-y-4', mobileTab === 'logs' ? 'block' : 'hidden lg:block')}>
        <NodeSitePanel nodeId={transformer.id} orgId={transformer.orgId} currentSiteId={siteId} domain="transformer" deviceHref="/admin/transformers/detail" />
        <NodeDocuments nodeId={transformer.id} orgId={transformer.orgId} deviceName={transformer.name} />
        <NodeEventLog
          nodeId={transformer.id}
          domain="transformer"
          baseValue={transformer.sensors.oilTemperature.value}
        />
        <MyAlertSettings nodeId={transformer.id} domain="transformer" orgId={transformer.orgId} />
      </div>
    </div>
  )
}
