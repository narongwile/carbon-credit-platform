'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { platformStats, auditLogs, organizations } from '@/lib/mockData'
import { api, useIsLive } from '@/lib/api'
import type { MapOrg } from '@/components/map/OrgDistributionMap'
import { Building2, Zap, Database, Activity, CheckCircle, XCircle, Clock } from 'lucide-react'
import { fmtHM } from '@/lib/displayTime'

const OrgDistributionMap = dynamic(() => import('@/components/map/OrgDistributionMap'), { ssr: false })

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="text-sm text-slate-400">{label}</div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}20` }}>
          <span style={{ color }}>{icon}</span>
        </div>
      </div>
      <div className="text-3xl font-bold text-white mb-1">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function WorldMapViz() {
  const live = useIsLive()
  const [orgs, setOrgs] = useState<MapOrg[]>([])

  useEffect(() => {
    // Live → real orgs (with lat/lng) from the backend; else the mock seed.
    if (live) {
      api.orgs().then((rows) => {
        if (!rows) return
        setOrgs(rows.filter((o) => o.lat != null && o.lng != null)
          .map((o) => ({ id: o.id, name: o.name, lat: Number(o.lat), lng: Number(o.lng), active: o.status !== 'suspended' })))
      })
    } else {
      setOrgs(organizations
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({ id: o.id, name: o.name, lat: o.lat as number, lng: o.lng as number, where: o.country, active: true })))
    }
  }, [live])

  const activeCount = orgs.filter((o) => o.active).length

  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            Global Distribution
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={live ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80' } : { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>{live ? 'LIVE' : 'DEMO'}</span>
          </h3>
          <p className="text-xs text-slate-500">Active organization nodes by location · zoom &amp; pan</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px #4ade80' }} />
          <span><span className="text-white font-semibold">{activeCount}</span> / {orgs.length} orgs</span>
        </div>
      </div>
      <OrgDistributionMap orgs={orgs} />
    </div>
  )
}

function PlatformHealth() {
  const services = [
    { name: 'API Gateway', status: 'operational', latency: '12ms', uptime: '99.99%' },
    { name: 'Data Ingestion', status: 'operational', latency: '8ms', uptime: '99.97%' },
    { name: 'Digital Twin Engine', status: 'operational', latency: '45ms', uptime: '99.95%' },
    { name: 'Alarm Processing', status: 'degraded', latency: '120ms', uptime: '98.2%' },
    { name: 'Report Generator', status: 'operational', latency: '230ms', uptime: '99.98%' },
    { name: 'AI Diagnostics', status: 'operational', latency: '380ms', uptime: '99.91%' },
  ]

  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <h3 className="text-sm font-semibold text-white mb-4">Platform Services Health</h3>
      <div className="space-y-2">
        {services.map((svc) => (
          <div key={svc.name} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: '#0a0e1a' }}>
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${svc.status === 'operational' ? 'bg-green-400' : 'bg-amber-400'}`} />
              <span className="text-sm text-slate-300">{svc.name}</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-500">{svc.latency}</span>
              <span className={svc.status === 'operational' ? 'text-green-400' : 'text-amber-400'}>{svc.uptime}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SuperAdminPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Global Overview</h1>
        <p className="text-sm text-slate-500 mt-1">Platform-wide metrics and system health</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Building2 size={18} />} label="Total Organizations" value="124" sub="+3 this month" color="#6366f1" />
        <StatCard icon={<Zap size={18} />} label="Active Transformers" value="4,247" sub="97.8% online" color="#4ade80" />
        <StatCard icon={<Database size={18} />} label="Data Volume" value="4.2 PB" sub="↑ 0.3 PB this week" color="#06b6d4" />
        <StatCard icon={<Activity size={18} />} label="Platform Uptime" value="99.97%" sub="Last 30 days SLA" color="#a78bfa" />
      </div>

      {/* Map + health */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <WorldMapViz />
        </div>
        <PlatformHealth />
      </div>

      {/* Audit log */}
      <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Recent Audit Log</h3>
          <button className="text-xs text-indigo-400 hover:text-indigo-300">View All Logs</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2433' }}>
                {['Actor', 'Action', 'Target', 'Time', 'Status'].map((h) => (
                  <th key={h} className="pb-3 text-left text-xs text-slate-500 font-medium px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #0a0e1a' }}>
                  <td className="py-3 px-2">
                    <span className="text-indigo-400 font-medium">{log.actor}</span>
                  </td>
                  <td className="py-3 px-2 text-slate-300">{log.action}</td>
                  <td className="py-3 px-2 text-slate-400">{log.target}</td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1 text-slate-500 text-xs">
                      <Clock size={10} />
                      {fmtHM(log.timestamp)}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    {log.status === 'success' ? (
                      <div className="flex items-center gap-1 text-green-400 text-xs">
                        <CheckCircle size={12} /> Success
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-red-400 text-xs">
                        <XCircle size={12} /> Failed
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Org quick stats */}
      <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <h3 className="text-sm font-semibold text-white mb-4">Top Organizations by Activity</h3>
        <div className="space-y-3">
          {organizations.map((org) => (
            <div key={org.id} className="flex items-center gap-4">
              <div className="w-32 text-sm text-slate-300 truncate">{org.name}</div>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#1e2433' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(org.transformerCount / 15) * 100}%`,
                    background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  }}
                />
              </div>
              <div className="text-xs text-slate-500 w-20 text-right">{org.transformerCount} transformers</div>
              <div className={`text-xs px-2 py-0.5 rounded-full ${
                org.licenseTier === 'enterprise' ? 'text-indigo-400 bg-indigo-400/10' :
                org.licenseTier === 'professional' ? 'text-cyan-400 bg-cyan-400/10' :
                'text-slate-400 bg-slate-400/10'
              }`}>
                {org.licenseTier}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
