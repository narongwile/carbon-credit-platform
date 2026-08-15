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
import { MapPin, ExternalLink, Crosshair, Loader2, LocateFixed, Maximize2, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const surface = { background: '#0d1117', border: '1px solid #1e2433' }

function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** Plain lat/lng number entry, for a precise reading (nameplate, handheld
 * GPS, "copy coordinates" from Google Maps) rather than eyeballing a click —
 * the same alternate-input idea admin/map's ManualCoordEntry already offers
 * for bulk device placement, here for one device's own position. */
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
  // This device's OWN coordinate — the same source the Live Sensor Map reads,
  // so a pin set there (or here) shows up in both places without a reload.
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
  // What's actually shown: this device's own pin if it has one, else the
  // site's as an approximation, else nothing.
  const shown = deviceCoord ? { ...deviceCoord, source: 'device' as const } : siteCoord ? { ...siteCoord, source: 'site' as const } : null

  // 'device' | 'site' | null — which coordinate an edit in progress targets.
  // Defaults to whichever makes sense for the current state: refine the
  // device's own pin if it already has one; otherwise the natural first
  // step is the site's shared pin.
  const [editing, setEditing] = useState<'device' | 'site' | null>(null)
  const [saving, setSaving] = useState(false)
  // The map widget's own inline size is tight (160px) — enough to confirm a
  // pin lands in the right building, not enough to tell two nearby streets
  // apart. Fullscreen is a bigger version of the SAME editor, not a
  // different flow.
  const [expanded, setExpanded] = useState(false)

  // A field technician opening this card is usually standing at the device
  // right now — asking the browser for that position up front turns
  // "eyeball a map click" into "confirm the GPS reading", which is both
  // faster and more accurate. Fired the moment editing starts; a denial or
  // an insecure/unsupported context just leaves the button enabled to retry
  // (getCurrentPosition requires HTTPS in most browsers, so this silently
  // does nothing over plain HTTP rather than erroring the whole card).
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
    if (editing) requestGeolocation()
    else { setGeoPos(null); setGeoStatus('idle') }
  }, [editing, requestGeolocation])

  const save = async (target: 'device' | 'site', lat: number, lng: number) => {
    setSaving(true)
    if (target === 'device') {
      const r = await api.setNodeLocation(nodeId, { lat, lng })
      setSaving(false)
      if (!r?.ok) { toast.error('Could not save this device’s location'); return }
      toast.success('Device location saved')
      reload()
    } else {
      if (!site) { setSaving(false); return }
      const r = await api.saveSite(orgId, { id: site.id, name: site.name, address: site.address ?? undefined, lat, lng })
      setSaving(false)
      if (!r?.ok) { toast.error('Could not save the site location'); return }
      toast.success(`${site.name}’s location saved`)
      setSite({ ...site, lat, lng })
    }
    setEditing(null)
    setExpanded(false)
  }

  // Shared between the compact inline editor and the expanded modal — same
  // controls either way, just more room to work with when expanded.
  const editorBody = (target: 'device' | 'site', pickerHeight: string) => (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">
        {target === 'device' ? 'Click or drag the pin to this device’s exact position.' : `Click or drag the pin to set ${site?.name ?? 'the site'}’s location — every device here inherits it until it has its own.`}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {geoStatus !== 'unsupported' && (
          <button onClick={() => (geoPos ? save(target, geoPos.lat, geoPos.lng) : requestGeolocation())}
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
          onChange={(lat, lng) => save(target, lat, lng)}
        />
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(10,14,26,0.6)' }}>
            <Loader2 size={16} className="animate-spin text-indigo-400" />
          </div>
        )}
      </div>
      {/* Alternative to clicking the map — a precise reading from a
          nameplate, handheld GPS, or "copy coordinates" off Google Maps. */}
      <ManualCoordInputs onSet={(lat, lng) => save(target, lat, lng)} busy={saving} />
      <button onClick={() => { setEditing(null); setExpanded(false) }} disabled={saving}
        className="text-[10px] px-2 py-1 rounded-md text-slate-400 hover:text-white disabled:opacity-50" style={inset}>
        Cancel
      </button>
    </div>
  )

  return (
    <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-600 uppercase tracking-wider">Device Location</div>
        {shown && (
          <a href={googleMapsUrl(shown.lat, shown.lng)} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300">
            Google Maps <ExternalLink size={9} />
          </a>
        )}
      </div>

      {editing ? (
        expanded ? (
          <p className="text-[11px] text-slate-500">Editing in the expanded view above.</p>
        ) : editorBody(editing, '160px')
      ) : shown ? (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            {/* Keyed by the coordinate itself: LocationPicker only reads its
                lat/lng props at mount (see its own comment), so if this pin
                moves via a concurrent edit elsewhere (e.g. the Live Sensor
                Map) while this card is just sitting here, a plain re-render
                would leave the old position on screen — the key forces a
                remount instead. */}
            <LocationPicker key={`${shown.lat},${shown.lng}`} lat={shown.lat} lng={shown.lng} height="120px" zoom={14} interactive={false} onChange={() => {}} />
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={10} className="text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-300">{shown.lat.toFixed(5)}, {shown.lng.toFixed(5)}</div>
              {shown.source === 'site' && (
                <div className="text-[10px] text-amber-400 mt-0.5">Approximate — {site?.name}&apos;s location, not this device&apos;s own.</div>
              )}
            </div>
          </div>
          {canConfigure && (
            // Both branches edit the DEVICE's own coordinate — even when
            // `shown` is currently the site's fallback pin, the point of this
            // button is to give this specific device its own precise one.
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

      {editing && expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)' }}
          onClick={() => setExpanded(false)}
        >
          <div className="w-full max-w-2xl rounded-2xl p-4" style={surface} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-white">
                {editing === 'device' ? 'Adjust device position' : `Set ${site?.name ?? 'site'} location`}
              </div>
              <button onClick={() => setExpanded(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {editorBody(editing, '60vh')}
          </div>
        </div>
      )}
    </div>
  )
}
