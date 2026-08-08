'use client'

// ---------------------------------------------------------------------------
// Edit a device's "Owning department" and "Visible to departments" from its
// own dashboard, not just the admin Device Management table. Same two
// settings, same two endpoints (PUT /api/nodes/:id/profile for the owner,
// PUT /api/nodes/:id/departments for the grants) — this is a second place to
// reach them, not a second implementation of what they mean.
//
// Both pieces load from ONE call, GET /api/nodes/:id/departments, whose
// `owner` field is exactly nodes.department_id — no need for the caller to
// already have the device's department loaded (admin/devices/page.tsx's
// DeviceModal gets it from the fleet row it already has; this page doesn't
// carry departmentIds at all today, so fetching it here keeps this component
// fully self-contained).
//
// grantsChanged mirrors the same guard DeviceModal uses: the picker is
// pre-filled with `effective` (falls back to the OWNER when there are no
// grants yet), so writing it back unconditionally on every save would turn
// an owner change into a grant pinned to the PREVIOUS owner — the exact bug
// fixed there. Only write the grants when they actually differ from what
// was loaded.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { X, Save, Loader2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Dept { id: string; name: string }

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

export default function DepartmentAccessEditor({
  nodeId, orgId, deviceName, domain, onClose, onSaved,
}: {
  nodeId: string
  orgId: string
  deviceName?: string
  /** This device's domain (transformer/carbonNode/bloodBox) — used only to
   *  check whether a department's Product Access policy would still hide it
   *  after being granted visibility here. Omit to skip that check (the
   *  warning simply never shows) rather than guess. */
  domain?: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [departments, setDepartments] = useState<Dept[] | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [loadedOwner, setLoadedOwner] = useState<string | null | undefined>(undefined)
  const [visibleTo, setVisibleTo] = useState<string[] | null>(null)
  const [loadedGrants, setLoadedGrants] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setDepartments(r as Dept[]) })
    api.nodeDepartments(nodeId).then((r) => {
      if (cancelled || !r) return
      setOwnerId(r.owner ?? null)
      setLoadedOwner(r.owner ?? null)
      setVisibleTo(r.effective ?? [])
      setLoadedGrants(r.effective ?? [])
    })
    return () => { cancelled = true }
  }, [nodeId, orgId])

  // Per-user device restrictions (migrate-v42) for this org, plus the org's
  // users, so this device can show WHO is limited and whether it is in their
  // list. Restrict-only: a user listed here still cannot see the device unless
  // their department could anyway — the warning text below says so, because
  // "I ticked the box and they still cannot see it" is otherwise the obvious
  // wrong conclusion.
  const [users, setUsers] = useState<{ id: string; name?: string | null; email?: string | null; role?: string | null }[]>([])
  const [visByUser, setVisByUser] = useState<Record<string, string[]> | null>(null)
  const [savingUser, setSavingUser] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api.users(orgId).then((r) => { if (!cancelled && r) setUsers(r as { id: string; name?: string; email?: string; role?: string }[]) })
    api.nodeVisibility(orgId).then((r) => { if (!cancelled) setVisByUser(r?.byUser ?? {}) })
    return () => { cancelled = true }
  }, [orgId])

  // Toggling from HERE writes that user's whole list, because the API is
  // keyed by user (one row set per person) — this screen is a per-device view
  // onto it. Saved immediately rather than batched into the Save button below:
  // that button writes the department settings, and silently bundling a
  // different subject's access into it would make one confirmation stand for
  // two unrelated changes.
  const toggleUserVisible = async (userId: string) => {
    if (!visByUser) return
    const cur = visByUser[userId] ?? []
    const next = cur.includes(nodeId) ? cur.filter((x) => x !== nodeId) : [...cur, nodeId]
    setSavingUser(userId)
    const r = await api.setUserVisibleNodes(userId, next)
    setSavingUser(null)
    if (!r?.ok) { toast.error('Could not update that person\'s device access'); return }
    setVisByUser((m) => ({ ...(m ?? {}), [userId]: next }))
    toast.success(next.length === 0
      ? 'No longer restricted — they see every device their department allows'
      : cur.includes(nodeId) ? 'Removed from their allowed devices' : 'Added to their allowed devices')
  }

  // Same check as admin/devices/page.tsx's DeviceModal — see its comment.
  // A department with no product_access rows is never blocked (fail-open);
  // one with rows blocks this domain only if none of them cover it, or the
  // one that does is explicitly 'none'.
  const [blockedDepts, setBlockedDepts] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!domain || !departments || departments.length === 0) { setBlockedDepts(new Set()); return }
    let cancelled = false
    Promise.all(departments.map((d) => api.productAccess('department', d.id).then((rows) => ({ id: d.id, rows })))).then((results) => {
      if (cancelled) return
      const blocked = new Set<string>()
      for (const { id, rows } of results) {
        if (!rows || rows.length === 0) continue
        const forDomain = rows.find((r) => r.domain === domain)
        if (!forDomain || forDomain.level === 'none') blocked.add(id)
      }
      setBlockedDepts(blocked)
    })
    return () => { cancelled = true }
  }, [domain, departments])

  const toggleVisible = (id: string) =>
    setVisibleTo((v) => (v === null ? v : v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))

  const ownerChanged = loadedOwner !== undefined && ownerId !== loadedOwner
  const grantsChanged = visibleTo !== null && loadedGrants !== null && !sameSet(visibleTo, loadedGrants)
  const dirty = ownerChanged || grantsChanged
  const loaded = departments !== null && loadedOwner !== undefined

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    const [prof, grants] = await Promise.all([
      ownerChanged ? api.updateNodeProfile(nodeId, { departmentId: ownerId }) : Promise.resolve({ ok: true }),
      grantsChanged ? api.setNodeDepartments(nodeId, visibleTo as string[]) : Promise.resolve({ ok: true }),
    ])
    setSaving(false)
    if (!prof?.ok) { toast.error('Could not save the owning department'); return }
    if (!grants?.ok) { toast.error('Owning department saved, but visibility was not'); return }
    toast.success('Department access saved')
    onSaved?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2"><Users size={16} className="text-indigo-400" /> Department access</h2>
            {deviceName && <p className="text-[11px] text-slate-500 mt-0.5">{deviceName}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {!loaded ? (
            <p className="text-[11px] text-slate-600">Loading…</p>
          ) : (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Owning department</label>
                <p className="text-[11px] text-slate-600 mb-1.5">Whose device this is — where its alarms are routed.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setOwnerId(null)}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', ownerId === null ? 'text-white' : 'text-slate-400')}
                    style={ownerId === null ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                    — none —
                  </button>
                  {departments?.map((d) => (
                    <button key={d.id} onClick={() => setOwnerId(d.id)}
                      className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', ownerId === d.id ? 'text-white' : 'text-slate-400')}
                      style={ownerId === d.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Visible to departments</label>
                <p className="text-[11px] text-slate-600 mb-1.5">
                  Who may open this device at all. Independent of the owner above — grant it to several teams and every
                  one of them sees it. Leave every department off and it falls back to the owning department, or to the
                  whole organization if it has none — it is never hidden from everybody.
                </p>
                {departments?.length === 0 ? (
                  <p className="text-[11px] text-slate-600">This organization has no departments yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {departments?.map((d) => {
                      const on = (visibleTo ?? []).includes(d.id)
                      const blocked = on && blockedDepts.has(d.id)
                      return (
                        <button key={d.id} onClick={() => toggleVisible(d.id)} title={blocked ? `${d.name} has a Product Access policy that does not cover this device's product line — granting visibility here will not be enough on its own` : undefined}
                          className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', on ? 'text-white' : 'text-slate-400')}
                          style={blocked ? { background: 'rgba(245,158,11,0.14)', border: '1px solid #f59e0b' } : on ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : inset}>
                          {blocked ? '⚠ ' : on ? '✓ ' : ''}{d.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                {visibleTo !== null && visibleTo.some((id) => blockedDepts.has(id)) && (
                  <p className="text-[11px] text-amber-400 mt-1.5">
                    ⚠ Granted, but their Product Access policy does not cover this product line — they will still not see this
                    device until that is fixed under User Management → Product Access.
                  </p>
                )}
              </div>

              {/* Per-user restriction (migrate-v42). Deliberately separated
                  from the department control above and worded as a NARROWING,
                  because that is what it is: a person listed here still needs
                  their department to allow the device. */}
              <div style={{ borderTop: '1px solid #1e2433', paddingTop: '1rem' }}>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Limit to specific people</label>
                <p className="text-[11px] text-slate-600 mb-2">
                  Optional, and only ever <span className="text-slate-400">narrows</span> the departments above — someone listed
                  here still needs their department to allow this device. Anyone left unrestricted keeps seeing every device
                  their department allows.
                </p>
                {visByUser === null ? (
                  <p className="text-[11px] text-slate-600">Loading…</p>
                ) : users.filter((u) => u.role !== 'admin' && u.role !== 'superadmin').length === 0 ? (
                  <p className="text-[11px] text-slate-600">No non-admin users in this organization — admins always see every device.</p>
                ) : (
                  <div className="space-y-1 max-h-44 overflow-y-auto rounded-lg p-2" style={inset}>
                    {users.filter((u) => u.role !== 'admin' && u.role !== 'superadmin').map((u) => {
                      const list = visByUser[u.id]
                      const restricted = Array.isArray(list) && list.length > 0
                      const on = restricted && list.includes(nodeId)
                      return (
                        <div key={u.id} className="flex items-center justify-between gap-2 px-1.5 py-1">
                          <div className="min-w-0">
                            <div className="text-xs text-slate-300 truncate">{u.name || u.email || u.id}</div>
                            <div className="text-[10px] text-slate-600 truncate">
                              {restricted
                                ? on ? `limited to ${list.length} device${list.length === 1 ? '' : 's'}, including this one`
                                     : `limited to ${list.length} device${list.length === 1 ? '' : 's'} — not this one`
                                : 'not restricted — sees all their department allows'}
                            </div>
                          </div>
                          <button onClick={() => toggleUserVisible(u.id)} disabled={savingUser === u.id}
                            className={clsx('px-2.5 py-1 rounded-lg text-[11px] font-medium flex-shrink-0 disabled:opacity-50',
                              on ? 'text-white' : 'text-slate-400')}
                            style={on ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                            {savingUser === u.id ? '…' : on ? '✓ allowed' : restricted ? 'add' : 'limit to this'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* The one genuinely surprising transition: an unrestricted
                    person becomes restricted the moment they get a first
                    device, which REMOVES everything else they could see. */}
                <p className="text-[11px] text-amber-400/80 mt-1.5">
                  &ldquo;limit to this&rdquo; turns an unrestricted person into a restricted one — from then on they see only the
                  devices listed for them, not everything their department allows.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={save} disabled={saving || !dirty || !loaded}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
