'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { defaultNotificationChannels, getDepartmentsByOrg } from '@/lib/orgData'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { DOMAIN_TO_PLATFORM, licensedDomains } from '@/lib/entitlements'
import AdminBulkApplyAlarmEditor from '@/components/device/AdminBulkApplyAlarmEditor'
import EmailTemplateConfigurator from '@/components/notifications/EmailTemplateConfigurator'
import { api, isLive, useIsLive } from '@/lib/api'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { NotificationChannelConfig } from '@/types/org'
import { getSession } from '@/lib/auth'
import {
  Mail,
  MessageCircle,
  Send,
  MessagesSquare,
  ToggleLeft,
  ToggleRight,
  Save,
  BellRing,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Users,
  Globe,
  Check,
  Search,
} from 'lucide-react'
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

type TabKey = 'alarms' | 'channels' | 'email'
type ScopeType = 'org' | 'department' | 'user'

export default function AlarmNotificationPage() {
  const live = useIsLive()
  const { selectedOrgId, orgNames } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const orgName = orgNames[orgId] || 'ETERNITY'
  const { devices } = useManagedDevices(orgId)

  const [activeTab, setActiveTab] = useState<TabKey>('alarms')

  // Real entitlements — which product tabs to offer at all
  const [orgDomains, setOrgDomains] = useState<SensorDomain[]>(() => licensedDomains(orgId))
  useEffect(() => {
    if (!live) { setOrgDomains(licensedDomains(orgId)); return }
    let cancelled = false
    api.entitlements(orgId).then((ents) => {
      if (cancelled || !ents) return
      setOrgDomains((['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[]).filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d])))
    })
    return () => { cancelled = true }
  }, [live, orgId])
  const [product, setProduct] = useState<SensorDomain>('transformer')
  useEffect(() => { if (orgDomains.length && !orgDomains.includes(product)) setProduct(orgDomains[0]) }, [orgDomains, product])

  // Real departments
  const [orgDepts, setOrgDepts] = useState<{ id: string; name: string }[]>(() => getDepartmentsByOrg(orgId))
  useEffect(() => {
    if (!live) { setOrgDepts(getDepartmentsByOrg(orgId)); return }
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setOrgDepts(r as { id: string; name: string }[]) })
    return () => { cancelled = true }
  }, [live, orgId])

  // Real users
  const [orgUsers, setOrgUsers] = useState<{ id: string; name: string; email?: string; departmentId?: string; role?: string }[]>([])
  useEffect(() => {
    if (!live) return
    let cancelled = false
    api.users(orgId).then((rows) => {
      if (cancelled || !rows) return
      setOrgUsers(
        (rows as Array<{ id: string; name: string; email?: string; department_id?: string; role?: string }>).map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          departmentId: r.department_id,
          role: r.role,
        }))
      )
    })
    return () => { cancelled = true }
  }, [live, orgId])

  const [scope, setScope] = useState<'all' | string>('all')
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [saved, setSaved] = useState(false)
  const [testingChannel, setTestingChannel] = useState<string | null>(null)

  // Scope: 'Whole Organization' or 'Department' (multi) or 'User' (multi)
  const [applyScope, setApplyScope] = useState<ScopeType>('org')
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState('')

  // Seed default selections when lists load
  useEffect(() => {
    if (orgDepts.length && selectedDeptIds.length === 0) {
      setSelectedDeptIds([orgDepts[0].id])
    }
  }, [orgDepts, selectedDeptIds.length])

  useEffect(() => {
    if (orgUsers.length && selectedUserIds.length === 0) {
      setSelectedUserIds([orgUsers[0].id])
    }
  }, [orgUsers, selectedUserIds.length])

  const toggleDept = (id: string) => {
    setSelectedDeptIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((d) => d !== id) : prev) : [...prev, id]
    )
  }
  const selectAllDepts = () => setSelectedDeptIds(orgDepts.map((d) => d.id))
  const clearDepts = () => { if (orgDepts.length) setSelectedDeptIds([orgDepts[0].id]) }

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((u) => u !== id) : prev) : [...prev, id]
    )
  }
  const selectAllUsers = () => setSelectedUserIds(orgUsers.map((u) => u.id))
  const clearUsers = () => { if (orgUsers.length) setSelectedUserIds([orgUsers[0].id]) }

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return orgUsers
    const q = userSearch.toLowerCase()
    return orgUsers.filter((u) => u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)))
  }, [orgUsers, userSearch])

  // Load channels when applyScope or the primary selected target changes
  useEffect(() => {
    let cancelled = false
    setChannels(defaultNotificationChannels)
    const targetDept = applyScope === 'department' ? (selectedDeptIds[0] || undefined) : undefined
    const targetUser = applyScope === 'user' ? (selectedUserIds[0] || undefined) : undefined

    api.orgChannels(orgId, targetDept, targetUser).then((rows) => {
      if (!cancelled && rows && rows.length > 0) {
        const mapped = defaultNotificationChannels.map((dc) => {
          const row = rows.find((r) => r.channel === dc.id)
          if (row) {
            return {
              ...dc,
              enabled: !!row.enabled,
              target: row.target || '',
              minSeverity: (row.min_severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING') as 'WARNING' | 'CRITICAL',
            }
          }
          return dc
        })
        setChannels(mapped)
      }
    })
    return () => { cancelled = true }
  }, [orgId, applyScope, selectedDeptIds[0], selectedUserIds[0]])

  const toggleChannel = (id: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const setTarget = (id: string, target: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, target } : x)))
  const setMinSeverity = (id: string, minSeverity: 'WARNING' | 'CRITICAL') =>
    setChannels((c) => c.map((x) => (x.id === id ? { ...x, minSeverity } : x)))

  // Formatting exact badges requested by user:
  // EX[3/4 Channels Active (Telegram: ON, Google Chat: ON, Email: ON, LINE: OFF)]
  const activeChannelCount = channels.filter((c) => c.enabled).length
  const tgStatus = channels.find((c) => c.id === 'telegram')?.enabled ? 'ON' : 'OFF'
  const gcStatus = channels.find((c) => c.id === 'googlechat')?.enabled ? 'ON' : 'OFF'
  const emailStatus = channels.find((c) => c.id === 'email')?.enabled ? 'ON' : 'OFF'
  const lineStatus = channels.find((c) => c.id === 'line')?.enabled ? 'ON' : 'OFF'
  const channelsActiveBadge = `${activeChannelCount}/4 Channels Active (Telegram: ${tgStatus}, Google Chat: ${gcStatus}, Email: ${emailStatus}, LINE: ${lineStatus})`

  // Scope summary text
  const scopeSummaryText = useMemo(() => {
    if (applyScope === 'org') return 'Whole Organization'
    if (applyScope === 'department') {
      const count = selectedDeptIds.length
      if (count === orgDepts.length && orgDepts.length > 0) return `All Departments (${count})`
      if (count === 1) {
        return `Department: ${orgDepts.find((d) => d.id === selectedDeptIds[0])?.name ?? '1 Dept'}`
      }
      return `${count} Departments`
    }
    if (applyScope === 'user') {
      const count = selectedUserIds.length
      if (count === orgUsers.length && orgUsers.length > 0) return `All Users (${count})`
      if (count === 1) {
        return `User: ${orgUsers.find((u) => u.id === selectedUserIds[0])?.name ?? '1 User'}`
      }
      return `${count} Users`
    }
    return 'Whole Organization'
  }, [applyScope, selectedDeptIds, selectedUserIds, orgDepts, orgUsers])

  // Save Button dynamic text
  const saveButtonLabel = useMemo(() => {
    if (saved) return 'Channels Saved!'
    if (applyScope === 'org') return 'Save to Whole Organization'
    if (applyScope === 'department') {
      return `Save to ${selectedDeptIds.length} Selected Department${selectedDeptIds.length > 1 ? 's' : ''}`
    }
    if (applyScope === 'user') {
      return `Save to ${selectedUserIds.length} Selected User${selectedUserIds.length > 1 ? 's' : ''}`
    }
    return 'Save Notification Channels'
  }, [saved, applyScope, selectedDeptIds.length, selectedUserIds.length])

  const saveChannels = async () => {
    const user = getSession()
    if (!user) { toast.error('Not signed in'); return }
    if (!isLive()) {
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      toast.success(`Notification channels saved (demo — ${scopeSummaryText})`)
      return
    }

    if (applyScope === 'org') {
      const res = await api.putOrgChannels(orgId, channels)
      if (!res) { toast.error('Could not save channels for organization'); return }
    } else if (applyScope === 'department') {
      if (selectedDeptIds.length === 0) {
        toast.error('Please select at least one department')
        return
      }
      await Promise.all(selectedDeptIds.map((dId) => api.putOrgChannels(orgId, channels, dId)))
    } else if (applyScope === 'user') {
      if (selectedUserIds.length === 0) {
        toast.error('Please select at least one user')
        return
      }
      await Promise.all(selectedUserIds.map((uId) => api.putOrgChannels(orgId, channels, undefined, uId)))
    }

    setSaved(true)
    toast.success(`Channels saved successfully for ${scopeSummaryText}!`)
    setTimeout(() => setSaved(false), 2000)
  }

  const testChannel = async (id: string, target: string) => {
    if (!target) {
      toast.error('Please enter a target ID/URL first')
      return
    }
    setTestingChannel(id)
    try {
      const res = await api.testPlatformChannel(id, target)
      if (res.ok) {
        toast.success(`Test notification sent to ${id.toUpperCase()} successfully!`)
      } else {
        toast.error(`Test failed: ${res.error || 'Verify channel configuration'}`)
      }
    } catch (e: any) {
      toast.error(`Test failed: ${e.message || 'Network error'}`)
    } finally {
      setTestingChannel(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Alarm &amp; Notification Management
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Configure threshold baselines, delivery channels, and SOP notification templates for {orgName}
          </p>
        </div>
        <span className="self-start sm:self-auto text-[11px] px-3 py-1 rounded-full font-bold tracking-wide" style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)' }}>
          ADMIN · ORG &amp; DEPARTMENTS
        </span>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveTab('alarms')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'alarms'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <BellRing size={14} className={activeTab === 'alarms' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Alarm Rules &amp; Thresholds</span>
        </button>

        <button
          onClick={() => setActiveTab('channels')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'channels'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <Send size={14} className={activeTab === 'channels' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Delivery Channels</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {activeChannelCount}/4 Active
          </span>
        </button>

        <button
          onClick={() => setActiveTab('email')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'email'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <Mail size={14} className={activeTab === 'email' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Email &amp; SOP Template</span>
        </button>
      </div>

      {/* TAB 1: Alarm Rules & Thresholds */}
      {activeTab === 'alarms' && (
        <div className="rounded-xl p-5 space-y-4" style={surface}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <BellRing size={16} className="text-indigo-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Alarm Setting &amp; Threshold Engine</h3>
                <p className="text-[11px] text-slate-400">Tuning baseline limits and multi-level application across your fleet</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/80 flex items-center gap-1.5 font-medium">
                <Building2 size={12} className="text-indigo-400" />
                {orgName}
              </span>
              <span className="text-[11px] text-indigo-300 bg-indigo-950/40 px-2.5 py-1 rounded-lg border border-indigo-500/30 flex items-center gap-1.5 font-medium">
                ⚡ Fleet: <strong className="text-white">{devices.length} Devices</strong>
              </span>
              <span className="text-[11px] text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/80 flex items-center gap-1.5 font-medium">
                Profile: <strong className="text-white">{DOMAIN_META[product].platform}</strong>
              </span>
            </div>
          </div>

          <div className="max-w-sm">
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider font-semibold">Apply to device</label>
            <select
              value={scope}
              onChange={(e) => {
                const val = e.target.value
                setScope(val)
                if (val !== 'all') {
                  const dev = devices.find((d) => d.id === val)
                  if (dev?.domain) setProduct(dev.domain)
                }
              }}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            >
              <option value="all">All devices ({devices.length})</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
            </select>
          </div>

          {/* Domain-aware product profile */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider font-semibold">Product alarm profile</label>
            <div className="flex gap-2">
              {orgDomains.map((d) => (
                <button
                  key={d}
                  onClick={() => setProduct(d)}
                  className={clsx('flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all', product === d ? 'text-white' : 'text-slate-400')}
                  style={product === d ? { background: `${DOMAIN_META[d].accent}33`, border: `1px solid ${DOMAIN_META[d].accent}` } : inset}
                >
                  {DOMAIN_META[d].platform}
                </button>
              ))}
            </div>
          </div>

          <AdminBulkApplyAlarmEditor domain={product} orgId={orgId} nodeId={scope !== 'all' ? scope : undefined} />
        </div>
      )}

      {/* TAB 2: Delivery Channels */}
      {activeTab === 'channels' && (
        <div className="rounded-xl p-5 space-y-4" style={surface}>
          {/* Header with explicit Badges */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Send size={15} className="text-indigo-400" />
                Notification Delivery Channels
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Dispatch official alarms to department or organization-wide webhooks, groups, and recipients.
              </p>
            </div>

            {/* Requested Badge: EX[3/4 Channels Active (Telegram: ON, Google Chat: ON, Email: ON, LINE: OFF)] + Scope Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="px-3 py-1.5 rounded-lg font-semibold bg-indigo-950/40 border border-indigo-500/40 text-indigo-300 text-xs shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{channelsActiveBadge}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/80 border border-slate-700/80 text-slate-300 flex items-center gap-1.5 shadow-sm">
                <span className="text-indigo-400 font-bold">Scope:</span>
                <span>{scopeSummaryText}</span>
              </div>
            </div>
          </div>

          {/* Upgraded Multi-Scope Selector (Org / Department / User) */}
          <div className="p-4 rounded-xl border border-slate-800/90 space-y-3.5" style={{ background: '#0a0e1a' }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
              <div>
                <span className="block text-xs font-semibold text-white uppercase tracking-wider">
                  Target Delivery Scope
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Choose whether these notification destinations apply org-wide, to specific departments, or to specific users.
                </p>
              </div>
              <div className="flex items-center gap-1.5 p-1 rounded-lg border border-slate-800 bg-slate-950">
                <button
                  type="button"
                  onClick={() => setApplyScope('org')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                    applyScope === 'org' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white')}
                >
                  <Globe size={13} />
                  <span>Whole Organization</span>
                </button>
                <button
                  type="button"
                  onClick={() => setApplyScope('department')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                    applyScope === 'department' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white')}
                >
                  <Building2 size={13} />
                  <span>Department ({selectedDeptIds.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setApplyScope('user')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                    applyScope === 'user' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white')}
                >
                  <Users size={13} />
                  <span>User ({selectedUserIds.length})</span>
                </button>
              </div>
            </div>

            {/* Scope: Whole Organization Note */}
            {applyScope === 'org' && (
              <p className="text-xs text-slate-400">
                🏢 <strong className="text-slate-300">Whole Organization Scope:</strong> These channels act as the default fallback destinations used for all alarms across every device in {orgName}.
              </p>
            )}

            {/* Scope: Department (Multi-Select) */}
            {applyScope === 'department' && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Select department(s) to apply these channels to:
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={selectAllDepts} className="text-indigo-400 hover:underline">Select All ({orgDepts.length})</button>
                    <span className="text-slate-600">·</span>
                    <button type="button" onClick={clearDepts} className="text-slate-400 hover:underline">Clear</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {orgDepts.map((d) => {
                    const isChecked = selectedDeptIds.includes(d.id)
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDept(d.id)}
                        className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                          isChecked
                            ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-200 shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700')}
                      >
                        <div className={clsx('w-3.5 h-3.5 rounded flex items-center justify-center border',
                          isChecked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-600')}>
                          {isChecked && <Check size={10} strokeWidth={3} />}
                        </div>
                        <span>{d.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Scope: User (Multi-Select with Search) */}
            {applyScope === 'user' && (
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">
                    Select user(s) to apply these channels to:
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Search user…"
                        className="rounded-lg pl-7 pr-2.5 py-1 text-xs text-white placeholder-slate-500 bg-slate-900 border border-slate-700/80 outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button type="button" onClick={selectAllUsers} className="text-indigo-400 hover:underline">Select All ({orgUsers.length})</button>
                      <span className="text-slate-600">·</span>
                      <button type="button" onClick={clearUsers} className="text-slate-400 hover:underline">Clear</button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                  {filteredUsers.map((u) => {
                    const isChecked = selectedUserIds.includes(u.id)
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                          isChecked
                            ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-200 shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700')}
                      >
                        <div className={clsx('w-3.5 h-3.5 rounded flex items-center justify-center border',
                          isChecked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-600')}>
                          {isChecked && <Check size={10} strokeWidth={3} />}
                        </div>
                        <span className="font-semibold text-white">{u.name}</span>
                        {u.email && <span className="text-[10px] text-slate-400">({u.email})</span>}
                        {u.role && <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">{u.role}</span>}
                      </button>
                    )
                  })}
                  {filteredUsers.length === 0 && (
                    <span className="text-xs text-slate-500 italic py-1">No users found matching search.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Channel Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {channels.map((ch) => {
              const Icon = channelIcon[ch.id]
              const isBusy = testingChannel === ch.id
              return (
                <div
                  key={ch.id}
                  className="p-4 rounded-xl space-y-3 transition-all"
                  style={{ background: '#0a0e1a', border: `1px solid ${ch.enabled ? '#6366f1' : '#1e2433'}` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center border', ch.enabled ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-400' : 'bg-slate-900 border-slate-800 text-slate-500')}>
                        <Icon size={16} />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-white block leading-tight">{ch.name}</span>
                        <span className="text-[10px] text-slate-400">{ch.enabled ? 'Enabled' : 'Disabled'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleChannel(ch.id)}
                      className="transition-transform active:scale-95"
                    >
                      {ch.enabled ? <ToggleRight size={26} className="text-indigo-400" /> : <ToggleLeft size={26} className="text-slate-600" />}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        value={ch.target}
                        onChange={(e) => setTarget(ch.id, e.target.value)}
                        disabled={!ch.enabled}
                        placeholder={
                          ch.id === 'telegram' ? 'Numeric Chat ID (e.g. 581234567 or Group -100...)' :
                          ch.id === 'email' ? 'ops@company.com' :
                          ch.id === 'line' ? 'User ID or Token@UserID' :
                          `${ch.name} Webhook URL…`
                        }
                        className={clsx('flex-1 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-indigo-500', ch.enabled ? 'text-white' : 'text-slate-600')}
                        style={{ background: '#0d1117', border: '1px solid #1e2433' }}
                      />
                      <button
                        type="button"
                        disabled={!ch.enabled || !ch.target.trim() || isBusy}
                        onClick={() => testChannel(ch.id, ch.target)}
                        className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:hover:bg-slate-800 flex items-center gap-1.5 border border-slate-700/80 shrink-0 transition-colors shadow-sm"
                        title="Send test message to this destination"
                      >
                        {isBusy ? <Loader2 size={13} className="animate-spin text-indigo-400" /> : <Send size={13} className="text-indigo-400" />}
                        <span>{isBusy ? 'Testing…' : 'Test'}</span>
                      </button>
                    </div>

                    {ch.id === 'telegram' && (
                      <p className="text-[10px] text-slate-500">
                        💡 ใส่เลข <code>Chat ID</code> หรือ <code>Group ID (-100...)</code> ไม่ใช่ @botname
                      </p>
                    )}
                  </div>

                  {/* Severity Routing */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Send Alert On</span>
                    <div className="flex items-center gap-1.5">
                      {(['WARNING', 'CRITICAL'] as const).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setMinSeverity(ch.id, sev)}
                          disabled={!ch.enabled}
                          className={clsx('px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all disabled:opacity-40',
                            (ch.minSeverity ?? 'WARNING') === sev ? 'text-white shadow-sm' : 'text-slate-400 hover:text-slate-300')}
                          style={(ch.minSeverity ?? 'WARNING') === sev
                            ? { background: sev === 'CRITICAL' ? 'rgba(239,68,68,0.25)' : 'rgba(251,191,36,0.25)', border: `1px solid ${sev === 'CRITICAL' ? '#ef4444' : '#f59e0b'}` }
                            : { background: '#0d1117', border: '1px solid #1e2433' }}
                        >
                          {sev === 'WARNING' ? 'Warning +' : 'Critical only'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Dedicated card footer with dynamic Save button and Scope summary */}
          <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 mt-2">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <span>Target Scope: <strong className="text-slate-200">{scopeSummaryText}</strong></span>
            </span>
            <button
              onClick={saveChannels}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-md active:scale-95"
              style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' } : gradient}
            >
              <Save size={14} /> {saveButtonLabel}
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: Email & SOP Template */}
      {activeTab === 'email' && (
        <div className="space-y-4">
          <EmailTemplateConfigurator orgId={orgId} orgName={orgName} />
        </div>
      )}

      {/* Helpful shortcut footer to Event Catalog */}
      <div className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-800/60" style={inset}>
        <div className="flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-indigo-400 shrink-0" />
          <p className="text-xs text-slate-400">
            Looking for <strong className="text-slate-200">Incident Problem Categories</strong>? Manage per-department problem tags centrally in the User Management portal.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
        >
          <span>Open Event Catalog</span>
          <ExternalLink size={12} />
        </Link>
      </div>
    </div>
  )
}


