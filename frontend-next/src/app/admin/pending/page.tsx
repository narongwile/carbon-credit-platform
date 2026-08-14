'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { useSessionRole, useSessionOrgId } from '@/lib/auth'
import { api, isLive } from '@/lib/api'
import { DOMAIN_TO_PLATFORM } from '@/lib/entitlements'
import { schemaLabel } from '@/lib/useParamLabels'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import { getPlatformTemplate } from '@/lib/platforms'
import type { TransformerModel } from '@/lib/useNodeNameplate'
import type { SensorDomain } from '@/types/fleet'
import PhotoStrip from '@/components/device/PhotoStrip'
import DisplayParamPicker from '@/components/device/DisplayParamPicker'
import OrgPayloadSpecPicker from '@/components/device/OrgPayloadSpecPicker'
import MqttConnectionEditor, { type MqttConnection } from '@/components/MqttConnectionEditor'
import { PlugZap, Check, X, RefreshCw, Building2, Activity, Hash, Settings2, AlertTriangle, Radio, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

// The MQTT topic's product segment, matching worker/main.go's
// domainFromProduct() switch-case exactly (lowercased): "transformer" |
// "eternity" | "eternitytransformers" -> transformer, "carbonnode" |
// "carbonbox" | ... -> carbonNode, "bloodbox" -> bloodBox. Derived from
// PLATFORM_TEMPLATES.shortName rather than hardcoded a second time, so the
// two can't drift — shortName is already 'ETERNITY' / 'CarbonBOX' / 'BloodBOX'.
const topicProduct = (domain: SensorDomain): string =>
  (getPlatformTemplate(DOMAIN_TO_PLATFORM[domain])?.shortName ?? domain).toLowerCase()

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
  // The MQTT setup card specifically must NEVER show one org's real id/topic
  // under another's session — that is what a customer copies into firmware.
  // `orgId` above falls back to the literal string 'org-1' (matching the
  // store's own persisted default, lib/store.ts:60), so for a NON-superadmin
  // whose session→store sync effect (admin/layout.tsx) hasn't run yet, or
  // whose session genuinely carries no orgId, `orgId` would confidently show
  // 'org-1' regardless of whose session this actually is. '' (not the
  // fallback's own default) makes "not yet known" distinguishable from a
  // real id — the card renders nothing until it resolves, rather than
  // guessing. A superadmin has no session org at all (they pick one via the
  // tenant switcher), so they always use `orgId`/`selectedOrgId` instead.
  const sessionOrgId = useSessionOrgId('')
  const cardOrgId = isSuper ? orgId : sessionOrgId
  const [rows, setRows] = useState<PendingNode[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [form, setForm] = useState<Record<string, { name: string; domain: string; departmentId: string; orgId: string; mergeInto: string; modelId: string }>>({})
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

  // The MQTT payload SPEC for a (org, product) pair: which fields that product
  // is supposed to send for that org, and their display names — set up front by
  // a superadmin (display_params + param_labels, org-wide default row, migrate-
  // v26/v34) rather than discovered after the fact. Different units of the same
  // product can send a different sensor set ("each transformer may have values
  // that differ by spec"), which is exactly why display_params already scopes
  // per DEVICE as an override on top of this org-wide default — approving a
  // device here can open that same picker, pointed at this device.
  //
  // Keyed "orgId::domain" rather than nested, so the fetch effect below can
  // dedupe on a flat set of strings instead of walking a tree on every row.
  const [specByKey, setSpecByKey] = useState<Record<string, { paramKeys: string[]; labels: Record<string, string> }>>({})
  const specKeyOf = (targetOrgId: string, domain: string) => `${targetOrgId}::${domain}`
  // Refetch one (org, domain) pair directly rather than invalidating the cache
  // and hoping something re-triggers it: the fetch effect below is keyed on
  // domainOrgPairsKey, which does not change just because a save happened —
  // the pair was already present before the edit.
  const refetchSpec = async (targetOrgId: string, domain: string) => {
    const key = specKeyOf(targetOrgId, domain)
    const [dp, pl] = await Promise.all([api.displayParams(targetOrgId, domain), api.paramLabels(targetOrgId, domain)])
    setSpecByKey((prev) => ({ ...prev, [key]: { paramKeys: dp?.paramKeys ?? [], labels: pl?.labels ?? {} } }))
  }
  // Which row's payload-spec editor is open. Carries the resolved org/domain
  // rather than re-deriving them from `n`/`form` at render time, so the modal's
  // props can't drift if the admin changes the row's Organization/Product
  // picker while it is open.
  const [specEditor, setSpecEditor] = useState<{ node: PendingNode; orgId: string; domain: SensorDomain } | null>(null)
  // Same idea, but for the org-wide reference section below — no specific
  // device involved, so no PendingNode to carry.
  const [orgSpecEditor, setOrgSpecEditor] = useState<{ orgId: string; domain: SensorDomain } | null>(null)

  // MQTT broker connection shown on the setup card. Starts at the platform's
  // shipped defaults — same values GET /api/platform/mqtt itself falls back
  // to when unconfigured — so the card shows something correct even before
  // the fetch resolves, in demo mode, or if the fetch fails, rather than
  // blanking out fields every admin needs to read.
  const [mqttConn, setMqttConn] = useState<MqttConnection>({ host: '27.254.143.144', port: '1883', username: 'device', password: 'iothub.2026', tls: false })
  const [mqttEditorOpen, setMqttEditorOpen] = useState(false)
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.mqttConnection().then((r) => { if (!cancelled && r) setMqttConn(r) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    if (!isLive()) {
      // Demo mode: seed sample pending devices so the page + approve/reject work.
      const mock = buildMockPending(isSuper)
      setRows(mock)
      setForm((prev) => {
        const next = { ...prev }
        for (const n of mock) if (!next[n.id]) next[n.id] = { name: n.name, domain: n.domain, departmentId: '', orgId: n.org_id === UNASSIGNED ? '' : n.org_id, mergeInto: '', modelId: '' }
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
            modelId: '',
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

  // Transformer model catalog per org (migrate-v32) — same org set as
  // entitlements above, so a device approved as 'transformer' can be linked
  // to its real spec (manufacturer/kVA/voltage) in the same step instead of
  // an admin retyping it on the device's own page right after.
  const [modelsByOrg, setModelsByOrg] = useState<Record<string, TransformerModel[]>>({})
  useEffect(() => {
    if (!isLive()) return
    const orgIds = Array.from(new Set([orgId, ...orgs.map((o) => o.id)])).filter((id) => id && id !== UNASSIGNED)
    let cancelled = false
    Promise.all(orgIds.map(async (id) => [id, await api.transformerModels(id)] as const)).then((pairs) => {
      if (cancelled) return
      setModelsByOrg((prev) => {
        const next = { ...prev }
        for (const [id, models] of pairs) if (models) next[id] = models.filter((m) => m.active)
        return next
      })
    })
    return () => { cancelled = true }
  }, [orgId, orgs])

  // Distinct (org, currently-selected product) pairs actually on screen right
  // now — NOT the whole `form` object, and NOT every org in the picker. Editing
  // a row's Name field re-renders `form` on every keystroke; keying the effect
  // on this joined, deduped string instead means a spec is fetched once per
  // pair and never re-fetched just because someone typed a letter.
  const domainOrgPairs = useMemo(() => {
    const set = new Set<string>()
    for (const n of rows) {
      const f = form[n.id]
      if (!f) continue
      const targetOrg = isSuper ? f.orgId : orgId
      if (!targetOrg || targetOrg === UNASSIGNED) continue
      set.add(specKeyOf(targetOrg, f.domain))
    }
    // Also every product THIS org (cardOrgId — see its own comment: the
    // admin's own verified session org, or the superadmin's tenant-switcher
    // pick, and '' rather than a guessed default while unresolved) is
    // licensed for, independent of whether any device — pending or approved
    // — exists yet. This is what makes the setup reference below usable for
    // a brand-new org: it has to answer "what do I send" before the
    // chicken-and-egg problem of needing a device to have already reported
    // something in order to know what it should report.
    if (cardOrgId && cardOrgId !== UNASSIGNED) {
      for (const d of domainsFor(cardOrgId)) set.add(specKeyOf(cardOrgId, d.value))
    }
    return Array.from(set).sort()
    // domainsFor reads entsByOrg via closure, not a dep — it is a plain function
    // recreated every render, and adding it here would defeat the whole point of
    // keying this memo on a stable joined string below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, form, isSuper, orgId, cardOrgId, entsByOrg])
  const domainOrgPairsKey = domainOrgPairs.join(',')

  useEffect(() => {
    if (!isLive() || !domainOrgPairsKey) return
    let cancelled = false
    Promise.all(domainOrgPairs.map(async (key) => {
      const [oid, dom] = key.split('::')
      const [dp, pl] = await Promise.all([api.displayParams(oid, dom), api.paramLabels(oid, dom)])
      return [key, { paramKeys: dp?.paramKeys ?? [], labels: pl?.labels ?? {} }] as const
    })).then((results) => {
      if (cancelled) return
      setSpecByKey((prev) => {
        const next = { ...prev }
        for (const [key, val] of results) next[key] = val
        return next
      })
    })
    return () => { cancelled = true }
    // domainOrgPairsKey is the deliberate dependency — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainOrgPairsKey])

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
      modelId: f.domain === 'transformer' ? (f.modelId || undefined) : undefined,
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

      {/* MQTT setup reference — this org's REAL id, for every product it is
          licensed for, independent of whether any device exists yet. The old
          empty state below only ever showed the literal template string
          "telemetry/{org}/{product}/{id}" — {org} was never substituted, so a
          brand-new org's admin had no way to learn their own org's actual id
          from this page at all, only ?org= (this) config check.
          Configuring the payload spec is superadmin-only (set at provisioning);
          the topic and whatever spec already exists are visible to every admin
          — they are the ones who actually have to go program a device with it.

          Uses cardOrgId, NOT orgId — see cardOrgId's own comment. A regular
          admin must never be shown another org's real id/credentials on the
          page they copy firmware config from. */}
      {!isSuper && !cardOrgId ? (
        <div className="rounded-xl p-4 text-xs text-slate-500" style={surface}>Resolving your organization…</div>
      ) : cardOrgId && cardOrgId !== UNASSIGNED && (
        <div className="rounded-xl p-4 space-y-3" style={surface}>
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">MQTT setup — connect a new device</h2>
          </div>

          {/* Connection details. All EMQX 'device' users share ONE account —
              tenant isolation comes entirely from the MQTT clientId, which the
              broker's ACL requires to equal the org id (device -> publish
              telemetry/${'{clientid}'}/#). Get the clientId wrong and the
              broker does not reject the connection or the publish — it just
              silently drops it (EMQX deny_action=ignore) — so this has to be
              stated as plainly as the topic itself, not left for someone to
              guess from a support ticket. */}
          <div className="rounded-lg p-3 space-y-1.5" style={inset}>
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider">Broker connection</div>
              {isSuper && (
                <button onClick={() => setMqttEditorOpen(true)}
                  className="text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 text-indigo-400 hover:text-indigo-300" style={surface}>
                  <Settings2 size={10} /> Edit
                </button>
              )}
            </div>
            {([
              ['Host', mqttConn.host],
              ['Port', `${mqttConn.port} (${mqttConn.tls ? 'TLS' : 'plain TCP, no TLS'})`],
              ['Username', mqttConn.username],
              ['Password', mqttConn.password],
              ['MQTT Client ID', cardOrgId],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500 w-28 flex-shrink-0">{label}</span>
                <span className="font-mono text-slate-300 truncate">{value}</span>
                <button onClick={() => { navigator.clipboard?.writeText(value); toast.success(`${label} copied`) }}
                  title={`Copy ${label}`} className="text-slate-600 hover:text-white flex-shrink-0"><Copy size={10} /></button>
              </div>
            ))}
            <p className="text-[10px] text-amber-500/90 pt-1">
              Client ID must be set to this exact value — a shared broker account tells organizations apart ONLY by
              client ID. Get it wrong and the device connects fine but every publish is silently dropped.
            </p>
          </div>

          {domainsFor(cardOrgId).length === 0 ? (
            <p className="text-xs text-slate-600">This organization is not licensed for any product yet.</p>
          ) : (
            <div className="space-y-3">
              {domainsFor(cardOrgId).map((d) => {
                const domain = d.value as SensorDomain
                const spec = specByKey[specKeyOf(cardOrgId, domain)]
                const topic = `telemetry/${cardOrgId}/${topicProduct(domain)}/<your-device-id>`
                const exampleValues = (spec?.paramKeys ?? []).reduce<Record<string, number>>((acc, k) => {
                  const warn = ALARM_SCHEMA[domain]?.params.find((p) => p.key === k)?.warn
                  acc[k] = typeof warn === 'number' ? Math.round((warn / 2) * 10) / 10 : 0
                  return acc
                }, {})
                const example = JSON.stringify({ nodeId: '<your-device-id>', ts: Date.now(), values: exampleValues }, null, 2)
                return (
                  <div key={domain} className="rounded-lg p-3" style={inset}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-medium text-white">{d.label}</span>
                      {isSuper && (
                        <button onClick={() => setOrgSpecEditor({ orgId: cardOrgId, domain })}
                          className="text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 text-indigo-400 hover:text-indigo-300" style={surface}>
                          <Settings2 size={10} /> Configure
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Hash size={10} className="text-slate-600 flex-shrink-0" />
                      <span className="font-mono text-[11px] text-slate-300 truncate" title={topic}>{topic}</span>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(topic); toast.success('Topic copied') }}
                        title="Copy topic" className="text-slate-600 hover:text-white flex-shrink-0"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                    {spec && spec.paramKeys.length > 0 ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          {spec.paramKeys.map((k) => (
                            <span key={k} className="text-[11px] px-2 py-0.5 rounded-md font-mono" style={surface}>
                              <span className="text-slate-500">{spec.labels[k] || schemaLabel(domain, k)}</span> <span className="text-slate-600">{k}</span>
                            </span>
                          ))}
                        </div>
                        <div className="relative">
                          <pre className="text-[10px] text-slate-400 rounded-md p-2 overflow-x-auto font-mono" style={surface}>{example}</pre>
                          <button
                            onClick={() => { navigator.clipboard?.writeText(example); toast.success('Payload example copied') }}
                            title="Copy JSON" className="absolute top-1.5 right-1.5 text-slate-600 hover:text-white"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                        {/* The example implies these rules but never states them,
                            and every one of them fails SILENTLY on the wire — the
                            worker logs a parse error server-side and the device
                            never appears here, with nothing to say why. */}
                        <ul className="text-[10px] text-slate-600 mt-2 space-y-0.5 list-disc list-inside">
                          <li>Every value in <span className="font-mono">values</span> must be a JSON number, not a string — <span className="font-mono">&quot;oilTemp&quot;:&quot;63.4&quot;</span> is rejected, the whole message is dropped.</li>
                          <li><span className="font-mono">values</span> must not be empty — a status/heartbeat-only frame (no <span className="font-mono">values</span>) is presence, not a reading, and by itself will not create this pending entry.</li>
                          <li><span className="font-mono">ts</span> is Unix time in <span className="font-mono">milliseconds</span> (13 digits); omit it and the server stamps arrival time instead.</li>
                          <li><span className="font-mono">nodeId</span> in the payload — not the last topic segment — is this device&apos;s real identity, and must be unique across every customer on the platform, not just this organization.</li>
                        </ul>
                      </>
                    ) : (
                      <p className="text-[11px] text-slate-600">
                        {isSuper
                          ? 'No payload spec configured yet — click Configure to define which fields this product sends.'
                          : "No payload spec configured yet — a device may publish any fields under payload.values and they'll show up once it connects."}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500 text-sm" style={surface}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-10 rounded-xl text-center" style={surface}>
          <PlugZap size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No devices awaiting approval.</p>
          {/* Used to unconditionally promise "will appear here within seconds" —
              false often enough to be actively misleading: a bad client ID, an
              org id typo, or a non-numeric value all drop the message on the
              floor with zero feedback anywhere in the product. This is the one
              honest thing the page can say instead. */}
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
            A device publishing correctly to the topic above appears here within seconds. If nothing shows up after
            a real publish attempt, check in order: (1) MQTT client ID matches your organization id exactly,
            (2) the topic&apos;s organization segment matches it too, (3) every field under <span className="font-mono">values</span> is a number, not a string.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((n) => {
            const f = form[n.id] ?? { name: n.id, domain: n.domain, departmentId: '', orgId: n.org_id === UNASSIGNED ? '' : n.org_id, mergeInto: '', modelId: '' }
            const set = (patch: Partial<typeof f>) => setForm((s) => ({ ...s, [n.id]: { ...f, ...patch } }))
            const isOrphan = n.org_id === UNASSIGNED
            const sample = n.last_sample && typeof n.last_sample === 'object' ? Object.entries(n.last_sample) : []
            const sampleKeys = new Set(sample.map(([k]) => k))
            // The org this row currently resolves to — may still be empty for
            // an unclaimed orphan a superadmin has not assigned yet.
            const targetOrgId = isSuper ? f.orgId : orgId
            const spec = targetOrgId ? specByKey[specKeyOf(targetOrgId, f.domain)] : undefined
            const specLabelOf = (k: string) => spec?.labels[k] || schemaLabel(f.domain as SensorDomain, k)
            // Fields the org's spec expects for this product that this device
            // has not actually sent yet — worth a flag, not a block: a unit can
            // be missing an optional sensor and still be worth approving.
            const missingFromSpec = spec ? spec.paramKeys.filter((k) => !sampleKeys.has(k)) : []
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

                {/* The actual MQTT topic this device published on
                    (telemetry/{org}/{product}/{id}) — captured verbatim by the
                    worker at auto-registration, so it reflects what the device
                    really sent even if the org/product below get corrected. */}
                {n.mqtt_prefix && (
                  <div className="flex items-center gap-1.5 mb-2 text-[11px]">
                    <Hash size={11} className="text-slate-600 flex-shrink-0" />
                    <span className="font-mono text-slate-500 truncate" title={n.mqtt_prefix}>{n.mqtt_prefix}</span>
                  </div>
                )}

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

                {/* Expected payload for this product+org — the spec a superadmin
                    sets up front (display_params/param_labels, org-wide default),
                    not something inferred from whichever device happened to
                    connect first. Shown to every approver as a reference; only a
                    superadmin gets the button to change it, per how licensing
                    (Feature Entitlements) already works on this platform. */}
                {targetOrgId && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider flex-shrink-0">Expected payload</span>
                    {spec && spec.paramKeys.length > 0 ? (
                      spec.paramKeys.map((k) => {
                        const present = sampleKeys.has(k)
                        return (
                          <span key={k} title={present ? 'reported in the last sample' : 'not seen in the last sample — may be optional on this unit'}
                            className="text-[11px] px-2 py-0.5 rounded-md" style={present ? inset : { background: 'rgba(251,191,36,0.08)', border: '1px dashed #92702c' }}>
                            <span className={present ? 'text-slate-200' : 'text-amber-500'}>{specLabelOf(k)}</span>
                            <span className="text-slate-600 font-mono ml-1">{k}</span>
                          </span>
                        )
                      })
                    ) : (
                      <span className="text-[11px] text-slate-600">not configured yet — approving will show every field this device sends</span>
                    )}
                    {isSuper && (
                      <button onClick={() => setSpecEditor({ node: n, orgId: targetOrgId, domain: f.domain as SensorDomain })}
                        className="text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 text-indigo-400 hover:text-indigo-300" style={inset}>
                        <Settings2 size={10} /> Configure
                      </button>
                    )}
                  </div>
                )}
                {missingFromSpec.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-3 text-[11px] text-amber-500">
                    <AlertTriangle size={11} className="flex-shrink-0" />
                    <span>{missingFromSpec.length} expected field{missingFromSpec.length === 1 ? '' : 's'} not in the last sample — confirm this unit&apos;s spec before approving, or it may just be an optional sensor.</span>
                  </div>
                )}

                {/* What the thing actually is. Readings say a device is alive;
                    they do not say whether it is the pole-mount at Gate 3 or a
                    bench unit someone left powered in the workshop — and the
                    admin approving it has usually never stood in front of it.
                    Photos attach to the node id, which approval does not
                    change, so one added here is already on the device page the
                    moment it is approved. */}
                <div className="mb-3">
                  <PhotoStrip nodeId={n.id} orgId={isSuper ? (f.orgId || n.org_id) : orgId} deviceName={f.name} canEdit
                    emptyHint="No site photo — ask whoever installed it, or approve without one" />
                </div>

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
                  {/* Only for transformer: link its real spec (migrate-v32) so the
                      unit doesn't start life with every Asset Info field reading
                      "Not entered" until someone retypes what's already known from
                      the model it was ordered as. */}
                  {f.domain === 'transformer' && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Transformer model (optional)</label>
                      <select value={f.modelId} onChange={(e) => set({ modelId: e.target.value })}
                        className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset}>
                        <option value="" className="bg-[#0d1117]">— not in catalog —</option>
                        {(modelsByOrg[isSuper ? f.orgId : orgId] ?? []).map((m) => (
                          <option key={m.id} value={m.id} className="bg-[#0d1117]">
                            {m.modelCode}{m.ratedKva != null ? ` · ${m.ratedKva} kVA` : ''}{m.voltageClass ? ` · ${m.voltageClass}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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

      {/* Reuses the same picker device settings use (org-wide default OR
          per-device override, migrate-v26/v34) rather than a one-off editor —
          this IS that config, just reached before the device is approved
          instead of after, from its own settings page. */}
      {specEditor && (
        <DisplayParamPicker
          orgId={specEditor.orgId}
          domain={specEditor.domain}
          nodeId={specEditor.node.id}
          available={specEditor.node.last_sample ? Object.keys(specEditor.node.last_sample) : []}
          onClose={() => setSpecEditor(null)}
          onSaved={() => refetchSpec(specEditor.orgId, specEditor.domain)}
        />
      )}

      {/* Same tables, but for a product with no device to check boxes
          against yet — see OrgPayloadSpecPicker's own header comment for why
          DisplayParamPicker doesn't fit that case. */}
      {orgSpecEditor && (
        <OrgPayloadSpecPicker
          orgId={orgSpecEditor.orgId}
          domain={orgSpecEditor.domain}
          onClose={() => setOrgSpecEditor(null)}
          onSaved={() => refetchSpec(orgSpecEditor.orgId, orgSpecEditor.domain)}
        />
      )}

      {mqttEditorOpen && (
        <MqttConnectionEditor
          current={mqttConn}
          onClose={() => setMqttEditorOpen(false)}
          onSaved={setMqttConn}
        />
      )}
    </div>
  )
}
