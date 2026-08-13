'use client'

// ---------------------------------------------------------------------------
// Define the org-wide MQTT payload spec for a product BEFORE any device exists.
// ---------------------------------------------------------------------------
// DisplayParamPicker (the picker device settings uses) assumes a real device
// has already reported something — its whole "available" list IS that
// device's actual last payload. That is exactly backwards for a brand-new
// organization: there is no device yet, so there is nothing to check boxes
// against. This editor goes the other way — pick from the product's known
// schema fields, or type a field name that isn't in the schema at all (real
// hardware often sends something nobody anticipated), then save.
//
// Writes to the SAME tables DisplayParamPicker does (display_params +
// param_labels, migrate-v26/v34), always with nodeId=null — the org-wide
// default row every device of this product inherits until it gets an
// override of its own. There is no device/scope picker here on purpose:
// "apply to this device" is not a question that makes sense before a device
// exists.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { schemaLabel } from '@/lib/useParamLabels'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'
import { X, ListPlus, Save, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function OrgPayloadSpecPicker({
  orgId, domain, onClose, onSaved,
}: {
  orgId: string
  domain: SensorDomain
  onClose: () => void
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [customKey, setCustomKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isLive()) { setLoading(false); return }
    let cancelled = false
    Promise.all([
      api.displayParams(orgId, domain),
      api.paramLabels(orgId, domain),
    ]).then(([dp, pl]) => {
      if (cancelled) return
      setSelected(dp?.paramKeys ?? [])
      setLabels(pl?.labels ?? {})
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [orgId, domain])

  // Suggestions: this product's known schema fields not already picked. A
  // brand-new org has nothing else to go on — nobody has ever reported
  // anything yet.
  const suggestions = ALARM_SCHEMA[domain]?.params.map((p) => p.key).filter((k) => !selected.includes(k)) ?? []

  const nameOf = (k: string) => draft[k] ?? (labels[k] || schemaLabel(domain, k))
  const add = (key: string) => {
    const k = key.trim()
    if (!k || selected.includes(k)) return
    setSelected((s) => [...s, k])
  }
  const remove = (k: string) => {
    setSelected((s) => s.filter((x) => x !== k))
    setDraft((d) => { const next = { ...d }; delete next[k]; return next })
  }

  const save = async () => {
    setBusy(true)
    const changed: Record<string, string> = {}
    for (const [k, v] of Object.entries(draft)) {
      const now = labels[k] ?? ''
      const next = v.trim()
      const normalised = next === schemaLabel(domain, k) ? '' : next
      if (normalised !== now) changed[k] = normalised
    }
    const [dp, pl] = await Promise.all([
      api.setDisplayParams(orgId, { domain, nodeId: null, paramKeys: selected }),
      Object.keys(changed).length
        ? api.setParamLabels(orgId, { domain, nodeId: null, labels: changed })
        : Promise.resolve({ ok: true, set: 0, cleared: 0 }),
    ])
    setBusy(false)
    if (!dp) { toast.error('Could not save the payload spec'); return }
    if (!pl) { toast.error('Fields saved, but the custom names were not'); return }
    toast.success(
      selected.length
        ? `${selected.length} field${selected.length === 1 ? '' : 's'} — organization-wide default`
        : 'Cleared — no spec configured for this product',
    )
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl max-h-[85vh] flex flex-col" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <ListPlus size={16} className="text-indigo-400" /> Payload spec — {ALARM_SCHEMA[domain]?.label ?? domain}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="px-5 pt-4">
          <p className="text-[11px] text-slate-500">
            Every device of this product in the organization inherits this list until it has readings of its
            own — this is what admin/pending compares an incoming device against.
          </p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-slate-600">Loading…</p>
          ) : (
            <>
              <div>
                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">
                  In the spec {selected.length === 0 && '— none yet'}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {selected.map((k) => (
                    <div key={k} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' }}>
                      <input
                        value={nameOf(k)}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        placeholder={schemaLabel(domain, k)}
                        maxLength={120}
                        title="Display name — what admin/pending shows for this field"
                        className="flex-1 min-w-0 bg-transparent text-xs text-left outline-none focus:underline decoration-indigo-400 text-white"
                      />
                      <span className="text-[9px] text-slate-500 font-mono flex-shrink-0" title={`payload.values.${k}`}>{k}</span>
                      <button onClick={() => remove(k)} className="text-slate-500 hover:text-red-400 flex-shrink-0"><X size={13} /></button>
                    </div>
                  ))}
                  {selected.length === 0 && (
                    <p className="text-[11px] text-slate-600 px-1">Pick from the suggestions below, or type a field name this product&apos;s sensor actually sends.</p>
                  )}
                </div>
              </div>

              {suggestions.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">
                    Known fields for this product
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((k) => (
                      <button key={k} onClick={() => add(k)}
                        className="text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1 text-slate-300 hover:text-white" style={inset}>
                        <Plus size={10} /> {schemaLabel(domain, k)} <span className="text-slate-600 font-mono">{k}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">
                  Field not listed above? Add it by its wire key
                </div>
                <div className="flex gap-2">
                  <input
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { add(customKey); setCustomKey('') } }}
                    placeholder="e.g. windingTempPhaseB"
                    maxLength={64}
                    className="flex-1 rounded-md px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
                    style={inset}
                  />
                  <button
                    onClick={() => { add(customKey); setCustomKey('') }}
                    disabled={!customKey.trim()}
                    className="px-3 py-1.5 rounded-md text-xs text-white disabled:opacity-40"
                    style={gradient}
                  >
                    Add
                  </button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1">Must match the key exactly as the device sends it inside <span className="font-mono">payload.values</span>.</p>
              </div>
            </>
          )}
        </div>

        <div className="p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={save} disabled={busy || loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            <Save size={15} /> {busy ? 'Saving…' : 'Save — organization-wide default'}
          </button>
        </div>
      </div>
    </div>
  )
}
