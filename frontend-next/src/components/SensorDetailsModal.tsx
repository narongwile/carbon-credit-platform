'use client'

// ---------------------------------------------------------------------------
// Device diagnostics modal — battery, signal, firmware, status, and current
// telemetry values, all real.
//
// Used to take a mock FleetDevice and render a "Recent Telemetry" panel of
// two FABRICATED PUBLISH log lines with the device's real battery number
// spliced in — not a log of anything that happened. Now takes the same
// device_presence fields the fleet page already fetched (via api.latest) and
// the values object from that same call, which is genuinely this device's
// most recent reading per parameter.
// ---------------------------------------------------------------------------

import { X, Activity, Battery, Wifi, Cpu, Clock } from 'lucide-react'
import type { DevicePresence } from '@/lib/api'
import { fmtDateTime } from '@/lib/displayTime'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface Props {
  isOpen: boolean
  onClose: () => void
  nodeId: string | null
  deviceName?: string
  presence?: DevicePresence | null
  values?: Record<string, number>
  lastReadingAt?: string | null
}

export default function SensorDetailsModal({ isOpen, onClose, nodeId, deviceName, presence, values, lastReadingAt }: Props) {
  if (!isOpen || !nodeId) return null

  const online = presence?.online === 1
  const rssi = presence?.rssi ?? null
  const batt = presence?.batt ?? null

  const stat = [
    { icon: Battery, label: 'Battery', value: batt != null ? `${batt}%` : '—', hint: batt == null ? 'Not reported' : batt > 40 ? 'Good condition' : 'Low', good: batt == null ? null : batt > 40 },
    { icon: Wifi, label: 'Signal', value: rssi != null ? `${rssi} dBm` : '—', hint: rssi == null ? 'Not reported' : rssi > -80 ? 'Good' : 'Weak', good: rssi == null ? null : rssi > -80 },
    { icon: Cpu, label: 'Firmware', value: presence?.fw || '—', hint: presence?.transport ? `via ${presence.transport}` : '', good: true },
    { icon: Clock, label: 'Status', value: online ? 'online' : 'offline', hint: presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never seen', good: online },
  ]

  const valueEntries = Object.entries(values ?? {})

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={surface}>
        <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottom: '1px solid #1e2433' }}>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Activity size={18} className="text-indigo-400" /> Sensor Diagnostics</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{deviceName || nodeId}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stat.map((s) => (
              <div key={s.label} className="p-4 rounded-xl" style={inset}>
                <div className="flex items-center text-slate-400 mb-2"><s.icon size={14} className="mr-2" /><span className="text-[10px] font-bold uppercase tracking-wider">{s.label}</span></div>
                <div className="text-lg font-black text-white capitalize">{s.value}</div>
                <div className={`text-[10px] font-bold mt-1 ${s.good === null ? 'text-slate-600' : s.good ? 'text-green-400' : 'text-amber-400'}`}>{s.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid #1e2433' }}>Device Information</h4>
              <div className="space-y-3 text-sm">
                {[
                  ['Node ID', nodeId],
                  ['Last seen', presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never'],
                  ['Last reading', lastReadingAt ? fmtDateTime(lastReadingAt) : '—'],
                  ['Transport', presence?.transport || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-mono text-white text-xs">{v}</span></div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-white mb-3 pb-2" style={{ borderBottom: '1px solid #1e2433' }}>Current Values</h4>
              {valueEntries.length === 0 ? (
                <p className="text-xs text-slate-600">No recent readings for this device.</p>
              ) : (
                <div className="rounded-lg p-3 text-xs font-mono text-emerald-400 leading-relaxed space-y-1 max-h-40 overflow-y-auto" style={{ background: '#05070d' }}>
                  {valueEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="text-slate-500 truncate">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
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
