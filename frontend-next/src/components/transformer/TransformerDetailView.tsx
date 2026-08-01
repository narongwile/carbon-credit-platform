'use client'

import { useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { makeTransformer } from '@/lib/mockData'
import type { TransformerHost } from '@/types/fleet'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import MyAlertSettings from '@/components/device/MyAlertSettings'
import ParamHistoryModal, { type ModalParam } from '@/components/device/ParamHistoryModal'
import { api, useIsLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { ALARM_SCHEMA, healthFromValues, paramStatus } from '@/lib/alarmParams'
import dynamic from 'next/dynamic'
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
  Thermometer, Droplets, Gauge, Activity, Zap, Wind,
  MapPin, Calendar, Building2, Hash, CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronLeft, Maximize2
} from 'lucide-react'
import Link from 'next/link'
import type { SensorData, SensorReading, TrendPoint, Transformer } from '@/types'

const Transformer3D = dynamic(() => import('@/components/transformer/Transformer3D'), { ssr: false })

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
  useEffect(() => {
    if (!live || !id) { setValues(null); setLastReadingAt(null); setSeries({}); return }
    let cancelled = false
    const load = () => {
      api.latest(id).then((r) => {
        if (cancelled || !r) return
        if (r.values) setValues(r.values)
        setLastReadingAt(r.lastReadingAt ?? null)
      })
      // 48 buckets over 12h = one point per 15 minutes, which is exactly what the
      // sparklines and both trend charts draw.
      api.readings(id, 720, (720 * 60) / HISTORY_POINTS).then((rows) => { if (!cancelled && rows) setSeries(historyByParam(rows)) })
    }
    load()
    const t = setInterval(load, 10000)
    const off = subscribeTelemetry((f) => {
      if (f.id !== id || f.type === 'alarm' || !f.values) return
      setValues(f.values)
      setLastReadingAt(new Date().toISOString())
    })
    return () => { cancelled = true; clearInterval(t); off() }
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
      healthIndex: healthFromValues(values, 'transformer') ?? base.healthIndex,
      status: online ? worst : 'OFFLINE',
      lastUpdated: lastReadingAt ?? base.lastUpdated,
    } as Transformer
  }, [base, live, values, series, online, lastReadingAt])

  return { transformer, live, online, lastReadingAt }
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

function SensorCard({ label, icon, sensor, onOpen }: { label: string; icon: React.ReactNode; sensor: SensorReading; onOpen?: () => void }) {
  const statusConfig = {
    NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.15)' },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.15)' },
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.15)' },
  }
  const sc = statusConfig[sensor.status]
  const recentHistory = sensor.history.slice(-12)

  // Mini sparkline points
  const max = Math.max(...recentHistory.map((p) => p.value))
  const min = Math.min(...recentHistory.map((p) => p.value))
  const range = max - min || 1
  const w = 100
  const h = 24
  const points = recentHistory
    .map((p, i) => `${(i / (recentHistory.length - 1)) * w},${h - ((p.value - min) / range) * h}`)
    .join(' ')

  return (
    // A button so the whole card is one keyboard-reachable target — the history
    // and threshold editor live behind it.
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${label} history`}
      className="w-full text-left rounded-xl p-4 transition-all hover:border-indigo-500/30 cursor-pointer"
      style={{ background: '#0d1117', border: '1px solid #1e2433' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
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
  )
}

function TrendChart({ transformer, type }: { transformer: Transformer; type: 'load-temp' | 'h2-moisture' }) {
  const history = transformer.sensors.oilTemperature.history.slice(-48)
  const loadHistory = transformer.sensors.load.history.slice(-48)
  const h2History = transformer.sensors.hydrogen.history.slice(-48)
  const moistHistory = transformer.sensors.moisture.history.slice(-48)

  const data = history.map((p, i) => {
    const t = new Date(p.time)
    return {
      time: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`,
      oilTemp: p.value,
      load: loadHistory[i]?.value || 0,
      hydrogen: h2History[i]?.value || 0,
      moisture: moistHistory[i]?.value || 0,
    }
  })

  const tooltipStyle = {
    background: '#0d1117',
    border: '1px solid #1e2433',
    borderRadius: '8px',
    fontSize: '11px',
  }

  if (type === 'load-temp') {
    return (
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval={7} />
          <YAxis yAxisId="temp" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <YAxis yAxisId="load" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 100]} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
          <Line yAxisId="temp" type="monotone" dataKey="oilTemp" stroke="#f97316" strokeWidth={1.5} dot={false} name="Oil Temp (°C)" />
          <Line yAxisId="load" type="monotone" dataKey="load" stroke="#6366f1" strokeWidth={1.5} dot={false} name="Load (%)" />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
        <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval={7} />
        <YAxis yAxisId="h2" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
        <YAxis yAxisId="moist" orientation="right" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
        <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
        <Line yAxisId="h2" type="monotone" dataKey="hydrogen" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="Hydrogen (ppm)" />
        <Line yAxisId="moist" type="monotone" dataKey="moisture" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="Moisture (ppm)" />
      </LineChart>
    </ResponsiveContainer>
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
              {new Date(a.ts).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
      <div className="text-[10px] text-slate-600 pt-1">Acknowledge in the Event Log below.</div>
    </div>
  )
}

