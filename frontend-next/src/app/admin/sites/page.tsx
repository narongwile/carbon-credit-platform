'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getSitesByOrg } from '@/lib/fleetData'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { api, useIsLive } from '@/lib/api'
import { DOMAIN_TO_PLATFORM } from '@/lib/entitlements'
import { DOMAIN_META, type SensorDomain, type SensorHost, type SiteOperations } from '@/types/fleet'
import { Building2, Zap, Thermometer, Droplet, MapPin, Leaf, AlertTriangle, Activity, HeartPulse, Car } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const domainIcon: Record<SensorDomain, React.ElementType> = {
  transformer: Zap,
  carbonNode: Thermometer,
  bloodBox: Droplet,
  automobile: Car,
}

const ALL_DOMAINS: SensorDomain[] = ['transformer', 'carbonNode', 'bloodBox', 'automobile']

interface SiteRow { id: string; name: string; address: string }

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
    : host.domain === 'automobile' ? `Fatigue ${host.fatigueScore}% · ${host.speedKmh} km/h`
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

// v_site_operations — per-site KPI roll-up, computed from whatever host list
// is passed in (real fleet in Live mode, seed hosts in Demo/offline — see
// useFleetHosts). This used to be a fixed selector over the module-level mock
// `hosts` array regardless of mode, so this page showed the same three demo
// sites' data for every organization, live or not.
function siteOperations(siteId: string, siteName: string, hostList: SensorHost[]): SiteOperations {
  const tr = hostList.filter((h): h is Extract<SensorHost, { domain: 'transformer' }> => h.domain === 'transformer')
  const cn = hostList.filter((h): h is Extract<SensorHost, { domain: 'carbonNode' }> => h.domain === 'carbonNode')
  const bb = hostList.filter((h): h is Extract<SensorHost, { domain: 'bloodBox' }> => h.domain === 'bloodBox')
  const au = hostList.filter((h): h is Extract<SensorHost, { domain: 'automobile' }> => h.domain === 'automobile')
  return {
    siteId,
    siteName,
    domains: Array.from(new Set(hostList.map((h) => h.domain))),
    transformer: {
      count: tr.length,
      avgHealth: tr.length ? Math.round(tr.reduce((a, t) => a + t.healthIndex, 0) / tr.length) : 0,
      openAlarms: tr.reduce((a, t) => a + t.openAlarms, 0),
    },
    carbonNode: {
      count: cn.length,
      co2eSavedKg: cn.reduce((a, c) => a + c.co2eSavedKg, 0),
      creditsIssued: cn.reduce((a, c) => a + c.creditsIssued, 0),
    },
    bloodBox: {
      count: bb.length,
      excursions: bb.reduce((a, b) => a + b.excursions, 0),
      inTransit: bb.filter((b) => b.inTransit).length,
    },
    automobile: {
      count: au.length,
      avgFatigue: au.length ? Math.round(au.reduce((a, v) => a + v.fatigueScore, 0) / au.length) : 0,
      activeVehicles: au.filter((v) => v.status !== 'OFFLINE').length,
    },
  }
}

export default function SitesPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const live = useIsLive()

  // Real sites (GET /api/orgs/:orgId/sites); the seed list only as the
  // demo/offline fallback — a live org's real sites rarely match the three
  // hardcoded demo ones, and grouping real hosts under fake site ids left
  // every real device with nowhere to appear.
  const [siteRows, setSiteRows] = useState<SiteRow[] | null>(null)
  useEffect(() => {
    if (!live) { setSiteRows(null); return }
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSiteRows(r.sites.map((s) => ({ id: s.id, name: s.name, address: s.address ?? '' }))) })
    return () => { cancelled = true }
  }, [live, orgId])
  const sites: SiteRow[] = siteRows ?? getSitesByOrg(orgId).map((s) => ({ id: s.id, name: s.name, address: s.address }))

  // Real fleet, already domain-typed and nameplate-enriched (falls back to
  // the seed hosts internally when not live) — see useManagedDevices.ts.
  const { hosts } = useFleetHosts(orgId)

  // Which domains this org is actually LICENSED for (org_entitlements) — not
  // which ones happen to have a host today. A KPI tile and a "No hosts at
  // this site" panel for a product the org never bought is not an empty
  // state, it's advertising something they can't use. undefined = still
  // loading (or demo/offline): show every domain rather than guess wrong,
  // matching the fail-open convention used everywhere else this session
  // (Pending Devices' domain picker, Device Management, Product Access).
  const [licensed, setLicensed] = useState<SensorDomain[] | undefined>(undefined)
  useEffect(() => {
    if (!live) { setLicensed(undefined); return }
    let cancelled = false
    api.entitlements(orgId).then((ents) => {
      if (cancelled || !ents) return
      setLicensed(ALL_DOMAINS.filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d])))
    })
    return () => { cancelled = true }
  }, [live, orgId])
  const domains = licensed ?? ALL_DOMAINS

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Sites — Unified Operations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Per-site KPIs across every sensor domain this organization runs (v_site_operations)</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Licensed for:</span>
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
        const hostList = hosts.filter((h) => h.siteId === site.id)
        const ops = siteOperations(site.id, site.name, hostList)
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
                {ops.domains.filter((d) => domains.includes(d)).map((d) => {
                  const Icon = domainIcon[d]
                  const meta = DOMAIN_META[d]
                  return <span key={d} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${meta.accent}1f`, color: meta.accent }} title={meta.platform}><Icon size={14} /></span>
                })}
              </div>
            </div>

            {/* Unified per-site KPI (v_site_operations) — only for licensed domains */}
            <div className="flex flex-wrap gap-3">
              {domains.includes('transformer') && (
                <Kpi icon={<Activity size={14} />} accent="#6366f1" label="Transformers" value={`${ops.transformer.count}`} sub={`avg health ${ops.transformer.avgHealth} · ${ops.transformer.openAlarms} alarms`} />
              )}
              {domains.includes('carbonNode') && (
                <Kpi icon={<Leaf size={14} />} accent="#22c55e" label="Refrigeration" value={`${ops.carbonNode.count}`} sub={`${ops.carbonNode.co2eSavedKg.toLocaleString()} kg CO₂e · ${ops.carbonNode.creditsIssued} credits`} />
              )}
              {domains.includes('bloodBox') && (
                <Kpi icon={<HeartPulse size={14} />} accent="#ef4444" label="BloodBOX" value={`${ops.bloodBox.count}`} sub={`${ops.bloodBox.excursions} excursions · ${ops.bloodBox.inTransit} in transit`} />
              )}
              <Kpi icon={<AlertTriangle size={14} />} accent="#fbbf24" label="Open Alarms" value={`${ops.transformer.openAlarms + ops.bloodBox.excursions}`} sub="across all domains" />
            </div>

            {/* Hosts grouped by domain — only for licensed domains */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {domains.map((d) => {
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
