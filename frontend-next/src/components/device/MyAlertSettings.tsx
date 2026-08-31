'use client'

// ---------------------------------------------------------------------------
// "My Alert Settings" — a user's own alerting for one device.
// ---------------------------------------------------------------------------
// The switches persist per user in user_prefs (the same blob the profile
// panel writes), keyed by node id, and each one shows whether the credential it
// needs is actually filled in.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api, apiEnabled, useIsLive } from '@/lib/api'
import { useSession } from '@/lib/auth'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import AdminBulkApplyAlarmEditor from '@/components/device/AdminBulkApplyAlarmEditor'
import type { SensorDomain } from '@/types/fleet'
import {
  Bell, Save, Loader2, ToggleLeft, ToggleRight, AlertTriangle,
  Sliders, ChevronDown, ChevronUp, Send
} from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

type ChannelId = 'email' | 'telegram' | 'line' | 'googlechat'

/** prefsKey = the credential in user_prefs this channel needs to deliver. */
const CHANNELS: { id: ChannelId; name: string; prefsKey?: string }[] = [
  { id: 'email', name: 'Email' },
  { id: 'telegram', name: 'Telegram', prefsKey: 'telegramBotApi' },
  { id: 'line', name: 'LINE', prefsKey: 'lineMsgApi' },
  { id: 'googlechat', name: 'Google Chat', prefsKey: 'googleChatApi' },
]

const DEFAULT_ENABLED: Record<ChannelId, boolean> = { email: true, telegram: false, line: false, googlechat: false }

