'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import OrgBrand from '@/components/OrgBrand'
import AppShell, { NavSection, type NavEntry } from '@/components/nav/AppShell'
import { useRealtimeData } from '@/lib/realtime'
import { isEntitled, type Entitlement } from '@/lib/entitlements'
import { organizations } from '@/lib/mockData'
import api, { isLive } from '@/lib/api'
import {
  Boxes, LayoutDashboard, Map, TrendingUp, Bell, Calendar,
  FileBarChart, Settings, LogOut, ChevronRight, AlertTriangle, Thermometer,
  Users, HardDrive, BellRing, UserCircle, Building2, Cpu, LayoutGrid,
  Search, Database, ShieldCheck, Droplet, PlugZap, Radio
} from 'lucide-react'
import clsx from 'clsx'

interface NavItem extends NavEntry {
  badge?: 'critical' | 'pending'
  requires?: Entitlement
}

// Grouped, because 21 flat entries make the user read the whole list to find
// one. Floor Plans sits under Sites: it is site-scoped (it picks a site, then a
// building, then a floor), so it belongs there rather than floating between the
// map and the trends. Grouping says so without moving the route — a URL change
// would only break existing links and bookmarks for no functional gain.
const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },

  { href: '/admin/sites', label: 'Sites (Unified)', icon: Building2, section: 'Sites & Location' },
  { href: '/admin/floorplans', label: 'Floor Plans', icon: LayoutGrid, child: true },
  { href: '/admin/map', label: 'Live Sensor Map', icon: Map },

  { href: '/admin/fleet', label: 'Fleet (Devices)', icon: Cpu, section: 'Devices' },
  { href: '/admin/devices', label: 'Device Management', icon: HardDrive },
  { href: '/admin/pending', label: 'Pending Devices', icon: PlugZap, badge: 'pending' },
  { href: '/admin/live-raw', label: 'Live Raw Telemetry', icon: Radio },

  // No platform gate any more: the page compares whichever product the org
  // actually has, so gating it on transformers hid it from fridge-only orgs.
  { href: '/admin/trends', label: 'Compare Devices', icon: TrendingUp, section: 'Monitoring' },
  { href: '/admin/refrigeration', label: 'Refrigeration', icon: Thermometer, requires: { platform: 'refrigerationDataLogger' } },
  { href: '/admin/bloodbox', label: 'BloodBOX', icon: Droplet, requires: { platform: 'bloodBox' } },
  { href: '/admin/alarms', label: 'Alarms', icon: Bell, badge: 'critical' },
  { href: '/admin/events', label: 'Events', icon: Calendar },

  { href: '/admin/ai-search', label: 'AI Search', icon: Search, section: 'Insights', requires: { feature: 'AI Predictive Diagnostics' } },
  { href: '/admin/sql', label: 'SQL AI', icon: Database, requires: { feature: 'Historical Analytics' } },
  { href: '/admin/quality', label: 'Data Quality', icon: ShieldCheck, requires: { feature: 'Historical Analytics' } },
  { href: '/admin/reports', label: 'Reports', icon: FileBarChart },

  { href: '/admin/users', label: 'User Management', icon: Users, section: 'Administration' },
  { href: '/admin/notifications', label: 'Alarm & Notify', icon: BellRing },
  { href: '/admin/profile', label: 'Profile', icon: UserCircle },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtimeData()
  return <>{children}</>
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { alarms, selectedOrgId, setSelectedOrgId, setOrgLogo, isLiveMode, toggleLiveMode } = useAppStore()
  const visibleNav = NAV.filter((item) => isEntitled(selectedOrgId, item.requires))
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const session = getSession()
    if (!session || (session.role !== 'admin' && session.role !== 'superadmin')) {
      router.replace('/')
    }
  }, [router])

  // Hydrate per-company logos from the backend (set in admin Settings).
  useEffect(() => {
    if (!isLive()) return
    api.orgs().then((rows) => {
      if (!rows) return
      for (const o of rows) if (o.logo_url) setOrgLogo(o.id, o.logo_url)
    })
  }, [setOrgLogo])

  // Live count of devices awaiting approval → nav badge. Superadmin counts every
  // org (incl. orphans); a tenant admin is scoped by the backend.
  useEffect(() => {
    if (!isLive()) return
    const sup = getSession()?.role === 'superadmin'
    const load = () =>
      api.pendingNodes(sup ? undefined : selectedOrgId)
        .then((rows) => { if (rows) setPendingCount(rows.length) })
        .catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [selectedOrgId])

  const unackedAlarms = alarms.filter((a) => !a.acknowledged && a.orgId === selectedOrgId)
  const criticalCount = unackedAlarms.filter((a) => a.severity === 'CRITICAL').length

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <RealtimeProvider>
      <AppShell brand={<OrgBrand orgId={selectedOrgId} />} sidebar={({ collapsed, close }) => (
        <>
          {/* Logo */}
          <div className={clsx('pb-3', collapsed ? 'lg:p-2' : 'p-4')} style={{ borderBottom: '1px solid #1e2433' }}>
            <div className={clsx('flex items-center justify-between mb-1', collapsed && 'lg:hidden')}>
              <OrgBrand orgId={selectedOrgId} />

              {/* Demo/Live Toggle */}
              <button
                onClick={toggleLiveMode}
                className={clsx(
                  "relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none",
                  isLiveMode ? "bg-indigo-500" : "bg-slate-600"
                )}
                title={isLiveMode ? "Switch to Demo Mode" : "Switch to Live Mode"}
              >
                <span
                  className={clsx(
                    "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                    isLiveMode ? "translate-x-4" : "translate-x-1"
                  )}
                />
              </button>
            </div>
            {/* Collapsed: the live/demo state still has to be visible and
                switchable — it changes whether every page shows real data. */}
            {collapsed && (
              <button
                onClick={toggleLiveMode}
                className="hidden lg:flex w-full justify-center py-1"
                title={isLiveMode ? 'Live mode — switch to Demo' : 'Demo mode — switch to Live'}
              >
                <span className={clsx('w-2 h-2 rounded-full', isLiveMode ? 'bg-indigo-400' : 'bg-slate-600')} />
              </button>
            )}
            {/* Tenant switcher — drives entitlement gating */}
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className={clsx('w-full mt-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500', collapsed && 'lg:hidden')}
              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
            {visibleNav.map((item) => {
              const active = isActive(item.href, item.exact)
              const badgeCount = item.badge === 'critical' ? criticalCount : item.badge === 'pending' ? pendingCount : 0
              const badgeColor = item.badge === 'pending' ? '#f59e0b' : '#ef4444'
              return (
                <div key={item.href}>
                  {item.section && <NavSection title={item.section} collapsed={collapsed} />}
                  <Link
                    href={item.href}
                    onClick={close}
                    title={item.label}
                    className={clsx(
                      'flex items-center gap-2.5 py-2.5 rounded-lg text-sm font-medium transition-all group',
                      collapsed ? 'lg:justify-center lg:px-0 px-3' : 'px-3',
                      item.child && !collapsed && 'lg:ml-3',
                      active ? 'text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                    )}
                    style={active ? { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' } : {}}
                  >
                    <item.icon size={15} className={clsx('flex-shrink-0', active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400')} />
                    <span className={clsx('flex-1', collapsed && 'lg:hidden')}>{item.label}</span>
                    {badgeCount > 0 && (
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white', collapsed && 'lg:hidden')} style={{ background: badgeColor }}>
                        {badgeCount}
                      </span>
                    )}
                    {/* Collapsed: a badge has no room for its number, but the
                        fact that something needs attention must not vanish. */}
                    {badgeCount > 0 && collapsed && (
                      <span className="hidden lg:block absolute ml-6 -mt-4 w-1.5 h-1.5 rounded-full" style={{ background: badgeColor }} />
                    )}
                    {active && !badgeCount && <ChevronRight size={12} className={clsx('text-indigo-400', collapsed && 'lg:hidden')} />}
                  </Link>
                </div>
              )
            })}
          </nav>

          {/* Active alarms summary */}
          {criticalCount > 0 && (
            <div className={clsx('mx-2.5 mb-2 p-3 rounded-lg', collapsed && 'lg:hidden')} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="flex items-center gap-2 text-xs">
                <AlertTriangle size={12} className="text-red-400" />
                <span className="text-red-400 font-semibold">{criticalCount} CRITICAL</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Requires immediate attention</div>
            </div>
          )}

          {/* Sign out */}
          <div className="px-2.5 py-3" style={{ borderTop: '1px solid #1e2433' }}>
            <button
              onClick={() => { clearSession(); router.push('/') }}
              title="Sign Out"
              className={clsx(
                'w-full flex items-center gap-2.5 py-2.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all',
                collapsed ? 'lg:justify-center lg:px-0 px-3' : 'px-3',
              )}
            >
              <LogOut size={15} className="flex-shrink-0" />
              <span className={clsx(collapsed && 'lg:hidden')}>Sign Out</span>
            </button>
          </div>
        </>
      )}>
        {children}
      </AppShell>
    </RealtimeProvider>
  )
}
