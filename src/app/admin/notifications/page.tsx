'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { defaultNotificationChannels, eventProblems, getDepartmentsByOrg, getEventProblemsByDept } from '@/lib/orgData'
import { managedDevicesFromFleet, getHostsByOrg } from '@/lib/fleetData'
import { licensedDomains } from '@/lib/entitlements'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import { useAlarmDB } from '@/server/alarmStore'
import { api } from '@/lib/api'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { NotificationChannelConfig, EventProblem } from '@/types/org'
import { Mail, MessageCircle, Send, MessagesSquare, ToggleLeft, ToggleRight, Save, BellRing, Check, ListChecks, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

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
  const devices = managedDevicesFromFleet(orgId)

  const orgDomains = licensedDomains(orgId)
  const [product, setProduct] = useState<SensorDomain>(orgDomains[0] ?? 'transformer')
  const setRuleDB = useAlarmDB((s) => s.setRule)
  const applyRuleToOrg = (rule: NodeAlarmRule) => {
    const targets = getHostsByOrg(orgId).filter((h) => h.domain === product)
    targets.forEach((h) => setRuleDB(h.id, rule, orgId))
    void api.putOrgRule(orgId, { rule })
    toast.success(`Applied to ${targets.length} ${DOMAIN_META[product].platform} node(s) across your org`)
  }
  const [scope, setScope] = useState<'all' | string>('all')
  const [deptScope, setDeptScope] = useState<'all' | string>('all')
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [events, setEvents] = useState<string[]>(['ev-temp-high', 'ev-door-open', 'ev-offline'])
  const [saved, setSaved] = useState(false)

  // Create Event in each department (per-department eventProblem catalog)
  const orgDepts = getDepartmentsByOrg(orgId)
  const [deptId, setDeptId] = useState(orgDepts[0]?.id ?? '')
  const [deptEvents, setDeptEvents] = useState<Record<string, EventProblem[]>>(
    () => Object.fromEntries(orgDepts.map((d) => [d.id, getEventProblemsByDept(d.id).map((e) => ({ ...e }))])),
  )
  const [newEvent, setNewEvent] = useState('')
  const deptList = deptEvents[deptId] ?? []
  const addDeptEvent = () => {
    if (!newEvent.trim()) return
    setDeptEvents((c) => ({ ...c, [deptId]: [...(c[deptId] ?? []), { id: `ev-${deptId}-${Date.now()}`, label: newEvent.trim(), departmentId: deptId }] }))
    setNewEvent(''); toast.success('Event added to department')
  }
  const removeDeptEvent = (id: string) => { setDeptEvents((c) => ({ ...c, [deptId]: (c[deptId] ?? []).filter((e) => e.id !== id) })); toast.success('Event removed') }

  const toggleChannel = (id: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const setTarget = (id: string, target: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, target } : x)))
  const toggleEvent = (id: string) => setEvents((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  const save = async () => { await new Promise((r) => setTimeout(r, 400)); setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Alarm &amp; Notification Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Advanced org-wide rules — applies across every department in your organization</p>
        </div>
        <span className="text-[10px] px-2.5 py-1 rounded-full font-bold mt-1" style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.12)' }}>ADMIN · ALL DEPARTMENTS</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alarm setting */}
        <div className="rounded-xl p-5 space-y-4" style={surface}>
          <div className="flex items-center gap-2">
            <BellRing size={15} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Alarm Setting (high / low)</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Target department</label>
              <select value={deptScope} onChange={(e) => setDeptScope(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
                <option value="all">All departments</option>
                {orgDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Apply to device</label>
              <select value={scope} onChange={(e) => setScope(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
                <option value="all">All devices ({devices.length})</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          {/* Domain-aware product profile */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Product alarm profile</label>
            <div className="flex gap-2">
              {orgDomains.map((d) => (
                <button key={d} onClick={() => setProduct(d)}
                  className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold transition-all', product === d ? 'text-white' : 'text-slate-500')}
                  style={product === d ? { background: `${DOMAIN_META[d].accent}33`, border: `1px solid ${DOMAIN_META[d].accent}` } : inset}>
                  {DOMAIN_META[d].platform}
                </button>
              ))}
            </div>
          </div>

          <AlarmParamConfig domain={product} advanced orgId={orgId} onApplyAll={applyRuleToOrg} />
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

        {/* Create Event in each department */}
        <div className="rounded-xl p-5 space-y-3 lg:col-span-2" style={surface}>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><ListChecks size={15} className="text-indigo-400" /> Create Event in each department</h3>
          <p className="text-[11px] text-slate-500">Per-department event-problem catalog — populates the viewer&apos;s event-log dropdown for users in that department.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
              {orgDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input value={newEvent} onChange={(e) => setNewEvent(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDeptEvent()} placeholder="New event problem…"
              className="flex-1 min-w-[180px] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            <button onClick={addDeptEvent} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}><Plus size={15} /> Add</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {deptList.length ? deptList.map((e) => (
              <span key={e.id} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg text-slate-200" style={inset}>
                {e.label}
                <button onClick={() => removeDeptEvent(e.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={12} /></button>
              </span>
            )) : <span className="text-xs text-slate-600">No events yet for this department.</span>}
          </div>
        </div>
      </div>

      <button onClick={save} className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white" style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
        <Save size={16} /> {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
