'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { useOrgAlarms } from '@/lib/useOrgAlarms'
import { useSessionOrgId } from '@/lib/auth'
import { useIsLive } from '@/lib/api'
import { viewerDomains } from '@/lib/viewer'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import { DOMAIN_META, type SensorDomain, type SensorHost } from '@/types/fleet'
import { healthFromValues } from '@/lib/alarmParams'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { CheckCircle, AlertTriangle, XCircle, Bell, Clock, Zap, Thermometer, Droplet, ChevronRight, LayoutDashboard, Map as MapIcon, ShieldAlert } from 'lucide-react'
import { fmtHM } from '@/lib/displayTime'
import clsx from 'clsx'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const domainIcon: Record<SensorDomain, React.ElementType> = { transformer: Zap, carbonNode: Thermometer, bloodBox: Droplet }
const statusColor = (s: string) => (s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280')

function metric(h: SensorHost, liveVal?: Record<string, number>): string {
  if (h.domain === 'transformer') {
    const dyn = liveVal ? healthFromValues(liveVal, 'transformer') : null
    const health = dyn ?? h.healthIndex ?? 95
    return `Health ${health}%`
  }
  if (h.domain === 'carbonNode') {
    const t = liveVal?.chamberTemp ?? liveVal?.tempHigh
    return `${t != null ? `${t.toFixed(1)}°C · ` : ''}${h.targetMinC}–${h.targetMaxC}°C`
  }
  const t = liveVal?.bloodTemp ?? liveVal?.tempHigh
  return `${t != null ? `${t.toFixed(1)}°C · ` : ''}set ${h.setLowC}–${h.setHighC}°C`
}

// --- Overview tab (the page's original content) ----------------------------
const DASH_TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'location', label: 'Device Location', icon: MapIcon },
  { id: 'alarm', label: 'Alarm', icon: Bell },
] as const

