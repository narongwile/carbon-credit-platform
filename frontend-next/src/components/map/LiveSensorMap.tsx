'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { healthColor, type GeoNode } from '@/lib/geoNodes'
import { api } from '@/lib/api'
import MapSearchBar from '@/components/map/MapSearchBar'

/** Cover photo id per device — see useOrgPhotoCovers. One request for the whole map. */
export type PhotoCovers = Record<string, { photoId: string; v: string }>

// Real geographic Live Sensor Map (Leaflet + OpenStreetMap tiles).
// The map is created ONCE and markers are updated in place — previously the whole
// map (tiles + view) was torn down and rebuilt on every telemetry tick because the
// effect depended on `nodes` (a fresh array each render), which looked like the map
// "refreshing every second". Now data updates only re-sync markers; the user's
// pan/zoom and any open popup are preserved.
export default function LiveSensorMap({
  nodes, height = '70vh', photoCovers, onOpenPhotos, editable, onReposition, pickActive, onPick, onOpenDevice,
}: {
  nodes: GeoNode[]
  height?: string
  /** Thumbnail shown in the popup, keyed by node id. Omit to render the popup exactly as before. */
  photoCovers?: PhotoCovers
  /** Fired when the popup thumbnail is clicked — the caller owns the lightbox. */
  onOpenPhotos?: (nodeId: string) => void
  /** Adds a "Reposition" button to every popup — ETERNITY has no Floor Plans feature, so this map IS how a device's position gets set. */
  editable?: boolean
  /** Fired when "Reposition" is clicked — the caller owns what "pick a new point" means (see DevicePlacementPanel). */
  onReposition?: (nodeId: string) => void
  /** While true, clicking open ground (not a marker) reports a coordinate instead of doing nothing. */
  pickActive?: boolean
  onPick?: (lat: number, lng: number) => void
  /** Fired when "View Dashboard" is clicked in a popup — the caller owns
   * routing (transformer vs the shared node twin differ by domain). */
  onOpenDevice?: (nodeId: string, domain: GeoNode['domain']) => void
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const fittedRef = useRef(false)
  // Always read the latest nodes (avoids a stale closure in the mount effect).
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const coversRef = useRef(photoCovers)
  coversRef.current = photoCovers
  const onOpenPhotosRef = useRef(onOpenPhotos)
  onOpenPhotosRef.current = onOpenPhotos
  const editableRef = useRef(editable)
  editableRef.current = editable
  const onRepositionRef = useRef(onReposition)
  onRepositionRef.current = onReposition
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const onOpenDeviceRef = useRef(onOpenDevice)
  onOpenDeviceRef.current = onOpenDevice

  // A responder walking up to the wrong grey box at 2am is the whole reason the
  // device photo exists (see DevicePhotoGallery) — the map popup is exactly
  // where that recognition needs to happen, before they've even arrived. The
  // thumbnail is the ~320px copy the gallery already produced; this view adds
  // no new image, just another place the existing one earns its keep.
  const popupHtml = (n: GeoNode) => {
    const cover = coversRef.current?.[n.id]
    const photo = cover
      ? `<button type="button" class="gsm-photo-btn" data-node-id="${n.id}"
           style="display:block;width:100%;height:96px;padding:0;margin:0 0 8px;border:1px solid #1e2433;border-radius:6px;overflow:hidden;cursor:pointer;background:#0a0e1a">
           <img src="${api.nodePhotoUrl(n.id, cover.photoId, { thumb: true, v: cover.v })}" alt=""
             style="width:100%;height:100%;object-fit:cover;display:block" />
         </button>`
      : ''
    // "Set this device's position on its floor plan" is wrong advice for an
    // org with no Floor Plans feature — ETERNITY's sites are real GPS
    // coordinates, not indoor layouts. editable orgs get a working button
    // instead of a dead-end sentence.
    const approxLine = n.approx
      ? editableRef.current
        ? `<div style="color:#fbbf24;font-size:11px;margin-top:6px">Approximate — shown at the factory location.</div>`
        : `<div style="color:#fbbf24;font-size:11px;margin-top:6px">Approximate — shown at the factory location. Set this device's position on its floor plan.</div>`
      : ''
    const repositionBtn = editableRef.current
      ? `<button type="button" class="gsm-reposition-btn" data-node-id="${n.id}"
           style="display:flex;align-items:center;gap:5px;width:100%;margin-top:8px;padding:6px 8px;border-radius:6px;border:1px solid #6366f155;background:rgba(99,102,241,0.12);color:#a5b4fc;font-size:11px;font-weight:600;cursor:pointer">
           📍 ${n.approx ? 'Set position' : 'Reposition'}
         </button>`
      : ''
    // Same color the marker itself uses (healthColor[n.health]) — the badge
    // reads as "this pin, described", not a second, disagreeing opinion.
    // Derived from n.health specifically, NOT metricValue: in live mode
    // metricValue genuinely is the alarm/status text (CRITICAL/WARNING/
    // Online/Offline — fleetToGeoNodes), but in demo mode it's a real
    // per-domain sensor reading (oil temp, cabinet temp — geoNodes.ts's
    // metric()) that would read as nonsense inside a status pill. health is
    // real status in both modes.
    const statusColor = healthColor[n.health]
    const statusLabel = n.health === 'critical' ? 'Critical' : n.health === 'warning' ? 'Warning' : 'Healthy'
    const statusBadge = `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;margin-bottom:6px;background:${statusColor}22;color:${statusColor}">
         <span style="width:6px;height:6px;border-radius:999px;background:${statusColor}"></span>${statusLabel}
       </div>`
    const openBtn = `<button type="button" class="gsm-open-btn" data-node-id="${n.id}" data-domain="${n.domain}"
         style="display:flex;align-items:center;justify-content:center;gap:5px;width:100%;margin-top:8px;padding:6px 8px;border-radius:6px;border:none;background:#6366f1;color:#ffffff;font-size:11px;font-weight:700;cursor:pointer">
         View Dashboard →
       </button>`
    return `<div style="min-width:180px">
       ${photo}
       <div style="font-weight:700;font-size:14px;margin-bottom:4px">${n.name}</div>
       ${statusBadge}
       <div style="display:flex;gap:16px;font-size:12px">
         <div><div style="color:#64748b">${n.metricLabel}</div><div style="font-weight:700">${n.metricValue}</div></div>
         <div><div style="color:#64748b">Platform</div><div style="font-weight:700;color:${n.accent}">${n.platform}</div></div>
       </div>
       <div style="color:#94a3b8;font-size:11px;margin-top:6px">Updated: ${n.updated}</div>
       ${approxLine}
       ${repositionBtn}
       ${openBtn}
     </div>`
  }

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
      // Popup content is a raw HTML string (Leaflet, not React), so the click
      // is wired via delegation on the map's own container rather than bound
      // to the button element itself. It has to be: every live telemetry tick
      // re-syncs markers, and setPopupContent() on an OPEN popup replaces the
      // popup's innerHTML — including this button — without firing 'popupopen'
      // again, which silently killed a directly-bound listener within seconds
      // of the popup opening. A listener on the container never goes stale
      // because it never lived on the node that gets replaced.
      elRef.current.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const photoBtn = target.closest<HTMLElement>('.gsm-photo-btn')
        if (photoBtn) { const id = photoBtn.getAttribute('data-node-id'); if (id) onOpenPhotosRef.current?.(id); return }
        const repoBtn = target.closest<HTMLElement>('.gsm-reposition-btn')
        if (repoBtn) {
          const id = repoBtn.getAttribute('data-node-id')
          if (id) { map.closePopup(); onRepositionRef.current?.(id) }
          return
        }
        const openBtn = target.closest<HTMLElement>('.gsm-open-btn')
        if (openBtn) {
          const id = openBtn.getAttribute('data-node-id')
          const domain = openBtn.getAttribute('data-domain') as GeoNode['domain'] | null
          if (id && domain) onOpenDeviceRef.current?.(id, domain)
        }
      })
      // Pick mode: a click on open ground (Leaflet does not fire 'click' on the
      // map when a marker or popup consumed it) reports the coordinate. This is
      // the whole placement mechanism — ETERNITY has no Floor Plans feature, so
      // there is no OTHER way for an admin to give a device a real position.
      map.on('click', (e: any) => {
        if (!onPickRef.current) return
        // circleMarker click events bubble to the map's own 'click' by default
        // (Leaflet's bubblingMouseEvents), so a click ON an existing marker
        // would otherwise ALSO report that marker's own coordinate as a new
        // pick — redundant at best, a wrong placement at worst. Only ground.
        if ((e.originalEvent?.target as HTMLElement | undefined)?.closest?.('.leaflet-interactive')) return
        onPickRef.current(e.latlng.lat, e.latlng.lng)
      })
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

  // Re-sync markers when the data — or the cover photos — changes (no map
  // recreation). setPopupContent() on an OPEN popup updates it live, which is
  // what lets a photo just uploaded on the device page appear here without a
  // reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncMarkers() }, [nodes, photoCovers, editable])

  // The one visible sign a click will do something other than pan: a crosshair
  // instead of the open hand, and a border that says "you are placing a pin".
  useEffect(() => {
    if (!elRef.current) return
    elRef.current.style.cursor = pickActive ? 'crosshair' : ''
  }, [pickActive])

  const handleSearchPlace = (lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.flyTo([lat, lng], 15, { duration: 1.2 })
    }
  }

  return (
    <div className="relative">
      {/* Search Bar */}
      <div className="absolute top-3 left-3 z-[1000]">
        <MapSearchBar onSelectPlace={handleSearchPlace} placeholder="Search place, city, factory or lat, lng…" />
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 z-[1000] hidden sm:flex items-center gap-4 px-4 py-2 rounded-xl shadow-lg" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        {([['healthy', 'Healthy'], ['warning', 'Warning'], ['critical', 'Critical']] as const).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: healthColor[k] }} /> {label}
          </span>
        ))}
      </div>
      <div ref={elRef} style={{ height, width: '100%', background: '#0a0e1a', outline: pickActive ? '2px solid #6366f1' : 'none', outlineOffset: '-2px' }} className="rounded-xl overflow-hidden" />
    </div>
  )
}
