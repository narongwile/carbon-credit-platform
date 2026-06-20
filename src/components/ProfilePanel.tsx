'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/auth'
import { api, apiEnabled } from '@/lib/api'
import { UserCircle, Save, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

// Shared User Profile panel — edit profile + edit username/password.
// Used by both the Admin and Customer (Viewer) portals.
export default function ProfilePanel({ portal }: { portal: string }) {
  const [profile, setProfile] = useState({ name: '', username: '', email: '', phone: '' })
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [savedProfile, setSavedProfile] = useState(false)
  const [savedPwd, setSavedPwd] = useState(false)

  useEffect(() => {
    const s = getSession()
    if (!s) return
    setProfile({ name: s.name, username: s.username, email: s.email, phone: '' })
    if (apiEnabled) api.getMyConfig(s.id).then((r) => {
      const p = (r?.prefs ?? {}) as { phone?: string }
      if (p.phone) setProfile((cur) => ({ ...cur, phone: p.phone as string }))
    })
  }, [])

  const saveProfile = async () => {
    const s = getSession()
    if (s) {
      try {
        await api.updateMeConfig({ phone: profile.phone, name: profile.name })
        setSavedProfile(true); setTimeout(() => setSavedProfile(false), 2000)
      } catch (e: any) { toast.error('Failed to update profile') }
    }
  }
  const savePwd = async () => {
    if (!pwd.current || !pwd.next || pwd.next !== pwd.confirm) return
    try {
      const r = await api.updatePassword({ currentPassword: pwd.current, newPassword: pwd.next })
      if (!r || (r as any).error) throw new Error((r as any)?.error || 'Failed to update')
      setSavedPwd(true); setPwd({ current: '', next: '', confirm: '' }); setTimeout(() => setSavedPwd(false), 2000)
      toast.success('Password updated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password')
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-white">User Profile</h1>
        <p className="text-sm text-slate-500 mt-0.5">{portal} · edit your profile and credentials</p>
      </div>

      <div className="flex items-center gap-4 p-5 rounded-xl" style={surface}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={gradient}>
          <span className="text-2xl font-bold text-white">{profile.name?.[0]?.toUpperCase() || <UserCircle size={28} className="text-white" />}</span>
        </div>
        <div>
          <div className="text-lg font-bold text-white">{profile.name || '—'}</div>
          <div className="text-sm text-slate-500">@{profile.username}</div>
        </div>
      </div>

      {/* Edit profile */}
      <div className="rounded-xl p-5 space-y-4" style={surface}>
        <h3 className="text-sm font-semibold text-white">Edit Profile</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name" value={profile.name} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} />
          <Field label="Username" value={profile.username} onChange={(v) => setProfile((p) => ({ ...p, username: v }))} />
          <Field label="Email" value={profile.email} onChange={(v) => setProfile((p) => ({ ...p, email: v }))} />
          <Field label="Phone" value={profile.phone} onChange={(v) => setProfile((p) => ({ ...p, phone: v }))} />
        </div>
        <button onClick={saveProfile} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white" style={savedProfile ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
          <Save size={15} /> {savedProfile ? 'Saved!' : 'Save Profile'}
        </button>
      </div>

      {/* Change password */}
      <div className="rounded-xl p-5 space-y-4" style={surface}>
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><KeyRound size={15} className="text-indigo-400" /> Change Password</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Current" type="password" value={pwd.current} onChange={(v) => setPwd((p) => ({ ...p, current: v }))} />
          <Field label="New" type="password" value={pwd.next} onChange={(v) => setPwd((p) => ({ ...p, next: v }))} />
          <Field label="Confirm" type="password" value={pwd.confirm} onChange={(v) => setPwd((p) => ({ ...p, confirm: v }))} />
        </div>
        {pwd.next && pwd.next !== pwd.confirm && <p className="text-xs text-red-400">Passwords do not match.</p>}
        <button onClick={savePwd} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white" style={savedPwd ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
          <KeyRound size={15} /> {savedPwd ? 'Updated!' : 'Update Password'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
    </div>
  )
}
