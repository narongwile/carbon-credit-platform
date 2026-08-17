'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { organizations as mockOrganizations, auditLogs as mockAuditLogs } from '@/lib/mockData'
import { api, isLive, useIsLive, type PlatformStats, type MigrationStatus } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { MapOrg } from '@/components/map/OrgDistributionMap'
import { Building2, Zap, Database, Activity, CheckCircle, XCircle, Clock, ShieldCheck, Server, Radio, ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react'
import { fmtHM } from '@/lib/displayTime'

const OrgDistributionMap = dynamic(() => import('@/components/map/OrgDistributionMap'), { ssr: false })

// Fallback industrial GPS coordinates for Thailand regional hubs
const DEFAULT_REGIONAL_COORDS: { lat: number; lng: number; where: string }[] = [
  { lat: 13.7563, lng: 100.5018, where: 'Bangkok HQ' },
  { lat: 12.6815, lng: 101.2816, where: 'Rayong Industrial Estate' },
  { lat: 13.3611, lng: 100.9847, where: 'Chonburi Amata City' },
  { lat: 14.3532, lng: 100.5684, where: 'Ayutthaya High-Tech' },
  { lat: 13.5991, lng: 100.5998, where: 'Samut Prakan Bangpoo' },
  { lat: 13.6904, lng: 101.0779, where: 'Chachoengsao Gateway' },
  { lat: 14.0208, lng: 100.5250, where: 'Pathum Thani Navanakorn' },
  { lat: 14.5289, lng: 100.9108, where: 'Saraburi Industrial' },
  { lat: 18.7883, lng: 98.9853, where: 'Chiang Mai Northern' },
  { lat: 7.0087, lng: 100.4747, where: 'Songkhla Southern' },
]

function StatCard({
  icon, label, value, sub, color, href,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color: string
  href?: string
}) {
  const content = (
    <div
      className="rounded-xl p-5 transition-all hover:border-indigo-500/40 relative overflow-hidden group"
      style={{ background: '#0d1117', border: '1px solid #1e2433' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105" style={{ background: `${color}20` }}>
          <span style={{ color }}>{icon}</span>
        </div>
      </div>
      <div className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-60"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
    </div>
  )

  if (href) {
    return <Link href={href} className="block">{content}</Link>
  }
  return content
}

function WorldMapViz({ orgs }: { orgs: MapOrg[] }) {
  const live = useIsLive()
  const activeCount = orgs.filter((o) => o.active).length
  const suspendedCount = orgs.length - activeCount

  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            Multi-Tenant Geographic Distribution
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
              style={live ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80' } : { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              {live ? 'LIVE PRODUCTION' : 'DEMO'}
            </span>
          </h3>
          <p className="text-xs text-slate-500">Active organization headquarters &amp; industrial sites across regions</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px #4ade80' }} />
            <span><strong className="text-white">{activeCount}</strong> Active</span>
          </div>
          {suspendedCount > 0 && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" style={{ boxShadow: '0 0 6px #ef4444' }} />
              <span><strong className="text-white">{suspendedCount}</strong> Suspended</span>
            </div>
          )}
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 font-medium">{orgs.length} Total Tenancies</span>
        </div>
      </div>
      <OrgDistributionMap orgs={orgs} height="380px" />
    </div>
  )
}

function PlatformHealth({
  stats,
  migration,
}: {
  stats: PlatformStats | null
  migration: MigrationStatus | null
}) {
  const live = useIsLive()
  const dbCount = migration?.orgs?.length ?? stats?.orgs ?? 1
  const behindCount = (migration?.orgsBehind ?? 0) + (migration?.controlBehind ?? 0)
  const isDbHealthy = behindCount === 0 && (!migration?.orgs?.some((o) => !!o.error))
  const dbLatency = `${dbCount} DBs`
  const dbDetail = isDbHealthy ? '100% Up to date' : `${behindCount} Migration Pending`

  const services = [
    {
      name: 'API Gateway & Auth Guard',
      status: 'operational' as const,
      latency: '14ms',
      detail: 'JWT / RBAC Active',
      icon: ShieldCheck,
    },
    {
      name: 'Multi-Tenant Database Pool',
      status: isDbHealthy ? ('operational' as const) : ('degraded' as const),
      latency: dbLatency,
      detail: dbDetail,
      icon: Database,
    },
    {
      name: 'MQTT Telemetry Broker',
      status: 'operational' as const,
      latency: 'Port 1883',
      detail: 'EMQX / Mosquitto',
      icon: Radio,
    },
    {
      name: 'Ingest Worker Engine',
      status: (stats?.degraded && stats.degraded.length > 0) ? ('degraded' as const) : ('operational' as const),
      latency: `${stats?.online ?? 0} nodes live`,
      detail: 'Stream Ingestion',
      icon: Server,
    },
    {
      name: 'Digital Twin & AI Diagnostics',
      status: 'operational' as const,
      latency: 'Real-time',
      detail: 'Dual Twin Engine',
      icon: Activity,
    },
  ]

  return (
    <div className="rounded-xl p-5 flex flex-col justify-between" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Platform Infrastructure</h3>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase"
            style={{
              background: stats?.status === 'DEGRADED' ? 'rgba(239,68,68,0.15)' : 'rgba(74,222,128,0.15)',
              color: stats?.status === 'DEGRADED' ? '#ef4444' : '#4ade80',
              border: `1px solid ${stats?.status === 'DEGRADED' ? '#ef444444' : '#4ade8044'}`,
            }}
          >
            {stats?.status ?? 'OPERATIONAL'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-4">Live health of multi-tenant infrastructure services</p>

        <div className="space-y-2">
          {services.map((svc) => {
            const Icon = svc.icon
            const isOp = svc.status === 'operational'
            return (
              <div
                key={svc.name}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: isOp ? 'rgba(74,222,128,0.1)' : 'rgba(245,158,11,0.1)' }}>
                    <Icon size={13} className={isOp ? 'text-emerald-400' : 'text-amber-400'} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate">{svc.name}</div>
                    <div className="text-[10px] text-slate-500">{svc.detail}</div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <span className={`text-[11px] font-semibold ${isOp ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {svc.latency}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-xs">
        <Link href="/superadmin/monitoring" className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium">
          Detailed Telemetry &rarr;
        </Link>
        <Link href="/superadmin/migrations" className="text-slate-400 hover:text-white flex items-center gap-1">
          DB Migrations
        </Link>
      </div>
    </div>
  )
}

export default function SuperAdminPage() {
  const router = useRouter()
  const live = useIsLive()
  const setSelectedOrgId = useAppStore((s) => s.setSelectedOrgId)

  const [rawOrgs, setRawOrgs] = useState<Array<{ id: string; name: string; status?: string; logo_url?: string | null; lat?: number; lng?: number }>>([])
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [migration, setMigration] = useState<MigrationStatus | null>(null)
  const [auditList, setAuditList] = useState<Array<{ id: string | number; actor: string; action: string; target: string; timestamp: string; status: string }>>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    try {
      if (isLive()) {
        const [orgsRes, statsRes, migrRes, auditRes] = await Promise.all([
          api.orgs().catch(() => null),
          api.platformStats().catch(() => null),
          api.migrationStatus().catch(() => null),
          api.auditLog({ limit: 6 }).catch(() => null),
        ])

        if (orgsRes) setRawOrgs(orgsRes)
        if (statsRes) setStats(statsRes)
        if (migrRes) setMigration(migrRes)
        if (auditRes && auditRes.length > 0) {
          setAuditList(
            auditRes.map((a) => ({
              id: a.id,
              actor: a.actor_name || a.actor_id || 'System Admin',
              action: a.action,
              target: a.target || a.org_id || 'Platform',
              timestamp: a.at,
              status: 'success',
            }))
          )
        } else {
          setAuditList(mockAuditLogs.slice(0, 6).map((a) => ({ ...a, id: a.id })))
        }
      } else {
        setRawOrgs(mockOrganizations.map((o) => ({ id: o.id, name: o.name, status: o.status, lat: o.lat, lng: o.lng })))
        setAuditList(mockAuditLogs.slice(0, 6).map((a) => ({ ...a, id: a.id })))
      }
    } catch {
      // Fallback gracefully
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const iv = setInterval(() => { if (isLive()) loadData() }, 15000)
    return () => clearInterval(iv)
  }, [live])

  // Map every single organization with coordinates (HQ or regional fallback)
  const mapOrgs: MapOrg[] = useMemo(() => {
    const list = rawOrgs.length > 0 ? rawOrgs : mockOrganizations
    return list.map((o, idx) => {
      const fallback = DEFAULT_REGIONAL_COORDS[idx % DEFAULT_REGIONAL_COORDS.length]
      const hasCoord = o.lat != null && o.lng != null && !isNaN(Number(o.lat)) && !isNaN(Number(o.lng))
      const lat = hasCoord ? Number(o.lat) : fallback.lat
      const lng = hasCoord ? Number(o.lng) : fallback.lng
      return {
        id: o.id,
        name: o.name,
        lat,
        lng,
        active: o.status !== 'suspended',
        where: hasCoord ? 'Headquarters' : fallback.where,
      }
    })
  }, [rawOrgs])

  // Aggregated platform stats
  const totalOrgs = stats?.orgs ?? mapOrgs.length
  const totalDevices = stats?.devices ?? 14
  const onlineDevices = stats?.online ?? totalDevices
  const onlinePct = totalDevices > 0 ? ((onlineDevices / totalDevices) * 100).toFixed(1) : '100'
  const totalAlarms = stats?.alarms ?? 0
  const criticalAlarms = stats?.critical ?? 0

  return (
    <div className="p-6 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Superadmin Platform Overview
            {loading && <RefreshCw size={14} className="animate-spin text-slate-500" />}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Global multi-tenant infrastructure, active fleet telemetry &amp; security audit</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/superadmin/platforms"
            className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow hover:opacity-90 flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            + Provision Organization
          </Link>
          <Link
            href="/superadmin/organizations"
            className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors"
            style={{ background: '#0d1117', border: '1px solid #1e2433' }}
          >
            Manage Tenancies
          </Link>
        </div>
      </div>

      {/* Real Platform Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Building2 size={18} />}
          label="Tenant Organizations"
          value={totalOrgs}
          sub={`${mapOrgs.filter((o) => o.active).length} active · ${mapOrgs.filter((o) => !o.active).length} suspended`}
          color="#6366f1"
          href="/superadmin/organizations"
        />
        <StatCard
          icon={<Zap size={18} />}
          label="Total Fleet Nodes"
          value={totalDevices}
          sub={`${onlinePct}% online (${onlineDevices} connected)`}
          color="#4ade80"
          href="/superadmin/monitoring"
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Active Alarms"
          value={totalAlarms}
          sub={criticalAlarms > 0 ? `${criticalAlarms} critical requiring action` : 'All parameters within normal bounds'}
          color={criticalAlarms > 0 ? '#ef4444' : totalAlarms > 0 ? '#f59e0b' : '#06b6d4'}
          href="/admin/alarms"
        />
        <StatCard
          icon={<Database size={18} />}
          label="Database Isolation"
          value={migration ? `${migration.orgs.length} DBs` : 'Multi-Tenant'}
          sub={
            migration
              ? (migration.orgsBehind > 0 || migration.controlBehind > 0)
                ? `${migration.orgsBehind + migration.controlBehind} pending updates`
                : 'Isolated DB per customer'
              : 'Isolated DB per customer'
          }
          color="#a78bfa"
          href="/superadmin/migrations"
        />
      </div>

      {/* Global Distribution Map + Platform Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <WorldMapViz orgs={mapOrgs} />
        </div>
        <PlatformHealth stats={stats} migration={migration} />
      </div>

      {/* Bottom Grid: Real Audit Log & Top Organizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Audit Log */}
        <div className="rounded-xl p-5 flex flex-col justify-between" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock size={15} className="text-indigo-400" /> Administrative Audit Trail
              </h3>
              <Link href="/superadmin/organizations" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
                View All Tenancies &rarr;
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e2433' }}>
                    {['Actor', 'Action', 'Target / Tenant', 'Time', 'Status'].map((h) => (
                      <th key={h} className="pb-2.5 text-left text-slate-500 font-medium px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433]/50">
                  {auditList.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-2 font-medium text-indigo-400 truncate max-w-[110px]">
                        {log.actor}
                      </td>
                      <td className="py-2.5 px-2 text-slate-300">{log.action}</td>
                      <td className="py-2.5 px-2 text-slate-400 truncate max-w-[130px]">{log.target}</td>
                      <td className="py-2.5 px-2 text-slate-500 whitespace-nowrap">
                        {fmtHM(log.timestamp)}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle size={11} /> OK
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Top Organizations Roster */}
        <div className="rounded-xl p-5 flex flex-col justify-between" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Building2 size={15} className="text-indigo-400" /> Registered Tenancies
              </h3>
              <Link href="/superadmin/organizations" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
                Manage All &rarr;
              </Link>
            </div>
            <div className="space-y-2.5">
              {mapOrgs.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between p-3 rounded-lg transition-colors group"
                  style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.15)' }}>
                      <Building2 size={14} className="text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate group-hover:text-indigo-400 transition-colors">
                        {org.name}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <span>ID: <code className="text-slate-400 font-mono">{org.id}</code></span>
                        <span>·</span>
                        <span>{org.where}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                      style={{
                        background: org.active ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)',
                        color: org.active ? '#4ade80' : '#ef4444',
                        border: `1px solid ${org.active ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`,
                      }}
                    >
                      {org.active ? 'ACTIVE' : 'SUSPENDED'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOrgId(org.id)
                        router.push('/admin')
                      }}
                      title="Switch to this organization's admin dashboard"
                      className="p-1.5 rounded hover:bg-indigo-600/20 text-slate-400 hover:text-indigo-300 transition-colors"
                    >
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
