'use client'

import { useState, useEffect } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'

export type Status = 'NORMAL' | 'WARNING' | 'CRITICAL'

export interface InfoRow { label: string; value: string; status?: Status }
export interface PartInfo {
  id: string
  name: string
  status: Status
  description: string
  rows: InfoRow[]
}

export function statusBase(s: Status, selected: boolean): string {
  if (selected) return '#818cf8'
  return s === 'CRITICAL' ? '#f87171' : s === 'WARNING' ? '#fcd34d' : '#94a3b8'
}

const sColor = (s: Status) => (s === 'CRITICAL' ? '#f87171' : s === 'WARNING' ? '#fcd34d' : '#4ade80')

// Shared component lighting (matches the transformer twin)
export function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.35} color="#c7d2fe" />
      <directionalLight position={[6, 10, 6]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} color="#ffffff" />
      <directionalLight position={[-4, 4, -4]} intensity={0.5} color="#6366f1" />
      <pointLight position={[0, 5, 0]} intensity={0.8} color="#a78bfa" distance={12} />
      <pointLight position={[3, -1, 3]} intensity={0.4} color="#06b6d4" distance={10} />
    </>
  )
}

function InfoPanel({ info, onClose, offset }: { info: PartInfo; onClose: () => void; offset: [number, number, number] }) {
  const sc = sColor(info.status)
  const [, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id) }, [])
  return (
    <Html position={offset} center zIndexRange={[100, 0]} style={{ pointerEvents: 'auto' }}>
      <div style={{ background: 'rgba(10,14,26,0.97)', border: `1px solid ${sc}40`, borderRadius: 12, padding: '14px 16px', width: 230, backdropFilter: 'blur(16px)', boxShadow: `0 0 30px ${sc}22, 0 8px 32px rgba(0,0,0,0.6)` }}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'white', marginBottom: 3 }}>{info.name}</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: sc, background: `${sc}18`, border: `1px solid ${sc}30`, borderRadius: 20, padding: '1px 8px', display: 'inline-block' }}>{info.status}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onClose() }} style={{ color: '#64748b', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 10, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>{info.description}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {info.rows.map((r) => {
            const vc = sColor(r.status ?? 'NORMAL')
            return (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: `${vc}08`, border: `1px solid ${vc}18`, borderRadius: 6 }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{r.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: vc, fontFamily: 'monospace' }}>{r.value}</span>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6, fontSize: 9, color: '#334155', textAlign: 'right' }}>LIVE · {new Date().toLocaleTimeString()}</div>
      </div>
    </Html>
  )
}

// Interactive, status-aware part group. Children are the meshes.
export function Part({ info, position, rotation, children, selected, onSelect, labelOffset = [0, 0.6, 0] }: {
  info: PartInfo
  position: [number, number, number]
  rotation?: [number, number, number]
  children: React.ReactNode
  selected: string | null
  onSelect: (id: string | null) => void
  labelOffset?: [number, number, number]
}) {
  const [hovered, setHovered] = useState(false)
  const isSelected = selected === info.id
  return (
    <group position={position} rotation={rotation}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(isSelected ? null : info.id) }}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}>
      {children}
      {hovered && !isSelected && (
        <Html position={labelOffset} center zIndexRange={[50, 0]}>
          <div style={{ background: 'rgba(13,17,23,0.92)', border: `1px solid ${sColor(info.status)}80`, borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{info.name}</div>
        </Html>
      )}
      {isSelected && <InfoPanel info={info} onClose={() => onSelect(null)} offset={labelOffset} />}
    </group>
  )
}

// HTML overlay (legend + hints + selected indicator) — rendered outside the Canvas.
export function TwinOverlay({ selected, onClear }: { selected: string | null; onClear: () => void }) {
  return (
    <>
      <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs text-slate-500">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span>Click any component to inspect</span>
      </div>
      <div className="absolute bottom-3 right-3 text-xs text-slate-600"><span>Drag · Scroll · Click</span></div>
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        {[{ color: '#4ade80', label: 'Normal' }, { color: '#fcd34d', label: 'Warning' }, { color: '#f87171', label: 'Critical' }].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
            <span style={{ fontSize: 9, color: '#64748b' }}>{label}</span>
          </div>
        ))}
      </div>
      {selected && (
        <div className="absolute top-3 left-3 flex items-center gap-2 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span className="text-indigo-300">Inspecting component</span>
          <button onClick={onClear} className="text-slate-500 hover:text-white transition-colors ml-1">✕</button>
        </div>
      )}
    </>
  )
}
