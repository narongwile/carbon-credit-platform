'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession, clearSession } from '@/lib/auth'
import {
  Boxes, Globe, Building2, ShieldCheck, ScrollText, Layers, Palette,
  Puzzle, LifeBuoy, LogOut, Activity, ChevronRight, MonitorDot,
  TrendingUp, Upload, AlertTriangle
} from 'lucide-react'
import clsx from 'clsx'

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
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span>Platform: <span className="text-green-400 font-medium">OPERATIONAL</span></span>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <TrendingUp size={12} className="text-indigo-400" />
            Global Traffic: <span className="text-white font-medium">4.2K req/s</span>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AlertTriangle size={12} className="text-amber-400" />
            Active Alarms: <span className="text-amber-400 font-medium">23</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-600">{time}</span>
            <button
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <Upload size={12} />
              Deploy Update
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
