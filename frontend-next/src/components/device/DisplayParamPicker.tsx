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
//
// This picker is always opened FROM one device's page, so it saves to that
// device unless the admin explicitly widens the scope. It used to default the
// "apply to every device" box to CHECKED, which meant the ordinary act of
// opening a transformer, ticking the parameters you want on it and pressing
// Save silently rewrote the organization-wide row — and every other
// transformer changed with it. Widening the blast radius past the device you
// are looking at is now an explicit, single-click opt-in, and the footer spells
// out what Save is about to affect either way.
//
// Scope is a set of DEVICES, not a boolean. "This device" and "every device in
// the organization" were the only two answers, and on an ETERNITY fleet
// neither is usually the right one: transformers of different specs publish
// different MQTT payloads, so a list that suits this unit is wrong org-wide —
// but repeating it one device at a time across the four units of the same
// model is exactly the tedium that makes people not bother. Each selected
// device still gets its OWN row, so applying to several does not link them.

import { useEffect, useMemo, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { useParamLabels, schemaLabel } from '@/lib/useParamLabels'
import type { SensorDomain } from '@/types/fleet'
import type { DisplayParamScope, ParamLayout } from '@/lib/api'
import { X, SlidersHorizontal, Save, LayoutGrid, Rows3 } from 'lucide-react'
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
  // Card vs list per key (migrate-v37). A key with no entry renders as a card
  // — the layout every selection had before this existed, so an untouched
  // save changes nothing.
  const [layout, setLayout] = useState<Record<string, ParamLayout>>({})
  const layoutOf = (k: string): ParamLayout => layout[k] ?? 'card'
  const setKeyLayout = (k: string, v: ParamLayout) => setLayout((l) => ({ ...l, [k]: v }))
  // Custom display names. `labels` is what the device currently renders with
  // (org default + this device's overrides); `draft` is what the inputs hold.
  // Only keys the admin actually changed are sent, so a save never rewrites a
  // name they did not touch.
  const { labels, labelOf, refetch: refetchLabels } = useParamLabels(orgId, domain, nodeId)
  const [draft, setDraft] = useState<Record<string, string>>({})
  // WHICH devices this save writes to. Was a single "apply to every
  // transformer in this organization" checkbox — two choices, neither of them
  // usually right: on an ETERNITY fleet each transformer can publish a
  // different MQTT payload depending on its spec, so a parameter list that
  // suits this unit is wrong for the whole org and tedious to repeat one
  // device at a time. 'targets' is the set of device ids to write; 'org' means
  // the organization-wide default row instead.
  const [scopeMode, setScopeMode] = useState<'devices' | 'org'>('devices')
  const [targets, setTargets] = useState<string[]>([])
  const [pickDevices, setPickDevices] = useState(false)
  // '' = everyone in the organization (the row departments inherit).
  const [deptId, setDeptId] = useState('')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  // The org's devices of this product — the candidates a selection can be
  // applied to. Same roster every other admin screen reads.
  const { devices: roster } = useManagedDevices(orgId, domain)
  const fleet = useMemo(
    () => roster.filter((d) => !d.domain || d.domain === domain),
    [roster, domain])

  // Opened FROM one device, so that device is the default target — Save still
  // means "this device" until the admin widens it deliberately.
  useEffect(() => { setTargets([nodeId]); setScopeMode('devices') }, [nodeId])

  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.departments(orgId).then((rows) => {
      if (!cancelled && rows) setDepartments(rows as { id: string; name: string }[])
    })
    return () => { cancelled = true }
  }, [orgId])

  const uniqueAvailable = useMemo(() => Array.from(new Set(available)), [available])

  // Re-read whenever the department changes: the picker must show what THAT
  // scope currently holds, not what the last one did.
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.displayParams(orgId, domain, nodeId, deptId).then((r) => {
      if (cancelled || !r) return
      const loadedScope = r.scope ?? 'none'
      const loadedKeys = r.paramKeys ?? []
      setScope(loadedScope)
      setLayout(r.layout ?? {})
      // If this specific device has an explicit selection (node or node+dept):
      if (loadedScope.startsWith('node') && loadedKeys.length > 0) {
        setSelected(loadedKeys)
      } else if (loadedScope === 'org' && loadedKeys.length > 0) {
        // If inheriting an org-wide default from a device with different telemetry:
        const matches = loadedKeys.filter((k) => uniqueAvailable.includes(k))
        if (matches.length > 0) {
          setSelected(loadedKeys)
        } else {
          setSelected([...uniqueAvailable])
        }
      } else {
        setSelected([...uniqueAvailable])
      }
      // Deliberately NOT re-derived from the loaded scope. Widening scope is always an explicit choice.
      setScopeMode('devices')
      setTargets([nodeId])
    })
    return () => { cancelled = true }
  }, [orgId, domain, nodeId, deptId, uniqueAvailable])

  const toggle = (k: string) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  // What the input shows: the admin's unsaved edit, else the name in force.
  const nameOf = (k: string) => draft[k] ?? labelOf(k)
  const allSelected = uniqueAvailable.length > 0 && uniqueAvailable.every((k) => selected.includes(k))

  const deviceWord = domain === 'transformer' ? 'transformer' : 'device of this product'
  const deptName = deptId ? (departments.find((d) => d.id === deptId)?.name ?? 'that department') : ''
  // Exactly what Save writes — spelled out rather than left to be inferred
  // from a checkbox, because the two scopes differ by the entire fleet.
  const suffix = deptName ? ` — ${deptName} only` : ''
  const target = scopeMode === 'org'
    ? `every ${deviceWord} in this organization${suffix}`
    : targets.length === 0
      ? 'nothing — pick at least one device'
      : targets.length === 1
        ? `${targets[0] === nodeId ? 'this device only' : (fleet.find((d) => d.id === targets[0])?.name ?? targets[0])}${suffix}`
        : `${targets.length} selected devices${suffix}`
  // The device is showing a list it did not set itself.
  const inherited = selected.length > 0 && !String(scope).startsWith('node')

  const save = async () => {
    setBusy(true)
    // Only the names actually edited, and only where they differ from what is
    // already in force — a save must not turn an inherited name into a copy
    // owned by this scope just because its input was rendered.
    const changed: Record<string, string> = {}
    for (const [k, v] of Object.entries(draft)) {
      const now = labels[k] ?? ''
      const next = v.trim()
      // Typing the built-in name back is a revert, not a custom name worth storing.
      const normalised = next === schemaLabel(domain, k) ? '' : next
      if (normalised !== now) changed[k] = normalised
    }
    // Only for the keys actually being saved — a layout choice made for a key
    // that gets deselected here has nothing to attach to.
    const layoutOut: Record<string, ParamLayout> = {}
    for (const k of selected) layoutOut[k] = layoutOf(k)
    const [dp, pl] = await Promise.all([
      api.setDisplayParams(orgId, {
        domain,
        ...(scopeMode === 'org' ? { nodeId: null } : { nodeIds: targets }),
        departmentId: deptId || null, paramKeys: selected, layout: layoutOut,
      }),
      Object.keys(changed).length
        ? api.setParamLabels(orgId, { domain, ...(scopeMode === 'org' ? { nodeId: null } : { nodeIds: targets }), labels: changed })
        : Promise.resolve({ ok: true, set: 0, cleared: 0 }),
    ])
    setBusy(false)
    if (!dp) { toast.error('Could not save the parameter selection'); return }
    if (!pl) { toast.error('Parameters saved, but the custom names were not'); return }
    const renamed = Object.keys(changed).length
    toast.success(
      (selected.length
        ? `${selected.length} parameter${selected.length === 1 ? '' : 's'}`
        : 'Cleared — every parameter shown')
      + (renamed ? `, ${renamed} renamed` : '')
      + ` · ${target}`,
    )
    // Applying to devices other than the one on screen changes pages the admin
    // cannot see from here — say how many, so a mis-click is noticed now
    // rather than discovered on another device later.
    if (scopeMode === 'devices' && targets.length > 1) {
      toast(`${targets.length} devices updated`, { icon: '📋' })
    }
    setDraft({})
    refetchLabels()
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
            {uniqueAvailable.length} parameter{uniqueAvailable.length === 1 ? '' : 's'} reported by this device.
            {selected.length === 0 && ' Nothing selected — every parameter is shown.'}
          </p>
          {/* Say where the values on screen came from, so an admin does not
              mistake a list this device merely INHERITS for one it owns —
              editing an inherited list used to overwrite it for the whole
              fleet. */}
          {inherited && (
            <p className="text-[11px] text-amber-400">
              Inherited from the {scope === 'org' || scope === 'node' ? 'organization-wide' : 'shared'} selection — this device has no
              selection of its own yet. Saving gives it one, leaving the shared list untouched.
            </p>
          )}
          {String(scope).startsWith('node') && (
            <p className="text-[11px] text-slate-600">Currently set for this device only.</p>
          )}
        </div>

        <div className="p-5 grid grid-cols-2 gap-1.5 overflow-y-auto">
          {uniqueAvailable.length === 0 && (
            <p className="col-span-2 text-xs text-slate-600">This device has not reported any readings yet.</p>
          )}
          {/* Each box: tick on the left, the EDITABLE display name next to it,
              a card/list toggle, and the device's raw MQTT key pinned right.
              The key is what the firmware actually sends and is never renamed
              — it stays visible so an admin can always tell which wire value
              a name belongs to, which matters most on exactly the keys worth
              renaming (RHamb, Tbox, THD_VoltCA…). */}
          {uniqueAvailable.map((k) => {
            const on = selected.includes(k)
            const isList = layoutOf(k) === 'list'
            return (
              <div key={k}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                style={on ? { background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' } : inset}>
                <button onClick={() => toggle(k)} aria-label={`${nameOf(k)} — ${on ? 'shown' : 'hidden'}`}
                  className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[9px] text-white"
                  style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>{on ? '✓' : ''}</button>
                <input
                  value={nameOf(k)}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  placeholder={schemaLabel(domain, k)}
                  maxLength={120}
                  title="Display name — edit to rename this parameter on the dashboard"
                  className={`flex-1 min-w-0 bg-transparent text-xs text-left outline-none focus:underline decoration-indigo-400 ${on ? 'text-white' : 'text-slate-400'}`}
                />
                {/* Card = a full sensor card with a sparkline; list = one
                    dense row. Only matters once the key is shown, but stays
                    clickable either way so an admin can set it up in advance. */}
                <button
                  onClick={() => setKeyLayout(k, isList ? 'card' : 'list')}
                  title={isList ? 'Compact row — click to show as a full card' : 'Full card — click to show as a compact row'}
                  className="p-1 rounded flex-shrink-0"
                  style={{ color: on ? (isList ? '#94a3b8' : '#818cf8') : '#475569' }}>
                  {isList ? <Rows3 size={12} /> : <LayoutGrid size={12} />}
                </button>
                <span className="text-[9px] text-slate-600 font-mono text-right shrink-0 max-w-[35%] truncate" title={`MQTT key: ${k}`}>{k}</span>
              </div>
            )
          })}
        </div>

        <div className="p-5 space-y-3" style={{ borderTop: '1px solid #1e2433' }}>
          {/* Which devices Save writes to. Three real answers, not two: this
              device, a chosen set of devices (same model / same payload), or
              the organization-wide default. The middle one is the common case
              on an ETERNITY fleet and had no way to be expressed at all. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">Apply to</span>
            <button onClick={() => { setScopeMode('devices'); setTargets([nodeId]); setPickDevices(false) }}
              className="text-[11px] px-2.5 py-1.5 rounded-md transition-colors"
              style={scopeMode === 'devices' && targets.length === 1 && targets[0] === nodeId
                ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1', color: '#fff' }
                : { ...inset, color: '#94a3b8' }}>
              This device
            </button>
            <button onClick={() => { setScopeMode('devices'); setPickDevices(true) }}
              className="text-[11px] px-2.5 py-1.5 rounded-md transition-colors"
              style={scopeMode === 'devices' && !(targets.length === 1 && targets[0] === nodeId)
                ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1', color: '#fff' }
                : { ...inset, color: '#94a3b8' }}>
              Selected devices{scopeMode === 'devices' && targets.length > 1 ? ` (${targets.length})` : '…'}
            </button>
            <button onClick={() => { setScopeMode('org'); setPickDevices(false) }}
              className="text-[11px] px-2.5 py-1.5 rounded-md transition-colors"
              style={scopeMode === 'org'
                ? { background: 'rgba(251,191,36,0.15)', border: '1px solid #f59e0b', color: '#fbbf24' }
                : { ...inset, color: '#94a3b8' }}>
              Every {deviceWord}
            </button>
          </div>

          {/* The device list. Shown on demand so the ordinary single-device
              save stays a two-click operation. */}
          {pickDevices && scopeMode === 'devices' && (
            <div className="rounded-lg p-2 max-h-[168px] overflow-y-auto space-y-1" style={inset}>
              <div className="flex items-center gap-2 px-1 pb-1">
                <button onClick={() => setTargets(fleet.map((d) => d.id))}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300">Select all {fleet.length}</button>
                <button onClick={() => setTargets([nodeId])}
                  className="text-[10px] text-slate-500 hover:text-white">Just this one</button>
                <span className="ml-auto text-[10px] text-slate-600">{targets.length} selected</span>
              </div>
              {fleet.length === 0 && <p className="text-[11px] text-slate-600 px-1 py-2">No other devices of this product yet.</p>}
              {fleet.map((d) => {
                const on = targets.includes(d.id)
                return (
                  <button key={d.id}
                    onClick={() => setTargets((t) => (t.includes(d.id) ? t.filter((x) => x !== d.id) : [...t, d.id]))}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left"
                    style={on ? { background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' } : { border: '1px solid transparent' }}>
                    <span className="w-3 h-3 rounded flex-shrink-0 flex items-center justify-center text-[8px] text-white"
                      style={on ? { background: '#6366f1' } : { border: '1px solid #334155' }}>{on ? '✓' : ''}</span>
                    <span className="text-[11px] text-white truncate flex-1 min-w-0">{d.name}</span>
                    {d.id === nodeId && <span className="text-[9px] text-indigo-400 flex-shrink-0">this one</span>}
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{d.id}</span>
                  </button>
                )
              })}
              <p className="text-[10px] text-slate-600 px-1 pt-1">
                Each device gets its own copy of this list — applying to several does not link them, so one can be
                changed later without touching the rest.
              </p>
            </div>
          )}

          {/* The scopes differ by the whole fleet, so Save states which one it
              is instead of leaving it to be read off a control. */}
          <p className="text-[11px]" style={{ color: scopeMode === 'org' ? '#fbbf24' : '#64748b' }}>
            Saving affects: <span className="font-semibold">{target}</span>
          </p>
          <div className="flex gap-3">
            <button onClick={save} disabled={busy || (scopeMode === 'devices' && targets.length === 0)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
              <Save size={15} /> {busy ? 'Saving…' : 'Save'}
            </button>
            {/* Was a single "Show all" that CLEARED the selection: correct in
                storage terms (no rows = show everything) but it left every box
                unticked, so the button looked broken. Ticking all is what it
                appears to do, so that is what it now does — and "Clear" keeps
                the genuinely different unconfigured state reachable, which
                also lets a NEW key the device starts reporting later appear on
                its own instead of being excluded by a frozen list. */}
            <button onClick={() => setSelected(allSelected ? [] : [...uniqueAvailable])}
              disabled={!uniqueAvailable.length}
              className="px-4 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white disabled:opacity-40" style={inset}>
              {allSelected ? 'Clear' : 'Select all'}
            </button>
          </div>
          {allSelected && (
            <p className="text-[11px] text-slate-600">
              All {uniqueAvailable.length} selected. Clearing instead leaves it unconfigured — which also shows everything,
              including any new parameter this device starts reporting later.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
