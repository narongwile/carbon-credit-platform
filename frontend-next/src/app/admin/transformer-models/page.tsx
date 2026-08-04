'use client'

// ---------------------------------------------------------------------------
// Transformer model catalog (migrate-v32) — this org's own copy of the
// manufacturer/kVA/voltage/cooling combinations its fleet is built from.
// ETERNITY IS a transformer manufacturing platform: the same handful of
// model codes repeat across dozens of units, and until this existed the only
// place to record one was per-device, retyped from scratch every time
// (NameplateEditor). Picking a model here on Pending Devices' approve step,
// or on a device's own nameplate editor, fills manufacturer/kVA/voltage/
// cooling from this catalog instead.
//
// Deliberately never a shared cross-org list: every org keeps its own copy,
// even where two orgs happen to use an identical model code — the backend
// table lives in the resolved ORG database (control DB for org-1/2/3,
// tenant DB otherwise) and every query filters by org_id, so nothing here
// ever reads or writes another organization's catalog.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { api, isLive } from '@/lib/api'
import { useTransformerModels } from '@/lib/useNodeNameplate'
import type { TransformerModel } from '@/lib/useNodeNameplate'
import { Package, Plus, X, Pencil, Archive, ArchiveRestore, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const COOLING_TYPES = ['ONAN', 'ONAF', 'ONAN/ONAF', 'OFAF', 'ODAF', 'AN', 'AF']

export default function TransformerModelsPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const { models, loading, refetch } = useTransformerModels(orgId)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<TransformerModel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const active = models.filter((m) => m.active)
  const retired = models.filter((m) => !m.active)

  const toggleActive = async (m: TransformerModel) => {
    if (!isLive()) { toast.success(m.active ? 'Retired (demo)' : 'Restored (demo)'); return }
    setBusy(m.id)
    const r = await api.setTransformerModelActive(orgId, m.id, !m.active)
    setBusy(null)
    if (r?.ok) { toast.success(m.active ? `Retired ${m.modelCode}` : `Restored ${m.modelCode}`); refetch() }
    else toast.error('Could not update the model')
  }

  const remove = async (m: TransformerModel) => {
    if (!isLive()) { toast.success('Deleted (demo)'); return }
    setBusy(m.id)
    const r = await api.deleteTransformerModel(orgId, m.id)
    setBusy(null)
    if (r?.ok) { toast.success(`Deleted ${m.modelCode}`); refetch() }
    else toast.error('Still assigned to devices — retire it instead, or reassign those devices first')
  }

  const Row = ({ m }: { m: TransformerModel }) => (
    <tr className="hover:bg-white/3" style={{ borderBottom: '1px solid #1e2433', opacity: m.active ? 1 : 0.55 }}>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}><Package size={14} className="text-indigo-400" /></div>
          <span className="text-white font-medium">{m.modelCode}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-slate-400 text-sm">{m.manufacturer || '—'}</td>
      <td className="py-3 px-4 text-slate-300 text-sm">{m.ratedKva != null ? `${m.ratedKva} kVA` : '—'}</td>
      <td className="py-3 px-4 text-slate-400 text-sm">{m.voltageClass || '—'}</td>
      <td className="py-3 px-4 text-slate-400 text-sm">{m.coolingType || '—'}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => { setEditing(m); setShowModal(true) }} title="Edit" className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/5"><Pencil size={13} /></button>
          <button onClick={() => toggleActive(m)} disabled={busy === m.id} title={m.active ? 'Retire' : 'Restore'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-500/5 disabled:opacity-40">
            {busy === m.id ? <Loader2 size={13} className="animate-spin" /> : m.active ? <Archive size={13} /> : <ArchiveRestore size={13} />}
          </button>
          <button onClick={() => remove(m)} disabled={busy === m.id} title="Delete (only if unused)" className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/5 disabled:opacity-40">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Transformer Models</h1>
          <p className="text-sm text-slate-500 mt-0.5">This organization&apos;s model catalog — pick one on approval or a device&apos;s nameplate instead of retyping its spec.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true) }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <Plus size={15} /> Add Model
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Model Code', 'Manufacturer', 'Rated Power', 'Voltage Class', 'Cooling', ''].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {loading && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-500">Loading…</td></tr>
            )}
            {!loading && active.map((m) => <Row key={m.id} m={m} />)}
            {!loading && !models.length && (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                No models yet. Add the ones your fleet is actually built from — Pending Devices and each device&apos;s nameplate can then pick from this list instead of typing the same spec every time.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {retired.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Retired ({retired.length}) — hidden from new approvals, still resolved for devices already using them</div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-sm">
              <tbody style={{ background: '#0d1117' }}>
                {retired.map((m) => <Row key={m.id} m={m} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <ModelModal
          orgId={orgId}
          model={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refetch() }}
        />
      )}
    </div>
  )
}

function ModelModal({ orgId, model, onClose, onSaved }: {
  orgId: string
  model: TransformerModel | null
  onClose: () => void
  onSaved: () => void
}) {
  const [modelCode, setModelCode] = useState(model?.modelCode ?? '')
  const [manufacturer, setManufacturer] = useState(model?.manufacturer ?? '')
  const [ratedKva, setRatedKva] = useState(model?.ratedKva != null ? String(model.ratedKva) : '')
  const [voltageClass, setVoltageClass] = useState(model?.voltageClass ?? '')
  const [coolingType, setCoolingType] = useState(model?.coolingType ?? '')
  const [saving, setSaving] = useState(false)

  const kvaValid = ratedKva.trim() === '' || (() => {
    const n = Number(ratedKva)
    return isFinite(n) && n > 0 && n <= 500000
  })()
  const canSave = !!modelCode.trim() && kvaValid

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    if (!isLive()) { toast.success('Saved (demo)'); setSaving(false); onSaved(); return }
    const r = await api.saveTransformerModel(orgId, {
      id: model?.id,
      modelCode: modelCode.trim(),
      manufacturer: manufacturer.trim() || null,
      ratedKva: ratedKva.trim() === '' ? null : Number(ratedKva),
      voltageClass: voltageClass.trim() || null,
      coolingType: coolingType.trim() || null,
    })
    setSaving(false)
    if (!r?.ok) { toast.error('Could not save the model'); return }
    toast.success(`Saved ${modelCode.trim()}`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">{model ? 'Edit Model' : 'Add Model'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Model Code *</span>
            <input value={modelCode} onChange={(e) => setModelCode(e.target.value)} placeholder="e.g. TR-6787" maxLength={120}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
          </label>
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Manufacturer</span>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. ETERNITY" maxLength={120}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Rated Power (kVA)</span>
              <input value={ratedKva} onChange={(e) => setRatedKva(e.target.value)} inputMode="decimal" placeholder="e.g. 2500"
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ ...inset, ...(kvaValid ? {} : { border: '1px solid #ef4444' }) }} />
              {!kvaValid && <span className="block text-[10px] text-red-400 mt-1">0 – 500,000 kVA</span>}
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Voltage Class</span>
              <input value={voltageClass} onChange={(e) => setVoltageClass(e.target.value)} placeholder="e.g. 22kV/0.4kV" maxLength={64}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </label>
          </div>
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Cooling Type</span>
            <input value={coolingType} onChange={(e) => setCoolingType(e.target.value)} list="tm-cooling-types" placeholder="e.g. ONAN" maxLength={32}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            <datalist id="tm-cooling-types">
              {COOLING_TYPES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={save} disabled={saving || !canSave} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            {saving ? 'Saving…' : 'Save Model'}
          </button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
