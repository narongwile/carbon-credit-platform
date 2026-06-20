'use client'

import { Suspense, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '@/lib/store'
import type { Transformer } from '@/types'

type Status = 'NORMAL' | 'WARNING' | 'CRITICAL'

interface ComponentInfo {
  id: string
  name: string
  description: string
  sensors: { label: string; getValue: () => string; getStatus: () => Status }[]
  getStatus: () => Status
}

function statusColor(s: Status, selected: boolean): string {
  if (selected) return '#818cf8'
  return s === 'CRITICAL' ? '#f87171' : s === 'WARNING' ? '#fcd34d' : '#94a3b8'
}

function emissiveColor(s: Status, selected: boolean, hovered: boolean): THREE.Color {
  if (selected) return new THREE.Color('#3730a3')
  if (hovered) return new THREE.Color(s === 'CRITICAL' ? '#7f1d1d' : s === 'WARNING' ? '#78350f' : '#1e293b')
  if (s === 'CRITICAL') return new THREE.Color('#450a0a')
  if (s === 'WARNING') return new THREE.Color('#451a03')
  return new THREE.Color('#000000')
}

// Animated mesh with status glow
function StatusMesh({
  geometry,
  getStatus,
  selected,
  hovered,
  metalness = 0.75,
  roughness = 0.25,
  baseColor,
}: {
  geometry: React.ReactNode
  getStatus: () => Status
  selected: boolean
  hovered: boolean
  metalness?: number
  roughness?: number
  baseColor?: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const pulseRef = useRef(0)

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as THREE.MeshStandardMaterial
    const s = getStatus()
    const target = emissiveColor(s, selected, hovered)
    mat.emissive.lerp(target, 0.12)

    if ((s === 'CRITICAL' || s === 'WARNING') && !selected) {
      pulseRef.current += delta * (s === 'CRITICAL' ? 3 : 1.8)
      const pulse = (Math.sin(pulseRef.current) * 0.5 + 0.5) * (s === 'CRITICAL' ? 0.35 : 0.18)
      mat.emissiveIntensity = pulse
    } else {
      mat.emissiveIntensity = selected ? 0.6 : 0
    }
    mat.color.lerp(new THREE.Color(baseColor ?? statusColor(s, selected)), 0.1)
  })

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {geometry}
      <meshStandardMaterial
        color={baseColor ?? statusColor(getStatus(), selected)}
        metalness={metalness}
        roughness={roughness}
        emissive={emissiveColor(getStatus(), selected, hovered)}
      />
    </mesh>
  )
}

