'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boxes, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, apiImageUrl } from '@/lib/api'
import { authApiEnabled } from '@/lib/auth'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null)
  const [orgLogoFailed, setOrgLogoFailed] = useState(false)

  useEffect(() => {
    const org = new URLSearchParams(window.location.search).get('org')
    if (org) {
      setOrgId(org)
      setOrgLogoUrl(apiImageUrl(`/api/public/orgs/${encodeURIComponent(org)}/logo`))
    }
  }, [])

  const submit = async () => {
    if (!email) { toast.error('Please enter your email'); return }
    setLoading(true)
    try {
      if (!authApiEnabled) {
        await new Promise(r => setTimeout(r, 600))
        setSent(true)
        toast.success('Reset link sent (Demo Mode)')
        return
      }
      const r = await api.forgotPassword(email)
      if (!r || (r as any).error) throw new Error((r as any)?.error || 'Failed to send request')
      setSent(true)
      toast.success('Reset link sent')
    } catch (err: any) {
      toast.error(err.message || 'Failed to send request')
    } finally {
      setLoading(false)
    }
  }

  const backUrl = orgId ? `/?org=${encodeURIComponent(orgId)}` : '/'

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0e1a' }}>
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full opacity-10 blur-3xl" style={{ background: '#6366f1' }} />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="flex flex-col items-center justify-center mb-4">
            {orgLogoUrl && !orgLogoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={orgLogoUrl} alt="Organization Logo" onError={() => setOrgLogoFailed(true)}
                className="h-20 max-w-[280px] max-h-24 object-contain mx-auto drop-shadow-lg transition-all" />
            ) : (
              <div className="inline-flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={gradient}><Boxes size={24} className="text-white" /></div>
                <div className="text-left">
                  <div className="text-2xl font-bold tracking-widest text-white">ONEOPS</div>
                  <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">Reset Password</div>
                </div>
              </div>
            )}
          </div>
          <p className="text-slate-500 text-sm">
            {orgId ? (
              <>Reset password for <span className="text-white font-semibold">{orgId}</span> user account</>
            ) : (
              'Enter your email to receive a reset link'
            )}
          </p>
        </div>

        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {sent ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(74,222,128,0.12)' }}><CheckCircle2 size={34} className="text-green-400" /></div>
              <h3 className="text-lg font-bold text-white">Check your inbox</h3>
              <p className="text-sm text-slate-500 mt-2">If <span className="text-white">{email}</span> is registered, a password-reset link has been sent.</p>
              <button onClick={() => router.push(backUrl)} className="mt-6 inline-flex w-full justify-center py-3 rounded-lg font-semibold text-white text-sm" style={gradient}>Back to Sign In</button>
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
              <a href={backUrl} className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors pt-1"><ArrowLeft size={13} /> Back to Sign In</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