export default function MyAlertSettings({
  nodeId, domain = 'transformer', orgId, profileHref = '/admin/profile',
}: { nodeId: string; domain?: SensorDomain; orgId?: string; profileHref?: string }) {
  const live = useIsLive()
  const session = useSession()
  const isAdmin = session?.role === 'admin' || session?.role === 'superadmin'

  const [prefs, setPrefs] = useState<Record<string, unknown> | null>(null)
  const [dbUserChannels, setDbUserChannels] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState<Record<ChannelId, boolean>>(DEFAULT_ENABLED)
  const [showAdminThresholds, setShowAdminThresholds] = useState(false)
  const [showPersonalThresholds, setShowPersonalThresholds] = useState(false)
  const [showPersonalHistory, setShowPersonalHistory] = useState(false)
  // Mirrors the endpoint's row shape exactly. The previous declaration used
  // `unit?: string` / `acknowledged_at?: string` against an API that returns
  // `string | null`, and the mismatch was hidden by an `as any` on the
  // setState — so nothing checked that the console and the endpoint agreed.
  type PersonalEvent = {
    id: string; node_id: string; param_key: string; param_label: string
    severity: 'WARNING' | 'CRITICAL'; value: number; threshold: number; unit: string | null
    raised_at: string; acknowledged_at: string | null; acknowledged_by: string | null
  }
  const [personalEvents, setPersonalEvents] = useState<PersonalEvent[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)

  // api.myPersonalEvents, not api.events + a client-side filter on `source`.
  //
  // These rows used to be written into the shared alarm_events table with
  // 'PERSONAL:<userId>' stuffed into `source` — a column declared
  // ENUM('edge','cloud'). The value did not fit, INSERT IGNORE downgraded the
  // truncation to a warning, and the row was stored with the empty ENUM
  // member. So this filter could never match and the history was always empty,
  // while the row itself sat in alarm_events indistinguishable from a real org
  // alarm: visible to the whole organization and escalated to the department
  // by escalationFunc. They now live in their own table (migrate-v59), read
  // through an endpoint scoped to msg.auth.userId — the filter is not
  // client-side any more, because "only mine" is a privacy boundary and must
  // not be enforced in the browser.
  const fetchPersonalEvents = useCallback(async () => {
    if (!apiEnabled || !nodeId) return
    try {
      const rows = await api.myPersonalEvents(nodeId)
      if (Array.isArray(rows)) setPersonalEvents(rows)
    } catch (_) {}
  }, [nodeId])

  const handleAckPersonal = useCallback(async (evtId: string) => {
    try {
      // The personal-event ack endpoint, not the org ackEvent one: its WHERE
      // clause carries user_id, so one user cannot acknowledge another's.
      await api.ackMyPersonalEvent(nodeId, evtId, { by: session?.name || session?.email || 'User' })
      toast.success('Personal alarm acknowledged')
      fetchPersonalEvents()
    } catch (_) {
      toast.error('Could not acknowledge alarm')
    }
  }, [nodeId, session?.name, session?.email, fetchPersonalEvents])

  useEffect(() => {
    if (showPersonalHistory) {
      fetchPersonalEvents()
    }
  }, [showPersonalHistory, fetchPersonalEvents])

  useEffect(() => {
    if (!apiEnabled || !session?.id) return
    let cancelled = false
    api.getMyConfig(session.id).then((r) => {
      if (cancelled) return
      const p = (r?.prefs ?? {}) as Record<string, unknown>
      setPrefs(p)
      const perNodeChannels = (p.alertChannels ?? {}) as Record<string, Partial<Record<ChannelId, boolean>>>
      setEnabled({ ...DEFAULT_ENABLED, ...(perNodeChannels[nodeId] ?? {}) })
    })
    if (orgId) {
      api.orgChannels(orgId, undefined, session.id).then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        const map: Record<string, string> = {}
        rows.forEach((r) => {
          if (r.channel && r.target && r.enabled) {
            map[r.channel] = r.target
          }
        })
        setDbUserChannels(map)
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [session?.id, nodeId, orgId])

  const save = useCallback(async () => {
    if (!session?.id) { toast.error('Sign in to save your alert settings'); return }
    setSaving(true)
    try {
      const current = prefs ?? ((await api.getMyConfig(session.id))?.prefs ?? {}) as Record<string, unknown>
      const perNodeChannels = { ...((current.alertChannels ?? {}) as Record<string, unknown>), [nodeId]: enabled }
      const next = { ...current, alertChannels: perNodeChannels }
      const res = await api.putMyConfig(session.id, next)
      if (!res) throw new Error('save failed')
      setPrefs(next)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      toast.success('Alert settings saved')
    } catch {
      toast.error('Could not save your alert settings')
    } finally {
      setSaving(false)
    }
  }, [session?.id, prefs, enabled, nodeId])

  const sendTest = useCallback(async () => {
    if (!session?.id) { toast.error('Sign in to test alerts'); return }
    setTesting(true)
    try {
      const res = await api.testMyPersonalAlert(nodeId, enabled)
      if (res?.ok) {
        const sentChannels = Object.keys(res.sent || {}).filter(k => res.sent[k])
        if (sentChannels.length > 0) {
          toast.success(`🔔 Test alert sent to: ${sentChannels.join(', ')}`)
        } else {
          const errList = Object.entries(res.errors || {}).map(([k, v]) => `${k}: ${v}`)
          if (errList.length > 0) {
            toast.error(`Delivery failed: ${errList.join('; ')}`, { duration: 6000 })
          } else {
            toast.error('No channels enabled or configured for test alert')
          }
        }
      } else {
        toast.error('Failed to send test alert')
      }
    } catch (e: any) {
      toast.error(`Test alert error: ${e?.message || 'Unknown'}`)
    } finally {
      setTesting(false)
    }
  }, [session?.id, enabled, nodeId])

  const missing = CHANNELS.filter((c) => c.prefsKey && enabled[c.id] && !prefs?.[c.prefsKey] && !dbUserChannels[c.id])

  return (
    <div className="rounded-xl p-5 space-y-4" style={surface}>
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bell size={14} className="text-indigo-400" />
            My Alert Settings
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Your own notification channels &amp; alarm thresholds for this device
          </p>
        </div>
        <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
          {session?.email || session?.username || '—'}
        </span>
      </div>

      {/* Section 1: Notification Delivery Channels */}
      <div className="space-y-2">
        <label className="block text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
          1. Delivery Channels
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHANNELS.map((ch) => {
            const hasPref = ch.prefsKey ? !!prefs?.[ch.prefsKey] : true
            const hasDb = !!dbUserChannels[ch.id]
            const configured = !ch.prefsKey || hasPref || hasDb
            const isChEnabled = enabled[ch.id]
            return (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
                <div>
                  <span className="text-xs font-medium text-slate-200 block">{ch.name}</span>
                  {ch.prefsKey && !configured && (
                    <span className="text-[10px] text-amber-500/80">not configured in profile</span>
                  )}
                  {ch.prefsKey && configured && !hasPref && hasDb && (
                    <span className="text-[10px] text-emerald-400/80">linked via notifications</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEnabled((e) => ({ ...e, [ch.id]: !e[ch.id] }))}
                  aria-label={`Toggle ${ch.name}`}
                >
                  {isChEnabled ? <ToggleRight size={22} className="text-indigo-400" /> : <ToggleLeft size={22} className="text-slate-600" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {missing.length > 0 && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5 bg-amber-950/20 p-2.5 rounded-lg border border-amber-800/40">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {missing.map((m) => m.name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no credential saved in your account.{' '}
            <Link href={profileHref} className="underline font-medium hover:text-amber-300">Set up credentials in your Profile</Link> or Notification Settings.
          </span>
        </p>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !live}
          className="w-full flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-all shadow-md"
          style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saved ? 'Settings Saved!' : saving ? 'Saving…' : 'Save My Alert Preferences'}
        </button>

        <button
          type="button"
          onClick={sendTest}
          disabled={testing || !live}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-indigo-300 hover:text-white bg-slate-900 border border-indigo-500/40 hover:border-indigo-500 hover:bg-indigo-950/40 disabled:opacity-50 transition-all shadow-md whitespace-nowrap"
          title="Send an immediate test alert to your enabled delivery channels to verify reception"
        >
          {testing ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <Send size={14} className="text-indigo-400" />}
          {testing ? 'Sending Test…' : 'Send Test Alert'}
        </button>
      </div>

      {/* Section 2: My Personal Alarm Thresholds — independent of the shared
          device rule (below, admin-only): this notifies only the signed-in
          user, through the channels above, without changing what anyone
          else sees for this device. */}
      <div className="pt-1 space-y-2">
        <button
          type="button"
          onClick={() => setShowPersonalThresholds(!showPersonalThresholds)}
          className="w-full flex items-center justify-between p-2.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/60 border border-slate-800 transition-all"
        >
          <span className="flex items-center gap-2">
            <Sliders size={13} className="text-indigo-400" />
            <span>2. My Personal Alarm Thresholds</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-mono">
              Scoped to active sensors
            </span>
          </span>
          {showPersonalThresholds ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showPersonalThresholds && (
          <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/80 animate-in fade-in duration-200 space-y-2">
            <p className="text-[11px] text-slate-500">
              Notify only you, through your Delivery Channels above, when a reading crosses YOUR chosen limits —
              independent of the device&apos;s official thresholds everyone else sees.
            </p>
            <AlarmParamConfig domain={domain} nodeId={nodeId} orgId={orgId} mode="personal" />
          </div>
        )}
      </div>

      {/* Section 3: My Personal Alarm History & In-App ACK Console */}
      <div className="pt-1 space-y-2">
        <button
          type="button"
          onClick={() => setShowPersonalHistory(!showPersonalHistory)}
          className="w-full flex items-center justify-between p-2.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/60 border border-slate-800 transition-all"
        >
          <span className="flex items-center gap-2">
            <Bell size={13} className="text-amber-400" />
            <span>3. My Personal Alarm History &amp; Console</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30 font-mono">
              {personalEvents.length} Recorded Alerts
            </span>
          </span>
          {showPersonalHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showPersonalHistory && (
          <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/80 animate-in fade-in duration-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                Audit trail of personal alerts delivered to your Telegram/Email. Click ACK to confirm receipt.
              </p>
              <button
                type="button"
                onClick={fetchPersonalEvents}
                className="text-[10px] px-2 py-1 rounded bg-slate-900 text-slate-300 hover:text-white border border-slate-800"
              >
                Refresh Log
              </button>
            </div>

            {personalEvents.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-500">
                No personal alarm events recorded for this device yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {personalEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {evt.severity || 'WARNING'}
                        </span>
                        <span className="font-semibold text-slate-200">{evt.param_label || evt.param_key}</span>
                        <span className="font-mono text-amber-300">{evt.value} {evt.unit}</span>
                        <span className="text-[10px] text-slate-500">(Limit: {evt.threshold})</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {new Date(evt.raised_at).toLocaleString()}
                      </div>
                    </div>

                    <div>
                      {evt.acknowledged_at ? (
                        <span className="text-[10px] px-2 py-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-mono">
                          ✓ ACKed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAckPersonal(evt.id)}
                          className="text-[11px] px-2.5 py-1 rounded font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all"
                        >
                          ACK
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin Advanced Device Threshold Configuration Accordion */}
      {isAdmin && (
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <button
            type="button"
            onClick={() => setShowAdminThresholds(!showAdminThresholds)}
            className="w-full flex items-center justify-between p-2.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/60 border border-slate-800 transition-all"
          >
            <span className="flex items-center gap-2">
              <Sliders size={13} className="text-indigo-400" />
              <span>Device-Wide Alarm Thresholds &amp; Rule Engine (Admin)</span>
            </span>
            {showAdminThresholds ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdminThresholds && (
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/80 animate-in fade-in duration-200">
              {/* Tuning THIS transformer's own numbers here is often where an
                  admin actually looks at real data first — the bulk-apply
                  scope picker lets them roll those numbers out to a
                  department or the whole org without leaving this page. */}
              <AdminBulkApplyAlarmEditor domain={domain} orgId={orgId} nodeId={nodeId} />
            </div>
          )}
        </div>
      )}

      {!live && <p className="text-[10px] text-slate-600 text-center">Live mode required to store your settings.</p>}
    </div>
  )
}