function OverviewTab() {
  const live = useIsLive()
  const sessionOrgId = useSessionOrgId()
  const storeOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = (sessionOrgId && sessionOrgId !== 'org-1') ? sessionOrgId : (storeOrgId || sessionOrgId || 'org-1')
  const { viewerUserId } = useAppStore()

  const { hosts, fromBackend } = useFleetHosts(orgId)
  const allowed = viewerDomains(viewerUserId)
  const devices = fromBackend ? hosts : hosts.filter((h) => allowed.includes(h.domain))

  const normal = devices.filter((d) => d.status === 'NORMAL').length
  const warning = devices.filter((d) => d.status === 'WARNING').length
  const critical = devices.filter((d) => d.status === 'CRITICAL' || d.status === 'OFFLINE').length

  // Real, open alarms for this org (department/domain-scoped server-side)
  const { alarms: liveAlarms, refetch: refetchAlarms } = useOrgAlarms(orgId, { open: true, pollMs: 5000 })
  const { alarms: mockAlarms } = useAppStore()
  const [liveFrames, setLiveFrames] = useState<Record<string, Record<string, number>>>({})
  const [, tick] = useState(0)

  useEffect(() => {
    if (!live) return
    const off = subscribeTelemetry((f) => {
      if (f?.id) {
        if (f.values) {
          setLiveFrames((prev) => ({ ...prev, [f.id]: f.values }))
        }
        if (f.type === 'alarm' || f.alarm) {
          refetchAlarms()
        }
      }
    })
    const timer = setInterval(() => tick((n) => n + 1), 5000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [live, refetchAlarms])

  const orgAlarms = live
    ? liveAlarms.map((a) => ({
        id: a.id,
        nodeId: a.nodeId,
        message: `${a.paramLabel}: ${a.value}${a.unit} (threshold ${a.threshold}${a.unit})`,
        transformerName: a.nodeName,
        timestamp: a.raisedAt,
        acknowledged: !!a.acknowledgedAt,
        severity: a.severity,
        domain: a.domain,
      }))
    : mockAlarms.filter((a) => a.orgId === orgId).map((a) => ({
        ...a,
        nodeId: a.transformerId,
        domain: 'transformer' as SensorDomain,
      }))

  return (
    <div className="space-y-6">
      {/* Status summary (all devices) */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: CheckCircle, label: 'Normal', value: normal, color: '#4ade80' },
          { icon: AlertTriangle, label: 'Warning', value: warning, color: '#fbbf24' },
          { icon: XCircle, label: 'Critical / Offline', value: critical, color: '#ef4444' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: `${s.color}14`, border: `1px solid ${s.color}26` }}>
            <s.icon size={20} style={{ color: s.color }} />
            <div>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* All devices grid */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-bold text-white">All Devices ({devices.length})</h3>
          {devices.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {devices.map((d) => {
                const meta = DOMAIN_META[d.domain]
                const Icon = domainIcon[d.domain]
                const liveVal = liveFrames[d.id]
                const dynHealth = d.domain === 'transformer' ? (liveVal ? healthFromValues(liveVal, 'transformer') : null) : null
                const healthVal = dynHealth ?? d.healthIndex ?? 95
                const hColor = healthVal >= 80 ? '#4ade80' : healthVal >= 60 ? '#fbbf24' : '#ef4444'

                return (
                  <Link key={d.id} href={d.domain === 'transformer' ? `/customer/transformers/detail?id=${d.id}` : `/customer/devices/detail?id=${d.id}`}>
                    <div className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5" style={surface}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f` }}><Icon size={15} style={{ color: meta.accent }} /></span>
                          <div>
                            <div className="text-sm font-semibold text-white">{d.name}</div>
                            <div className="text-[10px]" style={{ color: meta.accent }}>{meta.platform}</div>
                          </div>
                        </div>
                        <span className={`w-2.5 h-2.5 rounded-full ${d.status === 'NORMAL' ? 'animate-pulse' : ''}`} style={{ background: statusColor(d.status), boxShadow: `0 0 6px ${statusColor(d.status)}` }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{metric(d, liveVal)}</span>
                        <ChevronRight size={15} className="text-slate-600" />
                      </div>
                      {d.domain === 'transformer' && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">Health Index</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${healthVal}%`, background: hColor }}
                              />
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: hColor }}>{healthVal}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl p-6 text-center text-slate-600 text-sm" style={surface}>No products assigned to your department.</div>
          )}
        </div>

        {/* All notification alarms */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Bell size={14} className="text-indigo-400" /> All Notifications
            </h3>
            {orgAlarms.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-semibold">
                {orgAlarms.length}
              </span>
            )}
          </div>
          <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
            {orgAlarms.length ? orgAlarms.map((a) => {
              const c = statusColor(a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'WARNING' ? 'WARNING' : 'NORMAL')
              const linkHref = a.domain === 'transformer' ? `/customer/transformers/detail?id=${a.nodeId}` : `/customer/devices/detail?id=${a.nodeId}`
              return (
                <Link key={a.id} href={linkHref}>
                  <div
                    className="p-3 rounded-xl hover:border-indigo-500/40 transition-all cursor-pointer mb-2"
                    style={{ background: `${c}10`, border: `1px solid ${c}26`, opacity: a.acknowledged ? 0.6 : 1 }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-slate-200 leading-snug font-medium">{a.message}</div>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: `${c}22`, color: c, border: `1px solid ${c}44` }}
                      >
                        {a.severity}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-slate-500">
                      <span className="text-slate-400 font-medium">{a.transformerName}</span>
                      <div className="flex items-center gap-1.5">
                        <Clock size={10} />
                        <span>{fmtHM(a.timestamp)}</span>
                        {a.acknowledged && <span className="text-green-400 font-semibold">· ACK</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            }) : <div className="rounded-xl p-6 text-center text-slate-600 text-xs" style={surface}>No active notifications for this organization.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Device Location tab ----------------------------------------------------
// A read-only quick glance, same as admin/page.tsx's location tab — the full
// map+layout experience (with photos) lives at /customer/map, so this tab
// just links there rather than duplicating it. Viewers never get pin-drop or
// coordinate entry (that's an admin/superadmin capability), so unlike
// admin/page.tsx there is no "set device positions" link here.
// Same split every other monitor-route helper in this codebase uses
// (admin/page.tsx, admin/map, superadmin/monitoring): transformer keeps its
// dedicated dashboard, everything else shares the generic node twin.
function customerMonitorRoute(domain: GeoNode['domain'], id: string): string {
  return domain === 'transformer' ? `/customer/transformers/detail?id=${encodeURIComponent(id)}` : `/customer/devices/detail?id=${encodeURIComponent(id)}`
}

function LocationTab() {
  const router = useRouter()
  const orgId = useSessionOrgId()
  const { viewerUserId } = useAppStore()
  const live = useIsLive()
  const allowed = viewerDomains(viewerUserId)
  const liveNodes = useLiveGeoNodes(orgId)
  const nodes = live && liveNodes ? liveNodes : getGeoNodes(orgId).filter((n) => allowed.includes(n.domain))
  const covers = useOrgPhotoCovers(orgId)
  const [previewId, setPreviewId] = useState<string | null>(null)

  return (
    <>
      <div className="flex justify-end">
        <Link href="/customer/map" className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300">
          <MapIcon size={12} /> Full map &amp; layout view →
        </Link>
      </div>
      <LiveSensorMap nodes={nodes} height="62vh" photoCovers={covers} onOpenPhotos={setPreviewId}
        onOpenDevice={(id, domain) => router.push(customerMonitorRoute(domain, id))} />
      {previewId && (
        <NodePhotoPreview nodeId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </>
  )
}

// --- Dashboard shell with tabs, matching admin/page.tsx's layout -----------
export default function CustomerPage() {
  const [tab, setTab] = useState<'overview' | 'location' | 'alarm'>('overview')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">All devices &amp; notifications you have access to</p>
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
      {tab === 'location' && <LocationTab />}
      {tab === 'alarm' && <CustomerAlarmsView embedded />}
    </div>
  )
}
