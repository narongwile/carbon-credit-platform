'use client'

import { useMemo, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { api, useIsLive } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { ALARM_SCHEMA, LEGACY_WIRE_KEYS, paramStatus } from '@/lib/alarmParams'
import { fmtHM } from '@/lib/displayTime'
import ParamHistoryModal, { type ModalParam } from '@/components/device/ParamHistoryModal'
import DisplayParamPicker from '@/components/device/DisplayParamPicker'
import DeviceImage from '@/components/device/DeviceImage'
import NameplateEditor from '@/components/device/NameplateEditor'
import { useNodeNameplate } from '@/lib/useNodeNameplate'
import { classifyByKva, TRANSFORMER_CLASS_LABEL } from '@/lib/transformerClass'
import { useParamLabels } from '@/lib/useParamLabels'
import { useShow3dFallback } from '@/lib/useOrgDisplaySettings'
import { useSessionRole } from '@/lib/auth'
import type { ManagedDevice } from '@/types/org'
import type { Transformer, SensorReading } from '@/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Thermometer, Droplets, Activity, Zap, Gauge, Wind, DoorClosed, Wifi, SlidersHorizontal, Pencil, Camera,
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
function DeviceTwin({ device, values, show3d }: { device: ManagedDevice; values?: Record<string, number> | null; show3d: boolean }) {
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
  // migrate-v33: an org can turn off the generic 3D transformer model
  // entirely, so a device with no photo yet shows a plain placeholder here
  // instead — same toggle TransformerDetailView's 3D canvas respects.
  if (device.domain === 'transformer' && !show3d) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-600">
        <Camera size={28} className="opacity-40" />
        <span className="text-xs">No photo uploaded yet</span>
      </div>
    )
  }
  if (device.domain === 'transformer') {
    // Was `{ id: device.id } as Transformer` — the twin used to re-look-up the
    // asset in the seeded store by that id, so a real device that is not a demo
    // id resolved to nothing and the model never drew. It now takes the readings
    // directly, the same way the fridge and BloodBOX twins above do, so the
    // parts colour by live status instead of depending on seed data existing.
    const reading = (key: string, unit: string): SensorReading => {
      const p = ALARM_SCHEMA.transformer.params.find((x) => x.key === key)
      const val = v[key]
      return {
        value: val ?? 0, unit, min: 0, max: (p?.critical ?? 100) * 1.2,
        status: val !== undefined && p ? paramStatus(val, p) : 'NORMAL',
        threshold: { warning: p?.warn ?? 0, critical: p?.critical ?? 0 },
        trend: 'stable', delta: 0, history: [],
      }
    }
    return <Transformer3D transformer={{
      id: device.id,
      sensors: {
        oilTemperature: reading('oilTemp', '°C'),
        hydrogen: reading('hydrogen', 'ppm'),
        moisture: reading('moisture', 'ppm'),
        oilLevel: reading('oilLevel', '%'),
        load: reading('load', '%'),
        ambientTemperature: reading('ambientTemp', '°C'),
      },
    } as Transformer} />
  }
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
  const [openParam, setOpenParam] = useState<string | null>(null)

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
  const builtTiles = useMemo(() => liveTiles ?? buildTiles(device), [liveTiles, device])
  // Admin-renamed parameters (migrate-v34). Applied over the built tiles rather
  // than inside buildTiles, so every downstream consumer — the tiles, the
  // history modal's switcher, the chart heading — gets the same name from one
  // place. The tile KEY is untouched: it is still the wire key everything else
  // joins on.
  const { labelOf: paramLabel, refetch: refetchLabels } = useParamLabels(device.orgId, device.domain, device.id)
  const allTiles = useMemo(
    () => builtTiles.map((t) => ({ ...t, label: paramLabel(t.key) })),
    [builtTiles, paramLabel],
  )

  // Admin-chosen subset. Empty = unconfigured = show everything, so an org that
  // has never touched this keeps exactly the dashboard it had.
  const [showKeys, setShowKeys] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const role = useSessionRole()
  const canConfigure = role === 'admin' || role === 'superadmin'
  useEffect(() => {
    if (!live || !device.domain) return
    let cancelled = false
    api.displayParams(device.orgId, device.domain, device.id).then((r) => {
      if (!cancelled && r) setShowKeys(r.paramKeys?.length ? r.paramKeys : null)
    })
    return () => { cancelled = true }
  }, [device.orgId, device.domain, device.id, live])

  const tiles = useMemo(() => {
    if (!showKeys?.length) return allTiles
    const order = new Map(showKeys.map((k, i) => [k, i]))
    return allTiles.filter((t) => order.has(t.key)).sort((a, b) => order.get(a.key)! - order.get(b.key)!)
  }, [allTiles, showKeys])
  // Every tile on screen is selectable inside the modal, so a user who opened
  // the wrong metric can switch without closing and hunting for the right card.
  const modalParams: ModalParam[] = useMemo(
    () => tiles.map((t) => ({ key: t.key, label: t.label, unit: t.unit })),
    [tiles],
  )
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
  // Was a curve computed from hash(device.id) — a deterministic pattern rendered
  // under the heading "Performance · last 24h" with two unlabelled series. It
  // looked like telemetry and was not; nothing here had ever fetched history.
  const [series, setSeries] = useState<Record<string, { time: string; value: number }[]>>({})
  useEffect(() => {
    if (!live) { setSeries({}); return }
    let cancelled = false
    const load = () => {
      api.readings(device.id, 1440, (1440 * 60) / 96).then((rows) => {
        if (cancelled || !rows) return
        const out: Record<string, { time: string; value: number }[]> = {}
        for (const r of rows) (out[r.param_key] ||= []).push({ time: r.taken_at, value: Number(r.value) })
        setSeries(out)
      })
    }
    load()
    const t = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [device.id, live])

  /** Chart rows for a pair of params, aligned on the first one's buckets. */
  const pairSeries = (aKey: string, bKey: string) => {
    const a = series[aKey] ?? [], b = series[bKey] ?? []
    if (!a.length && !b.length) return []
    const base = (a.length ? a : b).slice(-96)
    return base.map((p, i) => ({
      time: fmtHM(p.time),
      [aKey]: a[i]?.value ?? null,
      [bKey]: b[i]?.value ?? null,
    })) as Record<string, string | number | null>[]
  }

  // Only for transformers, and only once the device has actually reported the
  // pair — an empty axis is worse than no card.
  const isTransformer = device.domain === 'transformer'
  const loadOil = isTransformer ? pairSeries('oilTemp', 'load') : []
  const h2Moist = isTransformer ? pairSeries('hydrogen', 'moisture') : []

  // The generic chart plots whatever the device reports most of, so a fridge or
  // a BloodBOX still gets a real trend instead of the invented one.
  // Respects the admin's selection: charting a parameter that was deliberately
  // hidden from the cards right beside it would be a contradiction on one screen.
  const genericKey = useMemo(() => {
    let keys = Object.keys(series).filter((k) => (series[k]?.length ?? 0) > 1)
    if (showKeys?.length) {
      const visible = keys.filter((k) => showKeys.includes(k))
      if (visible.length) keys = visible
    }
    if (!keys.length) return null
    const preferred = device.domain ? ALARM_SCHEMA[device.domain].params.map((p) => p.key) : []
    return preferred.find((k) => keys.includes(k)) ?? keys[0]
  }, [series, device.domain, showKeys])
  const genericTrend = genericKey ? (series[genericKey] ?? []).slice(-96).map((p) => ({ time: fmtHM(p.time), value: p.value })) : []

  // A transformer's real nameplate — was a hardcoded 'TR-6787' / '2500 kVA' /
  // '22kV/0.4kV' shown for every transformer on the platform regardless of its
  // actual rating. An admin now enters what is actually on the unit; until
  // they do, each field says so instead of showing a fabricated number.
  const { data: nameplate, refetch: refetchNameplate } = useNodeNameplate(device.id)
  const [editingNameplate, setEditingNameplate] = useState(false)
  const sizeClass = classifyByKva(nameplate?.ratedKva)
  const show3d = useShow3dFallback(device.orgId)
  const asset = isTransformer
    ? [
        ['ID', device.serial],
        // resolved.X = override ?? linked catalog model's value (migrate-v32).
        ['Model', nameplate?.resolved?.model || nameplate?.model || 'Not entered'],
        ['Rating', (nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva) != null ? `${nameplate?.resolved?.ratedKva ?? nameplate?.ratedKva} kVA` : 'Not entered'],
        ['Voltage', nameplate?.resolved?.voltageClass || nameplate?.voltageClass || 'Not entered'],
      ]
    : [['ID', device.serial], ['Type', device.deviceType], ['Range', '-20°C to 10°C'], ['Logger', 'RDL-v2']]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Sensor cards */}
      <div className="lg:col-span-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider">Sensor Readings</div>
          {showKeys?.length ? (
            <span className="text-[9px] text-indigo-400">{tiles.length}/{allTiles.length}</span>
          ) : null}
          {canConfigure && live && (
            <button onClick={() => setPicking(true)} title="Choose which parameters to show"
              className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400">
              <SlidersHorizontal size={11} /> Configure
            </button>
          )}
        </div>
        {tiles.map((tile) => {
          const sc = statusColor[tile.status]
          return (
            // Clicking a card opens its full history + threshold editor. It is a
            // button, not a div with onClick, so keyboard users reach it too.
            <button
              key={tile.key}
              type="button"
              onClick={() => setOpenParam(tile.key)}
              className="w-full text-left rounded-xl p-4 transition-colors hover:border-indigo-500/40 cursor-pointer"
              style={surface}
              title={`Open ${tile.label} history`}
            >
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
            </button>
          )
        })}
      </div>

      {/* Center: the device photo (admin-uploaded) + trend. The generic twin is
          the fallback until someone uploads the real unit — see DeviceImage. */}
      <div className="lg:col-span-5 space-y-4">
        <div className="rounded-xl overflow-hidden h-[340px]" style={{ ...surface, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.12), transparent 70%)' }}>
          <DeviceImage nodeId={device.id} deviceName={device.name}
            fallback={<DeviceTwin device={device} values={live ? values : null} show3d={show3d} />} />
        </div>
        {/* Transformer pair charts — the two the /admin/transformers/detail page
            has. Rendered only when the device has actually reported the pair, so
            a transformer that sends only electrical values does not get an empty
            axis. Clicking opens the same history modal the tiles use. */}
        {isTransformer && loadOil.length > 0 && (
          <button onClick={() => setOpenParam('oilTemp')} className="w-full text-left rounded-xl p-5 group" style={surface}>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 group-hover:text-indigo-400">Load &amp; Oil Temperature · click for history</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={loadOil} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
                <YAxis yAxisId="temp" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis yAxisId="load" orientation="right" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Line yAxisId="temp" type="monotone" dataKey="oilTemp" stroke="#f97316" strokeWidth={1.5} dot={false} name="Oil Temp (°C)" connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="load" type="monotone" dataKey="load" stroke="#6366f1" strokeWidth={1.5} dot={false} name="Load (%)" connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </button>
        )}
        {isTransformer && h2Moist.length > 0 && (
          <button onClick={() => setOpenParam('hydrogen')} className="w-full text-left rounded-xl p-5 group" style={surface}>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 group-hover:text-indigo-400">Hydrogen &amp; Moisture · click for history</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={h2Moist} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={28} />
                <YAxis yAxisId="h2" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis yAxisId="moist" orientation="right" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Line yAxisId="h2" type="monotone" dataKey="hydrogen" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Hydrogen (ppm)" connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="moist" type="monotone" dataKey="moisture" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="Moisture (ppm)" connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </button>
        )}

        {/* Generic trend. Was unclickable AND synthetic; it plots a real stored
            parameter now and opens that parameter's history. */}
        <button onClick={() => genericKey && setOpenParam(genericKey)} disabled={!genericKey}
          className="w-full text-left rounded-xl p-5 group disabled:cursor-default" style={surface}>
          <div className="text-sm font-semibold text-white mb-3 group-enabled:group-hover:text-indigo-400">
            {genericKey
              ? `${modalParams.find((m) => m.key === genericKey)?.label ?? genericKey} · last 24h · click for history`
              : 'Performance · last 24h'}
          </div>
          {genericTrend.length > 1 ? (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={genericTrend} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={24} />
              <YAxis stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
              <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          ) : (
            <div className="h-[150px] flex items-center justify-center text-xs text-slate-600">
              No stored readings yet for this device.
            </div>
          )}
        </button>
      </div>

      {picking && device.domain && (
        <DisplayParamPicker
          orgId={device.orgId}
          domain={device.domain}
          nodeId={device.id}
          available={allTiles.map((t) => t.key)}
          onClose={() => setPicking(false)}
          onSaved={(keys) => { setShowKeys(keys.length ? keys : null); refetchLabels() }}
        />
      )}

      {openParam && (
        <ParamHistoryModal
          nodeId={device.id}
          deviceName={device.name}
          orgId={device.orgId}
          domain={device.domain}
          params={modalParams}
          initialKey={openParam}
          onClose={() => setOpenParam(null)}
        />
      )}

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
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-slate-600 uppercase tracking-wider">Asset Info</div>
            <div className="flex items-center gap-1.5">
              {isTransformer && sizeClass && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>
                  {TRANSFORMER_CLASS_LABEL[sizeClass]}
                </span>
              )}
              {isTransformer && canConfigure && live && (
                <button onClick={() => setEditingNameplate(true)} title="Edit nameplate"
                  className="text-slate-500 hover:text-indigo-400 flex-shrink-0">
                  <Pencil size={11} />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {asset.map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-slate-500">{k}</span>
                <span className={v === 'Not entered' ? 'text-slate-600 italic' : 'text-white font-medium'}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingNameplate && (
        <NameplateEditor nodeId={device.id} orgId={device.orgId} current={nameplate}
          onClose={() => setEditingNameplate(false)} onSaved={refetchNameplate} />
      )}
    </div>
  )
}
