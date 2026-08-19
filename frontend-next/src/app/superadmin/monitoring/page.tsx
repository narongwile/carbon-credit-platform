'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hosts as mockHosts, sites as mockSites } from '@/lib/fleetData'
import { organizations as mockOrgs } from '@/lib/mockData'
import { useAppStore } from '@/lib/store'
import { api, isLive } from '@/lib/api'
import { statusFromLive } from '@/lib/useFleetLive'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import { Activity, Search, Zap, Thermometer, Droplet, ExternalLink, Car } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const domainIcon: Record<SensorDomain, React.ElementType> = { transformer: Zap, carbonNode: Thermometer, bloodBox: Droplet, automobile: Car }
const statusColor = (s: string) => (s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280')

function monitorRoute(domain: SensorDomain, id: string): string {
  // transformer keeps its dedicated rich twin; others use the shared node twin
  return domain === 'transformer' ? `/admin/transformers/detail?id=${id}` : `/admin/nodes/detail?id=${id}`
}

const ago = (ts: string | null): string => {
  if (!ts) return 'never reported'
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (s < 60) return `seen ${s}s ago`
  if (s < 3600) return `seen ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `seen ${Math.floor(s / 3600)}h ago`
  return `seen ${Math.floor(s / 86400)}d ago`
}

/** Row shape both the real (GET /api/fleet, every org) and mock/demo (fleetData.ts) sources fill in. */
interface Row {
  id: string
  orgId: string
  orgName: string
  siteName: string
  name: string
  domain: SensorDomain
  status: string
  /**
   * Free-text device detail. Deliberately NOT a restatement of `status`: the
   * live path first rendered online/alarm state here, which is exactly what
   * the adjacent Status column already shows, so the column carried no
   * information of its own. Live rows now carry real telemetry metadata
   * (rating from the nameplate catalog, last-seen, signal); mock rows carry
   * the seed fleet's per-domain business figures. Both are "details about
   * this device", which is what the column is labelled.
   */
  metric: string
  /** Sub-sensor count — a seed-fleet concept; the node table has no equivalent. */
  sensorCount: number | null
}

export default function SuperAdminMonitoringPage() {
  const router = useRouter()
  const { setSelectedOrgId } = useAppStore()
  const [org, setOrg] = useState('all')
  const [domain, setDomain] = useState<'all' | SensorDomain>('all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')

  // Real org list + real fleet across EVERY org — "every sensor across all
  // products and all customer organizations" used to mean the fixed 3-org
  // mock roster no matter what: the one live fetch that existed only
  // OVERLAID a status onto ids already in that mock list, so a real org's
  // real device could never appear here at all, live backend or not.
  const [orgList, setOrgList] = useState<{ id: string; name: string }[]>(() => mockOrgs.map((o) => ({ id: o.id, name: o.name })))
  const [liveRows, setLiveRows] = useState<Row[] | null>(null)
  useEffect(() => {
    if (!isLive()) { setLiveRows(null); return }
    let cancelled = false
    api.orgs().then(async (orgs) => {
      if (cancelled || !orgs) return
      const realOrgs = orgs.filter((o) => o.id !== '__unassigned__')
      // Nameplates give real ratings (migrate-v31/v32) — one bulk map per org,
      // the same request shape as sites, so the Detail column can show
      // something real instead of restating the Status column.
      const [nodesByOrg, sitesByOrg, platesByOrg] = await Promise.all([
        Promise.all(realOrgs.map((o) => api.fleet(o.id))),
        Promise.all(realOrgs.map((o) => api.sites(o.id))),
        Promise.all(realOrgs.map((o) => api.orgNameplates(o.id))),
      ])
      if (cancelled) return
      const rows: Row[] = []
      realOrgs.forEach((o, i) => {
        const siteName = new Map((sitesByOrg[i]?.sites ?? []).map((s) => [s.id, s.name] as [string, string]))
        const plates = platesByOrg[i] ?? {}
        for (const n of nodesByOrg[i] ?? []) {
          const bits: string[] = []
          const kva = plates[n.id]?.ratedKva
          if (kva != null) bits.push(`${kva} kVA`)
          bits.push(ago(n.last_seen))
          if (n.rssi != null) bits.push(`RSSI ${n.rssi}`)
          rows.push({
            id: n.id, orgId: o.id, orgName: o.name, siteName: n.site_id ? (siteName.get(n.site_id) ?? n.site_id) : '—',
            name: n.name || n.id, domain: n.domain, status: statusFromLive(n),
            metric: bits.join(' · '), sensorCount: null,
          })
        }
      })
      // Both land in the same commit. setOrgList used to fire as soon as
      // api.orgs() resolved, i.e. BEFORE the fleet fetch above finished — so
      // for that window the org picker already listed the real orgs while
      // `rows` was still the mock fallback, and choosing one of them showed
      // "No sensors match the filters" until the rest arrived.
      setOrgList(realOrgs.map((o) => ({ id: o.id, name: o.name })))
      setLiveRows(rows)
    })
    return () => { cancelled = true }
  }, [])

  const rows: Row[] = liveRows ?? mockHosts.map((h) => ({
    id: h.id, orgId: h.orgId, orgName: mockOrgs.find((o) => o.id === h.orgId)?.name ?? h.orgId,
    siteName: mockSites.find((s) => s.id === h.siteId)?.name ?? h.siteId,
    name: h.name, domain: h.domain, status: h.status,
    metric: h.domain === 'transformer' ? `Health ${h.healthIndex} · ${h.kva} kVA`
      : h.domain === 'carbonNode' ? `${h.targetMinC}–${h.targetMaxC}°C · ${h.creditsIssued} credits`
      : h.domain === 'automobile' ? `Fatigue ${h.fatigueScore}% · ${h.speedKmh} km/h`
      : `set ${h.setLowC}–${h.setHighC}°C · ${h.excursions} excursions`,
    sensorCount: h.sensorCount,
  }))

  const filtered = useMemo(() => rows.filter((r) => {
    if (org !== 'all' && r.orgId !== org) return false
    if (domain !== 'all' && r.domain !== domain) return false
    if (status !== 'all' && r.status !== status) return false
    if (search && !`${r.name} ${r.siteName}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [rows, org, domain, status, search])

  const openMonitor = (r: Row) => { setSelectedOrgId(r.orgId); router.push(monitorRoute(r.domain, r.id)) }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Activity size={18} className="text-indigo-400" /> Sensor Monitoring</h1>
        <p className="text-sm text-slate-500 mt-1">Every sensor across all products and all customer organizations</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Sensor Hosts', value: filtered.length, color: '#6366f1' },
          // Was "Total Sensors" — a sub-sensor count only the seed fleet has,
          // so it read '—' for every real org while still being summed on
          // every render. Offline is real on both paths and is what a
          // superadmin is actually scanning this page for.
          { label: 'Offline', value: filtered.filter((r) => r.status === 'OFFLINE').length, color: '#06b6d4' },
          { label: 'Organizations', value: new Set(filtered.map(r => r.orgId)).size, color: '#a78bfa' },
          { label: 'Critical', value: filtered.filter((r) => r.status === 'CRITICAL').length, color: '#ef4444' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={surface}>
            <div className="text-xs text-slate-500 mb-1">{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sensor or site…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
        </div>
        <select value={org} onChange={(e) => setOrg(e.target.value)} className="rounded-lg px-3 py-2.5 text-sm text-white outline-none" style={inset}>
          <option value="all">All organizations</option>
          {orgList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={domain} onChange={(e) => setDomain(e.target.value as 'all' | SensorDomain)} className="rounded-lg px-3 py-2.5 text-sm text-white outline-none" style={inset}>
          <option value="all">All products</option>
          <option value="transformer">ETERNITY (Transformer)</option>
          <option value="carbonNode">CarbonBOX (Refrigeration)</option>
          <option value="bloodBox">BloodBOX</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg px-3 py-2.5 text-sm text-white outline-none" style={inset}>
          {['all', 'NORMAL', 'WARNING', 'CRITICAL', 'OFFLINE'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All status' : s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Sensor Host', 'Organization', 'Site', 'Product', 'Status', 'Detail', ''].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {filtered.map((r) => {
              const meta = DOMAIN_META[r.domain]
              const Icon = domainIcon[r.domain]
              return (
                <tr key={r.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #1e2433' }}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f` }}><Icon size={14} style={{ color: meta.accent }} /></span>
                      <div>
                        <div className="text-white font-medium">{r.name}</div>
                        {r.sensorCount !== null && <div className="text-[10px] text-slate-600">{r.sensorCount} sensors</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400">{r.orgName}</td>
                  <td className="py-3 px-4 text-slate-400">{r.siteName}</td>
                  <td className="py-3 px-4"><span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span></td>
                  <td className="py-3 px-4"><span className="flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: statusColor(r.status) }} /><span style={{ color: statusColor(r.status) }}>{r.status}</span></span></td>
                  <td className="py-3 px-4 text-xs text-slate-400">{r.metric}</td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => openMonitor(r)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300">
                      Monitor <ExternalLink size={12} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-600 text-sm">No sensors match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
