'use client'

// ---------------------------------------------------------------------------
// Choose which parameters SENSOR READINGS shows.
// ---------------------------------------------------------------------------
// The list offered here is what the DEVICE has actually reported, not a
// catalogue: a merged two-topic transformer sends about forty keys, and only the
// device itself knows which. Schema params are labelled; anything else keeps its
// wire key, because an unrecognised sensor is still a real one.
//
// Saving nothing is "not configured" and shows everything — the picker says so,
// so clearing the selection is an obvious way back rather than a way to blank
// the page.
//
// The selection is scoped to a DEPARTMENT as well as a device. Maintenance
// watching oil and dissolved gas and Operations watching load and voltage are
// different jobs on the same forty-parameter asset, and an admin has to be able
// to say so. "Everyone" writes the organization-wide row that any department
// without its own selection inherits — so configuring one team never changes
// what the others see.

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'
import type { DisplayParamScope } from '@/lib/api'
import { X, SlidersHorizontal, Save } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function DisplayParamPicker({
  orgId, domain, nodeId, available, onClose, onSaved,
}: {
  orgId: string
  domain: SensorDomain
  nodeId: string
  /** Keys this device has actually reported. */
  available: string[]
  onClose: () => void
  onSaved: (keys: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [scope, setScope] = useState<DisplayParamScope>('none')
  // Applying to the product covers every device of it, which is what an admin
  // configuring "what a transformer shows" usually means.
  const [applyToAll, setApplyToAll] = useState(true)
  // '' = everyone in the organization (the row departments inherit).
  const [deptId, setDeptId] = useState('')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.departments(orgId).then((rows) => {
      if (!cancelled && rows) setDepartments(rows as { id: string; name: string }[])
    })
    return () => { cancelled = true }
  }, [orgId])

  // Re-read whenever the department changes: the picker must show what THAT
  // scope currently holds, not what the last one did.
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.displayParams(orgId, domain, nodeId, deptId).then((r) => {
      if (cancelled || !r) return
      setSelected(r.paramKeys ?? [])
      setScope(r.scope ?? 'none')
      setApplyToAll(!String(r.scope ?? '').startsWith('node'))
    })
    return () => { cancelled = true }
  }, [orgId, domain, nodeId, deptId])

  const labelOf = (key: string) =>
    ALARM_SCHEMA[domain]?.params.find((p) => p.key === key)?.label ?? key

  const toggle = (k: string) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  const save = async () => {
    setBusy(true)
    const r = await api.setDisplayParams(orgId, {
      domain, nodeId: applyToAll ? null : nodeId, departmentId: deptId || null, paramKeys: selected,
    })
    setBusy(false)
    if (!r) { toast.error('Could not save the parameter selection'); return }
    const who = deptId ? (departments.find((d) => d.id === deptId)?.name ?? 'that department') : 'everyone'
    toast.success(selected.length
      ? `${selected.length} parameter${selected.length === 1 ? '' : 's'} for ${who}`
      : `Cleared — ${who} sees every parameter again`)
    onSaved(selected)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl max-h-[85vh] flex flex-col" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-indigo-400" /> Displayed parameters
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="px-5 pt-4 space-y-2">
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Who sees this</span>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-2 text-white outline-none" style={inset}>
              <option value="">Everyone in this organization</option>
              {departments.map((d) => <option key={d.id} value={d.id}>Only {d.name}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-slate-500">
            {available.length} parameter{available.length === 1 ? '' : 's'} reported by this device.
            {selected.length === 0 && ' Nothing selected — every parameter is shown.'}
          </p>
          {/* Say where the values on screen came from, so an admin editing a
              department does not mistake an inherited list for one they set. */}
          {deptId && (scope === 'org' || scope === 'node') && selected.length > 0 && (
            <p className="text-[11px] text-amber-400">
              Inherited from the organization-wide selection. Saving here makes it this department’s own.
            </p>
          )}
          {!deptId && (
            <p className="text-[11px] text-slate-600">
              This is the fallback every department without its own selection uses.
            </p>
          )}
          {String(scope).startsWith('node') && !applyToAll && (
            <p className="text-[11px] text-slate-600">Currently set for this device only.</p>
          )}
        </div>

        <div className="p-5 grid grid-cols-2 gap-1.5 overflow-y-auto">
          {available.length === 0 && (
            <p className="col-span-2 text-xs text-slate-600">This device has not reported any readings yet.</p>
          )}
          {available.map((k) => {
            const on = selected.includes(k)
            return (
              <button key={k} onClick={() => toggle(k)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                style={on ? { background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' } : inset}>
                <span className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[9px] text-white"
                  style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>{on ? '✓' : ''}</span>
                <span className="min-w-0">
                  <span className={`block text-xs truncate ${on ? 'text-white' : 'text-slate-400'}`}>{labelOf(k)}</span>
                  {labelOf(k) !== k && <span className="block text-[9px] text-slate-600 font-mono truncate">{k}</span>}
                </span>
              </button>
            )
          })}
        </div>

        <div className="p-5 space-y-3" style={{ borderTop: '1px solid #1e2433' }}>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
            Apply to every {domain === 'transformer' ? 'transformer' : 'device of this product'}
            {deptId ? ' for this department' : ' in this organization'}
          </label>
          <div className="flex gap-3">
            <button onClick={save} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
              <Save size={15} /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setSelected([])} className="px-4 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>
              Show all
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
