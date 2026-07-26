'use client'

// ---------------------------------------------------------------------------
// "My Alert Settings" — a user's own alerting for one device.
// ---------------------------------------------------------------------------
// This block existed only on the viewer device page, and its channel switches
// were local component state seeded from a mock list: toggling them changed
// nothing, and reopening the page reset them. Admins had no equivalent at all
// even though they carry the pager for the same devices.
//
// The switches now persist per user in user_prefs (the same blob the profile
// panel writes), keyed by node id, and each one shows whether the credential it
// needs is actually filled in — an enabled channel with no token cannot deliver,
// and saying so here beats silence when an alarm does not arrive.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api, apiEnabled, useIsLive } from '@/lib/api'
import { getSession } from '@/lib/auth'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import type { SensorDomain } from '@/types/fleet'
import { Bell, Save, Loader2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react'
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
  nodeId, domain, orgId, profileHref = '/admin/profile',
}: { nodeId: string; domain?: SensorDomain; orgId?: string; profileHref?: string }) {
  const live = useIsLive()
  const session = getSession()
  const [prefs, setPrefs] = useState<Record<string, unknown> | null>(null)
  const [enabled, setEnabled] = useState<Record<ChannelId, boolean>>(DEFAULT_ENABLED)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!apiEnabled || !session?.id) return
    let cancelled = false
    api.getMyConfig(session.id).then((r) => {
      if (cancelled) return
      const p = (r?.prefs ?? {}) as Record<string, unknown>
      setPrefs(p)
      const perNode = (p.alertChannels ?? {}) as Record<string, Partial<Record<ChannelId, boolean>>>
      setEnabled({ ...DEFAULT_ENABLED, ...(perNode[nodeId] ?? {}) })
    })
    return () => { cancelled = true }
  }, [session?.id, nodeId])

  const save = useCallback(async () => {
    if (!session?.id) { toast.error('Sign in to save your alert settings'); return }
    setSaving(true)
    try {
      // putMyConfig REPLACES prefs, so the whole blob has to ride along —
      // sending only this section would wipe the phone number and the channel
      // credentials the profile panel stores.
      const current = prefs ?? ((await api.getMyConfig(session.id))?.prefs ?? {}) as Record<string, unknown>
      const perNode = { ...((current.alertChannels ?? {}) as Record<string, unknown>), [nodeId]: enabled }
      const next = { ...current, alertChannels: perNode }
      const res = await api.putMyConfig(session.id, next)
      if (!res) throw new Error('save failed')
      setPrefs(next)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch {
      toast.error('Could not save your alert settings')
    } finally {
      setSaving(false)
    }
  }, [session?.id, prefs, enabled, nodeId])

  const missing = CHANNELS.filter((c) => c.prefsKey && enabled[c.id] && !prefs?.[c.prefsKey])

  return (
    <div className="rounded-xl p-5 space-y-3" style={surface}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">My Alert Settings</h3>
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <Bell size={11} /> personal — alerts only you · {session?.email || session?.username || '—'}
        </span>
      </div>

      <AlarmParamConfig domain={domain} nodeId={nodeId} orgId={orgId} />

      <div className="space-y-1.5">
        {CHANNELS.map((ch) => {
          const configured = !ch.prefsKey || !!prefs?.[ch.prefsKey]
          return (
            <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
              <span className="text-sm text-slate-300 flex items-center gap-2">
                {ch.name}
                {ch.prefsKey && !configured && (
                  <span className="text-[10px] text-slate-600">not configured</span>
                )}
              </span>
              <button onClick={() => setEnabled((e) => ({ ...e, [ch.id]: !e[ch.id] }))} aria-label={`Toggle ${ch.name}`}>
                {enabled[ch.id] ? <ToggleRight size={20} className="text-indigo-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
              </button>
            </div>
          )
        })}
      </div>

      {missing.length > 0 && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {missing.map((m) => m.name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no credential saved, so nothing can be delivered there.{' '}
            <Link href={profileHref} className="underline hover:text-amber-300">Add it in your profile</Link>.
          </span>
        </p>
      )}

      <button
        onClick={save}
        disabled={saving || !live}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={saved ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saved ? 'Saved!' : saving ? 'Saving…' : 'Save My Alert'}
      </button>
      {!live && <p className="text-[10px] text-slate-600 text-center">Live mode required to store your settings.</p>}
    </div>
  )
}
