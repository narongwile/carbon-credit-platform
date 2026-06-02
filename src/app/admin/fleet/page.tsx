'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { fleetDevices, deviceInterfaces, sites } from '@/lib/fleetData'
import { deviceFirmwareHistory, cellularLinks, loraPeers, getFirmwareByDevice, getCellularByDevice } from '@/lib/fleetExtra'
import {
  Cpu, Wifi, WifiOff, Battery, Plug, Radio, Signal, History, ChevronRight, CheckCircle, RotateCcw, XCircle,
} from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const kindColor: Record<string, string> = {
  can: '#6366f1', rs485: '#06b6d4', i2c: '#22c55e', gpio_di: '#a78bfa',
  gpio_do: '#a78bfa', ct: '#fbbf24', lora: '#f59e0b', cellular: '#ef4444',
}

const fwResult: Record<string, { color: string; icon: React.ReactNode }> = {
  success: { color: '#4ade80', icon: <CheckCircle size={12} /> },
  rolled_back: { color: '#fbbf24', icon: <RotateCcw size={12} /> },
  failed: { color: '#ef4444', icon: <XCircle size={12} /> },
  abandoned: { color: '#6b7280', icon: <XCircle size={12} /> },
}

export default function FleetPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const devices = fleetDevices.filter((d) => d.orgId === orgId)
  const [activeId, setActiveId] = useState(devices[0]?.id ?? '')
  const active = devices.find((d) => d.id === activeId)

  const ifaces = active ? deviceInterfaces.filter((i) => i.deviceId === active.id) : []
  const fw = active ? getFirmwareByDevice(active.id) : []
  const cell = active ? getCellularByDevice(active.id) : undefined
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Fleet — Devices &amp; Interfaces</h1>
        <p className="text-sm text-slate-500 mt-0.5">Physical edge gateways, their interfaces (CAN/RS485/LoRa/cellular), firmware OTA history and links</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Device list */}
        <div className="space-y-2">
          {devices.map((d) => (
            <button key={d.id} onClick={() => setActiveId(d.id)} className="w-full text-left p-4 rounded-xl transition-all" style={{ ...surface, borderColor: activeId === d.id ? '#6366f1' : '#1e2433' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}><Cpu size={15} className="text-indigo-400" /></span>
                  <div>
                    <div className="text-sm font-semibold text-white">{d.hardwareModel}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{d.mac}</div>
                  </div>
                </div>
                {d.status === 'online' ? <Wifi size={15} className="text-green-400" /> : <WifiOff size={15} className="text-slate-600" />}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                <span>{siteName(d.siteId)}</span>
                <span className="flex items-center gap-1"><Battery size={11} /> {d.batteryPct}%</span>
              </div>
            </button>
          ))}
        </div>

        {/* Device detail */}
        {active && (
          <div className="lg:col-span-2 space-y-4">
            {/* Header / provisioning */}
            <div className="rounded-xl p-5" style={surface}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-base font-bold text-white">{active.hardwareModel}</div>
                  <div className="text-xs text-slate-500 font-mono">chip {active.chipId} · {active.mac}</div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)' }}>{active.provisioningState}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['Firmware', active.firmwareVersion], ['Battery', `${active.batteryPct}%`], ['Status', active.status], ['Site', siteName(active.siteId)]].map(([k, v]) => (
                  <div key={k} className="rounded-lg p-2.5" style={inset}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{k}</div>
                    <div className="text-sm text-white font-medium truncate">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interfaces */}
            <div className="rounded-xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Plug size={14} className="text-indigo-400" /> Interfaces</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ifaces.map((i) => (
                  <div key={i.id} className="p-3 rounded-lg" style={inset}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase" style={{ color: kindColor[i.kind] ?? '#94a3b8' }}>{i.kind}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: i.status === 'up' ? '#4ade80' : '#6b7280' }} />
                    </div>
                    <div className="text-sm text-white mt-1">{i.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Connectivity: cellular + lora */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl p-5" style={surface}>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Signal size={14} className="text-red-400" /> Cellular Link</h3>
                {cell ? (
                  <div className="space-y-1.5 text-sm">
                    {[['IMEI', cell.imei], ['ICCID', cell.iccid], ['APN', cell.apn], ['Operator', cell.operatorMccMnc], ['Signal', `${cell.lastRssiDbm} dBm · ${cell.lastBand}`], ['Data used', `${cell.dataUsedMb} MB`], ['SIM', cell.simStatus]].map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="text-white font-mono text-xs">{v}</span></div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-600">No cellular link on this device.</p>}
              </div>
              <div className="rounded-xl p-5" style={surface}>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Radio size={14} className="text-amber-400" /> LoRa Peers</h3>
                {loraPeers.filter((p) => ifaces.some((i) => i.id === p.interfaceId)).length ? loraPeers.filter((p) => ifaces.some((i) => i.id === p.interfaceId)).map((p) => (
                  <div key={p.id} className="space-y-1.5 text-sm">
                    {[['DevAddr', p.devaddr], ['SF', p.spreadingFactor], ['Band', p.freqBand], ['Signal', `${p.lastRssiDbm} dBm`]].map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="text-white font-mono text-xs">{v}</span></div>
                    ))}
                  </div>
                )) : <p className="text-xs text-slate-600">No LoRa peers on this device.</p>}
              </div>
            </div>

            {/* Firmware OTA history */}
            <div className="rounded-xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><History size={14} className="text-indigo-400" /> Firmware OTA History</h3>
              <div className="space-y-2">
                {fw.length ? fw.map((f) => {
                  const r = fwResult[f.result]
                  return (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg" style={inset}>
                      <span style={{ color: r.color }}>{r.icon}</span>
                      <span className="text-sm text-slate-300 flex items-center gap-1.5">{f.fromVersion} <ChevronRight size={12} className="text-slate-600" /> {f.toVersion}</span>
                      <span className="text-[11px] text-slate-600 font-mono ml-auto">{f.artefactSha256}</span>
                      <span className="text-[11px] font-bold uppercase" style={{ color: r.color }}>{f.result.replace('_', ' ')}</span>
                    </div>
                  )
                }) : <p className="text-xs text-slate-600">No firmware history.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
