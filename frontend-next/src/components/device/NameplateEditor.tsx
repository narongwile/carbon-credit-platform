'use client'

// ---------------------------------------------------------------------------
// Edit a transformer's real nameplate — kVA, voltage class, manufacturer,
// serial number, cooling type, install year.
// ---------------------------------------------------------------------------
// Seven fields, flat, no sections — matching what the two Asset Info panels
// already try to render (see migrate-v31.sql for why the scope stops there:
// vector group, impedance %, tap-changer detail and the rest of IEC 60076-1 is
// design-engineering data nobody reads while triaging an oil-temp alarm, and
// is already captured losslessly by the admin-uploaded device photo for the
// rare specialist who needs it).
//
// Every field is optional and independently clearable: an admin who knows the
// rating today but not the serial number has to be able to save that much and
// come back later. Forcing all-or-nothing entry is how a nameplate stays
// blank forever.
//
// migrate-v32 adds an optional link to this org's transformer model catalog.
// Linking is additive, not exclusive: manufacturer/kVA/voltage/cooling stay
// editable and OVERRIDE the model's value when filled in — a factory model has
// real per-site variants (a different secondary tap, a non-standard voltage
// class), and forcing "catalog value always wins" just pushes admins back to
// retyping everything by hand.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useTransformerModels } from '@/lib/useNodeNameplate'
import type { Nameplate } from '@/lib/useNodeNameplate'
import { X, Save, Loader2, Link2, Unlink } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const COOLING_TYPES = ['ONAN', 'ONAF', 'ONAN/ONAF', 'OFAF', 'ODAF', 'AN', 'AF']

interface Form {
  manufacturer: string
  model: string
  serialNumber: string
  ratedKva: string
  voltageClass: string
  coolingType: string
  yearInstalled: string
}

const toForm = (d: Nameplate | null): Form => ({
  manufacturer: d?.manufacturer ?? '',
  model: d?.model ?? '',
  serialNumber: d?.serialNumber ?? '',
  ratedKva: d?.ratedKva != null ? String(d.ratedKva) : '',
  voltageClass: d?.voltageClass ?? '',
  coolingType: d?.coolingType ?? '',
  yearInstalled: d?.yearInstalled != null ? String(d.yearInstalled) : '',
})

export default function NameplateEditor({
  nodeId, orgId, current, onClose, onSaved,
}: {
  nodeId: string
  orgId: string
  current: Nameplate | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(current))
  const [modelId, setModelId] = useState(current?.modelId ?? '')
  const [saving, setSaving] = useState(false)
  const nowYear = new Date().getFullYear()
  const { models } = useTransformerModels(orgId)

  useEffect(() => { setForm(toForm(current)); setModelId(current?.modelId ?? '') }, [current])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  // The linked model itself, even if it has since been retired (active:false)
  // — a retired model must still show what this unit inherits from it, just
  // not be offered again for a device that isn't already using it.
  const linkedModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? (current?.modelId === modelId && current.modelCode ? { id: modelId, modelCode: current.modelCode, manufacturer: null, ratedKva: null, voltageClass: null, coolingType: null, active: current.modelActive ?? true, createdBy: null, updatedAt: '' } : null),
    [models, modelId, current]
  )
  const pickerOptions = useMemo(() => models.filter((m) => m.active || m.id === modelId), [models, modelId])

  const kvaValid = form.ratedKva.trim() === '' || (() => {
    const n = Number(form.ratedKva)
    return isFinite(n) && n > 0 && n <= 500000
  })()
  const yearValid = form.yearInstalled.trim() === '' || (() => {
    const n = Number(form.yearInstalled)
    return Number.isInteger(n) && n >= 1970 && n <= nowYear
  })()
  const canSave = kvaValid && yearValid

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    // Blank = clear that field (or, once a model is linked, inherit its
    // value); every field is independently optional either way.
    const r = await api.setNodeNameplate(nodeId, {
      modelId: modelId || null,
      manufacturer: form.manufacturer.trim() || null,
      model: modelId ? null : (form.model.trim() || null),
      serialNumber: form.serialNumber.trim() || null,
      ratedKva: form.ratedKva.trim() === '' ? null : Number(form.ratedKva),
      voltageClass: form.voltageClass.trim() || null,
      coolingType: form.coolingType.trim() || null,
      yearInstalled: form.yearInstalled.trim() === '' ? null : Number(form.yearInstalled),
    })
    setSaving(false)
    if (!r) { toast.error('Could not save the nameplate'); return }
    toast.success('Nameplate saved')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">Transformer nameplate</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          <p className="text-[11px] text-slate-500">
            What is actually printed on this unit&apos;s nameplate. Every field is optional — save what you know now,
            fill in the rest later.
          </p>

          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Model (from catalog)</span>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
              <option value="">— not in catalog (type everything below) —</option>
              {pickerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.modelCode}{m.ratedKva != null ? ` · ${m.ratedKva} kVA` : ''}{m.voltageClass ? ` · ${m.voltageClass}` : ''}{!m.active ? ' (retired)' : ''}
                </option>
              ))}
            </select>
            {modelId && (
              <p className="flex items-center gap-1 text-[10px] text-indigo-400 mt-1">
                <Link2 size={10} /> Fields below left blank inherit this model&apos;s spec. Fill one in only where this unit differs.
              </p>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            {!modelId && (
              <label className="block col-span-2">
                <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Model</span>
                <input value={form.model} onChange={set('model')} maxLength={120}
                  className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
              </label>
            )}
            <label className="block col-span-2">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Manufacturer</span>
              <input value={form.manufacturer} onChange={set('manufacturer')}
                placeholder={linkedModel?.manufacturer ? `Inherits: ${linkedModel.manufacturer}` : 'e.g. ABB'} maxLength={120}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Serial number</span>
              <input value={form.serialNumber} onChange={set('serialNumber')} maxLength={120}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Rated power (kVA)</span>
              <input value={form.ratedKva} onChange={set('ratedKva')} inputMode="decimal"
                placeholder={linkedModel?.ratedKva != null ? `Inherits: ${linkedModel.ratedKva}` : 'e.g. 2500'}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                style={{ ...inset, ...(kvaValid ? {} : { border: '1px solid #ef4444' }) }} />
              {!kvaValid && <span className="block text-[10px] text-red-400 mt-1">0 – 500,000 kVA</span>}
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Voltage class</span>
              <input value={form.voltageClass} onChange={set('voltageClass')}
                placeholder={linkedModel?.voltageClass || 'e.g. 22kV/0.4kV'} maxLength={64}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Cooling type</span>
              <input value={form.coolingType} onChange={set('coolingType')} list="nameplate-cooling-types"
                placeholder={linkedModel?.coolingType || 'e.g. ONAN'} maxLength={32}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
              <datalist id="nameplate-cooling-types">
                {COOLING_TYPES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Year installed</span>
              <input value={form.yearInstalled} onChange={set('yearInstalled')} inputMode="numeric" placeholder={String(nowYear)}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ ...inset, ...(yearValid ? {} : { border: '1px solid #ef4444' }) }} />
              {!yearValid && <span className="block text-[10px] text-red-400 mt-1">1970 – {nowYear}</span>}
            </label>
          </div>

          {modelId && (
            <button onClick={() => setModelId('')} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-red-400">
              <Unlink size={11} /> Unlink from catalog (switch back to typing every field)
            </button>
          )}

          {current?.updatedAt && (
            <p className="text-[10px] text-slate-600">
              Last saved{current.updatedBy ? ` by ${current.updatedBy}` : ''} · {new Date(current.updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div className="p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={save} disabled={saving || !canSave}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
