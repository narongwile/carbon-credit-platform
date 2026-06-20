'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import { getGeoNodes } from '@/lib/geoNodes'
import { getHostsByOrg } from '@/lib/fleetData'
import { useFleetLive, statusFromLive } from '@/lib/useFleetLive'
import { DOMAIN_META, type SensorHost, type SensorDomain } from '@/types/fleet'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle, XCircle, Zap, Thermometer, Droplets, Activity, LayoutDashboard, Map as MapIcon, Bell, Clock } from 'lucide-react'
import type { Transformer } from '@/types'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

function StatusDot({ status }: { status: string }) {
  const colors = {
    NORMAL: '#4ade80',
    WARNING: '#fbbf24',
    CRITICAL: '#ef4444',
    OFFLINE: '#6b7280',
  }
  const color = colors[status as keyof typeof colors] || '#6b7280'
  return (
    <div
      className="w-2.5 h-2.5 rounded-full"
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  )
}

function HealthBar({ value }: { value: number }) {
  const color = value >= 80 ? '#4ade80' : value >= 60 ? '#fbbf24' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2433' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold w-8 text-right" style={{ color }}>{value}</span>
    </div>
  )
}

function TransformerCard({ transformer }: { transformer: Transformer }) {
  const s = transformer.sensors
  const statusColors = {
    NORMAL: { bg: 'rgba(74,222,128,0.1)', color: '#4ade80', border: 'rgba(74,222,128,0.2)' },
    WARNING: { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: 'rgba(251,191,36,0.2)' },
    CRITICAL: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
    OFFLINE: { bg: 'rgba(107,114,128,0.1)', color: '#6b7280', border: 'rgba(107,114,128,0.2)' },
  }
  const sc = statusColors[transformer.status]

  return (
    <Link href={`/admin/transformers/${transformer.id}`}>
      <div
        className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5"
        style={{ background: '#0d1117', border: '1px solid #1e2433' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <StatusDot status={transformer.status} />
            <div>
              <div className="text-sm font-bold text-white">{transformer.name}</div>
              <div className="text-[10px] text-slate-500 truncate max-w-[140px]">{transformer.location}</div>
            </div>
          </div>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
          >
            {transformer.status}
          </span>
        </div>

        {/* Sensor mini grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
          <div className="flex items-center gap-1.5">
            <Thermometer size={11} className="text-orange-400" />
            <span className="text-[11px] text-slate-500">Oil Temp</span>
            <span className="text-[11px] text-white ml-auto font-medium">{s.oilTemperature.value.toFixed(1)}°C</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap size={11} className="text-indigo-400" />
            <span className="text-[11px] text-slate-500">Load</span>
            <span className="text-[11px] text-white ml-auto font-medium">{s.load.value.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity size={11} className="text-cyan-400" />
            <span className="text-[11px] text-slate-500">H2</span>
            <span className="text-[11px] text-white ml-auto font-medium">{s.hydrogen.value.toFixed(0)} ppm</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Droplets size={11} className="text-blue-400" />
            <span className="text-[11px] text-slate-500">Oil Level</span>
            <span className="text-[11px] text-white ml-auto font-medium">{s.oilLevel.value.toFixed(0)}%</span>
          </div>
        </div>

        {/* Health index */}
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-slate-500">Health Index</span>
          </div>
          <HealthBar value={transformer.healthIndex} />
        </div>
      </div>
    </Link>
  )
}

function statusColorH(s: string) {
  return s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280'
}
function hostMetric(h: SensorHost): string {
  if (h.domain === 'transformer') return `Health ${h.healthIndex}`
  if (h.domain === 'carbonNode') return `${h.targetMinC}–${h.targetMaxC}°C · ${h.creditsIssued} cr`
  return `set ${h.setLowC}–${h.setHighC}°C`
}
function HostCard({ host, href, liveStatus }: { host: SensorHost; href: string; liveStatus?: string }) {
  const meta = DOMAIN_META[host.domain]
  const status = liveStatus ?? host.status
  return (
    <Link href={href}>
      <div className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: statusColorH(status), boxShadow: `0 0 6px ${statusColorH(status)}` }} />
            <div className="text-sm font-bold text-white">{host.name}</div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">{hostMetric(host)}</span>
          <span className="text-[10px] text-slate-600">{host.sensorCount} sensors</span>
        </div>
      </div>
    </Link>
  )
}

