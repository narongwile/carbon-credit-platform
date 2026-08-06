'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession } from '@/lib/auth'
import { api, useIsLive } from '@/lib/api'
import type { PlatformStats } from '@/lib/api'
import MigrationsPanel, { useMigrationStatus } from '@/components/superadmin/MigrationsPanel'
import {
  Boxes, Globe, Building2, ShieldCheck, ScrollText, Layers, Palette,
  Puzzle, LifeBuoy, LogOut, Activity, ChevronRight, MonitorDot,
  Cpu, Database, AlertTriangle
} from 'lucide-react'
import clsx from 'clsx'

/** How often the header's real counters refresh. */
const STATS_MS = 30_000

const NAV = [
  { href: '/superadmin', label: 'Global Overview', icon: Globe, exact: true },
  { href: '/superadmin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/superadmin/monitoring', label: 'Sensor Monitoring', icon: MonitorDot },
  { href: '/superadmin/platforms', label: 'Platform Catalog', icon: Layers },
  { href: '/superadmin/themes', label: 'Dashboard Themes', icon: Palette },
  { href: '/superadmin/entitlements', label: 'Feature Entitlements', icon: ShieldCheck },
  { href: '/superadmin/license', label: 'License Manager', icon: ScrollText },
  { href: '/superadmin/logs', label: 'System Logs', icon: Activity },
  { href: '/superadmin/integrations', label: 'API & Integrations', icon: Puzzle },
]

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [time, setTime] = useState('')
  const live = useIsLive()
  // The header's three numbers used to be hardcoded strings — "OPERATIONAL"
  // in green whatever was happening, "4.2K req/s" from no source at all, and
  // a literal "23" alarms. On the one screen whose job is to say whether the
  // platform is healthy, that is worse than showing nothing.
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const migrations = useMigrationStatus()
  const [showMigrations, setShowMigrations] = useState(false)

  useEffect(() => {
    const session = getSession()
    if (!session || session.role !== 'superadmin') {
      router.replace('/')
    }
    const tick = () => setTime(new Date().toLocaleTimeString())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [router])

  useEffect(() => {
    if (!live) { setStats(null); return }
    let cancelled = false
    const load = () => { api.platformStats().then((r) => { if (!cancelled) setStats(r) }) }
    load()
    const id = setInterval(load, STATS_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [live])

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0e1a' }}>
      {/* Sidebar */}
      <aside className="w-64 flex flex-col flex-shrink-0" style={{ background: '#0d1117', borderRight: '1px solid #1e2433' }}>
        {/* Logo */}
        <div className="p-5 pb-4" style={{ borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Boxes size={16} className="text-white" />
            </div>
            <span className="font-bold text-white tracking-wider text-sm">ONEOPS</span>
          </div>
          <div className="text-[10px] tracking-widest text-slate-500 ml-10 uppercase">Super Admin Portal</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group',
                  active
                    ? 'text-white'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                )}
                style={active ? { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' } : {}}
              >
                <item.icon size={16} className={active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'} />
                {item.label}
                {active && <ChevronRight size={14} className="ml-auto text-indigo-400" />}
              </Link>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-4 space-y-1" style={{ borderTop: '1px solid #1e2433' }}>
          <Link href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all">
            <LifeBuoy size={16} />
            Support
          </Link>
          <button
            onClick={() => { clearSession(); router.push('/') }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="px-6 py-3 flex items-center gap-4 flex-shrink-0" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
          {/* Every number here is queried (GET /api/platform/stats). "Global
              Traffic" is gone rather than faked — there is no request-rate
              source to read, and an invented one on this screen is a lie an
              operator would act on. */}
          {(() => {
            const st = stats?.status ?? 'OPERATIONAL'
            const dot = !live ? '#64748b' : st === 'DEGRADED' ? '#ef4444' : st === 'ALARMS' ? '#fbbf24' : '#4ade80'
            const label = !live ? 'DEMO' : !stats ? 'CHECKING…' : st
            return (
              <div className="flex items-center gap-2 text-xs text-slate-500" title={stats?.degraded.length ? `Unreachable: ${stats.degraded.join(', ')}` : undefined}>
                <div className="w-2 h-2 rounded-full" style={{ background: dot, animation: live && stats ? 'pulse 2s infinite' : undefined }} />
                <span>Platform: <span className="font-medium" style={{ color: dot }}>{label}</span></span>
              </div>
            )
          })()}
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Cpu size={12} className="text-indigo-400" />
            Devices: <span className="text-white font-medium">
              {stats ? `${stats.online}/${stats.devices} online` : '—'}
            </span>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AlertTriangle size={12} className={stats && stats.alarms > 0 ? 'text-amber-400' : 'text-slate-600'} />
            Active Alarms: <span className="font-medium" style={{ color: stats && stats.alarms > 0 ? '#fbbf24' : '#64748b' }}>
              {stats ? stats.alarms : '—'}
            </span>
            {!!stats?.critical && <span className="text-[10px] text-red-400">({stats.critical} critical)</span>}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-600">{time}</span>
            {/* Was "Deploy Update" — a button with no onClick, next to three
                invented numbers. Deploying is GitOps (ArgoCD watches the repo),
                so a deploy button here would be a second, unaudited path to
                production. The step deploying does NOT do — bringing every
                tenant database up to the schema the new code expects — had no
                UI at all, and forgetting it leaves an org silently on an older
                schema than the code beside it. */}
            <button
              onClick={() => setShowMigrations(true)}
              disabled={!live}
              title={migrations.status?.orgsBehind
                ? `${migrations.status.orgsBehind} tenant database(s) behind this build`
                : 'Schema migration status'}
              className="relative flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <Database size={12} />
              Run migrations
              {!!migrations.status?.orgsBehind && (
                <span className="ml-0.5 min-w-[18px] px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: '#f59e0b', color: '#0a0e1a' }}>
                  {migrations.status.orgsBehind}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>

        {showMigrations && (
          <MigrationsPanel
            status={migrations.status} loading={migrations.loading} reload={migrations.reload}
            onClose={() => setShowMigrations(false)} />
        )}
      </div>
    </div>
  )
}
