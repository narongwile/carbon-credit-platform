'use client'

import { X, Activity, Battery, Wifi, Cpu, Clock } from 'lucide-react'
import type { FleetDevice } from '@/types/fleet'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface Props {
  isOpen: boolean
  onClose: () => void
  device: FleetDevice | null
  signalDbm?: number
}

// Device diagnostics modal — battery, signal, firmware, uptime + telemetry log.
export default function SensorDetailsModal({ isOpen, onClose, device, signalDbm = -65 }: Props) {
  if (!isOpen || !device) return null

  const stat = [
    { icon: Battery, label: 'Battery', value: `${device.batteryPct}%`, hint: device.batteryPct > 40 ? 'Good condition' : 'Low', good: device.batteryPct > 40 },
    { icon: Wifi, label: 'Signal', value: `${signalDbm} dBm`, hint: signalDbm > -80 ? 'Excellent' : 'Weak', good: signalDbm > -80 },
    { icon: Cpu, label: 'Firmware', value: device.firmwareVersion, hint: 'Up to date', good: true },
    { icon: Clock, label: 'Status', value: device.status, hint: 'Since last reboot', good: device.status === 'online' },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={surface}>
        <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottom: '1px solid #1e2433' }}>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Activity size={18} className="text-indigo-400" /> Sensor Diagnostics</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{device.mac}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stat.map((s) => (
              <div key={s.label} className="p-4 rounded-xl" style={inset}>
                <div className="flex items-center text-slate-400 mb-2"><s.icon size={14} className="mr-2" /><span className="text-[10px] font-bold uppercase tracking-wider">{s.label}</span></div>
                <div className="text-lg font-black text-white capitalize">{s.value}</div>
                <div className={`text-[10px] font-bold mt-1 ${s.good ? 'text-green-400' : 'text-amber-400'}`}>{s.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid #1e2433' }}>Device Information</h4>
              <div className="space-y-3 text-sm">
                {[['Model', device.hardwareModel], ['Chip ID', device.chipId], ['Provisioning', device.provisioningState], ['MAC', device.mac]].map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-mono text-white text-xs">{v}</span></div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid #1e2433' }}>Recent Telemetry</h4>
              <div className="rounded-lg p-3 text-xs font-mono text-emerald-400 leading-relaxed" style={{ background: '#05070d' }}>
                <div>[12:44:01] PUBLISH telemetry/{device.id}</div>
                <div>{`{ "temp": 4.1, "door": 0, "bat": ${device.batteryPct} }`}</div>
                <div className="text-slate-600 my-1">------------------------</div>
                <div>[12:34:01] PUBLISH telemetry/{device.id}</div>
                <div>{`{ "temp": 4.3, "door": 0, "bat": ${device.batteryPct} }`}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 flex justify-end" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-medium text-slate-300" style={inset}>Close</button>
        </div>
      </div>
    </div>
  )
}
