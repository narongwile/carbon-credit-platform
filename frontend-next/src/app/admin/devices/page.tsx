'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { getDepartmentsByOrg } from '@/lib/orgData'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { api, isLive } from '@/lib/api'
import { useOrgPhotoCovers } from '@/lib/useNodePhotos'
import { NodeThumb, NodePhotoPreview } from '@/components/device/NodePhotoThumb'
import PhotoStrip from '@/components/device/PhotoStrip'
import { DOMAIN_META } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'
import { HardDrive, X, Wifi, WifiOff, MapPin, PlugZap } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Dept { id: string; name: string }

export default function DeviceManagementPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'

  // Real fleet (GET /api/fleet in Live mode, with retry — useManagedDevices),
  // so a zero-touch-registered device is manageable here. Live departments
  // (matches /admin/pending), mock as the demo/offline fallback.
  const { devices: roster, fromBackend } = useManagedDevices(orgId)
  const [depts, setDepts] = useState<Dept[]>(getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!isLive()) { setDepts(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setDepts(r as Dept[]) })
    return () => { cancelled = true }
  }, [orgId])

  // Local overlay of a just-saved edit, applied on top of the fleet until the
  // roster itself refetches — same shape the rest of this app uses.
  const [override, setOverride] = useState<Record<string, ManagedDevice>>({})
  const devices = roster.map((d) => override[d.id] ?? d)
  const [editing, setEditing] = useState<ManagedDevice | null>(null)
  // Cover photo per device, one request for the whole table — a column of ids
  // is a column of ids; a column of pictures is a fleet you can recognise.
  const covers = useOrgPhotoCovers(orgId)
  const [previewing, setPreviewing] = useState<ManagedDevice | null>(null)

  const deptName = (id: string) => depts.find((d) => d.id === id)?.name ?? id

  const save = async (d: ManagedDevice, patch: { name: string; departmentId: string | null; visibleTo: string[] | null; mergeInto?: string | null; grafanaUrl?: string | null }) => {
    const next: ManagedDevice = {
      ...d, name: patch.name, departmentIds: patch.departmentId ? [patch.departmentId] : [],
      ...(patch.grafanaUrl !== undefined ? { grafanaUrl: patch.grafanaUrl } : {}),
    }
    if (!isLive() || !fromBackend) {
      toast.success(`Saved ${patch.name} (demo)`)
      setOverride((o) => ({ ...o, [d.id]: next }))
      setEditing(null)
      return
    }
    // Two writes: the profile (name + owning department) and the visibility
    // grants. visibleTo is null when there is nothing to write — either the
    // modal was still loading the grants, or the admin never touched that
    // control. Both cases must skip the write: sending a set that was never
    // read (or never edited) would turn an inherited-from-owner device into
    // one with explicit grants pinned to its PREVIOUS owner. See grantsChanged
    // in DeviceModal for the bug that caused.
    const [prof, grants] = await Promise.all([
      api.updateNodeProfile(d.id, {
        name: patch.name,
        departmentId: patch.departmentId,
        // Only sent when the admin actually changed it — an undefined key
        // leaves the linkage alone, same partial-update rule as every other
        // field here.
        ...(patch.mergeInto !== undefined ? { mergeInto: patch.mergeInto } : {}),
        ...(patch.grafanaUrl !== undefined ? { grafanaUrl: patch.grafanaUrl } : {}),
      }),
      patch.visibleTo === null ? Promise.resolve({ ok: true }) : api.setNodeDepartments(d.id, patch.visibleTo),
    ])
    if (!prof?.ok) { toast.error('Save failed'); return }
    if (!grants?.ok) { toast.error('Device saved, but its department access was not'); return }
    if (patch.mergeInto) {
      toast.success(prof.readingsMoved
        ? `${patch.name} is now a second feed · ${prof.readingsMoved} stored readings moved across`
        : `${patch.name} is now a second feed`)
    } else {
      toast.success(`Saved ${patch.name}`)
    }
    setOverride((o) => ({ ...o, [d.id]: next }))
    setEditing(null)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Device Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Rename and reassign devices already on your fleet. New hardware registers itself the moment it sends telemetry — approve it from Pending Devices.</p>
        </div>
        <Link href="/admin/pending" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <PlugZap size={15} /> Pending Devices
        </Link>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Device', 'Serial', 'Domain', 'Location', 'Theme', 'Department', 'Status'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-white/3 cursor-pointer" style={{ borderBottom: '1px solid #1e2433' }} onClick={() => setEditing(d)}>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    {covers[d.id] ? (
                      <NodeThumb nodeId={d.id} cover={covers[d.id]} name={d.name} size={34}
                        onOpen={() => setPreviewing(d)} />
                    ) : (
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}><HardDrive size={14} className="text-indigo-400" /></div>
                    )}
                    <span className="text-white font-medium">{d.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 font-mono text-xs text-slate-400">{d.serial}</td>
                <td className="py-3 px-4">
                  {d.domain ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: DOMAIN_META[d.domain].accent, background: `${DOMAIN_META[d.domain].accent}1f` }}>
                      {DOMAIN_META[d.domain].platform}
                    </span>
                  ) : <span className="text-slate-400 text-xs">{d.deviceType}</span>}
                </td>
                <td className="py-3 px-4 text-slate-400"><span className="flex items-center gap-1"><MapPin size={11} className="text-slate-600" />{d.location}</span></td>
                <td className="py-3 px-4">
                  <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ color: d.theme === 'fix' ? '#22c55e' : '#a78bfa', background: d.theme === 'fix' ? 'rgba(34,197,94,0.12)' : 'rgba(167,139,250,0.12)' }}>{d.theme === 'fix' ? 'FIX' : 'Free Style'}</span>
                </td>
                <td className="py-3 px-4 text-xs text-slate-400">{d.departmentIds.map(deptName).join(', ') || '—'}</td>
                <td className="py-3 px-4">
                  {d.status === 'online'
                    ? <span className="flex items-center gap-1 text-xs text-green-400"><Wifi size={12} /> online</span>
                    : <span className="flex items-center gap-1 text-xs text-slate-500"><WifiOff size={12} /> offline</span>}
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                No devices yet. New hardware appears in <Link href="/admin/pending" className="text-indigo-400 hover:underline">Pending Devices</Link> the moment it connects.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <DeviceModal
          device={editing}
          departments={depts}
          others={devices.filter((d) => d.id !== editing.id)}
          onClose={() => setEditing(null)}
          onSave={(patch) => save(editing, patch)}
        />
      )}

      {previewing && (
        <NodePhotoPreview nodeId={previewing.id} deviceName={previewing.name} canEdit
          onClose={() => setPreviewing(null)} />
      )}
    </div>
  )
}

