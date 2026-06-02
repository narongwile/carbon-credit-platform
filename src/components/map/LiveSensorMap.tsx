'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { healthColor, type GeoNode } from '@/lib/geoNodes'
import { DOMAIN_META } from '@/types/fleet'

// Real geographic Live Sensor Map (Leaflet + OpenStreetMap tiles).
// Leaflet is imported lazily inside useEffect so it never runs during the
// static-export prerender (no `window` on the server).
export default function LiveSensorMap({ nodes, height = '70vh' }: { nodes: GeoNode[]; height?: string }) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)

  useEffect(() => {
    let cancelled = false
    let map: any
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      map = L.map(elRef.current, { scrollWheelZoom: true }).setView([13.7, 100.9], 6)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      const group: any[] = []
      nodes.forEach((n) => {
        const color = healthColor[n.health]
        const marker = L.circleMarker([n.lat, n.lng], {
          radius: 9, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1,
        }).addTo(map)
        marker.bindPopup(
          `<div style="min-width:180px">
             <div style="font-weight:700;font-size:14px;margin-bottom:6px">${n.name}</div>
             <div style="display:flex;gap:16px;font-size:12px">
               <div><div style="color:#64748b">${n.metricLabel}</div><div style="font-weight:700">${n.metricValue}</div></div>
               <div><div style="color:#64748b">Platform</div><div style="font-weight:700;color:${n.accent}">${n.platform}</div></div>
             </div>
             <div style="color:#94a3b8;font-size:11px;margin-top:6px">Updated: ${n.updated}</div>
           </div>`,
        )
        group.push(marker)
      })
      if (group.length) {
        const fg = L.featureGroup(group)
        try { map.fitBounds(fg.getBounds().pad(0.3)) } catch { /* single point */ }
      }
    })()

    return () => {
      cancelled = true
      if (mapRef.current) { (mapRef.current as any).remove(); mapRef.current = null }
    }
  }, [nodes])

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
