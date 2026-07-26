'use client'

import { useMemo, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { api, useIsLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { ALARM_SCHEMA, LEGACY_WIRE_KEYS } from '@/lib/alarmParams'
import type { ManagedDevice } from '@/types/org'
import type { Transformer } from '@/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Thermometer, Droplets, Activity, Zap, Gauge, Wind, DoorClosed, Wifi,
} from 'lucide-react'

const Fridge3D = dynamic(() => import('@/components/twin/Fridge3D'), { ssr: false, loading: () => <TwinLoading /> })
const BloodBox3D = dynamic(() => import('@/components/twin/BloodBox3D'), { ssr: false, loading: () => <TwinLoading /> })
const Transformer3D = dynamic(() => import('@/components/transformer/Transformer3D'), { ssr: false, loading: () => <TwinLoading /> })

function TwinLoading() {
  return <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">Loading 3D digital twin…</div>
}

// Picks the right 3D digital twin for the device's product domain. When live
// readings are available the twin reflects them (temperature, door/lid, battery)
// instead of the placeholder pose — a shut door on the model while the sensor
// reports OPEN is worse than no twin at all.
function DeviceTwin({ device, values }: { device: ManagedDevice; values?: Record<string, number> | null }) {
  const v = values ?? {}
  const live = v.tempHigh ?? v.tempLow ?? v.oilTemp
  const temp = live ?? (parseFloat(device.lastValue ?? '') || 4.2)
  const open = (v.door ?? 0) > 0
  if (device.domain === 'carbonNode') {
    const warn = ALARM_SCHEMA.carbonNode.params.find((p) => p.key === 'tempHigh')?.warn ?? 8
    return <Fridge3D device={{ name: device.name, temperature: temp, doorOpen: open, threshold: warn }} />
  }
  if (device.domain === 'bloodBox') {
    const warn = ALARM_SCHEMA.bloodBox.params.find((p) => p.key === 'tempHigh')?.warn ?? 6
    return <BloodBox3D device={{ name: device.name, temperature: temp, battery: v.battery ?? 85, lidOpen: open, threshold: warn }} />
  }
  if (device.domain === 'transformer') return <Transformer3D transformer={{ id: device.id } as Transformer} />
  return <div className="w-full h-full flex items-center justify-center text-slate-600"><Activity size={36} className="opacity-30" /></div>
}

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

type Status = 'NORMAL' | 'WARNING' | 'CRITICAL'
const statusColor: Record<Status, { color: string; bg: string }> = {
  NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

interface Tile {
  key: string
  label: string
  icon: React.ReactNode
  value: string
  unit: string
  status: Status
  delta: string
  spark: number[]
}

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }
function spark(seed: number, base: number, amp: number) {
  const out: number[] = []; let v = base
  for (let i = 0; i < 16; i++) { v += ((((seed + i * 7) % 11) / 11) - 0.5) * amp; out.push(+v.toFixed(2)) }
  return out
}

// ── Live tiles ───────────────────────────────────────────────────────────────
// In Live mode the tiles are built from what the device ACTUALLY reports:
// /api/fleet/:id/latest for the stored values plus WS frames for real-time
// updates. Each canonical param is labelled/thresholded by ALARM_SCHEMA, and any
// extra key the device sends still gets a tile (raw key as the label). Demo mode
// — or a device with no readings — falls back to the mock tiles below.
const ICONS: Record<string, React.ReactNode> = {
  oilTemp: <Thermometer size={13} />, ambientTemp: <Thermometer size={13} />, windingTemp: <Thermometer size={13} />,
  tempHigh: <Thermometer size={13} />, tempLow: <Thermometer size={13} />,
  hydrogen: <Activity size={13} />, moisture: <Droplets size={13} />, rh: <Droplets size={13} />,
  oilLevel: <Gauge size={13} />, load: <Zap size={13} />, current: <Zap size={13} />,
  door: <DoorClosed size={13} />, battery: <Zap size={13} />,
}

function statusFor(value: number, p?: { direction: string; warn: number; critical: number }): Status {
  if (!p) return 'NORMAL'
  const breach = (limit: number) => (p.direction === 'high' ? value >= limit : value <= limit)
  if (breach(p.critical)) return 'CRITICAL'
  if (breach(p.warn)) return 'WARNING'
  return 'NORMAL'
}

function buildLiveTiles(device: ManagedDevice, values: Record<string, number>): Tile[] {
  const seed = hash(device.id)
  const schema = device.domain ? ALARM_SCHEMA[device.domain] : undefined
  const params = schema?.params ?? []
  const seen = new Set<string>()
  const tiles: Tile[] = []

  // Schema params first (known label/unit/thresholds), only those actually reported.
  for (const p of params) {
    const v = values[p.key]
    if (v === undefined) continue
    seen.add(p.key)
    const isDoor = p.key === 'door'
    tiles.push({
      key: p.key,
      label: p.label,
      icon: ICONS[p.key] ?? <Activity size={13} />,
      value: isDoor ? (v > 0 ? 'Open' : 'Closed') : String(Number(v.toFixed(3))),
      unit: isDoor ? '' : p.unit,
      status: statusFor(v, p),
      delta: 'live',
      spark: spark(seed, v, Math.max(Math.abs(v) * 0.05, 0.2)),
    })
  }
  // Canonical params that belong to OTHER product domains. A node that was once
  // fed a different product's payload (e.g. a transformer id briefly publishing
  // carbonbox temp_c/door) keeps those readings, and showing them here would put
  // fridge tiles on a transformer page. Unknown keys are still welcome — they are
  // genuinely new sensors — but another domain's params are not.
  const foreignKeys = new Set(
    (Object.keys(ALARM_SCHEMA) as (keyof typeof ALARM_SCHEMA)[])
      .filter((d) => d !== device.domain)
      .flatMap((d) => ALARM_SCHEMA[d].params.map((p) => p.key))
  )
  // Anything else the device publishes (unmapped sensors) still gets shown.
  for (const [k, v] of Object.entries(values)) {
    if (seen.has(k) || foreignKeys.has(k) || LEGACY_WIRE_KEYS.has(k)) continue
    tiles.push({
      key: k,
      label: k,
      icon: ICONS[k] ?? <Activity size={13} />,
      value: String(Number(v.toFixed(3))),
      unit: '',
      status: 'NORMAL',
      delta: 'live',
      spark: spark(seed, v, Math.max(Math.abs(v) * 0.05, 0.2)),
    })
  }
  return tiles
}

function buildTiles(device: ManagedDevice): Tile[] {
  const seed = hash(device.id)
  const isTransformer = /transformer/i.test(device.deviceType)
  if (isTransformer) {
    return [
      { key: 'oil', label: 'Oil Temperature', icon: <Thermometer size={13} />, value: '68.4', unit: '°C', status: 'NORMAL', delta: '▲ 0.5 vs prev', spark: spark(seed, 68, 3) },
      { key: 'h2', label: 'Hydrogen H2', icon: <Activity size={13} />, value: '115.4', unit: 'ppm', status: 'NORMAL', delta: '▼ 0.4 vs prev', spark: spark(seed + 3, 115, 8) },
      { key: 'moist', label: 'Moisture', icon: <Droplets size={13} />, value: '18.6', unit: 'ppm', status: 'NORMAL', delta: '▼ 0.1 vs prev', spark: spark(seed + 5, 18, 2) },
      { key: 'level', label: 'Oil Level', icon: <Gauge size={13} />, value: '78', unit: '%', status: 'NORMAL', delta: '▬ stable', spark: spark(seed + 7, 78, 1) },
      { key: 'load', label: 'Load', icon: <Zap size={13} />, value: '72', unit: '%', status: 'WARNING', delta: '▲ 3.1 vs prev', spark: spark(seed + 9, 72, 6) },
    ]
  }
  // Refrigeration / cold-chain device
  const t = parseFloat(device.lastValue ?? '4.5') || 4.5
  return [
    { key: 'temp', label: 'Temperature', icon: <Thermometer size={13} />, value: t.toFixed(1), unit: '°C', status: t > 8 ? 'WARNING' : 'NORMAL', delta: '▼ 0.2 vs prev', spark: spark(seed, t, 1.2) },
    { key: 'hum', label: 'Humidity', icon: <Droplets size={13} />, value: '46', unit: '%RH', status: 'NORMAL', delta: '▲ 1.0 vs prev', spark: spark(seed + 4, 46, 4) },
    { key: 'door', label: 'Door', icon: <DoorClosed size={13} />, value: 'Closed', unit: '', status: 'NORMAL', delta: 'last open 2h ago', spark: spark(seed + 6, 0.1, 0.2) },
    { key: 'comp', label: 'Compressor', icon: <Wind size={13} />, value: '63', unit: '%', status: 'NORMAL', delta: '▬ stable', spark: spark(seed + 8, 63, 5) },
  ]
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 220, h = 40
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 6) - 3}`).join(' ')
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function HealthGauge({ value }: { value: number }) {
  const cx = 80, cy = 80, r = 64
  const color = value >= 80 ? '#4ade80' : value >= 60 ? '#fbbf24' : '#ef4444'
  const polar = (frac: number) => { const a = Math.PI - frac * Math.PI; return [cx + r * Math.cos(a), cy - r * Math.sin(a)] }
  const pct = Math.max(0, Math.min(100, value)) / 100
  const [sx, sy] = polar(0), [ex, ey] = polar(pct)
  // The gauge spans exactly 180°, so the arc is NEVER the "large" one. Passing
  // large-arc-flag=1 (as before) made the browser draw the complementary >180°
  // sweep — the track rendered as the bottom half and the value arc broke into
  // two disconnected strokes for any reading above 50.
  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="92" viewBox="0 0 160 90">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1e2433" strokeWidth="12" strokeLinecap="round" />
        {pct > 0 && <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />}
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="30" fontWeight="700">{Math.round(value)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#475569" fontSize="10">Health Index</text>
      </svg>
    </div>
  )
}

export default function FixDashboard({ device }: { device: ManagedDevice }) {
  const live = useIsLive()
  const [values, setValues] = useState<Record<string, number> | null>(null)

  // Poll the stored readings, then let WS frames update them in real time.
  useEffect(() => {
    if (!live || !device.id) { setValues(null); return }
    let cancelled = false
    const load = () => { api.latest(device.id).then((r) => { if (!cancelled && r?.values) setValues(r.values) }) }
    load()
    const t = setInterval(load, 10000)
    const off = subscribeTelemetry((f) => {
      if (f.id !== device.id || f.type === 'alarm' || !f.values) return
      setValues(f.values)
    })
    return () => { cancelled = true; clearInterval(t); off() }
  }, [live, device.id])

  const liveTiles = useMemo(
    () => (live && values && Object.keys(values).length ? buildLiveTiles(device, values) : null),
    [live, values, device]
  )
  const tiles = useMemo(() => liveTiles ?? buildTiles(device), [liveTiles, device])
  // Health from the live readings: every param sitting in warning costs 10 points
  // and every critical one 25, so the gauge reflects the same thresholds the
  // status pills use. Without readings (demo, or a silent device) fall back to
  // the stable per-device placeholder.
  const health = useMemo(() => {
    const schema = device.domain ? ALARM_SCHEMA[device.domain] : undefined
    if (!live || !values || !schema) return 70 + (hash(device.id) % 28)
    let penalty = 0, seen = 0
    for (const p of schema.params) {
      const v = values[p.key]
      if (v === undefined) continue
      seen++
      const st = statusFor(v, p)
      if (st === 'CRITICAL') penalty += 25
      else if (st === 'WARNING') penalty += 10
    }
    if (!seen) return 70 + (hash(device.id) % 28)
    return Math.max(0, Math.min(100, 100 - penalty))
  }, [live, values, device])
  const trend = useMemo(() => {
    const seed = hash(device.id); const out: { t: string; a: number; b: number }[] = []
    for (let i = 23; i >= 0; i--) out.push({ t: `${i}h`, a: 60 + ((seed + i * 5) % 25), b: 40 + ((seed + i * 9) % 30) })
    return out.reverse()
  }, [device])

  const asset = /transformer/i.test(device.deviceType)
    ? [['ID', device.serial], ['Model', 'TR-6787'], ['Rating', '2500 kVA'], ['Voltage', '22kV/0.4kV']]
    : [['ID', device.serial], ['Type', device.deviceType], ['Range', '-20°C to 10°C'], ['Logger', 'RDL-v2']]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Sensor cards */}
      <div className="lg:col-span-4 space-y-3">
        <div className="text-[10px] text-slate-600 uppercase tracking-wider">Sensor Readings</div>
        {tiles.map((tile) => {
          const sc = statusColor[tile.status]
          return (
            <div key={tile.key} className="rounded-xl p-4" style={surface}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: sc.bg, color: sc.color }}>{tile.icon}</span>
                  <span className="text-sm text-slate-300">{tile.label}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: sc.color, background: sc.bg }}>{tile.status}</span>
              </div>
              <div className="text-2xl font-extrabold text-white tabular-nums">{tile.value}<span className="text-sm text-slate-500 ml-1">{tile.unit}</span></div>
              <div className="text-[11px] text-slate-500 mb-1">{tile.delta}</div>
              <Sparkline data={tile.spark} color={sc.color} />
            </div>
          )
        })}
      </div>

      {/* Center: 3D digital twin + trend */}
      <div className="lg:col-span-5 space-y-4">
        <div className="rounded-xl overflow-hidden h-[340px]" style={{ ...surface, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.12), transparent 70%)' }}>
          <DeviceTwin device={device} values={live ? values : null} />
        </div>
        <div className="rounded-xl p-5" style={surface}>
          <div className="text-sm font-semibold text-white mb-3">Performance · last 24h</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={trend} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
              <XAxis dataKey="t" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={24} />
              <YAxis stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
              <Line type="monotone" dataKey="a" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="b" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Right: gauge + connection + asset */}
      <div className="lg:col-span-3 space-y-4">
        <div className="rounded-xl p-5 flex justify-center" style={surface}>
          <HealthGauge value={health} />
        </div>
        <div className="rounded-xl p-4" style={surface}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Connection</span>
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: device.status === 'online' ? '#4ade80' : '#6b7280' }}>
              <Wifi size={12} /> {device.status === 'online' ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="text-[11px] text-slate-600 mt-1">Last update: just now</div>
        </div>
        <div className="rounded-xl p-4" style={surface}>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Asset Info</div>
          <div className="space-y-2">
            {asset.map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-slate-500">{k}</span>
                <span className="text-white font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
