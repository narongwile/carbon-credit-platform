'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hosts, sites } from '@/lib/fleetData'
import { organizations } from '@/lib/mockData'
import { useAppStore } from '@/lib/store'
import { DOMAIN_META, type SensorDomain, type SensorHost } from '@/types/fleet'
import { Activity, Search, Zap, Thermometer, Droplet, ExternalLink } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const domainIcon: Record<SensorDomain, React.ElementType> = { transformer: Zap, carbonNode: Thermometer, bloodBox: Droplet }
const statusColor = (s: string) => (s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280')
const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? id
const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id

function metric(h: SensorHost): string {
  if (h.domain === 'transformer') return `Health ${h.healthIndex} · ${h.kva} kVA`
  if (h.domain === 'carbonNode') return `${h.targetMinC}–${h.targetMaxC}°C · ${h.creditsIssued} credits`
  return `set ${h.setLowC}–${h.setHighC}°C · ${h.excursions} excursions`
}
function monitorRoute(h: SensorHost): string {
  // transformer keeps its dedicated rich twin; others use the shared node twin
  if (h.domain === 'transformer') return `/admin/transformers/${h.id}`
  return `/admin/nodes/${h.id}`
}

export default function SuperAdminMonitoringPage() {
  const router = useRouter()
  const { setSelectedOrgId } = useAppStore()
  const [org, setOrg] = useState('all')
  const [domain, setDomain] = useState<'all' | SensorDomain>('all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => hosts.filter((h) => {
    if (org !== 'all' && h.orgId !== org) return false
    if (domain !== 'all' && h.domain !== domain) return false
    if (status !== 'all' && h.status !== status) return false
    if (search && !`${h.name} ${siteName(h.siteId)}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [org, domain, status, search])

  const openMonitor = (h: SensorHost) => { setSelectedOrgId(h.orgId); router.push(monitorRoute(h)) }

  const totalSensors = filtered.reduce((a, h) => a + h.sensorCount, 0)

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
          { label: 'Total Sensors', value: totalSensors, color: '#06b6d4' },
          { label: 'Organizations', value: org === 'all' ? organizations.length : 1, color: '#a78bfa' },
          { label: 'Critical', value: filtered.filter((h) => h.status === 'CRITICAL').length, color: '#ef4444' },
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
          {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={domain} onChange={(e) => setDomain(e.target.value as 'all' | SensorDomain)} className="rounded-lg px-3 py-2.5 text-sm text-white outline-none" style={inset}>
          <option value="all">All products</option>
          <option value="transformer">ETERNITY (Transformer)</option>
          <option value="carbonNode">CarbonBOX (Refrigeration)</option>
          <option value="bloodBox">BloodBOX</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg px-3 py-2.5 text-sm text-white outline-none" style={inset}>
          {['all', 'NORMAL', 'WARNING', 'CRITICAL'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All status' : s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Sensor Host', 'Organization', 'Site', 'Product', 'Status', 'Metric', ''].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {filtered.map((h) => {
              const meta = DOMAIN_META[h.domain]
              const Icon = domainIcon[h.domain]
              return (
                <tr key={h.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #1e2433' }}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f` }}><Icon size={14} style={{ color: meta.accent }} /></span>
                      <div>
                        <div className="text-white font-medium">{h.name}</div>
                        <div className="text-[10px] text-slate-600">{h.sensorCount} sensors</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400">{orgName(h.orgId)}</td>
                  <td className="py-3 px-4 text-slate-400">{siteName(h.siteId)}</td>
                  <td className="py-3 px-4"><span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span></td>
                  <td className="py-3 px-4"><span className="flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: statusColor(h.status) }} /><span style={{ color: statusColor(h.status) }}>{h.status}</span></span></td>
                  <td className="py-3 px-4 text-xs text-slate-400">{metric(h)}</td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => openMonitor(h)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300">
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
