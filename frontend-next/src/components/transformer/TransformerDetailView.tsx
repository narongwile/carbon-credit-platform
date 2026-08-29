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
import { api, useIsLive, type ParamLayout, type DisplayParamScope, type DevicePresence } from '@/lib/api'
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
  BarChart2, FileText, GripVertical, X, TrendingUp, ShieldCheck,
  Download, Bot, FlaskConical, Battery, Sliders, Volume2, VolumeX,
} from 'lucide-react'
import { useAudioChimeStore } from '@/lib/audioChimeStore'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import Link from 'next/link'
import type { SensorData, SensorReading, TrendPoint, Transformer } from '@/types'
import DgaDuvalTriangle from '@/components/transformer/DgaDuvalTriangle'
import InsulationAgingRul from '@/components/transformer/InsulationAgingRul'
import DynamicThermalRating from '@/components/transformer/DynamicThermalRating'
import LabDgaIngestion from '@/components/transformer/LabDgaIngestion'
import FleetRiskMatrix from '@/components/transformer/FleetRiskMatrix'
import BushingHealthStudio from '@/components/transformer/BushingHealthStudio'
import GenAiDiagnosticsCopilot from '@/components/transformer/GenAiDiagnosticsCopilot'
import BessCoOptimization from '@/components/transformer/BessCoOptimization'
import SubstationThreatsStudio from '@/components/transformer/SubstationThreatsStudio'
import { generateOfficialEngineeringDossier } from '@/lib/officialDossierGenerator'
import { conservativeDynamicRating } from '@/lib/dtrModel'
import StudyModal from '@/components/transformer/StudyModal'

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

/**
 * SensorData field ← canonical param key (see paramMap in backend/worker/main.go).
 * Only the six channels every transformer reports — the newer optional
 * extended channels (bushingTanDelta, partialDischarge, …) are surfaced by
 * their own studios via transformer.sensors directly, not through this live-
 * merge path, so Partial<> here rather than requiring an entry for each.
 */
