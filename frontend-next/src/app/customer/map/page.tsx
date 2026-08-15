'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useLiveGeoNodes } from '@/lib/useFleetLive'
import { useAppStore } from '@/lib/store'
import { useSessionOrgId } from '@/lib/auth'
import { useIsLive } from '@/lib/api'
import { viewerDomains } from '@/lib/viewer'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })

// Same split the two list views below already use (their <Link> hrefs).
function customerMonitorRoute(domain: GeoNode['domain'], id: string): string {
  return domain === 'transformer' ? `/customer/transformers/detail?id=${encodeURIComponent(id)}` : `/customer/devices/detail?id=${encodeURIComponent(id)}`
}

export default function CustomerMapPage() {
  const router = useRouter()
  const live = useIsLive()
  const orgId = useSessionOrgId()
  const { viewerUserId } = useAppStore()
  const allowed = viewerDomains(viewerUserId)
  const liveNodes = useLiveGeoNodes(orgId)
  const nodes = live && liveNodes ? liveNodes : getGeoNodes(orgId).filter((n) => allowed.includes(n.domain))
  const covers = useOrgPhotoCovers(orgId)
  const [previewId, setPreviewId] = useState<string | null>(null)

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Devices Location</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time geographic distribution of all your monitored devices</p>
        </div>
      </div>

      <LiveSensorMap
        nodes={nodes}
        photoCovers={covers}
        onOpenPhotos={setPreviewId}
        onOpenDevice={(id, domain) => router.push(customerMonitorRoute(domain, id))}
      />

      {previewId && (
        <NodePhotoPreview nodeId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </div>
  )
}
