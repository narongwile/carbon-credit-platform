'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { healthColor, type GeoNode } from '@/lib/geoNodes'
import { api, type NodeLatest } from '@/lib/api'
import { subscribeTelemetry, type TelemetryFrame } from '@/lib/telemetryBus'
import { calculateDistanceMeters, formatDistance, reverseGeocode } from '@/lib/geoAddress'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import { fmtDateTime } from '@/lib/displayTime'
import MapSearchBar from '@/components/map/MapSearchBar'
import { sites as defaultSites } from '@/lib/fleetData'
import type { SensorDomain } from '@/types/fleet'
import {
  Map as MapIcon,
  Globe,
  Moon,
  Maximize2,
  Navigation,
  Layers,
  Zap,
  Thermometer,
  Droplet,
  Car,
  Filter,
  Check,
  Building2,
  X,
} from 'lucide-react'

const MAP_LAYERS = {
  streets: {
    name: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
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

export type PhotoCovers = Record<string, { photoId: string; v: string }>
export type NameplateMap = Record<string, { model: string | null; ratedKva: number | null; voltageClass: string | null }>

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return String(iso)
  const secs = Math.round((Date.now() - t) / 1000)
  if (secs < 0) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`
  return `${Math.floor(secs / 86400)} d ago`
}

function paramMeta(domain: GeoNode['domain'], key: string): { label: string; unit: string } {
  const p = ALARM_SCHEMA[domain]?.params.find((x) => x.key === key)
  return { label: p?.label ?? key, unit: p?.unit ?? '' }
}

const SECTION = 'color:#64748b;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:10px 0 4px'
const ROW = 'display:flex;justify-content:space-between;gap:12px;font-size:11px;line-height:1.6'
const ROW_K = 'color:#94a3b8;white-space:nowrap'
const ROW_V = 'color:#e2e8f0;font-weight:600;text-align:right'

const row = (k: string, v: string | number | null | undefined, suffix = ''): string =>
  v === null || v === undefined || v === '' || v === '—'
    ? ''
    : `<div style="${ROW}"><span style="${ROW_K}">${esc(k)}</span><span style="${ROW_V}">${esc(v)}${esc(suffix)}</span></div>`

export default function LiveSensorMap({
  nodes,
  height = '70vh',
  photoCovers,
  nameplates,
  onOpenPhotos,
  editable,
  onReposition,
  pickActive,
  onPick,
  onOpenDevice,
  initialSiteId,
  onSiteChange,
}: {
  nodes: GeoNode[]
  height?: string
  photoCovers?: PhotoCovers
  nameplates?: NameplateMap
  onOpenPhotos?: (nodeId: string) => void
  editable?: boolean
  onReposition?: (nodeId: string) => void
  pickActive?: boolean
  onPick?: (lat: number, lng: number) => void
  onOpenDevice?: (nodeId: string, domain: GeoNode['domain']) => void
  initialSiteId?: string | null
  onSiteChange?: (siteId: string | 'all') => void
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const userMarkerRef = useRef<any>(null)
  const userLocRef = useRef<{ lat: number; lng: number } | null>(null)
  const addressMapRef = useRef<Map<string, string>>(new Map())
  const fittedRef = useRef(false)

  const [currentLayer, setCurrentLayer] = useState<LayerKey>('streets')
  const [siteFilter, setSiteFilter] = useState<string>(initialSiteId || 'all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'critical' | 'warning' | 'healthy'>('all')
  const [domainFilter, setDomainFilter] = useState<'all' | SensorDomain>('all')
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (initialSiteId !== undefined) {
      setSiteFilter(initialSiteId || 'all')
    }
  }, [initialSiteId])

  const availableSites = useMemo(() => {
    const siteMap = new Map<string, { id: string; name: string; count: number }>()
    nodes.forEach((n) => {
      if (n.siteId) {
        const existing = siteMap.get(n.siteId)
        if (existing) {
          existing.count++
        } else {
          const meta = defaultSites.find((s) => s.id === n.siteId)
          siteMap.set(n.siteId, {
            id: n.siteId,
            name: meta?.name || n.siteId,
            count: 1,
          })
        }
      }
    })
    return Array.from(siteMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes])

  const counts = useMemo(() => {
    const scoped = siteFilter === 'all' ? nodes : nodes.filter((n) => n.siteId === siteFilter)
    return {
      all: scoped.length,
      critical: scoped.filter((n) => n.health === 'critical').length,
      warning: scoped.filter((n) => n.health === 'warning').length,
      healthy: scoped.filter((n) => n.health === 'healthy').length,
      transformer: scoped.filter((n) => n.domain === 'transformer').length,
      carbonNode: scoped.filter((n) => n.domain === 'carbonNode').length,
      bloodBox: scoped.filter((n) => n.domain === 'bloodBox').length,
      automobile: scoped.filter((n) => n.domain === 'automobile').length,
    }
  }, [nodes, siteFilter])

  const visibleNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (siteFilter !== 'all' && n.siteId !== siteFilter) return false
      if (statusFilter !== 'all' && n.health !== statusFilter) return false
      if (domainFilter !== 'all' && n.domain !== domainFilter) return false
      return true
    })
  }, [nodes, siteFilter, statusFilter, domainFilter])

  // Fly/fit to site bounds when a site is scoped
  useEffect(() => {
    if (siteFilter === 'all') return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const matched = nodes.filter((n) => n.siteId === siteFilter && Number.isFinite(n.lat) && Number.isFinite(n.lng))
    if (!matched.length) {
      const siteMeta = defaultSites.find((s) => s.id === siteFilter)
      if (siteMeta?.lat && siteMeta?.lng) {
        map.flyTo([siteMeta.lat, siteMeta.lng], 15, { duration: 1 })
      }
      return
    }
    if (matched.length === 1) {
      map.flyTo([matched[0].lat, matched[0].lng], 16, { duration: 1 })
    } else {
      try {
        const group = L.featureGroup(matched.map((n) => L.marker([n.lat, n.lng])))
        map.fitBounds(group.getBounds().pad(0.35), { duration: 1 })
      } catch {}
    }
  }, [siteFilter, nodes])

  const visibleNodesRef = useRef(visibleNodes)
  visibleNodesRef.current = visibleNodes

  const coversRef = useRef(photoCovers)
  coversRef.current = photoCovers
  const nameplatesRef = useRef(nameplates)
  nameplatesRef.current = nameplates

  const latestRef = useRef<Map<string, NodeLatest>>(new Map())
  const inFlightRef = useRef<Set<string>>(new Set())
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

  const popupHtml = (n: GeoNode) => {
    const cover = coversRef.current?.[n.id]
    const photo = cover
      ? `<button type="button" class="gsm-photo-btn" data-node-id="${esc(n.id)}"
           style="display:block;width:100%;height:96px;padding:0;margin:0 0 8px;border:1px solid #1e2433;border-radius:6px;overflow:hidden;cursor:pointer;background:#0a0e1a">
           <img src="${api.nodePhotoUrl(n.id, cover.photoId, { thumb: true, v: cover.v })}" alt=""
             style="width:100%;height:100%;object-fit:cover;display:block" />
         </button>`
      : ''

    const approxLine = n.approx
      ? editableRef.current
        ? `<div style="color:#fbbf24;font-size:11px;margin-top:6px">Approximate — shown at the factory location.</div>`
        : `<div style="color:#fbbf24;font-size:11px;margin-top:6px">Approximate — shown at the factory location. Set this device's position on the map.</div>`
      : ''

    const repositionBtn = editableRef.current
      ? `<button type="button" class="gsm-reposition-btn" data-node-id="${esc(n.id)}"
           style="display:flex;align-items:center;gap:5px;width:100%;margin-top:8px;padding:6px 8px;border-radius:6px;border:1px solid #6366f155;background:rgba(99,102,241,0.12);color:#a5b4fc;font-size:11px;font-weight:600;cursor:pointer">
           📍 ${n.approx ? 'Set position' : 'Reposition'}
         </button>`
      : ''

    const statusColor = healthColor[n.health]
    const statusLabel = n.health === 'critical' ? 'Critical' : n.health === 'warning' ? 'Warning' : 'Healthy'
    const offline = n.online === 0
    const presenceColor = offline ? '#64748b' : '#22c55e'
    const badges = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
         <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${statusColor}22;color:${statusColor}">
           <span style="width:6px;height:6px;border-radius:999px;background:${statusColor}"></span>${statusLabel}
         </span>
         ${n.online === undefined || n.online === null ? '' : `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${presenceColor}22;color:${presenceColor}">
           <span style="width:6px;height:6px;border-radius:999px;background:${presenceColor}"></span>${offline ? 'Offline' : 'Online'}
         </span>`}
         ${n.alarm ? `<span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${statusColor}22;color:${statusColor}">${esc(n.alarm)} alarm</span>` : ''}
       </div>`

    const latest = latestRef.current.get(n.id)
    const values = latest?.values ?? {}
    const keys = Object.keys(values)
    let readings = ''
    if (keys.length) {
      const SHOWN = 6
      const rows = keys.slice(0, SHOWN).map((k) => {
        const { label, unit } = paramMeta(n.domain, k)
        const v = values[k]
        const num = typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : v
        return row(label, num, unit ? ` ${unit}` : '')
      }).join('')
      const more = keys.length > SHOWN
        ? `<div style="color:#64748b;font-size:10px;margin-top:3px">+ ${keys.length - SHOWN} more parameter${keys.length - SHOWN === 1 ? '' : 's'}</div>`
        : ''
      readings = `<div style="${SECTION}">Live readings</div>${rows}${more}`
    } else if (latest) {
      readings = `<div style="${SECTION}">Live readings</div><div style="color:#64748b;font-size:11px">This device has not reported any values yet.</div>`
    } else if (n.deviceId) {
      readings = `<div style="${SECTION}">Live readings</div><div style="color:#64748b;font-size:11px">Loading…</div>`
    }

    const np = nameplatesRef.current?.[n.id]
    const asset = np && (np.model || np.ratedKva || np.voltageClass)
      ? `<div style="${SECTION}">Asset</div>${row('Model', np.model)}${row('Rating', np.ratedKva, ' kVA')}${row('Voltage', np.voltageClass)}`
      : ''

    const addr = addressMapRef.current.get(n.id)
    const locationSection = addr
      ? `<div style="display:flex;align-items:flex-start;gap:5px;margin-top:6px;font-size:11px;color:#cbd5e1;line-height:1.35;background:rgba(255,255,255,0.04);padding:5px 7px;border-radius:6px;border:1px solid #1e2433">
           <span style="color:#6366f1;flex-shrink:0">📍</span>
           <span style="flex:1">${esc(addr)}</span>
         </div>`
      : Number.isFinite(n.lat) && Number.isFinite(n.lng)
      ? `<div style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:10px;color:#64748b;font-family:monospace">
           <span>📍 ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}</span>
         </div>`
      : ''

    const userLoc = userLocRef.current
    let distanceSection = ''
    if (userLoc && Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
      const distM = calculateDistanceMeters(userLoc.lat, userLoc.lng, n.lat, n.lng)
      const distFormatted = formatDistance(distM)
      const dirUrl = `https://www.google.com/maps/dir/?api=1&origin=${userLoc.lat},${userLoc.lng}&destination=${n.lat},${n.lng}`
      distanceSection = `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(14,165,233,0.12);border:1px solid rgba(14,165,233,0.25);border-radius:6px;padding:5px 8px;margin-top:6px;font-size:11px;color:#38bdf8">
        <span>🧭 ห่างจากคุณ: <b>${distFormatted}</b></span>
        <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc;text-decoration:none;font-weight:700;font-size:10px;display:flex;align-items:center;gap:2px">นำทาง ↗</a>
      </div>`
    }

    const pres = latest?.presence
    const connectivity = [
      row('Device ID', n.deviceId),
      row('Last seen', n.lastSeen ? relativeTime(n.lastSeen) : (n.deviceId ? undefined : n.updated)),
      row('Signal', n.rssi, ' dBm'),
      row('Battery', pres?.batt, '%'),
      row('Link', pres?.transport),
      row('Firmware', n.fw),
      row('Parameters', n.sensorCount),
    ].join('')
    const connectivitySection = connectivity
      ? `<div style="${SECTION}">Device</div>${connectivity}`
      : `<div style="color:#94a3b8;font-size:11px;margin-top:6px">Updated: ${esc(n.updated)}</div>`

    const openBtn = `<button type="button" class="gsm-open-btn" data-node-id="${esc(n.id)}" data-domain="${esc(n.domain)}"
         style="display:flex;align-items:center;justify-content:center;gap:5px;width:100%;margin-top:6px;padding:6px 8px;border-radius:6px;border:none;background:#6366f1;color:#ffffff;font-size:11px;font-weight:700;cursor:pointer">
         View Dashboard →
       </button>`

    return `<div style="min-width:236px;max-width:272px;display:flex;flex-direction:column">
       <div style="overflow-y:auto;max-height:min(46vh,360px);padding-right:2px">
         ${photo}
         <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#f1f5f9">${esc(n.name)}</div>
         ${badges}
         <div style="display:flex;gap:16px;font-size:12px">
           <div><div style="color:#64748b">${esc(n.metricLabel)}</div><div style="font-weight:700;color:#e2e8f0">${esc(n.metricValue)}</div></div>
           <div><div style="color:#64748b">Platform</div><div style="font-weight:700;color:${esc(n.accent)}">${esc(n.platform)}</div></div>
         </div>
         ${readings}
         ${asset}
         ${locationSection}
         ${distanceSection}
         ${connectivitySection}
         ${latest?.lastReadingAt ? `<div style="color:#64748b;font-size:10px;margin-top:6px">Last reading ${esc(fmtDateTime(latest.lastReadingAt))}</div>` : ''}
         ${approxLine}
       </div>
       <div style="flex-shrink:0;border-top:1px solid #1e2433;margin-top:8px;padding-top:8px">
         ${repositionBtn}
         ${openBtn}
       </div>
     </div>`
  }

  const tooltipHtml = (n: GeoNode) => {
    const color = healthColor[n.health]
    return `
      <div style="padding: 3px 6px; font-family: inherit; line-height: 1.3;">
        <div style="display: flex; align-items: center; gap: 5px; font-weight: 700; color: #f8fafc; font-size: 11px;">
          <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${color}; box-shadow: 0 0 6px ${color};"></span>
          ${esc(n.name)}
        </div>
        <div style="color: #94a3b8; font-size: 10px; margin-top: 2px;">
          ${esc(n.platform)} · <span style="color: ${color}; font-weight: 600;">${esc(n.metricValue || n.health)}</span>
        </div>
      </div>
    `
  }

  const loadLatest = (id: string, force = false) => {
    if (inFlightRef.current.has(id)) return
    if (!force && latestRef.current.has(id)) return
    if (!visibleNodesRef.current.find((n) => n.id === id)?.deviceId) return
    inFlightRef.current.add(id)
    api.latest(id)
      .then((r) => {
        if (!r) return
        latestRef.current.set(id, r)
        const marker = markersRef.current.get(id)
        const fresh = visibleNodesRef.current.find((n) => n.id === id)
        if (marker && fresh) marker.setPopupContent(popupHtml(fresh))
      })
      .finally(() => { inFlightRef.current.delete(id) })
  }

  const syncMarkers = () => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const markers = markersRef.current
    const seen = new Set<string>()
    visibleNodesRef.current.forEach((n) => {
      seen.add(n.id)
      const color = healthColor[n.health]
      const existing = markers.get(n.id)
      const style = n.approx
        ? { fillColor: color, fillOpacity: 0.25, color, weight: 2, dashArray: '3 3' }
        : { fillColor: color, fillOpacity: 1, color: '#ffffff', weight: 2, dashArray: undefined }
      if (existing) {
        existing.setLatLng([n.lat, n.lng])
        existing.setStyle(style)
        existing.setPopupContent(popupHtml(n))
        if (existing.setTooltipContent) existing.setTooltipContent(tooltipHtml(n))
        if (existing.isPopupOpen?.()) {
          loadLatest(n.id, true)
          if (Number.isFinite(n.lat) && Number.isFinite(n.lng) && !addressMapRef.current.has(n.id)) {
            reverseGeocode(n.lat, n.lng).then((resolved) => {
              if (resolved) {
                addressMapRef.current.set(n.id, resolved)
                existing.setPopupContent(popupHtml(n))
              }
            })
          }
        }
      } else {
        const m = L.circleMarker([n.lat, n.lng], { radius: 9, ...style })
          .addTo(map)
          .bindPopup(popupHtml(n))
        m.on('popupopen', async () => {
          loadLatest(n.id, true)
          if (Number.isFinite(n.lat) && Number.isFinite(n.lng) && !addressMapRef.current.has(n.id)) {
            const resolved = await reverseGeocode(n.lat, n.lng)
            if (resolved) {
              addressMapRef.current.set(n.id, resolved)
              m.setPopupContent(popupHtml(n))
            }
          }
        })
        if (m.bindTooltip) {
          m.bindTooltip(tooltipHtml(n), {
            direction: 'top',
            offset: [0, -8],
            opacity: 0.95,
            className: 'gsm-map-tooltip',
          })
        }
        m._gsmNodeId = n.id
        markers.set(n.id, m)
      }
    })
    markers.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m); markers.delete(id) }
    })
    if (!fittedRef.current && markers.size) {
      try {
        map.fitBounds(L.featureGroup(Array.from(markers.values())).getBounds().pad(0.3))
        fittedRef.current = true
      } catch {
        /* single point */
      }
    }
  }

  const handleFitFleet = () => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || !markersRef.current.size) return
    try {
      const group = L.featureGroup(Array.from(markersRef.current.values()))
      map.fitBounds(group.getBounds().pad(0.3), { duration: 1 })
    } catch {
      /* single marker */
    }
  }

  const handleMyLocation = () => {
    if (!navigator.geolocation || !mapRef.current) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const { latitude, longitude } = pos.coords
        userLocRef.current = { lat: latitude, lng: longitude }
        const L = LRef.current, map = mapRef.current
        if (!L || !map) return
        map.flyTo([latitude, longitude], 15, { duration: 1.2 })
        if (userMarkerRef.current) {
          map.removeLayer(userMarkerRef.current)
        }
        const userIcon = L.divIcon({
          className: 'gsm-user-loc',
          html: `
            <div style="position: relative; width: 18px; height: 18px;">
              <div style="position: absolute; inset: 0; border-radius: 50%; background: #38bdf8; opacity: 0.75; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
              <div style="position: absolute; inset: 3px; border-radius: 50%; background: #0284c7; border: 2px solid #ffffff; box-shadow: 0 0 8px #38bdf8;"></div>
            </div>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
        const m = L.marker([latitude, longitude], { icon: userIcon })
          .addTo(map)
          .bindPopup('<b style="color:#0f172a">ตำแหน่งปัจจุบันของคุณ (Your Location)</b>')
          .openPopup()
        userMarkerRef.current = m

        // Refresh any open popups so distance is immediately visible
        markersRef.current.forEach((marker, id) => {
          const node = visibleNodesRef.current.find((n) => n.id === id)
          if (node && marker.isPopupOpen?.()) {
            marker.setPopupContent(popupHtml(node))
          }
        })
      },
      () => setLocating(false),
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  const switchLayer = (layerKey: LayerKey) => {
    setCurrentLayer(layerKey)
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(MAP_LAYERS[layerKey].url)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return
      LRef.current = L
      const map = L.map(elRef.current, { scrollWheelZoom: true }).setView([13.7, 100.9], 6)
      mapRef.current = map

      const initialLayerConfig = MAP_LAYERS.streets
      const tileLayer = L.tileLayer(initialLayerConfig.url, {
        attribution: initialLayerConfig.attribution,
        maxZoom: initialLayerConfig.maxZoom,
      }).addTo(map)
      tileLayerRef.current = tileLayer

      elRef.current.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const photoBtn = target.closest<HTMLElement>('.gsm-photo-btn')
        if (photoBtn) {
          const id = photoBtn.getAttribute('data-node-id')
          if (id) onOpenPhotosRef.current?.(id)
          return
        }
        const repoBtn = target.closest<HTMLElement>('.gsm-reposition-btn')
        if (repoBtn) {
          const id = repoBtn.getAttribute('data-node-id')
          if (id) {
            map.closePopup()
            onRepositionRef.current?.(id)
          }
          return
        }
        const openBtn = target.closest<HTMLElement>('.gsm-open-btn')
        if (openBtn) {
          const id = openBtn.getAttribute('data-node-id')
          const domain = openBtn.getAttribute('data-domain') as GeoNode['domain'] | null
          if (id && domain) onOpenDeviceRef.current?.(id, domain)
        }
      })

      map.on('popupopen', (e: any) => {
        const id: string | undefined = e?.popup?._source?._gsmNodeId
        if (id) loadLatest(id)
      })

      map.on('click', (e: any) => {
        if (!onPickRef.current) return
        if ((e.originalEvent?.target as HTMLElement | undefined)?.closest?.('.leaflet-interactive')) return
        onPickRef.current(e.latlng.lat, e.latlng.lng)
      })

      syncMarkers()
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        ;(mapRef.current as any).remove()
        mapRef.current = null
      }
      markersRef.current.clear()
      fittedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    syncMarkers()
  }, [visibleNodes, photoCovers, nameplates, editable])

  // Sub-second telemetry & alarm updates streamed over WebSocket
  useEffect(() => {
    const unsubscribe = subscribeTelemetry((f: TelemetryFrame) => {
      if (!f?.id) return
      const id = f.id

      // 1. Update cached latest values
      const cur = latestRef.current.get(id) || {
        nodeId: id,
        values: {},
        lastReadingAt: null,
        presence: { online: 1, last_seen: f.timestamp || new Date().toISOString(), rssi: null, batt: null, fw: null, transport: null },
      }
      const newVals = {
        ...(cur.values || {}),
        ...(f.values || (f.temperature != null ? { temperature: f.temperature } : {})),
      }
      const updatedLatest: NodeLatest = {
        ...cur,
        values: newVals,
        lastReadingAt: f.timestamp || new Date().toISOString(),
        presence: {
          ...(cur.presence || { rssi: null, batt: null, fw: null, transport: null }),
          online: 1,
          last_seen: f.timestamp || new Date().toISOString(),
        },
      }
      latestRef.current.set(id, updatedLatest)

      // 2. Update marker & node on map in real-time
      const node = visibleNodesRef.current.find((n) => n.id === id)
      if (node) {
        node.online = 1
        node.lastSeen = f.timestamp || new Date().toISOString()
        node.updated = f.timestamp ? relativeTime(f.timestamp) : 'Just now'
        if (f.type === 'alarm') {
          if (f.severity === 'CRITICAL') {
            node.alarm = 'CRITICAL'
            node.health = 'critical'
            node.metricValue = 'CRITICAL Alarm'
          } else if (f.severity === 'WARNING') {
            node.alarm = 'WARNING'
            node.health = 'warning'
            node.metricValue = 'WARNING Alarm'
          } else if (f.severity === 'NORMAL') {
            node.alarm = null
            node.health = 'healthy'
            node.metricValue = 'Online'
          }
        }
        const marker = markersRef.current.get(id)
        if (marker) {
          const color = healthColor[node.health]
          marker.setStyle({
            fillColor: color,
            color: node.approx ? color : '#ffffff',
          })
          if (marker.setTooltipContent) {
            marker.setTooltipContent(tooltipHtml(node))
          }
          if (marker.isPopupOpen?.()) {
            marker.setPopupContent(popupHtml(node))
          }
        }
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!elRef.current) return
    elRef.current.style.cursor = pickActive ? 'crosshair' : ''
  }, [pickActive])

  const handleSearchPlace = (lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.flyTo([lat, lng], 15, { duration: 1.2 })
    }
  }

  const hasMultipleDomains =
    (counts.transformer > 0 && counts.carbonNode > 0) ||
    (counts.transformer > 0 && counts.bloodBox > 0) ||
    (counts.carbonNode > 0 && counts.bloodBox > 0)

  return (
    <div className="relative">
      <style jsx global>{`
        .gsm-map-tooltip {
          background: rgba(13, 17, 23, 0.94) !important;
          border: 1px solid #1e2433 !important;
          border-radius: 8px !important;
          color: #fff !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
          padding: 2px 4px !important;
        }
        .gsm-map-tooltip::before {
          border-top-color: #1e2433 !important;
        }
      `}</style>

      {/* Search Bar */}
      <div className="absolute top-3 left-3 z-[1500] max-w-[240px] sm:max-w-[280px]">
        <MapSearchBar onSelectPlace={handleSearchPlace} placeholder="Search place, city, factory or lat, lng…" />
      </div>

      {/* Quick Filter Chips */}
      <div className="absolute top-3 left-[255px] sm:left-[300px] right-[240px] z-[1000] overflow-x-auto no-scrollbar hidden md:flex items-center gap-1.5 py-0.5 pointer-events-auto">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
            statusFilter === 'all'
              ? 'bg-indigo-600 text-white shadow-indigo-500/20'
              : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border border-[#1e2433]'
          }`}
        >
          All ({counts.all})
        </button>
        {counts.critical > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
              statusFilter === 'critical'
                ? 'bg-red-600 text-white shadow-red-500/20'
                : 'bg-[#0d1117]/90 text-red-400 hover:text-red-300 border border-red-500/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> Critical ({counts.critical})
          </button>
        )}
        {counts.warning > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
              statusFilter === 'warning'
                ? 'bg-amber-600 text-white shadow-amber-500/20'
                : 'bg-[#0d1117]/90 text-amber-400 hover:text-amber-300 border border-amber-500/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Warning ({counts.warning})
          </button>
        )}
        {counts.healthy > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'healthy' ? 'all' : 'healthy')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
              statusFilter === 'healthy'
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-[#0d1117]/90 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Normal ({counts.healthy})
          </button>
        )}

        {hasMultipleDomains && (
          <>
            <div className="w-px h-4 bg-slate-800 mx-1 flex-shrink-0" />
            <button
              type="button"
              onClick={() => setDomainFilter(domainFilter === 'transformer' ? 'all' : 'transformer')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
                domainFilter === 'transformer'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              <Zap size={11} className="text-amber-400" /> Transformers ({counts.transformer})
            </button>
            {counts.carbonNode > 0 && (
              <button
                type="button"
                onClick={() => setDomainFilter(domainFilter === 'carbonNode' ? 'all' : 'carbonNode')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
                  domainFilter === 'carbonNode'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                <Thermometer size={11} className="text-emerald-400" /> CarbonBOX ({counts.carbonNode})
              </button>
            )}
            {counts.bloodBox > 0 && (
              <button
                type="button"
                onClick={() => setDomainFilter(domainFilter === 'bloodBox' ? 'all' : 'bloodBox')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
                  domainFilter === 'bloodBox'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                <Droplet size={11} className="text-rose-400" /> BloodBOX ({counts.bloodBox})
              </button>
            )}
            {counts.automobile > 0 && (
              <button
                type="button"
                onClick={() => setDomainFilter(domainFilter === 'automobile' ? 'all' : 'automobile')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-md whitespace-nowrap transition-all ${
                  domainFilter === 'automobile'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                <Car size={11} className="text-amber-400" /> Formula EV ({counts.automobile})
              </button>
            )}
          </>
        )}

        {availableSites.length > 0 && (
          <>
            <div className="w-px h-4 bg-slate-800 mx-1 flex-shrink-0" />
            <div className="relative flex items-center">
              <Building2 size={12} className="absolute left-2.5 text-indigo-400 pointer-events-none" />
              <select
                value={siteFilter}
                onChange={(e) => {
                  const val = e.target.value
                  setSiteFilter(val)
                  onSiteChange?.(val)
                }}
                className={`text-xs font-semibold pl-7 pr-6 py-1 rounded-xl shadow-md border outline-none appearance-none cursor-pointer transition-all ${
                  siteFilter !== 'all'
                    ? 'bg-indigo-950/90 text-indigo-200 border-indigo-500/60 shadow-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'bg-[#0d1117]/90 text-slate-400 hover:text-white border-[#1e2433]'
                }`}
                title="Filter sensors by installation site (กรองเซนเซอร์ตามไซต์)"
              >
                <option value="all">All Sites ({nodes.length})</option>
                {availableSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.count})
                  </option>
                ))}
              </select>
            </div>
            {siteFilter !== 'all' && (
              <button
                type="button"
                onClick={() => {
                  setSiteFilter('all')
                  onSiteChange?.('all')
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Clear site filter (แสดงทุกไซต์)"
              >
                <X size={12} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Layer Switcher & Interactive Legend */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <div
          className="flex items-center p-0.5 rounded-xl shadow-lg"
          style={{ background: 'rgba(13, 17, 23, 0.92)', backdropFilter: 'blur(8px)', border: '1px solid #1e2433' }}
        >
          <button
            type="button"
            onClick={() => switchLayer('streets')}
            title="Street map (OpenStreetMap)"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              currentLayer === 'streets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapIcon size={12} /> Streets
          </button>
          <button
            type="button"
            onClick={() => switchLayer('satellite')}
            title="Satellite imagery (Esri World Imagery / ArcGIS)"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              currentLayer === 'satellite' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe size={12} /> Satellite
          </button>
          <button
            type="button"
            onClick={() => switchLayer('dark')}
            title="Dark map (CARTO Dark Matter)"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              currentLayer === 'dark' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Moon size={12} /> Dark
          </button>
        </div>

        {/* Interactive Legend Pills */}
        <div
          className="hidden sm:flex items-center gap-3 px-3.5 py-1.5 rounded-xl shadow-lg"
          style={{ background: 'rgba(13, 17, 23, 0.92)', backdropFilter: 'blur(8px)', border: '1px solid #1e2433' }}
        >
          {([['healthy', 'Healthy'], ['warning', 'Warning'], ['critical', 'Critical']] as const).map(([k, label]) => {
            const active = statusFilter === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(statusFilter === k ? 'all' : k)}
                className={`flex items-center gap-1.5 text-xs font-semibold transition-all px-1.5 py-0.5 rounded-md ${
                  active ? 'bg-white/10 text-white font-bold' : 'text-slate-300 hover:text-white'
                }`}
                title={`Filter ${label} devices`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: healthColor[k],
                    boxShadow: active ? `0 0 8px ${healthColor[k]}` : undefined,
                  }}
                />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Floating Action Controls (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={handleFitFleet}
          title="Fit all devices in view"
          className="p-2.5 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95 text-white flex items-center justify-center cursor-pointer"
          style={{
            background: 'rgba(13, 17, 23, 0.94)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #1e2433',
          }}
        >
          <Maximize2 size={16} className="text-indigo-400" />
        </button>
        <button
          type="button"
          onClick={handleMyLocation}
          disabled={locating}
          title="Locate my position"
          className="p-2.5 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95 text-white flex items-center justify-center cursor-pointer disabled:opacity-50"
          style={{
            background: 'rgba(13, 17, 23, 0.94)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #1e2433',
          }}
        >
          <Navigation size={16} className={locating ? 'text-indigo-400 animate-spin' : 'text-cyan-400'} />
        </button>
      </div>

      <div
        ref={elRef}
        style={{
          height,
          width: '100%',
          background: '#0a0e1a',
          outline: pickActive ? '2px solid #6366f1' : 'none',
          outlineOffset: '-2px',
        }}
        className="rounded-xl overflow-hidden shadow-inner"
      />
    </div>
  )
}
