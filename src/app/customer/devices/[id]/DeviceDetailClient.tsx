'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { managedDevices, defaultNotificationChannels, eventProblems } from '@/lib/orgData'
import type { NotificationChannelConfig } from '@/types/org'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  ArrowLeft, Activity, Upload, Download, FileText, Mail, FileSpreadsheet,
  ToggleLeft, ToggleRight, Wifi, WifiOff, Save, Check,
} from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

function genHistory(seed: number) {
  const out: { time: string; value: number }[] = []
  const now = Date.now()
  let v = seed
  for (let i = 96; i >= 0; i--) {
    v += (Math.random() - 0.5) * 1.5
    out.push({ time: new Date(now - i * 15 * 60 * 1000).toISOString().slice(5, 16).replace('T', ' '), value: +v.toFixed(1) })
  }
  return out
}

const PDF_HISTORY = [
  { name: 'Calibration_Cert_2026Q1.pdf', date: '2026-03-12', size: '420 KB' },
  { name: 'Maintenance_Log_Feb.pdf', date: '2026-02-28', size: '1.2 MB' },
]

export default function DeviceDetailClient() {
  const params = useParams()
  const id = String(params?.id ?? '')
  const device = managedDevices.find((d) => d.id === id) ?? managedDevices[0]

  const baseTemp = useMemo(() => parseFloat(device.lastValue ?? '5') || 5, [device])
  const history = useMemo(() => genHistory(baseTemp), [baseTemp])

  const [range, setRange] = useState({ start: '2026-05-01', end: '2026-06-01' })
  const [selectedEvent, setSelectedEvent] = useState(eventProblems[0].id)
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [limits, setLimits] = useState({ low: 2, high: 8 })
  const [email, setEmail] = useState('viewer@customer.com')
  const [savedSetting, setSavedSetting] = useState(false)
  const [exported, setExported] = useState('')

  const toggleChannel = (cid: string) => setChannels((c) => c.map((x) => (x.id === cid ? { ...x, enabled: !x.enabled } : x)))
  const saveSetting = async () => { await new Promise((r) => setTimeout(r, 300)); setSavedSetting(true); setTimeout(() => setSavedSetting(false), 2000) }

  const status = device.status === 'online' ? 'NORMAL' : 'OFFLINE'

  return (
    <div className="p-6 space-y-5">
      <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={15} /> Back to devices
      </Link>

      {/* Individual device (FIX): picture, status, last value */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="rounded-xl p-5 flex flex-col items-center justify-center text-center" style={surface}>
          <div className="w-full h-32 rounded-lg flex items-center justify-center mb-3" style={inset}>
            <Activity size={40} className="text-slate-700" />
          </div>
          <div className="text-sm font-bold text-white">{device.name}</div>
          <div className="text-xs text-slate-500">{device.deviceType} · {device.serial}</div>
        </div>
        <div className="rounded-xl p-5 flex flex-col justify-center" style={surface}>
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Status</div>
          <div className={clsx('flex items-center gap-2 text-lg font-bold', device.status === 'online' ? 'text-green-400' : 'text-slate-500')}>
            {device.status === 'online' ? <Wifi size={18} /> : <WifiOff size={18} />} {status}
          </div>
          <div className="text-xs text-slate-500 mt-2">{device.location}</div>
        </div>
        <div className="rounded-xl p-5 flex flex-col justify-center" style={surface}>
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Last Data Value</div>
          <div className="text-3xl font-extrabold text-white tabular-nums">{device.lastValue ?? '—'}</div>
          <div className="text-xs text-slate-500 mt-2">Updated just now</div>
        </div>
      </div>

      {/* Graph: date time selected */}
      <div className="rounded-xl p-5" style={surface}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold text-white">Performance Graph</h3>
          <div className="flex items-center gap-2">
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="rounded-lg px-2.5 py-1.5 text-xs text-white outline-none" style={inset} />
            <span className="text-slate-600 text-xs">to</span>
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="rounded-lg px-2.5 py-1.5 text-xs text-white outline-none" style={inset} />
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} minTickGap={40} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }} />
              <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sub-feature row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alarm log + event selection */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">Alarm Log</h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Event Selection</label>
            <select value={selectedEvent} onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
              {eventProblems.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-auto">
            {history.filter((h) => h.value > limits.high || h.value < limits.low).slice(0, 6).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={inset}>
                <span className="text-slate-300">{eventProblems.find((e) => e.id === selectedEvent)?.label}</span>
                <span className="text-slate-500">{h.time}</span>
                <span className={h.value > limits.high ? 'text-red-400' : 'text-blue-400'}>{h.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PDF upload / download */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">PDF File Log</h3>
          <div className="flex items-center gap-2">
            <input type="date" className="rounded-lg px-2.5 py-2 text-xs text-white outline-none" style={inset} defaultValue="2026-06-01" />
            <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white cursor-pointer" style={gradient}>
              <Upload size={14} /> Upload PDF
              <input type="file" accept="application/pdf" className="hidden" />
            </label>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-xs">
              <thead><tr style={{ background: '#0a0e1a' }}>{['File', 'Date', 'Size', ''].map((h) => <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {PDF_HISTORY.map((f) => (
                  <tr key={f.name} style={{ borderTop: '1px solid #1e2433' }}>
                    <td className="py-2 px-3 text-slate-300 flex items-center gap-1.5"><FileText size={12} className="text-indigo-400" />{f.name}</td>
                    <td className="py-2 px-3 text-slate-500">{f.date}</td>
                    <td className="py-2 px-3 text-slate-500">{f.size}</td>
                    <td className="py-2 px-3 text-right"><button className="text-indigo-400 hover:text-indigo-300"><Download size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Export data */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">Export Data</h3>
          <div className="flex items-center gap-2">
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} className="flex-1 rounded-lg px-2.5 py-2 text-xs text-white outline-none" style={inset} />
            <span className="text-slate-600 text-xs">to</span>
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} className="flex-1 rounded-lg px-2.5 py-2 text-xs text-white outline-none" style={inset} />
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Send to email" className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <div className="flex gap-2">
            <button onClick={() => setExported('email')} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={gradient}><Mail size={13} /> Send Email</button>
            <button onClick={() => setExported('csv')} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300" style={inset}><FileSpreadsheet size={13} /> .CSV File</button>
          </div>
          {exported && <p className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> {exported === 'email' ? `Export queued to ${email}` : 'CSV download started'}</p>}
        </div>

        {/* Alarm / notification setting */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">Alarm / Notification Setting</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-blue-400 mb-1 uppercase tracking-wider">Lower limit</label>
              <input type="number" value={limits.low} onChange={(e) => setLimits((l) => ({ ...l, low: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </div>
            <div>
              <label className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Upper limit</label>
              <input type="number" value={limits.high} onChange={(e) => setLimits((l) => ({ ...l, high: +e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset} />
            </div>
          </div>
          <div className="space-y-1.5">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
                <span className="text-sm text-slate-300">{ch.name}</span>
                <button onClick={() => toggleChannel(ch.id)}>
                  {ch.enabled ? <ToggleRight size={20} className="text-indigo-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
                </button>
              </div>
            ))}
          </div>
          <button onClick={saveSetting} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={savedSetting ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
            <Save size={14} /> {savedSetting ? 'Saved!' : 'Save Setting'}
          </button>
        </div>
      </div>
    </div>
  )
}
