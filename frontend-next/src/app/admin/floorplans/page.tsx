'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getSitesByOrg } from '@/lib/fleetData'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { DOMAIN_META } from '@/types/fleet'
import { api, isLive, apiImageUrl } from '@/lib/api'
import { Upload, MapPin, Save, Image as ImageIcon, Crosshair, Check, Satellite, Radio, Wifi, Bluetooth, Gauge, Building2, Plus, Globe2 } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

// ESP32 indoor-positioning stack: GNSS (outdoor fix) + LoRaWAN (backhaul/TDoA)
// + WiFi RTT + BLE beacons + Barometer (floor/altitude).
const POSITIONING = [
  { id: 'gnss', label: 'GNSS', desc: 'Outdoor GPS fix', accuracy: '2–5 m', icon: Satellite, color: '#22c55e' },
  { id: 'lorawan', label: 'LoRaWAN', desc: 'Backhaul + TDoA', accuracy: '10–50 m', icon: Radio, color: '#f59e0b' },
  { id: 'wifi', label: 'WiFi RTT', desc: 'Indoor ranging', accuracy: '1–3 m', icon: Wifi, color: '#6366f1' },
  { id: 'ble', label: 'BLE Beacon', desc: 'Proximity', accuracy: '1–2 m', icon: Bluetooth, color: '#06b6d4' },
  { id: 'barometer', label: 'Barometer', desc: 'Floor / altitude', accuracy: '±1 floor', icon: Gauge, color: '#a78bfa' },
] as const
type PosMethod = (typeof POSITIONING)[number]['id']
const posMeta = (id: string) => POSITIONING.find((p) => p.id === id) ?? POSITIONING[2]

interface Floor { id: string; siteId: string; name: string }
interface Geo { nwLat: number | null; nwLng: number | null; seLat: number | null; seLng: number | null }
type Pos = { x: number; y: number }

const EMPTY_GEO: Geo = { nwLat: null, nwLng: null, seLat: null, seLng: null }
const geoReady = (g?: Geo): g is Geo =>
  !!g && g.nwLat !== null && g.nwLng !== null && g.seLat !== null && g.seLng !== null && g.nwLat !== g.seLat && g.nwLng !== g.seLng

// A floor-plan image is a rectangle of the world once its NW and SE corners are
// known, so pin ↔ coordinate is a linear interpolation in both directions. This
// is what lets an ETERNITY transformer be placed on a layout and still show up
// in the right spot on the GPS map — the two views stop being separate truths.
const pinToLatLng = (g: Geo, p: Pos) => ({
  lat: g.nwLat! + (g.seLat! - g.nwLat!) * (p.y / 100),
  lng: g.nwLng! + (g.seLng! - g.nwLng!) * (p.x / 100),
})
const latLngToPin = (g: Geo, lat: number, lng: number): Pos => ({
  x: ((lng - g.nwLng!) / (g.seLng! - g.nwLng!)) * 100,
  y: ((lat - g.nwLat!) / (g.seLat! - g.nwLat!)) * 100,
})

