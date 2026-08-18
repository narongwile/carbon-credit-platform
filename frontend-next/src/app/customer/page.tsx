'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { useOrgAlarms } from '@/lib/useOrgAlarms'
import { getSession, useSessionOrgId } from '@/lib/auth'
import { api, useIsLive } from '@/lib/api'
import { viewerDomains, viewerEventProblems } from '@/lib/viewer'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import { DOMAIN_META, type SensorDomain, type SensorHost } from '@/types/fleet'
import { healthFromValues } from '@/lib/alarmParams'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { CheckCircle, AlertTriangle, XCircle, Bell, Clock, Zap, Thermometer, Droplet, ChevronRight, LayoutDashboard, Map as MapIcon, ShieldAlert, Search, Check } from 'lucide-react'
import { fmtHM } from '@/lib/displayTime'
import clsx from 'clsx'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const domainIcon: Record<SensorDomain, React.ElementType> = { transformer: Zap, carbonNode: Thermometer, bloodBox: Droplet }
const statusColor = (s: string) => (s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280')

function metric(h: SensorHost, liveVal?: Record<string, number>): string {
  if (h.domain === 'transformer') {
    const dyn = liveVal ? healthFromValues(liveVal, 'transformer') : null
    const health = dyn ?? (h.domain === 'transformer' ? h.healthIndex : 95)
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
  const rawDevices = fromBackend ? hosts : hosts.filter((h) => allowed.includes(h.domain))

  const [searchQuery, setSearchQuery] = useState('')
  const [domainFilter, setDomainFilter] = useState<'all' | SensorDomain>('all')
  const [msgRate, setMsgRate] = useState<number>(0)
  const [ackingId, setAckingId] = useState<string | null>(null)
  const [evProblems, setEvProblems] = useState<{ id: string; label: string; department_id?: string | null }[]>([])
  const [selectedProblems, setSelectedProblems] = useState<Record<string, string>>({})
  const msgCounterRef = useRef(0)
  const [, tick] = useState(0)

  // Department-scoped root causes (eventProblems): Only show causes belonging to
  // this viewer's assigned departments + org-wide causes (department_id === null)
  useEffect(() => {
    if (!live) {
      setEvProblems(viewerEventProblems(viewerUserId))
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const myDepts = (await api.myAccess())?.departmentIds ?? []
        const rows = await api.eventProblems(orgId).catch(() => null)
        if (cancelled || !rows) return
        const scoped = rows.filter((r) => r.department_id === null || myDepts.includes(r.department_id))
        setEvProblems(scoped)
      } catch (err) {
        console.error('Failed to load department-scoped event problems:', err)
      }
    })()
    return () => { cancelled = true }
  }, [live, orgId, viewerUserId])

  const devices = useMemo(() => {
    return rawDevices.filter((d) => {
      if (domainFilter !== 'all' && d.domain !== domainFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
      }
      return true
    })
  }, [rawDevices, domainFilter, searchQuery])

  const normal = rawDevices.filter((d) => d.status === 'NORMAL').length
  const warning = rawDevices.filter((d) => d.status === 'WARNING').length
  const critical = rawDevices.filter((d) => d.status === 'CRITICAL' || d.status === 'OFFLINE').length

  // Real, open alarms for this org (department/domain-scoped server-side)
  const { alarms: liveAlarms, refetch: refetchAlarms } = useOrgAlarms(orgId, { open: true, pollMs: 5000 })
  const { alarms: mockAlarms } = useAppStore()
  const [liveFrames, setLiveFrames] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    if (!live) return
    const off = subscribeTelemetry((f) => {
      msgCounterRef.current += 1
      if (f?.id) {
        const id = f.id
        if (f.values) {
          const vals = f.values
          setLiveFrames((prev) => ({ ...prev, [id]: vals }))
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

  const handleAck = async (alarmId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAckingId(alarmId)
    try {
      const probId = selectedProblems[alarmId] || undefined
      if (live) {
        await api.ackEvent(alarmId, { by: getSession()?.name ?? 'Viewer', eventProblemId: probId })
        await refetchAlarms()
      }
    } catch (err) {
      console.error('Ack error:', err)
    } finally {
      setAckingId(null)
    }
  }

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

  const avgHealth = useMemo(() => {
    if (!rawDevices.length) return 100
    const scores = rawDevices.map((d) => {
      if (d.domain === 'transformer') {
        const lv = liveFrames[d.id]
        const dyn = lv ? healthFromValues(lv, 'transformer') : null
        return dyn ?? (d.domain === 'transformer' ? d.healthIndex : 95)
      }
      return d.status === 'CRITICAL' ? 50 : d.status === 'WARNING' ? 75 : 98
    })
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  }, [rawDevices, liveFrames])

  const hColor = avgHealth >= 80 ? '#4ade80' : avgHealth >= 60 ? '#fbbf24' : '#ef4444'

  return (
    <div className="space-y-6">
      {/* Header with Live Telemetry Pulse */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">Monitoring Overview</h2>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Telemetry {msgRate > 0 ? `(${(msgRate / 2).toFixed(1)} msg/s)` : 'Connected'}
            </span>
          </div>
          <p className="text-sm text-slate-500">Real-time status across your assigned assets</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 shadow-sm">
          <span className="text-xs text-slate-400">Fleet Health:</span>
          <span className="text-xs font-bold" style={{ color: hColor }}>{avgHealth}%</span>
        </div>
      </div>

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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setDomainFilter('all')}
            className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              domainFilter === 'all' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
            }`}
          >
            All ({rawDevices.length})
          </button>
          {rawDevices.some((d) => d.domain === 'transformer') && (
            <button
              type="button"
              onClick={() => setDomainFilter('transformer')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'transformer' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Zap size={12} className="text-amber-400" /> Transformers ({rawDevices.filter((d) => d.domain === 'transformer').length})
            </button>
          )}
          {rawDevices.some((d) => d.domain === 'carbonNode') && (
            <button
              type="button"
              onClick={() => setDomainFilter('carbonNode')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'carbonNode' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Thermometer size={12} className="text-emerald-400" /> CarbonBOX ({rawDevices.filter((d) => d.domain === 'carbonNode').length})
            </button>
          )}
          {rawDevices.some((d) => d.domain === 'bloodBox') && (
            <button
              type="button"
              onClick={() => setDomainFilter('bloodBox')}
              className={`flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                domainFilter === 'bloodBox' ? 'bg-indigo-600 text-white shadow' : 'bg-[#0d1117] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Droplet size={12} className="text-rose-400" /> BloodBOX ({rawDevices.filter((d) => d.domain === 'bloodBox').length})
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-60">
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
                const healthVal = dynHealth ?? (d.domain === 'transformer' ? d.healthIndex : 95)
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
            <div className="rounded-xl p-6 text-center text-slate-600 text-sm" style={surface}>No products match the selected filter.</div>
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
                <div
                  key={a.id}
                  className="p-3 rounded-xl transition-all mb-2"
                  style={{ background: `${c}10`, border: `1px solid ${c}26`, opacity: a.acknowledged ? 0.6 : 1 }}
                >
                  <Link href={linkHref}>
                    <div className="cursor-pointer hover:opacity-90">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm text-slate-200 leading-snug font-medium">{a.message}</div>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ background: `${c}22`, color: c, border: `1px solid ${c}44` }}
                        >
                          {a.severity}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-800/40 text-[11px] text-slate-500">
                    <span className="text-slate-400 font-medium">{a.transformerName}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Clock size={10} />
                        <span>{fmtHM(a.timestamp)}</span>
                      </div>
                      {!a.acknowledged ? (
                        <div className="flex items-center gap-1.5">
                          {evProblems.length > 0 && (
                            <select
                              value={selectedProblems[a.id] || ''}
                              onChange={(e) => {
                                e.stopPropagation()
                                setSelectedProblems({ ...selectedProblems, [a.id]: e.target.value })
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] bg-[#0d1117] text-slate-300 border border-slate-700 rounded-lg px-1.5 py-0.5 outline-none max-w-[110px] truncate"
                            >
                              <option value="">Cause (Opt)…</option>
                              {evProblems.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                              ))}
                            </select>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleAck(a.id, e)}
                            disabled={ackingId === a.id}
                            className="px-2 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 disabled:opacity-50 cursor-pointer shadow"
                          >
                            <Check size={10} /> {ackingId === a.id ? 'ACKing…' : 'ACK'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-green-400 font-semibold flex items-center gap-1 text-[10px]">
                          <Check size={10} /> ACK
                        </span>
                      )}
                    </div>
                  </div>
                </div>
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
