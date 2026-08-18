'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import { DOMAIN_META, type SensorHost, type SensorDomain } from '@/types/fleet'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { useIsLive } from '@/lib/api'
import { healthFromValues } from '@/lib/alarmParams'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle, XCircle, Zap, Thermometer, Droplets, Activity, LayoutDashboard, Map as MapIcon, Bell, Clock } from 'lucide-react'
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
  return `set ${h.setLowC}–${h.setHighC}°C`
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
  const { selectedOrgId, getAlarmsByOrg } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const live = useIsLive()
  // Roster AND status from /api/fleet in Live mode (mock when the API is off),
  // so a device registered by its first telemetry frame is counted here.
  const { hosts, fromBackend } = useFleetHosts(orgId)
  const alarms = getAlarmsByOrg(orgId)
  const [liveFrames, setLiveFrames] = useState<Record<string, number>>({})
  const [liveValues, setLiveValues] = useState<Record<string, Record<string, number>>>({})
  const [, tick] = useState(0)

  useEffect(() => {
    if (!live) return
    const off = subscribeTelemetry((f) => {
      if (f?.id && f.type !== 'alarm') {
        const id = f.id
        setLiveFrames((prev) => ({ ...prev, [id]: Date.now() }))
        if (f.values) {
          const vals = f.values
          setLiveValues((prev) => ({ ...prev, [id]: vals }))
        }
      }
    })
    const timer = setInterval(() => tick((n) => n + 1), 5000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [live])

  const eff = (h: SensorHost): string => {
    const lastFrame = liveFrames[h.id]
    if (lastFrame && Date.now() - lastFrame < 90_000) {
      return h.status === 'CRITICAL' || h.status === 'WARNING' ? h.status : 'NORMAL'
    }
    return h.status
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
          <p className="text-sm text-slate-500">Every sensor across your organization</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs"><CheckCircle size={12} className="text-green-400" /><span className="text-slate-400">{normal} Normal</span></div>
          {warning > 0 && <div className="flex items-center gap-1.5 text-xs"><AlertTriangle size={12} className="text-amber-400" /><span className="text-slate-400">{warning} Warning</span></div>}
          {critical > 0 && <div className="flex items-center gap-1.5 text-xs"><XCircle size={12} className="text-red-400" /><span className="text-red-400 font-semibold">{critical} Critical</span></div>}
        </div>
      </div>

      {/* Summary stats — Products card removed per specification */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Devices', value: hosts.length, color: '#6366f1' },
          { label: 'Total Sensors', value: totalSensors, color: '#06b6d4' },
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
                <HostCard key={h.id} host={h} liveStatus={eff(h)} liveVal={liveValues[h.id]} href={d === 'transformer' ? `/admin/transformers/detail?id=${h.id}` : `/admin/nodes/detail?id=${h.id}`} />
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
