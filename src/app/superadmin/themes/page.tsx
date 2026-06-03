'use client'

import { useState } from 'react'
import { dashboardThemes as seed } from '@/lib/orgData'
import { PLATFORM_TEMPLATES } from '@/lib/platforms'
import type { DashboardTheme } from '@/types/org'
import { Palette, Plus, Trash2, LayoutGrid, Box, ToggleLeft, ToggleRight, Thermometer, Droplet, Zap } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const platformName: Record<string, string> = {
  shared: 'Shared (any platform)',
  ...Object.fromEntries(PLATFORM_TEMPLATES.map((p) => [p.id, p.name])),
}

const PLATFORM_ICON: Record<string, React.ElementType> = { Thermometer, Droplet, Zap }

// 3D-visualization product templates, provisioned per sensor type.
const THREED_TEMPLATES: Record<string, { template: string; note: string }> = {
  refrigerationDataLogger: { template: 'Cold-Chain Node 3D', note: 'Animated fridge/freezer node with temp & door state' },
  bloodBox: { template: 'BloodBOX Indoor 3D', note: 'Building cross-section + box position (BLE/Barometer)' },
  eternityTransformers: { template: 'Transformer Digital Twin', note: 'Interactive 3D transformer with DGA hotspots' },
}

export default function ThemesPage() {
  const [themes, setThemes] = useState<DashboardTheme[]>(seed)
  const [draft, setDraft] = useState({ name: '', description: '', platformType: 'shared' })
  // which sensor-type 3D templates are provisioned
  const [provisioned, setProvisioned] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PLATFORM_TEMPLATES.map((p) => [p.id, true])),
  )
  const toggle3d = (id: string) => setProvisioned((p) => ({ ...p, [id]: !p[id] }))

  const add = () => {
    if (!draft.name.trim()) return
    setThemes((t) => [...t, { id: `th-${Date.now()}`, name: draft.name.trim(), description: draft.description, platformType: draft.platformType, accent: '#6366f1' }])
    setDraft({ name: '', description: '', platformType: 'shared' })
  }
  const remove = (id: string) => setThemes((t) => t.filter((x) => x.id !== id))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard Theme Management</h1>
        <p className="text-sm text-slate-500 mt-1">Define dashboard themes and provision 3D-visualization product templates per sensor type</p>
      </div>

      {/* 3D visualization product templates, provisioned by sensor type */}
      <div className="rounded-xl p-5" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Box size={15} className="text-indigo-400" /> 3D Visualization Product Templates</h3>
        <p className="text-[11px] text-slate-500 mb-4">Provision a 3D-visualize product template for each sensor type — used by tenants of that product.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PLATFORM_TEMPLATES.map((p) => {
            const Icon = PLATFORM_ICON[p.icon] ?? Box
            const t3d = THREED_TEMPLATES[p.id]
            const on = provisioned[p.id]
            return (
              <div key={p.id} className="rounded-xl p-4" style={{ background: '#0a0e1a', border: `1px solid ${on ? p.accent : '#1e2433'}` }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${p.accent}1f` }}><Icon size={16} style={{ color: p.accent }} /></span>
                  <button onClick={() => toggle3d(p.id)}>{on ? <ToggleRight size={24} className="text-indigo-400" /> : <ToggleLeft size={24} className="text-slate-600" />}</button>
                </div>
                <div className="text-sm font-bold text-white">{t3d?.template ?? '3D Template'}</div>
                <div className="text-[11px] mt-0.5" style={{ color: p.accent }}>{p.sensorType}</div>
                <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">{t3d?.note}</div>
                <div className="text-[10px] mt-2 font-bold uppercase tracking-wider" style={{ color: on ? '#4ade80' : '#6b7280' }}>{on ? 'Provisioned' : 'Not provisioned'}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create */}
      <div className="rounded-xl p-5" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Plus size={15} className="text-indigo-400" /> New Theme</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Theme name"
            className="rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Description"
            className="md:col-span-2 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <select value={draft.platformType} onChange={(e) => setDraft((d) => ({ ...d, platformType: e.target.value }))}
            className="rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
            {Object.entries(platformName).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <button onClick={add} className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <Plus size={15} /> Add Theme
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {themes.map((th) => (
          <div key={th.id} className="rounded-xl p-5" style={surface}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${th.accent}1f` }}>
                <LayoutGrid size={18} style={{ color: th.accent }} />
              </div>
              <button onClick={() => remove(th.id)} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={14} /></button>
            </div>
            <h3 className="text-sm font-bold text-white">{th.name}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{th.description}</p>
            <div className="mt-3 pt-3 flex items-center gap-1.5" style={{ borderTop: '1px solid #1e2433' }}>
              <Palette size={12} className="text-slate-600" />
              <span className="text-[11px] text-slate-400">{platformName[th.platformType] ?? th.platformType}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
