'use client'

import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { getGeoNodes, type GeoNode } from '@/lib/geoNodes'
import { useIsLive } from '@/lib/api'
import { useSessionRole, useSessionOrgId } from '@/lib/auth'
import { usePlacementSession } from '@/lib/usePlacementSession'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { useOrgNameplates } from '@/lib/useNodeNameplate'
import { NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import DevicePlacementPanel from '@/components/map/DevicePlacementPanel'
import { X, SkipForward, Crosshair, Check, MapPin, Loader2, Navigation, Cpu } from 'lucide-react'
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

function MapPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialSiteId = searchParams.get('siteId')
  const selectedOrgId = useAppStore((s) => s.selectedOrgId)
  const sessionOrgId = useSessionOrgId('org-1')
  const orgId = selectedOrgId || sessionOrgId || 'org-1'
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
  const pending = placement.pending

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
          initialSiteId={initialSiteId}
          onSiteChange={(siteId) => {
            const url = siteId === 'all' ? '/admin/map' : `/admin/map?siteId=${encodeURIComponent(siteId)}`
            router.replace(url, { scroll: false })
          }}
        />

        {canEdit && live && (
          <DevicePlacementPanel placement={placement} open={panelOpen} onOpenChange={setPanelOpen} />
        )}

        {/* What a click will do right now — pick mode has no other visible cue
            besides the map's own crosshair cursor and indigo border. */}
        {session && !pending && (
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

        {/* Confirmation Modal when a coordinate has been picked/entered */}
        {pending && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5 border border-slate-700/60" style={surface}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">ยืนยันพิกัดสถานที่ติดตั้ง</h2>
                    <p className="text-xs text-slate-400">ตรวจสอบข้อมูลสถานที่ก่อนบันทึกตำแหน่งอุปกรณ์</p>
                  </div>
                </div>
                <button onClick={placement.cancelPending} disabled={placement.busy}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Target Device(s) */}
              <div className="p-3.5 rounded-xl space-y-2" style={inset}>
                <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Cpu size={12} className="text-indigo-400" />
                  อุปกรณ์ที่เลือก ({pending.devices.length} รายการ)
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1.5 pr-1">
                  {pending.devices.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
                      <span className="font-medium text-white truncate max-w-[260px]">{d.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded uppercase font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {d.domain}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Location & Coordinates Info */}
              <div className="p-3.5 rounded-xl space-y-3" style={inset}>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Navigation size={12} className="text-cyan-400" />
                    พิกัดภูมิศาสตร์ (GPS Coordinates)
                  </div>
                  <span className="font-mono text-xs text-cyan-300 font-semibold bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded">
                    {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-800/60">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                    <MapPin size={12} className="text-amber-400" />
                    ข้อมูลสถานที่ / ที่อยู่จากการค้นหาพิกัด
                  </div>
                  {pending.loadingAddress ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                      <Loader2 size={14} className="animate-spin text-indigo-400" />
                      <span>กำลังระบุชื่อสถานที่และที่อยู่จากพิกัด (Reverse Geocoding)...</span>
                    </div>
                  ) : pending.address ? (
                    <p className="text-xs text-slate-200 leading-relaxed font-medium bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      {pending.address}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                      ไม่พบชื่อสถานที่ในฐานข้อมูลแผนที่ (จะบันทึกเฉพาะค่าพิกัดละติจูด/ลองจิจูด)
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={placement.cancelPending}
                  disabled={placement.busy}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors"
                >
                  เลือกพิกัดใหม่ / ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={placement.confirmPending}
                  disabled={placement.busy}
                  className="px-5 py-2 text-xs font-semibold text-white rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-50"
                >
                  {placement.busy ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>กำลังบันทึก...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>ยืนยันบันทึกพิกัด (Confirm)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {previewId && (
        <NodePhotoPreview nodeId={previewId} canEdit onClose={() => setPreviewId(null)} />
      )}
    </div>
  )
}

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapPageContent />
    </Suspense>
  )
}
