'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { useSessionRole } from '@/lib/auth'
import { api, isLive } from '@/lib/api'
import { DOMAIN_TO_PLATFORM } from '@/lib/entitlements'
import { PlugZap, Check, X, RefreshCw, Building2, Activity } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const UNASSIGNED = '__unassigned__'

const DOMAINS = [
  { value: 'transformer', label: 'Transformer (ETERNITY)' },
  { value: 'carbonNode', label: 'Refrigeration (CarbonBOX)' },
  { value: 'bloodBox', label: 'BloodBOX' },
]

interface PendingNode {
  id: string
  org_id: string
  org_name: string | null
  domain: string
  name: string
  mqtt_prefix: string | null
  first_seen: string
  last_seen: string | null
  online: 0 | 1 | null
  last_sample: Record<string, number> | null
}
interface Dept { id: string; name: string }
interface Org { id: string; name: string; status?: string }

// Zero-touch onboarding review. Devices that publish telemetry with an unknown id
// are auto-registered as 'pending' by the Go worker (org taken from their MQTT
// topic; an unrecognized org lands the device in the claimable '__unassigned__'
// pool). Admin names it, picks a department, and approves — or rejects. A
// superadmin additionally sees every org's pending devices and can reassign each
// (required to claim an orphan) to exactly one real org.
// Demo (mock-mode) sample so the page — and its approve/reject flow — is usable
// without a live backend. Timestamps are built at call time to stay "recent".
function buildMockPending(isSuper: boolean): PendingNode[] {
  const now = Date.now()
  const iso = (secAgo: number) => new Date(now - secAgo * 1000).toISOString()
  const base: PendingNode[] = [
    { id: 'TRA-9F2C', org_id: 'org-1', org_name: 'KMUTT', domain: 'transformer', name: 'TRA-9F2C', mqtt_prefix: 'telemetry/org-1/eternity/TRA-9F2C', first_seen: iso(48), last_seen: iso(3), online: 1, last_sample: { oilTemp: 63.4, hydrogen: 118, moisture: 21, load: 72 } },
    { id: 'TRA-77A1', org_id: 'org-1', org_name: 'KMUTT', domain: 'transformer', name: 'TRA-77A1', mqtt_prefix: 'telemetry/org-1/eternity/TRA-77A1', first_seen: iso(120), last_seen: iso(8), online: 1, last_sample: { oilTemp: 58.1, hydrogen: 95, load: 64 } },
  ]
  if (isSuper) base.push({ id: 'NODE-XX99', org_id: UNASSIGNED, org_name: 'Unassigned / Pending Claim', domain: 'transformer', name: 'NODE-XX99', mqtt_prefix: 'telemetry/acme/eternity/NODE-XX99', first_seen: iso(30), last_seen: iso(5), online: 1, last_sample: { oilTemp: 61.0, hydrogen: 140 } })
  return base
}
const MOCK_DEPTS: Dept[] = [{ id: 'dept-1', name: 'Substation A' }, { id: 'dept-2', name: 'Substation B' }]
const MOCK_ORGS: Org[] = [{ id: 'org-1', name: 'KMUTT' }, { id: 'org-2', name: 'Siriraj Hospital' }]

