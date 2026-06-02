'use client'

import { useAppStore } from '@/lib/store'
import { Thermometer, Droplets, Gauge, Activity, Zap, Wind, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import type { SensorReading } from '@/types'

function SensorTile({ label, icon, sensor }: { label: string; icon: React.ReactNode; sensor: SensorReading }) {
  const statusColors = {
    NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)' },
    WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
    CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  }
  const sc = statusColors[sensor.status]

  return (
    <div className="rounded-xl p-4" style={{ background: sc.bg, border: `1px solid ${sc.color}25` }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: sc.color }}>{icon}</span>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{sensor.value.toFixed(1)}<span className="text-sm text-slate-500 ml-1">{sensor.unit}</span></div>
      <div className="text-xs mt-1 font-medium" style={{ color: sc.color }}>{sensor.status}</div>
    </div>
  )
}

export default function CustomerPage() {
  const { transformers } = useAppStore()
  // Show org-1 transformers for customer
  const orgTransformers = transformers.filter((t) => t.orgId === 'org-1')
  const critical = orgTransformers.filter((t) => t.status === 'CRITICAL')
  const warning = orgTransformers.filter((t) => t.status === 'WARNING')
  const normal = orgTransformers.filter((t) => t.status === 'NORMAL')

  // Show first transformer details
  const featured = orgTransformers[0]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Transformer Status Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Read-only live monitoring dashboard</p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)' }}>
          <CheckCircle size={20} className="text-green-400" />
          <div>
            <div className="text-2xl font-bold text-green-400">{normal.length}</div>
            <div className="text-xs text-slate-500">Normal</div>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }}>
          <AlertTriangle size={20} className="text-amber-400" />
          <div>
            <div className="text-2xl font-bold text-amber-400">{warning.length}</div>
            <div className="text-xs text-slate-500">Warning</div>
          </div>
        </div>
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <XCircle size={20} className="text-red-400" />
          <div>
            <div className="text-2xl font-bold text-red-400">{critical.length}</div>
            <div className="text-xs text-slate-500">Critical</div>
          </div>
        </div>
      </div>

      {/* All transformers */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <div className="px-5 py-3" style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
          <h3 className="text-sm font-semibold text-white">All Transformers</h3>
        </div>
        <table className="w-full text-sm" style={{ background: '#0d1117' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2433' }}>
              {['Transformer', 'Status', 'Oil Temp', 'Hydrogen', 'Load', 'Health'].map((h) => (
                <th key={h} className="py-3 px-4 text-left text-xs text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgTransformers.map((t) => {
              const sc = t.status === 'NORMAL' ? '#4ade80' : t.status === 'WARNING' ? '#fbbf24' : '#ef4444'
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid #1e2433' }}>
                  <td className="py-3 px-4">
                    <div className="text-white font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.location}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-bold" style={{ color: sc }}>{t.status}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-300">{t.sensors.oilTemperature.value.toFixed(1)}°C</td>
                  <td className="py-3 px-4 text-slate-300">{t.sensors.hydrogen.value.toFixed(0)} ppm</td>
                  <td className="py-3 px-4 text-slate-300">{t.sensors.load.value.toFixed(1)}%</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: '#1e2433' }}>
                        <div className="h-full rounded-full" style={{ width: `${t.healthIndex}%`, background: sc }} />
                      </div>
                      <span className="text-xs text-slate-400 w-6 text-right">{t.healthIndex}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Featured transformer sensors */}
      {featured && (
        <div>
          <div className="text-sm font-semibold text-white mb-3">Live Sensors — {featured.name}</div>
          <div className="grid grid-cols-3 gap-3">
            <SensorTile label="Oil Temperature" icon={<Thermometer size={16} />} sensor={featured.sensors.oilTemperature} />
            <SensorTile label="Hydrogen H2" icon={<Activity size={16} />} sensor={featured.sensors.hydrogen} />
            <SensorTile label="Moisture" icon={<Droplets size={16} />} sensor={featured.sensors.moisture} />
            <SensorTile label="Oil Level" icon={<Gauge size={16} />} sensor={featured.sensors.oilLevel} />
            <SensorTile label="Load" icon={<Zap size={16} />} sensor={featured.sensors.load} />
            <SensorTile label="Ambient Temp" icon={<Wind size={16} />} sensor={featured.sensors.ambientTemperature} />
          </div>
        </div>
      )}
    </div>
  )
}
