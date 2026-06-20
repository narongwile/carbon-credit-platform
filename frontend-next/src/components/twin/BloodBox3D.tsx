'use client'

import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { Part, SceneLights, TwinOverlay, type Status } from './parts'

export interface BloodDevice { name: string; temperature: number; battery: number; lidOpen: boolean; threshold: number }

function BloodBoxScene({ device, selected, setSelected }: { device: BloodDevice; selected: string | null; setSelected: (id: string | null) => void }) {
  const { temperature: t, battery, lidOpen, threshold } = device
  const tempStatus: Status = t > threshold + 1 ? 'CRITICAL' : t > threshold ? 'WARNING' : 'NORMAL'
  const lidStatus: Status = lidOpen ? 'WARNING' : 'NORMAL'
  const battStatus: Status = battery < 20 ? 'CRITICAL' : battery < 40 ? 'WARNING' : 'NORMAL'
  const led = tempStatus === 'CRITICAL' ? '#f87171' : tempStatus === 'WARNING' ? '#fcd34d' : '#4ade80'

  return (
    <group rotation={[0, -Math.PI / 7, 0]}>
      <mesh position={[0, -0.72, 0]} receiveShadow><boxGeometry args={[2.6, 0.08, 2]} /><meshStandardMaterial color="#0f172a" metalness={0.3} roughness={0.9} /></mesh>

      {/* ===== INSULATED BOX BODY ===== */}
      <Part info={{ id: 'box', name: 'Insulated Box', status: tempStatus, description: 'Vacuum-insulated medical cold box keeping blood within the 2–6 °C transport window.', rows: [{ label: 'Temperature', value: `${t.toFixed(1)} °C`, status: tempStatus }, { label: 'Set Window', value: `2–${threshold} °C` }] }}
        position={[0, -0.25, 0]} selected={selected} onSelect={setSelected} labelOffset={[0, 0.9, 0.6]}>
        <mesh castShadow receiveShadow><boxGeometry args={[1.7, 0.85, 1.05]} /><meshStandardMaterial color={selected === 'box' ? '#818cf8' : '#e2e8f0'} metalness={0.3} roughness={0.5} /></mesh>
        {/* red medical stripe */}
        <mesh position={[0, 0.1, 0.53]}><boxGeometry args={[1.7, 0.16, 0.01]} /><meshStandardMaterial color="#dc2626" metalness={0.2} roughness={0.6} /></mesh>
        {/* interior */}
        <mesh position={[0, 0.05, 0]}><boxGeometry args={[1.5, 0.6, 0.85]} /><meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.8} /></mesh>
        {/* blood bags */}
        {[-0.45, 0, 0.45].map((x) => (
          <mesh key={x} position={[x, 0.05, 0]} rotation={[0, 0, 0.08]}><boxGeometry args={[0.32, 0.5, 0.12]} /><meshStandardMaterial color="#991b1b" metalness={0.1} roughness={0.4} transparent opacity={0.92} /></mesh>
        ))}
      </Part>

      {/* ===== LID (hinged at back) ===== */}
      <group position={[0, 0.2, -0.5]} rotation={[lidOpen ? -Math.PI / 3 : 0, 0, 0]}>
        <Part info={{ id: 'lid', name: 'Lid & Latch', status: lidStatus, description: 'Gasketed lid with BLE latch sensor. Opening it in transit logs a journey event.', rows: [{ label: 'State', value: lidOpen ? 'OPEN' : 'Closed', status: lidStatus }] }}
          position={[0, 0, 0.5]} selected={selected} onSelect={setSelected} labelOffset={[0, 0.4, 0]}>
          <mesh castShadow><boxGeometry args={[1.74, 0.16, 1.08]} /><meshStandardMaterial color={selected === 'lid' ? '#818cf8' : '#cbd5e1'} metalness={0.35} roughness={0.45} /></mesh>
          {/* handle */}
          <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.03, 8, 20, Math.PI]} /><meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} /></mesh>
        </Part>
      </group>

      {/* ===== IoT SENSOR MODULE (front) ===== */}
      <Part info={{ id: 'sensor', name: 'IoT Sensor Module', status: battStatus, description: 'GNSS + 4G + BLE/Barometer module reporting temperature, battery and indoor position.', rows: [{ label: 'Temp Probe', value: `${t.toFixed(1)} °C`, status: tempStatus }, { label: 'Battery', value: `${battery}%`, status: battStatus }, { label: 'Link', value: 'GNSS · 4G' }] }}
        position={[0.5, -0.1, 0.56]} selected={selected} onSelect={setSelected} labelOffset={[0, 0.35, 0]}>
        <mesh castShadow><boxGeometry args={[0.34, 0.22, 0.08]} /><meshStandardMaterial color={selected === 'sensor' ? '#818cf8' : '#1e293b'} metalness={0.5} roughness={0.5} /></mesh>
        <mesh position={[-0.1, 0, 0.05]}><sphereGeometry args={[0.022, 8, 8]} /><meshStandardMaterial color={led} emissive={led} emissiveIntensity={1.8} /></mesh>
        {/* tiny antenna */}
        <mesh position={[0.12, 0.16, 0]}><cylinderGeometry args={[0.008, 0.008, 0.16, 6]} /><meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} /></mesh>
      </Part>
    </group>
  )
}

export default function BloodBox3D({ device }: { device: BloodDevice }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="w-full h-full relative">
      <Canvas shadows camera={{ position: [3.4, 2.2, 4], fov: 42, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ background: 'transparent' }}>
        <SceneLights />
        <Suspense fallback={null}>
          <BloodBoxScene device={device} selected={selected} setSelected={setSelected} />
          <ContactShadows position={[0, -0.72, 0]} opacity={0.4} scale={6} blur={2} far={3} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2.6} maxDistance={11} maxPolarAngle={Math.PI / 1.75} autoRotate={!selected} autoRotateSpeed={0.6} enableDamping dampingFactor={0.06} />
      </Canvas>
      <TwinOverlay selected={selected} onClear={() => setSelected(null)} />
    </div>
  )
}
