'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { getDepartmentsByOrg } from '@/lib/orgData'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { api, isLive } from '@/lib/api'
import { DOMAIN_META } from '@/types/fleet'
import type { ManagedDevice } from '@/types/org'
import { HardDrive, X, Wifi, WifiOff, MapPin, PlugZap } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Dept { id: string; name: string }

export default function DeviceManagementPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'

  // Real fleet (GET /api/fleet in Live mode, with retry — useManagedDevices),
  // so a zero-touch-registered device is manageable here. Live departments
  // (matches /admin/pending), mock as the demo/offline fallback.
  const { devices: roster, fromBackend } = useManagedDevices(orgId)
  const [depts, setDepts] = useState<Dept[]>(getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!isLive()) { setDepts(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setDepts(r as Dept[]) })
    return () => { cancelled = true }
  }, [orgId])

  // Local overlay of a just-saved edit, applied on top of the fleet until the
  // roster itself refetches — same shape the rest of this app uses.
  const [override, setOverride] = useState<Record<string, ManagedDevice>>({})
  const devices = roster.map((d) => override[d.id] ?? d)
  const [editing, setEditing] = useState<ManagedDevice | null>(null)

  const deptName = (id: string) => depts.find((d) => d.id === id)?.name ?? id

  const save = async (d: ManagedDevice, patch: { name: string; departmentId: string | null }) => {
    const next: ManagedDevice = { ...d, name: patch.name, departmentIds: patch.departmentId ? [patch.departmentId] : [] }
    if (!isLive() || !fromBackend) {
      toast.success(`Saved ${patch.name} (demo)`)
      setOverride((o) => ({ ...o, [d.id]: next }))
      setEditing(null)
      return
    }
    const res = await api.updateNodeProfile(d.id, patch)
    if (res?.ok) {
      toast.success(`Saved ${patch.name}`)
      setOverride((o) => ({ ...o, [d.id]: next }))
      setEditing(null)
    } else {
      toast.error('Save failed')
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Device Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Rename and reassign devices already on your fleet. New hardware registers itself the moment it sends telemetry — approve it from Pending Devices.</p>
        </div>
        <Link href="/admin/pending" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
          <PlugZap size={15} /> Pending Devices
        </Link>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              {['Device', 'Serial', 'Domain', 'Location', 'Theme', 'Department', 'Status'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-white/3 cursor-pointer" style={{ borderBottom: '1px solid #1e2433' }} onClick={() => setEditing(d)}>
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
              </tr>
            ))}
            {devices.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                No devices yet. New hardware appears in <Link href="/admin/pending" className="text-indigo-400 hover:underline">Pending Devices</Link> the moment it connects.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <DeviceModal
          device={editing}
          departments={depts}
          onClose={() => setEditing(null)}
          onSave={(patch) => save(editing, patch)}
        />
      )}
    </div>
  )
}

function DeviceModal({ device, departments, onClose, onSave }: {
  device: ManagedDevice
  departments: Dept[]
  onClose: () => void
  onSave: (patch: { name: string; departmentId: string | null }) => void
}) {
  const [name, setName] = useState(device.name)
  const [deptId, setDeptId] = useState<string | null>(device.departmentIds[0] ?? null)
  const dirty = name.trim() !== device.name || deptId !== (device.departmentIds[0] ?? null)

  const domainMeta = device.domain ? DOMAIN_META[device.domain] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">Edit Device</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Device Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Serial / MAC</label>
              <input value={device.serial} disabled
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-500 font-mono outline-none cursor-not-allowed" style={inset} />
              <p className="text-[11px] text-slate-600 mt-1">Auto-recorded from the device&apos;s own MQTT identity — nothing to type.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Sensor Domain</label>
            <div className="inline-flex px-3 py-2 rounded-lg text-xs font-semibold"
              style={domainMeta ? { color: domainMeta.accent, background: `${domainMeta.accent}1f`, border: `1px solid ${domainMeta.accent}55` } : inset}>
              {domainMeta ? domainMeta.platform : device.deviceType}
            </div>
            <p className="text-[11px] text-slate-600 mt-1">Set once, from the device&apos;s telemetry topic, when it was approved in Pending Devices — not editable here.</p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Department</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setDeptId(null)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', deptId === null ? 'text-white' : 'text-slate-400')}
                style={deptId === null ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                — none —
              </button>
              {departments.map((d) => (
                <button key={d.id} onClick={() => setDeptId(d.id)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', deptId === d.id ? 'text-white' : 'text-slate-400')}
                  style={deptId === d.id ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                  {d.name}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3 rounded-lg text-xs text-slate-500 flex items-start gap-2" style={inset}>
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ color: device.theme === 'fix' ? '#22c55e' : '#a78bfa', background: device.theme === 'fix' ? 'rgba(34,197,94,0.12)' : 'rgba(167,139,250,0.12)' }}>
              {device.theme === 'fix' ? 'FIX' : 'Free Style'}
            </span>
            <span>Dashboard theme has no effect on the admin view (always shows FIX) and only sets the viewer&apos;s default, which they can switch per visit. Not editable here.</span>
          </div>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={() => onSave({ name: name.trim(), departmentId: deptId })} disabled={!dirty || !name.trim()}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
            Save Changes
          </button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
