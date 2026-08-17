'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'

export type MapOrg = {
  id: string
  name: string
  lat: number
  lng: number
  active: boolean
  where?: string
  devicesCount?: number
  licenseTier?: string
}

type LayerKey = 'dark' | 'satellite' | 'streets'

const TILES: Record<LayerKey, { url: string; subdomains?: string; maxZoom: number; attribution: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '© CARTO',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: '© Esri',
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  },
}

export default function OrgDistributionMap({ orgs, height = '380px' }: { orgs: MapOrg[]; height?: string }) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const fittedRef = useRef(false)
  const orgsRef = useRef(orgs)
  orgsRef.current = orgs
  const [layer, setLayer] = useState<LayerKey>('dark')

  const popup = (o: MapOrg) =>
    `<div style="min-width:180px;font-family:inherit;padding:2px">
       <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
         <span style="font-weight:700;font-size:13px;color:#fff">${o.name}</span>
         <span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:9999px;background:${o.active ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)'};color:${o.active ? '#4ade80' : '#ef4444'};border:1px solid ${o.active ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}">
           ${o.active ? 'ACTIVE' : 'SUSPENDED'}
         </span>
       </div>
       <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">
         ${o.where ? o.where + ' · ' : ''}ID: <span style="font-family:monospace;color:#cbd5e1">${o.id}</span>
       </div>
       <div style="font-size:10px;color:#64748b;margin-bottom:8px">
         📍 ${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}
       </div>
       <a href="/superadmin/organizations" style="display:inline-flex;align-items:center;gap:4px;width:100%;justify-content:center;padding:5px 8px;border-radius:6px;background:rgba(99,102,241,0.2);border:1px solid #6366f155;color:#a5b4fc;font-size:11px;font-weight:600;text-decoration:none">
         Manage Organization &rarr;
       </a>
     </div>`

  const sync = () => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const markers = markersRef.current
    const seen = new Set<string>()
    orgsRef.current.forEach((o) => {
      seen.add(o.id)
      const color = o.active ? '#4ade80' : '#ef4444'
      const existing = markers.get(o.id)
      if (existing) {
        existing.setLatLng([o.lat, o.lng])
        existing.setStyle({ fillColor: color })
        existing.setPopupContent(popup(o))
      } else {
        const m = L.circleMarker([o.lat, o.lng], {
          radius: 9,
          color: '#0d1117',
          weight: 2.5,
          fillColor: color,
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup(popup(o))
        markers.set(o.id, m)
      }
    })
    markers.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m); markers.delete(id) }
    })
    if (!fittedRef.current && markers.size) {
      try {
        const group = L.featureGroup(Array.from(markers.values()))
        map.fitBounds(group.getBounds().pad(0.3))
        fittedRef.current = true
      } catch { /* single point fallback */ }
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      LRef.current = L
      const map = L.map(elRef.current, { scrollWheelZoom: true, attributionControl: false }).setView([13.7, 100.5], 5)
      mapRef.current = map
      const t = TILES[layer]
      tileLayerRef.current = L.tileLayer(t.url, {
        maxZoom: t.maxZoom,
        subdomains: t.subdomains,
      }).addTo(map)
      sync()
    })()
    return () => {
      cancelled = true
      if (mapRef.current) { (mapRef.current as any).remove(); mapRef.current = null }
      markersRef.current.clear()
      fittedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchLayer = (next: LayerKey) => {
    setLayer(next)
    const L = LRef.current, map = mapRef.current
    if (!L || !map || !tileLayerRef.current) return
    map.removeLayer(tileLayerRef.current)
    const t = TILES[next]
    tileLayerRef.current = L.tileLayer(t.url, {
      maxZoom: t.maxZoom,
      subdomains: t.subdomains,
    }).addTo(map)
  }

  const resetView = () => {
    const L = LRef.current, map = mapRef.current
    const markers = markersRef.current
    if (!L || !map || !markers.size) return
    try {
      map.fitBounds(L.featureGroup(Array.from(markers.values())).getBounds().pad(0.3))
    } catch {
      map.setView([13.7, 100.5], 6)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync() }, [orgs])

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
      {/* Map Control Bar (Layer Switcher & Reset View) */}
      <div className="absolute top-2.5 right-2.5 z-[500] flex items-center gap-1.5 bg-[#0d1117]/90 backdrop-blur p-1 rounded-lg border border-[#1e2433] shadow-lg">
        {(['dark', 'satellite', 'streets'] as LayerKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchLayer(k)}
            className={`text-[10px] uppercase font-semibold px-2 py-1 rounded transition-colors ${
              layer === k ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={resetView}
          title="Fit all organizations"
          className="text-[10px] font-semibold px-2 py-1 rounded bg-[#1e2433] text-slate-300 hover:text-white transition-colors ml-0.5"
        >
          Reset
        </button>
      </div>

      <div ref={elRef} style={{ height, width: '100%', background: '#0a0e1a' }} />
      <div className="absolute bottom-1 right-1.5 z-[500] text-[9px] text-slate-500" style={{ textShadow: '0 0 3px #000' }}>
        © OpenStreetMap · © CARTO · © Esri
      </div>
    </div>
  )
}
