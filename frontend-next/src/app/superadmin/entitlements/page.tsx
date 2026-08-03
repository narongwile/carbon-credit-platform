'use client'

// ---------------------------------------------------------------------------
// Feature Entitlements — which products each organization is licensed for.
// ---------------------------------------------------------------------------
// This page listed ten invented feature flags ("AI Predictive Diagnostics",
// "Carbon Credit Marketplace", "5 years of historical data") grouped under
// three headings, toggled them in React state, and offered a "Save All Changes"
// button with no onClick. Nothing here was ever stored, nothing read it, and
// none of those flags exist anywhere in the schema or the code.
//
// What the platform genuinely licenses is a PRODUCT — org_entitlements holds one
// row per (org, platform), and that entitlement is what gates a tenant's
// navigation and device domains. So that is what this screen edits, sourced from
// PLATFORM_TEMPLATES (the same registry the Provision Wizard licenses from) and
// written straight through to the backend, one click at a time.
//
// The per-platform feature list is shown as documentation of what the product
// includes — it is deliberately NOT a set of toggles, because there is no
// per-feature column to toggle. A switch that stores nothing is the bug this
// page was.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { api, isLive, useIsLive } from '@/lib/api'
import { PLATFORM_TEMPLATES } from '@/lib/platforms'
import { fmtDateTime } from '@/lib/displayTime'
import { ToggleLeft, ToggleRight, Loader2, ScrollText, Building2, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface OrgRow { id: string; name: string; status: string }

export default function EntitlementsPage() {
  const live = useIsLive()
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [licensed, setLicensed] = useState<string[]>([])
  const [audit, setAudit] = useState<{ id: number; actor_name: string | null; action: string; target: string | null; at: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!isLive()) { setOrgs([]); return }
    let cancelled = false
    api.orgs().then((rows) => {
      if (cancelled || !rows) return
      const list = rows.map((r) => ({ id: r.id, name: r.name, status: r.status ?? 'active' }))
      setOrgs(list)
      setSelectedOrgId((cur) => (cur && list.some((o) => o.id === cur) ? cur : list[0]?.id ?? ''))
    })
    return () => { cancelled = true }
  }, [live])

  const loadOrg = useCallback(async (orgId: string) => {
    if (!orgId || !isLive()) { setLicensed([]); setAudit([]); return }
    setLoading(true)
    try {
      setLicensed((await api.entitlements(orgId)) ?? [])
      setAudit((await api.auditLog({ orgId, limit: 10 })) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadOrg(selectedOrgId) }, [loadOrg, selectedOrgId])

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId)

  // Written through on every click, not collected behind a Save button — the
  // old page's "Save All Changes" did nothing, and a batch that silently drops
  // is worse than a click that visibly fails.
  const toggle = async (platformId: string) => {
    const before = licensed
    const next = before.includes(platformId) ? before.filter((p) => p !== platformId) : [...before, platformId]
    setLicensed(next)
    setBusy(platformId)
    const r = await api.setEntitlements(selectedOrgId, next)
    setBusy(null)
    if (!r) {
      setLicensed(before)
      toast.error('Could not update the entitlement')
      return
    }
    toast.success(next.includes(platformId) ? 'Product licensed' : 'Licence revoked')
    api.auditLog({ orgId: selectedOrgId, limit: 10 }).then((a) => a && setAudit(a))
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Feature Entitlements</h1>
        <p className="text-sm text-slate-500 mt-1">Which products each organization is licensed for</p>
      </div>

      {!live ? (
        <div className="rounded-xl p-6 text-sm text-slate-500" style={surface}>
          Switch to Live mode to manage entitlements.
        </div>
      ) : !orgs.length ? (
        <div className="rounded-xl p-6 text-sm text-slate-500" style={surface}>No organizations yet.</div>
      ) : (
        <>
          {/* Org selector */}
          <div className="flex gap-2 flex-wrap">
            {orgs.map((org) => (
              <button key={org.id} onClick={() => setSelectedOrgId(org.id)}
                className="py-3 px-4 rounded-xl text-left transition-all"
                style={selectedOrgId === org.id
                  ? { background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1' }
                  : surface}>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Building2 size={13} className="text-indigo-400" /> {org.name}
                  {org.status === 'suspended' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)' }}>SUSPENDED</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 font-mono mt-0.5">{org.id}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {PLATFORM_TEMPLATES.map((platform) => {
                const on = licensed.includes(platform.id)
                return (
                  <div key={platform.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${on ? `${platform.accent}55` : '#1e2433'}` }}>
                    <div className="px-5 py-4 flex items-center justify-between gap-4" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white">{platform.name}</h3>
                        <p className="text-[11px] text-slate-500 truncate">{platform.sensorType}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs font-medium" style={{ color: on ? '#4ade80' : '#64748b' }}>
                          {on ? 'Licensed' : 'Not licensed'}
                        </span>
                        <button onClick={() => toggle(platform.id)} disabled={busy === platform.id || loading}
                          className="transition-transform hover:scale-110 disabled:opacity-50">
                          {busy === platform.id ? <Loader2 size={24} className="animate-spin text-indigo-400" />
                            : on ? <ToggleRight size={28} style={{ color: platform.accent }} />
                            : <ToggleLeft size={28} className="text-slate-600" />}
                        </button>
                      </div>
                    </div>
                    <div style={{ background: '#0d1117' }} className="px-5 py-4">
                      <p className="text-[11px] text-slate-500 mb-3">{platform.description}</p>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">Included</div>
                      <div className="flex flex-wrap gap-1.5">
                        {platform.features.map((f) => (
                          <span key={f.name} className="text-[10px] px-2 py-0.5 rounded text-slate-400" style={inset}>{f.name}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}

              <div className="flex items-start gap-2 text-[11px] text-slate-600 px-1">
                <Info size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                  Licensing is per product. The features listed inside each card describe what that product includes —
                  they are not separately switchable, because the platform stores one entitlement per product rather
                  than a flag per feature.
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl p-4" style={surface}>
                <h3 className="text-sm font-semibold text-white mb-3">Summary</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Organization</span>
                    <span className="text-white truncate ml-2">{selectedOrg?.name ?? '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Status</span>
                    <span style={{ color: selectedOrg?.status === 'suspended' ? '#f87171' : '#4ade80' }}>
                      {selectedOrg?.status ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Products licensed</span>
                    <span className="text-white">{licensed.length}/{PLATFORM_TEMPLATES.length}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl p-4" style={surface}>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <ScrollText size={13} className="text-indigo-400" /> Recent changes
                </h3>
                {audit.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No recorded changes for this organization yet.</p>
                ) : (
                  <div className="space-y-3">
                    {audit.map((a) => (
                      <div key={a.id} className="text-xs">
                        <div className="text-indigo-400 font-mono text-[10px]">{a.action}</div>
                        <div className="text-slate-400 truncate">{a.target ?? '—'}</div>
                        <div className="text-slate-600 text-[10px] mt-0.5">
                          {a.actor_name ?? 'unknown'} · {fmtDateTime(a.at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