function OverviewTab() {
  const { selectedOrgId, getAlarmsByOrg } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const hosts = getHostsByOrg(orgId)
  const alarms = getAlarmsByOrg(orgId)

  // Live overlay from MySQL (via /api/fleet); falls back to mock when API is off.
  const live = useFleetLive(orgId)
  const eff = (h: SensorHost): string => {
    const l = live.byId.get(h.id)
    return l ? statusFromLive(l) : h.status
  }

  const byDomain = (d: SensorDomain) => hosts.filter((h) => h.domain === d)
  const normal = hosts.filter((h) => eff(h) === 'NORMAL').length
  const warning = hosts.filter((h) => eff(h) === 'WARNING').length
  const critical = hosts.filter((h) => eff(h) === 'CRITICAL' || eff(h) === 'OFFLINE').length
  const unacked = alarms.filter((a) => !a.acknowledged).length
  const totalSensors = hosts.reduce((a, h) => a + h.sensorCount, 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">All Devices Overview</h2>
          <p className="text-sm text-slate-500">Every sensor across every product in your organization</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs"><CheckCircle size={12} className="text-green-400" /><span className="text-slate-400">{normal} Normal</span></div>
          {warning > 0 && <div className="flex items-center gap-1.5 text-xs"><AlertTriangle size={12} className="text-amber-400" /><span className="text-slate-400">{warning} Warning</span></div>}
          {critical > 0 && <div className="flex items-center gap-1.5 text-xs"><XCircle size={12} className="text-red-400" /><span className="text-red-400 font-semibold">{critical} Critical</span></div>}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Devices', value: hosts.length, color: '#6366f1' },
          { label: 'Total Sensors', value: totalSensors, color: '#06b6d4' },
          { label: 'Products', value: new Set(hosts.map((h) => h.domain)).size, color: '#a78bfa' },
          { label: 'Active Alarms', value: unacked, color: unacked > 0 ? '#ef4444' : '#4ade80' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-xs text-slate-500 mb-1">{stat.label}</div>
            <div className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Per-product device sections (all products the org has) */}
      {(['transformer', 'carbonNode', 'bloodBox'] as SensorDomain[]).map((d) => {
        const list = byDomain(d)
        if (!list.length) return null
        const meta = DOMAIN_META[d]
        return (
          <div key={d} className="space-y-2">
            <h3 className="text-sm font-bold" style={{ color: meta.accent }}>{meta.platform} — {meta.label}s ({list.length})</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {list.map((h) => (
                <HostCard key={h.id} host={h} liveStatus={live.byId.get(h.id) ? eff(h) : undefined} href={d === 'transformer' ? `/admin/transformers/${h.id}` : `/admin/nodes/${h.id}`} />
              ))}
            </div>
          </div>
        )
      })}

      {/* Recent alarms */}
      {unacked > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              <h3 className="text-sm font-semibold text-white">Active Alarms Requiring Attention</h3>
            </div>
            <Link href="/admin/alarms" className="text-xs text-indigo-400 hover:text-indigo-300">View All</Link>
          </div>
          <div className="space-y-2">
            {alarms.filter((a) => !a.acknowledged).slice(0, 3).map((alarm) => (
              <div
                key={alarm.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={
                  alarm.severity === 'CRITICAL'
                    ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }
                    : { background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }
                }
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: alarm.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24' }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-300 truncate">{alarm.message}</span>
                </div>
                <div className="text-xs text-slate-600 flex-shrink-0">{alarm.transformerName}</div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0"
                  style={alarm.severity === 'CRITICAL' ? { color: '#ef4444', background: 'rgba(239,68,68,0.15)' } : { color: '#fbbf24', background: 'rgba(251,191,36,0.15)' }}
                >
                  {alarm.severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Alarm tab ---------------------------------------------------------------
function AlarmTab() {
  const { alarms, acknowledgeAlarm, selectedOrgId } = useAppStore()
  const orgAlarms = alarms.filter((a) => a.orgId === selectedOrgId)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">All-device Alarms</h2>
        <span className="text-xs text-slate-500">{orgAlarms.filter((a) => !a.acknowledged).length} open</span>
      </div>
      {orgAlarms.length ? orgAlarms.map((a) => {
        const c = a.severity === 'CRITICAL' ? '#ef4444' : a.severity === 'WARNING' ? '#fbbf24' : '#60a5fa'
        return (
          <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: `${c}14`, border: `1px solid ${c}33`, opacity: a.acknowledged ? 0.6 : 1 }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-200 truncate">{a.message}</div>
              <div className="text-xs text-slate-600">{a.transformerName}</div>
            </div>
            <span className="flex items-center gap-1 text-xs text-slate-500"><Clock size={10} />{new Date(a.timestamp).toLocaleTimeString()}</span>
            <span className="text-xs font-bold" style={{ color: c }}>{a.severity}</span>
            {a.acknowledged
              ? <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-1 rounded-full">ACK</span>
              : <button onClick={() => acknowledgeAlarm(a.id, 'admin')} className="text-xs font-medium text-white px-3 py-1.5 rounded-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>Acknowledge</button>}
          </div>
        )
      }) : <div className="rounded-xl p-6 text-center text-slate-600 text-sm" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>No alarms.</div>}
    </div>
  )
}

// --- Dashboard (Overall) with tabs ------------------------------------------
const DASH_TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'location', label: 'Device Location', icon: MapIcon },
  { id: 'alarm', label: 'Alarm', icon: Bell },
] as const

export default function AdminDashboardPage() {
  const { selectedOrgId } = useAppStore()
  const [tab, setTab] = useState<'overview' | 'location' | 'alarm'>('overview')
  const nodes = getGeoNodes(selectedOrgId || 'org-1')

  return (
    <div className="p-5 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-500">Overall view across all devices · เห็นทั้งหมด ทุก devices</p>
      </div>
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
        {DASH_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition-all', tab === t.id ? 'text-white' : 'text-slate-500')}
            style={tab === t.id ? { background: '#6366f1' } : {}}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'location' && <LiveSensorMap nodes={nodes} height="62vh" />}
      {tab === 'alarm' && <AlarmTab />}
    </div>
  )
}
