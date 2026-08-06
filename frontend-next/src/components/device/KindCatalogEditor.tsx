'use client'

// ---------------------------------------------------------------------------
// Manage the photo-kind / document-kind list for one organization.
// ---------------------------------------------------------------------------
// Reachable from two places on purpose: the admin Settings page (where org-wide
// configuration lives) and a "Manage…" link beside the picker itself (where an
// admin is standing at the moment they discover the list is missing something).
//
// Three rules the UI has to make obvious, because all three protect stored data:
//   · a built-in can be relabelled and hidden but never deleted — three of the
//     photo ones (overview / thermal / condition) are joined on by key by the
//     IR compare slider and the server-side fallback, so removing them would
//     break features silently;
//   · hiding is not deleting. It stops a kind being OFFERED for new uploads and
//     changes nothing about what is already stored, which is why it is the
//     safe answer to "we don't use this any more";
//   · deleting a custom kind is refused while anything still carries it, so a
//     photo can never end up pointing at a kind that no longer exists.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api, isLive, type CatalogKind, type KindScope } from '@/lib/api'
import { useKindCatalog } from '@/lib/useKindCatalog'
import { useSessionRole, useSessionOrgId } from '@/lib/auth'
import { X, Plus, Save, Trash2, Eye, EyeOff, Loader2, Lock, AlertTriangle, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const TITLE: Record<KindScope, string> = { photo: 'Photo types', document: 'Document types' }
const BLURB: Record<KindScope, string> = {
  photo: 'The list offered when uploading a photo of a unit.',
  document: 'The list offered when uploading a maintenance document.',
}

export default function KindCatalogEditor({
  orgId, scope, onClose, onChanged,
}: {
  orgId: string
  scope: KindScope
  onClose: () => void
  /** Let the opener refresh its own picker without a page reload. */
  onChanged?: () => void
}) {
  const { all, loading, reload } = useKindCatalog(orgId, scope)
  const [busy, setBusy] = useState<string | null>(null)
  // Whose catalog is this? A superadmin doing maintenance can point the whole
  // console at a customer's organization from the sidebar switcher, and this
  // modal previously said only "Photo types" — so an org switched by mistake
  // meant editing a customer's list believing it was your own, with nothing on
  // screen to catch it.
  const role = useSessionRole()
  const ownOrgId = useSessionOrgId('')
  const foreign = role === 'superadmin' && !!ownOrgId && orgId !== ownOrgId
  const [orgName, setOrgName] = useState<string | null>(null)
  useEffect(() => {
    if (!isLive() || !orgId) { setOrgName(null); return }
    let cancelled = false
    api.orgs().then((rows) => {
      if (cancelled) return
      setOrgName(rows?.find((o) => o.id === orgId)?.name ?? null)
    })
    return () => { cancelled = true }
  }, [orgId])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const done = () => { reload(); onChanged?.() }

  const labelOf = (k: CatalogKind) => drafts[k.key] ?? k.label
  const dirty = (k: CatalogKind) => drafts[k.key] !== undefined && drafts[k.key].trim() !== k.label

  const saveLabel = async (k: CatalogKind) => {
    const label = (drafts[k.key] ?? '').trim()
    if (!label) { toast.error('A name cannot be empty'); return }
    setBusy(k.key)
    const r = await api.saveOrgKind(orgId, { scope, key: k.key, label, hint: k.hint ?? null, position: k.position, active: !!k.active })
    setBusy(null)
    if (!r?.ok) { toast.error('Could not save that name'); return }
    setDrafts((d) => { const n = { ...d }; delete n[k.key]; return n })
    toast.success(`Renamed to “${label}”`)
    done()
  }

  const toggleActive = async (k: CatalogKind) => {
    setBusy(k.key)
    const r = await api.saveOrgKind(orgId, { scope, key: k.key, label: k.label, hint: k.hint ?? null, position: k.position, active: !k.active })
    setBusy(null)
    if (!r?.ok) { toast.error('Could not change that'); return }
    toast.success(k.active
      ? `“${k.label}” hidden — existing items keep it, it is just not offered for new uploads`
      : `“${k.label}” is offered again`)
    done()
  }

  const remove = async (k: CatalogKind) => {
    setBusy(k.key)
    const r = await api.deleteOrgKind(orgId, scope, k.key)
    setBusy(null)
    setConfirmDel(null)
    // The backend refuses (409) while anything still carries the kind; req()
    // surfaces that as null, so say the useful thing rather than "failed".
    if (!r?.ok) { toast.error('Not deleted — something still uses this type. Hide it instead.'); return }
    toast.success(`“${k.label}” deleted`)
    done()
  }

  const add = async () => {
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    const label = newLabel.trim()
    if (!key || !label) { toast.error('Both an id and a name are needed'); return }
    if (all.some((k) => k.key === key)) { toast.error(`“${key}” already exists`); return }
    setBusy('__new__')
    const r = await api.saveOrgKind(orgId, { scope, key, label, position: all.length })
    setBusy(null)
    if (!r?.ok) { toast.error('Could not add that type'); return }
    setNewKey(''); setNewLabel('')
    toast.success(`Added “${label}”`)
    done()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-xl rounded-2xl max-h-[85vh] flex flex-col" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              {TITLE[scope]}
              {(orgName || orgId) && (
                <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={foreign
                    ? { color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid #f59e0b55' }
                    : { color: '#94a3b8', background: 'rgba(148,163,184,0.1)' }}>
                  <Building2 size={10} /> {orgName ?? orgId}
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{BLURB[scope]}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        {foreign && (
          <div className="mx-5 mt-4 flex items-start gap-2 px-3 py-2 rounded-lg"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid #f59e0b55' }}>
            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-amber-300">
              You are editing <b>{orgName ?? orgId}</b>&rsquo;s list, not your own. Everyone in that organization sees
              these names on every upload.
            </span>
          </div>
        )}

        {/* What the padlocks mean. It was a hover-only tooltip, which is no use
            to someone deciding whether it is safe to hide a type. */}
        <div className="px-5 pt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><Lock size={10} className="text-amber-500" /> Built in · other features match on it — hiding it degrades them</span>
          <span className="flex items-center gap-1"><Lock size={10} className="text-slate-600" /> Built in · safe to rename or hide</span>
          <span className="flex items-center gap-1"><Trash2 size={10} className="text-slate-600" /> Added by you · deletable when unused</span>
        </div>

        <div className="p-5 space-y-2 overflow-y-auto">
          {loading && all.length === 0 && <p className="text-xs text-slate-600">Loading…</p>}
          {all.map((k) => {
            const hidden = !k.active
            return (
              <div key={k.key} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ ...inset, opacity: hidden ? 0.55 : 1 }}>
                <input
                  value={labelOf(k)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && dirty(k)) saveLabel(k) }}
                  maxLength={120}
                  className="flex-1 min-w-0 bg-transparent text-xs text-white outline-none focus:underline decoration-indigo-400"
                />
                {/* The stored value. Shown because it is what every photo and
                    document actually carries, and it never changes when the
                    display name does. */}
                <span className="text-[9px] font-mono text-slate-600 shrink-0" title="Stored value — never changes when you rename">{k.key}</span>
                {k.builtin && (
                  <span title={k.protected
                    ? 'Built in, and other features match on it (the thermal compare slider). It can be renamed or hidden, never deleted.'
                    : 'Built in — it can be renamed or hidden, never deleted.'}>
                    <Lock size={11} className={k.protected ? 'text-amber-500' : 'text-slate-600'} />
                  </span>
                )}
                {dirty(k) && (
                  <button onClick={() => saveLabel(k)} disabled={busy === k.key}
                    className="p-1 rounded text-emerald-400 hover:bg-white/10" title="Save the new name">
                    {busy === k.key ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  </button>
                )}
                <button onClick={() => toggleActive(k)} disabled={busy === k.key}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
                  title={hidden ? 'Offer this again for new uploads' : 'Stop offering this for new uploads — existing items keep it'}>
                  {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                {!k.builtin && (
                  confirmDel === k.key ? (
                    <button onClick={() => remove(k)} disabled={busy === k.key}
                      className="text-[10px] px-2 py-1 rounded-md text-white" style={{ background: '#dc2626' }}>
                      {busy === k.key ? '…' : 'Confirm'}
                    </button>
                  ) : (
                    <button onClick={() => setConfirmDel(k.key)}
                      className="p-1 rounded text-slate-500 hover:text-red-400" title="Delete this type">
                      <Trash2 size={12} />
                    </button>
                  )
                )}
              </div>
            )
          })}

          {all.some((k) => k.protected && !k.active) && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-400 pt-1">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              A hidden type that other features match on stays working for photos already taken, but no new ones can be
              added under it — the thermal compare slider needs a thermal photo AND a visible-light one.
            </p>
          )}
        </div>

        <div className="p-5 space-y-2" style={{ borderTop: '1px solid #1e2433' }}>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Add a type</div>
          <div className="flex items-center gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              onBlur={() => { if (!newKey.trim() && newLabel.trim()) setNewKey(newLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)) }}
              placeholder={scope === 'photo' ? 'e.g. Bushing close-up' : 'e.g. ใบรับรอง กฟภ.'}
              maxLength={120}
              className="flex-1 min-w-0 rounded-md px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)}
              placeholder="stored_id" maxLength={24}
              title="The value stored on each item. Letters, digits and underscores; it cannot be changed later."
              className="w-32 rounded-md px-3 py-2 text-xs font-mono text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
            <button onClick={add} disabled={busy === '__new__' || !newLabel.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-white disabled:opacity-40" style={gradient}>
              {busy === '__new__' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
            </button>
          </div>
          <p className="text-[10px] text-slate-600">
            The id is what gets stored on every photo or document of this type and cannot be changed afterwards — renaming
            later changes only the name shown.
          </p>
        </div>
      </div>
    </div>
  )
}