export default function FloorPlansPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const { devices: nodes } = useManagedDevices(orgId)
  const fileRef = useRef<HTMLInputElement>(null)

  // Sites come from the backend; the seed list is the demo-mode fallback.
  const [sites, setSites] = useState<{ id: string; name: string; lat?: number | null; lng?: number | null }[]>(() => getSitesByOrg(orgId))
  const [activeSite, setActiveSite] = useState<string>('')
  const [floors, setFloors] = useState<Floor[]>([])
  const [activeFloor, setActiveFloor] = useState('')
  const [geo, setGeo] = useState<Record<string, Geo>>({})
  const [images, setImages] = useState<Record<string, string>>({})
  // positions[floorId][nodeId] = {x%, y%}
  const [positions, setPositions] = useState<Record<string, Record<string, Pos>>>({})
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [posMethod, setPosMethod] = useState<Record<string, PosMethod>>({})
  const methodOf = (n: { id: string; domain?: string }): PosMethod => posMethod[n.id] ?? (n.domain === 'bloodBox' ? 'ble' : 'wifi')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    const seedSites = getSitesByOrg(orgId)
    ;(async () => {
      const live = isLive() ? await api.sites(orgId) : null
      if (cancelled) return
      const s = live?.sites?.length ? live.sites : seedSites
      setSites(s)
      setActiveSite((cur) => (s.some((x) => x.id === cur) ? cur : s[0]?.id ?? ''))
      if (live?.floors?.length) {
        setGeo(Object.fromEntries(live.floors.map((f) => [f.floor_id, {
          nwLat: f.nw_lat === null ? null : Number(f.nw_lat), nwLng: f.nw_lng === null ? null : Number(f.nw_lng),
          seLat: f.se_lat === null ? null : Number(f.se_lat), seLng: f.se_lng === null ? null : Number(f.se_lng),
        }])))
      }
      const data = (await api.getFloorplans(orgId)) as {
        images?: Record<string, string>; positions?: Record<string, Record<string, Pos>>
        posMethod?: Record<string, PosMethod>; floors?: Floor[]
      } | null
      if (cancelled) return
      if (data?.images) setImages(data.images)
      if (data?.positions) setPositions(data.positions)
      if (data?.posMethod) setPosMethod(data.posMethod)
      // Floors used to be a const shared by every tenant ("Building A · Floor 1").
      // They belong to a site now; a layout saved before that gets one default
      // floor on the first site rather than disappearing.
      setFloors(data?.floors?.length ? data.floors : s.flatMap((site, i) => (i === 0 ? [{ id: 'fl-1', siteId: site.id, name: 'Floor 1' }] : [])))
    })()
    return () => { cancelled = true }
  }, [orgId])

  const siteFloors = useMemo(() => floors.filter((f) => f.siteId === activeSite), [floors, activeSite])
  useEffect(() => {
    setActiveFloor((cur) => (siteFloors.some((f) => f.id === cur) ? cur : siteFloors[0]?.id ?? ''))
  }, [siteFloors])

  const img = images[activeFloor]
  const floorPos = positions[activeFloor] ?? {}
  const g = geo[activeFloor] ?? EMPTY_GEO
  const ready = geoReady(g)

  // Only ETERNITY assets carry a real-world coordinate here: a transformer sits
  // in a yard or a substation bay and has to agree with the GPS map. A fridge or
  // a BloodBOX is placed for indoor context only.
  const isEternity = (n: { domain?: string }) => n.domain === 'transformer'

  const addFloor = () => {
    if (!activeSite) { toast.error('Create a site first'); return }
    const n = siteFloors.length + 1
    const id = `fl-${activeSite}-${Date.now()}`
    setFloors((f) => [...f, { id, siteId: activeSite, name: `Floor ${n}` }])
    setActiveFloor(id)
  }

  const onUpload = async (file?: File) => {
    if (!file || !activeFloor) return
    if (!isLive()) { setImages((m) => ({ ...m, [activeFloor]: URL.createObjectURL(file) })); return }
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file)
    })
    const up = await api.uploadFloorplanImage(orgId, activeFloor, dataUrl, file.type || 'image/png')
    if (up?.url) { setImages((m) => ({ ...m, [activeFloor]: up.url })); toast.success('Floor plan image uploaded') }
    else toast.error('Upload failed')
  }

  const setPin = (nodeId: string, p: Pos) =>
    setPositions((prev) => ({ ...prev, [activeFloor]: { ...(prev[activeFloor] ?? {}), [nodeId]: p } }))

  const placeAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedNode || !img) return
    const rect = e.currentTarget.getBoundingClientRect()
    setPin(selectedNode, {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    })
    setSelectedNode(null)
  }

  /** Coordinate shown for a node: derived from its pin whenever the floor is georeferenced. */
  const coordOf = (nodeId: string) => {
    const p = floorPos[nodeId]
    if (!p || !ready) return null
    return pinToLatLng(g, p)
  }

  /** Typing a coordinate moves the pin — the other half of the sync. */
  const setCoord = (nodeId: string, lat: number | null, lng: number | null) => {
    if (!ready || lat === null || lng === null || !isFinite(lat) || !isFinite(lng)) return
    setPin(nodeId, latLngToPin(g, lat, lng))
  }

  const placed = nodes.filter((n) => floorPos[n.id])

  const save = async () => {
    try {
      await api.updateFloorplans(orgId, { images, positions, posMethod, floors })
      if (isLive()) {
        // Georeference belongs to the floorplans table (it is per image), not the
        // layout blob, so the backend can convert without the frontend.
        for (const f of floors) {
          const fg = geo[f.id]
          if (fg) await api.setFloorGeo(orgId, f.id, { siteId: f.siteId, ...fg })
        }
        // Push every placed ETERNITY device's derived coordinate to nodes.lat/lng
        // so the Live GPS Map and the layout show the same asset in one place.
        let synced = 0
        for (const n of nodes) {
          if (!isEternity(n)) continue
          for (const f of floors) {
            const p = positions[f.id]?.[n.id]
            const fg = geo[f.id]
            if (!p || !geoReady(fg)) continue
            const c = pinToLatLng(fg, p)
            const r = await api.setNodeLocation(n.id, { lat: c.lat, lng: c.lng, siteId: f.siteId })
            if (r?.ok) synced++
          }
        }
        if (synced) toast.success(`Layout saved · ${synced} transformer coordinate${synced === 1 ? '' : 's'} synced`)
        else toast.success('Floor plans saved')
      } else toast.success('Floor plans saved')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      toast.error('Failed to save floor plans')
    }
  }

  const addSite = async () => {
    const name = window.prompt('Site name (e.g. KMUTT Main Substation)')?.trim()
    if (!name) return
    const id = `site-${Date.now()}`
    if (isLive()) {
      const r = await api.saveSite(orgId, { id, name })
      if (!r?.ok) { toast.error('Could not create the site'); return }
    }
    setSites((s) => [...s, { id, name }])
    setActiveSite(id)
    toast.success(`Site “${name}” added`)
  }

  const geoField = (key: keyof Geo, label: string, min: number, max: number) => (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">{label}</label>
      <input
        type="number" step="0.0000001" min={min} max={max}
        value={g[key] ?? ''}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Math.max(min, Math.min(max, Number(e.target.value)))
          setGeo((m) => ({ ...m, [activeFloor]: { ...(m[activeFloor] ?? EMPTY_GEO), [key]: v } }))
        }}
        className="w-full px-2 py-1.5 rounded-lg text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500"
        style={inset}
      />
    </div>
  )

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Floor Plans</h1>
          <p className="text-sm text-slate-500 mt-0.5">Pick a site, upload its layout, then place each device. Georeference the plan and ETERNITY transformers also get a real coordinate.</p>
        </div>
        <button onClick={save} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
          <Save size={15} /> {saved ? 'Saved!' : 'Save Layout'}
        </button>
      </div>

      {/* Site selector — floor plans hang off a customer's physical place. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Building2 size={13} /> Site</span>
        {sites.map((s) => (
          <button key={s.id} onClick={() => setActiveSite(s.id)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all', activeSite === s.id ? 'text-white' : 'text-slate-500')}
            style={activeSite === s.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
            {s.name}
          </button>
        ))}
        <button onClick={addSite} className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1" style={inset}>
          <Plus size={13} /> Add site
        </button>
        {sites.length === 0 && <span className="text-[11px] text-slate-600">No sites yet for this organization.</span>}
      </div>

      {/* Positioning stack (ESP32 hardware plan) */}
      <div className="rounded-xl p-3.5 flex flex-wrap items-center gap-x-4 gap-y-2" style={surface}>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Positioning Stack</span>
        {POSITIONING.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5 text-xs text-slate-300" title={`${p.desc} · ${p.accuracy}`}>
            <p.icon size={13} style={{ color: p.color }} /> {p.label}
            <span className="text-[10px] text-slate-600">{p.accuracy}</span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-600">ESP32 · GNSS+4G SIM · WiFi primary → 4G fallback · BLE/Barometer indoor</span>
      </div>

      {/* Floors of the active site + upload */}
      <div className="flex flex-wrap items-center gap-2">
        {siteFloors.map((f) => (
          <button key={f.id} onClick={() => setActiveFloor(f.id)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all', activeFloor === f.id ? 'text-white' : 'text-slate-500')}
            style={activeFloor === f.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
            {f.name}{images[f.id] ? ' ✓' : ''}
          </button>
        ))}
        <button onClick={addFloor} className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1" style={inset}>
          <Plus size={13} /> Add floor
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={!activeFloor}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
          <Upload size={15} /> Upload Floor Plan
        </button>
      </div>

      {/* Georeference — the two corners that turn a pin into a coordinate. */}
      {activeFloor && (
        <div className="rounded-xl p-4" style={surface}>
          <div className="flex items-center gap-2 mb-1">
            <Globe2 size={15} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Georeference (optional)</h3>
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full', ready ? 'text-green-400' : 'text-slate-500')}
              style={{ background: ready ? 'rgba(74,222,128,0.12)' : '#0a0e1a' }}>
              {ready ? 'coordinates in sync' : 'not georeferenced'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            Real-world corners of this plan image. With both set, dropping a pin fills a device&apos;s lat/lng and typing a lat/lng moves its pin — and ETERNITY transformers keep the coordinate on save.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {geoField('nwLat', 'NW Latitude', -90, 90)}
            {geoField('nwLng', 'NW Longitude', -180, 180)}
            {geoField('seLat', 'SE Latitude', -90, 90)}
            {geoField('seLng', 'SE Longitude', -180, 180)}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Floor plan canvas */}
        <div className="lg:col-span-3">
          <div onClick={placeAt}
            className={clsx('relative rounded-xl overflow-hidden select-none', selectedNode && img ? 'cursor-crosshair' : '')}
            style={{ ...surface, height: '62vh' }}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.startsWith('/api') ? apiImageUrl(img) : img} alt="floor plan" className="w-full h-full object-contain pointer-events-none" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                <ImageIcon size={48} className="mb-3 opacity-40" />
                <p className="text-sm">{activeFloor ? 'No floor plan for this floor yet' : 'Add a site and a floor to begin'}</p>
                {activeFloor && <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">Upload an image</button>}
              </div>
            )}

            {img && nodes.map((n) => {
              const pos = floorPos[n.id]
              if (!pos) return null
              const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
              const pm = posMeta(methodOf(n))
              return (
                <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2 group" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(n.id) }}>
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full" style={{ border: `2px solid ${pm.color}`, opacity: 0.5 }} />
                  <MapPin size={26} style={{ color: accent }} fill={accent} className="relative drop-shadow" />
                  <span className="absolute left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded text-white flex items-center gap-1" style={{ background: '#0a0e1a' }}>
                    {n.name}
                    <span className="flex items-center gap-0.5" style={{ color: pm.color }} title={`${pm.label} · ${pm.accuracy}`}><pm.icon size={9} />{pm.accuracy}</span>
                  </span>
                </div>
              )
            })}

            {selectedNode && img && (
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white" style={{ background: 'rgba(99,102,241,0.9)' }}>
                <Crosshair size={13} /> Click on the plan to place “{nodes.find((n) => n.id === selectedNode)?.name}”
              </div>
            )}
          </div>
        </div>

        {/* Node list */}
        <div className="rounded-xl p-4 space-y-2 overflow-y-auto" style={{ ...surface, maxHeight: '62vh' }}>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Devices ({placed.length}/{nodes.length} placed)</div>
          {nodes.map((n) => {
            const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
            const isPlaced = !!floorPos[n.id]
            const c = coordOf(n.id)
            return (
              <div key={n.id} className="rounded-lg p-2.5 transition-all" style={{ background: '#0a0e1a', border: `1px solid ${selectedNode === n.id ? '#6366f1' : '#1e2433'}` }}>
                <button onClick={() => setSelectedNode(n.id)} className="w-full flex items-center gap-2.5 text-left">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accent }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{n.name}</div>
                    <div className="text-[10px]" style={{ color: accent }}>{n.domain ? DOMAIN_META[n.domain].platform : n.deviceType}</div>
                  </div>
                  {isPlaced ? <Check size={14} className="text-green-400" /> : <MapPin size={13} className="text-slate-600" />}
                </button>

                {/* ETERNITY only: the coordinate this pin represents, editable. */}
                {isEternity(n) && (
                  <div className="mt-2">
                    {ready ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="number" step="0.0000001" placeholder="lat" value={c ? c.lat.toFixed(7) : ''}
                          onChange={(e) => setCoord(n.id, e.target.value === '' ? null : Number(e.target.value), c?.lng ?? null)}
                          className="w-full px-2 py-1 rounded text-[10px] font-mono text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                        <input
                          type="number" step="0.0000001" placeholder="lng" value={c ? c.lng.toFixed(7) : ''}
                          onChange={(e) => setCoord(n.id, c?.lat ?? null, e.target.value === '' ? null : Number(e.target.value))}
                          className="w-full px-2 py-1 rounded text-[10px] font-mono text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-600">Georeference this floor to sync a coordinate.</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1 mt-2">
                  {POSITIONING.map((p) => {
                    const on = methodOf(n) === p.id
                    return (
                      <button key={p.id} onClick={() => setPosMethod((m) => ({ ...m, [n.id]: p.id }))} title={`${p.label} · ${p.accuracy}`}
                        className="w-6 h-6 rounded flex items-center justify-center transition-all"
                        style={{ background: on ? `${p.color}22` : 'transparent', border: `1px solid ${on ? p.color : '#1e2433'}`, color: on ? p.color : '#475569' }}>
                        <p.icon size={12} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {!img && activeFloor && <p className="text-[11px] text-slate-600 pt-1">Upload a floor plan first, then click a device and click on the plan to place it.</p>}
        </div>
      </div>
    </div>
  )
}
