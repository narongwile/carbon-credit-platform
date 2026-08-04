'use client'

// ---------------------------------------------------------------------------
// System Logs — the real administrative audit trail (admin_audit, migrate-v30).
// ---------------------------------------------------------------------------
// This page used to be entirely fiction: actor/action/target/IP address/
// success-or-failure rows from mockData.ts, with no backend behind any of it.
// The IP-address and success/failure columns are gone rather than faked onto
// real data: nothing in this platform logs a login attempt with an IP — the
// real table (admin_audit) records administrative CHANGES (an admin acted,
// and it went through), which is a different thing and does not have a
// pass/fail outcome to show. License Manager already shows the last 12 of
// these in a side panel; this is the same feed, full and searchable.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { Search, Clock, User, Building2, ScrollText } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface AuditRow {
  id: number
  actor_name: string | null
  action: string
  org_id: string | null
  target: string | null
  detail: string | null
  at: string
}

export default function LogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isLive()) { setLoading(false); return }
    let cancelled = false
    api.auditLog({ limit: 200 }).then((r) => {
      if (cancelled) return
      if (r) setRows(r as AuditRow[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter((l) => `${l.actor_name ?? ''} ${l.action} ${l.target ?? ''} ${l.org_id ?? ''}`.toLowerCase().includes(q))
    : rows

  const detailText = (d: string | null) => {
    if (!d) return null
    try {
      const obj = JSON.parse(d)
      const parts = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')
      if (!parts.length) return null
      return parts.map(([k, v]) => `${k}: ${v}`).join(', ')
    } catch { return d }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">System Logs</h1>
          <p className="text-sm text-slate-500 mt-1">Real administrative audit trail — who changed what, across every organization</p>
        </div>
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actor, action, org, target…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
        </div>
      </div>

      {!isLive() ? (
        <div className="rounded-xl p-6 text-sm text-slate-500" style={surface}>
          Switch to Live mode to see the real audit trail. This screen deliberately shows nothing in demo mode rather than
          example log rows — an audit log that invents entries is worse than one that is empty.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                {['Actor', 'Action', 'Organization', 'Target', 'Detail', 'Timestamp'].map((h) => (
                  <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ background: '#0d1117' }}>
              {loading && (
                <tr><td colSpan={6} className="py-8 text-center text-slate-600 text-xs">Loading…</td></tr>
              )}
              {!loading && !filtered.length && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-600 text-sm flex-col items-center">
                  <ScrollText size={20} className="mx-auto mb-2 opacity-40" />
                  {rows.length ? 'No log entries match that search.' : 'No administrative actions recorded yet.'}
                </td></tr>
              )}
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #1e2433' }}>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <User size={12} className="text-indigo-400" />
                      <span className="text-indigo-400 font-medium">{log.actor_name ?? '—'}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 font-mono text-xs">{log.action}</td>
                  <td className="py-3.5 px-4 text-slate-400">
                    {log.org_id ? <span className="flex items-center gap-1"><Building2 size={11} className="text-slate-600" />{log.org_id}</span> : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400">{log.target ?? '—'}</td>
                  <td className="py-3.5 px-4 text-slate-500 text-xs">{detailText(log.detail) ?? '—'}</td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1 text-slate-500 text-xs">
                      <Clock size={10} />
                      {new Date(log.at).toLocaleString()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
