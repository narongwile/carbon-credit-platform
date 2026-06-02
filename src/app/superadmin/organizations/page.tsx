'use client'

import { useState } from 'react'
import { organizations } from '@/lib/mockData'
import type { Organization } from '@/types'
import { Search, Building2, X, ChevronDown, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'
import clsx from 'clsx'

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    active: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
    inactive: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
    suspended: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  }
  const s = cfg[status] || cfg.inactive
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: s.color, background: s.bg }}>
      {status}
    </span>
  )
}

function LicenseBadge({ tier }: { tier: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    enterprise: { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
    professional: { color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
    basic: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
  }
  const s = cfg[tier] || cfg.basic
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={{ color: s.color, background: s.bg }}>
      {tier}
    </span>
  )
}

function OrgModal({ org, onClose }: { org: Organization; onClose: () => void }) {
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>('eternity')
  const [entryPlatform, setEntryPlatform] = useState('eternity')
  const [features, setFeatures] = useState<Record<string, boolean>>(
    Object.fromEntries(org.platforms.flatMap((p) => p.features.map((f) => [f.id, f.enabled])))
  )

  const toggleFeature = (id: string) => setFeatures((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <div className="flex items-center justify-between p-6 sticky top-0 z-10" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
          <div>
            <h2 className="text-lg font-bold text-white">{org.name}</h2>
            <p className="text-sm text-slate-500">{org.type} · {org.city}, {org.country}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Entry platform */}
          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Default Entry Platform</label>
            <div className="flex gap-2">
              {['eternity', 'carbonbox', 'bloodbox'].map((p) => (
                <button
                  key={p}
                  onClick={() => setEntryPlatform(p)}
                  className={clsx(
                    'flex-1 py-2 px-3 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all',
                    entryPlatform === p ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  )}
                  style={entryPlatform === p ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0a0e1a', border: '1px solid #1e2433' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Platform cards */}
          <div>
            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Platform Access</label>
            <div className="space-y-2">
              {org.platforms.map((platform) => (
                <div key={platform.platformId} className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/3 transition-colors"
                    onClick={() => setExpandedPlatform(expandedPlatform === platform.platformId ? null : platform.platformId)}
                    style={{ background: '#0a0e1a' }}
                  >
                    <div className="flex items-center gap-3">
                      {expandedPlatform === platform.platformId ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      <span className="text-sm font-semibold text-white">{platform.platformName}</span>
                    </div>
                    <span
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={platform.licensed
                        ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' }
                        : { background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}
                    >
                      {platform.licensed ? 'LICENSED' : 'UNLICENSED'}
                    </span>
                  </div>

                  {expandedPlatform === platform.platformId && (
                    <div className="p-4 space-y-2" style={{ background: '#0d1117', borderTop: '1px solid #1e2433' }}>
                      {platform.features.map((feat) => (
                        <div key={feat.id} className="flex items-center justify-between py-1.5">
                          <span className="text-sm text-slate-300">{feat.name}</span>
                          <button
                            onClick={() => toggleFeature(feat.id)}
                            className="transition-colors"
                          >
                            {features[feat.id] ? (
                              <ToggleRight size={22} className="text-indigo-400" />
                            ) : (
                              <ToggleLeft size={22} className="text-slate-600" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              Save Changes
            </button>
            <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-all" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OrganizationsPage() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Organization | null>(null)

  const filtered = organizations.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.country.toLowerCase().includes(search.toLowerCase()) ||
      o.type.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Organizations</h1>
          <p className="text-sm text-slate-500 mt-1">Manage tenant organizations and their configurations</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          + New Organization
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organizations..."
          className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ background: '#0d1117', border: '1px solid #1e2433' }}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Organization', 'Type', 'Country', 'Transformers', 'Status', 'License', ''].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {filtered.map((org) => (
              <tr
                key={org.id}
                className="hover:bg-white/3 transition-colors cursor-pointer"
                style={{ borderBottom: '1px solid #1e2433' }}
                onClick={() => setSelected(org)}
              >
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
                      <Building2 size={14} className="text-indigo-400" />
                    </div>
                    <div>
                      <div className="text-white font-medium">{org.name}</div>
                      <div className="text-xs text-slate-500">{org.contactEmail}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4 text-slate-400">{org.type}</td>
                <td className="py-3.5 px-4 text-slate-400">{org.country}</td>
                <td className="py-3.5 px-4">
                  <span className="text-white font-semibold">{org.transformerCount}</span>
                  <span className="text-slate-600 ml-1">units</span>
                </td>
                <td className="py-3.5 px-4"><StatusBadge status={org.status} /></td>
                <td className="py-3.5 px-4"><LicenseBadge tier={org.licenseTier} /></td>
                <td className="py-3.5 px-4">
                  <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Configure</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <OrgModal org={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
