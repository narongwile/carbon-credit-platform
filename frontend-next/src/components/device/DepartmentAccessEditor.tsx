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
