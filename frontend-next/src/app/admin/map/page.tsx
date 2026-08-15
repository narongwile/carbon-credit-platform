'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useIsLive } from '@/lib/api'
import { useSessionRole } from '@/lib/auth'
import { usePlacementSession } from '@/lib/usePlacementSession'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { useOrgNameplates } from '@/lib/useNodeNameplate'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import DevicePlacementPanel from '@/components/map/DevicePlacementPanel'
import { X, SkipForward, Crosshair, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const LiveSensorMap = dynamic(() => import('@/components/map/LiveSensorMap'), { ssr: false })
const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// transformer keeps its dedicated rich twin; other domains use the shared
// node twin — same split superadmin/monitoring/page.tsx's monitorRoute uses.
function monitorRoute(domain: GeoNode['domain'], id: string): string {
  return domain === 'transformer' ? `/admin/transformers/detail?id=${encodeURIComponent(id)}` : `/admin/nodes/detail?id=${encodeURIComponent(id)}`
}

// Typed lat/lng, alongside the existing click-to-pin flow — usePlacementSession's
// pick() is the same commit path either way (api.setNodeLocation under the
// hood), so this is purely an alternate way to FEED it a coordinate. Needed
// for sites the operator already has surveyed/GPS coordinates for (a
// nameplate, a handheld GPS reading, Google Maps "copy coordinates") rather
// than eyeballing a click on the map.
function ManualCoordEntry({ onSet, busy }: { onSet: (lat: number, lng: number) => void; busy: boolean }) {
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)
  const valid = lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(latNum) && Number.isFinite(lngNum)
    && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180

  const submit = () => {
    if (!valid) { toast.error('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).'); return }
    onSet(latNum, lngNum)
    setLat(''); setLng('')
  }

  return (
    <div className="flex items-center gap-1.5">
      <input type="number" step="any" placeholder="Lat" value={lat} onChange={(e) => setLat(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-20 text-xs rounded-md px-2 py-1 text-slate-200 outline-none" style={inset} />
      <input type="number" step="any" placeholder="Lng" value={lng} onChange={(e) => setLng(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-20 text-xs rounded-md px-2 py-1 text-slate-200 outline-none" style={inset} />
      <button onClick={submit} disabled={!valid || busy} title="Set this coordinate"
        className="p-1.5 rounded-md text-white disabled:opacity-40" style={{ background: '#6366f1' }}>
        <Check size={13} />
      </button>
    </div>
  )
}

export default function MapPage() {
  const router = useRouter()
  // Select only selectedOrgId — subscribing to the whole store re-rendered this
  // page on every telemetry tick, which cascaded into the map rebuilding.
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const orgId = selectedOrgId || 'org-1'
  const live = useIsLive()
  const role = useSessionRole()
  const canEdit = role === 'admin' || role === 'superadmin'

  // Real device positions + the placement session (start/pick/skip/stop) live
  // together here: ETERNITY has no Floor Plans feature, so this map IS the
  // only place a device's coordinate gets set.
  const placement = usePlacementSession(orgId)
  // Demo fallback only when genuinely offline. When live but nothing has a
  // coordinate yet, show the real (empty) map rather than another org's demo
  // pins — that empty map, with the placement panel open, is exactly the
  // state this feature exists to fix.
  const nodes = live ? placement.nodes : getGeoNodes(orgId)

  const covers = useOrgPhotoCovers(orgId)
  const nameplates = useOrgNameplates(orgId)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const session = placement.session
  const current = placement.current

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Sensor Map</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time geographical distribution of all active sensors across every domain.</p>
      </div>

      <div className="relative">
        <LiveSensorMap
          nodes={nodes} photoCovers={covers} nameplates={nameplates} onOpenPhotos={setPreviewId}
          editable={canEdit && live}
          onReposition={(id) => { setPanelOpen(false); placement.start([id], 'sequential') }}
          pickActive={!!session}
          onPick={(lat, lng) => placement.pick(lat, lng)}
          onOpenDevice={(id, domain) => router.push(monitorRoute(domain, id))}
        />

        {canEdit && live && (
          <DevicePlacementPanel placement={placement} open={panelOpen} onOpenChange={setPanelOpen} />
        )}

        {/* What a click will do right now — pick mode has no other visible cue
            besides the map's own crosshair cursor and indigo border. */}
        {session && (
          <div className="absolute top-3 right-3 z-[1000] flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl" style={surface}>
            <Crosshair size={14} className="text-indigo-400 animate-pulse shrink-0" />
            <div className="text-xs">
              {session.mode === 'same-point' ? (
                <>
                  <span className="text-white font-medium">Click the map</span>
                  <span className="text-slate-500"> — sets the same point for {session.ids.length} device{session.ids.length === 1 ? '' : 's'}</span>
                </>
              ) : (
                <>
                  <span className="text-white font-medium">{current?.name ?? session.ids[session.index]}</span>
                  <span className="text-slate-500"> — click the map ({session.index + 1} of {session.ids.length})</span>
                </>
              )}
            </div>
            <div className="w-px h-5" style={{ background: '#1e2433' }} />
            <ManualCoordEntry onSet={(lat, lng) => placement.pick(lat, lng)} busy={placement.busy} />
            {session.mode === 'sequential' && session.ids.length > 1 && (
              <button onClick={placement.skip} title="Skip this device, keep going"
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5">
                <SkipForward size={13} />
              </button>
            )}
            <button onClick={placement.stop} title="Stop placing"
              className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-white/5">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {previewId && (
        <NodePhotoPreview nodeId={previewId} canEdit onClose={() => setPreviewId(null)} />
      )}
    </div>
  )
}
