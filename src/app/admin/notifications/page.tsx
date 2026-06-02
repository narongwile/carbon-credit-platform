'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import {
  managedDevices, defaultNotificationChannels, eventProblems, getDevicesByOrg,
} from '@/lib/orgData'
import type { NotificationChannelConfig } from '@/types/org'
import { Mail, MessageCircle, Send, MessagesSquare, ToggleLeft, ToggleRight, Save, BellRing, Check } from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const channelIcon = {
  email: Mail,
  line: MessageCircle,
  telegram: Send,
  googlechat: MessagesSquare,
} as const

export default function AlarmNotificationPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const devices = getDevicesByOrg(orgId).length ? getDevicesByOrg(orgId) : managedDevices

  const [scope, setScope] = useState<'all' | string>('all')
  const [limits, setLimits] = useState({ low: 2, high: 8 })
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [events, setEvents] = useState<string[]>(['ev-temp-high', 'ev-door-open', 'ev-offline'])
  const [saved, setSaved] = useState(false)

  const toggleChannel = (id: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const setTarget = (id: string, target: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, target } : x)))
  const toggleEvent = (id: string) => setEvents((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  const save = async () => { await new Promise((r) => setTimeout(r, 400)); setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Alarm &amp; Notification Management</h1>
        <p className="text-sm text-slate-500 mt-0.5">High / low alarm limits, notification channels and event selection</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alarm setting */}
        <div className="rounded-xl p-5 space-y-4" style={surface}>
          <div className="flex items-center gap-2">
            <BellRing size={15} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Alarm Setting (high / low)</h3>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Apply to</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
              <option value="all">All devices ({devices.length})</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-blue-400 mb-1 uppercase tracking-wider">Low limit</label>
              <input type="number" value={limits.low} onChange={(e) => setLimits((l) => ({ ...l, low: +e.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500" style={inset} />
            </div>
            <div>
              <label className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">High limit</label>
              <input type="number" value={limits.high} onChange={(e) => setLimits((l) => ({ ...l, high: +e.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-red-500" style={inset} />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Triggers a notification when a reading falls below the low limit or rises above the high limit.</p>
        </div>

        {/* Event selection & edit */}
        <div className="rounded-xl p-5 space-y-3" style={surface}>
          <h3 className="text-sm font-semibold text-white">Event Selection &amp; Edit</h3>
          <p className="text-[11px] text-slate-500">Events that raise an alarm / appear in the viewer&apos;s event dropdown.</p>
          <div className="space-y-1.5">
            {eventProblems.map((ev) => {
              const on = events.includes(ev.id)
              return (
                <button key={ev.id} onClick={() => toggleEvent(ev.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all"
                  style={{ background: '#0a0e1a', border: `1px solid ${on ? '#6366f1' : '#1e2433'}` }}>
                  <span className="text-sm text-slate-200">{ev.label}</span>
                  {on ? <Check size={16} className="text-indigo-400" /> : <span className="text-xs text-slate-600">off</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notification channels */}
        <div className="rounded-xl p-5 space-y-3 lg:col-span-2" style={surface}>
          <h3 className="text-sm font-semibold text-white">Notification Setting</h3>
          <p className="text-[11px] text-slate-500">Choose how alarms are delivered. Enable a channel and provide its target.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {channels.map((ch) => {
              const Icon = channelIcon[ch.id]
              return (
                <div key={ch.id} className="p-4 rounded-xl" style={{ background: '#0a0e1a', border: `1px solid ${ch.enabled ? '#6366f1' : '#1e2433'}` }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <Icon size={15} className={ch.enabled ? 'text-indigo-400' : 'text-slate-500'} />
                      <span className="text-sm font-medium text-white">{ch.name}</span>
                    </div>
                    <button onClick={() => toggleChannel(ch.id)}>
                      {ch.enabled ? <ToggleRight size={24} className="text-indigo-400" /> : <ToggleLeft size={24} className="text-slate-600" />}
                    </button>
                  </div>
                  <input value={ch.target} onChange={(e) => setTarget(ch.id, e.target.value)} disabled={!ch.enabled}
                    placeholder={`${ch.name} target…`}
                    className={clsx('w-full rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-indigo-500', ch.enabled ? 'text-white' : 'text-slate-600')}
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <button onClick={save} className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white" style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
        <Save size={16} /> {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
