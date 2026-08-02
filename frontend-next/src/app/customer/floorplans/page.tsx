'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { useSessionOrgId } from '@/lib/auth'
import { managedDevicesFromFleet, getSitesByOrg } from '@/lib/fleetData'
import { viewerDomains } from '@/lib/viewer'
import { DOMAIN_META } from '@/types/fleet'
import { api, apiImageUrl } from '@/lib/api'
import { MapPin, Image as ImageIcon, Check, Satellite, Radio, Wifi, Bluetooth, Gauge, Eye, Building2 } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Must mirror the admin floorplans page so positions/methods render identically.
const POSITIONING = [
  { id: 'gnss', label: 'GNSS', accuracy: '2–5 m', icon: Satellite, color: '#22c55e' },
  { id: 'lorawan', label: 'LoRaWAN', accuracy: '10–50 m', icon: Radio, color: '#f59e0b' },
  { id: 'wifi', label: 'WiFi RTT', accuracy: '1–3 m', icon: Wifi, color: '#6366f1' },
  { id: 'ble', label: 'BLE Beacon', accuracy: '1–2 m', icon: Bluetooth, color: '#06b6d4' },
  { id: 'barometer', label: 'Barometer', accuracy: '±1 floor', icon: Gauge, color: '#a78bfa' },
] as const
type PosMethod = (typeof POSITIONING)[number]['id']
const posMeta = (id: string) => POSITIONING.find((p) => p.id === id) ?? POSITIONING[2]

// Floors are the admin's, saved per site — not a const. A hardcoded list here
// would show floor ids that no longer exist, i.e. three permanently empty tabs.
interface Floor { id: string; siteId: string; name: string }
type Pos = { x: number; y: number }

// Read-only floor-plan view for viewers: shows the transformer coordinates an admin
// pinned, for THIS org only (the /api/orgs/:orgId/floorplans routes are org-scoped).
export default function CustomerFloorPlansPage() {
  const { viewerUserId } = useAppStore()
  const orgId = useSessionOrgId()
  const allowed = viewerDomains(viewerUserId)
  const nodes = managedDevicesFromFleet(orgId).filter((d) => !d.domain || allowed.includes(d.domain))

  const [sites, setSites] = useState<{ id: string; name: string }[]>(() => getSitesByOrg(orgId))
  const [activeSite, setActiveSite] = useState('')
  const [floors, setFloors] = useState<Floor[]>([])
  const [activeFloor, setActiveFloor] = useState('')
  const [images, setImages] = useState<Record<string, string>>({})
  const [positions, setPositions] = useState<Record<string, Record<string, Pos>>>({})
  const [posMethod, setPosMethod] = useState<Record<string, PosMethod>>({})
  const methodOf = (n: { id: string; domain?: string }): PosMethod => posMethod[n.id] ?? (n.domain === 'bloodBox' ? 'ble' : 'wifi')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const live = await api.sites(orgId)
      if (cancelled) return
      const s = live?.sites?.length ? live.sites : getSitesByOrg(orgId)
      setSites(s)
      setActiveSite((cur) => (s.some((x) => x.id === cur) ? cur : s[0]?.id ?? ''))
      const data = (await api.getFloorplans(orgId)) as any
      if (cancelled) return
      if (data?.images) setImages(data.images)
      if (data?.positions) setPositions(data.positions)
      if (data?.posMethod) setPosMethod(data.posMethod)
      if (data?.floors) setFloors(data.floors as Floor[])
    })()
    return () => { cancelled = true }
  }, [orgId])

  const siteFloors = useMemo(() => floors.filter((f) => f.siteId === activeSite), [floors, activeSite])
  useEffect(() => {
    setActiveFloor((cur) => (siteFloors.some((f) => f.id === cur) ? cur : siteFloors[0]?.id ?? ''))
  }, [siteFloors])

  const img = images[activeFloor]
  const floorPos = positions[activeFloor] ?? {}
  const placed = nodes.filter((n) => floorPos[n.id])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">Floor Plans <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400 flex items-center gap-1"><Eye size={11} /> view only</span></h1>
        <p className="text-sm text-slate-500 mt-0.5">Transformer locations as pinned by your organization&apos;s admin.</p>
      </div>

      {/* Site first — a plan is only meaningful for the place it belongs to. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Building2 size={13} /> Site</span>
        {sites.map((s) => (
          <button key={s.id} onClick={() => setActiveSite(s.id)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all', activeSite === s.id ? 'text-white' : 'text-slate-500')}
            style={activeSite === s.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
            {s.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {siteFloors.map((f) => (
          <button key={f.id} onClick={() => setActiveFloor(f.id)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all', activeFloor === f.id ? 'text-white' : 'text-slate-500')}
            style={activeFloor === f.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
            {f.name}{images[f.id] ? ' ✓' : ''}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Floor plan canvas (read-only) */}
        <div className="lg:col-span-3">
          <div className="relative rounded-xl overflow-hidden select-none" style={{ ...surface, height: '62vh' }}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.startsWith('/api') ? apiImageUrl(img) : img} alt="floor plan" className="w-full h-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                <ImageIcon size={48} className="mb-3 opacity-40" />
                <p className="text-sm">No floor plan uploaded for this floor yet</p>
              </div>
            )}

            {img && nodes.map((n) => {
              const pos = floorPos[n.id]
              if (!pos) return null
              const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
              const pm = posMeta(methodOf(n))
              return (
                <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full" style={{ border: `2px solid ${pm.color}`, opacity: 0.5 }} />
                  <MapPin size={26} style={{ color: accent }} fill={accent} className="relative drop-shadow" />
                  <span className="absolute left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded text-white flex items-center gap-1" style={{ background: '#0a0e1a' }}>
                    {n.name}
                    <span className="flex items-center gap-0.5" style={{ color: pm.color }} title={`${pm.label} · ${pm.accuracy}`}><pm.icon size={9} />{pm.accuracy}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Node list (read-only) */}
        <div className="rounded-xl p-4 space-y-2" style={surface}>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Sensor Nodes ({placed.length}/{nodes.length} on this floor)</div>
          {nodes.map((n) => {
            const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
            const isPlaced = !!floorPos[n.id]
            const pm = posMeta(methodOf(n))
            return (
              <div key={n.id} className="rounded-lg p-2.5 flex items-center gap-2.5" style={{ background: '#0a0e1a', border: '1px solid #1e2433', opacity: isPlaced ? 1 : 0.55 }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accent }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{n.name}</div>
                  <div className="text-[10px] flex items-center gap-1" style={{ color: pm.color }}><pm.icon size={9} /> {pm.label} · {pm.accuracy}</div>
                </div>
                {isPlaced ? <Check size={14} className="text-green-400" /> : <MapPin size={13} className="text-slate-600" />}
              </div>
            )
          })}
          {nodes.length === 0 && <p className="text-xs text-slate-600">No devices in your accessible products.</p>}
        </div>
      </div>
    </div>
  )
}
