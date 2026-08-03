'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession, useSessionOrgId } from '@/lib/auth'
import { useRealtimeData } from '@/lib/realtime'
import { useAppStore } from '@/lib/store'
import { UNGATED_NAV, navHrefsForThemes } from '@/lib/orgData'
import OrgBrand from '@/components/OrgBrand'
import AppShell, { NavSection, type NavEntry } from '@/components/nav/AppShell'
import { getUsersByOrg, roleLabels } from '@/lib/orgData'
import api, { isLive } from '@/lib/api'
import { viewerDepartments } from '@/lib/viewer'
import { Boxes, LayoutDashboard, Bell, FileBarChart, LogOut, ChevronRight, Map, HardDrive, UserCircle, LayoutGrid } from 'lucide-react'
import clsx from 'clsx'

// Floor Plans is grouped with the map under Sites & Location — it is
// site-scoped (site -> building -> floor), the same relationship the admin nav
// now shows.
const NAV: NavEntry[] = [
  { href: '/customer', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/customer/map', label: 'Live Sensor Map', icon: Map, section: 'Sites & Location' },
  { href: '/customer/floorplans', label: 'Floor Plans', icon: LayoutGrid },
  { href: '/customer/devices', label: 'Devices', icon: HardDrive, section: 'Monitoring' },
  { href: '/customer/alarms', label: 'Alarms', icon: Bell },
  { href: '/customer/reports', label: 'Reports', icon: FileBarChart },
  { href: '/customer/profile', label: 'Profile', icon: UserCircle, section: 'Account' },
]

// The Dashboard View Permission policy the org's admin set. Resolved from the
// signed-in user's departments (unioned server-side), not from any client state
// the viewer could influence. Null until it has loaded, and null forever when no
// policy exists — the navigation is not gated in either case, so a viewer never
// briefly loses menus while the request is in flight.
function useAllowedHrefs(): Set<string> | null {
  const [allowed, setAllowed] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.myAccess().then((a) => {
      if (cancelled || !a) return
      setAllowed(navHrefsForThemes(a.themeIds ?? []))
    })
    return () => { cancelled = true }
  }, [])
  return allowed
}

function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtimeData()
  return <>{children}</>
}

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { viewerUserId, setViewerUserId, setOrgLogo } = useAppStore()
  const orgId = useSessionOrgId()
  // Profile is never gated — a viewer who cannot reach it cannot set a password
  // or their own notification channels.
  const allowedHrefs = useAllowedHrefs()
  const visibleNav = allowedHrefs
    ? NAV.filter((i) => allowedHrefs.has(i.href) || UNGATED_NAV.includes(i.href))
    : NAV
  const orgUsers = getUsersByOrg(orgId).filter((u) => u.role !== 'admin')
  const depts = viewerDepartments(viewerUserId)

  useEffect(() => {
    const session = getSession()
    if (!session || session.role !== 'customer') {
      router.replace('/')
    }
  }, [router])

  // Hydrate this company's logo from the backend (set by its admin in Settings).
  useEffect(() => {
    if (!isLive()) return
    api.orgs().then((rows) => {
      if (!rows) return
      for (const o of rows) if (o.logo_url) setOrgLogo(o.id, o.logo_url)
    })
  }, [setOrgLogo])

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <RealtimeProvider>
      <AppShell brand={<OrgBrand orgId={orgId} />} sidebar={({ collapsed, close }) => (
        <>
          <div className={clsx('pb-3', collapsed ? 'lg:p-2' : 'p-4')} style={{ borderBottom: '1px solid #1e2433' }}>
            <div className={clsx('mb-1', collapsed && 'lg:hidden')}>
              <OrgBrand orgId={orgId} />
            </div>
            <div className={clsx('text-[10px] text-slate-600 ml-9', collapsed && 'lg:hidden')}>Customer Portal</div>
            {/* Acting viewer — drives department-based access */}
            <select
              value={viewerUserId}
              onChange={(e) => setViewerUserId(e.target.value)}
              className={clsx('w-full mt-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500', collapsed && 'lg:hidden')}
              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
            >
              {orgUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} · {roleLabels[u.role]}</option>
              ))}
            </select>
            <div className={clsx('text-[10px] text-slate-600 mt-1 ml-0.5 truncate', collapsed && 'lg:hidden')}>
              {depts.length ? depts.map((d) => d.name).join(', ') : 'No department'}
            </div>
          </div>

          <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
            {visibleNav.map((item) => {
              const active = isActive(item.href, item.exact)
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
                      active ? 'text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                    )}
                    style={active ? { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' } : {}}
                  >
                    <item.icon size={15} className={clsx('flex-shrink-0', active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400')} />
                    <span className={clsx(collapsed && 'lg:hidden')}>{item.label}</span>
                    {active && <ChevronRight size={12} className={clsx('ml-auto text-indigo-400', collapsed && 'lg:hidden')} />}
                  </Link>
                </div>
              )
            })}
          </nav>

          <div className="px-2.5 py-3 space-y-1" style={{ borderTop: '1px solid #1e2433' }}>
            <div className={clsx('px-3 py-2 text-xs text-slate-600', collapsed && 'lg:hidden')}>
              Read-only access
            </div>
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
