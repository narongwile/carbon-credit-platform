'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { healthColor, type GeoNode } from '@/lib/geoNodes'

// Real geographic Live Sensor Map (Leaflet + OpenStreetMap tiles).
// The map is created ONCE and markers are updated in place — previously the whole
// map (tiles + view) was torn down and rebuilt on every telemetry tick because the
// effect depended on `nodes` (a fresh array each render), which looked like the map
// "refreshing every second". Now data updates only re-sync markers; the user's
// pan/zoom and any open popup are preserved.
export default function LiveSensorMap({ nodes, height = '70vh' }: { nodes: GeoNode[]; height?: string }) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const fittedRef = useRef(false)
  // Always read the latest nodes (avoids a stale closure in the mount effect).
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const popupHtml = (n: GeoNode) =>
    `<div style="min-width:180px">
       <div style="font-weight:700;font-size:14px;margin-bottom:6px">${n.name}</div>
       <div style="display:flex;gap:16px;font-size:12px">
         <div><div style="color:#64748b">${n.metricLabel}</div><div style="font-weight:700">${n.metricValue}</div></div>
         <div><div style="color:#64748b">Platform</div><div style="font-weight:700;color:${n.accent}">${n.platform}</div></div>
       </div>
       <div style="color:#94a3b8;font-size:11px;margin-top:6px">Updated: ${n.updated}</div>
       ${n.approx ? `<div style="color:#fbbf24;font-size:11px;margin-top:6px">Approximate — shown at the factory location. Set this device's position on its floor plan.</div>` : ''}
     </div>`

  // Add/update/remove markers to match the current nodes — reusing the map.
  const syncMarkers = () => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const markers = markersRef.current
    const seen = new Set<string>()
    nodesRef.current.forEach((n) => {
      seen.add(n.id)
      const color = healthColor[n.health]
      const existing = markers.get(n.id)
      // A device with no coordinate of its own is shown at the org's factory pin.
      // It must not look like a surveyed position: hollow, dashed and dimmer, so
      // "roughly at this site" is visibly different from "here".
      const style = n.approx
        ? { fillColor: color, fillOpacity: 0.25, color, weight: 2, dashArray: '3 3' }
        : { fillColor: color, fillOpacity: 1, color: '#ffffff', weight: 2, dashArray: undefined }
      if (existing) {
        existing.setLatLng([n.lat, n.lng])
        existing.setStyle(style)
        existing.setPopupContent(popupHtml(n))
      } else {
        const m = L.circleMarker([n.lat, n.lng], { radius: 9, ...style })
          .addTo(map)
          .bindPopup(popupHtml(n))
        markers.set(n.id, m)
      }
    })
    markers.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m); markers.delete(id) }
    })
    // Fit the view to the markers only once, so live updates don't yank the map.
    if (!fittedRef.current && markers.size) {
      try { map.fitBounds(L.featureGroup(Array.from(markers.values())).getBounds().pad(0.3)); fittedRef.current = true } catch { /* single point */ }
    }
  }

  // Create the map once (mount only).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      LRef.current = L
      const map = L.map(elRef.current, { scrollWheelZoom: true }).setView([13.7, 100.9], 6)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)
      syncMarkers()
    })()
    return () => {
      cancelled = true
      if (mapRef.current) { (mapRef.current as any).remove(); mapRef.current = null }
      markersRef.current.clear()
      fittedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-sync markers when the data changes (no map recreation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncMarkers() }, [nodes])

  return (
    <div className="relative">
      {/* Legend */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-4 px-4 py-2 rounded-xl shadow-lg" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        {([['healthy', 'Healthy'], ['warning', 'Warning'], ['critical', 'Critical']] as const).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: healthColor[k] }} /> {label}
          </span>
        ))}
      </div>
      <div ref={elRef} style={{ height, width: '100%', background: '#0a0e1a' }} className="rounded-xl overflow-hidden" />
    </div>
  )
}
