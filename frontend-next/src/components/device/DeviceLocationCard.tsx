'use client'

// ---------------------------------------------------------------------------
// Replaces the old text-only "Location" block on a transformer's own
// dashboard (name + a static lat/lng pulled from mock/site-jittered data —
// TransformerDetailView never read the REAL per-device coordinate the Live
// Sensor Map itself writes) with an actual map: shows the device's own pin
// when it has one, a Google Maps link-out, and — for an admin — a way to set
// a coordinate when there isn't one yet.
//
// Two coordinates exist here, deliberately not conflated:
//   nodes.lat/lng    — THIS device's own precise position (PUT /api/nodes/:id/location)
//   sites.lat/lng    — the SITE it belongs to, shared by every device there
// A device usually gets a real position later than its site does (a site is
// set up once; a device's exact spot is refined afterward, sometimes never).
// So the fallback order is: device's own pin if it has one; otherwise the
// site's pin, clearly labelled approximate; otherwise nothing, with the
// FIRST thing offered to an admin being the site's location — the one
// coordinate every device there will benefit from, not a one-off precise
// pin for just this device.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { useFleetLive } from '@/lib/useFleetLive'
import { useReverseAddress, reverseGeocode, calculateDistanceMeters, formatDistance } from '@/lib/geoAddress'
import { MapPin, ExternalLink, Crosshair, Loader2, LocateFixed, Maximize2, X, Check, Building, Navigation, Cpu } from 'lucide-react'
import toast from 'react-hot-toast'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const surface = { background: '#0d1117', border: '1px solid #1e2433' }

function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** Plain lat/lng number entry, for a precise reading (nameplate, handheld
 * GPS, "copy coordinates" from Google Maps) rather than eyeballing a click. */
function ManualCoordInputs({ onSet, busy }: { onSet: (lat: number, lng: number) => void; busy: boolean }) {
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
        onKeyDown={(e) => e.key === 'Enter' && submit()} disabled={busy}
        className="w-0 flex-1 min-w-0 text-[11px] rounded-md px-2 py-1.5 text-slate-200 outline-none disabled:opacity-50" style={inset} />
      <input type="number" step="any" placeholder="Lng" value={lng} onChange={(e) => setLng(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()} disabled={busy}
        className="w-0 flex-1 min-w-0 text-[11px] rounded-md px-2 py-1.5 text-slate-200 outline-none disabled:opacity-50" style={inset} />
      <button onClick={submit} disabled={!valid || busy} title="Set this exact coordinate"
        className="p-1.5 rounded-md text-white disabled:opacity-40 flex-shrink-0" style={{ background: '#6366f1' }}>
        <Check size={12} />
      </button>
    </div>
  )
}

