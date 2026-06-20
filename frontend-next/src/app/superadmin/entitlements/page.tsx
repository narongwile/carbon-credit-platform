'use client'

import { useState } from 'react'
import { organizations, auditLogs } from '@/lib/mockData'
import { ToggleLeft, ToggleRight, Clock, User } from 'lucide-react'

const FEATURE_GROUPS = {
  'ETERNITY Core': [
    { id: 'f1', name: 'Digital Twin Visualization', desc: '3D interactive transformer model with real-time sensor overlay' },
    { id: 'f2', name: 'Real-time Telemetry', desc: 'Live sensor data streaming at 1-second intervals' },
    { id: 'f3', name: 'AI Predictive Diagnostics', desc: 'Machine learning-based failure prediction and health scoring' },
    { id: 'f4', name: 'Historical Analytics', desc: 'Up to 5 years of historical trend data and analysis' },
    { id: 'f5', name: 'Report Generation', desc: 'Automated PDF and Excel reports with custom templates' },
  ],
  'CarbonBOX': [
    { id: 'f6', name: 'Emission Tracking', desc: 'Carbon emission monitoring and tracking per transformer' },
    { id: 'f7', name: 'Compliance Reporting', desc: 'Automated compliance reports for environmental standards' },
    { id: 'f8', name: 'Carbon Credit Marketplace', desc: 'Trading platform for carbon credits and offset certificates' },
  ],
  'BloodBOX': [
    { id: 'f9', name: 'IoT Sensor Integration', desc: 'Third-party IoT sensor protocol support (MQTT, Modbus, DNP3)' },
    { id: 'f10', name: 'API Integration', desc: 'REST and WebSocket API for external system integration' },
  ],
}

export default function EntitlementsPage() {
  const [selectedOrgId, setSelectedOrgId] = useState('org-1')
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    const org = organizations.find((o) => o.id === 'org-1')!
    return Object.fromEntries(org.platforms.flatMap((p) => p.features.map((f) => [f.id, f.enabled])))
  })

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId)!

  const handleOrgChange = (orgId: string) => {
    setSelectedOrgId(orgId)
    const org = organizations.find((o) => o.id === orgId)!
    setToggles(Object.fromEntries(org.platforms.flatMap((p) => p.features.map((f) => [f.id, f.enabled]))))
  }

  const toggle = (id: string) => setToggles((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Feature Entitlements</h1>
        <p className="text-sm text-slate-500 mt-1">Control platform features per organization</p>
      </div>

      {/* Org selector */}
      <div className="flex gap-3">
        {organizations.map((org) => (
          <button
            key={org.id}
            onClick={() => handleOrgChange(org.id)}
            className="flex-1 py-3 px-4 rounded-xl text-left transition-all hover:border-indigo-500/50"
            style={
              selectedOrgId === org.id
                ? { background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1' }
                : { background: '#0d1117', border: '1px solid #1e2433' }
            }
          >
            <div className="text-sm font-semibold text-white">{org.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{org.licenseTier} · {org.transformerCount} transformers</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Feature toggles */}
        <div className="col-span-2 space-y-4">
          {Object.entries(FEATURE_GROUPS).map(([groupName, features]) => (
            <div key={groupName} className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
              <div className="px-5 py-4" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                <h3 className="text-sm font-semibold text-white">{groupName}</h3>
              </div>
              <div style={{ background: '#0d1117' }}>
                {features.map((feat, i) => (
                  <div
                    key={feat.id}
                    className="flex items-center justify-between px-5 py-4"
                    style={i < features.length - 1 ? { borderBottom: '1px solid #1e2433' } : {}}
                  >
                    <div className="flex-1 mr-6">
                      <div className="text-sm text-white font-medium">{feat.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{feat.desc}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${toggles[feat.id] ? 'text-green-400' : 'text-slate-600'}`}>
                        {toggles[feat.id] ? 'Enabled' : 'Disabled'}
                      </span>
                      <button onClick={() => toggle(feat.id)} className="transition-transform hover:scale-110">
                        {toggles[feat.id] ? (
                          <ToggleRight size={28} className="text-indigo-400" />
                        ) : (
                          <ToggleLeft size={28} className="text-slate-600" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex gap-3">
            <button className="px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              Save All Changes
            </button>
            <button className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-all" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
              Reset to Default
            </button>
          </div>
        </div>

        {/* Recent changes */}
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Org Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">License Tier</span>
                <span className="text-indigo-400 font-medium capitalize">{selectedOrg.licenseTier}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Transformers</span>
                <span className="text-white">{selectedOrg.transformerCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Status</span>
                <span className="text-green-400">{selectedOrg.status}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Active Features</span>
                <span className="text-white">{Object.values(toggles).filter(Boolean).length}/{Object.keys(toggles).length}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Recent Changes</h3>
            <div className="space-y-3">
              {auditLogs.slice(0, 4).map((log) => (
                <div key={log.id} className="text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-0.5">
                    <User size={10} className="text-indigo-400" />
                    <span className="text-indigo-400">{log.actor}</span>
                  </div>
                  <div className="text-slate-500">{log.action}: {log.target}</div>
                  <div className="flex items-center gap-1 text-slate-600 mt-0.5">
                    <Clock size={9} />
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
