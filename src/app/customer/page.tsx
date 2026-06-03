'use client'

import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { getHostsByOrg } from '@/lib/fleetData'
import { viewerDomains } from '@/lib/viewer'
import { DOMAIN_META, type SensorDomain, type SensorHost } from '@/types/fleet'
import { CheckCircle, AlertTriangle, XCircle, Bell, Clock, Zap, Thermometer, Droplet, ChevronRight } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const domainIcon: Record<SensorDomain, React.ElementType> = { transformer: Zap, carbonNode: Thermometer, bloodBox: Droplet }
const statusColor = (s: string) => (s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280')

function metric(h: SensorHost): string {
  if (h.domain === 'transformer') return `Health ${h.healthIndex}`
  if (h.domain === 'carbonNode') return `${h.targetMinC}–${h.targetMaxC}°C`
  return `set ${h.setLowC}–${h.setHighC}°C`
}

export default function CustomerPage() {
  const { viewerUserId, alarms } = useAppStore()
  const allowed = viewerDomains(viewerUserId)
  const devices = getHostsByOrg('org-1').filter((h) => allowed.includes(h.domain))

  const normal = devices.filter((d) => d.status === 'NORMAL').length
  const warning = devices.filter((d) => d.status === 'WARNING').length
  const critical = devices.filter((d) => d.status === 'CRITICAL' || d.status === 'OFFLINE').length

  // all notification alarms (org-1), limited to accessible products by name match
  const orgAlarms = alarms.filter((a) => a.orgId === 'org-1')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">All devices &amp; notifications you have access to</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* All devices grid */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-bold text-white">All Devices ({devices.length})</h3>
          {devices.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {devices.map((d) => {
                const meta = DOMAIN_META[d.domain]
                const Icon = domainIcon[d.domain]
                return (
                  <Link key={d.id} href={`/customer/devices/${d.id}`}>
                    <div className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5" style={surface}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f` }}><Icon size={15} style={{ color: meta.accent }} /></span>
                          <div>
                            <div className="text-sm font-semibold text-white">{d.name}</div>
                            <div className="text-[10px]" style={{ color: meta.accent }}>{meta.platform}</div>
                          </div>
                        </div>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: statusColor(d.status), boxShadow: `0 0 6px ${statusColor(d.status)}` }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{metric(d)}</span>
                        <ChevronRight size={15} className="text-slate-600" />
                      </div>
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
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Bell size={14} className="text-indigo-400" /> All Notifications</h3>
          <div className="space-y-2 max-h-[460px] overflow-auto">
            {orgAlarms.length ? orgAlarms.map((a) => {
              const c = statusColor(a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'WARNING' ? 'WARNING' : 'NORMAL')
              return (
                <div key={a.id} className="p-3 rounded-xl" style={{ background: `${c}10`, border: `1px solid ${c}26`, opacity: a.acknowledged ? 0.6 : 1 }}>
                  <div className="text-sm text-slate-200 leading-snug">{a.message}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
                    <span>{a.transformerName}</span>
                    <span className="flex items-center gap-1"><Clock size={9} />{new Date(a.timestamp).toLocaleTimeString()}</span>
                    {a.acknowledged && <span className="text-green-400">· ACK</span>}
                  </div>
                </div>
              )
            }) : <div className="rounded-xl p-4 text-center text-slate-600 text-xs" style={surface}>No notifications.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
