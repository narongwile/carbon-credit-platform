'use client'

import { useState } from 'react'
import Link from 'next/link'
import { managedDevicesFromFleet } from '@/lib/fleetData'
import { MapPin, Navigation } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }

// Lightweight device-location map (no external tiles in static export):
// a schematic plot of all devices with selectable markers.
export default function CustomerMapPage() {
  const devices = managedDevicesFromFleet('org-1')
  const [active, setActive] = useState(devices[0]?.id ?? '')

  // deterministic pseudo positions
  const pos = (i: number) => ({ left: `${12 + ((i * 27) % 76)}%`, top: `${18 + ((i * 41) % 64)}%` })

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Device Location</h1>
        <p className="text-sm text-slate-500 mt-0.5">All devices on the map</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Map */}
        <div className="lg:col-span-3 rounded-xl relative overflow-hidden h-[480px]" style={{ ...surface, backgroundImage: 'linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
          <div className="absolute top-3 left-3 flex items-center gap-1.5 text-xs text-slate-500"><Navigation size={12} /> Schematic view</div>
          {devices.map((d, i) => {
            const on = active === d.id
            const color = d.status === 'online' ? '#4ade80' : '#6b7280'
            return (
              <button key={d.id} onClick={() => setActive(d.id)} className="absolute -translate-x-1/2 -translate-y-1/2 group" style={pos(i)}>
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color, opacity: on ? 0.4 : 0 }} />
                <MapPin size={on ? 30 : 24} style={{ color }} className="relative transition-all" fill={on ? color : 'transparent'} />
                <span className={clsx('absolute left-1/2 -translate-x-1/2 mt-0.5 text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded', on ? 'text-white' : 'text-slate-400')} style={{ background: on ? '#0a0e1a' : 'transparent' }}>{d.name}</span>
              </button>
            )
          })}
        </div>

        {/* List */}
        <div className="space-y-2">
          {devices.map((d) => (
            <button key={d.id} onClick={() => setActive(d.id)} className={clsx('w-full text-left p-3 rounded-xl transition-all', active === d.id ? 'border-indigo-500/50' : '')} style={{ ...surface, borderColor: active === d.id ? '#6366f1' : '#1e2433' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{d.name}</span>
                <span className="w-2 h-2 rounded-full" style={{ background: d.status === 'online' ? '#4ade80' : '#6b7280' }} />
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{d.location}</div>
              <Link href={`/customer/devices/${d.id}`} className="text-[11px] text-indigo-400 hover:text-indigo-300">Open dashboard →</Link>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
