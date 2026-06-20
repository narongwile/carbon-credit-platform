'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
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

// Picks the right 3D digital twin for the device's product domain.
function DeviceTwin({ device }: { device: ManagedDevice }) {
  const temp = parseFloat(device.lastValue ?? '') || 4.2
  if (device.domain === 'carbonNode') return <Fridge3D device={{ name: device.name, temperature: temp, doorOpen: false, threshold: 8 }} />
  if (device.domain === 'bloodBox') return <BloodBox3D device={{ name: device.name, temperature: temp, battery: 85, lidOpen: false, threshold: 6 }} />
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
  const [sx, sy] = polar(0), [ex, ey] = polar(value / 100)
  const large = value / 100 > 0.5 ? 1 : 0
  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="92" viewBox="0 0 160 90">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`} fill="none" stroke="#1e2433" strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="30" fontWeight="700">{value}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#475569" fontSize="10">Health Index</text>
      </svg>
    </div>
  )
}

export default function FixDashboard({ device }: { device: ManagedDevice }) {
  const tiles = useMemo(() => buildTiles(device), [device])
  const health = useMemo(() => 70 + (hash(device.id) % 28), [device])
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
          <DeviceTwin device={device} />
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
