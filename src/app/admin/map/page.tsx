'use client'

import { useAppStore } from '@/lib/store'
import Link from 'next/link'
import { MapPin } from 'lucide-react'

export default function MapPage() {
  const { selectedOrgId, getTransformersByOrg } = useAppStore()
  const transformers = getTransformersByOrg(selectedOrgId)

  const statusColors: Record<string, string> = {
    NORMAL: '#4ade80',
    WARNING: '#fbbf24',
    CRITICAL: '#ef4444',
    OFFLINE: '#6b7280',
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Map View</h1>
        <p className="text-sm text-slate-500">Transformer locations and status overview</p>
      </div>

      {/* Simple grid map representation */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{ background: '#0d1117', border: '1px solid #1e2433', height: '400px' }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-slate-700 text-sm">Map integration (Leaflet/Google Maps) would render here</div>
        </div>
        {transformers.map((t, i) => {
          const x = 15 + (i % 3) * 30
          const y = 20 + Math.floor(i / 3) * 40
          return (
            <Link href={`/admin/transformers/${t.id}`} key={t.id}>
              <div
                className="absolute group cursor-pointer"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{
                    background: statusColors[t.status],
                    boxShadow: `0 0 12px ${statusColors[t.status]}`,
                    animation: t.status === 'CRITICAL' ? 'pulse 1s infinite' : 'none',
                  }}
                >
                  <MapPin size={10} className="text-white" />
                </div>
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  style={{ background: '#1e2433', border: '1px solid #374151' }}
                >
                  {t.name} — {t.status}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* List */}
      <div className="grid grid-cols-2 gap-3">
        {transformers.map((t) => (
          <Link key={t.id} href={`/admin/transformers/${t.id}`}>
            <div className="flex items-center gap-3 p-3 rounded-xl hover:border-indigo-500/30 transition-all cursor-pointer" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: statusColors[t.status], boxShadow: `0 0 6px ${statusColors[t.status]}` }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-medium">{t.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{t.location}</div>
              </div>
              <div className="text-[11px] font-bold" style={{ color: statusColors[t.status] }}>{t.status}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
