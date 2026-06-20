'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession } from '@/lib/auth'
import { useRealtimeData } from '@/lib/realtime'
import { useAppStore } from '@/lib/store'
import { getUsersByOrg, roleLabels } from '@/lib/orgData'
import api, { apiEnabled } from '@/lib/api'
import { viewerDepartments } from '@/lib/viewer'
import { Boxes, LayoutDashboard, Bell, FileBarChart, LogOut, ChevronRight, Map, HardDrive, UserCircle } from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  { href: '/customer', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/customer/map', label: 'Live Sensor Map', icon: Map },
  { href: '/customer/devices', label: 'Devices', icon: HardDrive },
  { href: '/customer/alarms', label: 'Alarms', icon: Bell },
  { href: '/customer/reports', label: 'Reports', icon: FileBarChart },
  { href: '/customer/profile', label: 'Profile', icon: UserCircle },
]

function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtimeData()
  return <>{children}</>
}

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { viewerUserId, setViewerUserId, orgLogos, setOrgLogos } = useAppStore()
  const orgId = getSession()?.orgId || 'org-1'
  const orgLogo = orgLogos[orgId]
  const orgUsers = getUsersByOrg('org-1').filter((u) => u.role !== 'admin')
  const depts = viewerDepartments(viewerUserId)

  useEffect(() => {
    const session = getSession()
    if (!session || session.role !== 'customer') {
      router.replace('/')
    }
  }, [router])

  // Hydrate this company's logo from the backend (set by its admin in Settings).
  useEffect(() => {
    if (!apiEnabled) return
    api.orgs().then((rows) => {
      if (!rows) return
      const map: Record<string, string> = {}
      for (const o of rows) if (o.logo_url) map[o.id] = o.logo_url
      if (Object.keys(map).length) setOrgLogos(map)
    })
  }, [setOrgLogos])

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <RealtimeProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: '#0a0e1a' }}>
        <aside className="w-52 flex flex-col flex-shrink-0" style={{ background: '#0d1117', borderRight: '1px solid #1e2433' }}>
          <div className="p-4 pb-3" style={{ borderBottom: '1px solid #1e2433' }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: orgLogo ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                {orgLogo ? <img src={orgLogo} alt="logo" className="w-full h-full object-contain" /> : <Boxes size={14} className="text-white" />}
              </div>
              <span className="font-bold text-white tracking-wider text-sm">ONEOPS</span>
            </div>
            <div className="text-[10px] text-slate-600 ml-9">Customer Portal</div>
            {/* Acting viewer — drives department-based access */}
            <select
              value={viewerUserId}
              onChange={(e) => setViewerUserId(e.target.value)}
              className="w-full mt-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
            >
              {orgUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} · {roleLabels[u.role]}</option>
              ))}
            </select>
            <div className="text-[10px] text-slate-600 mt-1 ml-0.5 truncate">
              {depts.length ? depts.map((d) => d.name).join(', ') : 'No department'}
            </div>
          </div>

          <nav className="flex-1 px-2.5 py-3 space-y-0.5">
            {NAV.map((item) => {
              const active = isActive(item.href, item.exact)
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
                  {item.label}
                  {active && <ChevronRight size={12} className="ml-auto text-indigo-400" />}
                </Link>
              )
            })}
          </nav>

          <div className="px-2.5 py-3 space-y-1" style={{ borderTop: '1px solid #1e2433' }}>
            <div className="px-3 py-2 text-xs text-slate-600">
              Read-only access
            </div>
            <button
              onClick={() => { clearSession(); router.push('/') }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </RealtimeProvider>
  )
}
