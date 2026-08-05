'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import { getGeoNodes } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

export default function MapPage() {
  // Select only selectedOrgId — subscribing to the whole store re-rendered this
  // page on every telemetry tick, which cascaded into the map rebuilding.
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = selectedOrgId || 'org-1'
  const nodes = useLiveGeoNodes(orgId) ?? getGeoNodes(orgId)
  const covers = useOrgPhotoCovers(orgId)
  const [previewId, setPreviewId] = useState<string | null>(null)

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Sensor Map</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time geographical distribution of all active sensors across every domain.</p>
      </div>
      <LiveSensorMap nodes={nodes} photoCovers={covers} onOpenPhotos={setPreviewId} />
      {previewId && (
        <NodePhotoPreview nodeId={previewId} canEdit onClose={() => setPreviewId(null)} />
      )}
    </div>
  )
}
