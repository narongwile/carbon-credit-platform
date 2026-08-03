'use client'

// ---------------------------------------------------------------------------
// License Manager — and the console a superadmin actually reaches for during
// unplanned maintenance.
// ---------------------------------------------------------------------------
// This page used to be entirely fiction: a hardcoded "124 organizations",
// "4.2 PB", "99.97% uptime", tier limits (max transformers / storage / users)
// that nothing anywhere enforces, and Edit/Revoke buttons with no onClick. In
// an incident that is worse than a blank screen — it invites a decision based
// on numbers nobody computed.
//
// What it shows now is only what the database can actually answer:
//   · every organization that exists, live
//   · which platforms each is licensed for (org_entitlements)
//   · whether it is active or suspended (organizations.status)
//
// Tier / storage / user quotas are deliberately absent: there is no column for
// them and no code path that enforces one, so showing a limit would be another
// promise the system does not keep.
//
// The maintenance affordance is Suspend / Resume. A suspended organization is a
// 403 for every one of its users, at login and on every subsequent request,
// while the superadmin keeps full access — lock the tenant out, keep working.
// Telemetry ingest deliberately keeps running (it is outside the auth guard),
// so suspending during an incident never leaves a hole in the customer's data.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, isLive, useIsLive } from '@/lib/api'
import { PLATFORM_TEMPLATES } from '@/lib/platforms'
import { downloadCSV } from '@/lib/exportFile'
import { fmtDateTime } from '@/lib/displayTime'
import {
  Building2, Boxes, ShieldAlert, Search, Play, Pause, Loader2, ScrollText, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface OrgRow { id: string; name: string; status: string }
type EntMap = Record<string, string[]>

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}20` }}>
          <span style={{ color }}>{icon}</span>
        </div>
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

const platformName = (id: string) => PLATFORM_TEMPLATES.find((p) => p.id === id)?.shortName ?? id

export default function LicensePage() {
  const live = useIsLive()
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [ents, setEnts] = useState<EntMap>({})
  const [audit, setAudit] = useState<{ id: number; actor_name: string | null; action: string; target: string | null; at: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [busyOrg, setBusyOrg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isLive()) { setOrgs([]); setEnts({}); setAudit([]); return }
    setLoading(true)
    try {
      const rows = (await api.orgs()) ?? []
      const list = rows.map((r) => ({ id: r.id, name: r.name, status: r.status ?? 'active' }))
      setOrgs(list)
      // Entitlements are per-org endpoints; fan out once and index by org.
      const pairs = await Promise.all(list.map(async (o) => [o.id, (await api.entitlements(o.id)) ?? []] as const))
      setEnts(Object.fromEntries(pairs))
      setAudit((await api.auditLog({ limit: 12 })) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, live])

  const setStatus = async (org: OrgRow, status: 'active' | 'suspended') => {
    if (status === 'suspended' && !confirm(
      `Suspend ${org.name}?\n\nEvery user in this organization is locked out immediately — they cannot sign in and every request returns 403. You keep full access.\n\nIncoming telemetry keeps recording, so no data is lost.`
    )) return
    setBusyOrg(org.id)
    const r = await api.setOrgStatus(org.id, status)
    setBusyOrg(null)
    if (!r) { toast.error(`Could not ${status === 'suspended' ? 'suspend' : 'resume'} ${org.name}`); return }
    setOrgs((prev) => prev.map((o) => (o.id === org.id ? { ...o, status } : o)))
    toast.success(status === 'suspended' ? `${org.name} suspended — its users are locked out` : `${org.name} resumed`)
    api.auditLog({ limit: 12 }).then((a) => a && setAudit(a))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orgs
    return orgs.filter((o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
  }, [orgs, search])

  const suspended = orgs.filter((o) => o.status === 'suspended').length
  const licensedTotal = Object.values(ents).reduce((n, l) => n + l.length, 0)

  const exportCsv = () => {
    downloadCSV(
      `licenses_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Organization', 'Org ID', 'Status', 'Licensed platforms'],
      filtered.map((o) => [o.name, o.id, o.status, (ents[o.id] ?? []).map(platformName).join(' | ')]),
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">License Manager</h1>
          <p className="text-sm text-slate-500 mt-1">Live license state, and the suspend switch for unplanned maintenance</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white disabled:opacity-50" style={inset}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      {!live ? (
        <div className="rounded-xl p-6 text-sm text-slate-500" style={surface}>
          Switch to Live mode to manage licenses. This screen deliberately shows nothing in demo mode rather than
          example numbers — a maintenance console that invents figures is worse than one that is empty.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={<Building2 size={18} />} label="Organizations" value={String(orgs.length)} color="#6366f1" />
            <StatCard icon={<Boxes size={18} />} label="Platform licenses granted" value={String(licensedTotal)} color="#4ade80" />
            <StatCard icon={<ShieldAlert size={18} />} label="Suspended" value={String(suspended)} color={suspended ? '#ef4444' : '#6b7280'} />
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an organization by name or id…"
              className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
              style={surface} />
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              <h3 className="text-sm font-semibold text-white">Organization licenses</h3>
              <button onClick={exportCsv} disabled={!filtered.length} className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40">Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                    {['Organization', 'Licensed platforms', 'Status', 'Maintenance'].map((h) => (
                      <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ background: '#0d1117' }}>
                  {loading && !orgs.length && (
                    <tr><td colSpan={4} className="py-8 text-center text-slate-600 text-xs">Loading…</td></tr>
                  )}
                  {!loading && !filtered.length && (
                    <tr><td colSpan={4} className="py-8 text-center text-slate-600 text-xs">
                      {orgs.length ? 'No organization matches that search.' : 'No organizations yet.'}
                    </td></tr>
                  )}
                  {filtered.map((org) => {
                    const licensed = ents[org.id] ?? []
                    const isSuspended = org.status === 'suspended'
                    return (
                      <tr key={org.id} style={{ borderBottom: '1px solid #1e2433' }}
                        className={isSuspended ? 'bg-red-500/5' : ''}>
                        <td className="py-3.5 px-4">
                          <div className="text-white font-medium">{org.name}</div>
                          <div className="text-[10px] text-slate-600 font-mono">{org.id}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {licensed.length ? licensed.map((p) => (
                              <span key={p} className="text-[10px] px-1.5 py-0.5 rounded text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>
                                {platformName(p)}
                              </span>
                            )) : <span className="text-[11px] text-slate-600">none</span>}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium"
                            style={{ color: isSuspended ? '#ef4444' : '#4ade80' }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: isSuspended ? '#ef4444' : '#4ade80' }} />
                            {isSuspended ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => setStatus(org, isSuspended ? 'active' : 'suspended')}
                            disabled={busyOrg === org.id}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium disabled:opacity-50"
                            style={isSuspended
                              ? { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)' }
                              : { color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                            {busyOrg === org.id ? <Loader2 size={12} className="animate-spin" />
                              : isSuspended ? <Play size={12} /> : <Pause size={12} />}
                            {isSuspended ? 'Resume' : 'Suspend'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* The real audit trail — during an incident this is the record of who
              did what, so it must never be example data. */}
          <div className="rounded-xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <ScrollText size={14} className="text-indigo-400" /> Recent administrative actions
            </h3>
            {audit.length === 0 ? (
              <p className="text-xs text-slate-600">
                Nothing recorded yet. Licence changes, suspensions and deletions are written here as they happen.
              </p>
            ) : (
              <div className="space-y-2">
                {audit.map((a) => (
                  <div key={a.id} className="flex items-baseline gap-3 text-xs">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded text-indigo-300 flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}>{a.action}</span>
                    <span className="text-slate-300 truncate">{a.target ?? '—'}</span>
                    <span className="text-slate-600 ml-auto flex-shrink-0">
                      {a.actor_name ?? 'unknown'} · {fmtDateTime(a.at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
