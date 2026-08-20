'use client'

import { useEffect, useState } from 'react'

// In-memory cache for fast lookups across re-renders
const memoryCache = new Map<string, string>()

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

/**
 * Clean up Nominatim address components into a concise, readable address string.
 */
function formatAddress(data: any): string {
  if (!data) return ''
  const a = data.address || {}
  
  // Thai / Asian address hierarchy if available
  const parts: string[] = []
  
  if (a.building || a.amenity || a.industrial) parts.push(a.building || a.amenity || a.industrial)
  if (a.road) parts.push(a.road)
  if (a.neighbourhood || a.suburb || a.subdistrict || a.quarter) {
    parts.push(a.neighbourhood || a.suburb || a.subdistrict || a.quarter)
  }
  if (a.city_district || a.district || a.county) {
    parts.push(a.city_district || a.district || a.county)
  }
  if (a.city || a.province || a.state) {
    parts.push(a.city || a.province || a.state)
  }
  if (a.postcode) parts.push(a.postcode)
  if (parts.length === 0 && a.country) parts.push(a.country)

  if (parts.length > 0) {
    return parts.join(', ')
  }

  // Fallback to first 3 segments of display_name
  if (data.display_name) {
    return data.display_name.split(',').slice(0, 4).join(',').trim()
  }
  return ''
}

/**
 * Reverse geocode [lat, lng] into human-readable address with multi-layer caching.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = cacheKey(lat, lng)

  if (memoryCache.has(key)) {
    return memoryCache.get(key) || null
  }

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const cached = window.sessionStorage.getItem(`geo_addr_${key}`)
      if (cached) {
        memoryCache.set(key, cached)
        return cached
      }
    }

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'th,en;q=0.8' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const addr = formatAddress(data)

    if (addr) {
      memoryCache.set(key, addr)
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(`geo_addr_${key}`, addr)
        }
      } catch (_) {}
      return addr
    }
  } catch (err) {
    console.debug('reverseGeocode failed:', err)
  }
  return null
}

export interface PlaceSearchResult {
  label: string
  lat: number
  lng: number
}

/**
 * Search places or addresses or parse raw coordinates.
 */
export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  // Check if query is typed as "lat, lng"
  const coordMatch = /^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/.exec(q)
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1])
    const lng = parseFloat(coordMatch[2])
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [{ label: `Coordinate (${lat.toFixed(5)}, ${lng.toFixed(5)})`, lat, lng }]
    }
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=th&limit=5&addressdetails=1`,
      { headers: { 'Accept-Language': 'th,en;q=0.8' } }
    )
    if (!res.ok) return []
    const items = await res.json()
    return items.map((it: any) => ({
      label: formatAddress(it) || it.display_name.split(',').slice(0, 3).join(',').trim(),
      lat: parseFloat(it.lat),
      lng: parseFloat(it.lon),
    }))
  } catch (err) {
    console.debug('searchPlaces failed:', err)
    return []
  }
}

/**
 * Calculate distance in meters between two lat/lng points using the Haversine formula.
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return 0
  const R = 6371e3 // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

/**
 * Format distance in a human-friendly format (e.g. "450 m", "1.2 km").
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

/**
 * React Hook to get readable address from coordinates.
 */
export function useReverseAddress(lat?: number | null, lng?: number | null) {
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddress(null)
      return
    }

    let cancelled = false
    const key = cacheKey(lat, lng)
    if (memoryCache.has(key)) {
      setAddress(memoryCache.get(key) || null)
      return
    }

    setLoading(true)
    reverseGeocode(lat, lng)
      .then((addr) => {
        if (cancelled) return
        setAddress(addr)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [lat, lng])

  return { address, loading }
}
