'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { getGeoNodes } from '@/lib/geoNodes'
import { managedDevicesFromFleet } from '@/lib/fleetData'
import { useAppStore } from '@/lib/store'
import { viewerDomains } from '@/lib/viewer'
import { DOMAIN_META } from '@/types/fleet'
import { Map as MapIcon, LayoutGrid, MapPin } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

export default function CustomerMapPage() {
  const { viewerUserId } = useAppStore()
  const allowed = viewerDomains(viewerUserId)
  const nodes = getGeoNodes('org-1').filter((n) => allowed.includes(n.domain))
  const devices = managedDevicesFromFleet('org-1').filter((d) => !d.domain || allowed.includes(d.domain))
  const [tab, setTab] = useState<'map' | 'layout'>('map')

  // deterministic layout positions
  const pos = (i: number) => ({ left: `${14 + ((i * 23) % 72)}%`, top: `${18 + ((i * 37) % 62)}%` })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Devices Location</h1>
          <p className="text-sm text-slate-500 mt-1">Geographic map and site layout of your devices</p>
        </div>
        <div className="flex gap-1 p-1 rounded-lg" style={inset}>
          {([['map', 'Map', MapIcon], ['layout', 'Layout', LayoutGrid]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={clsx('flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold transition-all', tab === id ? 'text-white' : 'text-slate-500')} style={tab === id ? { background: '#6366f1' } : {}}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'map' ? (
        <LiveSensorMap nodes={nodes} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* schematic site layout */}
          <div className="lg:col-span-3 rounded-xl relative overflow-hidden h-[60vh]" style={{ ...surface, backgroundImage: 'linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)', backgroundSize: '44px 44px' }}>
            <div className="absolute top-3 left-3 text-xs text-slate-500">Site layout (schematic)</div>
            {devices.map((d, i) => {
              const accent = d.domain ? DOMAIN_META[d.domain].accent : '#6366f1'
              return (
                <Link key={d.id} href={`/customer/devices/${d.id}`}>
                  <div className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer" style={pos(i)}>
                    <MapPin size={26} style={{ color: accent }} fill={accent} className="drop-shadow" />
                    <span className="absolute left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded text-white" style={{ background: '#0a0e1a' }}>{d.name}</span>
                  </div>
                </Link>
              )
            })}
          </div>
          {/* device list */}
          <div className="space-y-2">
            {devices.map((d) => {
              const accent = d.domain ? DOMAIN_META[d.domain].accent : '#6366f1'
              return (
                <Link key={d.id} href={`/customer/devices/${d.id}`}>
                  <div className="p-3 rounded-xl cursor-pointer" style={surface}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
                      <span className="text-sm font-medium text-white">{d.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{d.location} · {d.lastValue ?? '—'}</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
