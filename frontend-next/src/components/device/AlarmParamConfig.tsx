'use client'

import { useEffect, useState } from 'react'
import { getAlarmSchema, defaultNodeRule } from '@/lib/alarmParams'
import { useAlarmDB } from '@/server/alarmStore'
import { api } from '@/lib/api'
import type { SensorDomain } from '@/types/fleet'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { ArrowUp, ArrowDown, TrendingUp, Timer, Activity, Save } from 'lucide-react'
import toast from 'react-hot-toast'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Renders the alarm-parameter form for a product domain (driven by ALARM_SCHEMA).
// When `nodeId` is given, Save persists the rule to that node; without one this
// is the ORG-level editor and loads/saves the org+domain default instead.
//
// An `advanced` prop used to gate a "Severity Routing & Escalation" panel here.
// That panel was removed (see the note further down — every control in it was
// unpersisted local state duplicating a real setting that had no UI), so the
// prop no longer selected anything and is gone rather than left as a
// parameter callers still pass and nothing reads.
export default function AlarmParamConfig({ domain, nodeId, orgId, onApplyAll }: { domain?: SensorDomain; nodeId?: string; orgId?: string; onApplyAll?: (rule: NodeAlarmRule) => void }) {
  const schema = getAlarmSchema(domain)
  const setRule = useAlarmDB((s) => s.setRule)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)

  // generic low/high fallback for unknown domains
  const [generic, setGeneric] = useState({ low: 2, high: 8 })
  const [vals, setVals] = useState(() =>
    Object.fromEntries((schema?.params ?? []).map((p) => [p.key, { warn: p.warn, critical: p.critical, rate: p.rate?.warn }])) as Record<string, { warn: number; critical: number; rate?: number }>,
  )
  const [dbVals, setDbVals] = useState<Record<string, { dwell_min?: number; cooldown_s?: number }>>({})
  const [dwell, setDwell] = useState(schema?.dwellMin ?? 3)
  const [hyst, setHyst] = useState(schema?.hysteresis ?? 1)
  const [healthIdx, setHealthIdx] = useState(schema?.healthIndexWarn ?? 60)

  const setVal = (key: string, field: 'warn' | 'critical' | 'rate', v: number) =>
    setVals((s) => ({ ...s, [key]: { ...s[key], [field]: v } }))

  // Reset to THIS domain's schema defaults whenever the domain changes. The
  // useState initializers above run once, so switching the product tab
  // otherwise left the previous domain's numbers in place — and any key the
  // two domains happen to share would silently carry its old threshold over.
  // Runs before the load effects below, which then overlay whatever is stored.
  useEffect(() => {
    const s = getAlarmSchema(domain)
    setVals(Object.fromEntries((s?.params ?? []).map((p) => [p.key, { warn: p.warn, critical: p.critical, rate: p.rate?.warn }])))
    setDbVals({})
    setDwell(s?.dwellMin ?? 3)
    setHyst(s?.hysteresis ?? 1)
    setHealthIdx(s?.healthIndexWarn ?? 60)
  }, [domain])

  // Apply a stored rule (per-node override or the org+domain default) over the
  // schema defaults this component seeded itself with.
  const applyRule = (saved: NodeAlarmRule) => {
    setVals(Object.fromEntries((saved.params ?? []).map((p) => [p.key, { warn: p.warn, critical: p.critical, rate: p.rate?.warn }])))
    if (saved.debounceJson) setDbVals(saved.debounceJson)
    if (saved.dwellMin !== undefined) setDwell(saved.dwellMin)
    if (saved.hysteresis !== undefined) setHyst(saved.hysteresis)
    if (saved.healthIndexWarn !== undefined) setHealthIdx(saved.healthIndexWarn)
  }

  // Load a saved per-node override after hydration (avoids SSR mismatch).
  useEffect(() => {
    if (!nodeId || !hasHydrated) return
    const saved = useAlarmDB.getState().rules[nodeId]
    if (saved) applyRule(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, hasHydrated])

  // No nodeId = this is the ORG-level editor (admin Alarm & Notify). It had no
  // load path at all: the effect above returns early without a nodeId, so the
  // form always rendered the hardcoded schema defaults from lib/alarmParams.ts
  // however many times an admin had saved real thresholds. They were stored in
  // org_domain_rules and pushed to every node — the editor just never showed
  // them, which reads as "this screen is mock data".
  const [orgRuleState, setOrgRuleState] = useState<'idle' | 'loading' | 'custom' | 'default'>('idle')
  const [orgRuleMeta, setOrgRuleMeta] = useState<{ updatedBy?: string | null; updatedAt?: string | null } | null>(null)
  useEffect(() => {
    if (nodeId || !orgId || !domain) return
    let cancelled = false
    setOrgRuleState('loading')
    api.getOrgRule(orgId, domain).then((r) => {
      if (cancelled) return
      if (r?.rule) { applyRule(r.rule); setOrgRuleMeta({ updatedBy: r.updatedBy, updatedAt: r.updatedAt }); setOrgRuleState('custom') }
      else setOrgRuleState('default')
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, orgId, domain])

  const buildRule = (): NodeAlarmRule | null => {
    if (!schema || !domain) return null
    return {
      domain,
      params: schema.params.map((p) => ({
        ...p,
        warn: vals[p.key]?.warn ?? p.warn,
        critical: vals[p.key]?.critical ?? p.critical,
        rate: p.rate ? { ...p.rate, warn: vals[p.key]?.rate ?? p.rate.warn } : undefined,
      })),
      dwellMin: dwell,
      hysteresis: hyst,
      healthIndexWarn: schema.healthIndexWarn !== undefined ? healthIdx : undefined,
      debounceJson: Object.keys(dbVals).length ? dbVals : undefined,
    }
  }
  const persist = () => {
    const rule = buildRule()
    if (!nodeId || !rule) return
    setRule(nodeId, rule, orgId)
    toast.success('Alarm rules saved — event log updated')
  }
  const applyAll = () => { const rule = buildRule(); if (rule && onApplyAll) onApplyAll(rule) }

  if (!schema) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-blue-400 mb-1 uppercase tracking-wider">Lower limit</label>
          <input type="number" value={generic.low} onChange={(e) => setGeneric((g) => ({ ...g, low: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        <div>
          <label className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Upper limit</label>
          <input type="number" value={generic.high} onChange={(e) => setGeneric((g) => ({ ...g, high: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">Thresholds for <span className="text-slate-300">{schema.label}</span> — Warning &amp; Critical per parameter.</div>

      {/* Parameter table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a' }}>
              {['Parameter', 'Warning', 'Critical', 'Dwell (m)', 'Cooldown (s)', 'Rate-of-rise'].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-[10px] text-slate-500 font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schema.params.map((p) => (
              <tr key={p.key} style={{ borderTop: '1px solid #1e2433' }}>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5 text-slate-200">
                    {p.direction === 'high' ? <ArrowUp size={12} className="text-red-400" /> : <ArrowDown size={12} className="text-blue-400" />}
                    {p.label}
                  </div>
                  <div className="text-[10px] text-slate-600 ml-4">{p.unit} · {p.direction === 'high' ? 'alarm above' : 'alarm below'}</div>
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={vals[p.key]?.warn ?? p.warn} onChange={(e) => setVal(p.key, 'warn', +e.target.value)}
                    className="w-20 rounded-md px-2 py-1 text-xs text-amber-300 outline-none focus:ring-1 focus:ring-amber-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={vals[p.key]?.critical ?? p.critical} onChange={(e) => setVal(p.key, 'critical', +e.target.value)}
                    className="w-16 sm:w-20 rounded-md px-2 py-1 text-xs text-red-300 outline-none focus:ring-1 focus:ring-red-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={dbVals[p.key]?.dwell_min ?? ''} placeholder="-" onChange={(e) => setDbVals((s) => ({ ...s, [p.key]: { ...s[p.key], dwell_min: e.target.value ? +e.target.value : undefined } }))}
                    className="w-12 sm:w-16 rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  <input type="number" value={dbVals[p.key]?.cooldown_s ?? ''} placeholder="-" onChange={(e) => setDbVals((s) => ({ ...s, [p.key]: { ...s[p.key], cooldown_s: e.target.value ? +e.target.value : undefined } }))}
                    className="w-12 sm:w-16 rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500" style={inset} />
                </td>
                <td className="py-2 px-3">
                  {p.rate ? (
                    <div className="flex items-center gap-1">
                      <TrendingUp size={11} className="text-indigo-400" />
                      <input type="number" value={vals[p.key]?.rate ?? p.rate.warn} onChange={(e) => setVal(p.key, 'rate', +e.target.value)}
                        className="w-16 rounded-md px-2 py-1 text-xs text-indigo-300 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                      <span className="text-[10px] text-slate-600">{p.rate.unit}</span>
                    </div>
                  ) : <span className="text-[10px] text-slate-700">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Timing + composite */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Timer size={11} /> Global Dwell (min)</label>
          <input type="number" value={dwell} onChange={(e) => setDwell(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Activity size={11} /> Hysteresis</label>
          <input type="number" value={hyst} onChange={(e) => setHyst(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
        </div>
        {schema.healthIndexWarn !== undefined && (
          <div>
            <label className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 uppercase tracking-wider"><Activity size={11} /> Health Idx &lt;</label>
            <input type="number" value={healthIdx} onChange={(e) => setHealthIdx(+e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
          </div>
        )}
      </div>

      {/* Where these numbers came from. Without this the form looks identical
          whether it is showing factory defaults or the org's saved values,
          which is exactly what made a working save look like it did nothing. */}
      {!nodeId && orgRuleState !== 'idle' && (
        <p className="text-[11px] text-slate-500">
          {orgRuleState === 'loading' ? 'Loading saved thresholds…'
            : orgRuleState === 'custom'
              ? `Showing this organization's saved thresholds${orgRuleMeta?.updatedBy ? ` — last changed by ${orgRuleMeta.updatedBy}` : ''}.`
              : 'No thresholds saved yet — showing the built-in defaults. Save to apply them to every device of this product.'}
        </p>
      )}

      {/* A "Severity Routing & Escalation" panel used to sit here: two channel
          pickers, an escalate-after-N-minutes box and a "suppress during
          maintenance window" checkbox. Every one of them was local useState —
          none was in buildRule(), none was persisted, and nothing anywhere
          read them. Setting them changed nothing and they reset on reload.
          Removed rather than left as decoration, because:
            · severity routing is ALREADY real and enforced — notify() skips a
              channel whose min_severity is CRITICAL for a WARNING alarm — it
              simply had no UI. That control now lives beside each channel in
              Notification Setting, where the value is actually stored.
            · escalation has a column (alarm_events.escalated) but no
              configurable window, and
            · maintenance windows do not exist in this schema at all.
          Duplicating a working setting with a fake one is worse than either. */}

      {nodeId && (
        <button onClick={persist} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          <Save size={14} /> Save Alarm Rules
        </button>
      )}
      {onApplyAll && (
        <button onClick={applyAll} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          <Save size={14} /> Apply to all {domain ? '' : ''}org nodes
        </button>
      )}
    </div>
  )
}
