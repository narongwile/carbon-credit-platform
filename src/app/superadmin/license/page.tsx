'use client'

import { organizations } from '@/lib/mockData'
import { Building2, Zap, Database, Activity } from 'lucide-react'

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
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

const TIER_LIMITS: Record<string, { transformers: number; storage: string; users: number; api: boolean; ai: boolean }> = {
  basic: { transformers: 10, storage: '100 GB', users: 5, api: false, ai: false },
  professional: { transformers: 50, storage: '1 TB', users: 25, api: true, ai: false },
  enterprise: { transformers: 999, storage: 'Unlimited', users: 999, api: true, ai: true },
}

export default function LicensePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">License Manager</h1>
          <p className="text-sm text-slate-500 mt-1">Global license overview and management</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          Issue New License
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Building2 size={18} />} label="Total Organizations" value="124" color="#6366f1" />
        <StatCard icon={<Zap size={18} />} label="Licensed Assets" value="4,247" color="#4ade80" />
        <StatCard icon={<Database size={18} />} label="Total Data Volume" value="4.2 PB" color="#06b6d4" />
        <StatCard icon={<Activity size={18} />} label="Platform Uptime" value="99.97%" color="#a78bfa" />
      </div>

      {/* License tiers */}
      <div className="grid grid-cols-3 gap-4">
        {(['basic', 'professional', 'enterprise'] as const).map((tier) => {
          const limits = TIER_LIMITS[tier]
          const count = organizations.filter((o) => o.licenseTier === tier).length
          const colors: Record<string, string> = { basic: '#6b7280', professional: '#06b6d4', enterprise: '#a78bfa' }
          const color = colors[tier]
          return (
            <div key={tier} className="rounded-xl p-5" style={{ background: '#0d1117', border: `1px solid ${color}40` }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-base font-bold text-white capitalize">{tier}</span>
                <span className="text-2xl font-bold" style={{ color }}>{count}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Max Transformers</span>
                  <span className="text-white">{limits.transformers === 999 ? 'Unlimited' : limits.transformers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Storage</span>
                  <span className="text-white">{limits.storage}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Users</span>
                  <span className="text-white">{limits.users === 999 ? 'Unlimited' : limits.users}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">API Access</span>
                  <span className={limits.api ? 'text-green-400' : 'text-slate-600'}>{limits.api ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">AI Diagnostics</span>
                  <span className={limits.ai ? 'text-green-400' : 'text-slate-600'}>{limits.ai ? 'Yes' : 'No'}</span>
                </div>
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1e2433' }}>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e2433' }}>
                  <div className="h-full rounded-full" style={{ width: `${(count / organizations.length) * 100}%`, background: color }} />
                </div>
                <div className="text-xs text-slate-500 mt-1">{count} of {organizations.length} organizations</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Organization license table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <h3 className="text-sm font-semibold text-white">Organization License Details</h3>
          <button className="text-xs text-indigo-400 hover:text-indigo-300">Export CSV</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Organization', 'Country', 'License Tier', 'Transformers', 'Platforms', 'Status', 'Since', 'Actions'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {organizations.map((org) => (
              <tr key={org.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid #1e2433' }}>
                <td className="py-3.5 px-4">
                  <div className="text-white font-medium">{org.name}</div>
                  <div className="text-xs text-slate-500">{org.contactEmail}</div>
                </td>
                <td className="py-3.5 px-4 text-slate-400">{org.country}</td>
                <td className="py-3.5 px-4">
                  <span
                    className="text-xs px-2.5 py-1 rounded-full font-medium capitalize"
                    style={
                      org.licenseTier === 'enterprise'
                        ? { color: '#a78bfa', background: 'rgba(167,139,250,0.1)' }
                        : org.licenseTier === 'professional'
                        ? { color: '#06b6d4', background: 'rgba(6,182,212,0.1)' }
                        : { color: '#6b7280', background: 'rgba(107,114,128,0.1)' }
                    }
                  >
                    {org.licenseTier}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-white font-semibold">{org.transformerCount}</td>
                <td className="py-3.5 px-4">
                  <div className="flex gap-1">
                    {org.platforms.filter((p) => p.licensed).map((p) => (
                      <span key={p.platformId} className="text-[10px] px-1.5 py-0.5 rounded text-indigo-400" style={{ background: 'rgba(99,102,241,0.1)' }}>
                        {p.platformName}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="text-green-400 text-xs">Active</span>
                  </div>
                </td>
                <td className="py-3.5 px-4 text-slate-500 text-xs">{org.createdAt}</td>
                <td className="py-3.5 px-4">
                  <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mr-3">Edit</button>
                  <button className="text-xs text-red-400 hover:text-red-300 transition-colors">Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
