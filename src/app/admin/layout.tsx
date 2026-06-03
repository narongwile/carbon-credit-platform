'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { useRealtimeData } from '@/lib/realtime'
import { isEntitled, type Entitlement } from '@/lib/entitlements'
import { organizations } from '@/lib/mockData'
import {
  Boxes, LayoutDashboard, Map, TrendingUp, Bell, Calendar,
  FileBarChart, Settings, LogOut, ChevronRight, AlertTriangle, Thermometer,
  Users, HardDrive, BellRing, UserCircle, Building2, Cpu, LayoutGrid,
  Search, Database, ShieldCheck, Droplet
} from 'lucide-react'
import clsx from 'clsx'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  badge?: boolean
  requires?: Entitlement
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/sites', label: 'Sites (Unified)', icon: Building2 },
  { href: '/admin/map', label: 'Live Sensor Map', icon: Map },
  { href: '/admin/floorplans', label: 'Floor Plans', icon: LayoutGrid },
  { href: '/admin/trends', label: 'Trends', icon: TrendingUp, requires: { platform: 'eternityTransformers' } },
  { href: '/admin/refrigeration', label: 'Refrigeration', icon: Thermometer, requires: { platform: 'refrigerationDataLogger' } },
  { href: '/admin/bloodbox', label: 'BloodBOX', icon: Droplet, requires: { platform: 'bloodBox' } },
  { href: '/admin/users', label: 'User Management', icon: Users },
  { href: '/admin/devices', label: 'Device Management', icon: HardDrive },
  { href: '/admin/fleet', label: 'Fleet (Devices)', icon: Cpu },
  { href: '/admin/ai-search', label: 'AI Search', icon: Search, requires: { feature: 'AI Predictive Diagnostics' } },
  { href: '/admin/sql', label: 'SQL AI', icon: Database, requires: { feature: 'Historical Analytics' } },
  { href: '/admin/quality', label: 'Data Quality', icon: ShieldCheck, requires: { feature: 'Historical Analytics' } },
  { href: '/admin/notifications', label: 'Alarm & Notify', icon: BellRing },
  { href: '/admin/alarms', label: 'Alarms', icon: Bell, badge: true },
  { href: '/admin/events', label: 'Events', icon: Calendar },
  { href: '/admin/reports', label: 'Reports', icon: FileBarChart },
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
  const { alarms, selectedOrgId, setSelectedOrgId } = useAppStore()
  const visibleNav = NAV.filter((item) => isEntitled(selectedOrgId, item.requires))

  useEffect(() => {
    const session = getSession()
    if (!session || (session.role !== 'admin' && session.role !== 'superadmin')) {
      router.replace('/')
    }
  }, [router])

  const unackedAlarms = alarms.filter((a) => !a.acknowledged && a.orgId === selectedOrgId)
  const criticalCount = unackedAlarms.filter((a) => a.severity === 'CRITICAL').length

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <RealtimeProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: '#0a0e1a' }}>
        {/* Sidebar */}
        <aside className="w-56 flex flex-col flex-shrink-0" style={{ background: '#0d1117', borderRight: '1px solid #1e2433' }}>
          {/* Logo */}
          <div className="p-4 pb-3" style={{ borderBottom: '1px solid #1e2433' }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                <Boxes size={14} className="text-white" />
              </div>
              <span className="font-bold text-white tracking-wider text-sm">ONEOPS</span>
            </div>
            {/* Tenant switcher — drives entitlement gating */}
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full mt-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"
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
              const badgeCount = item.badge ? criticalCount : 0
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group',
                    active ? 'text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                  )}
                  style={active ? { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' } : {}}
                >
                  <item.icon size={15} className={active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'} />
                  <span className="flex-1">{item.label}</span>
                  {badgeCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ background: '#ef4444' }}>
                      {badgeCount}
                    </span>
                  )}
                  {active && !badgeCount && <ChevronRight size={12} className="text-indigo-400" />}
                </Link>
              )
            })}
          </nav>

          {/* Active alarms summary */}
          {criticalCount > 0 && (
            <div className="mx-2.5 mb-2 p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
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
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </RealtimeProvider>
  )
}
