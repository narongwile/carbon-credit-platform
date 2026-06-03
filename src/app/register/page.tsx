'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boxes, Eye, EyeOff, UserPlus, ArrowLeft, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.username || !form.email || !form.password) { toast.error('Please fill in all fields'); return }
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return }
    setLoading(true)
    await new Promise((r) => setTimeout(r, 700))
    setLoading(false); setDone(true)
    toast.success('Account created')
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0e1a' }}>
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: '#6366f1' }} />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={gradient}><Boxes size={24} className="text-white" /></div>
            <div className="text-left">
              <div className="text-2xl font-bold tracking-widest text-white">ONEOPS</div>
              <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">Create Account</div>
            </div>
          </div>
          <p className="text-slate-500 text-sm">Register a new account to request access</p>
        </div>

        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {done ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(74,222,128,0.12)' }}><CheckCircle2 size={34} className="text-green-400" /></div>
              <h3 className="text-lg font-bold text-white">Registration submitted</h3>
              <p className="text-sm text-slate-500 mt-2">Your account request for <span className="text-white">{form.username}</span> has been created. An admin will activate it shortly.</p>
              <button onClick={() => router.push('/')} className="mt-6 w-full py-3 rounded-lg font-semibold text-white text-sm" style={gradient}>Back to Sign In</button>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Username" value={form.username} onChange={(v) => set('username', v)} placeholder="create a username" />
              <Field label="Email" value={form.email} onChange={(v) => set('email', v)} placeholder="you@company.com" />
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="create a password"
                    className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 pr-12" style={inset} />
                  <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
              <Field label="Confirm Password" type="password" value={form.confirm} onChange={(v) => set('confirm', v)} placeholder="repeat password" />
              {form.confirm && form.password !== form.confirm && <p className="text-xs text-red-400">Passwords do not match.</p>}

              <button onClick={submit} disabled={loading} className="w-full py-3 rounded-lg font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50" style={gradient}>
                <UserPlus size={16} /> {loading ? 'Creating…' : 'Create Account'}
              </button>
              <a href="/" className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors pt-1"><ArrowLeft size={13} /> Back to Sign In</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
    </div>
  )
}