// Interactive transformer part
function TransformerPart({
  id,
  info,
  position,
  rotation,
  children,
  selected,
  onSelect,
  labelOffset = [0, 0.6, 0],
}: {
  id: string
  info: ComponentInfo
  position: [number, number, number]
  rotation?: [number, number, number]
  children: React.ReactNode
  selected: string | null
  onSelect: (id: string | null) => void
  labelOffset?: [number, number, number]
}) {
  const [hovered, setHovered] = useState(false)
  const isSelected = selected === id

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onSelect(isSelected ? null : id)
      }}
      onPointerEnter={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerLeave={() => {
        setHovered(false)
        document.body.style.cursor = 'default'
      }}
    >
      {children}

      {/* Hover label */}
      {hovered && !isSelected && (
        <Html position={labelOffset} center zIndexRange={[50, 0]}>
          <div
            style={{
              background: 'rgba(13,17,23,0.92)',
              border: `1px solid ${
                info.getStatus() === 'CRITICAL' ? 'rgba(248,113,113,0.5)'
                : info.getStatus() === 'WARNING' ? 'rgba(252,211,77,0.5)'
                : 'rgba(99,102,241,0.4)'
              }`,
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'white',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            {info.name}
          </div>
        </Html>
      )}

      {/* Selected info panel */}
      {isSelected && <InfoPanel info={info} onClose={() => onSelect(null)} offset={labelOffset} />}
    </group>
  )
}

function InfoPanel({ info, onClose, offset }: { info: ComponentInfo; onClose: () => void; offset: [number, number, number] }) {
  const s = info.getStatus()
  const borderColor = s === 'CRITICAL' ? 'rgba(248,113,113,0.4)' : s === 'WARNING' ? 'rgba(252,211,77,0.4)' : 'rgba(99,102,241,0.35)'
  const statusColor = s === 'CRITICAL' ? '#f87171' : s === 'WARNING' ? '#fcd34d' : '#4ade80'
  const glowColor = s === 'CRITICAL' ? 'rgba(248,113,113,0.15)' : s === 'WARNING' ? 'rgba(252,211,77,0.12)' : 'rgba(99,102,241,0.12)'

  // Re-render every second to show live values
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <Html position={offset} center zIndexRange={[100, 0]} style={{ pointerEvents: 'auto' }}>
      <div
        style={{
          background: 'rgba(10,14,26,0.97)',
          border: `1px solid ${borderColor}`,
          borderRadius: '12px',
          padding: '14px 16px',
          width: '230px',
          backdropFilter: 'blur(16px)',
          boxShadow: `0 0 30px ${glowColor}, 0 8px 32px rgba(0,0,0,0.6)`,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'white', marginBottom: '3px' }}>
              {info.name}
            </div>
            <div
              style={{
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: statusColor,
                background: `${statusColor}18`,
                border: `1px solid ${statusColor}30`,
                borderRadius: '20px',
                padding: '1px 8px',
                display: 'inline-block',
              }}
            >
              {info.getStatus()}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            style={{
              color: '#64748b',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: '10px', color: '#64748b', marginBottom: '10px', lineHeight: '1.5' }}>
          {info.description}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {info.sensors.map((sensor) => {
            const sc = sensor.getStatus()
            const vc = sc === 'CRITICAL' ? '#f87171' : sc === 'WARNING' ? '#fcd34d' : '#4ade80'
            return (
              <div
                key={sensor.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '5px 8px',
                  background: `${vc}08`,
                  border: `1px solid ${vc}18`,
                  borderRadius: '6px',
                }}
              >
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>{sensor.label}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: vc, fontFamily: 'monospace' }}>
                  {sensor.getValue()}
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', fontSize: '9px', color: '#334155', textAlign: 'right' }}>
          LIVE · updated {new Date().toLocaleTimeString()}
        </div>
      </div>
    </Html>
  )
}

// Porcelain bushing with sheds
function Bushing({ x, y, z, radius = 0.07, height = 0.75, sheds = 5, getStatus, selected, onSelect, id, info }: {
  x: number; y: number; z: number; radius?: number; height?: number; sheds?: number
  getStatus: () => Status; selected: string | null; onSelect: (id: string | null) => void; id: string; info: ComponentInfo
}) {
  const [hovered, setHovered] = useState(false)
  const isSelected = selected === id

  return (
    <group
      position={[x, y, z]}
      onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : id) }}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      {/* Main porcelain body */}
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius * 1.15, height, 12]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.05} roughness={0.7} />
      </mesh>
      {/* Sheds */}
      {Array.from({ length: sheds }).map((_, i) => (
        <mesh key={i} position={[0, -height / 2 + (height / (sheds + 1)) * (i + 1), 0]} castShadow>
          <torusGeometry args={[radius * 1.8, radius * 0.22, 8, 16]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.1} roughness={0.6} />
        </mesh>
      ))}
      {/* Metal cap top */}
      <mesh position={[0, height / 2 + 0.03, 0]}>
        <cylinderGeometry args={[radius * 0.8, radius * 0.9, 0.06, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Metal base flange */}
      <mesh position={[0, -height / 2 - 0.03, 0]}>
        <cylinderGeometry args={[radius * 1.3, radius * 1.3, 0.05, 10]} />
        <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Conductor rod on top */}
      <mesh position={[0, height / 2 + 0.15, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.25, 6]} />
        <meshStandardMaterial color="#ca8a04" metalness={0.95} roughness={0.05} />
      </mesh>

      {hovered && !isSelected && (
        <Html position={[0, height / 2 + 0.5, 0]} center zIndexRange={[50, 0]}>
          <div style={{ background: 'rgba(13,17,23,0.92)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '6px', padding: '4px 10px', fontSize: '10px', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {info.name}
          </div>
        </Html>
      )}
      {isSelected && <InfoPanel info={info} onClose={() => onSelect(null)} offset={[0, height / 2 + 0.6, 0]} />}
    </group>
  )
}

