'use client'

import { useEffect, useRef, useState } from 'react'
import MapSearchBar from '@/components/map/MapSearchBar'
import { Layers, Map as MapIcon, Globe, Moon } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const MAP_LAYERS = {
  streets: {
    name: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  dark: {
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  },
} as const

type LayerKey = keyof typeof MAP_LAYERS

export default function LocationPicker({
  lat,
  lng,
  onChange,
  height = '300px',
  interactive = true,
  zoom = 8,
  showSearch = false,
  showLayerSwitcher = true,
  defaultLayer = 'streets',
}: {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
  height?: string
  interactive?: boolean
  zoom?: number
  showSearch?: boolean
  showLayerSwitcher?: boolean
  defaultLayer?: LayerKey
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)
  const [currentLayer, setCurrentLayer] = useState<LayerKey>(defaultLayer)

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

      const initialLayerConfig = MAP_LAYERS[defaultLayer]
      const tileLayer = L.tileLayer(initialLayerConfig.url, {
        attribution: initialLayerConfig.attribution,
        maxZoom: initialLayerConfig.maxZoom,
      }).addTo(map)
      tileLayerRef.current = tileLayer

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

  const switchLayer = (layerKey: LayerKey) => {
    setCurrentLayer(layerKey)
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(MAP_LAYERS[layerKey].url)
    }
  }

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
        <div className="absolute top-2 left-2 z-[500] max-w-[260px] sm:max-w-xs">
          <MapSearchBar onSelectPlace={handlePlaceSelect} placeholder="Search place or address…" />
        </div>
      )}

      {/* Layer Switcher (Streets / Esri Satellite / Dark) */}
      {showLayerSwitcher && (
        <div className="absolute top-2 right-2 z-[500] flex items-center p-0.5 rounded-lg shadow-lg"
          style={{ background: 'rgba(13, 17, 23, 0.92)', backdropFilter: 'blur(8px)', border: '1px solid #1e2433' }}>
          <button
            type="button"
            onClick={() => switchLayer('streets')}
            title="Street map (OpenStreetMap)"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
              currentLayer === 'streets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapIcon size={11} /> Streets
          </button>
          <button
            type="button"
            onClick={() => switchLayer('satellite')}
            title="Satellite imagery (Esri World Imagery / ArcGIS)"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
              currentLayer === 'satellite' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe size={11} /> Satellite
          </button>
          <button
            type="button"
            onClick={() => switchLayer('dark')}
            title="Dark map (CARTO Dark Matter)"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
              currentLayer === 'dark' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Moon size={11} /> Dark
          </button>
        </div>
      )}

      <div ref={elRef} style={{ width: '100%', height: '100%', borderRadius: '0.75rem', zIndex: 0 }} />
    </div>
  )
}
