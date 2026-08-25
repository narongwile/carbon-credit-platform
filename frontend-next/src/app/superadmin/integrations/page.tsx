'use client'

import { useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'
import { Mail, Send, Save, Lock, Bell, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const SERVICES = [
  { name: 'REST API v2', status: 'active', endpoint: 'https://api.eternity.io/v2', calls: '2.3M/day' },
  { name: 'WebSocket Stream', status: 'active', endpoint: 'wss://stream.eternity.io', calls: '4.1K conn' },
  { name: 'MQTT Broker', status: 'active', endpoint: 'mqtt://iot.eternity.io:1883', calls: '12K devices' },
  { name: 'Webhook Notifications', status: 'degraded', endpoint: 'https://hooks.eternity.io', calls: '45K/day' },
]

type Form = { smtpHost: string; smtpPort: string; smtpUser: string; smtpPass: string; mailFrom: string; frontendUrl: string }

// SMTP / sender config for all platform email (welcome, password reset, alarms,
// scheduled reports). Stored in platform_settings (DB); the password is encrypted
// at rest and never returned — leave it blank to keep the existing one.
function EmailSettings() {
  const [form, setForm] = useState<Form>({ smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', mailFrom: '', frontendUrl: '' })
  const [passSet, setPassSet] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)

  const load = () => {
    if (!isLive()) { setLoading(false); return }
    api.platformSettings().then((s) => {
      if (s) {
        setForm((f) => ({ ...f, smtpHost: s.smtpHost, smtpPort: s.smtpPort || '587', smtpUser: s.smtpUser, mailFrom: s.mailFrom, frontendUrl: s.frontendUrl, smtpPass: '' }))
        setPassSet(s.passSet)
      }
      setLoading(false)
    })
  }
  useEffect(load, [])

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    setSaving(true)
    const body: Record<string, string> = {
      smtpHost: form.smtpHost.trim(), smtpPort: form.smtpPort.trim() || '587', smtpUser: form.smtpUser.trim(),
      mailFrom: form.mailFrom.trim(), frontendUrl: form.frontendUrl.trim(),
    }
    if (form.smtpPass) body.smtpPass = form.smtpPass   // only overwrite when a new one is typed
    const r = await api.savePlatformSettings(body)
    setSaving(false)
    if (r?.ok) { toast.success('Email settings saved'); setForm((f) => ({ ...f, smtpPass: '' })); setPassSet(passSet || !!form.smtpPass) }
    else toast.error('Save failed')
  }

  const sendTest = async () => {
    if (!testTo.trim()) { toast.error('Enter a recipient'); return }
    setTesting(true)
    const r = await api.testPlatformChannel('email', testTo.trim())
    setTesting(false)
    if (r?.ok) toast.success(`Test email sent from ${r.from ?? 'sender'}`)
    else toast.error('Test failed — check SMTP host/credentials')
  }

  const field = (label: string, key: keyof Form, placeholder: string, type = 'text') => (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wider">{label}</label>
      <input type={type} value={form[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
    </div>
  )

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center gap-2 mb-1">
        <Mail size={16} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Email / SMTP (platform sender)</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">Used for welcome, password reset, alarm, and scheduled-report emails. Sender = <span className="font-mono">MAIL FROM</span>.</p>

      {!isLive() ? (
        <div className="text-sm text-amber-400">Live backend not configured (NEXT_PUBLIC_API_URL).</div>
      ) : loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {field('SMTP Host', 'smtpHost', 'smtp.sendgrid.net')}
            {field('SMTP Port', 'smtpPort', '587')}
            {field('SMTP User', 'smtpUser', 'apikey / username')}
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wider flex items-center gap-1"><Lock size={10} /> SMTP Password</label>
              <input type="password" value={form.smtpPass} onChange={(e) => set({ smtpPass: e.target.value })}
                placeholder={passSet ? '•••••••• (configured — leave blank to keep)' : 'not set'}
                className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
            </div>
            {field('Mail From (sender address)', 'mailFrom', 'noreply@yourdomain.com')}
            {field('Frontend URL (for links)', 'frontendUrl', 'https://oneops.yourdomain.com')}
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>

          <div className="mt-4 pt-4 flex flex-col sm:flex-row sm:items-end gap-2" style={{ borderTop: '1px solid #1e2433' }}>
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wider">Send test email to</label>
              <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com"
                className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
            </div>
            <button onClick={sendTest} disabled={testing} className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-200 disabled:opacity-50" style={inset}>
              <Send size={14} /> {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Platform notification tokens (Telegram / LINE / Google Chat) used for alarm
// alerts and scheduled-report delivery. Tokens are stored encrypted in
// platform_settings and never returned (a "configured" flag only).
function NotificationSettings() {
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [lineToken, setLineToken] = useState('')
  const [googleChatWebhook, setGoogleChatWebhook] = useState('')
  const [flags, setFlags] = useState({ telegramSet: false, lineSet: false, googleChatSet: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    if (!isLive()) { setLoading(false); return }
    api.platformSettings().then((s) => {
      if (s) { setTelegramChatId(s.telegramChatId || ''); setFlags({ telegramSet: s.telegramSet, lineSet: s.lineSet, googleChatSet: s.googleChatSet }) }
      setLoading(false)
    })
  }
  useEffect(load, [])

  const save = async () => {
    setSaving(true)
    const body: Record<string, string> = { telegramChatId: telegramChatId.trim() }
    if (telegramToken) body.telegramToken = telegramToken
    if (lineToken) body.lineToken = lineToken
    if (googleChatWebhook) body.googleChatWebhook = googleChatWebhook
    const r = await api.savePlatformSettings(body)
    setSaving(false)
    if (r?.ok) {
      toast.success('Notification settings saved')
      setFlags((f) => ({ telegramSet: f.telegramSet || !!telegramToken, lineSet: f.lineSet || !!lineToken, googleChatSet: f.googleChatSet || !!googleChatWebhook }))
      setTelegramToken(''); setLineToken(''); setGoogleChatWebhook('')
    } else toast.error('Save failed')
  }

  const test = async (channel: string, to?: string) => {
    setBusy(channel)
    const r = await api.testPlatformChannel(channel, to)
    setBusy(null)
    if (r?.ok) toast.success(`Test sent to ${channel}`)
    else toast.error(`${channel} test failed — save the token first & check it`)
  }

  const secretField = (label: string, val: string, onChange: (v: string) => void, isSet: boolean, placeholder: string) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1"><Lock size={10} /> {label}</label>
        {isSet && <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Saved &amp; Encrypted</span>}
      </div>
      <input type="password" value={val} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? '•••••••••••••••• (Encrypted in database — blank to keep)' : placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
    </div>
  )

  return (
    <div className="rounded-xl p-5" style={surface}>
      <div className="flex items-center gap-2 mb-1">
        <Bell size={16} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Notification Channels</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">Platform tokens for alarm alerts and scheduled-report delivery. Tokens are encrypted at rest.</p>

      {!isLive() ? (
        <div className="text-sm text-amber-400">Live backend not configured (NEXT_PUBLIC_API_URL).</div>
      ) : loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Telegram */}
          <div className="rounded-lg p-3" style={inset}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-2"><Send size={12} className="text-sky-400" /> Telegram</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {secretField('Bot Token', telegramToken, setTelegramToken, flags.telegramSet, '123456:ABC-DEF…')}
              <div>
                <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wider">Default Chat ID (Numeric)</label>
                <input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="e.g. 581234567 or -1001234567890"
                  className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500" style={surface} />
                <p className="text-[10px] text-slate-500 mt-1">📌 ต้องเป็นตัวเลข Chat ID (ไม่ใช่ @botname) — หาได้จาก <code>@userinfobot</code></p>
              </div>
            </div>
            <button onClick={() => test('telegram', telegramChatId.trim() || undefined)} disabled={busy === 'telegram'} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 disabled:opacity-50" style={surface}><Send size={12} /> {busy === 'telegram' ? 'Testing…' : 'Send test'}</button>
          </div>

          {/* LINE */}
          <div className="rounded-lg p-3" style={inset}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-2"><MessageSquare size={12} className="text-green-400" /> LINE Notify</div>
            {secretField('Access Token', lineToken, setLineToken, flags.lineSet, 'LINE Notify token')}
            <button onClick={() => test('line')} disabled={busy === 'line'} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 disabled:opacity-50" style={surface}><Send size={12} /> {busy === 'line' ? 'Testing…' : 'Send test'}</button>
          </div>

          {/* Google Chat */}
          <div className="rounded-lg p-3" style={inset}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-2"><MessageSquare size={12} className="text-amber-400" /> Google Chat</div>
            {secretField('Webhook URL', googleChatWebhook, setGoogleChatWebhook, flags.googleChatSet, 'https://chat.googleapis.com/v1/spaces/…')}
            <button onClick={() => test('googlechat')} disabled={busy === 'googlechat'} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 disabled:opacity-50" style={surface}><Send size={12} /> {busy === 'googlechat' ? 'Testing…' : 'Send test'}</button>
          </div>

          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save notification settings'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">API & Integrations</h1>
        <p className="text-sm text-slate-500 mt-1">Manage platform APIs, email delivery, and third-party integrations</p>
      </div>

      <EmailSettings />
      <NotificationSettings />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SERVICES.map((svc) => (
          <div key={svc.name} className="rounded-xl p-5" style={surface}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">{svc.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${svc.status === 'active' ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
                {svc.status}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500 mb-2">{svc.endpoint}</div>
            <div className="text-xs text-slate-400">Traffic: <span className="text-white">{svc.calls}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
