'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { useOrgAlarms } from '@/lib/useOrgAlarms'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import { DOMAIN_META, type SensorHost, type SensorDomain } from '@/types/fleet'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { api, useIsLive } from '@/lib/api'
import { getSession } from '@/lib/auth'
import { healthFromValues } from '@/lib/alarmParams'
import { eventProblems as mockEventProblems } from '@/lib/orgData'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle, XCircle, Zap, Thermometer, Droplets, Activity, LayoutDashboard, Map as MapIcon, Bell, Clock, Search, Check, Car } from 'lucide-react'
import type { Transformer } from '@/types'
import { fmtHM } from '@/lib/displayTime'

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
    <Link href={`/admin/transformers/detail?id=${transformer.id}`}>
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
function hostMetric(h: SensorHost, liveVal?: Record<string, number>): string {
  if (h.domain === 'transformer') {
    const dyn = liveVal ? healthFromValues(liveVal, 'transformer') : null
    const health = dyn ?? (h.domain === 'transformer' ? h.healthIndex : 95)
    return `Health ${health}%`
  }
  if (h.domain === 'carbonNode') return `${h.targetMinC}–${h.targetMaxC}°C · ${h.creditsIssued} cr`
  if (h.domain === 'automobile') return `Fatigue ${h.fatigueScore}% · ${h.speedKmh} km/h`
  if (h.domain === 'bloodBox') return `set ${h.setLowC}–${h.setHighC}°C`
  return ''
}
function HostCard({ host, href, liveStatus, liveVal }: { host: SensorHost; href: string; liveStatus?: string; liveVal?: Record<string, number> }) {
  const meta = DOMAIN_META[host.domain]
  const status = liveStatus ?? host.status
  const dynHealth = host.domain === 'transformer' ? (liveVal ? healthFromValues(liveVal, 'transformer') : null) : null
  const healthVal = dynHealth ?? (host.domain === 'transformer' ? host.healthIndex : 95)
  const hColor = healthVal >= 80 ? '#4ade80' : healthVal >= 60 ? '#fbbf24' : '#ef4444'

  return (
    <Link href={href}>
      <div className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status === 'NORMAL' ? 'animate-pulse' : ''}`} style={{ background: statusColorH(status), boxShadow: `0 0 6px ${statusColorH(status)}` }} />
            <div className="text-sm font-bold text-white">{host.name}</div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">{hostMetric(host, liveVal)}</span>
          <span className="text-[10px] text-slate-600">{host.sensorCount} sensors</span>
        </div>
        {host.domain === 'transformer' && (
          <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Health Index</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${healthVal}%`, background: hColor }} />
              </div>
              <span className="text-[10px] font-bold" style={{ color: hColor }}>{healthVal}%</span>
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}

