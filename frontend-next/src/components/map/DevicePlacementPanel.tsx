'use client'

// ---------------------------------------------------------------------------
// The trigger + side panel for setting device positions on the Live Sensor Map.
// ---------------------------------------------------------------------------
// All the state and the actual save calls live in usePlacementSession — this
// is deliberately just the UI around it, so the host page can also render the
// "you are placing X" banner and wire the map's pick mode without duplicating
// any logic.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import type { usePlacementSession } from '@/lib/usePlacementSession'
import { DOMAIN_META } from '@/types/fleet'
import { MapPin, X, Crosshair, Layers, CheckSquare, Square } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function DevicePlacementPanel({
  placement, open, onOpenChange,
}: {
  placement: ReturnType<typeof usePlacementSession>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { devices, unplaced, session } = placement

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const selectUnplaced = () => setSelected(new Set(unplaced.map((d) => d.id)))
  const clearSelection = () => setSelected(new Set())

  const selectedIds = useMemo(() => devices.filter((d) => selected.has(d.id)).map((d) => d.id), [devices, selected])

  const statusOf = (d: (typeof devices)[number]) =>
    d.lat == null || d.lng == null ? { label: 'Not located', color: '#f87171' }
      : d.approx ? { label: 'Approximate', color: '#fbbf24' }
        : { label: 'Located', color: '#4ade80' }

  if (!open) {
    return (
      <button onClick={() => onOpenChange(true)} disabled={!!session}
        className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-white shadow-lg disabled:opacity-50"
        style={gradient} title="Set device positions on the map">
        <MapPin size={13} /> Set device positions
        {unplaced.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.25)' }}>{unplaced.length} unlocated</span>
        )}
      </button>
    )
  }

  return (
    <div className="absolute top-3 left-3 z-[1000] w-[300px] max-h-[calc(100%-24px)] rounded-xl shadow-2xl flex flex-col" style={surface}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #1e2433' }}>
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><MapPin size={14} className="text-indigo-400" /> Device positions</h3>
        <button onClick={() => onOpenChange(false)} className="p-1 rounded text-slate-400 hover:text-white"><X size={15} /></button>
      </div>

      <p className="px-4 pt-3 text-[11px] text-slate-500">
        No Floor Plans on this organization — this is how a device gets a real position. Select devices, then click
        the map to place them.
      </p>

      <div className="px-4 pt-2.5 flex items-center gap-2">
        <button onClick={selectUnplaced} disabled={!unplaced.length}
          className="text-[10px] px-2 py-1 rounded-md text-amber-300 disabled:opacity-40" style={inset}>
          Select unlocated ({unplaced.length})
        </button>
        <button onClick={clearSelection} disabled={!selected.size} className="text-[10px] px-2 py-1 rounded-md text-slate-400 disabled:opacity-40" style={inset}>
          Clear
        </button>
        <span className="ml-auto text-[10px] text-slate-600">{selected.size} selected</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {devices.length === 0 && <p className="text-[11px] text-slate-600 py-4 text-center">No devices in this organization.</p>}
        {devices.map((d) => {
          const st = statusOf(d)
          const meta = DOMAIN_META[d.domain]
          const on = selected.has(d.id)
          return (
            <button key={d.id} onClick={() => toggle(d.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
              style={on ? { background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' } : inset}>
              {on ? <CheckSquare size={13} className="text-indigo-400 shrink-0" /> : <Square size={13} className="text-slate-600 shrink-0" />}
              <span className="text-xs text-white truncate flex-1 min-w-0">{d.name}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span>
              <span className="text-[9px] shrink-0" style={{ color: st.color }} title={st.label}>●</span>
            </button>
          )
        })}
      </div>

      <div className="p-3 space-y-2" style={{ borderTop: '1px solid #1e2433' }}>
        <button onClick={() => { placement.start(selectedIds, 'sequential'); onOpenChange(false) }} disabled={!selectedIds.length}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={gradient}>
          <Crosshair size={13} /> Place one by one ({selectedIds.length})
        </button>
        <button onClick={() => { placement.start(selectedIds, 'same-point'); onOpenChange(false) }} disabled={!selectedIds.length}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-slate-300 disabled:opacity-40" style={inset}
          title="One click sets the same coordinate for every device selected — for a cluster physically at one spot.">
          <Layers size={13} /> Set one point for all
        </button>
      </div>
    </div>
  )
}
