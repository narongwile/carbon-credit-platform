'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

export type MapOrg = { id: string; name: string; lat: number; lng: number; active: boolean; where?: string }

// Real interactive map (Leaflet + dark CARTO tiles) of organization locations —
// zoom / pan / real coordinates, same robust pattern as LiveSensorMap: the map is
// created once and markers are updated in place, so live updates never rebuild it.
export default function OrgDistributionMap({ orgs, height = '360px' }: { orgs: MapOrg[]; height?: string }) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const fittedRef = useRef(false)
  const orgsRef = useRef(orgs)
  orgsRef.current = orgs

  const popup = (o: MapOrg) =>
    `<div style="min-width:150px">
       <div style="font-weight:700;font-size:13px">${o.name}</div>
       <div style="font-size:11px;color:${o.active ? '#4ade80' : '#94a3b8'};margin-top:2px">${o.active ? 'Active' : 'Suspended'}${o.where ? ' · ' + o.where : ''}</div>
       <div style="font-size:11px;color:#94a3b8;margin-top:4px">${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}</div>
     </div>`

  const sync = () => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const markers = markersRef.current
    const seen = new Set<string>()
    orgsRef.current.forEach((o) => {
      seen.add(o.id)
      const color = o.active ? '#4ade80' : '#64748b'
      const existing = markers.get(o.id)
      if (existing) {
        existing.setLatLng([o.lat, o.lng])
        existing.setStyle({ fillColor: color })
        existing.setPopupContent(popup(o))
      } else {
        const m = L.circleMarker([o.lat, o.lng], { radius: 8, color: '#0a0e1a', weight: 2, fillColor: color, fillOpacity: 1 })
          .addTo(map)
          .bindPopup(popup(o))
        markers.set(o.id, m)
      }
    })
    markers.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m); markers.delete(id) }
    })
    if (!fittedRef.current && markers.size) {
      try { map.fitBounds(L.featureGroup(Array.from(markers.values())).getBounds().pad(0.4)); fittedRef.current = true } catch { /* single point */ }
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      LRef.current = L
      const map = L.map(elRef.current, { scrollWheelZoom: true, attributionControl: false }).setView([13.2, 101.0], 5)
      mapRef.current = map
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync() }, [orgs])

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
      <div ref={elRef} style={{ height, width: '100%', background: '#0a0e1a' }} />
      <div className="absolute bottom-1 right-1.5 z-[500] text-[9px] text-slate-500" style={{ textShadow: '0 0 3px #000' }}>© OpenStreetMap · © CARTO</div>
    </div>
  )
}
