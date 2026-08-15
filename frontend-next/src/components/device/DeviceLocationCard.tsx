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

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { useFleetLive } from '@/lib/useFleetLive'
import { MapPin, ExternalLink, Crosshair, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`
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
  }

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
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500">
            {editing === 'device' ? 'Click or drag the pin to this device’s exact position.' : `Click or drag the pin to set ${site?.name ?? 'the site'}’s location — every device here inherits it until it has its own.`}
          </p>
          <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <LocationPicker
              key={editing}
              lat={(editing === 'device' ? deviceCoord?.lat : siteCoord?.lat) ?? shown?.lat ?? null}
              lng={(editing === 'device' ? deviceCoord?.lng : siteCoord?.lng) ?? shown?.lng ?? null}
              height="160px"
              zoom={shown ? 14 : 6}
              onChange={(lat, lng) => save(editing, lat, lng)}
            />
            {saving && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(10,14,26,0.6)' }}>
                <Loader2 size={16} className="animate-spin text-indigo-400" />
              </div>
            )}
          </div>
          <button onClick={() => setEditing(null)} disabled={saving}
            className="text-[10px] px-2 py-1 rounded-md text-slate-400 hover:text-white disabled:opacity-50" style={inset}>
            Cancel
          </button>
        </div>
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
    </div>
  )
}
