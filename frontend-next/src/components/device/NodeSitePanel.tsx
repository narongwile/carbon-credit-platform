'use client'

// ---------------------------------------------------------------------------
// Which of the customer's sites this device belongs to.
// ---------------------------------------------------------------------------
// migrate-v21 made sites real rows, but nothing on the device page could read or
// change one: a transformer's site could only be set while APPROVING it, or as a
// side effect of pinning it on a floor plan. ETERNITY's customers range from a
// single substation to a dozen plants, so "which site is this unit at, and what
// else is at that site" is the question an operator opens this page with.
//
// Reassigning sends ONLY siteId. The location endpoint used to write lat/lng
// unconditionally, so a site change also blanked the coordinate an admin had
// pinned on the floor plan — which for an ETERNITY transformer IS its position
// on the live sensor map. It is a partial update now (see nodeLocPutFunc).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, useIsLive } from '@/lib/api'
import { useSessionRole } from '@/lib/auth'
import { useManagedDevices } from '@/lib/useManagedDevices'
import type { SensorDomain } from '@/types/fleet'
import { MapPin, Building2, Loader2, Plus, ExternalLink, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface Site { id: string; name: string; address: string | null; lat: number | null; lng: number | null }

export default function NodeSitePanel({
  nodeId, orgId, currentSiteId, domain, deviceHref = '/admin/nodes/detail',
}: {
  nodeId: string
  orgId: string
  currentSiteId?: string
  domain?: SensorDomain
  /** Route the sibling links point at, so the customer side stays on its own. */
  deviceHref?: string
}) {
  const live = useIsLive()
  const role = useSessionRole()
  const canEdit = role === 'admin' || role === 'superadmin'
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(currentSiteId ?? '')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const { devices } = useManagedDevices(orgId)

  const currentDevice = useMemo(() => devices.find((d) => d.id === nodeId), [devices, nodeId])
  const effDomain: SensorDomain = domain || (currentDevice?.domain as SensorDomain) || (nodeId.startsWith('tr-') || nodeId.startsWith('tr') ? 'transformer' : 'carbonNode')

  // The roster is the source of truth for the current assignment; seeding state
  // from a prop that arrives after the first render would leave the select on
  // "unassigned" for a device that has a site.
  useEffect(() => { setSiteId(currentSiteId ?? '') }, [currentSiteId])

  const load = useCallback(() => {
    if (!live || !orgId) { setSites([]); return }
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSites(r.sites ?? []) })
    return () => { cancelled = true }
  }, [live, orgId])

  useEffect(() => load(), [load])

  const site = useMemo(() => sites.find((s) => s.id === siteId) ?? null, [sites, siteId])
  const siblings = useMemo(
    () => (siteId ? devices.filter((d) => d.siteId === siteId && d.id !== nodeId) : []),
    [devices, siteId, nodeId],
  )

  const assign = async (next: string) => {
    const previous = siteId
    setSiteId(next)
    setSaving(true)
    // siteId only — see the note at the top of this file.
    const r = await api.setNodeLocation(nodeId, { siteId: next || null })
    setSaving(false)
    if (r?.ok) {
      toast.success(next ? `Moved to ${sites.find((s) => s.id === next)?.name ?? next}` : 'Removed from its site')
    } else {
      setSiteId(previous)
      toast.error('Could not change the site — the device is still where it was')
    }
  }

  const addSite = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const r = await api.saveSite(orgId, { name })
    setSaving(false)
    if (!r?.ok) { toast.error('Could not create the site'); return }
    setNewName(''); setAdding(false)
    // Show it immediately rather than waiting on the refetch, then assign to it —
    // creating a site from this page only ever means "this device goes there".
    setSites((s) => [...s, { id: r.id, name, address: null, lat: null, lng: null }].sort((a, b) => a.name.localeCompare(b.name)))
    await assign(r.id)
    load()
  }

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Building2 size={14} className="text-indigo-400" /> Site
        </h3>
        {saving && <Loader2 size={13} className="animate-spin text-indigo-400" />}
      </div>

      {!live ? (
        <p className="text-xs text-slate-600 py-3 text-center">Switch to Live mode to assign this device to a site.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {canEdit ? (
              adding ? (
                <div className="flex gap-2">
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addSite(); if (e.key === 'Escape') setAdding(false) }}
                    placeholder="Site name — e.g. Rayong Plant 2"
                    className="flex-1 text-xs rounded-lg px-3 py-2 text-white outline-none"
                    style={{ background: '#0d1117', border: '1px solid #6366f1' }} />
                  <button onClick={addSite} disabled={saving || !newName.trim()}
                    className="px-3 rounded-lg text-white disabled:opacity-40" style={{ background: '#6366f1' }}>
                    <Check size={14} />
                  </button>
                  <button onClick={() => { setAdding(false); setNewName('') }} className="px-3 rounded-lg text-xs text-slate-400" style={inset}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select value={siteId} onChange={(e) => assign(e.target.value)} disabled={saving}
                    className="flex-1 text-xs rounded-lg px-3 py-2 text-white outline-none disabled:opacity-50" style={inset}>
                    <option value="">— not assigned to a site —</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => setAdding(true)} title="Create a site and move this device to it"
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white" style={inset}>
                    <Plus size={12} /> New
                  </button>
                </div>
              )
            ) : (
              <div className="text-sm text-slate-200">{site?.name ?? <span className="text-slate-600">Not assigned to a site</span>}</div>
            )}

            {site && (
              <div className="rounded-lg px-3 py-2 space-y-1" style={inset}>
                {site.address && <div className="text-[11px] text-slate-400">{site.address}</div>}
                <div className="text-[10px] text-slate-600 flex items-center gap-1">
                  <MapPin size={10} />
                  {site.lat != null && site.lng != null
                    ? `${Number(site.lat).toFixed(5)}, ${Number(site.lng).toFixed(5)}`
                    : 'no coordinate set for this site'}
                </div>
              </div>
            )}
            {effDomain === 'transformer' ? (
              <Link
                href={role === 'admin' || role === 'superadmin' ? `/admin/map?focus=${encodeURIComponent(nodeId)}` : `/customer/map?focus=${encodeURIComponent(nodeId)}`}
                className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                <ExternalLink size={11} /> View on Geographic Map
              </Link>
            ) : canEdit ? (
              <Link
                href={role === 'admin' || role === 'superadmin' ? '/admin/floorplans' : '/customer/floorplans'}
                className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                <ExternalLink size={11} /> Pin this unit on the site’s floor plan
              </Link>
            ) : null}
            {sites.length === 0 && canEdit && !adding && (
              <p className="text-[11px] text-slate-600">
                This organization has no sites yet. Create one and every device you assign to it groups here.
              </p>
            )}
          </div>

          {/* What else is at this site — the reason to know the site at all. */}
          <div>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">
              Also at this site {siteId ? <span className="text-slate-700">({siblings.length})</span> : null}
            </div>
            {!siteId ? (
              <p className="text-[11px] text-slate-600">Assign a site to see the other devices there.</p>
            ) : siblings.length === 0 ? (
              <p className="text-[11px] text-slate-600">This is the only device at {site?.name ?? 'this site'}.</p>
            ) : (
              <div className="space-y-1 max-h-[168px] overflow-y-auto pr-1">
                {siblings.map((d) => (
                  <Link key={d.id} href={`${deviceHref}?id=${encodeURIComponent(d.id)}`}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg group" style={inset}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: d.status === 'online' ? '#4ade80' : '#6b7280' }} />
                    <span className="text-[11px] text-slate-300 truncate group-hover:text-indigo-400">{d.name}</span>
                    <span className="ml-auto text-[9px] text-slate-600 font-mono flex-shrink-0">{d.id}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