function ActiveAlarms({ transformerId }: { transformerId: string }) {
  const { alarms, acknowledgeAlarm } = useAppStore()
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
              {new Date(alarm.timestamp).toLocaleTimeString()}
            </div>
          </div>
          <button
            onClick={() => acknowledgeAlarm(alarm.id, 'admin')}
            className="text-[10px] px-2 py-1 rounded text-slate-400 hover:text-white transition-colors flex-shrink-0"
            style={{ background: '#1e2433' }}
          >
            ACK
          </button>
        </div>
      ))}
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
  const { hosts, loaded: fleetLoaded } = useFleetHosts(orgId)
  const base = useMemo(() => {
    const seeded = transformers.find((t) => t.id === id)
    if (seeded) return seeded
    const host = hosts.find((h) => h.id === id && h.domain === 'transformer')
    return host ? makeTransformer(host as TransformerHost) : undefined
  }, [transformers, hosts, id])
  const { transformer, live, online, lastReadingAt } = useLiveTransformer(base)
  const [openParam, setOpenParam] = useState<string | null>(null)
  // Both combined charts and all six cards open the same modal, so whichever the
  // user clicked they can switch metric inside it.
  const modalParams: ModalParam[] = ALARM_SCHEMA.transformer.params.map((p) => ({ key: p.key, label: p.label, unit: p.unit }))

  if (!transformer) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">
          {fleetLoaded ? 'Transformer not found' : 'Loading transformer…'}
        </div>
      </div>
    )
  }

  const s = transformer.sensors
  const statusColors = {
    NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.2)' },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)' },
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
    OFFLINE: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.2)' },
  }
  const sc = statusColors[transformer.status]

  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ background: '#0a0e1a' }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 flex-shrink-0" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
          <ChevronLeft size={16} />
          Back
        </Link>
        <div className="h-4 w-px" style={{ background: '#1e2433' }} />
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{transformer.name}</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
          >
            {transformer.status}
          </span>
        </div>
        <div className="h-4 w-px" style={{ background: '#1e2433' }} />
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin size={11} />
          {transformer.location}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Was a permanently spinning "Live" — it said nothing about the device. */}
          <DeviceLiveStatus nodeId={transformer.id} />
          <NodeReportButton nodeId={transformer.id} deviceName={transformer.name} domain="transformer" />
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Main content - 3 column layout */}
      <div className="flex gap-0 overflow-hidden min-h-0 flex-shrink-0" style={{ height: 'clamp(520px, calc(100vh - 160px), 900px)' }}>
        {/* Left panel - sensor cards */}
        <div className="w-56 flex-shrink-0 p-3 space-y-2 overflow-y-auto" style={{ borderRight: '1px solid #1e2433' }}>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Sensor Readings</div>
          <SensorCard label="Oil Temperature" icon={<Thermometer size={13} />} sensor={s.oilTemperature} onOpen={() => setOpenParam('oilTemp')} />
          <SensorCard label="Hydrogen H2" icon={<Activity size={13} />} sensor={s.hydrogen} onOpen={() => setOpenParam('hydrogen')} />
          <SensorCard label="Moisture" icon={<Droplets size={13} />} sensor={s.moisture} onOpen={() => setOpenParam('moisture')} />
          <SensorCard label="Oil Level" icon={<Gauge size={13} />} sensor={s.oilLevel} onOpen={() => setOpenParam('oilLevel')} />
          <SensorCard label="Load" icon={<Zap size={13} />} sensor={s.load} onOpen={() => setOpenParam('load')} />
          <SensorCard label="Ambient Temp" icon={<Wind size={13} />} sensor={s.ambientTemperature} onOpen={() => setOpenParam('ambientTemp')} />
        </div>

        {/* Center - 3D model + charts */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 3D canvas */}
          <div className="flex-1 relative" style={{ minHeight: '320px' }}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #0d1117 50%, #0a0e1a 100%)' }}>
              <Transformer3D transformer={transformer} />
            </div>
          </div>

          {/* Charts */}
          <div className="flex-shrink-0 grid grid-cols-2 gap-0" style={{ borderTop: '1px solid #1e2433' }}>
            <div className="p-3" style={{ borderRight: '1px solid #1e2433' }}>
              <button type="button" onClick={() => setOpenParam('load')}
                className="w-full flex items-center justify-between mb-2 group" title="Open history">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider group-hover:text-indigo-400">Load &amp; Oil Temperature</div>
                <div className="text-[10px] text-slate-600 group-hover:text-indigo-400">Last 12h · click for history</div>
              </button>
              <TrendChart transformer={transformer} type="load-temp" />
            </div>
            <div className="p-3">
              <button type="button" onClick={() => setOpenParam('hydrogen')}
                className="w-full flex items-center justify-between mb-2 group" title="Open history">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider group-hover:text-indigo-400">Hydrogen &amp; Moisture</div>
                <div className="text-[10px] text-slate-600 group-hover:text-indigo-400">Last 12h · click for history</div>
              </button>
              <TrendChart transformer={transformer} type="h2-moisture" />
            </div>
          </div>
        </div>

        {/* Right panel - info + health + alarms */}
        <div className="w-56 flex-shrink-0 overflow-y-auto p-3 space-y-3" style={{ borderLeft: '1px solid #1e2433' }}>
          {/* Health gauge */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <HealthGauge value={transformer.healthIndex} />
          </div>

          {/* Status */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">Connection</span>
              {/* Was hardcoded ONLINE. Derived from the last stored reading so a
                  silent device reads OFFLINE here as well as in the Event Log. */}
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className={`text-xs ${online ? 'text-green-400' : 'text-slate-500'}`}>
                  {online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>
            {live && lastReadingAt
              ? <div className="text-[10px] text-slate-600">Last reading: {new Date(lastReadingAt).toLocaleString()}</div>
              : <LiveTime />}
          </div>

          {/* Transformer info */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Asset Info</div>
            {[
              { icon: <Hash size={10} />, label: 'ID', value: transformer.name },
              { icon: <Building2 size={10} />, label: 'Model', value: transformer.model },
              { icon: <Zap size={10} />, label: 'Rating', value: `${transformer.kva} kVA` },
              { icon: <Activity size={10} />, label: 'Voltage', value: transformer.voltage },
              { icon: <Building2 size={10} />, label: 'Mfg.', value: transformer.manufacturer },
              { icon: <Calendar size={10} />, label: 'Installed', value: transformer.installDate },
              { icon: <Hash size={10} />, label: 'S/N', value: transformer.serialNumber },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="text-slate-600 mt-0.5 flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-slate-600">{item.label}</div>
                  <div className="text-[11px] text-slate-300 truncate">{item.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Location */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Location</div>
            <div className="flex items-start gap-2">
              <MapPin size={10} className="text-slate-500 mt-0.5 flex-shrink-0" />
              <span className="text-[11px] text-slate-300">{transformer.location}</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              {transformer.lat.toFixed(4)}, {transformer.lng.toFixed(4)}
            </div>
          </div>

          {/* Active Alarms */}
          <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Active Alarms</div>
            {live ? <LiveActiveAlarms nodeId={transformer.id} /> : <ActiveAlarms transformerId={transformer.id} />}
          </div>
        </div>
      </div>

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

      {/* Alarm event log + transport/connectivity timeline (same component the
          generic node page uses, so both routes stay in step). */}
      <div className="p-4 space-y-4">
        <NodeDocuments nodeId={transformer.id} />
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