const LIVE_PARAM: Partial<Record<keyof SensorData, string>> = {
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
  const [presence, setPresence] = useState<DevicePresence | null>(null)
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
    if (!live || !id) { setValues(null); setLastReadingAt(null); setPresence(null); setSeries({}); return }
    let cancelled = false
    const loadLatest = () => {
      api.latest(id).then((r) => {
        if (cancelled || !r) return
        if (r.values && Object.keys(r.values).length > 0) {
          setValues((prev) => ({ ...(prev || {}), ...r.values }))
        }
        if (r.lastReadingAt) setLastReadingAt(r.lastReadingAt)
        if (r.presence !== undefined) setPresence(r.presence ?? null)
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
      // LIVE_PARAM is Partial<> in its TYPE (so callers don't have to name
      // every optional extended channel), but this loop only ever iterates
      // its OWN keys, all six of which really are set — this narrows back to
      // that, rather than the field/key pair silently becoming a no-op.
      if (!key) continue
      const v = values[key]
      if (v === undefined) continue
      const prev = sensors[field]
      // Extended channels are optional on SensorData; a unit that does not
      // publish this one has nothing to merge into.
      if (!prev) continue
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

  return { transformer, live, online, lastReadingAt, values, series, presence }
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
  const orgNames = useAppStore((s) => s.orgNames)
  const orgId = orgIdProp ?? selectedOrgId

  // The Overview lists the roster from /api/fleet, but this page used to resolve
  // the device from the seeded `transformers` array only — so every real device
  // that is not one of the demo ids (a transformer an ESP32 registered itself)
  // rendered "Transformer not found" from a card that had just linked to it.
  // Fall back to the live fleet host, projected through the same makeTransformer
  // the seed uses, so the asset frame exists and useLiveTransformer can fill it
  // with real readings.
  const isLive = useIsLive()
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
    const host = hosts.find((h) => h.id === id && h.domain === 'transformer' && (!h.orgId || h.orgId === orgId))
    if (host) return makeTransformer(host as TransformerHost)
    if (fromBackend || isLive) return undefined
    return transformers.find((t) => t.id === id && (!t.orgId || t.orgId === orgId))
  }, [transformers, hosts, id, fromBackend, orgId, isLive])
  // makeTransformer doesn't carry siteId onto the Transformer it returns (only
  // a jittered lat/lng — see DeviceLocationCard's header comment for why that
  // never was this device's real position). Pulled separately so the real
  // per-device coordinate widget below can resolve the site it belongs to.
  const siteId = useMemo(() => hosts.find((h) => h.id === id && h.domain === 'transformer')?.siteId, [hosts, id])
  const { transformer, live, online, lastReadingAt, values, series, presence } = useLiveTransformer(base)
  const [sites, setSites] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!live || !orgId) { setSites({}); return }
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSites(Object.fromEntries((r.sites ?? []).map((s) => [s.id, s.name]))) })
    return () => { cancelled = true }
  }, [live, orgId])
  const [showArbitrationModal, setShowArbitrationModal] = useState(false)
  const [arbitrationMode, setArbitrationMode] = useState<'max' | 'mean'>('max')
  const [conflictDismissed, setConflictDismissed] = useState(false)

  // Web Audio Chime per Org configuration
  const targetOrgId = transformer?.orgId || base?.orgId || 'org-1'
  const orgAudioSettings = useAudioChimeStore((s) => s.getSettingsForOrg(targetOrgId))
  useEffect(() => {
    if (presence?.identity_conflict_at && !conflictDismissed) {
      useAudioChimeStore.getState().playChime(targetOrgId, 'conflict')
    }
  }, [presence?.identity_conflict_at, conflictDismissed, targetOrgId])
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
  // Restored: the PdM refactor deleted this declaration but left both
  // TRANSFORMER_CLASS_LABEL[sizeClass] render sites and the import in place.
  const sizeClass = classifyByKva(nameplate?.ratedKva ?? undefined)

  // NOTE: this block reads `transformer` and `nameplate`, so it must stay
  // BELOW their declarations. It was inserted at the top of the component,
  // above both, which is a use-before-declaration on two const bindings and
  // a hard TS error (TS2448/TS2454), not a hoisting quirk that happens to work.
  const currentOrgName = useMemo(() => {
    return (transformer?.orgId && orgNames[transformer.orgId]) || orgNames[orgId] || 'Industrial Substation'
  }, [transformer?.orgId, orgNames, orgId])

  // Universal Multi-Tenant Telemetry Extraction (Resolves any sensor wire key format per org)
  const liveTelemetry = useMemo(() => {
    // Typed as a loose record on purpose: this reads RAW firmware wire keys via
    // the alias lists below, which are deliberately wider than SensorData's
    // named channels.
    const s = (transformer?.sensors || {}) as Record<string, { value?: number } | undefined>
    const getVal = (keys: string[], fallback: number) => {
      for (const k of keys) {
        if (s[k]?.value != null) return Number(s[k].value)
      }
      return fallback
    }
    // Which of these came from the device and which are catalogue fallbacks.
    // Most transformers publish no DGA at all, so h2/ch4/c2h2/c2h4/c2h6/co/co2
    // silently resolved to the same seven constants for every asset in every
    // organization — and the studios and the exported PDF then labelled them
    // "Measured Telemetry" / "Current (ppm)". Consumers can now tell the
    // difference instead of having to assume.
    const has = (keys: string[]) => keys.some((k) => s[k]?.value != null)

    const h2 = getVal(['hydrogen', 'h2'], 65)
    const ch4 = getVal(['methane', 'ch4'], 45)
    const c2h2 = getVal(['acetylene', 'c2h2'], 3.2)
    const c2h4 = getVal(['ethylene', 'c2h4'], 35)
    const c2h6 = getVal(['ethane', 'c2h6'], 28)
    const co = getVal(['carbonMonoxide', 'co'], 420)
    const co2 = getVal(['carbonDioxide', 'co2'], 3200)
    const oilTemp = getVal(['oilTemperature', 'oilTemp', 'topOilTemp'], 64)
    const hotSpotTemp = getVal(['hotSpotTemp', 'windingTemperature', 'windingTemp'], oilTemp + 14)
    const moisture = getVal(['moisture', 'moistureInOil', 'waterContent'], 22)
    const loadPct = getVal(['load', 'loadPercentage', 'loadCurrent'], 74)
    const ratedKva = nameplate?.ratedKva ? Number(nameplate.ratedKva) : 2500
    const loadKva = Math.round((loadPct / 100) * ratedKva)
    const voltageKv = parseFloat(nameplate?.voltageClass || transformer?.voltage || '115') || 115

    return {
      h2, ch4, c2h2, c2h4, c2h6, co, co2,
      oilTemp, hotSpotTemp, moisture, loadPct,
      ratedKva, loadKva, voltageKv,
      measured: {
        dga: has(['hydrogen', 'h2']) || has(['acetylene', 'c2h2']),
        oilTemp: has(['oilTemperature', 'oilTemp', 'topOilTemp']),
        // hotSpotTemp falls back to oilTemp + 14 — a fixed offset standing in
        // for a load-dependent winding gradient, not a measurement.
        hotSpotTemp: has(['hotSpotTemp', 'windingTemperature', 'windingTemp']),
        moisture: has(['moisture', 'moistureInOil', 'waterContent']),
        load: has(['load', 'loadPercentage', 'loadCurrent']),
      },
    }
  }, [transformer?.sensors, nameplate, transformer?.voltage])

  // ── Dynamic Duval T1 verdict from live DGA gases ───────────────────────────────────────
  const computedDuvalVerdict = useMemo(() => {
    if (!liveTelemetry.measured.dga) return undefined
    const tot = liveTelemetry.ch4 + liveTelemetry.c2h4 + liveTelemetry.c2h2
    if (tot <= 0) return undefined
    const pTop  = (liveTelemetry.ch4  / tot) * 100
    const pRight = (liveTelemetry.c2h4 / tot) * 100
    const pLeft  = (liveTelemetry.c2h2 / tot) * 100
    if (pTop >= 98) return 'PD — Partial Discharge'
    if (pLeft < 4 && pRight < 20) return 'T1 — Thermal Fault (< 300°C)'
    if (pLeft < 4 && pRight >= 20 && pRight < 50) return 'T2 — Thermal Fault (300°C–700°C)'
    if (pLeft < 15 && pRight >= 50) return 'T3 — Thermal Fault (> 700°C)'
    if (pLeft >= 13 && pRight < 23) return 'D1 — Low Energy Discharge'
    if (pLeft >= 13 && pRight >= 23) return 'D2 — High Energy Arcing'
    return 'DT — Mixed Thermal & Electrical'
  }, [liveTelemetry.ch4, liveTelemetry.c2h4, liveTelemetry.c2h2, liveTelemetry.measured.dga])

  // ── Dynamic RTT (days to C2H2 threshold) ─────────────────────────────────────────
  const computedRttDays = useMemo(() => {
    if (!liveTelemetry.measured.dga) return undefined
    const c2h2 = liveTelemetry.c2h2
    if (c2h2 <= 0) return undefined
    if (c2h2 >= 35) return 0
    // Conservative estimate: 1.2% daily accumulation rate from current level
    const ratePerDay = Math.max(0.05, c2h2 * 0.012)
    return Math.min(365, Math.round((35 - c2h2) / ratePerDay))
  }, [liveTelemetry.c2h2, liveTelemetry.measured.dga])

  // ── Dynamic DP (Degree of Polymerization) via IEEE C57.91 Arrhenius ────────────────
  const computedDpAging = useMemo(() => {
    const measured = liveTelemetry.measured.hotSpotTemp || liveTelemetry.measured.oilTemp
    if (!measured) return undefined
    const faa = Math.exp(15000 / (110 + 273.15) - 15000 / (liveTelemetry.hotSpotTemp + 273.15))
    return Math.round(Math.max(200, 1000 - ((52000 * faa) / 180000) * 800))
  }, [liveTelemetry.hotSpotTemp, liveTelemetry.measured.hotSpotTemp, liveTelemetry.measured.oilTemp])

  // ── Dynamic bushing status from live sensor ───────────────────────────────────
  const computedBushingStatus = useMemo(() => {
    const td = transformer?.sensors?.bushingTanDelta?.value ?? null
    if (td == null) return 'Not Measured (No Bushing Sensor Installed)'
    if (td > 1.0) return `CRITICAL — tan δ: ${td.toFixed(3)}% (exceeds 1.0% limit per IEEE C57.19)`
    if (td > 0.5) return `WARNING — tan δ: ${td.toFixed(3)}% (elevated, monitor closely)`
    return `Normal — tan δ: ${td.toFixed(3)}%`
  }, [transformer?.sensors?.bushingTanDelta?.value])

  const [mobileTab, setMobileTab] = useState<'overview' | 'visuals' | 'charts' | 'logs' | 'diagnostics'>('overview')
  // Inline tabs are the two panels an operator reads while deciding something
  // now: the dissolved-gas verdict and the live dynamic rating. Everything
  // else is a periodic study and opens as a modal — see StudyModal's header.
  const [pdmSubTab, setPdmSubTab] = useState<'dga' | 'dtr'>('dga')
  type StudyId = 'rul' | 'bess' | 'bushing' | 'threats' | 'labdga' | 'fleetrisk'
  const [activeStudy, setActiveStudy] = useState<StudyId | null>(null)
  const [dossierExporting, setDossierExporting] = useState(false)
  const [showCopilotDrawer, setShowCopilotDrawer] = useState(false)
  const [showPdmStudioModal, setShowPdmStudioModal] = useState(false)
  const [fullscreenPdmTab, setFullscreenPdmTab] = useState<'dga' | 'dtr' | 'bushing' | 'threats'>('dga')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPdmStudioModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleExportOfficialDossier = async () => {
    // The export button renders inside the loaded view, but `transformer` is
    // undefined until the fleet host resolves — an export fired during that
    // window would throw on transformer.id rather than tell the user why.
    if (!transformer) { toast.error('Asset is still loading — try again in a moment'); return }
    const bushingTanDeltaLive = transformer.sensors?.bushingTanDelta?.value ?? null
    const dtr = conservativeDynamicRating(liveTelemetry.ratedKva, transformer.sensors?.ambientTemperature?.value)
    setDossierExporting(true)
    try {
      await generateOfficialEngineeringDossier({
        assetId: transformer.id || 'TR-01',
        assetName: transformer.name || 'Main Substation TR-01',
        orgId: transformer.orgId || orgId,
        orgName: currentOrgName,
        ratedKva: liveTelemetry.ratedKva,
        voltageKv: liveTelemetry.voltageKv,
        healthIndex: transformer.healthIndex ?? 88,
        oilTemp: liveTelemetry.oilTemp,
        hotSpotTemp: liveTelemetry.hotSpotTemp,
        // Was nameplate * 1.146 — a constant, so this PDF claimed 114.6% of
        // nameplate on a 40 degC windless day with natural cooling only, where
        // the real model gives ~80%. Now the shared conservative model.
        dtrCapacityKva: dtr.dynamicRatingKva,
        dtrHeadroomKva: Math.max(0, dtr.dynamicRatingKva - liveTelemetry.loadKva),
        // These four were hardcoded literals, so EVERY asset in EVERY org
        // exported a PDF asserting the same T2 thermal fault, the same 38-day
        // time-to-trip, the same 0.82% bushing tan-delta and the same 590 DP —
        // as measurements of that specific unit. The platform does not compute
        // a Duval verdict or an RTT in this code path, so the report now says
        // so rather than inventing one; tan-delta and DP come from the device
        // when it publishes them, and are reported as unavailable when it does
        // not.
        duvalVerdict: 'Not computed in this export',
        rttDays: 0,
        bushingPhaseBStatus: bushingTanDeltaLive != null ? 'Measured' : 'No bushing sensor configured',
        bushingTanDelta: bushingTanDeltaLive ?? 0,
        dpAging: 0,
        moisturePpm: liveTelemetry.moisture,
        // Only real gas readings reach the PDF; when the unit publishes no DGA
        // the report prints zeros and its gas section says so, rather than
        // certifying seven catalogue constants as this asset's measurements.
        gases: liveTelemetry.measured.dga ? {
          h2: liveTelemetry.h2,
          ch4: liveTelemetry.ch4,
          c2h2: liveTelemetry.c2h2,
          c2h4: liveTelemetry.c2h4,
          c2h6: liveTelemetry.c2h6,
          co: liveTelemetry.co,
          co2: liveTelemetry.co2,
        } : { h2: 0, ch4: 0, c2h2: 0, c2h4: 0, c2h6: 0, co: 0, co2: 0 },
        gasesMeasured: liveTelemetry.measured.dga,
      })
      toast.success(`ดาวน์โหลดรายงานสรุปค่าที่วัดได้ (${currentOrgName}) เรียบร้อยแล้ว`)
    } catch (err) {
      toast.error('ไม่สามารถสร้างรายงาน PDF ได้: ' + (err as Error).message)
    } finally {
      setDossierExporting(false)
    }
  }
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
      const reading = transformer.sensors[field]
      if (!reading) continue
      out.push({ key, label: paramLabel(key), icon: cardIcon(key), layout: layoutOf(key), reading })
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
  // and custom chart builder — but for Customer/Viewer (!canConfigure), it strictly scopes
  // to the configured SENSOR READINGS cards so hidden/restricted parameters are not exposed.
  const modalParams: ModalParam[] = useMemo(() => {
    const paramMap = new Map<string, ModalParam>()
    // 1. Add all cards currently configured & permitted to be displayed
    for (const c of cards) {
      paramMap.set(c.key, { key: c.key, label: c.label, unit: c.reading.unit || undefined })
    }
    // 2. Only for Admin (canConfigure), also add other reported parameters for studio/custom configuration
    if (canConfigure && values) {
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
  }, [cards, values, schemaByKey, paramLabel, canConfigure])

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

  const renderPdmStudioBody = (isFullscreen = false) => {
    const currentTab = isFullscreen ? fullscreenPdmTab : pdmSubTab
    return (
      <div className="space-y-6">
        {/* Sub-Tab 1: DGA, RUL, Trajectory, and IEEE C57.104 RoG */}
        {currentTab === 'dga' && (
          <div className="space-y-6">
            <div className={clsx(
              'flex flex-col gap-6',
              isFullscreen ? 'xl:grid xl:grid-cols-2 xl:gap-8' : '2xl:flex-row 2xl:gap-8'
            )}>
              <div className={clsx('flex-1 min-w-[320px]', isFullscreen && 'bg-[#0a0e1a] p-4 rounded-2xl border border-slate-800/80 shadow-md')}>
                <DgaDuvalTriangle
                  gasesMeasured={liveTelemetry.measured.dga}
                  h2={liveTelemetry.h2}
                  ch4={liveTelemetry.ch4}
                  c2h4={liveTelemetry.c2h4}
                  c2h2={liveTelemetry.c2h2}
                  c2h6={liveTelemetry.c2h6}
                />
              </div>
              {!isFullscreen && <div className="hidden 2xl:block w-px bg-[#1e2433]" />}
              <div className={clsx('flex-1 min-w-[320px]', isFullscreen && 'bg-[#0a0e1a] p-4 rounded-2xl border border-slate-800/80 shadow-md')}>
                <InsulationAgingRul 
                  inputsMeasured={Boolean(liveTelemetry.measured.oilTemp && liveTelemetry.measured.load)}
                  hotSpotTemp={liveTelemetry.hotSpotTemp} 
                  hoursInService={
                    nameplate?.yearInstalled
                      ? Math.max(100, Math.round((new Date().getFullYear() - nameplate.yearInstalled) * 8760))
                      : 52000
                  } 
                  oilTemp={liveTelemetry.oilTemp}
                  moistureInOil={liveTelemetry.moisture}
                  assetId={transformer.id || 'TRF-01'}
                />
              </div>
            </div>

            {/* IEEE C57.104-2019 DGA Gas Generation Rate (RoG) Matrix */}
            <div className={clsx('pt-4 border-t border-slate-800 space-y-3', isFullscreen && 'bg-[#0a0e1a] p-4 rounded-2xl border border-slate-800/80 shadow-md')}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-emerald-400" />
                  <h4 className="text-xs font-bold text-white">Dissolved Gas Generation Rates (IEEE C57.104-2019)</h4>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                  style={liveTelemetry.measured.dga
                    ? { background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)' }
                    : { background: 'rgba(100,116,139,0.1)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)' }
                  }>
                  {liveTelemetry.measured.dga ? 'Live DGA — Snapshot Reading' : 'No DGA Sensor — Rates Unavailable'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                      <th className="py-2 px-2.5">Gas Species</th>
                      <th className="py-2 px-2.5">Current (ppm)</th>
                      <th className="py-2 px-2.5">24h Rate (Δppm/day)</th>
                      <th className="py-2 px-2.5">7d Rate (Δppm/day)</th>
                      <th className="py-2 px-2.5">90th %ile Limit</th>
                      <th className="py-2 px-2.5">Condition Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {[
                      { gas: 'Hydrogen (H2)', val: liveTelemetry.h2, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '100 ppm', cond: liveTelemetry.h2 > 300 ? 'Cond 4 (Action)' : liveTelemetry.h2 > 100 ? 'Cond 3 (Warning)' : liveTelemetry.h2 > 10 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.h2 > 300 ? '#ef4444' : liveTelemetry.h2 > 100 ? '#f97316' : liveTelemetry.h2 > 10 ? '#fbbf24' : '#4ade80' },
                      { gas: 'Methane (CH4)', val: liveTelemetry.ch4, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '120 ppm', cond: liveTelemetry.ch4 > 400 ? 'Cond 4 (Action)' : liveTelemetry.ch4 > 120 ? 'Cond 3 (Warning)' : liveTelemetry.ch4 > 30 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.ch4 > 400 ? '#ef4444' : liveTelemetry.ch4 > 120 ? '#f97316' : liveTelemetry.ch4 > 30 ? '#fbbf24' : '#4ade80' },
                      { gas: 'Acetylene (C2H2)', val: liveTelemetry.c2h2, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '2 ppm', cond: liveTelemetry.c2h2 > 35 ? 'Cond 4 (Action)' : liveTelemetry.c2h2 > 9 ? 'Cond 3 (Warning)' : liveTelemetry.c2h2 > 1 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h2 > 35 ? '#ef4444' : liveTelemetry.c2h2 > 9 ? '#f97316' : liveTelemetry.c2h2 > 1 ? '#fbbf24' : '#4ade80' },
                      { gas: 'Ethylene (C2H4)', val: liveTelemetry.c2h4, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '50 ppm', cond: liveTelemetry.c2h4 > 100 ? 'Cond 4 (Action)' : liveTelemetry.c2h4 > 50 ? 'Cond 3 (Warning)' : liveTelemetry.c2h4 > 12 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h4 > 100 ? '#ef4444' : liveTelemetry.c2h4 > 50 ? '#f97316' : liveTelemetry.c2h4 > 12 ? '#fbbf24' : '#4ade80' },
                      { gas: 'Ethane (C2H6)', val: liveTelemetry.c2h6, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '90 ppm', cond: liveTelemetry.c2h6 > 280 ? 'Cond 4 (Action)' : liveTelemetry.c2h6 > 90 ? 'Cond 3 (Warning)' : liveTelemetry.c2h6 > 20 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h6 > 280 ? '#ef4444' : liveTelemetry.c2h6 > 90 ? '#f97316' : liveTelemetry.c2h6 > 20 ? '#fbbf24' : '#4ade80' },
                      { gas: 'Carbon Monoxide (CO)', val: liveTelemetry.co, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '900 ppm', cond: liveTelemetry.co > 2500 ? 'Cond 4 (Action)' : liveTelemetry.co > 900 ? 'Cond 3 (Warning)' : liveTelemetry.co > 350 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.co > 2500 ? '#ef4444' : liveTelemetry.co > 900 ? '#f97316' : liveTelemetry.co > 350 ? '#fbbf24' : '#4ade80' },
                    ].map((row) => (
                      <tr key={row.gas} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-2 px-2.5 font-sans font-medium text-slate-200">{row.gas}</td>
                        <td className="py-2 px-2.5 font-bold text-white">{row.val}</td>
                        <td className="py-2 px-2.5 text-cyan-300">{row.rog24}</td>
                        <td className="py-2 px-2.5 text-slate-300">{row.rog7d}</td>
                        <td className="py-2 px-2.5 text-slate-400">{row.limit}</td>
                        <td className="py-2 px-2.5">
                          <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ color: row.color, backgroundColor: `${row.color}15`, border: `1px solid ${row.color}30` }}>
                            {row.cond}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Tab 2: Dynamic Thermal Rating */}
        {currentTab === 'dtr' && (
          <DynamicThermalRating
            nameplateKva={liveTelemetry.ratedKva}
            currentLoadKva={liveTelemetry.loadKva}
            oilTemp={liveTelemetry.oilTemp}
            hotSpotTemp={liveTelemetry.hotSpotTemp}
            lat={transformer.lat ?? 13.7563}
            lng={transformer.lng ?? 100.5018}
            assetId={transformer.id}
            assetName={transformer.name}
          />
        )}

        {/* Sub-Tab 3: Bushing Health & Tan-Delta (tan δ) */}
        {currentTab === 'bushing' && (
          <BushingHealthStudio
            voltageKv={liveTelemetry.voltageKv}
            assetId={transformer.id}
            assetName={transformer.name}
            orgName={currentOrgName}
            isSensorInstalled={Boolean(transformer.sensors?.bushingTanDelta || transformer.sensors?.partialDischarge)}
            bushingTanDeltaLive={transformer.sensors?.bushingTanDelta?.value ?? null}
            partialDischargeLive={transformer.sensors?.partialDischarge?.value ?? null}
          />
        )}

        {/* Sub-Tab 4: 5-Threats & OLTC Multi-Hazard Studio */}
        {currentTab === 'threats' && (
          <SubstationThreatsStudio
            assetId={transformer.id}
            assetName={transformer.name}
            orgName={currentOrgName}
            voltageKv={liveTelemetry.voltageKv}
            mainOilTemp={liveTelemetry.oilTemp}
            bushingTanDelta={transformer.sensors?.bushingTanDelta?.value ?? 0}
            hasArresterSensor={Boolean(transformer.sensors?.surgeArresterCurrent || transformer.sensors?.surgeCounter)}
            hasOltcSensor={Boolean(transformer.sensors?.oltcMotorCurrent || transformer.sensors?.oltcOilTempDelta)}
            surgeArresterCurrentLive={transformer.sensors?.surgeArresterCurrent?.value ?? null}
            surgeCounterLive={transformer.sensors?.surgeCounter?.value ?? null}
            oltcMotorCurrentLive={transformer.sensors?.oltcMotorCurrent?.value ?? null}
            oltcOilTempDeltaLive={transformer.sensors?.oltcOilTempDelta?.value ?? null}
          />
        )}
      </div>
    )
  }

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
            <Link
              href={`/admin/trends?domain=transformer&devices=${encodeURIComponent(transformer.id)}${siteId ? `&siteId=${encodeURIComponent(siteId)}` : ''}`}
              title="Compare this transformer's trends with other fleet devices"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-emerald-300 hover:text-white bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 transition-colors shadow-sm"
            >
              <TrendingUp size={12} className="text-emerald-400" />
              <span className="hidden sm:inline">Compare Trends</span>
            </Link>
            <NodeReportButton nodeId={transformer.id} deviceName={transformer.name} domain="transformer" />
            {/* No role gate: the backend's 'node' policy has already proved this
                caller may read this device, so anyone who can see the page may
                export what is on it. */}
            <button onClick={() => setExporting(true)} title="Export this device's data for a date range"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
              <Share2 size={12} /> <span className="hidden xs:inline">Export</span>
            </button>
            <button
              onClick={() => setShowPdmStudioModal(true)}
              title="Open Fullscreen PdM Studio Workspace (เต็มจอ)"
              className="p-1.5 rounded-lg hover:bg-indigo-600/20 text-slate-400 hover:text-indigo-300 border border-transparent hover:border-indigo-500/30 transition-colors"
            >
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
            { id: 'diagnostics', label: 'PdM', icon: <ShieldCheck size={13} /> },
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
          (mobileTab === 'visuals' || mobileTab === 'charts' || mobileTab === 'diagnostics') ? 'flex' : 'hidden lg:flex'
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

          {/* Diagnostics Section (Visible on Desktop OR when mobileTab === 'diagnostics') */}
          <div className={mobileTab === 'diagnostics' ? 'block' : 'hidden lg:block'}>
            <div className="rounded-2xl p-4 mt-4 lg:mt-0 lg:mb-4 lg:mx-0 space-y-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
              {/* 🚨 Layer 1-3: Hardware Collision & Stream Arbitration Banner */}
              {presence?.identity_conflict_at && !conflictDismissed && (
                <div
                  className="rounded-xl border border-rose-500/60 p-3.5 sm:p-4 mb-3 relative overflow-hidden"
                  style={{ background: 'linear-gradient(135deg, rgba(225,29,72,0.15) 0%, rgba(13,17,23,0.95) 100%)' }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="p-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
                          <AlertTriangle size={15} />
                        </span>
                        <span className="text-xs font-bold text-rose-200">
                          ตรวจพบฮาร์ดแวร์ส่งข้อมูลชนกัน (Duplicate Hardware Stream Collision)
                        </span>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40">
                          No-MAC Auto-Protection Active
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        ตรวจพบอุปกรณ์ 2 ตัวแย่งส่งข้อมูลเข้า <span className="font-mono text-amber-300">{transformer.id}</span> 
                        (วิเคราะห์จาก Uptime Regression สลับขั้ว &amp; Physical Slew-Rate Jumps แม้ฮาร์ดแวร์ไม่ส่ง MAC)
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setShowArbitrationModal(true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <span>⚖️ จัดการการรวมข้อมูล (Arbitration Panel)</span>
                      </button>
                      <button
                        onClick={() => setConflictDismissed(true)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 transition-all text-xs cursor-pointer"
                        title="ซ่อนแถบเตือนชั่วคราว"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 3-Tier Active Shields */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-rose-500/20 text-[11px]">
                    <div className="flex items-center gap-1.5 text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span><strong>ชั้นที่ 1 Slew-Rate Filter:</strong> กรองสไปก์ ป้องกัน False Alarm</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span><strong>ชั้นที่ 2 Max-Select (IEC 61508):</strong> ยึดค่าอุณหภูมิปลอดภัยสูงสุด</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-indigo-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      <span><strong>ชั้นที่ 3 Stream Quarantine:</strong> ปกป้องฐานข้อมูลประวัติศาสตร์</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Executive PdM Summary Hero Card */}
              <div className="p-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-slate-900/80 to-[#0a0e1a] shadow-sm mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                        <ShieldCheck size={16} />
                      </span>
                      <span className="text-xs font-bold text-white">PdM Asset Intelligence Executive Summary</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/30 font-mono font-bold">
                        IEEE C57.104
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono">
                        Duval: <strong className="text-amber-300">{computedDuvalVerdict ? computedDuvalVerdict.split('—')[0].trim() : 'Active'}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono">
                        RTT: <strong className="text-cyan-300">{computedRttDays != null ? `${computedRttDays}d` : '—'}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono">
                        DP: <strong className="text-emerald-300">{computedDpAging ?? 'Healthy'}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono truncate max-w-[210px]" title={computedBushingStatus}>
                        Bushing: <strong className="text-purple-300">{computedBushingStatus.split('—')[0].trim()}</strong>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowPdmStudioModal(true)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center justify-center gap-1.5 shadow-md border border-indigo-400/40 cursor-pointer shrink-0"
                  >
                    <Maximize2 size={13} />
                    <span>เปิด PdM Studio เต็มจอ (Fullscreen) ↗</span>
                  </button>
                </div>
              </div>

              {/* PdM Advanced Studio Sub-Tabs Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">Predictive Maintenance &amp; Asset Intelligence Studio</h3>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-mono">
                    Tier-1 Advanced IIoT
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setShowPdmStudioModal(true)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/50 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="Open Fullscreen PdM Studio Workspace"
                    >
                      <Maximize2 size={12} />
                      <span>⛶ เต็มจอ</span>
                    </button>
                    <button
                      onClick={handleExportOfficialDossier}
                      disabled={dossierExporting}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="Export a 5-page PDF summary of this asset's current telemetry and platform-computed estimates. Not a certified inspection record."
                    >
                      <Download size={12} className={dossierExporting ? 'animate-bounce' : ''} />
                      <span>{dossierExporting ? 'Generating Summary...' : '📑 Export Summary'}</span>
                    </button>
                    <button
                      onClick={() => setShowCopilotDrawer(true)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="Open Ask AI Diagnostics"
                    >
                      <Bot size={13} />
                      <span>🤖 Ask AI</span>
                    </button>
                    <button
                      onClick={() => setActiveStudy('labdga')}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="Import certified ASTM D3612 oil syringe test results"
                    >
                      <FlaskConical size={13} />
                      <span>🧪 Lab DGA</span>
                    </button>
                    <button
                      onClick={() => setActiveStudy('fleetrisk')}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="Open Fleet Risk Matrix (ISO 55000)"
                    >
                      <Building2 size={13} />
                      <span>🏢 Fleet Risk</span>
                    </button>
                    <button
                      onClick={() => {
                        const s = useAudioChimeStore.getState().getSettingsForOrg(targetOrgId)
                        useAudioChimeStore.getState().updateOrgSettings(targetOrgId, { enabled: !s.enabled })
                        if (!s.enabled) {
                          useAudioChimeStore.getState().playChime(targetOrgId, 'conflict')
                        }
                      }}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm border cursor-pointer',
                        orgAudioSettings.enabled
                          ? 'bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border-purple-500/40'
                          : 'bg-slate-800/40 hover:bg-slate-800/60 text-slate-500 border-slate-700/50'
                      )}
                      title={orgAudioSettings.enabled ? 'Web Audio Chime: เปิดอยู่ (คลิกเพื่อปิด)' : 'Web Audio Chime: ปิดเสียงอยู่ (คลิกเพื่อเปิด)'}
                    >
                      {orgAudioSettings.enabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                      <span>{orgAudioSettings.enabled ? '🔊 Chime' : '🔇 Muted'}</span>
                    </button>
                  </div>
                </div>

                <div data-pdm-tabs className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 overflow-x-auto">
                  {[
                    { id: 'dga' as const, label: '🔬 Dissolved Gas (Duval)' },
                    { id: 'dtr' as const, label: '⚡ Live Dynamic Rating' },
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setPdmSubTab(sub.id)}
                      className={clsx(
                        'text-xs px-3.5 py-1.5 rounded-md font-semibold transition-all whitespace-nowrap cursor-pointer',
                        pdmSubTab === sub.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      )}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-Tab 1: DGA, RUL, Trajectory, and IEEE C57.104 RoG */}
              {pdmSubTab === 'dga' && (
                <div className="space-y-6">
                  <DgaDuvalTriangle
                    gasesMeasured={liveTelemetry.measured.dga}
                    h2={liveTelemetry.h2}
                    ch4={liveTelemetry.ch4}
                    c2h4={liveTelemetry.c2h4}
                    c2h2={liveTelemetry.c2h2}
                    c2h6={liveTelemetry.c2h6}
                  />

                  {/* IEEE C57.104-2019 DGA Gas Generation Rate (RoG) Matrix */}
                  <div className="pt-4 border-t border-slate-800 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Activity size={15} className="text-emerald-400" />
                        <h4 className="text-xs font-bold text-white">Dissolved Gas Generation Rates (IEEE C57.104-2019)</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                        style={liveTelemetry.measured.dga
                          ? { background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)' }
                          : { background: 'rgba(100,116,139,0.1)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)' }
                        }>
                        {liveTelemetry.measured.dga ? 'Live DGA — Snapshot Reading' : 'No DGA Sensor — Rates Unavailable'}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                            <th className="py-2 px-2.5">Gas Species</th>
                            <th className="py-2 px-2.5">Current (ppm)</th>
                            <th className="py-2 px-2.5">24h Rate (Δppm/day)</th>
                            <th className="py-2 px-2.5">7d Rate (Δppm/day)</th>
                            <th className="py-2 px-2.5">90th %ile Limit</th>
                            <th className="py-2 px-2.5">Condition Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                          {[
                            { gas: 'Hydrogen (H2)', val: liveTelemetry.h2, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '100 ppm', cond: liveTelemetry.h2 > 300 ? 'Cond 4 (Action)' : liveTelemetry.h2 > 100 ? 'Cond 3 (Warning)' : liveTelemetry.h2 > 10 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.h2 > 300 ? '#ef4444' : liveTelemetry.h2 > 100 ? '#f97316' : liveTelemetry.h2 > 10 ? '#fbbf24' : '#4ade80' },
                            { gas: 'Methane (CH4)', val: liveTelemetry.ch4, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '120 ppm', cond: liveTelemetry.ch4 > 400 ? 'Cond 4 (Action)' : liveTelemetry.ch4 > 120 ? 'Cond 3 (Warning)' : liveTelemetry.ch4 > 30 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.ch4 > 400 ? '#ef4444' : liveTelemetry.ch4 > 120 ? '#f97316' : liveTelemetry.ch4 > 30 ? '#fbbf24' : '#4ade80' },
                            { gas: 'Acetylene (C2H2)', val: liveTelemetry.c2h2, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '2 ppm', cond: liveTelemetry.c2h2 > 35 ? 'Cond 4 (Action)' : liveTelemetry.c2h2 > 9 ? 'Cond 3 (Warning)' : liveTelemetry.c2h2 > 1 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h2 > 35 ? '#ef4444' : liveTelemetry.c2h2 > 9 ? '#f97316' : liveTelemetry.c2h2 > 1 ? '#fbbf24' : '#4ade80' },
                            { gas: 'Ethylene (C2H4)', val: liveTelemetry.c2h4, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '50 ppm', cond: liveTelemetry.c2h4 > 100 ? 'Cond 4 (Action)' : liveTelemetry.c2h4 > 50 ? 'Cond 3 (Warning)' : liveTelemetry.c2h4 > 12 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h4 > 100 ? '#ef4444' : liveTelemetry.c2h4 > 50 ? '#f97316' : liveTelemetry.c2h4 > 12 ? '#fbbf24' : '#4ade80' },
                            { gas: 'Ethane (C2H6)', val: liveTelemetry.c2h6, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '90 ppm', cond: liveTelemetry.c2h6 > 280 ? 'Cond 4 (Action)' : liveTelemetry.c2h6 > 90 ? 'Cond 3 (Warning)' : liveTelemetry.c2h6 > 20 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.c2h6 > 280 ? '#ef4444' : liveTelemetry.c2h6 > 90 ? '#f97316' : liveTelemetry.c2h6 > 20 ? '#fbbf24' : '#4ade80' },
                            { gas: 'Carbon Monoxide (CO)', val: liveTelemetry.co, rog24: liveTelemetry.measured.dga ? 'history req.' : '—', rog7d: liveTelemetry.measured.dga ? 'history req.' : '—', limit: '900 ppm', cond: liveTelemetry.co > 2500 ? 'Cond 4 (Action)' : liveTelemetry.co > 900 ? 'Cond 3 (Warning)' : liveTelemetry.co > 350 ? 'Cond 2 (Caution)' : 'Cond 1 (Normal)', color: liveTelemetry.co > 2500 ? '#ef4444' : liveTelemetry.co > 900 ? '#f97316' : liveTelemetry.co > 350 ? '#fbbf24' : '#4ade80' },
                          ].map((row) => (
                            <tr key={row.gas} className="hover:bg-slate-900/40 transition-colors">
                              <td className="py-2 px-2.5 font-sans font-medium text-slate-200">{row.gas}</td>
                              <td className="py-2 px-2.5 font-bold text-white">{row.val}</td>
                              <td className="py-2 px-2.5 text-cyan-300">{row.rog24}</td>
                              <td className="py-2 px-2.5 text-slate-300">{row.rog7d}</td>
                              <td className="py-2 px-2.5 text-slate-400">{row.limit}</td>
                              <td className="py-2 px-2.5">
                                <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ color: row.color, backgroundColor: `${row.color}15`, border: `1px solid ${row.color}30` }}>
                                  {row.cond}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Tab 2: Dynamic Thermal Rating (DTR) & BESS Co-Optimization */}
              {pdmSubTab === 'dtr' && (
                <DynamicThermalRating
                  nameplateKva={liveTelemetry.ratedKva}
                  currentLoadKva={liveTelemetry.loadKva}
                  oilTemp={liveTelemetry.oilTemp}
                  hotSpotTemp={liveTelemetry.hotSpotTemp}
                  lat={transformer.lat ?? 13.7563}
                  lng={transformer.lng ?? 100.5018}
                  assetId={transformer.id}
                  assetName={transformer.name}
                />
              )}

              {/* Engineering studies — periodic / planning work, opened on
                  demand rather than occupying the live monitoring surface. */}
              <div className="pt-4 mt-4 border-t border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <Sliders size={13} className="text-slate-400" />
                  <h4 className="text-xs font-bold text-white">Engineering Studies</h4>
                  <span className="text-[10px] text-slate-500">opened on demand — not live monitoring</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {([
                    { id: 'rul' as const, label: 'Insulation Aging & RUL', hint: 'IEEE C57.91' },
                    { id: 'bushing' as const, label: 'Bushing Health (tan δ)', hint: 'IEEE C57.19' },
                    { id: 'threats' as const, label: '5-Threats & OLTC', hint: 'IEC 60099-5 · C57.131' },
                    { id: 'bess' as const, label: 'BESS Peak Shaving', hint: 'what-if study' },
                    { id: 'labdga' as const, label: 'Laboratory DGA', hint: 'ASTM D3612' },
                    { id: 'fleetrisk' as const, label: 'Fleet Risk Matrix', hint: 'ISO 55000' },
                  ]).map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setActiveStudy(st.id)}
                      className="text-left px-3 py-2 rounded-lg border border-slate-800 bg-[#0a0e1a] hover:border-indigo-500/50 hover:bg-slate-900/60 transition-all"
                    >
                      <div className="text-xs font-semibold text-slate-200">{st.label}</div>
                      <div className="text-[10px] text-slate-500">{st.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
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
          canEditThresholds={canConfigure}
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

      {/* GenAI Diagnostics Copilot Slide-over Drawer */}
      {showCopilotDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all animate-fade-in">
          <div className="w-full max-w-2xl h-full bg-[#0d1117] border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-[#0a0e1a]">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Industrial GenAI Diagnostics Copilot</h3>
                  <p className="text-[11px] text-slate-400">{transformer.name} · {currentOrgName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCopilotDrawer(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <GenAiDiagnosticsCopilot
                assetId={transformer.id}
                assetName={transformer.name}
                orgId={transformer.orgId || orgId}
                orgName={currentOrgName}
                dgaGases={{
                  h2: liveTelemetry.h2,
                  ch4: liveTelemetry.ch4,
                  c2h2: liveTelemetry.c2h2,
                  c2h4: liveTelemetry.c2h4,
                  c2h6: liveTelemetry.c2h6,
                  co: liveTelemetry.co,
                  co2: liveTelemetry.co2,
                }}
                bushingTanDeltaLive={transformer.sensors?.bushingTanDelta?.value ?? null}
                partialDischargeLive={transformer.sensors?.partialDischarge?.value ?? null}
                duvalVerdict={computedDuvalVerdict}
                rttDays={computedRttDays}
                oilTemp={liveTelemetry.oilTemp}
                hotSpotTemp={liveTelemetry.hotSpotTemp}
                dtrHeadroomKva={Math.max(0, conservativeDynamicRating(liveTelemetry.ratedKva, transformer.sensors?.ambientTemperature?.value).dynamicRatingKva - liveTelemetry.loadKva)}
                bushingStatus={computedBushingStatus}
                dpAging={computedDpAging}
                moisturePpm={liveTelemetry.moisture}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Engineering studies ────────────────────────────────────────
          Each of these is periodic or planning work rather than something an
          operator watches, so they open on demand instead of taking up the
          live monitoring surface. StudyModal supplies Escape/backdrop close,
          focus handling and scroll lock, which the two hand-rolled dialogs
          this replaced did not have. */}
      <StudyModal
        open={activeStudy === 'rul'}
        onClose={() => setActiveStudy(null)}
        title="Insulation Aging & Remaining Life (IEEE C57.91)"
        subtitle={`Arrhenius aging estimate · ${transformer.name}`}
        icon={<Activity size={20} />}
        accent="amber"
      >
        <InsulationAgingRul
          inputsMeasured={Boolean(liveTelemetry.measured.oilTemp && liveTelemetry.measured.load)}
          hotSpotTemp={liveTelemetry.hotSpotTemp}
          hoursInService={
            nameplate?.yearInstalled
              ? Math.max(100, Math.round((new Date().getFullYear() - nameplate.yearInstalled) * 8760))
              : 52000
          }
          oilTemp={liveTelemetry.oilTemp}
          moistureInOil={liveTelemetry.moisture}
          assetId={transformer.id || 'TRF-01'}
        />
      </StudyModal>

      <StudyModal
        open={activeStudy === 'bushing'}
        onClose={() => setActiveStudy(null)}
        title="Bushing Health & Tan-Delta (IEEE C57.19)"
        subtitle={`Periodic offline test review · ${transformer.name}`}
        icon={<Zap size={20} />}
        accent="indigo"
      >
        <BushingHealthStudio
          voltageKv={liveTelemetry.voltageKv}
          assetId={transformer.id}
          assetName={transformer.name}
          orgName={currentOrgName}
          isSensorInstalled={Boolean(transformer.sensors?.bushingTanDelta || transformer.sensors?.partialDischarge)}
        />
      </StudyModal>

      <StudyModal
        open={activeStudy === 'threats'}
        onClose={() => setActiveStudy(null)}
        title="5-Threats & OLTC (IEC 60099-5 · IEEE C57.131)"
        subtitle={`Surge arrester, tap changer and site hazards · ${transformer.name}`}
        icon={<AlertTriangle size={20} />}
        accent="rose"
      >
        <SubstationThreatsStudio
          assetId={transformer.id}
          assetName={transformer.name}
          orgName={currentOrgName}
          voltageKv={liveTelemetry.voltageKv}
          mainOilTemp={liveTelemetry.oilTemp}
          bushingTanDelta={transformer.sensors?.bushingTanDelta?.value ?? 0}
          hasArresterSensor={Boolean(transformer.sensors?.surgeArresterCurrent || transformer.sensors?.surgeCounter)}
          hasOltcSensor={Boolean(transformer.sensors?.oltcMotorCurrent || transformer.sensors?.oltcOilTempDelta)}
        />
      </StudyModal>

      <StudyModal
        open={activeStudy === 'bess'}
        onClose={() => setActiveStudy(null)}
        title="BESS Peak Shaving Co-Optimization"
        subtitle={`What-if study · ${transformer.name}`}
        icon={<Battery size={20} />}
        accent="emerald"
      >
        <BessCoOptimization
          transformerName={transformer.name}
          orgName={currentOrgName}
          nameplateKva={liveTelemetry.ratedKva}
          currentLoadKva={liveTelemetry.loadKva}
          hotSpotTemp={liveTelemetry.hotSpotTemp}
          dtrHeadroomKva={Math.max(0, conservativeDynamicRating(liveTelemetry.ratedKva, transformer.sensors?.ambientTemperature?.value).dynamicRatingKva - liveTelemetry.loadKva)}
        />
      </StudyModal>

      <StudyModal
        open={activeStudy === 'labdga'}
        onClose={() => setActiveStudy(null)}
        title="Hybrid Laboratory DGA Ingestion (ASTM D3612)"
        subtitle={`Upload a laboratory oil test report for ${transformer.name}`}
        icon={<FlaskConical size={20} />}
        accent="cyan"
      >
        <LabDgaIngestion
          onlineGases={{
            h2: liveTelemetry.h2,
            ch4: liveTelemetry.ch4,
            c2h2: liveTelemetry.c2h2,
            c2h4: liveTelemetry.c2h4,
            c2h6: liveTelemetry.c2h6,
          }}
          assetId={transformer.id || 'TRF-01'}
        />
      </StudyModal>

      <StudyModal
        open={activeStudy === 'fleetrisk'}
        onClose={() => setActiveStudy(null)}
        title="Fleet Risk Matrix & Criticality Index (ISO 55000)"
        subtitle={`Fleet-wide asset risk profile · ${currentOrgName}`}
        icon={<Building2 size={20} />}
        accent="amber"
      >
        <FleetRiskMatrix
          currentAssetId={transformer.id}
          hosts={hosts.filter((h) => (!h.domain || h.domain === 'transformer') && (!h.orgId || h.orgId === orgId))}
          sites={sites}
          orgId={orgId}
        />
      </StudyModal>

      {/* Fullscreen PdM Studio Workspace Modal */}
      {showPdmStudioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-[1600px] h-[94vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-indigo-500/40 bg-[#0d1117]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3 bg-[#0a0e1a]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-white">
                      Predictive Maintenance &amp; Asset Intelligence Studio
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                      IEEE C57.104 · ISO 55000
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      Asset: {transformer.name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Deep-dive diagnostic workspace — Dissolved gas analysis, Arrhenius RUL, dynamic ampacity, bushing vectors, and threats.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleExportOfficialDossier}
                  disabled={dossierExporting}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Download size={13} className={dossierExporting ? 'animate-bounce' : ''} />
                  <span>{dossierExporting ? 'Generating...' : '📑 Export Dossier'}</span>
                </button>
                <button
                  onClick={() => setShowCopilotDrawer(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Bot size={13} />
                  <span>🤖 Ask AI</span>
                </button>
                <button
                  onClick={() => setActiveStudy('labdga')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <FlaskConical size={13} />
                  <span>🧪 Lab DGA</span>
                </button>
                <button
                  onClick={() => setActiveStudy('fleetrisk')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Building2 size={13} />
                  <span>🏢 Fleet Risk</span>
                </button>
                <button
                  onClick={() => setShowPdmStudioModal(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors border border-slate-800 cursor-pointer ml-1"
                  title="Close Studio (ESC)"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Subtab Navigation Bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0a0e1a] border-b border-slate-800 overflow-x-auto">
              {[
                { id: 'dga' as const, label: '🔬 DGA, RUL & RoG Matrix' },
                { id: 'dtr' as const, label: '⚡ Dynamic Thermal Rating' },
                { id: 'bushing' as const, label: '🔌 Bushing Health (tan δ & PD)' },
                { id: 'threats' as const, label: '🛡️ 5-Threats & OLTC Tap Changer' },
              ].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setFullscreenPdmTab(sub.id)}
                  className={clsx(
                    'text-xs px-4 py-2 rounded-lg font-semibold transition-all whitespace-nowrap cursor-pointer',
                    fullscreenPdmTab === sub.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  )}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Modal Body: Spacious, Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {renderPdmStudioBody(true)}
            </div>
          </div>
        </div>
      )}

      {/* Hardware Collision & Stream Arbitration Modal */}
      {showArbitrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="w-full max-w-2xl rounded-2xl p-6 space-y-5 border border-rose-500/50 shadow-2xl relative"
            style={{ background: '#0d1117' }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/40">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">การจัดการฮาร์ดแวร์ชนกัน &amp; แยกสายข้อมูล (Hardware Arbitration)</h3>
                  <p className="text-xs text-slate-400">Node ID: <span className="font-mono text-amber-300">{transformer.id}</span> (องค์กร: {transformer.orgId})</p>
                </div>
              </div>
              <button
                onClick={() => setShowArbitrationModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3 rounded-xl bg-[#0a0e1a] border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>📡 การตรวจจับตัวตนแบบไร้ MAC Address:</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Status: PROTECTED</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  แม้ว่าเฟิร์มแวร์ ESP32 ของท่านจะไม่ได้ส่ง MAC address มาใน Payload แต่ระบบวิเคราะห์พบความผิดปกติจาก 
                  <strong> Uptime Regression</strong> (เวลาเปิดเครื่องกระโดดถอยหลังสลับไปมา) และ 
                  <strong> Physical Slew-Rate Jumps</strong> (ค่ากระโดดข้ามพิกัดฟิสิกส์ความจุความร้อนของน้ำมัน)
                </p>
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                  เลือกแนวทางการผสานข้อมูล (Arbitration Strategy):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    onClick={() => setArbitrationMode('max')}
                    className={clsx(
                      'p-3 rounded-xl border cursor-pointer transition-all space-y-1',
                      arbitrationMode === 'max'
                        ? 'border-amber-500 bg-amber-500/10 text-white'
                        : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:border-slate-700'
                    )}
                  >
                    <div className="font-bold text-amber-300 flex items-center justify-between">
                      <span>🛡️ Max-Select Safety (แนะนำ)</span>
                      {arbitrationMode === 'max' && <span className="text-[10px]">✓ ใช้งานอยู่</span>}
                    </div>
                    <p className="text-[11px] text-slate-300">
                      หาก 2 กล่องส่งค่าอุณหภูมิไม่เท่ากัน ระบบจะยึดค่าที่สูงกว่าเพื่อความปลอดภัยในการคำนวณอายุฉนวนและสั่งพัดลมระบายความร้อน
                    </p>
                  </div>

                  <div
                    onClick={() => setArbitrationMode('mean')}
                    className={clsx(
                      'p-3 rounded-xl border cursor-pointer transition-all space-y-1',
                      arbitrationMode === 'mean'
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : 'border-slate-800 bg-[#0a0e1a] text-slate-400 hover:border-slate-700'
                    )}
                  >
                    <div className="font-bold text-indigo-300 flex items-center justify-between">
                      <span>📊 Dual-Redundant Mean (เฉลี่ย)</span>
                      {arbitrationMode === 'mean' && <span className="text-[10px]">✓ ใช้งานอยู่</span>}
                    </div>
                    <p className="text-[11px] text-slate-300">
                      เหมาะสำหรับกรณีที่ตั้งใจติด 2 เซนเซอร์คู่ขนาน (Redundancy 1oo2) ระบบจะหาค่าเฉลี่ยและเตือนเมื่อ Discrepancy &gt; 5°C
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row gap-2 justify-between items-center">
                <button
                  onClick={() => {
                    setConflictDismissed(true)
                    setShowArbitrationModal(false)
                  }}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer"
                >
                  ✅ ยืนยันการแก้ไขหน้างานแล้ว (Clear Alert)
                </button>
                <button
                  onClick={() => setShowArbitrationModal(false)}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button for Copilot (Responsive: Compact Icon on Mobile, Full Pill on Desktop) */}
      <button
        onClick={() => setShowCopilotDrawer(true)}
        className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-40 p-3 sm:px-4 sm:py-3 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs shadow-2xl flex items-center gap-2 border border-indigo-400/40 hover:scale-105 transition-all"
        title="Open Ask AI Diagnostics"
        aria-label="Open Ask AI Diagnostics"
      >
        <Bot size={19} className="animate-pulse flex-shrink-0" />
        <span className="hidden sm:inline">Ask AI</span>
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping flex-shrink-0" />
      </button>

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
