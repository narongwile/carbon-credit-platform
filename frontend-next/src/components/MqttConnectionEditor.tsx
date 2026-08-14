'use client'

// ---------------------------------------------------------------------------
// Edit the platform-wide MQTT connection info shown on admin/pending's
// "MQTT setup" card — the broker host/port/username/password/TLS every org's
// firmware connects with. One shared account for every tenant (see
// admin/pending's own card copy on why: isolation is by MQTT client ID, not
// by credential), so there is exactly one of these to configure, not one per
// org — hence a platform-level editor, superadmin-only, not something that
// belongs on a per-org settings page.
//
// Reads/writes GET|PUT /api/platform/mqtt, which is deliberately its own
// endpoint rather than a field on /api/platform/settings: that one is
// policy 'super' for reads too, and this value has to be readable by every
// ordinary admin — they are the ones who actually go program a device with
// it. Only the WRITE (this editor) is superadmin-only.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { api } from '@/lib/api'
import { X, Radio, Save } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export interface MqttConnection {
  host: string
  port: string
  username: string
  password: string
  tls: boolean
}

export default function MqttConnectionEditor({
  current, onClose, onSaved,
}: {
  current: MqttConnection
  onClose: () => void
  onSaved: (next: MqttConnection) => void
}) {
  const [host, setHost] = useState(current.host)
  const [port, setPort] = useState(current.port)
  const [username, setUsername] = useState(current.username)
  const [password, setPassword] = useState(current.password)
  const [tls, setTls] = useState(current.tls)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!host.trim() || !port.trim() || !username.trim()) {
      toast.error('Host, port and username are required')
      return
    }
    setBusy(true)
    const r = await api.saveMqttConnection({
      host: host.trim(), port: port.trim(), username: username.trim(),
      // Blank password field means "leave it as-is" — the field is
      // pre-filled with the current plaintext value (this endpoint returns
      // it, unlike smtp.pass), so an admin has to explicitly clear it to
      // send an empty credential rather than doing so by accident.
      ...(password !== current.password ? { password } : {}),
      tls,
    })
    setBusy(false)
    if (!r?.ok) { toast.error('Could not save the MQTT connection'); return }
    toast.success('MQTT connection updated — every org’s setup card now reflects it')
    onSaved({ host: host.trim(), port: port.trim(), username: username.trim(), password, tls })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-sm rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Radio size={16} className="text-indigo-400" /> MQTT connection
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[11px] text-slate-500">
            Shown to every organization&apos;s admins on the &quot;MQTT setup&quot; card — this is what they connect
            firmware to. One shared broker account for every tenant; isolation is by MQTT client ID (each org&apos;s
            own id), not by credential.
          </p>
          {([
            ['Host', host, setHost, 'text'],
            ['Port', port, setPort, 'text'],
            ['Username', username, setUsername, 'text'],
            ['Password', password, setPassword, 'text'],
          ] as const).map(([label, value, setter]) => (
            <label key={label} className="block">
              <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</span>
              <input value={value} onChange={(e) => setter(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
            TLS (device connects over mqtts:// / port 8883-style listener)
          </label>
        </div>

        <div className="p-5 flex gap-3" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={save} disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
            <Save size={15} /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
