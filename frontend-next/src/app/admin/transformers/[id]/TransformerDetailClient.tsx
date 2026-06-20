'use client'

import { useParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
  Thermometer, Droplets, Gauge, Activity, Zap, Wind,
  MapPin, Calendar, Building2, Hash, CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronLeft, Maximize2, RefreshCw
} from 'lucide-react'
import Link from 'next/link'
import type { SensorReading, Transformer } from '@/types'

const Transformer3D = dynamic(() => import('@/components/transformer/Transformer3D'), { ssr: false })

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
  const y1 = cy + r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy + r * Math.sin(toRad(endAngle))
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
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2}`}
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

function SensorCard({ label, icon, sensor }: { label: string; icon: React.ReactNode; sensor: SensorReading }) {
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
    <div
      className="rounded-xl p-4 transition-all hover:border-indigo-500/30"
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
    </div>
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

export default function TransformerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { transformers } = useAppStore()
  const transformer = transformers.find((t) => t.id === id)

  if (!transformer) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Transformer not found</div>
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
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 flex-shrink-0" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
        <Link href="/admin" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
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
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <RefreshCw size={11} className="text-green-400 animate-spin" style={{ animationDuration: '3s' }} />
            <span>Live</span>
          </div>
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Main content - 3 column layout */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0">
        {/* Left panel - sensor cards */}
        <div className="w-56 flex-shrink-0 p-3 space-y-2 overflow-y-auto" style={{ borderRight: '1px solid #1e2433' }}>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Sensor Readings</div>
          <SensorCard label="Oil Temperature" icon={<Thermometer size={13} />} sensor={s.oilTemperature} />
          <SensorCard label="Hydrogen H2" icon={<Activity size={13} />} sensor={s.hydrogen} />
          <SensorCard label="Moisture" icon={<Droplets size={13} />} sensor={s.moisture} />
          <SensorCard label="Oil Level" icon={<Gauge size={13} />} sensor={s.oilLevel} />
          <SensorCard label="Load" icon={<Zap size={13} />} sensor={s.load} />
          <SensorCard label="Ambient Temp" icon={<Wind size={13} />} sensor={s.ambientTemperature} />
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
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Load & Oil Temperature</div>
                <div className="text-[10px] text-slate-600">Last 12h</div>
              </div>
              <TrendChart transformer={transformer} type="load-temp" />
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Hydrogen & Moisture</div>
                <div className="text-[10px] text-slate-600">Last 12h</div>
              </div>
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
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400">ONLINE</span>
              </div>
            </div>
            <LiveTime />
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
            <ActiveAlarms transformerId={transformer.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
