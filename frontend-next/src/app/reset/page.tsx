'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Boxes, ArrowLeft, Lock, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      toast.error('Invalid or missing reset token')
      router.push('/forgot')
    }
  }, [token, router])

  const submit = async () => {
    if (!token) return
    if (!password) { toast.error('Please enter a new password'); return }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    
    setLoading(true)
    try {
      const r = await api.resetPassword(token, password)
      if (!r || (r as any).error) throw new Error((r as any)?.error || 'Failed to reset password')
      setDone(true)
      toast.success('Password reset successfully')
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (!token) return null

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
              <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">New Password</div>
            </div>
          </div>
          <p className="text-slate-500 text-sm">Enter your new password below</p>
        </div>

        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {done ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(74,222,128,0.12)' }}><CheckCircle2 size={34} className="text-green-400" /></div>
              <h3 className="text-lg font-bold text-white">Password Updated</h3>
              <p className="text-sm text-slate-500 mt-2">Your password has been changed successfully.</p>
              <button onClick={() => router.push('/')} className="mt-6 inline-flex w-full justify-center py-3 rounded-lg font-semibold text-white text-sm" style={gradient}>Sign In</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">New Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Confirm Password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="••••••••"
                  className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
              </div>
              <button onClick={submit} disabled={loading} className="w-full py-3 rounded-lg font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50" style={gradient}>
                <Lock size={16} /> {loading ? 'Saving…' : 'Reset Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0e1a' }}><div className="text-indigo-400">Loading...</div></div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
