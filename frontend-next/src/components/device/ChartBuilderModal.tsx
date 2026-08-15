'use client'

// ---------------------------------------------------------------------------
// Create/edit one admin-defined trend chart: a title, any number of this
// device's own parameters, and — inline, per selected parameter — the same
// alert/notify thresholds the per-parameter history modal edits. Nothing
// about alarms is reinvented here: saving writes the exact same
// alarm_rules row (via useAlarmDB.setRule → PUT /api/nodes/:id/rule) that
// ParamHistoryModal does, so a parameter alarms identically whether it's
// looked at alone or as part of this chart.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { ALARM_SCHEMA, defaultNodeRule, type AlarmParam } from '@/lib/alarmParams'
import { useAlarmDB } from '@/server/alarmStore'
import type { NodeAlarmRule, ParamRule } from '@/server/alarmEngine'
import type { SensorDomain } from '@/types/fleet'
import type { ChartDefinition } from '@/lib/api'
import { X, Save, Loader2, Trash2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export interface AvailableParam { key: string; label: string; unit?: string }

interface ThreshDraft { direction: 'high' | 'low'; warn: number; critical: number; enabled: boolean }

export default function ChartBuilderModal({
  nodeId, orgId, domain, availableParams, existing, onClose, onSaved,
}: {
  nodeId: string
  orgId?: string
  domain: SensorDomain
  /** Parameters this device actually reports — the picker only ever offers real keys. */
  availableParams: AvailableParam[]
  /** Present when editing an existing chart; absent when creating one. */
  existing?: ChartDefinition
  onClose: () => void
  onSaved: () => void
}) {
  const setRule = useAlarmDB((s) => s.setRule)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [selected, setSelected] = useState<string[]>(existing?.paramKeys ?? [])
  const [filter, setFilter] = useState('')
  const [rule, setRuleState] = useState<NodeAlarmRule | null>(null)
  const [thresh, setThresh] = useState<Record<string, ThreshDraft>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const paramByKey = useMemo(() => {
    const m = new Map<string, AvailableParam>()
    for (const p of availableParams) m.set(p.key, p)
    return m
  }, [availableParams])

  // Seed thresholds from the device's real saved rule (server-first, same
  // precedence ParamHistoryModal uses), so opening the builder on an already
  // configured device shows what's actually live rather than blank fields.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const remote = await api.getRule(nodeId)
      if (cancelled) return
      const local = hasHydrated ? useAlarmDB.getState().rules[nodeId] : undefined
      const r = remote ?? local ?? null
      setRuleState(r)
      const draft: Record<string, ThreshDraft> = {}
      for (const key of selected) {
        const saved = r?.params.find((p) => p.key === key)
        const schemaParam: AlarmParam | undefined = ALARM_SCHEMA[domain].params.find((p) => p.key === key)
        if (saved) draft[key] = { direction: saved.direction, warn: saved.warn, critical: saved.critical, enabled: true }
        else if (schemaParam) draft[key] = { direction: schemaParam.direction, warn: schemaParam.warn, critical: schemaParam.critical, enabled: true }
        else draft[key] = { direction: 'high', warn: NaN, critical: NaN, enabled: false }
      }
      setThresh(draft)
    })()
    return () => { cancelled = true }
    // Only re-seed when the set of selected keys actually changes shape, not on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, domain, hasHydrated, selected.join(',')])

  const toggle = (key: string) => {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return availableParams
    return availableParams.filter((p) => p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q))
  }, [availableParams, filter])

  const setThreshField = (key: string, patch: Partial<ThreshDraft>) =>
    setThresh((t) => ({ ...t, [key]: { ...(t[key] ?? { direction: 'high', warn: NaN, critical: NaN, enabled: false }), ...patch } }))

  const invalidKeys = selected.filter((key) => {
    const t = thresh[key]
    if (!t?.enabled) return false
    if (!Number.isFinite(t.warn) || !Number.isFinite(t.critical)) return true
    return t.direction === 'high' ? t.critical <= t.warn : t.critical >= t.warn
  })

  const save = async () => {
    const trimmed = title.trim()
    if (!trimmed) { toast.error('Give this chart a title'); return }
    if (!selected.length) { toast.error('Select at least one parameter'); return }
    if (invalidKeys.length) { toast.error('Fix the invalid thresholds before saving'); return }
    setSaving(true)
    try {
      if (existing) {
        await api.updateChart(nodeId, existing.id, { title: trimmed, paramKeys: selected })
      } else {
        await api.createChart(nodeId, { title: trimmed, paramKeys: selected })
      }

      // Merge every touched threshold into the device's ONE alarm rule — same
      // shape saveThreshold() in ParamHistoryModal builds, just applied to
      // several parameters in one save instead of one at a time.
      const base: NodeAlarmRule = rule ?? defaultNodeRule(domain)
      let params: ParamRule[] = base.params
      for (const key of selected) {
        const t = thresh[key]
        if (!t) continue
        const exists = params.some((p) => p.key === key)
        if (!t.enabled) {
          if (exists) params = params.filter((p) => p.key !== key)
          continue
        }
        const meta = paramByKey.get(key)
        if (exists) {
          params = params.map((p) => (p.key === key ? { ...p, warn: t.warn, critical: t.critical, direction: t.direction } : p))
        } else {
          params = [...params, { key, label: meta?.label ?? key, unit: meta?.unit ?? '', direction: t.direction, warn: t.warn, critical: t.critical }]
        }
      }
      if (params !== base.params) {
        setRule(nodeId, { ...base, domain: base.domain || domain, params }, orgId)
      }

      toast.success(existing ? 'Chart updated' : 'Chart created')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setDeleting(true)
    try {
      await api.deleteChart(nodeId, existing.id)
      toast.success('Chart deleted')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-2xl my-auto" style={surface} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 className="text-base font-bold text-white">{existing ? 'Edit chart' : 'New chart'}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Plot any of this device&apos;s parameters together, with their own alerts.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 space-y-4">
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Oil health"
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} maxLength={120} />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Parameters ({selected.length} selected)</span>
              {availableParams.length > 8 && (
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…"
                  className="text-[11px] rounded px-2 py-1 text-slate-200 outline-none w-32" style={inset} />
              )}
            </div>
            <div className="rounded-lg p-2 max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1" style={inset}>
              {filtered.map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded cursor-pointer hover:bg-white/5"
                  style={{ color: selected.includes(p.key) ? '#e2e8f0' : '#64748b' }}>
                  <input type="checkbox" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} />
                  <span className="truncate" title={p.key}>{p.label}</span>
                </label>
              ))}
              {!filtered.length && <p className="text-[11px] text-slate-600 col-span-full py-2 text-center">No parameters match.</p>}
            </div>
          </div>

          {selected.length > 0 && (
            <div>
              <span className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Alert &amp; notify thresholds</span>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                {selected.map((key) => {
                  const meta = paramByKey.get(key)
                  const t = thresh[key]
                  const invalid = invalidKeys.includes(key)
                  return (
                    <div key={key} className="rounded-lg p-2.5" style={inset}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-medium text-slate-200 truncate">{meta?.label ?? key}</span>
                        <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer shrink-0">
                          <input type="checkbox" checked={!!t?.enabled} onChange={(e) => setThreshField(key, { enabled: e.target.checked })} />
                          alert on this
                        </label>
                      </div>
                      {t?.enabled && (
                        <div className="flex items-center gap-2">
                          <select value={t.direction} onChange={(e) => setThreshField(key, { direction: e.target.value as 'high' | 'low' })}
                            className="text-[10px] rounded px-1.5 py-1 text-slate-200 outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
                            <option value="high">above</option>
                            <option value="low">below</option>
                          </select>
                          <input type="number" step="any" placeholder="warn" value={Number.isFinite(t.warn) ? t.warn : ''}
                            onChange={(e) => setThreshField(key, { warn: e.target.value === '' ? NaN : Number(e.target.value) })}
                            className="w-20 text-[11px] rounded px-2 py-1 text-amber-300 outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                          <input type="number" step="any" placeholder="critical" value={Number.isFinite(t.critical) ? t.critical : ''}
                            onChange={(e) => setThreshField(key, { critical: e.target.value === '' ? NaN : Number(e.target.value) })}
                            className="w-20 text-[11px] rounded px-2 py-1 text-red-300 outline-none" style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                          {meta?.unit && <span className="text-[10px] text-slate-600">{meta.unit}</span>}
                        </div>
                      )}
                      {invalid && (
                        <p className="text-[10px] text-amber-400 flex items-center gap-1 mt-1.5">
                          <AlertTriangle size={10} /> Enter both limits; critical must be {t?.direction === 'high' ? 'higher' : 'lower'} than warning.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-600 mt-2">
                Notifications follow these same limits — channels are chosen in My Alert Settings.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-5 pt-4">
          {existing && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Delete this chart?</span>
                <button onClick={remove} disabled={deleting}
                  className="text-[11px] px-2.5 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: '#ef4444' }}>
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Confirm'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] px-2 py-1.5 text-slate-500 hover:text-white">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} title="Delete this chart"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md text-slate-400 hover:text-red-400" style={inset}>
                <Trash2 size={12} /> Delete
              </button>
            )
          )}
          <button onClick={save} disabled={saving || !title.trim() || !selected.length || !!invalidKeys.length}
            className="ml-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {existing ? 'Save changes' : 'Create chart'}
          </button>
        </div>
      </div>
    </div>
  )
}
