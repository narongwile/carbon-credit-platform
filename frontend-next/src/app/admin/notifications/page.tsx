'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { defaultNotificationChannels, getDepartmentsByOrg, getEventProblemsByDept, eventProblems as mockEventProblems } from '@/lib/orgData'
import { useManagedDevices, useFleetHosts } from '@/lib/useManagedDevices'
import { DOMAIN_TO_PLATFORM, licensedDomains } from '@/lib/entitlements'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import EmailTemplateConfigurator from '@/components/notifications/EmailTemplateConfigurator'
import { useAlarmDB } from '@/server/alarmStore'
import { api, isLive, useIsLive } from '@/lib/api'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { NotificationChannelConfig, EventProblem } from '@/types/org'
import { getSession } from '@/lib/auth'
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
  const live = useIsLive()
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  // Real fleet — the "Apply to device" picker AND applyRuleToOrg's actual
  // targets used to both come from the mock seed (managedDevicesFromFleet /
  // getHostsByOrg) unconditionally, so "Applied to N node(s) across your
  // org" silently wrote a rule onto demo devices instead of the real fleet.
  const { devices } = useManagedDevices(orgId)
  const { hosts } = useFleetHosts(orgId)

  // Real entitlements — which product tabs to offer at all. licensedDomains()
  // only knows the 3 seed orgs (mockData.ts), so a real org either showed the
  // wrong tabs or none. Demo mode keeps the mock list (dropped entirely at
  // first — Demo showed all 3 tabs regardless of what mockData.ts licensed).
  // Depends on `live` (reactive), not a one-time isLive() snapshot: toggling
  // Live/Demo in place, without navigating away, must re-sync this.
  const [orgDomains, setOrgDomains] = useState<SensorDomain[]>(() => licensedDomains(orgId))
  useEffect(() => {
    if (!live) { setOrgDomains(licensedDomains(orgId)); return }
    let cancelled = false
    api.entitlements(orgId).then((ents) => {
      if (cancelled || !ents) return
      setOrgDomains((['transformer', 'carbonNode', 'bloodBox'] as SensorDomain[]).filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d])))
    })
    return () => { cancelled = true }
  }, [live, orgId])
  const [product, setProduct] = useState<SensorDomain>('transformer')
  useEffect(() => { if (orgDomains.length && !orgDomains.includes(product)) setProduct(orgDomains[0]) }, [orgDomains, product])
  const setRuleDB = useAlarmDB((s) => s.setRule)
  // The org-wide rule write was fire-and-forget (`void api.putOrgRule(...)`)
  // with the success toast fired unconditionally on the next line, so a
  // rejected save — a 403, a 500, the request never leaving the browser —
  // still told the admin their thresholds were applied to every node in the
  // organization. Await it and report what actually happened.
  const applyRuleToOrg = async (rule: NodeAlarmRule) => {
    const targets = hosts.filter((h) => h.domain === product)
    targets.forEach((h) => setRuleDB(h.id, rule, orgId))
    if (isLive()) {
      const r = await api.putOrgRule(orgId, { rule })
      if (!r) { toast.error('Could not apply the rule across your organization'); return }
    }
    toast.success(`Applied to ${targets.length} ${DOMAIN_META[product].platform} node(s) across your org`)
  }
  const [scope, setScope] = useState<'all' | string>('all')
  const [deptScope, setDeptScope] = useState<'all' | string>('all')
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  // Which events this user wants to be notified about. Loaded from their
  // stored prefs below — it used to be seeded with three HARDCODED MOCK ids
  // ('ev-temp-high', 'ev-door-open', 'ev-offline') that exist only in
  // orgData.ts, never in a real event_problems table, and was never read back
  // from the server at all. So every visit reset the selection to three ids
  // that match nothing, and pressing Save wrote those ids over whatever the
  // user had actually chosen last time.
  const [events, setEvents] = useState<string[]>([])
  // The rest of this user's prefs blob, kept so Save can write it back
  // untouched — see the comment on save().
  const [otherPrefs, setOtherPrefs] = useState<Record<string, unknown>>({})
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const s = getSession()
    // Demo mode has no stored prefs to read; these three ids are real entries
    // in orgData's mock catalogue, so they still make a sensible pre-selection
    // there. They are NOT seeded in live mode, where they match nothing.
    if (!live) { setEvents(['ev-temp-high', 'ev-door-open', 'ev-offline']); setPrefsLoaded(true); return }
    if (!s) { setPrefsLoaded(true); return }
    let cancelled = false
    api.getMyConfig(s.id).then((r) => {
      if (cancelled) return
      const prefs = (r?.prefs ?? {}) as Record<string, unknown>
      const { notificationEvents, ...rest } = prefs
      setEvents(Array.isArray(notificationEvents) ? (notificationEvents as string[]) : [])
      setOtherPrefs(rest)
      setPrefsLoaded(true)
    })
    return () => { cancelled = true }
  }, [live])

  // Which channel set is being edited: '' = the ORG-level fallback, or a
  // department id for that department's own destinations. notify() delivers an
  // alarm to the org-level rows OR the rows of the department that OWNS the
  // device (nodes.department_id) — so this selector is what finally makes the
  // owning department decide where an alarm actually goes. The routing query
  // has always supported it; nothing could create a department row until now.
  const [channelDept, setChannelDept] = useState('')
  useEffect(() => {
    let cancelled = false
    // Always reset to the defaults first: a department with no rows of its own
    // must show an EMPTY set (it falls back to org-level at delivery time),
    // not whichever set happened to be loaded before it was selected.
    setChannels(defaultNotificationChannels)
    api.orgChannels(orgId, channelDept || undefined).then((rows) => {
      if (!cancelled && rows && rows.length > 0) {
        const mapped = defaultNotificationChannels.map(dc => {
          const row = rows.find(r => r.channel === dc.id)
          if (row) return { ...dc, enabled: !!row.enabled, target: row.target || '', minSeverity: (row.min_severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING') as 'WARNING' | 'CRITICAL' }
          return dc
        })
        setChannels(mapped)
      }
    })
    return () => { cancelled = true }
  }, [orgId, channelDept])

  // Real departments (matches Pending Devices' load() pattern), mock as the
  // demo/offline fallback.
  const [orgDepts, setOrgDepts] = useState<{ id: string; name: string }[]>(() => getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!live) { setOrgDepts(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setOrgDepts(r as { id: string; name: string }[]) })
    return () => { cancelled = true }
  }, [live, orgId])

  // Create Event in each department (per-department eventProblem catalog).
  // This used to be local React state only — Add/Remove never called
  // api.saveEventProblem/deleteEventProblem (both already exist and are
  // exactly what the Event Catalog tab on User Management uses for the same
  // table), so every "Event added to department" toast was a lie: nothing
  // survived a reload, and it duplicated a feature that already works.
  const [deptId, setDeptId] = useState('')
  useEffect(() => { if (orgDepts.length && !orgDepts.some((d) => d.id === deptId)) setDeptId(orgDepts[0]?.id ?? '') }, [orgDepts, deptId])
  const [deptEvents, setDeptEvents] = useState<Record<string, EventProblem[]>>(
    () => Object.fromEntries(getDepartmentsByOrg(orgId).map((d) => [d.id, getEventProblemsByDept(d.id).map((e) => ({ ...e }))])),
  )
  useEffect(() => {
    if (!live) {
      setDeptEvents(Object.fromEntries(getDepartmentsByOrg(orgId).map((d) => [d.id, getEventProblemsByDept(d.id).map((e) => ({ ...e }))])))
      return
    }
    let cancelled = false
    api.eventProblems(orgId).then((rows) => {
      if (cancelled || !rows) return
      const grouped: Record<string, EventProblem[]> = {}
      const orgWide: EventProblem[] = []
      for (const r of rows) {
        // A NULL department_id means org-wide, not malformed. These used to be
        // `continue`d away, so a problem defined for the whole organization
        // was invisible in Event Selection below and could never be subscribed
        // to — even though the backend deliberately returns them (epListFunc
        // matches "department_id=? OR department_id IS NULL") and the viewer's
        // own alarm pages already honour them.
        if (!r.department_id) { orgWide.push({ id: r.id, label: r.label }); continue }
        ;(grouped[r.department_id] ??= []).push({ id: r.id, label: r.label, departmentId: r.department_id })
      }
      setDeptEvents(grouped)
      setOrgWideEvents(orgWide)
    })
    return () => { cancelled = true }
  }, [live, orgId])
  // Org-wide problems are kept apart from deptEvents: that map is keyed by
  // department for the per-department editor, and an org-wide row belongs to
  // no department — but it still has to appear in the selection list.
  const [orgWideEvents, setOrgWideEvents] = useState<EventProblem[]>([])
  const [newEvent, setNewEvent] = useState('')
  const deptList = deptEvents[deptId] ?? []
  // Event Selection & Edit (below) reuses the same real, per-department fetch
  // — flattened — instead of the separate hardcoded mock list it read before.
  const eventProblems = live ? [...orgWideEvents, ...Object.values(deptEvents).flat()] : mockEventProblems
  const addDeptEvent = async () => {
    if (!newEvent.trim() || !deptId) return
    const label = newEvent.trim()
    if (isLive()) {
      const r = await api.saveEventProblem({ orgId, departmentId: deptId, label })
      if (!r?.id) { toast.error('Could not add the event'); return }
      setDeptEvents((c) => ({ ...c, [deptId]: [...(c[deptId] ?? []), { id: r.id, label, departmentId: deptId }] }))
    } else {
      setDeptEvents((c) => ({ ...c, [deptId]: [...(c[deptId] ?? []), { id: `ev-${deptId}-${Date.now()}`, label, departmentId: deptId }] }))
    }
    setNewEvent(''); toast.success('Event added to department')
  }
  // Removed optimistically and never verified: the row vanished from the list
  // whether or not the DELETE succeeded, so a failed delete looked identical
  // to a successful one until the next reload brought the event back.
  const removeDeptEvent = async (id: string) => {
    const prev = deptEvents[deptId] ?? []
    setDeptEvents((c) => ({ ...c, [deptId]: prev.filter((e) => e.id !== id) }))
    if (isLive()) {
      const r = await api.deleteEventProblem(id)
      if (!r) {
        setDeptEvents((c) => ({ ...c, [deptId]: prev }))
        toast.error('Could not remove the event')
        return
      }
    }
    toast.success('Event removed')
  }

  const toggleChannel = (id: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const setTarget = (id: string, target: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, target } : x)))
  // Real, and enforced by notify(): a CRITICAL-only channel is skipped for a
  // WARNING alarm. The column was always stored and read but had no control,
  // so every channel sat at WARNING while a separate fake panel claimed to
  // offer severity routing.
  const setMinSeverity = (id: string, minSeverity: 'WARNING' | 'CRITICAL') =>
    setChannels((c) => c.map((x) => (x.id === id ? { ...x, minSeverity } : x)))
  const toggleEvent = (id: string) => setEvents((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  const save = async () => {
    const user = getSession()
    if (!user) { toast.error('Not signed in'); return }
    if (!isLive()) {
      // Demo mode persists nothing. Say so rather than reporting a save that
      // did not happen, or an error for a backend that was never meant to be
      // there — both of which this page did before, depending on the call.
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      toast.success('Notification preferences saved (demo — not persisted)')
      return
    }
    if (!prefsLoaded) { toast.error('Still loading your preferences — try again in a moment'); return }
    // putMyConfig REPLACES the whole prefs blob (mePutFunc does
    // prefs=VALUES(prefs), not a merge), so posting a bare
    // { notificationEvents } silently deleted every other preference this user
    // had: their phone and name from the Profile panel, emailAlerts from
    // Settings, and every per-device alert channel from MyAlertSettings.
    // Spread the rest back in, the same way ProfilePanel and MyAlertSettings
    // already do. The result was ALSO not checked, so a rejected write still
    // reported success.
    const prefsRes = await api.putMyConfig(user.id, { ...otherPrefs, notificationEvents: events })
    if (!prefsRes) { toast.error('Failed to save your event selection'); return }
    // channelDept, so a department's destinations save to that department's
    // own rows instead of overwriting the org-level fallback.
    const res = await api.putOrgChannels(orgId, channels, channelDept || undefined)
    if (!res) { toast.error('Event selection saved, but the delivery channels were not'); return }
    setSaved(true)
    toast.success(channelDept
      ? `Saved — destinations for ${orgDepts.find((d) => d.id === channelDept)?.name ?? 'this department'}`
      : 'Notification preferences saved')
    setTimeout(() => setSaved(false), 2000)
  }

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
              <select value={scope} onChange={(e) => {
                const val = e.target.value
                setScope(val)
                if (val !== 'all') {
                  const dev = devices.find((d) => d.id === val)
                  if (dev?.domain) setProduct(dev.domain)
                }
              }}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
                <option value="all">All devices ({devices.length})</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
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

          <AlarmParamConfig domain={product} nodeId={scope !== 'all' ? scope : undefined} orgId={orgId} onApplyAll={applyRuleToOrg} />
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

          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Destinations for</label>
            <select value={channelDept} onChange={(e) => setChannelDept(e.target.value)}
              className="w-full max-w-sm rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
              <option value="">Whole organization (fallback for every alarm)</option>
              {orgDepts.map((d) => <option key={d.id} value={d.id}>{d.name} — devices this department owns</option>)}
            </select>
            <p className="text-[11px] text-slate-600 mt-1.5">
              {channelDept
                ? 'An alarm on a device this department OWNS (its Owning department in Edit Device) is delivered here as well as to the organization-wide destinations below-none of them replace each other.'
                : 'Used for every alarm, whichever department owns the device. Pick a department above to add destinations that only its own devices’ alarms reach.'}
            </p>
          </div>

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
                  {/* Real severity routing: notify() skips a CRITICAL-only
                      channel for a WARNING alarm. Replaces the fake
                      "Severity Routing" panel that used to sit in the alarm
                      form and persisted nothing. */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Send on</span>
                    {(['WARNING', 'CRITICAL'] as const).map((sev) => (
                      <button key={sev} onClick={() => setMinSeverity(ch.id, sev)} disabled={!ch.enabled}
                        className={clsx('px-2 py-0.5 rounded-md text-[10px] font-semibold disabled:opacity-40',
                          (ch.minSeverity ?? 'WARNING') === sev ? 'text-white' : 'text-slate-500')}
                        style={(ch.minSeverity ?? 'WARNING') === sev
                          ? { background: sev === 'CRITICAL' ? 'rgba(239,68,68,0.2)' : 'rgba(251,191,36,0.2)', border: `1px solid ${sev === 'CRITICAL' ? '#ef4444' : '#f59e0b'}` }
                          : { background: '#0d1117', border: '1px solid #1e2433' }}>
                        {sev === 'WARNING' ? 'Warning +' : 'Critical only'}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Enterprise Email Alarm Template & Custom SOP Configurator */}
        <div className="lg:col-span-2">
          <EmailTemplateConfigurator orgId={orgId} />
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