function DeviceModal({ device, departments, others, onClose, onSave }: {
  device: ManagedDevice
  departments: Dept[]
  /** The other devices in this org — merge targets. */
  others: ManagedDevice[]
  onClose: () => void
  onSave: (patch: { name: string; departmentId: string | null; visibleTo: string[] | null; mergeInto?: string | null; grafanaUrl?: string | null }) => void
}) {
  const [name, setName] = useState(device.name)
  const [deptId, setDeptId] = useState<string | null>(device.departmentIds[0] ?? null)
  // The Free-Style dashboard's real, persisted link (migrate-v45) — set here
  // regardless of the device's current theme, since a viewer can switch to
  // the Free Style tab on ANY device, not only ones defaulted to it.
  const [grafanaUrl, setGrafanaUrl] = useState(device.grafanaUrl ?? '')
  // Which departments may SEE this device (node_departments, migrate-v35) —
  // a SET, and a different question from the owning department above (which
  // is where its alarms are routed). null while the grants are still loading,
  // so an unsaved modal can never write an empty set it never read.
  const [visibleTo, setVisibleTo] = useState<string[] | null>(null)
  const [loadedGrants, setLoadedGrants] = useState<string[] | null>(null)
  // Second-feed linkage (nodes.merge_into). undefined = untouched, so a save
  // that never opened this control leaves the linkage exactly as it was.
  const [mergeInto, setMergeInto] = useState<string | null | undefined>(undefined)
  // Devices already linked INTO this one. They are hidden from every list
  // (GET /api/fleet filters merge_into IS NULL), so this is the only place
  // they can be seen — and the only way to undo a merge.
  const [feeds, setFeeds] = useState<{ id: string; name: string | null }[]>([])
  const [feedBusy, setFeedBusy] = useState<string | null>(null)
  const loadFeeds = useCallback(() => {
    if (!isLive()) { setFeeds([]); return }
    api.nodeFeeds(device.id).then((r) => setFeeds(r?.feeds ?? []))
  }, [device.id])
  useEffect(() => { loadFeeds() }, [loadFeeds])

  const unlinkFeed = async (feedId: string) => {
    setFeedBusy(feedId)
    const r = await api.updateNodeProfile(feedId, { mergeInto: null })
    setFeedBusy(null)
    if (r?.ok) { toast.success('Unlinked — it is its own device again'); loadFeeds() }
    else toast.error('Could not unlink that feed')
  }
  useEffect(() => {
    if (!isLive()) { setVisibleTo([]); setLoadedGrants([]); return }
    let cancelled = false
    api.nodeDepartments(device.id).then((r) => {
      if (cancelled || !r) return
      // `effective` is what the rule applies today (grants, or the owning
      // department when there are none) — pre-selecting it means the admin
      // edits the real current state instead of an empty list that would read
      // as "nobody sees this".
      setVisibleTo(r.effective ?? [])
      setLoadedGrants(r.effective ?? [])
    })
    return () => { cancelled = true }
  }, [device.id])

  // Which departments have a PRODUCT ACCESS policy that would still hide this
  // device even after being granted it here. The two settings are on
  // different screens (this one, and User Management -> Product Access) with
  // nothing connecting them — an admin granting visibility here has no way to
  // know a department's product policy silently overrides it, which is
  // exactly the gap that made a correctly-saved grant look like it did
  // nothing. A department with NO product_access rows at all is never
  // blocked (fail-open, migrate-v29's rule, now applied consistently); one
  // WITH rows blocks this device's domain only if none of those rows cover
  // it, or the one that does is explicitly 'none'.
  const [blockedDepts, setBlockedDepts] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isLive() || !device.domain || departments.length === 0) { setBlockedDepts(new Set()); return }
    let cancelled = false
    Promise.all(departments.map((d) => api.productAccess('department', d.id).then((rows) => ({ id: d.id, rows })))).then((results) => {
      if (cancelled) return
      const blocked = new Set<string>()
      for (const { id, rows } of results) {
        if (!rows || rows.length === 0) continue
        const forDomain = rows.find((r) => r.domain === device.domain)
        if (!forDomain || forDomain.level === 'none') blocked.add(id)
      }
      setBlockedDepts(blocked)
    })
    return () => { cancelled = true }
  }, [device.domain, departments])

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  // Did the admin actually touch the visibility control? The list is PRE-FILLED
  // with `effective`, which falls back to the OWNING department when a device
  // has no grants of its own — so an untouched control still holds a non-empty
  // set. Writing that back would turn "no grants, inherits its owner" into an
  // explicit grant to whoever the owner USED TO BE, and grants outrank the
  // owner in deptVisible. Changing only the owning department then had no
  // effect at all: the device stayed visible to the old department and
  // invisible to the new one. Reproduced against a live DB before fixing.
  const grantsChanged = visibleTo !== null && loadedGrants !== null && !sameSet(visibleTo, loadedGrants)
  const grafanaChanged = grafanaUrl.trim() !== (device.grafanaUrl ?? '')
  const dirty = name.trim() !== device.name
    || deptId !== (device.departmentIds[0] ?? null)
    || mergeInto !== undefined
    || grantsChanged
    || grafanaChanged

  const toggleVisible = (id: string) =>
    setVisibleTo((v) => (v === null ? v : v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))

  const domainMeta = device.domain ? DOMAIN_META[device.domain] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">Edit Device</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Device Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Serial / MAC</label>
              <input value={device.serial} disabled
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-500 font-mono outline-none cursor-not-allowed" style={inset} />
              <p className="text-[11px] text-slate-600 mt-1">Auto-recorded from the device&apos;s own MQTT identity — nothing to type.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Photos</label>
            <PhotoStrip nodeId={device.id} orgId={device.orgId} deviceName={device.name} canEdit
              emptyHint="No photo yet — add the overview and the nameplate" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Sensor Domain</label>
            <div className="inline-flex px-3 py-2 rounded-lg text-xs font-semibold"
              style={domainMeta ? { color: domainMeta.accent, background: `${domainMeta.accent}1f`, border: `1px solid ${domainMeta.accent}55` } : inset}>
              {domainMeta ? domainMeta.platform : device.deviceType}
            </div>
            <p className="text-[11px] text-slate-600 mt-1">Set once, from the device&apos;s telemetry topic, when it was approved in Pending Devices — not editable here.</p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Owning department</label>
            <p className="text-[11px] text-slate-600 mb-1.5">Whose device this is — where its alarms are routed.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setDeptId(null)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', deptId === null ? 'text-white' : 'text-slate-400')}
                style={deptId === null ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                — none —
              </button>
              {departments.map((d) => (
                <button key={d.id} onClick={() => setDeptId(d.id)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', deptId === d.id ? 'text-white' : 'text-slate-400')}
                  style={deptId === d.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                  {d.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Visible to departments</label>
            <p className="text-[11px] text-slate-600 mb-1.5">
              Who may open this device at all. Independent of the owner above — grant it to several teams (an internal
              one and the customer, say) and every one of them sees it. Leave every department off and it falls back to
              the owning department, or to the whole organization if it has none — it is never hidden from everybody.
            </p>
            {visibleTo === null ? (
              <p className="text-[11px] text-slate-600">Loading…</p>
            ) : departments.length === 0 ? (
              <p className="text-[11px] text-slate-600">This organization has no departments yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {departments.map((d) => {
                  const on = visibleTo.includes(d.id)
                  const blocked = on && blockedDepts.has(d.id)
                  return (
                    <button key={d.id} onClick={() => toggleVisible(d.id)} title={blocked ? `${d.name} has a product-access policy that does not cover ${domainMeta?.platform ?? device.deviceType} — granting visibility here will not be enough on its own` : undefined}
                      className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', on ? 'text-white' : 'text-slate-400')}
                      style={blocked ? { background: 'rgba(245,158,11,0.14)', border: '1px solid #f59e0b' } : on ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : inset}>
                      {blocked ? '⚠ ' : on ? '✓ ' : ''}{d.name}
                    </button>
                  )
                })}
              </div>
            )}
            {visibleTo !== null && visibleTo.length === 0 && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                Nothing granted — falls back to {deptId ? (departments.find((d) => d.id === deptId)?.name ?? 'the owning department') : 'everyone in this organization'}.
              </p>
            )}
            {/* Grants REPLACE the owning department, they do not add to it
                (deptVisible: `granted.length ? granted : [owner]`). So an
                owner left out of a non-empty grant list stops being able to
                open the device it owns — while still receiving its alarms,
                since notify() routes on nodes.department_id and never reads
                these grants. Silent and genuinely confusing without this. */}
            {visibleTo !== null && visibleTo.length > 0 && deptId && !visibleTo.includes(deptId) && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                ⚠ {departments.find((d) => d.id === deptId)?.name ?? 'The owning department'} owns this device but is not in
                the list above — grants replace the owner rather than adding to it, so they will no longer be able to open it,
                even though its alarms still route to them.
              </p>
            )}
            {visibleTo !== null && visibleTo.some((id) => blockedDepts.has(id)) && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                ⚠ {visibleTo.filter((id) => blockedDepts.has(id)).map((id) => departments.find((d) => d.id === id)?.name ?? id).join(', ')} — granted here, but their Product Access
                policy does not cover {domainMeta?.platform ?? device.deviceType}. They will still not see this device until that is fixed
                under User Management → Product Access.
              </p>
            )}
          </div>
          {/* One physical transformer often publishes on TWO MQTT topics — a
              power meter sending the electrical set and a box sensor sending
              oil/gas/humidity — so it arrives as two devices, each showing
              half the parameters. Linking them here stores both topics'
              readings under the primary, and moves the readings already
              stored under this one across, so the device page shows one asset
              with everything. Pending Devices could only do this at approval;
              two devices approved separately had no way back until now. */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Second feed of</label>
            <p className="text-[11px] text-slate-600 mb-1.5">
              Only if this device is the second MQTT topic of a transformer already on the fleet. Its readings — including
              the ones already stored — move onto that device, and this one stops appearing as its own.
            </p>
            <select value={mergeInto ?? ''} onChange={(e) => setMergeInto(e.target.value || null)}
              disabled={feeds.length > 0}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" style={inset}>
              <option value="" className="bg-[#0d1117]">— standalone device —</option>
              {others.map((o) => (
                <option key={o.id} value={o.id} className="bg-[#0d1117]">{o.name} ({o.id})</option>
              ))}
            </select>
            {feeds.length > 0 && (
              <p className="text-[11px] text-slate-600 mt-1.5">
                This device is a primary — other feeds point at it, so it cannot become a second feed itself.
              </p>
            )}
            {mergeInto && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                Readings stored under {device.name} will be moved onto {others.find((o) => o.id === mergeInto)?.name ?? mergeInto}. Undo it from that device.
              </p>
            )}
          </div>

          {/* The merged-in feeds, and the only route back out of a merge:
              these devices are hidden from every list by design. */}
          {feeds.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Second feeds of this device</label>
              <p className="text-[11px] text-slate-600 mb-1.5">
                Their readings are stored under this device. They are hidden from the fleet list, so this is where to unlink them.
              </p>
              <div className="space-y-1.5">
                {feeds.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={inset}>
                    <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">{f.name || f.id}</span>
                    <span className="text-[10px] font-mono text-slate-600">{f.id}</span>
                    <button onClick={() => unlinkFeed(f.id)} disabled={feedBusy === f.id}
                      className="text-[10px] px-2 py-1 rounded-md text-slate-300 hover:text-white disabled:opacity-50"
                      style={{ border: '1px solid #1e2433' }}>
                      {feedBusy === f.id ? 'Unlinking…' : 'Unlink'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg text-xs text-slate-500 flex items-start gap-2" style={inset}>
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ color: device.theme === 'fix' ? '#22c55e' : '#a78bfa', background: device.theme === 'fix' ? 'rgba(34,197,94,0.12)' : 'rgba(167,139,250,0.12)' }}>
              {device.theme === 'fix' ? 'FIX' : 'Free Style'}
            </span>
            <span>Dashboard theme has no effect on the admin view (always shows FIX) and only sets the viewer&apos;s default, which they can switch per visit. Not editable here.</span>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Grafana dashboard (Free Style)</label>
            <p className="text-[11px] text-slate-600 mb-1.5">
              What the Free Style tab links to and, if it allows embedding, shows inline. A department manager with
              &quot;manage&quot; access to this product can also set this from the device&apos;s own page.
            </p>
            <input value={grafanaUrl} onChange={(e) => setGrafanaUrl(e.target.value)}
              placeholder="https://grafana.example.com/d/abc123/this-device"
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          </div>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={() => onSave({
            name: name.trim(), departmentId: deptId, visibleTo: grantsChanged ? visibleTo : null,
            ...(mergeInto !== undefined ? { mergeInto } : {}),
            ...(grafanaChanged ? { grafanaUrl: grafanaUrl.trim() || null } : {}),
          })} disabled={!dirty || !name.trim()}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
            Save Changes
          </button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
