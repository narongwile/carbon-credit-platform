'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getDepartmentsByOrg } from '@/lib/orgData'
import { managedDevicesFromFleet, getSitesByOrg } from '@/lib/fleetData'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'
import { HardDrive, Plus, Trash2, X, Wifi, WifiOff, MapPin } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function DeviceManagementPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const departments = getDepartmentsByOrg(orgId)
  const orgSites = getSitesByOrg(orgId)

  const [devices, setDevices] = useState<ManagedDevice[]>(managedDevicesFromFleet(orgId))
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ManagedDevice | null>(null)

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? id

  const upsert = (d: ManagedDevice) =>
    setDevices((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [d, ...prev]))
  const remove = (id: string) => setDevices((p) => p.filter((x) => x.id !== id))

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Device Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Register devices, set render theme and assign to departments</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true) }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <Plus size={15} /> Register Device
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Device', 'Serial', 'Domain', 'Location', 'Theme', 'Departments', 'Status', ''].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-white/3 cursor-pointer" style={{ borderBottom: '1px solid #1e2433' }} onClick={() => { setEditing(d); setShowModal(true) }}>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}><HardDrive size={14} className="text-indigo-400" /></div>
                    <span className="text-white font-medium">{d.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 font-mono text-xs text-slate-400">{d.serial}</td>
                <td className="py-3 px-4">
                  {d.domain ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: DOMAIN_META[d.domain].accent, background: `${DOMAIN_META[d.domain].accent}1f` }}>
                      {DOMAIN_META[d.domain].platform}
                    </span>
                  ) : <span className="text-slate-400 text-xs">{d.deviceType}</span>}
                </td>
                <td className="py-3 px-4 text-slate-400"><span className="flex items-center gap-1"><MapPin size={11} className="text-slate-600" />{d.location}</span></td>
                <td className="py-3 px-4">
                  <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ color: d.theme === 'fix' ? '#22c55e' : '#a78bfa', background: d.theme === 'fix' ? 'rgba(34,197,94,0.12)' : 'rgba(167,139,250,0.12)' }}>{d.theme === 'fix' ? 'FIX' : 'Free Style'}</span>
                </td>
                <td className="py-3 px-4 text-xs text-slate-400">{d.departmentIds.map(deptName).join(', ') || '—'}</td>
                <td className="py-3 px-4">
                  {d.status === 'online'
                    ? <span className="flex items-center gap-1 text-xs text-green-400"><Wifi size={12} /> online</span>
                    : <span className="flex items-center gap-1 text-xs text-slate-500"><WifiOff size={12} /> offline</span>}
                </td>
                <td className="py-3 px-4 text-right">
                  <button onClick={(e) => { e.stopPropagation(); remove(d.id) }} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <DeviceModal
          device={editing}
          orgId={orgId}
          departments={departments}
          sites={orgSites}
          onClose={() => setShowModal(false)}
          onSave={(d) => { upsert(d); setShowModal(false) }}
        />
      )}
    </div>
  )
}

const DOMAIN_DEVICE_TYPE: Record<SensorDomain, string> = {
  transformer: 'Power Transformer',
  carbonNode: 'Refrigeration Logger',
  bloodBox: 'BloodBOX Cold Storage',
}

function DeviceModal({ device, orgId, departments, sites, onClose, onSave }: {
  device: ManagedDevice | null
  orgId: string
  departments: { id: string; name: string }[]
  sites: { id: string; name: string }[]
  onClose: () => void
  onSave: (d: ManagedDevice) => void
}) {
  const [form, setForm] = useState<ManagedDevice>(
    device ?? { id: `dev-${Date.now()}`, orgId, name: '', serial: '', deviceType: 'Refrigeration Logger', domain: 'carbonNode', siteId: sites[0]?.id, location: sites[0]?.name ?? '', theme: 'fix', departmentIds: [], status: 'online' }
  )
  const toggleDept = (id: string) =>
    setForm((f) => ({ ...f, departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((d) => d !== id) : [...f.departmentIds, id] }))
  const pickDomain = (dm: SensorDomain) => setForm((f) => ({ ...f, domain: dm, deviceType: DOMAIN_DEVICE_TYPE[dm] }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">{device ? 'Edit Device' : 'Register Device'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Device Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field label="Serial / MAC" value={form.serial} onChange={(v) => setForm((f) => ({ ...f, serial: v }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Sensor Domain</label>
            <div className="flex gap-2">
              {(['carbonNode', 'bloodBox', 'transformer'] as SensorDomain[]).map((dm) => (
                <button key={dm} onClick={() => pickDomain(dm)}
                  className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold transition-all', form.domain === dm ? 'text-white' : 'text-slate-500')}
                  style={form.domain === dm ? { background: `${DOMAIN_META[dm].accent}33`, border: `1px solid ${DOMAIN_META[dm].accent}` } : inset}>
                  {DOMAIN_META[dm].platform}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Site</label>
            <select value={form.siteId ?? ''} onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value, location: sites.find((s) => s.id === e.target.value)?.name ?? f.location }))}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Dashboard Theme</label>
            <div className="flex gap-2">
              {(['fix', 'freestyle'] as const).map((t) => (
                <button key={t} onClick={() => setForm((f) => ({ ...f, theme: t }))}
                  className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold transition-all', form.theme === t ? 'text-white' : 'text-slate-500')}
                  style={form.theme === t ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                  {t === 'fix' ? 'Individual (FIX)' : 'Free Style'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Assign to Departments (can be multiple)</label>
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => {
                const on = form.departmentIds.includes(d.id)
                return (
                  <button key={d.id} onClick={() => toggleDept(d.id)}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', on ? 'text-white' : 'text-slate-400')}
                    style={on ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                    {d.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={() => onSave(form)} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white" style={gradient}>Save Device</button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
    </div>
  )
}
