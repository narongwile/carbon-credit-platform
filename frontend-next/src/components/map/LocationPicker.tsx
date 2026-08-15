'use client'

import { useEffect, useRef } from 'react'
import MapSearchBar from '@/components/map/MapSearchBar'
import 'leaflet/dist/leaflet.css'

export default function LocationPicker({
  lat,
  lng,
  onChange,
  height = '300px',
  interactive = true,
  zoom = 8,
  showSearch = false,
}: {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
  height?: string
  /** false renders a plain pin — pan/zoom still work, but click/drag cannot
   * move it. For a read-only "here's where this is" view sharing the same
   * map component as the editable picker, instead of a second one to keep
   * in sync with it. */
  interactive?: boolean
  zoom?: number
  showSearch?: boolean
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    let cancelled = false
    let map: any
    ;(async () => {
      const L = (await import('leaflet')).default
      LRef.current = L
      if (cancelled || !elRef.current || mapRef.current) return

      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const defaultLat = lat ?? 13.7
      const defaultLng = lng ?? 100.9
      
      map = L.map(elRef.current, { scrollWheelZoom: true, dragging: true }).setView([defaultLat, defaultLng], zoom)
      mapRef.current = map
      if (!interactive) map.doubleClickZoom.disable()

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Initial marker
      if (lat != null && lng != null) {
        markerRef.current = L.marker([lat, lng], { draggable: interactive }).addTo(map)
        if (interactive) {
          markerRef.current.on('dragend', (e: any) => {
            const pos = e.target.getLatLng()
            onChangeRef.current(pos.lat, pos.lng)
          })
        }
      }

      // Click to place/move marker — view mode leaves the map itself pannable
      if (interactive) {
        map.on('click', (e: any) => {
          const { lat, lng } = e.latlng
          if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng])
          } else {
            markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map)
            markerRef.current.on('dragend', (ev: any) => {
              const pos = ev.target.getLatLng()
              onChangeRef.current(pos.lat, pos.lng)
            })
          }
          onChangeRef.current(lat, lng)
        })
      }
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePlaceSelect = (targetLat: number, targetLng: number) => {
    if (!mapRef.current) return
    mapRef.current.flyTo([targetLat, targetLng], 15, { duration: 1.2 })
    if (interactive) {
      if (markerRef.current) {
        markerRef.current.setLatLng([targetLat, targetLng])
      } else if (LRef.current) {
        markerRef.current = LRef.current.marker([targetLat, targetLng], { draggable: true }).addTo(mapRef.current)
        markerRef.current.on('dragend', (ev: any) => {
          const pos = ev.target.getLatLng()
          onChangeRef.current(pos.lat, pos.lng)
        })
      }
      onChangeRef.current(targetLat, targetLng)
    }
  }

  return (
    <div className="relative" style={{ width: '100%', height }}>
      {showSearch && (
        <div className="absolute top-2 left-2 z-[500] max-w-[280px] sm:max-w-xs">
          <MapSearchBar onSelectPlace={handlePlaceSelect} placeholder="Search place or address…" />
        </div>
      )}
      <div ref={elRef} style={{ width: '100%', height: '100%', borderRadius: '0.75rem', zIndex: 0 }} />
    </div>
  )
}
