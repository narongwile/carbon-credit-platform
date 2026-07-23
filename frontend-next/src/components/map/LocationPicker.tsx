'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

export default function LocationPicker({
  lat,
  lng,
  onChange,
  height = '300px'
}: {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
  height?: string
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    let cancelled = false
    let map: any
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      
      const defaultLat = lat ?? 13.7
      const defaultLng = lng ?? 100.9
      
      map = L.map(elRef.current, { scrollWheelZoom: true }).setView([defaultLat, defaultLng], 8)
      mapRef.current = map
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Initial marker
      if (lat != null && lng != null) {
        markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map)
        markerRef.current.on('dragend', (e: any) => {
          const pos = e.target.getLatLng()
          onChangeRef.current(pos.lat, pos.lng)
        })
      }

      // Click to place/move marker
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
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, []) // Mount once to avoid map flickering

  return <div ref={elRef} style={{ width: '100%', height, borderRadius: '0.75rem', zIndex: 0 }} />
}
