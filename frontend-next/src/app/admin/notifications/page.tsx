'use client'

import { useState, useEffect } from 'react'
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

  const [scope, setScope] = useState<'all' | string>('all')
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [saved, setSaved] = useState(false)
  const [testingChannel, setTestingChannel] = useState<string | null>(null)

  // Which channel set is being edited: '' = the ORG-level fallback, or a department id
  const [channelDept, setChannelDept] = useState('')
  useEffect(() => {
    let cancelled = false
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

  const toggleChannel = (id: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
  const setTarget = (id: string, target: string) => setChannels((c) => c.map((x) => (x.id === id ? { ...x, target } : x)))
  const setMinSeverity = (id: string, minSeverity: 'WARNING' | 'CRITICAL') =>
    setChannels((c) => c.map((x) => (x.id === id ? { ...x, minSeverity } : x)))

  const saveChannels = async () => {
    const user = getSession()
    if (!user) { toast.error('Not signed in'); return }
    if (!isLive()) {
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      toast.success('Notification preferences saved (demo — not persisted)')
      return
    }
    const res = await api.putOrgChannels(orgId, channels, channelDept || undefined)
    if (!res) { toast.error('Could not save the delivery channels'); return }
    setSaved(true)
    toast.success(channelDept
      ? `Saved — destinations for ${orgDepts.find((d) => d.id === channelDept)?.name ?? 'this department'}`
      : 'Organization notification channels saved successfully')
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

  const activeChannelCount = channels.filter((c) => c.enabled).length

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
            {activeChannelCount} Active
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
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <BellRing size={16} className="text-indigo-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Alarm Setting &amp; Threshold Engine</h3>
                <p className="text-[11px] text-slate-400">Tuning baseline limits and multi-level application across your fleet</p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400 bg-slate-800/60 px-2.5 py-1 rounded-lg border border-slate-700/60 flex items-center gap-1.5">
              <Building2 size={12} className="text-indigo-400" />
              {orgName}
            </span>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Send size={15} className="text-indigo-400" />
                Notification Delivery Channels
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Dispatch official alarms to department or organization-wide webhooks, groups, and recipients.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-medium border" style={{ background: '#0a0e1a', borderColor: '#1e2433', color: '#94a3b8' }}>
                Active: <strong className="text-white">{activeChannelCount}/4</strong>
              </span>
            </div>
          </div>

          {/* Destination Target Scope */}
          <div className="p-3.5 rounded-xl border border-slate-800/90" style={{ background: '#0a0e1a' }}>
            <label className="block text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5">
              Destinations For
            </label>
            <select
              value={channelDept}
              onChange={(e) => setChannelDept(e.target.value)}
              className="w-full max-w-md rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            >
              <option value="">Whole organization (fallback for every alarm)</option>
              {orgDepts.map((d) => <option key={d.id} value={d.id}>{d.name} — devices this department owns</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {channelDept
                ? 'Alarms on devices owned by this department will dispatch to these specific targets in addition to organization fallbacks.'
                : 'Default fallback destinations used for all alarms across the entire organization unless overridden by a department.'}
            </p>
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

          {/* Dedicated card footer for Notification Channels */}
          <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 mt-2">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-400" />
              {channelDept
                ? `Targets apply to devices owned by ${orgDepts.find((d) => d.id === channelDept)?.name ?? 'this department'}`
                : 'Targets apply to whole organization (fallback for every device)'}
            </span>
            <button
              onClick={saveChannels}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-md active:scale-95"
              style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' } : gradient}
            >
              <Save size={14} /> {saved ? 'Channels Saved!' : (channelDept ? 'Save Department Channels' : 'Save Notification Channels')}
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

