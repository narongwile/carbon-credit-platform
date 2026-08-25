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
import type { SensorDomain } from '@/types/fleet'
import {
  Bell, Save, Loader2, ToggleLeft, ToggleRight, AlertTriangle,
  Sliders, ChevronDown, ChevronUp
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
  const [enabled, setEnabled] = useState<Record<ChannelId, boolean>>(DEFAULT_ENABLED)
  const [showAdminThresholds, setShowAdminThresholds] = useState(false)
  const [showPersonalThresholds, setShowPersonalThresholds] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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
    return () => { cancelled = true }
  }, [session?.id, nodeId])

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

  const missing = CHANNELS.filter((c) => c.prefsKey && enabled[c.id] && !prefs?.[c.prefsKey])

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
            const configured = !ch.prefsKey || !!prefs?.[ch.prefsKey]
            const isChEnabled = enabled[ch.id]
            return (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
                <div>
                  <span className="text-xs font-medium text-slate-200 block">{ch.name}</span>
                  {ch.prefsKey && !configured && (
                    <span className="text-[10px] text-amber-500/80">not configured in profile</span>
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

      {missing.length > 0 && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5 bg-amber-950/20 p-2.5 rounded-lg border border-amber-800/40">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {missing.map((m) => m.name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no credential saved in your account.{' '}
            <Link href={profileHref} className="underline font-medium hover:text-amber-300">Set up credentials in your Profile</Link>.
          </span>
        </p>
      )}

      <button
        onClick={save}
        disabled={saving || !live}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-all shadow-md"
        style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saved ? 'Settings Saved!' : saving ? 'Saving…' : 'Save My Alert Preferences'}
      </button>

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
              <AlarmParamConfig domain={domain} nodeId={nodeId} orgId={orgId} />
            </div>
          )}
        </div>
      )}

      {!live && <p className="text-[10px] text-slate-600 text-center">Live mode required to store your settings.</p>}
    </div>
  )
}

