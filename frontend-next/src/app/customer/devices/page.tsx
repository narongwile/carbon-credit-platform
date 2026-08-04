'use client'

import Link from 'next/link'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { useAppStore } from '@/lib/store'
import { useSessionOrgId } from '@/lib/auth'
import { viewerDomains } from '@/lib/viewer'
import { Activity, Wifi, WifiOff, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }

export default function CustomerDevicesPage() {
  // The real session's org, not the demo "acting viewer" picker's mock user
  // (which defaults to a persona id a real login never sets).
  const orgId = useSessionOrgId()
  const { viewerUserId } = useAppStore()

  // Roster from the backend when live (so an auto-registered device shows up
  // and a seed-only device does not). GET /api/fleet already scopes this to
  // the products the SIGNED-IN viewer's department(s) may access — only the
  // demo/offline fallback (unscoped seed devices) still needs the mock
  // viewerDomains() filter on top.
  const { devices: roster, fromBackend } = useManagedDevices(orgId)
  const allowed = viewerDomains(viewerUserId)
  const devices = fromBackend ? roster : roster.filter((d) => !d.domain || allowed.includes(d.domain))

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Devices</h1>
        <p className="text-sm text-slate-500 mt-0.5">All devices · open one to view its individual dashboard</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.map((d) => (
          <Link key={d.id} href={d.domain === 'transformer' ? `/customer/transformers/detail?id=${d.id}` : `/customer/devices/detail?id=${d.id}`}>
            <div className="rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 transition-all hover:-translate-y-0.5" style={surface}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}>
                    <Activity size={16} className="text-indigo-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{d.name}</div>
                    <div className="text-[11px] text-slate-500">{d.location}</div>
                  </div>
                </div>
                {d.status === 'online'
                  ? <Wifi size={15} className="text-green-400" />
                  : <WifiOff size={15} className="text-slate-600" />}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-extrabold text-white tabular-nums">{d.lastValue ?? '—'}</div>
                  <span className={clsx('text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider', d.theme === 'fix' ? 'text-green-400' : 'text-violet-400')}
                    style={{ background: d.theme === 'fix' ? 'rgba(34,197,94,0.12)' : 'rgba(167,139,250,0.12)' }}>
                    {d.theme === 'fix' ? 'FIX' : 'Free Style'}
                  </span>
                </div>
                <ChevronRight size={16} className="text-slate-600" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
