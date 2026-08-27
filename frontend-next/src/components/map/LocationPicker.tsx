'use client'

import { useEffect, useRef, useState } from 'react'
import MapSearchBar from '@/components/map/MapSearchBar'
import { Layers, Map as MapIcon, Globe, Moon, Navigation, Loader2 } from 'lucide-react'
import { reverseGeocode, useReverseAddress } from '@/lib/geoAddress'
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
  showMyLocation = false,
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
  showMyLocation?: boolean
  defaultLayer?: LayerKey
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const userMarkerRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)
  const [currentLayer, setCurrentLayer] = useState<LayerKey>(defaultLayer)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const { address: currentPinAddress, loading: addressLoading } = useReverseAddress(lat, lng)

  const updateFactoryMarkerPopup = async (marker: any, targetLat: number, targetLng: number) => {
    if (!marker) return
    marker.bindPopup(`
      <div style="font-family:sans-serif; min-width:180px; padding:2px;">
        <div style="font-size:12px; font-weight:700; color:#0f172a;">🏭 พิกัดโรงงาน (Factory Location)</div>
        <div style="font-size:10px; color:#64748b; font-family:monospace; margin-top:2px;">${targetLat.toFixed(6)}, ${targetLng.toFixed(6)}</div>
        <div style="font-size:10px; color:#6366f1; margin-top:4px; font-style:italic;">กำลังระบุชื่อสถานที่...</div>
        <div style="font-size:9px; color:#94a3b8; margin-top:4px;">(ลากหมุดเพื่อปรับตำแหน่งได้)</div>
      </div>
    `)
    const addr = await reverseGeocode(targetLat, targetLng)
    if (addr) {
      marker.bindPopup(`
        <div style="font-family:sans-serif; min-width:200px; padding:3px;">
          <div style="font-size:12px; font-weight:700; color:#0f172a; margin-bottom:2px;">🏭 พิกัดโรงงาน (Factory Location)</div>
          <div style="font-size:11px; color:#1e293b; font-weight:600; line-height:1.35; margin-bottom:4px;">📍 ${addr}</div>
          <div style="font-size:10px; color:#64748b; font-family:monospace;">${targetLat.toFixed(6)}, ${targetLng.toFixed(6)}</div>
          <div style="font-size:9px; color:#6366f1; margin-top:5px; border-top:1px solid #e2e8f0; padding-top:2px;">✓ ยืนยันตำแหน่งแล้ว (ลากหมุดเพื่อปรับได้)</div>
        </div>
      `)
      if (marker.isPopupOpen?.()) {
        marker.openPopup()
      }
    }
  }

  const handleMyLocation = () => {
    if (!navigator.geolocation || !mapRef.current) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false)
        const { latitude, longitude } = pos.coords
        const L = LRef.current, map = mapRef.current
        if (!L || !map) return
        map.flyTo([latitude, longitude], 15, { duration: 1.2 })
        if (userMarkerRef.current) {
          map.removeLayer(userMarkerRef.current)
        }
        const userIcon = L.divIcon({
          className: 'gsm-user-loc',
          html: `
            <div style="position: relative; width: 20px; height: 20px;">
              <div style="position: absolute; inset: 0; border-radius: 50%; background: #38bdf8; opacity: 0.75; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
              <div style="position: absolute; inset: 3px; border-radius: 50%; background: #0284c7; border: 2px solid #ffffff; box-shadow: 0 0 10px #38bdf8;"></div>
            </div>
          `,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        })

        const addr = await reverseGeocode(latitude, longitude)
        const popupDiv = document.createElement('div')
        popupDiv.style.fontFamily = 'sans-serif'
        popupDiv.style.minWidth = '170px'
        popupDiv.style.padding = '2px'
        popupDiv.innerHTML = `
          <div style="font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">📍 ตำแหน่งปัจจุบันของคุณ</div>
          ${addr ? `<div style="font-size: 11px; color: #1e293b; font-weight: 600; margin-bottom: 4px; line-height: 1.35;">📍 ${addr}</div>` : ''}
          <div style="font-size: 10px; color: #64748b; font-family: monospace; margin-bottom: 6px;">${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <button type="button" id="btn-pin-factory-here" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; background: #4f46e5; color: #ffffff; border: none; border-radius: 6px; padding: 5px 8px; font-size: 11px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
            📌 ปักหมุดที่นี่เป็นพิกัดโรงงาน
          </button>
        `

        const m = L.marker([latitude, longitude], { icon: userIcon })
          .addTo(map)
          .bindPopup(popupDiv)
          .openPopup()
        userMarkerRef.current = m

        const btn = popupDiv.querySelector('#btn-pin-factory-here') as HTMLElement | null
        if (btn) {
          btn.onclick = () => {
            handlePlaceSelect(latitude, longitude)
            m.closePopup()
          }
        }
      },
      () => setLocating(false),
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

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
        markerRef.current.bindPopup('<b style="color:#0f172a">🏭 พิกัดโรงงาน (Factory Location)</b>')
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
            markerRef.current.bindPopup('<b style="color:#0f172a">🏭 พิกัดโรงงาน (Factory Location)</b>')
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

  // Synchronize marker when lat or lng changes externally (typed in input, or current location clicked)
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return

    if (lat != null && lng != null) {
      if (markerRef.current) {
        const cur = markerRef.current.getLatLng()
        if (Math.abs(cur.lat - lat) > 0.000001 || Math.abs(cur.lng - lng) > 0.000001) {
          markerRef.current.setLatLng([lat, lng])
          map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 })
        }
      } else {
        const m = L.marker([lat, lng], { draggable: interactive }).addTo(map)
        m.bindPopup('<b style="color:#0f172a">🏭 พิกัดโรงงาน (Factory Location)</b>')
        if (interactive) {
          m.on('dragend', (e: any) => {
            const pos = e.target.getLatLng()
            onChangeRef.current(pos.lat, pos.lng)
          })
        }
        markerRef.current = m
        map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 })
      }
    } else if (markerRef.current) {
      map.removeLayer(markerRef.current)
      markerRef.current = null
    }
  }, [lat, lng, interactive])

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

      {/* Layer Switcher (Streets / Esri Satellite / Dark) & My Location */}
      <div className="absolute top-2 right-2 z-[500] flex items-center gap-1.5">
        {showMyLocation && (
          <button
            type="button"
            onClick={handleMyLocation}
            disabled={locating}
            title="Locate my position (แสดงพิกัดตำแหน่งปัจจุบันของคุณ)"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all shadow-lg text-white disabled:opacity-50"
            style={{ background: 'rgba(13, 17, 23, 0.92)', backdropFilter: 'blur(8px)', border: '1px solid #1e2433' }}
          >
            {locating ? <Loader2 size={11} className="animate-spin text-cyan-400" /> : <Navigation size={11} className="text-cyan-400" />}
            <span className="hidden sm:inline">My Location</span>
          </button>
        )}

        {showLayerSwitcher && (
          <div className="flex items-center p-0.5 rounded-lg shadow-lg"
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
      </div>

      {/* Floating Bottom Status Pill with Address Confirmation */}
      {lat != null && lng != null && (
        <div
          className="absolute bottom-2 left-2 z-[500] max-w-[calc(100%-1rem)] sm:max-w-md px-3 py-1.5 rounded-lg shadow-xl text-[11px] flex items-center gap-2 border border-slate-700/80"
          style={{ background: 'rgba(10, 14, 26, 0.94)', backdropFilter: 'blur(10px)' }}
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <div className="flex-1 truncate">
            {addressLoading ? (
              <span className="text-slate-400 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin text-cyan-400 shrink-0" />
                กำลังระบุชื่อสถานที่...
              </span>
            ) : currentPinAddress ? (
              <span className="text-slate-200 font-medium truncate block" title={currentPinAddress}>
                📍 {currentPinAddress}
              </span>
            ) : (
              <span className="text-slate-400 font-mono">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-indigo-300 shrink-0 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </span>
        </div>
      )}

      <div ref={elRef} style={{ width: '100%', height: '100%', borderRadius: '0.75rem', zIndex: 0 }} />
    </div>
  )
}
