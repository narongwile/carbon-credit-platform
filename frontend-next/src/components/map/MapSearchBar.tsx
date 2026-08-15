'use client'

import { useState, useRef, useEffect } from 'react'
import { searchPlaces, type PlaceSearchResult } from '@/lib/geoAddress'
import { Search, MapPin, Loader2, X } from 'lucide-react'

export default function MapSearchBar({
  onSelectPlace,
  placeholder = 'Search place, city or lat, lng…',
}: {
  onSelectPlace: (lat: number, lng: number, label: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([])
      setOpen(false)
      return
    }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const res = await searchPlaces(query)
      setResults(res)
      setOpen(res.length > 0)
      setLoading(false)
    }, 400)

    return () => clearTimeout(debounceRef.current)
  }, [query])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (r: PlaceSearchResult) => {
    onSelectPlace(r.lat, r.lng, r.label)
    setQuery(r.label)
    setOpen(false)
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative z-[1000] w-full max-w-sm">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs shadow-lg transition-all"
        style={{
          background: 'rgba(13, 17, 23, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #1e2433',
        }}
      >
        <Search size={13} className="text-slate-400 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-slate-200 placeholder-slate-500 outline-none text-xs"
        />
        {loading && <Loader2 size={12} className="animate-spin text-indigo-400 flex-shrink-0" />}
        {query && !loading && (
          <button onClick={handleClear} className="text-slate-500 hover:text-slate-300 p-0.5">
            <X size={12} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 rounded-lg overflow-hidden shadow-2xl z-[1001]"
          style={{
            background: '#0d1117',
            border: '1px solid #1e2433',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 text-xs flex items-start gap-2 hover:bg-slate-800/60 transition-colors border-b border-slate-800/40 last:border-0"
            >
              <MapPin size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-slate-200 font-medium truncate">{r.label}</div>
                <div className="text-[10px] text-slate-500">
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