// Cooling radiator bank
function RadiatorBank({ x, count, height, getStatus, selected, onSelect, id, info }: {
  x: number; count: number; height: number
  getStatus: () => Status; selected: string | null; onSelect: (id: string | null) => void; id: string; info: ComponentInfo
}) {
  const [hovered, setHovered] = useState(false)
  const isSelected = selected === id

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : id) }}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      {/* Top header pipe */}
      <mesh position={[x > 0 ? x + (count - 1) * 0.14 / 2 : x - (count - 1) * 0.14 / 2, height / 2 + 0.08, 0]}>
        <boxGeometry args={[count * 0.14 + 0.05, 0.06, 0.1]} />
        <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Bottom header pipe */}
      <mesh position={[x > 0 ? x + (count - 1) * 0.14 / 2 : x - (count - 1) * 0.14 / 2, -height / 2 - 0.08, 0]}>
        <boxGeometry args={[count * 0.14 + 0.05, 0.06, 0.1]} />
        <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Fins */}
      {Array.from({ length: count }).map((_, i) => {
        const finX = x > 0 ? x + i * 0.14 : x - i * 0.14
        return (
          <mesh key={i} position={[finX, 0, 0]} castShadow>
            <boxGeometry args={[0.05, height, 0.85]} />
            <meshStandardMaterial
              color={isSelected ? '#818cf8' : hovered ? '#475569' : '#334155'}
              metalness={0.85}
              roughness={0.2}
            />
          </mesh>
        )
      })}

      {hovered && !isSelected && (
        <Html position={[x > 0 ? x + (count - 1) * 0.14 / 2 + 0.3 : x - (count - 1) * 0.14 / 2 - 0.3, 0.5, 0]} center zIndexRange={[50, 0]}>
          <div style={{ background: 'rgba(13,17,23,0.92)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '6px', padding: '4px 10px', fontSize: '10px', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {info.name}
          </div>
        </Html>
      )}
      {isSelected && <InfoPanel info={info} onClose={() => onSelect(null)} offset={[x > 0 ? x + (count - 1) * 0.14 / 2 + 0.4 : x - (count - 1) * 0.14 / 2 - 0.4, 0.6, 0]} />}
    </group>
  )
}