export default function PendingDevicesPage() {
  const { selectedOrgId } = useAppStore()
  // useSessionRole (not getSession() directly): the direct read returns null
  // in the statically-built HTML and the real role synchronously on the
  // client's first paint, and isSuper branches JSX below (extra column, extra
  // field) — a guaranteed hydration mismatch for every superadmin.
  const isSuper = useSessionRole() === 'superadmin'
  const orgId = selectedOrgId || 'org-1'
  const [rows, setRows] = useState<PendingNode[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [form, setForm] = useState<Record<string, { name: string; domain: string; departmentId: string; orgId: string; mergeInto: string }>>({})
  // Devices already on the fleet — the candidates a second feed can be merged
  // into. Loaded per org so the picker never offers another tenant's device.
  const [fleet, setFleet] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Which sensor domains each org is actually licensed for (org_entitlements),
  // so approving a device can't quietly assign it to a product the org never
  // bought — e.g. an org provisioned with ETERNITY only should not see
  // Refrigeration/BloodBOX as options here. Empty/missing entry = unknown yet
  // (still loading, or entitlements fetch failed) → don't filter, same as the
  // rest of the app's "no entitlement answer yet" fallback.
  const [entsByOrg, setEntsByOrg] = useState<Record<string, string[]>>({})

  const load = useCallback(async () => {
    if (!isLive()) {
      // Demo mode: seed sample pending devices so the page + approve/reject work.
      const mock = buildMockPending(isSuper)
      setRows(mock)
      setForm((prev) => {
        const next = { ...prev }
        for (const n of mock) if (!next[n.id]) next[n.id] = { name: n.name, domain: n.domain, departmentId: '', orgId: n.org_id === UNASSIGNED ? '' : n.org_id, mergeInto: '' }
        return next
      })
      setDepts(MOCK_DEPTS)
      if (isSuper) setOrgs(MOCK_ORGS)
      setLoading(false)
      return
    }
    // Superadmin: omit orgId → every org's pending devices, incl. orphans.
    const [pend, dp, og, fl] = await Promise.all([
      api.pendingNodes(isSuper ? undefined : orgId),
      api.departments(orgId),
      isSuper ? api.orgs() : Promise.resolve(null),
      api.fleet(orgId),
    ])
    if (pend) {
      setRows(pend)
      setForm((prev) => {
        const next = { ...prev }
        for (const n of pend) {
          if (!next[n.id]) next[n.id] = {
            name: n.name || n.id,
            domain: n.domain || 'transformer',
            departmentId: '',
            mergeInto: '',
            // Orphans default to "pick an org"; others keep their attributed org.
            orgId: n.org_id === UNASSIGNED ? '' : n.org_id,
          }
        }
        return next
      })
    }
    if (dp) setDepts(dp as Dept[])
    if (fl) setFleet(fl.map((d) => ({ id: d.id, name: d.name || d.id })))
    // Real, active orgs only — never offer the '__unassigned__' pool as a target.
    if (og) setOrgs((og as Org[]).filter((o) => o.id !== UNASSIGNED && o.status !== 'suspended'))
    setLoading(false)
  }, [orgId, isSuper])

  useEffect(() => {
    load()
    if (!isLive()) return               // demo mode: no polling (would re-seed the mock)
    const t = setInterval(load, 10000)    // poll so newly-connected devices appear
    return () => clearInterval(t)
  }, [load])

  // Fetch entitlements once per distinct set of orgs in view — an admin only
  // ever needs their own org; a superadmin needs every org offered in the
  // "Organization" picker (orphans get filtered once an org is actually chosen).
  useEffect(() => {
    if (!isLive()) return
    const orgIds = Array.from(new Set([orgId, ...orgs.map((o) => o.id)])).filter((id) => id && id !== UNASSIGNED)
    let cancelled = false
    Promise.all(orgIds.map(async (id) => [id, (await api.entitlements(id)) ?? null] as const)).then((pairs) => {
      if (cancelled) return
      setEntsByOrg((prev) => {
        const next = { ...prev }
        for (const [id, ents] of pairs) if (ents) next[id] = ents
        return next
      })
    })
    return () => { cancelled = true }
  }, [orgId, orgs])

  // Domains this org is licensed for. Undefined (not fetched yet / fetch
  // failed) means "unknown" — show every domain rather than guess wrong.
  const domainsFor = (targetOrgId: string) => {
    const ents = entsByOrg[targetOrgId]
    if (!ents) return DOMAINS
    return DOMAINS.filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d.value as keyof typeof DOMAIN_TO_PLATFORM]))
  }

  const approve = async (n: PendingNode) => {
    const f = form[n.id]
    if (isSuper && !f.orgId) { toast.error('Select an organization for this device'); return }
    if (!isLive()) { toast.success(`Approved ${f.name} (demo)`); setRows((r) => r.filter((x) => x.id !== n.id)); return }
    setBusy(n.id)
    const res = await api.approveNode(n.id, {
      name: f.name,
      domain: f.domain,
      departmentId: f.departmentId || undefined,
      orgId: isSuper ? f.orgId : undefined,
      mergeInto: f.mergeInto || undefined,
    })
    setBusy(null)
    if (res?.ok) { toast.success(`Approved ${f.name}`); setRows((r) => r.filter((x) => x.id !== n.id)) }
    else toast.error('Approve failed')
  }
  const reject = async (n: PendingNode) => {
    if (!isLive()) { toast.success(`Rejected ${n.id} (demo)`); setRows((r) => r.filter((x) => x.id !== n.id)); return }
    setBusy(n.id)
    const res = await api.rejectNode(n.id)
    setBusy(null)
    if (res?.ok) { toast.success(`Rejected ${n.id}`); setRows((r) => r.filter((x) => x.id !== n.id)) }
    else toast.error('Reject failed')
  }

  const ago = (ts: string | null) => {
    if (!ts) return '—'
    const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ago`
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><PlugZap size={20} className="text-indigo-400" /> Pending Devices</h1>
          <p className="text-sm text-slate-500 mt-0.5">Devices that connected and auto-registered — approve to add them to your fleet, or reject.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white" style={surface}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {!isLive() && (
        <div className="p-3 rounded-xl text-xs text-slate-400 flex items-center gap-2" style={inset}>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 font-semibold">DEMO</span>
          Showing sample devices. Live auto-registration activates when the build sets <span className="font-mono text-slate-300">NEXT_PUBLIC_API_URL</span> (points at the Node-RED backend).
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500 text-sm" style={surface}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-10 rounded-xl text-center" style={surface}>
          <PlugZap size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No devices awaiting approval.</p>
          <p className="text-xs text-slate-600 mt-1">A newly powered device publishing to <span className="font-mono">telemetry/{'{org}'}/{'{product}'}/{'{id}'}</span> will appear here within seconds.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((n) => {
            const f = form[n.id] ?? { name: n.id, domain: n.domain, departmentId: '', orgId: n.org_id === UNASSIGNED ? '' : n.org_id, mergeInto: '' }
            const set = (patch: Partial<typeof f>) => setForm((s) => ({ ...s, [n.id]: { ...f, ...patch } }))
            const isOrphan = n.org_id === UNASSIGNED
            const sample = n.last_sample && typeof n.last_sample === 'object' ? Object.entries(n.last_sample) : []
            return (
              <div key={n.id} className="p-4 rounded-xl" style={surface}>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className={`w-2 h-2 rounded-full ${n.online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  <span className="font-mono text-sm text-white">{n.id}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-medium">PENDING</span>
                  {isSuper && (
                    isOrphan ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                        <Building2 size={10} /> UNCLAIMED — no matching org
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 text-slate-400" style={inset}>
                        <Building2 size={10} /> {n.org_name || n.org_id}
                      </span>
                    )
                  )}
                  <span className="text-xs text-slate-500 ml-auto">last seen {ago(n.last_seen)} · first {ago(n.first_seen)}</span>
                </div>

                {/* Latest telemetry sample so the admin can sanity-check readings */}
                {sample.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    <Activity size={12} className="text-slate-500" />
                    {sample.map(([k, v]) => (
                      <span key={k} className="text-[11px] px-2 py-0.5 rounded-md font-mono" style={inset}>
                        <span className="text-slate-500">{k}</span> <span className="text-slate-200">{typeof v === 'number' ? v : String(v)}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className={`grid grid-cols-1 gap-3 items-end ${isSuper ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
                  {isSuper && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Organization</label>
                      <select value={f.orgId} onChange={(e) => set({ orgId: e.target.value })}
                        className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500"
                        style={{ ...inset, ...(isOrphan && !f.orgId ? { border: '1px solid #ef4444' } : {}) }}>
                        <option value="" className="bg-[#0d1117]">— select org —</option>
                        {orgs.map((o) => <option key={o.id} value={o.id} className="bg-[#0d1117]">{o.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Name</label>
                    <input value={f.name} onChange={(e) => set({ name: e.target.value })}
                      className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Product / Domain</label>
                    <select value={f.domain} onChange={(e) => set({ domain: e.target.value })}
                      className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset}>
                      {(() => {
                        const targetOrg = isSuper ? f.orgId : orgId
                        const licensed = targetOrg ? domainsFor(targetOrg) : DOMAINS
                        // The device's actual telemetry domain always stays selectable,
                        // even if unlicensed — hiding it would silently approve the
                        // device into a DIFFERENT domain than what it's really sending.
                        const opts = licensed.some((d) => d.value === f.domain) ? licensed : [...licensed, ...DOMAINS.filter((d) => d.value === f.domain)]
                        return opts.map((d) => (
                          <option key={d.value} value={d.value} className="bg-[#0d1117]">
                            {d.label}{!licensed.some((x) => x.value === d.value) ? ' — not licensed' : ''}
                          </option>
                        ))
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Department (optional)</label>
                    <select value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })}
                      className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset}>
                      <option value="" className="bg-[#0d1117]">— none —</option>
                      {depts.map((d) => <option key={d.id} value={d.id} className="bg-[#0d1117]">{d.name}</option>)}
                    </select>
                  </div>
                  {/* One asset can publish on two topics — a transformer whose power
                      meter sends the electrical set and whose box sensor sends
                      Oiltemp/H2/moisture arrives here as two devices. Approving the
                      second one INTO the first stores both topics' readings on that
                      device, so the twin, its alarms and its reports see every
                      parameter instead of half of each. */}
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Second feed of (optional)</label>
                    <select value={f.mergeInto} onChange={(e) => set({ mergeInto: e.target.value })}
                      className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset}>
                      <option value="" className="bg-[#0d1117]">— standalone device —</option>
                      {fleet.map((d) => <option key={d.id} value={d.id} className="bg-[#0d1117]">{d.name} ({d.id})</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={busy === n.id} onClick={() => approve(n)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white disabled:opacity-50" style={gradient}>
                      <Check size={14} /> Approve
                    </button>
                    <button disabled={busy === n.id} onClick={() => reject(n)}
                      className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-sm text-red-400 hover:bg-red-400/10 disabled:opacity-50" style={inset}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
