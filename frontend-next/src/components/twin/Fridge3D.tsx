'use client'

import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { Part, SceneLights, TwinOverlay, type Status } from './parts'

export interface FridgeDevice { name: string; temperature: number; doorOpen: boolean; threshold: number }

function FridgeScene({ device, selected, setSelected }: { device: FridgeDevice; selected: string | null; setSelected: (id: string | null) => void }) {
  const { temperature: t, doorOpen, threshold } = device
  const tempStatus: Status = t > threshold + 2 ? 'CRITICAL' : t > threshold ? 'WARNING' : 'NORMAL'
  const cabinetStatus: Status = doorOpen ? 'CRITICAL' : tempStatus
  const doorStatus: Status = doorOpen ? 'CRITICAL' : 'NORMAL'
  const panelColor = cabinetStatus === 'CRITICAL' ? '#f87171' : cabinetStatus === 'WARNING' ? '#fcd34d' : '#4ade80'

  return (
    <group rotation={[0, -Math.PI / 7, 0]}>
      {/* Floor pad */}
      <mesh position={[0, -1.32, 0]} receiveShadow><boxGeometry args={[2.4, 0.08, 2]} /><meshStandardMaterial color="#0f172a" metalness={0.3} roughness={0.9} /></mesh>

      {/* ===== CABINET BODY ===== */}
      <Part info={{ id: 'cabinet', name: 'Refrigeration Cabinet', status: cabinetStatus, description: 'Insulated cold-chain cabinet maintaining set-point temperature for stored goods.', rows: [{ label: 'Temperature', value: `${t.toFixed(1)} °C`, status: tempStatus }, { label: 'Set Limit', value: `${threshold} °C` }, { label: 'Door', value: doorOpen ? 'OPEN' : 'Closed', status: doorStatus }] }}
        position={[0, -0.1, 0]} selected={selected} onSelect={setSelected} labelOffset={[0, 1.35, 0.6]}>
        <mesh castShadow receiveShadow><boxGeometry args={[1.25, 2.05, 1.05]} /><meshStandardMaterial color={selected === 'cabinet' ? '#818cf8' : '#cbd5e1'} metalness={0.6} roughness={0.35} /></mesh>
        {/* interior cavity */}
        <mesh position={[0, 0, 0.1]}><boxGeometry args={[1.05, 1.85, 0.9]} /><meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.8} /></mesh>
        {/* shelves */}
        {[-0.6, -0.1, 0.4, 0.85].map((y) => (
          <mesh key={y} position={[0, y, 0.15]}><boxGeometry args={[1.0, 0.03, 0.8]} /><meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} transparent opacity={0.85} /></mesh>
        ))}
      </Part>

      {/* ===== DOOR (hinged, swings open when doorOpen) ===== */}
      <group position={[-0.62, -0.1, 0.55]} rotation={[0, doorOpen ? Math.PI / 4 : 0, 0]}>
        <Part info={{ id: 'door', name: 'Door & Gasket Seal', status: doorStatus, description: 'Magnetic gasket door. An open door breaks the cold chain and triggers a critical event.', rows: [{ label: 'State', value: doorOpen ? 'OPEN' : 'Closed', status: doorStatus }, { label: 'Seal', value: doorOpen ? 'Broken' : 'Intact', status: doorStatus }] }}
          position={[0.62, 0, 0]} selected={selected} onSelect={setSelected} labelOffset={[0, 1.2, 0.2]}>
          <mesh castShadow><boxGeometry args={[1.22, 2.0, 0.1]} /><meshStandardMaterial color={selected === 'door' ? '#818cf8' : '#94a3b8'} metalness={0.55} roughness={0.4} /></mesh>
          {/* handle */}
          <mesh position={[0.5, 0, 0.08]}><boxGeometry args={[0.05, 0.9, 0.06]} /><meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} /></mesh>
          {/* temperature display panel */}
          <mesh position={[-0.25, 0.7, 0.06]}><boxGeometry args={[0.4, 0.22, 0.02]} /><meshStandardMaterial color="#05070d" metalness={0.2} roughness={0.6} emissive={panelColor} emissiveIntensity={0.6} /></mesh>
        </Part>
      </group>

      {/* ===== EVAPORATOR COIL (top interior) ===== */}
      <Part info={{ id: 'evaporator', name: 'Evaporator Coil', status: tempStatus, description: 'Cooling coil where refrigerant absorbs heat from the cabinet interior.', rows: [{ label: 'Coil Temp', value: `${(t - 4).toFixed(1)} °C`, status: tempStatus }, { label: 'Defrost', value: 'Idle' }] }}
        position={[0, 0.82, 0.15]} selected={selected} onSelect={setSelected} labelOffset={[0, 0.3, 0]}>
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} position={[0, 0, -0.3 + i * 0.15]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.025, 0.025, 0.95, 8]} /><meshStandardMaterial color={selected === 'evaporator' ? '#818cf8' : '#7dd3fc'} metalness={0.7} roughness={0.3} /></mesh>
        ))}
      </Part>

      {/* ===== COMPRESSOR (bottom rear) ===== */}
      <Part info={{ id: 'compressor', name: 'Compressor Unit', status: 'NORMAL', description: 'Hermetic compressor circulating refrigerant through the cooling loop.', rows: [{ label: 'Status', value: 'Running' }, { label: 'Duty Cycle', value: '62 %' }] }}
        position={[0.25, -1.05, -0.3]} selected={selected} onSelect={setSelected} labelOffset={[0, 0.4, 0]}>
        <mesh castShadow><cylinderGeometry args={[0.28, 0.28, 0.34, 16]} /><meshStandardMaterial color={selected === 'compressor' ? '#818cf8' : '#334155'} metalness={0.85} roughness={0.25} /></mesh>
        <mesh position={[0.2, 0.1, 0.18]}><cylinderGeometry args={[0.03, 0.03, 0.2, 8]} /><meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} /></mesh>
      </Part>

      {/* power LED */}
      <mesh position={[0.5, 0.85, 0.56]}><sphereGeometry args={[0.025, 8, 8]} /><meshStandardMaterial color={panelColor} emissive={panelColor} emissiveIntensity={1.6} /></mesh>
    </group>
  )
}

export default function Fridge3D({ device }: { device: FridgeDevice }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="w-full h-full relative">
      <Canvas shadows camera={{ position: [3.6, 2.4, 4], fov: 42, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ background: 'transparent' }}>
        <SceneLights />
        <Suspense fallback={null}>
          <FridgeScene device={device} selected={selected} setSelected={setSelected} />
          <ContactShadows position={[0, -1.32, 0]} opacity={0.4} scale={6} blur={2} far={3} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2.8} maxDistance={11} maxPolarAngle={Math.PI / 1.75} autoRotate={!selected} autoRotateSpeed={0.6} enableDamping dampingFactor={0.06} />
      </Canvas>
      <TwinOverlay selected={selected} onClear={() => setSelected(null)} />
    </div>
  )
}
