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
  Settings2,
  X,
  Copy,
  Layers,
  Sparkles,
  RotateCcw,
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

interface RawChannelRow {
  id: number
  channel: string
  target: string | null
  min_severity: string
  enabled: number
  department_id?: string | null
  user_id?: string | null
}

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

  // Global Org Fallback channels
  const [orgChannels, setOrgChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [orgSaved, setOrgSaved] = useState(false)
  const [testingChannel, setTestingChannel] = useState<string | null>(null)

  // All channel records across the whole org
  const [allOrgChannels, setAllOrgChannels] = useState<RawChannelRow[]>([])

  const reloadAllChannels = () => {
    if (!live) return
    api.orgChannels(orgId, undefined, undefined, true).then((rows) => {
      if (rows) setAllOrgChannels(rows)
    })
  }

  useEffect(() => {
    reloadAllChannels()
  }, [live, orgId])

  // Load Org-Wide Fallback channels
  useEffect(() => {
    let cancelled = false
    api.orgChannels(orgId).then((rows) => {
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
        setOrgChannels(mapped)
      }
    })
    return () => { cancelled = true }
  }, [orgId])

  // Active Scope View: 'org' | 'department' | 'user'
  const [deliveryScope, setDeliveryScope] = useState<ScopeType>('org')
  const [userSearch, setUserSearch] = useState('')
  const [deptSearch, setDeptSearch] = useState('')

  // Modal Editing State (Direct single-entity inspection & configuration)
  const [modalEntity, setModalEntity] = useState<{
    type: 'department' | 'user'
    id: string
    name: string
    subtitle?: string
  } | null>(null)
  const [modalChannels, setModalChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [modalSaving, setModalSaving] = useState(false)
  const [modalSaved, setModalSaved] = useState(false)
  const [modalHasCustom, setModalHasCustom] = useState(false)
  const [modalTestingChannel, setModalTestingChannel] = useState<string | null>(null)

  // Bulk Apply / Clone Modal State
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkType, setBulkType] = useState<'department' | 'user'>('department')
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([])
  const [bulkSource, setBulkSource] = useState<'org' | string>('org')
  const [bulkApplying, setBulkApplying] = useState(false)

  const openConfigModal = async (type: 'department' | 'user', id: string, name: string, subtitle?: string) => {
    setModalEntity({ type, id, name, subtitle })
    setModalSaved(false)

    // Check if we already have it in allOrgChannels
    const matching = allOrgChannels.filter((c) =>
      type === 'department' ? (c.department_id === id && (!c.user_id || c.user_id === '')) : (c.user_id === id)
    )

    if (matching.length > 0) {
      setModalHasCustom(true)
      setModalChannels(
        defaultNotificationChannels.map((dc) => {
          const row = matching.find((r) => r.channel === dc.id)
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
      )
    } else {
      // Fetch fresh
      const rows = await api.orgChannels(orgId, type === 'department' ? id : undefined, type === 'user' ? id : undefined)
      if (rows && rows.length > 0) {
        setModalHasCustom(true)
        setModalChannels(
          defaultNotificationChannels.map((dc) => {
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
        )
      } else {
        setModalHasCustom(false)
        setModalChannels(defaultNotificationChannels)
      }
    }
  }

  const revertToOrgFallback = async () => {
    if (!modalEntity) return
    const isDept = modalEntity.type === 'department'
    const confirm = window.confirm(
      `Revert ${modalEntity.name} to Organization Fallback?\n\nThis will remove all custom channels for this ${isDept ? 'department' : 'user'}, and it will immediately follow the organization-wide fallback destinations.`
    )
    if (!confirm) return
    setModalSaving(true)
    try {
      await api.putOrgChannels(
        orgId,
        [],
        isDept ? modalEntity.id : undefined,
        !isDept ? modalEntity.id : undefined
      )
      toast.success(`Reverted ${modalEntity.name} to Organization Fallback!`)
      reloadAllChannels()
      setModalEntity(null)
    } catch (e: any) {
      toast.error(e.message || 'Failed to revert to fallback')
    } finally {
      setModalSaving(false)
    }
  }

  const saveModalChannels = async () => {
    if (!modalEntity) return
    setModalSaving(true)
    try {
      const res = await api.putOrgChannels(
        orgId,
        modalChannels,
        modalEntity.type === 'department' ? modalEntity.id : undefined,
        modalEntity.type === 'user' ? modalEntity.id : undefined
      )
      if (!res) throw new Error('Could not save channels')
      setModalSaved(true)
      toast.success(`Channels saved for ${modalEntity.name}!`)
      reloadAllChannels()
      setTimeout(() => {
        setModalSaved(false)
        setModalEntity(null)
      }, 1000)
    } catch (e: any) {
      toast.error(e.message || 'Failed to save channels')
    } finally {
      setModalSaving(false)
    }
  }

  // Quick test channel runner
  const executeTest = async (channelId: string, target: string, setTesting: (id: string | null) => void) => {
    if (!target.trim()) {
      toast.error('Please enter a target Chat ID/URL/Email first')
      return
    }
    setTesting(channelId)
    try {
      const res = await api.testPlatformChannel(channelId, target)
      if (res.ok) {
        toast.success(`Test sent to ${channelId.toUpperCase()} successfully!`)
      } else {
        toast.error(`Test failed: ${res.error || 'Check configuration'}`)
      }
    } catch (e: any) {
      toast.error(`Test failed: ${e.message || 'Network error'}`)
    } finally {
      setTesting(null)
    }
  }

  // Save Org Fallback channels
  const saveOrgChannels = async () => {
    const user = getSession()
    if (!user) { toast.error('Not signed in'); return }
    if (!isLive()) {
      setOrgSaved(true); setTimeout(() => setOrgSaved(false), 2000)
      toast.success('Notification preferences saved (demo — not persisted)')
      return
    }
    const res = await api.putOrgChannels(orgId, orgChannels)
    if (!res) { toast.error('Could not save organization fallback channels'); return }
    setOrgSaved(true)
    toast.success('Organization-wide notification fallback saved successfully!')
    reloadAllChannels()
    setTimeout(() => setOrgSaved(false), 2000)
  }

  // Bulk Apply Logic
  const handleBulkApply = async () => {
    if (bulkSelectedIds.length === 0) {
      toast.error('Please select at least one target')
      return
    }
    setBulkApplying(true)
    try {
      // Find template channels
      let template: NotificationChannelConfig[] = orgChannels
      if (bulkSource !== 'org') {
        const rows = allOrgChannels.filter((c) =>
          bulkType === 'department'
            ? (c.department_id === bulkSource && (!c.user_id || c.user_id === ''))
            : (c.user_id === bulkSource)
        )
        if (rows.length > 0) {
          template = defaultNotificationChannels.map((dc) => {
            const r = rows.find((x) => x.channel === dc.id)
            if (r) return { ...dc, enabled: !!r.enabled, target: r.target || '', minSeverity: (r.min_severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING') as 'WARNING' | 'CRITICAL' }
            return dc
          })
        }
      }

      // Concurrently apply to all selected targets
      await Promise.all(
        bulkSelectedIds.map((id) =>
          api.putOrgChannels(
            orgId,
            template,
            bulkType === 'department' ? id : undefined,
            bulkType === 'user' ? id : undefined
          )
        )
      )

      toast.success(`Successfully applied channels to ${bulkSelectedIds.length} ${bulkType}s!`)
      reloadAllChannels()
      setBulkModalOpen(false)
      setBulkSelectedIds([])
    } catch (e: any) {
      toast.error(e.message || 'Bulk apply encountered an error')
    } finally {
      setBulkApplying(false)
    }
  }

  // Compute Active Channels Summary string requested by user:
  // EX[3/4 Channels Active (Telegram: ON, Google Chat: ON, Email: ON, LINE: OFF)]
  const activeOrgCount = orgChannels.filter((c) => c.enabled).length
  const tgOrgStatus = orgChannels.find((c) => c.id === 'telegram')?.enabled ? 'ON' : 'OFF'
  const gcOrgStatus = orgChannels.find((c) => c.id === 'googlechat')?.enabled ? 'ON' : 'OFF'
  const emailOrgStatus = orgChannels.find((c) => c.id === 'email')?.enabled ? 'ON' : 'OFF'
  const lineOrgStatus = orgChannels.find((c) => c.id === 'line')?.enabled ? 'ON' : 'OFF'
  const orgActiveChannelsBadge = `${activeOrgCount}/4 Channels Active (Telegram: ${tgOrgStatus}, Google Chat: ${gcOrgStatus}, Email: ${emailOrgStatus}, LINE: ${lineOrgStatus})`

  // Modal active channels summary
  const activeModalCount = modalChannels.filter((c) => c.enabled).length
  const tgModalStatus = modalChannels.find((c) => c.id === 'telegram')?.enabled ? 'ON' : 'OFF'
  const gcModalStatus = modalChannels.find((c) => c.id === 'googlechat')?.enabled ? 'ON' : 'OFF'
  const emailModalStatus = modalChannels.find((c) => c.id === 'email')?.enabled ? 'ON' : 'OFF'
  const lineModalStatus = modalChannels.find((c) => c.id === 'line')?.enabled ? 'ON' : 'OFF'
  const modalActiveChannelsBadge = `${activeModalCount}/4 Channels Active (Telegram: ${tgModalStatus}, Google Chat: ${gcModalStatus}, Email: ${emailModalStatus}, LINE: ${lineModalStatus})`

  // Filtered lists
  const filteredDepts = useMemo(() => {
    if (!deptSearch.trim()) return orgDepts
    return orgDepts.filter((d) => d.name.toLowerCase().includes(deptSearch.toLowerCase()))
  }, [orgDepts, deptSearch])

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return orgUsers
    const q = userSearch.toLowerCase()
    return orgUsers.filter((u) => u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)))
  }, [orgUsers, userSearch])

  // Count configured entities
  const configuredDeptIds = useMemo(() => {
    return new Set(allOrgChannels.filter((c) => c.department_id && (!c.user_id || c.user_id === '') && c.enabled).map((c) => c.department_id as string))
  }, [allOrgChannels])

  const configuredUserIds = useMemo(() => {
    return new Set(allOrgChannels.filter((c) => c.user_id && c.enabled).map((c) => c.user_id as string))
  }, [allOrgChannels])

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
            {activeOrgCount}/4 Active
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
        <div className="rounded-xl p-5 space-y-5" style={surface}>
          {/* Card Header with Scope Switcher & Exact Format Badge */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Send size={15} className="text-indigo-400" />
                Notification Delivery Channels
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Dispatch official alarms across organization fallbacks, specialized departments, or assigned individual users.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* User requested exact badge format */}
              <div className="px-3 py-1.5 rounded-lg font-semibold bg-indigo-950/40 border border-indigo-500/40 text-indigo-300 text-xs shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{orgActiveChannelsBadge}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/80 border border-slate-700/80 text-slate-300 flex items-center gap-1.5 shadow-sm">
                <span className="text-indigo-400 font-bold">Scope:</span>
                <span>
                  {deliveryScope === 'org'
                    ? 'Whole Organization'
                    : deliveryScope === 'department'
                    ? `Department (${orgDepts.length} total)`
                    : `User (${orgUsers.length} total)`}
                </span>
              </div>
            </div>
          </div>

          {/* Scope Selector Segmented Control */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl border border-slate-800/80 bg-slate-950">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDeliveryScope('org')}
                className={clsx(
                  'flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all',
                  deliveryScope === 'org'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                )}
              >
                <Globe size={14} />
                <span>Whole Organization (Fallback)</span>
              </button>

              <button
                type="button"
                onClick={() => setDeliveryScope('department')}
                className={clsx(
                  'flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all',
                  deliveryScope === 'department'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                )}
              >
                <Building2 size={14} />
                <span>Departments ({orgDepts.length})</span>
                {configuredDeptIds.size > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {configuredDeptIds.size} Custom
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setDeliveryScope('user')}
                className={clsx(
                  'flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all',
                  deliveryScope === 'user'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                )}
              >
                <Users size={14} />
                <span>Users ({orgUsers.length})</span>
                {configuredUserIds.size > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {configuredUserIds.size} Custom
                  </span>
                )}
              </button>
            </div>

            {/* Bulk Clone Tool Trigger */}
            {deliveryScope !== 'org' && (
              <button
                type="button"
                onClick={() => {
                  setBulkType(deliveryScope === 'department' ? 'department' : 'user')
                  setBulkSelectedIds([])
                  setBulkSource('org')
                  setBulkModalOpen(true)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 transition-colors shadow-sm"
              >
                <Layers size={13} />
                <span>Bulk Copy Setup…</span>
              </button>
            )}
          </div>

          {/* VIEW 1: Whole Organization Scope */}
          {deliveryScope === 'org' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-indigo-500/20 bg-indigo-950/20 flex items-start gap-3">
                <Sparkles size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-200/90 leading-relaxed">
                  These 4 channels serve as the <strong className="text-white">Organization Fallback</strong>. Any device alarm whose owning department does not have its own custom channels configured will automatically be delivered here.
                </p>
              </div>

              {/* 4 Channel Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {orgChannels.map((ch) => {
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
                          onClick={() => setOrgChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, enabled: !x.enabled } : x)))}
                          className="transition-transform active:scale-95"
                        >
                          {ch.enabled ? <ToggleRight size={26} className="text-indigo-400" /> : <ToggleLeft size={26} className="text-slate-600" />}
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            value={ch.target}
                            onChange={(e) => setOrgChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, target: e.target.value } : x)))}
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
                            onClick={() => executeTest(ch.id, ch.target, setTestingChannel)}
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
                              onClick={() => setOrgChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, minSeverity: sev } : x)))}
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

              {/* Dedicated Footer */}
              <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 mt-2">
                <span className="text-xs text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                  <span>Target Scope: <strong className="text-slate-200">Whole Organization (Global Fallback)</strong></span>
                </span>
                <button
                  onClick={saveOrgChannels}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-md active:scale-95"
                  style={orgSaved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' } : gradient}
                >
                  <Save size={14} /> {orgSaved ? 'Channels Saved!' : 'Save to Whole Organization'}
                </button>
              </div>
            </div>
          )}

          {/* VIEW 2: Departments Overview & Direct Modal Config */}
          {deliveryScope === 'department' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Each department can have its own dedicated Telegram Group, LINE Bot, or Email recipients.
                </p>
                <div className="relative w-full sm:w-64">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={deptSearch}
                    onChange={(e) => setDeptSearch(e.target.value)}
                    placeholder="Search department…"
                    className="w-full rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 bg-slate-900 border border-slate-700/80 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Department Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredDepts.map((d) => {
                  const customRows = allOrgChannels.filter((c) => c.department_id === d.id && (!c.user_id || c.user_id === ''))
                  const enabledRows = customRows.filter((c) => c.enabled)
                  const hasCustom = enabledRows.length > 0

                  return (
                    <div
                      key={d.id}
                      className="p-4 rounded-xl space-y-3 border transition-all"
                      style={{ background: '#0a0e1a', borderColor: hasCustom ? '#3b82f6' : '#1e2433' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-950/60 border border-indigo-500/40 text-indigo-400 shrink-0">
                            <Building2 size={16} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-white leading-tight">{d.name}</h4>
                            <span className="text-[10px] text-slate-500">ID: {d.id}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openConfigModal('department', d.id, d.name, `Department ID: ${d.id}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition-colors shadow-sm shrink-0"
                        >
                          <Settings2 size={13} />
                          <span>Configure</span>
                        </button>
                      </div>

                      {/* Configured Status Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/60">
                        {hasCustom ? (
                          enabledRows.map((r) => {
                            const Icon = channelIcon[r.channel as keyof typeof channelIcon] || Send
                            return (
                              <span
                                key={r.id}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-950/40 border border-indigo-500/40 text-indigo-300 flex items-center gap-1"
                              >
                                <Icon size={10} />
                                <span className="font-semibold uppercase">{r.channel}:</span>
                                <span className="truncate max-w-[120px]">{r.target || 'Default'}</span>
                                <span className="text-[8px] opacity-75">({r.min_severity})</span>
                              </span>
                            )
                          })
                        ) : (
                          <span className="text-[11px] text-slate-500 italic flex items-center gap-1">
                            <Globe size={11} className="text-slate-600" />
                            Inheriting Organization Fallback Destinations
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* VIEW 3: Users Overview & Direct Modal Config */}
          {deliveryScope === 'user' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Assign official device alarms directly to individual user accounts without affecting their personal alert rules.
                </p>
                <div className="relative w-full sm:w-64">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search user by name or email…"
                    className="w-full rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 bg-slate-900 border border-slate-700/80 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Users Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredUsers.map((u) => {
                  const customRows = allOrgChannels.filter((c) => c.user_id === u.id)
                  const enabledRows = customRows.filter((c) => c.enabled)
                  const hasCustom = enabledRows.length > 0
                  const deptName = orgDepts.find((d) => d.id === u.departmentId)?.name || 'General'

                  return (
                    <div
                      key={u.id}
                      className="p-4 rounded-xl space-y-3 border transition-all"
                      style={{ background: '#0a0e1a', borderColor: hasCustom ? '#8b5cf6' : '#1e2433' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-950/60 border border-purple-500/40 text-purple-400 shrink-0">
                            <Users size={16} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-white leading-tight">{u.name}</h4>
                              {u.role && (
                                <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-bold bg-slate-800 text-slate-400">
                                  {u.role}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400">{u.email || u.id} · {deptName}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openConfigModal('user', u.id, u.name, `${u.email || u.id} (${deptName})`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 transition-colors shadow-sm shrink-0"
                        >
                          <Settings2 size={13} />
                          <span>Configure</span>
                        </button>
                      </div>

                      {/* Configured Status Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/60">
                        {hasCustom ? (
                          enabledRows.map((r) => {
                            const Icon = channelIcon[r.channel as keyof typeof channelIcon] || Send
                            return (
                              <span
                                key={r.id}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/40 border border-purple-500/40 text-purple-300 flex items-center gap-1"
                              >
                                <Icon size={10} />
                                <span className="font-semibold uppercase">{r.channel}:</span>
                                <span className="truncate max-w-[120px]">{r.target || 'Configured'}</span>
                              </span>
                            )
                          })
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">
                            No dedicated channels configured (receives alerts via department or org fallback)
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Email & SOP Template */}
      {activeTab === 'email' && (
        <div className="space-y-4">
          <EmailTemplateConfigurator orgId={orgId} orgName={orgName} />
        </div>
      )}

      {/* MODAL 1: Single Entity Configuration Modal (Best Practice) */}
      {modalEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-800 shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            style={{ background: '#0d1117' }}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">
                    Configure Notification Channels
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                    {modalEntity.type}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Target: <strong className="text-white">{modalEntity.name}</strong> {modalEntity.subtitle && `(${modalEntity.subtitle})`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setModalEntity(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Sub-Header Badges */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-indigo-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{modalActiveChannelsBadge}</span>
                {modalHasCustom ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Custom Override
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                    Inheriting Org Fallback
                  </span>
                )}
              </div>

              {modalHasCustom && (
                <button
                  type="button"
                  onClick={revertToOrgFallback}
                  disabled={modalSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40 transition-colors shadow-sm disabled:opacity-50"
                  title="Remove custom channels for this entity and revert to organization fallback"
                >
                  <RotateCcw size={12} />
                  <span>Revert to Org Fallback</span>
                </button>
              )}
            </div>

            {/* Modal 4 Channel Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modalChannels.map((ch) => {
                const Icon = channelIcon[ch.id]
                const isBusy = modalTestingChannel === ch.id
                const orgCh = orgChannels.find((x) => x.id === ch.id)
                const orgHint = orgCh?.enabled && orgCh?.target ? `Default: ${orgCh.target} (Org Fallback)` : ''

                return (
                  <div
                    key={ch.id}
                    className="p-3.5 rounded-xl space-y-2.5 transition-all"
                    style={{ background: '#0a0e1a', border: `1px solid ${ch.enabled ? '#6366f1' : '#1e2433'}` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={ch.enabled ? 'text-indigo-400' : 'text-slate-500'} />
                        <span className="text-xs font-semibold text-white">{ch.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setModalChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, enabled: !x.enabled } : x)))}
                      >
                        {ch.enabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}
                      </button>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          value={ch.target}
                          onChange={(e) => setModalChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, target: e.target.value } : x)))}
                          disabled={!ch.enabled}
                          placeholder={
                            orgHint || (
                              ch.id === 'telegram' ? 'Chat ID / Group -100...' :
                              ch.id === 'email' ? 'team@company.com' :
                              ch.id === 'line' ? 'User ID or Token@UserID' :
                              'Webhook URL…'
                            )
                          }
                          className={clsx('flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500', ch.enabled ? 'text-white' : 'text-slate-600')}
                          style={{ background: '#0d1117', border: '1px solid #1e2433' }}
                        />
                        <button
                          type="button"
                          disabled={!ch.enabled || !ch.target.trim() || isBusy}
                          onClick={() => executeTest(ch.id, ch.target, setModalTestingChannel)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 flex items-center gap-1 border border-slate-700 shrink-0"
                        >
                          {isBusy ? <Loader2 size={11} className="animate-spin text-indigo-400" /> : <Send size={11} className="text-indigo-400" />}
                          <span>{isBusy ? 'Testing…' : 'Test'}</span>
                        </button>
                      </div>

                      {orgHint && !ch.target.trim() && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Globe size={10} className="text-slate-600 shrink-0" />
                          <span className="truncate">{orgHint}</span>
                        </p>
                      )}
                    </div>

                    {/* Min Severity */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                      <span className="text-slate-400">Severity</span>
                      <div className="flex items-center gap-1">
                        {(['WARNING', 'CRITICAL'] as const).map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setModalChannels((prev) => prev.map((x) => (x.id === ch.id ? { ...x, minSeverity: sev } : x)))}
                            disabled={!ch.enabled}
                            className={clsx('px-2 py-0.5 rounded text-[9px] font-semibold transition-all disabled:opacity-40',
                              (ch.minSeverity ?? 'WARNING') === sev ? 'text-white' : 'text-slate-400')}
                            style={(ch.minSeverity ?? 'WARNING') === sev
                              ? { background: sev === 'CRITICAL' ? 'rgba(239,68,68,0.3)' : 'rgba(251,191,36,0.3)', border: `1px solid ${sev === 'CRITICAL' ? '#ef4444' : '#f59e0b'}` }
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

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setModalEntity(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveModalChannels}
                disabled={modalSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
                style={modalSaved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' } : gradient}
              >
                {modalSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>{modalSaved ? 'Saved!' : `Save Channels for ${modalEntity.name}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Bulk Copy / Apply Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-800 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            style={{ background: '#0d1117' }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers size={16} className="text-indigo-400" />
                  Bulk Copy Channel Configuration
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Clone a source channel setup to multiple selected {bulkType}s at once.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Source Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                1. Select Source Template
              </label>
              <select
                value={bulkSource}
                onChange={(e) => setBulkSource(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs text-white bg-slate-900 border border-slate-700 outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="org">Organization Fallback Destinations</option>
                {bulkType === 'department'
                  ? orgDepts.map((d) => <option key={d.id} value={d.id}>Department: {d.name}</option>)
                  : orgUsers.map((u) => <option key={u.id} value={u.id}>User: {u.name}</option>)}
              </select>
            </div>

            {/* Target Multi-Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  2. Select Target {bulkType === 'department' ? 'Departments' : 'Users'} ({bulkSelectedIds.length} selected)
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setBulkSelectedIds((bulkType === 'department' ? orgDepts : orgUsers).map((x) => x.id))}
                    className="text-indigo-400 hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => setBulkSelectedIds([])}
                    className="text-slate-400 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 rounded-xl bg-slate-950 border border-slate-800">
                {(bulkType === 'department' ? orgDepts : orgUsers).map((item) => {
                  const isChecked = bulkSelectedIds.includes(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setBulkSelectedIds((prev) =>
                          prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]
                        )
                      }
                      className={clsx(
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                        isChecked
                          ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      )}
                    >
                      <div className={clsx('w-3.5 h-3.5 rounded flex items-center justify-center border', isChecked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-600')}>
                        {isChecked && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span>{item.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Bulk Footer */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkApply}
                disabled={bulkApplying || bulkSelectedIds.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
                style={gradient}
              >
                {bulkApplying ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Apply to {bulkSelectedIds.length} {bulkType === 'department' ? 'Departments' : 'Users'}</span>
              </button>
            </div>
          </div>
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



