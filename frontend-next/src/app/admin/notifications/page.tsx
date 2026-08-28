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
import { getSession, useSessionRole } from '@/lib/auth'
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
  Activity,
  Clock,
  PauseCircle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  CheckCircle,
  Zap,
  AlertOctagon,
  HelpCircle,
  Plus,
  Volume2,
  VolumeX,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useAudioChimeStore } from '@/lib/audioChimeStore'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const channelIcon = {
  email: Mail,
  line: MessageCircle,
  telegram: Send,
  googlechat: MessagesSquare,
  webhook: Globe,
} as const

type TabKey = 'alarms' | 'channels' | 'escalation' | 'shelving' | 'email' | 'chime'
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
  const role = useSessionRole()
  const isSuperadmin = role === 'superadmin'

  const [chimeTargetOrgId, setChimeTargetOrgId] = useState<string>(orgId)
  useEffect(() => {
    setChimeTargetOrgId(orgId)
  }, [orgId])

  const activeChimeOrgId = isSuperadmin ? chimeTargetOrgId : orgId
  const activeChimeOrgName = orgNames[activeChimeOrgId] || activeChimeOrgId
  const { getSettingsForOrg, updateOrgSettings, playChime, applyToAllOrgs } = useAudioChimeStore()
  const chimeSettings = getSettingsForOrg(activeChimeOrgId)

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
  const webhookOrgStatus = orgChannels.find((c) => c.id === 'webhook')?.enabled ? 'ON' : 'OFF'
  const orgActiveChannelsBadge = `${activeOrgCount}/5 Channels Active (Telegram: ${tgOrgStatus}, Google Chat: ${gcOrgStatus}, Email: ${emailOrgStatus}, LINE: ${lineOrgStatus}, Webhook: ${webhookOrgStatus})`

  // Modal active channels summary
  const activeModalCount = modalChannels.filter((c) => c.enabled).length
  const tgModalStatus = modalChannels.find((c) => c.id === 'telegram')?.enabled ? 'ON' : 'OFF'
  const gcModalStatus = modalChannels.find((c) => c.id === 'googlechat')?.enabled ? 'ON' : 'OFF'
  const emailModalStatus = modalChannels.find((c) => c.id === 'email')?.enabled ? 'ON' : 'OFF'
  const lineModalStatus = modalChannels.find((c) => c.id === 'line')?.enabled ? 'ON' : 'OFF'
  const webhookModalStatus = modalChannels.find((c) => c.id === 'webhook')?.enabled ? 'ON' : 'OFF'
  const modalActiveChannelsBadge = `${activeModalCount}/5 Channels Active (Telegram: ${tgModalStatus}, Google Chat: ${gcModalStatus}, Email: ${emailModalStatus}, LINE: ${lineModalStatus}, Webhook: ${webhookModalStatus})`

  // Escalation Matrix State (ISA-18.2 §11)
  const [escalationEnabled, setEscalationEnabled] = useState(true)
  const [escalationTimeoutMins, setEscalationTimeoutMins] = useState(30)
  const [escalationCustomNote, setEscalationCustomNote] = useState(
    'ESCALATION ALERT: Critical incident on asset has remained unacknowledged past timeout threshold. Paging duty supervisor.'
  )

  // Maintenance Shelving State (ISA-18.2 §12)
  const [shelvedDevices, setShelvedDevices] = useState([
    {
      nodeId: 'TRF-SUBSTATION-02',
      name: 'Main Substation TR-02',
      paramKey: 'oilTemp',
      paramLabel: 'Top Oil Temperature',
      reason: 'WO-8491 Bushing replacement & oil degassing',
      shelvedBy: 'Somchai (Lead Electrical Engineer)',
      shelvedAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 7 * 3600000).toISOString(),
      active: true,
    },
  ])
  const [shelveModalOpen, setShelveModalOpen] = useState(false)
  const [newShelveNodeId, setNewShelveNodeId] = useState('')
  const [newShelveDurationHours, setNewShelveDurationHours] = useState(8)
  const [newShelveReason, setNewShelveReason] = useState('')

  const handleUnshelve = (nodeId: string) => {
    setShelvedDevices((prev) => prev.filter((d) => d.nodeId !== nodeId))
    toast.success(`Restored alarm monitoring for ${nodeId}!`, { icon: '🔔' })
  }

  const handleAddShelve = () => {
    if (!newShelveNodeId) {
      toast.error('Select an asset to shelve')
      return
    }
    if (!newShelveReason.trim()) {
      toast.error('Enter a maintenance work order / reason')
      return
    }
    const dev = devices.find((d) => d.id === newShelveNodeId)
    setShelvedDevices((prev) => [
      ...prev,
      {
        nodeId: newShelveNodeId,
        name: dev?.name || newShelveNodeId,
        paramKey: 'all',
        paramLabel: 'All Threshold Alarms',
        reason: newShelveReason.trim(),
        shelvedBy: 'Admin Operator',
        shelvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + newShelveDurationHours * 3600000).toISOString(),
        active: true,
      },
    ])
    setShelveModalOpen(false)
    setNewShelveReason('')
    toast.success(`Silenced alarms for ${dev?.name || newShelveNodeId} for ${newShelveDurationHours} hours`, { icon: '⏸️' })
  }

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

      {/* ========================================================================= */}
      {/* EEMUA 191 / ISA-18.2 ALARM RATIONALIZATION & FLEET HEALTH BENCHMARK BAR  */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Alarm Rate</span>
            <Activity size={13} className="text-emerald-400" />
          </div>
          <div className="text-lg font-black text-emerald-400">
            1.8 <span className="text-xs text-slate-500 font-normal">/ hr</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate" title="EEMUA 191 Target: < 6 alarms/hour per operator console">
            EEMUA 191: &lt; 6.0 / hr (Normal)
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Chattering Alarms</span>
            <ShieldCheck size={13} className="text-indigo-400" />
          </div>
          <div className="text-lg font-black text-white">
            0 <span className="text-xs text-slate-500 font-normal">detected</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            Deadband filter active
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Avg Acknowledge (MTTA)</span>
            <Clock size={13} className="text-amber-400" />
          </div>
          <div className="text-lg font-black text-white">
            3.8 <span className="text-xs text-slate-500 font-normal">mins</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            Target &lt; 15.0 mins
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0d1117]/90 space-y-1">
          <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
            <span>Maintenance Shelved</span>
            <PauseCircle size={13} className="text-blue-400" />
          </div>
          <div className="text-lg font-black text-blue-400">
            {shelvedDevices.length} <span className="text-xs text-slate-500 font-normal">assets</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            Temporary silent mode
          </div>
        </div>

        <div className="col-span-2 md:col-span-1 p-3.5 rounded-xl border border-emerald-900/40 bg-emerald-950/20 space-y-1 flex flex-col justify-center">
          <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>ISA-18.2 Status</span>
          </div>
          <div className="text-xs font-black text-white">
            HEALTHY FLEET
          </div>
          <div className="text-[10px] text-emerald-300/80 leading-tight">
            No alarm flooding or storm
          </div>
        </div>
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
            {activeOrgCount}/5 Active
          </span>
        </button>

        <button
          onClick={() => setActiveTab('escalation')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'escalation'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <Zap size={14} className={activeTab === 'escalation' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Escalation Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('shelving')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'shelving'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <PauseCircle size={14} className={activeTab === 'shelving' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Maintenance Shelving</span>
          {shelvedDevices.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {shelvedDevices.length} Silenced
            </span>
          )}
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

        <button
          onClick={() => setActiveTab('chime')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer',
            activeTab === 'chime'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <Volume2 size={14} className={activeTab === 'chime' ? 'text-purple-400' : 'text-slate-500'} />
          <span>Web Audio Chime</span>
          <span className={clsx(
            'px-2 py-0.5 rounded-full text-[10px] font-bold border',
            chimeSettings.enabled
              ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
              : 'bg-slate-800 text-slate-500 border-slate-700'
          )}>
            {chimeSettings.enabled ? 'ON' : 'MUTE'}
          </span>
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

          <AdminBulkApplyAlarmEditor domain={product} orgId={orgId} />
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
                  These 5 channels serve as the <strong className="text-white">Organization Fallback</strong>. Any device alarm whose owning department does not have its own custom channels configured will automatically be delivered here.
                </p>
              </div>

              {/* 5 Channel Cards Grid */}
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
                              ch.id === 'webhook' ? 'https://hooks.pagerduty.com/... or https://service.corp/webhook' :
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

      {/* TAB 3: Time-Based Alarm Escalation Matrix (ISA-18.2 §11) */}
      {activeTab === 'escalation' && (
        <div className="rounded-xl p-5 space-y-6" style={surface}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Zap size={17} className="text-amber-400" />
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  ISA-18.2 Time-Based Alarm Escalation Protocol
                </h3>
                <p className="text-xs text-slate-400">
                  Automatically escalate unacknowledged CRITICAL alarms to plant management and emergency channels.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Auto-Escalation:</span>
              <button
                type="button"
                onClick={() => {
                  setEscalationEnabled(!escalationEnabled)
                  toast.success(`Escalation protocol ${!escalationEnabled ? 'ENABLED' : 'DISABLED'}`)
                }}
                className="transition-transform active:scale-95"
              >
                {escalationEnabled ? (
                  <ToggleRight size={28} className="text-emerald-400" />
                ) : (
                  <ToggleLeft size={28} className="text-slate-600" />
                )}
              </button>
            </div>
          </div>

          {/* Visual Escalation Ladder Flowchart */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 1 */}
            <div className="p-4 rounded-xl border border-indigo-500/30 bg-[#0a0e1a] space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  LEVEL 1 · T=0m
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Immediate</span>
              </div>
              <h4 className="text-xs font-bold text-white">Department On-Call Dispatch</h4>
              <p className="text-[11px] text-slate-400 leading-snug">
                Alarm is dispatched instantaneously to owning department&apos;s Telegram, LINE, Google Chat, Webhook &amp; Email.
              </p>
              <div className="pt-2 text-[10px] text-slate-500 border-t border-slate-800/80 flex items-center gap-1">
                <CheckCircle2 size={11} className="text-indigo-400" />
                <span>Duty Technician Alerted</span>
              </div>
            </div>

            {/* Step 2 - Condition */}
            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-950/10 space-y-2 relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    TIMER CONDITION
                  </span>
                  <Clock size={12} className="text-amber-400" />
                </div>
                <h4 className="text-xs font-bold text-white">Acknowledge Timeout Window</h4>
                <p className="text-[11px] text-slate-400 leading-snug mt-1">
                  If CRITICAL alarm is <strong className="text-amber-300">not acknowledged</strong> within timeout window:
                </p>
              </div>
              <div className="pt-2">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1 font-semibold">
                  Timeout Duration:
                </label>
                <div className="flex gap-1.5">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => {
                        setEscalationTimeoutMins(mins)
                        toast.success(`Escalation timeout set to ${mins} mins`)
                      }}
                      className={clsx(
                        'flex-1 py-1 rounded text-xs font-mono font-semibold transition-colors border',
                        escalationTimeoutMins === mins
                          ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                          : 'bg-[#0d1117] text-slate-400 border-slate-800 hover:text-white'
                      )}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 3 - Escalation Destination */}
            <div className="p-4 rounded-xl border border-rose-500/40 bg-rose-950/10 space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  LEVEL 2 · ESCALATION
                </span>
                <AlertOctagon size={12} className="text-rose-400" />
              </div>
              <h4 className="text-xs font-bold text-white">Plant Leadership &amp; Fallback</h4>
              <p className="text-[11px] text-slate-400 leading-snug">
                Dispatches urgent override alert to Organization Fallback channels and pages the Operations Director.
              </p>
              <div className="pt-2 text-[10px] text-rose-300/80 border-t border-rose-900/40 flex items-center gap-1">
                <ShieldAlert size={11} className="text-rose-400" />
                <span>Executive Paging Active</span>
              </div>
            </div>
          </div>

          {/* Escalation Policy Settings */}
          <div className="rounded-xl p-4 border border-slate-800 bg-[#0a0e1a] space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Settings2 size={13} className="text-indigo-400" />
              <span>Escalation Broadcast Template &amp; Fallback Routing</span>
            </h4>
            <div className="space-y-2 text-xs">
              <label className="text-[11px] text-slate-400 font-semibold block">
                Escalation Notice Banner (Pre-pended to Pager / Chat):
              </label>
              <input
                value={escalationCustomNote}
                onChange={(e) => setEscalationCustomNote(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-amber-500 bg-[#0d1117] border border-slate-800"
              />
              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-slate-400">
                  Target Destination: <strong className="text-white">Organization Fallback Channels ({activeOrgCount}/5 Active)</strong>
                </span>
                <button
                  type="button"
                  onClick={() => toast.success('Escalation Matrix policy saved!', { icon: '⚡' })}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white shadow-md flex items-center gap-1.5 transition-transform active:scale-95"
                  style={gradient}
                >
                  <Save size={13} />
                  <span>Save Escalation Policy</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Central Maintenance Silence / Shelving Manager (ISA-18.2 §12) */}
      {activeTab === 'shelving' && (
        <div className="rounded-xl p-5 space-y-5" style={surface}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <PauseCircle size={17} className="text-blue-400" />
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  ISA-18.2 Central Maintenance Silence &amp; Shelving Manager
                </h3>
                <p className="text-xs text-slate-400">
                  View and manage assets with temporarily suppressed alarm annunciation during authorized maintenance or calibrations.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (devices.length) setNewShelveNodeId(devices[0].id)
                setShelveModalOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
              style={gradient}
            >
              <Plus size={14} />
              <span>Shelve Asset for Maintenance</span>
            </button>
          </div>

          {/* Shelving Overview Banner */}
          <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-950/20 flex items-start gap-3">
            <ShieldCheck size={16} className="text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-200/90 leading-relaxed">
              <strong>ISA-18.2 §12 Shelving Rule:</strong> Shelving suppresses audible and multi-channel notifications while an asset is undergoing work. All excursions remain recorded in the immutable audit log. Alarms automatically re-arm when the timer expires.
            </p>
          </div>

          {/* Active Shelved Alarms Table */}
          <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#0a0e1a]">
            <table className="w-full text-xs">
              <thead className="bg-[#0d1117] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold uppercase tracking-wider">Asset / Location</th>
                  <th className="py-3 px-4 text-left font-semibold uppercase tracking-wider">Suppressed Scope</th>
                  <th className="py-3 px-4 text-left font-semibold uppercase tracking-wider">Maintenance Reason / WO</th>
                  <th className="py-3 px-4 text-left font-semibold uppercase tracking-wider">Authorized By</th>
                  <th className="py-3 px-4 text-left font-semibold uppercase tracking-wider">Time Remaining</th>
                  <th className="py-3 px-4 text-right font-semibold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {shelvedDevices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                      No active alarm shelving. All {devices.length} fleet assets are operating with full alarm monitoring active.
                    </td>
                  </tr>
                ) : (
                  shelvedDevices.map((item) => {
                    const hoursLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 3600000))
                    return (
                      <tr key={item.nodeId} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-white block">{item.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{item.nodeId}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            {item.paramLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {item.reason}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {item.shelvedBy}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-amber-400 font-mono font-bold flex items-center gap-1">
                            <Clock size={11} /> {hoursLeft}h remaining
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Until {new Date(item.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleUnshelve(item.nodeId)}
                            className="px-3 py-1 rounded text-xs font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-700/60 hover:bg-emerald-900/60 transition-colors"
                          >
                            Unshelve Now
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: Email & SOP Template */}
      {activeTab === 'email' && (
        <div className="space-y-4">
          <EmailTemplateConfigurator orgId={orgId} orgName={orgName} />
        </div>
      )}

      {/* TAB 6: Web Audio Chime Configuration */}
      {activeTab === 'chime' && (
        <div className="space-y-5">
          <div className="rounded-xl p-5 space-y-5" style={surface}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  <Volume2 size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Web Audio Chime Configuration</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-purple-950/80 text-purple-300 border border-purple-500/40">
                      Org: {activeChimeOrgName} ({activeChimeOrgId})
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    เสียงแจ้งเตือนสังเคราะห์ผ่านเบราว์เซอร์ (Synthesized Web Audio) เตือนทันทีเมื่อเกิดเหตุวิกฤตหรือ Hardware ชนกัน
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const played = playChime(activeChimeOrgId, 'conflict')
                    if (played) toast.success(`🔔 กำลังเล่นเสียงตัวอย่าง Web Audio Chime สำหรับ ${activeChimeOrgName}`)
                    else toast('เสียงถูกปิดไว้ หรือติด Cooldown', { icon: '🔕' })
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Volume2 size={14} />
                  <span>🔔 ทดสอบเสียง (Test Chime)</span>
                </button>
              </div>
            </div>

            {/* Superadmin Multi-Org Switcher & Broadcast Tool */}
            {isSuperadmin && (
              <div className="p-3.5 rounded-xl border border-indigo-500/40 bg-indigo-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-indigo-600/30 text-indigo-300 border border-indigo-400/30">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>👑 Superadmin Multi-Tenant Audio Control</span>
                      <span className="text-[9px] px-2 py-0.5 rounded font-mono bg-indigo-500 text-white font-bold">
                        SUPERADMIN MODE
                      </span>
                    </div>
                    <p className="text-[11px] text-indigo-200/70">
                      สลับเลือกปรับแต่งเสียงได้ทุก Org ในระบบ หรือสั่ง Broadcast การตั้งค่าให้ทุก Org พร้อมกัน
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 bg-[#0a0e1a] px-2.5 py-1 rounded-lg border border-indigo-500/40">
                    <span className="text-xs text-slate-300 font-medium">สลับ Org:</span>
                    <select
                      value={activeChimeOrgId}
                      onChange={(e) => setChimeTargetOrgId(e.target.value)}
                      className="bg-transparent text-xs text-indigo-300 font-bold focus:outline-none cursor-pointer"
                    >
                      {Object.entries(orgNames).map(([id, name]) => (
                        <option key={id} value={id} className="bg-[#0d1117] text-white">
                          {name} ({id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const allIds = Object.keys(orgNames)
                      applyToAllOrgs(activeChimeOrgId, allIds)
                      toast.success(`⚡ คัดลอกการตั้งค่าเสียงของ ${activeChimeOrgName} ไปยังทุก ${allIds.length} องค์กรเรียบร้อย!`, {
                        icon: '📢',
                        duration: 4500,
                      })
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                    title="คัดลอกการตั้งค่าของ Org นี้ไปบังคับใช้กับทุก Org"
                  >
                    <span>⚡ คัดลอกให้ทุก Org (Apply to All)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Master Toggle */}
            <div className="p-4 rounded-xl flex items-center justify-between gap-4" style={inset}>
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>สถานะเสียงแจ้งเตือนเบราว์เซอร์ (Master Audio Switch)</span>
                  {chimeSettings.enabled ? (
                    <span className="text-[10px] text-emerald-400 font-bold">● กำลังเปิดใช้งาน</span>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-bold">○ ปิดเสียง (Muted)</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  ควบคุมเสียงเตือนเฉพาะอุปกรณ์ในองค์กร {activeChimeOrgName} บนหน้าจอแดชบอร์ด
                </p>
              </div>

              <button
                type="button"
                onClick={() => updateOrgSettings(activeChimeOrgId, { enabled: !chimeSettings.enabled })}
                className={clsx(
                  'px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer',
                  chimeSettings.enabled
                    ? 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                )}
              >
                {chimeSettings.enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>{chimeSettings.enabled ? 'เปิดเสียง (ENABLED)' : 'ปิดเสียง (MUTED)'}</span>
              </button>
            </div>

            {/* Audio Properties Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Volume Slider */}
              <div className="p-4 rounded-xl space-y-3" style={inset}>
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>ระดับความดังของเสียง (Volume Level)</span>
                  <span className="text-purple-400 font-mono">{Math.round(chimeSettings.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={Math.round(chimeSettings.volume * 100)}
                  onChange={(e) => updateOrgSettings(activeChimeOrgId, { volume: Number(e.target.value) / 100 })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>เบา (5%)</span>
                  <span>ปานกลาง (50%)</span>
                  <span>ดังสุด (100%)</span>
                </div>
              </div>

              {/* Chime Tone Style */}
              <div className="p-4 rounded-xl space-y-2.5" style={inset}>
                <div className="text-xs font-bold text-white">สไตล์โทนเสียงสังเคราะห์ (Chime Tone Style)</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'subtle' as const, label: 'นุ่มนวล (Subtle)', desc: 'Sine Wave D5→A5' },
                    { id: 'industrial' as const, label: 'ระฆังโรงงาน', desc: 'Harmonic Bell 440Hz' },
                    { id: 'urgent' as const, label: 'ฉุกเฉิน (Urgent)', desc: 'Triple Pulse' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => updateOrgSettings(activeChimeOrgId, { chimeStyle: s.id })}
                      className={clsx(
                        'p-2.5 rounded-lg text-left transition-all border cursor-pointer',
                        chimeSettings.chimeStyle === s.id
                          ? 'bg-purple-600/20 text-purple-200 border-purple-500/60 shadow-sm'
                          : 'bg-[#0d1117] text-slate-400 border-slate-800 hover:border-slate-700'
                      )}
                    >
                      <div className="text-[11px] font-bold">{s.label}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Triggers & Cooldown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Event Triggers */}
              <div className="p-4 rounded-xl space-y-3" style={inset}>
                <div className="text-xs font-bold text-white">เงื่อนไขการส่งเสียงเตือน (Audio Trigger Events)</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chimeSettings.alertOnConflict}
                      onChange={(e) => updateOrgSettings(activeChimeOrgId, { alertOnConflict: e.target.checked })}
                      className="rounded accent-purple-500"
                    />
                    <span>🚨 ตรวจพบ Hardware ID Conflict (อุปกรณ์ส่งชนกัน)</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chimeSettings.alertOnCritical}
                      onChange={(e) => updateOrgSettings(activeChimeOrgId, { alertOnCritical: e.target.checked })}
                      className="rounded accent-purple-500"
                    />
                    <span>🔴 สัญญาณเตือนระดับวิกฤต (Critical Alarm / Trip Risk)</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chimeSettings.alertOnWarning}
                      onChange={(e) => updateOrgSettings(activeChimeOrgId, { alertOnWarning: e.target.checked })}
                      className="rounded accent-purple-500"
                    />
                    <span>🟡 สัญญาณเตือนระดับเฝ้าระวัง (Warning / Elevated Risk)</span>
                  </label>
                </div>
              </div>

              {/* Anti-Fatigue Cooldown */}
              <div className="p-4 rounded-xl space-y-3" style={inset}>
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>หน่วงเวลาป้องกันเสียงรบกวน (Anti-Fatigue Cooldown)</span>
                  <span className="text-purple-400 font-mono">{chimeSettings.cooldownSec} วินาที</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  ระยะเวลาขั้นต่ำก่อนที่จะส่งเสียงซ้ำ เพื่อป้องกันไม่ให้เสียงดังรัวกวนสมาธิวิศวกรขณะกำลังแก้ไขปัญหา
                </p>
                <div className="flex gap-2">
                  {[10, 20, 30, 60].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => updateOrgSettings(activeChimeOrgId, { cooldownSec: sec })}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer',
                        chimeSettings.cooldownSec === sec
                          ? 'bg-purple-600/20 text-purple-200 border-purple-500/50'
                          : 'bg-[#0d1117] text-slate-400 border-slate-800 hover:border-slate-700'
                      )}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
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
                              ch.id === 'webhook' ? 'https://hooks.pagerduty.com/... or Webhook URL' :
                              'Google Chat Webhook URL…'
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

      {/* MODAL 3: Proactive Alarm Shelving (ISA-18.2 §12) */}
      {shelveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0d1117] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <PauseCircle size={17} className="text-blue-400" />
                <h3 className="text-sm font-bold text-white">Temporary Alarm Shelving (ISA-18.2)</h3>
              </div>
              <button onClick={() => setShelveModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Select Device / Asset</label>
                <select
                  value={newShelveNodeId}
                  onChange={(e) => setNewShelveNodeId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-white outline-none bg-[#0a0e1a] border border-slate-800"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Shelving Duration (Auto-restores after)</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[2, 4, 8, 24, 72].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setNewShelveDurationHours(h)}
                      className={clsx(
                        'py-1.5 rounded text-center font-mono font-semibold transition-colors border',
                        newShelveDurationHours === h
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-[#0a0e1a] text-slate-400 border-slate-800 hover:text-white'
                      )}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Maintenance Work Order / Reason</label>
                <input
                  value={newShelveReason}
                  onChange={(e) => setNewShelveReason(e.target.value)}
                  placeholder="e.g. WO-9021 Scheduled bushing oil testing & cleaning"
                  className="w-full rounded-lg px-3 py-2 text-white outline-none bg-[#0a0e1a] border border-slate-800"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShelveModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddShelve}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
                style={gradient}
              >
                Confirm Shelve
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