function TransformerScene({ transformerId, selected, setSelected }: {
  transformerId: string; selected: string | null; setSelected: (id: string | null) => void
}) {
  // Subscribe directly to store so component re-renders with live values
  const transformer = useAppStore((state) => state.transformers.find((t) => t.id === transformerId))

  if (!transformer) return null

  const s = transformer.sensors

  const components: Record<string, ComponentInfo> = {
    'main-tank': {
      id: 'main-tank',
      name: 'Main Tank',
      description: 'Primary tank housing core, windings & insulating oil. Contains the magnetic circuit with HV and LV windings immersed in mineral oil.',
      getStatus: () => s.oilTemperature.status,
      sensors: [
        { label: 'Oil Temperature', getValue: () => `${s.oilTemperature.value.toFixed(1)} °C`, getStatus: () => s.oilTemperature.status },
        { label: 'Oil Level', getValue: () => `${s.oilLevel.value.toFixed(1)} %`, getStatus: () => s.oilLevel.status },
      ],
    },
    'hv-bushing': {
      id: 'hv-bushing',
      name: 'HV Bushings (3-phase)',
      description: 'High-voltage porcelain bushings for 3-phase HV conductors. Graded insulation design rated at primary voltage.',
      getStatus: () => s.load.status,
      sensors: [
        { label: 'Load', getValue: () => `${s.load.value.toFixed(1)} %`, getStatus: () => s.load.status },
        { label: 'HV Side', getValue: () => transformer.voltage.split('/')[0] ?? 'N/A', getStatus: () => 'NORMAL' },
      ],
    },
    'lv-bushing': {
      id: 'lv-bushing',
      name: 'LV Bushings (3-phase)',
      description: 'Low-voltage bushings for secondary winding. Higher current capacity, rated at secondary voltage.',
      getStatus: () => 'NORMAL',
      sensors: [
        { label: 'LV Side', getValue: () => transformer.voltage.split('/')[1] ?? '0.4kV', getStatus: () => 'NORMAL' },
        { label: 'Current', getValue: () => `${(s.load.value * 12).toFixed(0)} A`, getStatus: () => s.load.status },
      ],
    },
    'conservator': {
      id: 'conservator',
      name: 'Conservator Tank',
      description: 'Sealed expansion vessel for thermal oil volume changes. Breather with silica gel prevents moisture ingress.',
      getStatus: () => s.oilLevel.status,
      sensors: [
        { label: 'Oil Level', getValue: () => `${s.oilLevel.value.toFixed(1)} %`, getStatus: () => s.oilLevel.status },
        { label: 'Moisture', getValue: () => `${s.moisture.value.toFixed(1)} ppm`, getStatus: () => s.moisture.status },
      ],
    },
    'buchholz': {
      id: 'buchholz',
      name: 'Buchholz Relay',
      description: 'Gas-actuated protective relay. Detects internal faults by monitoring dissolved gas accumulation and sudden oil surge.',
      getStatus: () => s.hydrogen.status,
      sensors: [
        { label: 'Hydrogen H₂', getValue: () => `${s.hydrogen.value.toFixed(0)} ppm`, getStatus: () => s.hydrogen.status },
        { label: 'Gas Status', getValue: () => s.hydrogen.value > 200 ? '⚠ HIGH' : s.hydrogen.value > 150 ? 'ELEVATED' : 'NORMAL', getStatus: () => s.hydrogen.status },
      ],
    },
    'radiators': {
      id: 'radiators',
      name: 'Cooling Radiators (ONAN)',
      description: 'Natural oil/natural air cooling radiators. Oil circulates by thermal siphon; heat dissipated to ambient through fin surface area.',
      getStatus: () => s.oilTemperature.status,
      sensors: [
        { label: 'Oil Temp', getValue: () => `${s.oilTemperature.value.toFixed(1)} °C`, getStatus: () => s.oilTemperature.status },
        { label: 'Ambient', getValue: () => `${s.ambientTemperature.value.toFixed(1)} °C`, getStatus: () => s.ambientTemperature.status },
        { label: 'ΔT', getValue: () => `${(s.oilTemperature.value - s.ambientTemperature.value).toFixed(1)} °C`, getStatus: () => s.oilTemperature.status },
      ],
    },
    'tap-changer': {
      id: 'tap-changer',
      name: 'On-Load Tap Changer',
      description: 'Voltage regulation mechanism adjusting turns ratio under load. Motorized drive with position indicator.',
      getStatus: () => 'NORMAL',
      sensors: [
        { label: 'Tap Position', getValue: () => 'Tap 7 / 17', getStatus: () => 'NORMAL' },
        { label: 'Operations', getValue: () => '1,247 total', getStatus: () => 'NORMAL' },
        { label: 'Oil Temp', getValue: () => `${(s.oilTemperature.value + 1.5).toFixed(1)} °C`, getStatus: () => s.oilTemperature.status },
      ],
    },
    'control-cabinet': {
      id: 'control-cabinet',
      name: 'Control & Protection Panel',
      description: 'Marshalling box with protection relays (Buchholz, OTI, WTI), terminal blocks, RTU, and communications.',
      getStatus: () => 'NORMAL',
      sensors: [
        { label: 'Protection', getValue: () => 'ACTIVE', getStatus: () => 'NORMAL' },
        { label: 'RTU Link', getValue: () => 'ONLINE', getStatus: () => 'NORMAL' },
        { label: 'Last Sync', getValue: () => '< 2s', getStatus: () => 'NORMAL' },
      ],
    },
  }

  return (
    <group rotation={[0, -Math.PI / 7, 0]}>
      {/* Foundation / oil containment bund */}
      <mesh position={[0, -1.6, 0]} receiveShadow>
        <boxGeometry args={[4.2, 0.12, 3.0]} />
        <meshStandardMaterial color="#0f172a" metalness={0.3} roughness={0.9} />
      </mesh>
      <mesh position={[0, -1.53, 0]} receiveShadow>
        <boxGeometry args={[4.0, 0.04, 2.8]} />
        <meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.95} />
      </mesh>

      {/* ===== MAIN TANK ===== */}
      <TransformerPart
        id="main-tank"
        info={components['main-tank']}
        position={[0, -0.15, 0]}
        selected={selected}
        onSelect={setSelected}
        labelOffset={[0, 1.2, 0.75]}
      >
        {/* Tank body */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.85, 2.3, 1.45]} />
          <meshStandardMaterial
            color={selected === 'main-tank' ? '#818cf8' : '#374151'}
            metalness={0.8}
            roughness={0.25}
          />
        </mesh>
        {/* Vertical weld seam lines */}
        {[-0.9, 0, 0.9].map((x) => (
          <mesh key={x} position={[x, 0, 0.725]} castShadow>
            <boxGeometry args={[0.015, 2.3, 0.01]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        {/* Side ribs */}
        {[-0.8, -0.4, 0, 0.4, 0.8].map((y) => (
          <mesh key={y} position={[0, y, 0.73]} castShadow>
            <boxGeometry args={[1.85, 0.04, 0.02]} />
            <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
        {/* Nameplate */}
        <mesh position={[0, -0.5, 0.74]}>
          <boxGeometry args={[0.45, 0.25, 0.005]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.2} roughness={0.8} />
        </mesh>
      </TransformerPart>

      {/* ===== COOLING RADIATORS - LEFT ===== */}
      <RadiatorBank
        x={-1.3}
        count={7}
        height={1.9}
        getStatus={() => components['radiators'].getStatus()}
        selected={selected}
        onSelect={setSelected}
        id="radiators"
        info={components['radiators']}
      />

      {/* ===== COOLING RADIATORS - RIGHT (decorative, click goes to same) ===== */}
      <group>
        {/* Top pipe */}
        <mesh position={[1.73, 0.98, 0]}>
          <boxGeometry args={[0.99, 0.06, 0.1]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Bottom pipe */}
        <mesh position={[1.73, -1.04, 0]}>
          <boxGeometry args={[0.99, 0.06, 0.1]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[1.24 + i * 0.14, 0, 0]} castShadow>
            <boxGeometry args={[0.05, 1.9, 0.85]} />
            <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* ===== HV BUSHINGS (left side, 3 phase) ===== */}
      {[-0.5, 0, 0.5].map((z, i) => (
        <Bushing
          key={`hv-${i}`}
          id="hv-bushing"
          info={components['hv-bushing']}
          x={-0.5}
          y={1.15}
          z={z}
          radius={0.075}
          height={0.9}
          sheds={5}
          getStatus={() => components['hv-bushing'].getStatus()}
          selected={selected}
          onSelect={setSelected}
        />
      ))}
      {/* HV connection bar */}
      <mesh position={[-0.5, 1.2, 0]}>
        <boxGeometry args={[0.04, 0.04, 1.2]} />
        <meshStandardMaterial color="#ca8a04" metalness={0.95} roughness={0.05} />
      </mesh>

      {/* ===== LV BUSHINGS (right side, 3 phase) ===== */}
      {[-0.45, 0, 0.45].map((z, i) => (
        <Bushing
          key={`lv-${i}`}
          id="lv-bushing"
          info={components['lv-bushing']}
          x={0.55}
          y={0.95}
          z={z}
          radius={0.058}
          height={0.65}
          sheds={3}
          getStatus={() => components['lv-bushing'].getStatus()}
          selected={selected}
          onSelect={setSelected}
        />
      ))}

      {/* ===== CONSERVATOR PIPE ===== */}
      <mesh position={[0, 1.22, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.4, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.85} roughness={0.25} />
      </mesh>

      {/* ===== CONSERVATOR TANK (horizontal) ===== */}
      <TransformerPart
        id="conservator"
        info={components['conservator']}
        position={[0, 1.4, 0.55]}
        rotation={[Math.PI / 2, 0, 0]}
        selected={selected}
        onSelect={setSelected}
        labelOffset={[0, 0.35, 0]}
      >
        <mesh castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.75, 16]} />
          <meshStandardMaterial
            color={selected === 'conservator' ? '#818cf8' : '#475569'}
            metalness={0.75}
            roughness={0.3}
          />
        </mesh>
        {/* End caps */}
        {[-0.38, 0.38].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
          </mesh>
        ))}
        {/* Breather pipe */}
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.15, 6]} />
          <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Sight glass */}
        <mesh position={[0.21, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, 0.2, 8]} />
          <meshStandardMaterial color="#7dd3fc" metalness={0.1} roughness={0.1} transparent opacity={0.7} />
        </mesh>
      </TransformerPart>

      {/* ===== BUCHHOLZ RELAY ===== */}
      <TransformerPart
        id="buchholz"
        info={components['buchholz']}
        position={[0, 1.22, 0.1]}
        selected={selected}
        onSelect={setSelected}
        labelOffset={[0.3, 0.3, 0]}
      >
        <mesh castShadow>
          <cylinderGeometry args={[0.095, 0.095, 0.2, 12]} />
          <meshStandardMaterial
            color={selected === 'buchholz' ? '#818cf8' : '#64748b'}
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
        {/* Test valve */}
        <mesh position={[0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.08, 6]} />
          <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
        </mesh>
      </TransformerPart>

      {/* ===== TAP CHANGER ===== */}
      <TransformerPart
        id="tap-changer"
        info={components['tap-changer']}
        position={[0.97, 0.25, 0]}
        selected={selected}
        onSelect={setSelected}
        labelOffset={[0.35, 0.6, 0]}
      >
        {/* Body */}
        <mesh castShadow>
          <boxGeometry args={[0.13, 0.95, 0.65]} />
          <meshStandardMaterial
            color={selected === 'tap-changer' ? '#818cf8' : '#4b5563'}
            metalness={0.75}
            roughness={0.3}
          />
        </mesh>
        {/* Motor drive box */}
        <mesh position={[0.08, 0.3, 0]}>
          <boxGeometry args={[0.06, 0.22, 0.22]} />
          <meshStandardMaterial color="#374151" metalness={0.7} roughness={0.35} />
        </mesh>
        {/* Position indicator window */}
        <mesh position={[0.08, 0.3, 0.12]}>
          <boxGeometry args={[0.02, 0.1, 0.08]} />
          <meshStandardMaterial color="#fef3c7" metalness={0} roughness={0.5} emissive="#fbbf24" emissiveIntensity={0.3} />
        </mesh>
      </TransformerPart>

      {/* ===== CONTROL CABINET ===== */}
      <TransformerPart
        id="control-cabinet"
        info={components['control-cabinet']}
        position={[-0.6, -1.05, 0.85]}
        selected={selected}
        onSelect={setSelected}
        labelOffset={[0, 0.55, 0.1]}
      >
        <mesh castShadow>
          <boxGeometry args={[0.8, 0.6, 0.12]} />
          <meshStandardMaterial
            color={selected === 'control-cabinet' ? '#818cf8' : '#1e3a5f'}
            metalness={0.5}
            roughness={0.6}
          />
        </mesh>
        {/* Door handle */}
        <mesh position={[0.05, 0, 0.065]}>
          <boxGeometry args={[0.03, 0.12, 0.015]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Status LED */}
        <mesh position={[-0.3, 0.22, 0.065]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshStandardMaterial color="#4ade80" emissive="#4ade80" emissiveIntensity={1.5} metalness={0} roughness={0} />
        </mesh>
        {/* Panel cutouts */}
        {[-0.15, 0, 0.15].map((x) => (
          <mesh key={x} position={[x, -0.1, 0.065]}>
            <boxGeometry args={[0.08, 0.08, 0.01]} />
            <meshStandardMaterial color="#0f172a" metalness={0.3} roughness={0.8} />
          </mesh>
        ))}
      </TransformerPart>

      {/* ===== OIL DRAIN VALVE ===== */}
      <mesh position={[0.3, -1.38, 0.55]}>
        <cylinderGeometry args={[0.045, 0.045, 0.22, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0.3, -1.38, 0.68]}>
        <boxGeometry args={[0.1, 0.06, 0.04]} />
        <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.3} />
      </mesh>

      {/* ===== OIL THERMOMETER ===== */}
      <mesh position={[0, -0.3, 0.74]}>
        <cylinderGeometry args={[0.03, 0.03, 0.1, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[0, -0.3, 0.79]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.1} roughness={0.3} transparent opacity={0.8} />
      </mesh>

      {/* ===== GROUND STRAPS ===== */}
      {[[-0.75, -0.75], [0.75, -0.75]].map(([x, z], i) => (
        <group key={i} position={[x, -1.15, z]}>
          <mesh rotation={[0.15, 0, 0]}>
            <boxGeometry args={[0.025, 0.55, 0.008]} />
            <meshStandardMaterial color="#ca8a04" metalness={0.95} roughness={0.08} />
          </mesh>
          <mesh position={[0, -0.31, 0]}>
            <boxGeometry args={[0.14, 0.04, 0.14]} />
            <meshStandardMaterial color="#ca8a04" metalness={0.95} roughness={0.08} />
          </mesh>
        </group>
      ))}

      {/* ===== SURGE ARRESTERS (on HV side) ===== */}
      {[-0.5, 0, 0.5].map((z, i) => (
        <group key={i} position={[-0.95, 0.7, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
            <meshStandardMaterial color="#dc2626" metalness={0.3} roughness={0.6} />
          </mesh>
          {[0.15, 0, -0.15].map((dy, j) => (
            <mesh key={j} position={[0, dy, 0]}>
              <torusGeometry args={[0.055, 0.01, 6, 12]} />
              <meshStandardMaterial color="#b91c1c" metalness={0.4} roughness={0.5} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

export default function Transformer3D({ transformer }: { transformer: Transformer }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)

  // Pause rotation when component selected
  useEffect(() => {
    if (selected) setAutoRotate(false)
    else setTimeout(() => setAutoRotate(true), 3000)
  }, [selected])

  return (
    <div className="w-full h-full relative">
      <Canvas
        shadows
        camera={{ position: [5, 3.5, 6], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ background: 'transparent' }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.35} color="#c7d2fe" />
        <directionalLight
          position={[6, 10, 6]}
          intensity={1.4}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={20}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          color="#ffffff"
        />
        <directionalLight position={[-4, 4, -4]} intensity={0.5} color="#6366f1" />
        <pointLight position={[0, 5, 0]} intensity={0.8} color="#a78bfa" distance={12} />
        <pointLight position={[3, -1, 3]} intensity={0.4} color="#06b6d4" distance={10} />
        <pointLight position={[-3, 2, -2]} intensity={0.3} color="#4ade80" distance={8} />

        <Suspense fallback={null}>
          <TransformerScene
            transformerId={transformer.id}
            selected={selected}
            setSelected={setSelected}
          />
          <ContactShadows position={[0, -1.6, 0]} opacity={0.4} scale={8} blur={2} far={4} />
          <Environment preset="city" />
        </Suspense>

        <OrbitControls
          enablePan={false}
          minDistance={3.5}
          maxDistance={14}
          maxPolarAngle={Math.PI / 1.75}
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      {/* Overlay hints */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs text-slate-500">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span>Click any component to inspect</span>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-3 text-xs text-slate-600">
        <span>Drag · Scroll · Click</span>
      </div>

      {/* Component legend */}
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        {[
          { color: '#4ade80', label: 'Normal' },
          { color: '#fcd34d', label: 'Warning' },
          { color: '#f87171', label: 'Critical' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
            <span style={{ fontSize: '9px', color: '#64748b' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Selected component indicator */}
      {selected && (
        <div className="absolute top-3 left-3 flex items-center gap-2 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span className="text-indigo-300">Inspecting component</span>
          <button
            onClick={() => setSelected(null)}
            className="text-slate-500 hover:text-white transition-colors ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