function OverviewTab() {
  const { selectedOrgId, getAlarmsByOrg, acknowledgeAlarm } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const live = useIsLive()
  const { hosts, fromBackend } = useFleetHosts(orgId)
  const { alarms: liveAlarms, refetch: refetchAlarms } = useOrgAlarms(orgId, { open: true, pollMs: 5000 })
  const mockAlarms = getAlarmsByOrg(orgId)

  const alarms = live
    ? liveAlarms.map((a) => ({
        id: a.id,
        nodeId: a.nodeId,
        message: `${a.paramLabel}: ${a.value}${a.unit} (threshold ${a.threshold}${a.unit})`,
        transformerName: a.nodeName,
        timestamp: a.raisedAt,
        acknowledged: !!a.acknowledgedAt,
        severity: a.severity,
        domain: a.domain,
        eventProblemId: a.eventProblemId,
      }))
    : mockAlarms.map((a) => ({
        id: a.id,
        nodeId: a.transformerId,
        message: a.message,
        transformerName: a.transformerName,
        timestamp: a.timestamp,
        acknowledged: a.acknowledged,
        severity: a.severity,
        domain: 'transformer' as SensorDomain,
        eventProblemId: undefined,
      }))

  const [liveFrames, setLiveFrames] = useState<Record<string, number>>({})
  const [liveValues, setLiveValues] = useState<Record<string, Record<string, number>>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [domainFilter, setDomainFilter] = useState<'all' | SensorDomain>('all')
  const [msgRate, setMsgRate] = useState<number>(0)
  const [ackingId, setAckingId] = useState<string | null>(null)
  const [evProblems, setEvProblems] = useState<{ id: string; label: string }[]>([])
  const [selectedProblems, setSelectedProblems] = useState<Record<string, string>>({})
  const msgCounterRef = useRef(0)
  const [, tick] = useState(0)

  useEffect(() => {
    if (live) {
      api.eventProblems(orgId).then((rows) => {
        if (rows) setEvProblems(rows)
      }).catch(() => {})
    } else {
      setEvProblems(mockEventProblems)
    }
  }, [live, orgId])

  useEffect(() => {
    if (!live) return
    const off = subscribeTelemetry((f) => {
      msgCounterRef.current += 1
      if (f?.id) {
        const id = f.id
        setLiveFrames((prev) => ({ ...prev, [id]: Date.now() }))
        if (f.values) {
          const vals = f.values
          setLiveValues((prev) => ({ ...prev, [id]: vals }))
        }
        if (f.type === 'alarm') {
          refetchAlarms()
        }
      }
    })
    const rateTimer = setInterval(() => {
      setMsgRate(msgCounterRef.current)
      msgCounterRef.current = 0
      tick((n) => n + 1)
    }, 2000)
    return () => {
      off()
      clearInterval(rateTimer)
    }
  }, [live, refetchAlarms])

  const eff = (h: SensorHost): string => {
    const lastFrame = liveFrames[h.id]
    if (lastFrame && Date.now() - lastFrame < 90_000) {
      return h.status === 'CRITICAL' || h.status === 'WARNING' ? h.status : 'NORMAL'
    }
    return h.status
  }

  const normal = hosts.filter((h) => eff(h) === 'NORMAL').length
  const warning = hosts.filter((h) => eff(h) === 'WARNING').length
  const critical = hosts.filter((h) => eff(h) === 'CRITICAL' || eff(h) === 'OFFLINE').length
  const unacked = alarms.filter((a) => !a.acknowledged).length
  const totalSensors = hosts.reduce((a, h) => a + h.sensorCount, 0)

  const avgHealth = useMemo(() => {
    if (!hosts.length) return 100
    const scores = hosts.map((h) => {
      if (h.domain === 'transformer') {
        const lv = liveValues[h.id]
        const dyn = lv ? healthFromValues(lv, 'transformer') : null
        return dyn ?? (h.domain === 'transformer' ? h.healthIndex : 95)
      }
      return h.status === 'CRITICAL' ? 50 : h.status === 'WARNING' ? 75 : 98
    })
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  }, [hosts, liveValues])

  const healthColor = avgHealth >= 80 ? '#4ade80' : avgHealth >= 60 ? '#fbbf24' : '#ef4444'

  const filteredHosts = useMemo(() => {
    return hosts.filter((h) => {
      if (domainFilter !== 'all' && h.domain !== domainFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return h.name.toLowerCase().includes(q) || h.id.toLowerCase().includes(q)
      }
      return true
    })
  }, [hosts, domainFilter, searchQuery])

  const byDomain = (d: SensorDomain) => filteredHosts.filter((h) => h.domain === d)

  const causeRequired = evProblems.length > 0
  const ackReady = (id: string) => !causeRequired || !!selectedProblems[id]

  const handleAck = async (alarmId: string) => {
    if (!ackReady(alarmId)) return
    setAckingId(alarmId)
    try {
      const probId = selectedProblems[alarmId] || undefined
      if (live) {
        await api.ackEvent(alarmId, { by: getSession()?.name ?? 'Admin', eventProblemId: probId })
        await refetchAlarms()
      }
      acknowledgeAlarm(alarmId, getSession()?.name ?? 'Admin')
    } catch (e) {
      console.error('Ack error:', e)
    } finally {
      setAckingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with Live Heartbeat */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">Fleet Overview</h2>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Telemetry {msgRate > 0 ? `(${(msgRate / 2).toFixed(1)} msg/s)` : 'Connected'}
            </span>
          </div>
          <p className="text-sm text-slate-500">Real-time status across {hosts.length} monitored assets</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs"><CheckCircle size={12} className="text-green-400" /><span className="text-slate-400">{normal} Normal</span></div>
          {warning > 0 && <div className="flex items-center gap-1.5 text-xs"><AlertTriangle size={12} className="text-amber-400" /><span className="text-slate-400">{warning} Warning</span></div>}
          {critical > 0 && <div className="flex items-center gap-1.5 text-xs"><XCircle size={12} className="text-red-400" /><span className="text-red-400 font-semibold">{critical} Critical</span></div>}
        </div>
      </div>

      {/* Summary stats: Devices, Fleet Health, Active Alarms */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div className="text-xs text-slate-500 mb-1">Total Devices</div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-indigo-400">{hosts.length}</div>
            <span className="text-xs text-slate-500">{totalSensors} active sensors</span>
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div className="text-xs text-slate-500 mb-1">Fleet Health Index</div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-2xl font-bold" style={{ color: healthColor }}>{avgHealth}%</div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${healthColor}15`, color: healthColor }}>
              {avgHealth >= 80 ? 'Optimal' : avgHealth >= 60 ? 'Degraded' : 'Attention Required'}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${avgHealth}%`, background: healthColor }} />
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div className="text-xs text-slate-500 mb-1">Active Alarms</div>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold" style={{ color: unacked > 0 ? '#ef4444' : '#4ade80' }}>
              {unacked}
            </div>
            {unacked > 0 ? (
              <Link href="/admin/alarms" className="text-xs text-red-400 hover:text-red-300 font-semibold">
                Action Required →
              </Link>
            ) : (
              <span className="text-xs text-slate-500">All systems clear</span>
            )}
          </div>
        </div>
      </div>

      {/* Device Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setDomainFilter('all')}
            className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              domainFilter === 'all' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
            }`}
          >
            All Assets ({hosts.length})
          </button>
          <button
            type="button"
            onClick={() => setDomainFilter('transformer')}
            className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              domainFilter === 'transformer' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
            }`}
          >
            <Zap size={12} className="text-amber-400" /> Transformers ({hosts.filter((h) => h.domain === 'transformer').length})
          </button>
          {hosts.some((h) => h.domain === 'carbonNode') && (
            <button
              type="button"
              onClick={() => setDomainFilter('carbonNode')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'carbonNode' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Thermometer size={12} className="text-emerald-400" /> CarbonBOX ({hosts.filter((h) => h.domain === 'carbonNode').length})
            </button>
          )}
          {hosts.some((h) => h.domain === 'bloodBox') && (
            <button
              type="button"
              onClick={() => setDomainFilter('bloodBox')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'bloodBox' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Droplets size={12} className="text-rose-400" /> BloodBOX ({hosts.filter((h) => h.domain === 'bloodBox').length})
            </button>
          )}
          {hosts.some((h) => h.domain === 'automobile') && (
            <button
              type="button"
              onClick={() => setDomainFilter('automobile')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'automobile' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Car size={12} className="text-amber-400" /> Formula EV ({hosts.filter((h) => h.domain === 'automobile').length})
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search device name, ID..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl text-white placeholder-slate-500 bg-[#0d1117] border border-[#1e2433] focus:border-indigo-500 outline-none"
          />
        </div>
      </div>

      {/* Per-product device sections */}
      {(['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[]).map((d) => {
        const list = byDomain(d)
        if (!list.length) return null
        const meta = DOMAIN_META[d]
        return (
          <div key={d} className="space-y-2.5">
            <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: meta.accent }}>
              <span>{meta.platform} — {meta.label}s</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-normal">
                {list.length}
              </span>
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {list.map((h) => (
                <HostCard key={h.id} host={h} liveStatus={eff(h)} liveVal={liveValues[h.id]} href={d === 'transformer' ? `/admin/transformers/detail?id=${h.id}` : d === 'automobile' ? `/admin/automobile` : `/admin/nodes/detail?id=${h.id}`} />
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
              <h3 className="text-sm font-semibold text-white">Active Alarms Requiring Attention ({unacked})</h3>
            </div>
            <Link href="/admin/alarms" className="text-xs text-indigo-400 hover:text-indigo-300">View All →</Link>
          </div>
          <div className="space-y-2">
            {alarms.filter((a) => !a.acknowledged).slice(0, 4).map((alarm) => (
              <div
                key={alarm.id}
                className="flex items-center justify-between gap-3 p-3 rounded-xl transition-all"
                style={
                  alarm.severity === 'CRITICAL'
                    ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
                    : { background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }
                }
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
                    style={{ background: alarm.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-200 truncate">{alarm.message}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{alarm.transformerName}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-bold"
                    style={
                      alarm.severity === 'CRITICAL'
                        ? { color: '#ef4444', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }
                        : { color: '#fbbf24', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)' }
                    }
                  >
                    {alarm.severity}
                  </span>
                  {evProblems.length > 0 && (
                    <select
                      value={selectedProblems[alarm.id] || ''}
                      onChange={(e) => setSelectedProblems({ ...selectedProblems, [alarm.id]: e.target.value })}
                      className={clsx(
                        "text-[10px] bg-[#0d1117] text-slate-300 border rounded-lg px-2 py-1 outline-none w-28 sm:w-36 truncate transition-colors",
                        !selectedProblems[alarm.id] ? "border-amber-500/50 text-amber-300" : "border-slate-700"
                      )}
                    >
                      <option value="">Select root cause…</option>
                      {evProblems.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAck(alarm.id)}
                    disabled={ackingId === alarm.id || !ackReady(alarm.id)}
                    title={!ackReady(alarm.id) ? 'Select a root cause first' : undefined}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow"
                  >
                    <Check size={11} /> {ackingId === alarm.id ? 'ACKing…' : 'ACK'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import AlarmsManagementView from '@/components/AlarmsManagementView'

// --- Dashboard (Overall) with tabs ------------------------------------------
const DASH_TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'location', label: 'Device Location', icon: MapIcon },
  { id: 'alarm', label: 'Alarm', icon: Bell },
] as const

// Same split /admin/map and superadmin/monitoring use: transformer keeps its
// dedicated dashboard, everything else shares the generic node twin.
function monitorRoute(domain: GeoNode['domain'], id: string): string {
  return domain === 'transformer' ? `/admin/transformers/detail?id=${encodeURIComponent(id)}` : `/admin/nodes/detail?id=${encodeURIComponent(id)}`
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { selectedOrgId } = useAppStore()
  const [tab, setTab] = useState<'overview' | 'location' | 'alarm'>('overview')
  // Live coordinates from /api/fleet when the backend has them; the seed map
  // only when it does not, so a real device is never missing from the map.
  const liveNodes = useLiveGeoNodes(selectedOrgId || 'org-1')
  const nodes = liveNodes ?? getGeoNodes(selectedOrgId || 'org-1')
  const covers = useOrgPhotoCovers(selectedOrgId || 'org-1')
  const [previewId, setPreviewId] = useState<string | null>(null)

  return (
    <div className="p-5 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-500">Overall view across all devices</p>
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
      {tab === 'location' && (
        <>
          {/* Setting a device's position (no Floor Plans feature here to do it
              another way) needs room the panel takes — the full /admin/map
              page has it; this tab stays a quick glance. */}
          <div className="flex justify-end">
            <Link href="/admin/map" className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300">
              <MapIcon size={12} /> Set device positions →
            </Link>
          </div>
          <LiveSensorMap nodes={nodes} height="62vh" photoCovers={covers} onOpenPhotos={setPreviewId}
            onOpenDevice={(id, domain) => router.push(monitorRoute(domain, id))} />
          {previewId && (
            <NodePhotoPreview nodeId={previewId} canEdit onClose={() => setPreviewId(null)} />
          )}
        </>
      )}
      {tab === 'alarm' && (
        <div className="space-y-4">
          <AlarmsManagementView embedded />
        </div>
      )}
    </div>
  )
}