export default function DeviceLocationCard({
  nodeId, orgId, siteId, canConfigure,
}: {
  nodeId: string
  orgId: string
  /** The site this device is assigned to, if any (ManagedDevice/host siteId). */
  siteId?: string | null
  /** Gate editing behind the same role check the rest of this page uses. */
  canConfigure: boolean
}) {
  const { byId, reload } = useFleetLive(orgId)
  const deviceNode = byId.get(nodeId)
  const deviceCoord = deviceNode?.lat != null && deviceNode?.lng != null
    ? { lat: Number(deviceNode.lat), lng: Number(deviceNode.lng) }
    : null

  const [site, setSite] = useState<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!siteId) { setSite(null); return }
    api.sites(orgId).then((r) => {
      if (cancelled || !r) return
      setSite(r.sites.find((s) => s.id === siteId) ?? null)
    })
    return () => { cancelled = true }
  }, [orgId, siteId])

  const siteCoord = site?.lat != null && site?.lng != null ? { lat: Number(site.lat), lng: Number(site.lng) } : null
  const shown = deviceCoord ? { ...deviceCoord, source: 'device' as const } : siteCoord ? { ...siteCoord, source: 'site' as const } : null

  // Reverse geocoded address calculated from coordinates
  const { address: computedAddress, loading: addressLoading } = useReverseAddress(shown?.lat, shown?.lng)

  const [editing, setEditing] = useState<'device' | 'site' | null>(null)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Pending confirmation state before writing to DB
  const [pendingConfirm, setPendingConfirm] = useState<{
    target: 'device' | 'site'
    lat: number
    lng: number
    address: string | null
    loadingAddress: boolean
  } | null>(null)

  const [geoPos, setGeoPos] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'denied' | 'unsupported'>('idle')
  const requestGeolocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoStatus('unsupported'); return }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus('idle') },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])
  useEffect(() => {
    if (editing || expanded) requestGeolocation()
    else { setGeoPos(null); setGeoStatus('idle') }
  }, [editing, expanded, requestGeolocation])

  const triggerCoordConfirm = async (target: 'device' | 'site', lat: number, lng: number) => {
    setPendingConfirm({
      target,
      lat,
      lng,
      address: null,
      loadingAddress: true,
    })
    const addr = await reverseGeocode(lat, lng)
    setPendingConfirm((p) => (p && p.lat === lat && p.lng === lng ? { ...p, address: addr, loadingAddress: false } : p))
  }

  const confirmSave = async () => {
    if (!pendingConfirm || saving) return
    const { target, lat, lng } = pendingConfirm
    setSaving(true)
    try {
      if (target === 'device') {
        const r = await api.setNodeLocation(nodeId, { lat, lng })
        if (!r?.ok) { toast.error('Could not save this device’s location'); return }
        toast.success('Device location saved')
        reload()
      } else {
        if (!site) return
        const r = await api.saveSite(orgId, { id: site.id, name: site.name, address: site.address ?? undefined, lat, lng })
        if (!r?.ok) { toast.error('Could not save the site location'); return }
        toast.success(`${site.name}’s location saved`)
        setSite({ ...site, lat, lng })
      }
      setPendingConfirm(null)
      setEditing(null)
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }

  // Shared between the compact inline editor and the expanded modal
  const editorBody = (target: 'device' | 'site', pickerHeight: string) => (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">
        {target === 'device' ? 'Click or drag the pin to this device’s exact position.' : `Click or drag the pin to set ${site?.name ?? 'the site'}’s location — every device here inherits it until it has its own.`}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {geoStatus !== 'unsupported' && (
          <button onClick={() => (geoPos ? triggerCoordConfirm(target, geoPos.lat, geoPos.lng) : requestGeolocation())}
            disabled={saving || geoStatus === 'loading'}
            title={geoPos ? 'Use the position your browser just reported' : 'Ask your browser for your current GPS position'}
            className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md text-indigo-300 hover:text-indigo-200 disabled:opacity-50" style={inset}>
            {geoStatus === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <LocateFixed size={11} />}
            {geoStatus === 'loading' ? 'Locating…' : geoPos ? 'Use my current location' : geoStatus === 'denied' ? 'Location denied — retry' : 'Use my current location'}
          </button>
        )}
        <button onClick={() => setExpanded((e) => !e)} title={expanded ? 'Shrink map' : 'Expand map'}
          className="flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-md text-slate-400 hover:text-white" style={inset}>
          <Maximize2 size={11} /> {expanded ? 'Shrink' : 'Expand'}
        </button>
      </div>
      <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <LocationPicker
          key={target}
          lat={(target === 'device' ? deviceCoord?.lat : siteCoord?.lat) ?? shown?.lat ?? null}
          lng={(target === 'device' ? deviceCoord?.lng : siteCoord?.lng) ?? shown?.lng ?? null}
          height={pickerHeight}
          zoom={shown ? 14 : 6}
          showSearch={true}
          onChange={(lat, lng) => triggerCoordConfirm(target, lat, lng)}
        />
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(10,14,26,0.6)' }}>
            <Loader2 size={16} className="animate-spin text-indigo-400" />
          </div>
        )}
      </div>
      <ManualCoordInputs onSet={(lat, lng) => triggerCoordConfirm(target, lat, lng)} busy={saving} />
      <button onClick={() => { setEditing(null); setExpanded(false); setPendingConfirm(null) }} disabled={saving}
        className="text-[10px] px-2 py-1 rounded-md text-slate-400 hover:text-white disabled:opacity-50" style={inset}>
        Cancel
      </button>
    </div>
  )

  return (
    <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-600 uppercase tracking-wider">Device Location</div>
        <div className="flex items-center gap-2">
          {!editing && shown && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded transition-colors"
              style={inset}
              title="Expand map view"
            >
              <Maximize2 size={10} /> Expand
            </button>
          )}
          {shown && (
            <a href={googleMapsUrl(shown.lat, shown.lng)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300">
              Google Maps <ExternalLink size={9} />
            </a>
          )}
        </div>
      </div>

      {editing ? (
        expanded ? (
          <p className="text-[11px] text-slate-500">Editing in the expanded view above.</p>
        ) : editorBody(editing, '160px')
      ) : shown ? (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <LocationPicker key={`${shown.lat},${shown.lng}`} lat={shown.lat} lng={shown.lng} height="120px" zoom={14} interactive={false} showLayerSwitcher={false} showMyLocation={false} onChange={() => {}} />
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-300 font-mono">{shown.lat.toFixed(5)}, {shown.lng.toFixed(5)}</div>
              {computedAddress && (
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug line-clamp-2" title={computedAddress}>
                  {computedAddress}
                </div>
              )}
              {shown.source === 'site' && (
                <div className="text-[10px] text-amber-400 mt-0.5">Approximate — {site?.name}&apos;s location, not this device&apos;s own.</div>
              )}
            </div>
          </div>
          {canConfigure && (
            <button onClick={() => setEditing('device')}
              className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md text-indigo-300 hover:text-indigo-200" style={inset}>
              <Crosshair size={11} /> {shown.source === 'device' ? 'Adjust this device’s position' : 'Set this device’s exact position'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">No location set yet.</p>
          {canConfigure && (
            siteId ? (
              <button onClick={() => setEditing('site')}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md text-indigo-300 hover:text-indigo-200" style={inset}>
                <Crosshair size={11} /> Set {site ? site.name : 'the site'}&apos;s location
              </button>
            ) : (
              <button onClick={() => setEditing('device')}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md text-indigo-300 hover:text-indigo-200" style={inset}>
                <Crosshair size={11} /> Set this device&apos;s location
              </button>
            )
          )}
        </div>
      )}

      {/* Expanded Modal for ANY user (Admin, Customer, Viewer) */}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)' }}
          onClick={() => setExpanded(false)}
        >
          <div className="w-full max-w-3xl rounded-2xl p-4 space-y-3" style={surface} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <MapPin size={14} className="text-indigo-400" />
                  {editing === 'device' ? 'Adjust Device Position' : editing === 'site' ? `Set ${site?.name ?? 'Site'} Location` : 'Device Geographic Location'}
                </div>
                {shown && (
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-slate-300">{shown.lat.toFixed(5)}, {shown.lng.toFixed(5)}</span>
                    {computedAddress && <span>· {computedAddress}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {shown && (
                  <a href={googleMapsUrl(shown.lat, shown.lng)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded" style={inset}>
                    Open in Google Maps <ExternalLink size={10} />
                  </a>
                )}
                <button onClick={() => setExpanded(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            </div>

            {editing ? (
              editorBody(editing, '60vh')
            ) : shown ? (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
                  <LocationPicker
                    key={`modal-${shown.lat},${shown.lng}`}
                    lat={shown.lat}
                    lng={shown.lng}
                    height="60vh"
                    zoom={15}
                    interactive={false}
                    showSearch={true}
                    showLayerSwitcher={true}
                    showMyLocation={true}
                    onChange={() => {}}
                  />
                </div>
                {geoPos && (
                  <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-sky-950/50 border border-sky-800/50 text-sky-300">
                    <span className="flex items-center gap-1.5">
                      <Navigation size={13} className="text-sky-400" />
                      ระยะห่างจากตำแหน่งของคุณ: <strong className="font-semibold text-white">{formatDistance(calculateDistanceMeters(geoPos.lat, geoPos.lng, shown.lat, shown.lng))}</strong>
                    </span>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&origin=${geoPos.lat},${geoPos.lng}&destination=${shown.lat},${shown.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-200 underline font-medium flex items-center gap-1"
                    >
                      เปิดนำทาง ↗
                    </a>
                  </div>
                )}
                {canConfigure && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500">Need to update this position?</span>
                    <button
                      onClick={() => setEditing('device')}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white font-medium shadow"
                      style={{ background: '#6366f1' }}
                    >
                      <Crosshair size={12} /> Adjust this device’s position
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-8 text-center">No location set yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal when a coordinate is selected/entered in transformer dashboard */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4 border border-slate-700/60" style={surface}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <MapPin size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">ยืนยันพิกัดสถานที่ติดตั้ง</h2>
                  <p className="text-[11px] text-slate-400">ตรวจสอบข้อมูลสถานที่ก่อนบันทึก</p>
                </div>
              </div>
              <button
                onClick={() => setPendingConfirm(null)}
                disabled={saving}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Target Item */}
            <div className="p-3 rounded-xl space-y-1.5" style={inset}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                {pendingConfirm.target === 'device' ? <Cpu size={12} className="text-indigo-400" /> : <Building size={12} className="text-amber-400" />}
                {pendingConfirm.target === 'device' ? 'อุปกรณ์เป้าหมาย' : 'ไซต์ / สถานีเป้าหมาย'}
              </div>
              <div className="text-xs font-semibold text-white">
                {pendingConfirm.target === 'device' ? (deviceNode?.name ?? nodeId) : (site?.name ?? 'Site')}
              </div>
            </div>

            {/* Location & GPS */}
            <div className="p-3 rounded-xl space-y-2.5" style={inset}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Navigation size={11} className="text-cyan-400" />
                  พิกัด (GPS)
                </span>
                <span className="font-mono text-xs text-cyan-300 font-semibold bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded">
                  {pendingConfirm.lat.toFixed(6)}, {pendingConfirm.lng.toFixed(6)}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-800/60">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
                  <MapPin size={11} className="text-amber-400" />
                  ที่อยู่ / ข้อมูลสถานที่
                </div>
                {pendingConfirm.loadingAddress ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                    <Loader2 size={13} className="animate-spin text-indigo-400" />
                    <span>กำลังค้นหาชื่อสถานที่ (Reverse Geocoding)...</span>
                  </div>
                ) : pendingConfirm.address ? (
                  <p className="text-xs text-slate-200 leading-relaxed font-medium bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    {pendingConfirm.address}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    ไม่พบชื่อสถานที่ในฐานข้อมูล (จะบันทึกเฉพาะค่าพิกัดละติจูด/ลองจิจูด)
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={saving}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors"
              >
                เลือกใหม่ / ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmSave}
                disabled={saving}
                className="px-4 py-1.5 text-xs font-semibold text-white rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>กำลังบันทึก...</span>
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    <span>ยืนยันบันทึก (Confirm)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
