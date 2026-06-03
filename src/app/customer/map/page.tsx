'use client'

import dynamic from 'next/dynamic'
import { getGeoNodes } from '@/lib/geoNodes'
import { useAppStore } from '@/lib/store'
import { viewerDomains } from '@/lib/viewer'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

export default function CustomerMapPage() {
  const { viewerUserId } = useAppStore()
  const allowed = viewerDomains(viewerUserId)
  const nodes = getGeoNodes('org-1').filter((n) => allowed.includes(n.domain))

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Sensor Map</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time geographical distribution of all active sensors.</p>
      </div>
      <LiveSensorMap nodes={nodes} />
    </div>
  )
}
