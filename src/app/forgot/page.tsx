'use client'

import { useState } from 'react'
import { Boxes, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (!email) { toast.error('Please enter your email'); return }
    setLoading(true)
    await new Promise((r) => setTimeout(r, 700))
    setLoading(false); setSent(true)
    toast.success('Reset link sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0e1a' }}>
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full opacity-10 blur-3xl" style={{ background: '#6366f1' }} />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={gradient}><Boxes size={24} className="text-white" /></div>
            <div className="text-left">
              <div className="text-2xl font-bold tracking-widest text-white">ONEOPS</div>
              <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">Reset Password</div>
            </div>
          </div>
          <p className="text-slate-500 text-sm">Enter your email to receive a reset link</p>
        </div>

        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {sent ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(74,222,128,0.12)' }}><CheckCircle2 size={34} className="text-green-400" /></div>
              <h3 className="text-lg font-bold text-white">Check your inbox</h3>
              <p className="text-sm text-slate-500 mt-2">If <span className="text-white">{email}</span> is registered, a password-reset link has been sent.</p>
              <a href="/" className="mt-6 inline-flex w-full justify-center py-3 rounded-lg font-semibold text-white text-sm" style={gradient}>Back to Sign In</a>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="you@company.com"
                  className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
              </div>
              <button onClick={submit} disabled={loading} className="w-full py-3 rounded-lg font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50" style={gradient}>
                <Mail size={16} /> {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
              <a href="/" className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors pt-1"><ArrowLeft size={13} /> Back to Sign In</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
