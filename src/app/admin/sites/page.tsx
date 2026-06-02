'use client'

import { useAppStore } from '@/lib/store'
import { getSitesByOrg, getHostsBySite, getSiteOperations, getOrgDomains } from '@/lib/fleetData'
import { DOMAIN_META, type SensorDomain, type SensorHost } from '@/types/fleet'
import { Building2, Zap, Thermometer, Droplet, MapPin, Leaf, AlertTriangle, Activity, HeartPulse } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const domainIcon: Record<SensorDomain, React.ElementType> = {
  transformer: Zap,
  carbonNode: Thermometer,
  bloodBox: Droplet,
}

function statusColor(s: string) {
  return s === 'NORMAL' ? '#4ade80' : s === 'WARNING' ? '#fbbf24' : s === 'CRITICAL' ? '#ef4444' : '#6b7280'
}

function Kpi({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-xl p-4 flex-1 min-w-[150px]" style={inset}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${accent}1f`, color: accent }}>{icon}</span>
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  )
}

function HostChip({ host }: { host: SensorHost }) {
  const Icon = domainIcon[host.domain]
  const meta = DOMAIN_META[host.domain]
  const detail =
    host.domain === 'transformer' ? `${host.kva} kVA · health ${host.healthIndex}`
    : host.domain === 'carbonNode' ? `${host.targetMinC}–${host.targetMaxC}°C · ${host.creditsIssued} credits`
    : `set ${host.setLowC}–${host.setHighC}°C · ${host.floor}`
  return (
    <div className="flex items-center gap-2.5 p-3 rounded-lg" style={inset}>
      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta.accent}1f`, color: meta.accent }}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{host.name}</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(host.status) }} />
        </div>
        <div className="text-[11px] text-slate-500 truncate">{detail}</div>
      </div>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: meta.accent, background: `${meta.accent}14` }}>{meta.platform}</span>
    </div>
  )
}

export default function SitesPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const sites = getSitesByOrg(orgId)
  const domains = getOrgDomains(orgId)

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Sites — Unified Operations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Per-site KPIs across every sensor domain this organization runs (v_site_operations)</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Domains in use:</span>
          {domains.map((d) => {
            const Icon = domainIcon[d]
            const meta = DOMAIN_META[d]
            return (
              <span key={d} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium" style={{ color: meta.accent, background: `${meta.accent}14`, border: `1px solid ${meta.accent}40` }}>
                <Icon size={12} /> {meta.platform}
              </span>
            )
          })}
        </div>
      </div>

      {sites.map((site) => {
        const ops = getSiteOperations(site.id)
        const hostList = getHostsBySite(site.id)
        const byDomain = (d: SensorDomain) => hostList.filter((h) => h.domain === d)
        return (
          <div key={site.id} className="rounded-2xl p-5 space-y-4" style={surface}>
            {/* Site header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
                  <Building2 size={18} className="text-indigo-400" />
                </div>
                <div>
                  <div className="text-base font-bold text-white">{site.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={11} /> {site.address}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                {ops.domains.map((d) => {
                  const Icon = domainIcon[d]
                  const meta = DOMAIN_META[d]
                  return <span key={d} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f`, color: meta.accent }} title={meta.platform}><Icon size={14} /></span>
                })}
              </div>
            </div>

            {/* Unified per-site KPI (v_site_operations) */}
            <div className="flex flex-wrap gap-3">
              <Kpi icon={<Activity size={14} />} accent="#6366f1" label="Transformers" value={`${ops.transformer.count}`} sub={`avg health ${ops.transformer.avgHealth} · ${ops.transformer.openAlarms} alarms`} />
              <Kpi icon={<Leaf size={14} />} accent="#22c55e" label="Refrigeration" value={`${ops.carbonNode.count}`} sub={`${ops.carbonNode.co2eSavedKg.toLocaleString()} kg CO₂e · ${ops.carbonNode.creditsIssued} credits`} />
              <Kpi icon={<HeartPulse size={14} />} accent="#ef4444" label="BloodBOX" value={`${ops.bloodBox.count}`} sub={`${ops.bloodBox.excursions} excursions · ${ops.bloodBox.inTransit} in transit`} />
              <Kpi icon={<AlertTriangle size={14} />} accent="#fbbf24" label="Open Alarms" value={`${ops.transformer.openAlarms + ops.bloodBox.excursions}`} sub="across all domains" />
            </div>

            {/* Hosts grouped by domain */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(['transformer', 'carbonNode', 'bloodBox'] as SensorDomain[]).map((d) => {
                const list = byDomain(d)
                const meta = DOMAIN_META[d]
                if (!list.length) return (
                  <div key={d} className="rounded-xl p-4 opacity-50" style={inset}>
                    <div className="text-xs font-semibold mb-1" style={{ color: meta.accent }}>{meta.platform}</div>
                    <div className="text-xs text-slate-600">No hosts at this site</div>
                  </div>
                )
                return (
                  <div key={d} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.accent }}>{meta.label}s ({list.length})</div>
                    {list.map((h) => <HostChip key={h.id} host={h} />)}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
