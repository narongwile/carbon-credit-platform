'use client'

import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import { getGeoNodes } from '@/lib/geoNodes'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

export default function MapPage() {
  const { selectedOrgId } = useAppStore()
  const nodes = getGeoNodes(selectedOrgId || 'org-1')

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Sensor Map</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time geographical distribution of all active sensors across every domain.</p>
      </div>
      <LiveSensorMap nodes={nodes} />
    </div>
  )
}
