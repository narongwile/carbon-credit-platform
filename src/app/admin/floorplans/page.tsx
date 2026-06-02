'use client'

import { useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { managedDevicesFromFleet, getSitesByOrg } from '@/lib/fleetData'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import { Upload, MapPin, Save, Image as ImageIcon, Crosshair, Check } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Floor { id: string; buildingCode: string; name: string }
const FLOORS: Floor[] = [
  { id: 'fl-1', buildingCode: 'BLD-A', name: 'Building A · Floor 1' },
  { id: 'fl-2', buildingCode: 'BLD-A', name: 'Building A · Floor 2' },
  { id: 'fl-b1', buildingCode: 'BLD-A', name: 'Building A · B1' },
]

type Pos = { x: number; y: number }

export default function FloorPlansPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const nodes = managedDevicesFromFleet(orgId)
  const sites = getSitesByOrg(orgId)
  const fileRef = useRef<HTMLInputElement>(null)

  const [activeFloor, setActiveFloor] = useState(FLOORS[0].id)
  const [images, setImages] = useState<Record<string, string>>({})
  // positions[floorId][nodeId] = {x%, y%}
  const [positions, setPositions] = useState<Record<string, Record<string, Pos>>>({})
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const img = images[activeFloor]
  const floorPos = positions[activeFloor] ?? {}

  const onUpload = (file?: File) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImages((m) => ({ ...m, [activeFloor]: url }))
  }

  const placeAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedNode || !img) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPositions((p) => ({ ...p, [activeFloor]: { ...(p[activeFloor] ?? {}), [selectedNode]: { x, y } } }))
    setSelectedNode(null)
  }

  const placed = nodes.filter((n) => floorPos[n.id])
  const save = async () => { await new Promise((r) => setTimeout(r, 300)); setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Floor Plans</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload a floor plan and place each sensor node (BloodBOX, Refrigeration, Transformer) to visualize its indoor location</p>
        </div>
        <button onClick={save} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
          <Save size={15} /> {saved ? 'Saved!' : 'Save Layout'}
        </button>
      </div>

      {/* Floor selector + upload */}
      <div className="flex flex-wrap items-center gap-2">
        {FLOORS.map((f) => (
          <button key={f.id} onClick={() => setActiveFloor(f.id)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all', activeFloor === f.id ? 'text-white' : 'text-slate-500')}
            style={activeFloor === f.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
            {f.name}{images[f.id] ? ' ✓' : ''}
          </button>
        ))}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <Upload size={15} /> Upload Floor Plan
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Floor plan canvas */}
        <div className="lg:col-span-3">
          <div onClick={placeAt}
            className={clsx('relative rounded-xl overflow-hidden select-none', selectedNode && img ? 'cursor-crosshair' : '')}
            style={{ ...surface, height: '62vh' }}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="floor plan" className="w-full h-full object-contain pointer-events-none" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                <ImageIcon size={48} className="mb-3 opacity-40" />
                <p className="text-sm">No floor plan for this floor yet</p>
                <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">Upload an image</button>
              </div>
            )}

            {/* Node markers */}
            {img && nodes.map((n) => {
              const pos = floorPos[n.id]
              if (!pos) return null
              const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
              return (
                <div key={n.id} className="absolute -translate-x-1/2 -translate-y-1/2 group" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(n.id) }}>
                  <MapPin size={26} style={{ color: accent }} fill={accent} className="drop-shadow" />
                  <span className="absolute left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded text-white" style={{ background: '#0a0e1a' }}>{n.name}</span>
                </div>
              )
            })}

            {selectedNode && img && (
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white" style={{ background: 'rgba(99,102,241,0.9)' }}>
                <Crosshair size={13} /> Click on the plan to place “{nodes.find((n) => n.id === selectedNode)?.name}”
              </div>
            )}
          </div>
        </div>

        {/* Node list */}
        <div className="rounded-xl p-4 space-y-2" style={surface}>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Sensor Nodes ({placed.length}/{nodes.length} placed)</div>
          {nodes.map((n) => {
            const accent = n.domain ? DOMAIN_META[n.domain].accent : '#6366f1'
            const isPlaced = !!floorPos[n.id]
            return (
              <button key={n.id} onClick={() => setSelectedNode(n.id)}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all"
                style={{ background: '#0a0e1a', border: `1px solid ${selectedNode === n.id ? '#6366f1' : '#1e2433'}` }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accent }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{n.name}</div>
                  <div className="text-[10px]" style={{ color: accent }}>{n.domain ? DOMAIN_META[n.domain].platform : n.deviceType}</div>
                </div>
                {isPlaced ? <Check size={14} className="text-green-400" /> : <MapPin size={13} className="text-slate-600" />}
              </button>
            )
          })}
          {!img && <p className="text-[11px] text-slate-600 pt-1">Upload a floor plan first, then click a node and click on the plan to place it.</p>}
        </div>
      </div>
    </div>
  )
}
