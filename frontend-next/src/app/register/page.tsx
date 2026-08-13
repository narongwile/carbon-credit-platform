'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, UserPlus, ArrowLeft, CheckCircle2, Boxes, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, apiImageUrl } from '@/lib/api'
import { authApiEnabled } from '@/lib/auth'
import { getOrgFromLocation, getOrgWorkspaceUrl } from '@/lib/orgResolver'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', email: '', phone: '', password: '', confirm: '', orgName: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null)
  const [orgLogoFailed, setOrgLogoFailed] = useState(false)

  useEffect(() => {
    const org = getOrgFromLocation()
    if (org) {
      setOrgId(org)
      setOrgLogoUrl(apiImageUrl(`/api/public/orgs/${encodeURIComponent(org)}/logo`))
    }
  }, [])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.username || !form.email || !form.password) { toast.error('Please fill in all fields'); return }
    if (!orgId && !form.orgName.trim()) { toast.error('Please enter your Organization / Company name'); return }
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return }
    setLoading(true)
    try {
      if (!authApiEnabled) {
        await new Promise(r => setTimeout(r, 600))
        setDone(true)
        toast.success('Account created (Demo Mode)')
        return
      }
      const r = await api.register({
        name: form.username,
        email: form.email,
        phone: form.phone,
        password: form.password,
        orgId: orgId || undefined,
        orgName: !orgId ? form.orgName.trim() : undefined,
      })
      if (!r || (r as any).error) throw new Error((r as any)?.error || 'Registration failed')
      const targetOrg = (r as any).orgId || orgId
      if (targetOrg) setCreatedOrgId(targetOrg)
      const isPending = !!(r as any).pending
      setDone(true)
      toast.success(
        isPending
          ? `Registration submitted! Awaiting administrator approval.`
          : orgId
          ? `Account created — assigned to ${orgId} as Viewer!`
          : `Organization ${targetOrg || 'workspace'} & Admin account created successfully!`
      )
    } catch (err: any) {
      toast.error(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const backUrl = orgId ? `/?org=${encodeURIComponent(orgId)}` : '/'

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0e1a' }}>
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: '#6366f1' }} />

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
                  <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">Create Account</div>
                </div>
              </div>
            )}
          </div>
          <p className="text-slate-500 text-sm">
            {orgId ? (
              <>Register to request <span className="text-indigo-400 font-medium">Viewer</span> access to <span className="text-white font-semibold">{orgId}</span></>
            ) : (
              'Create a new organization workspace & admin account'
            )}
          </p>
        </div>

        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {done ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(74,222,128,0.12)' }}>
                <CheckCircle2 size={34} className="text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {orgId ? 'Registration Submitted — Pending Approval' : 'Workspace Created!'}
              </h3>
              <p className="text-sm text-slate-400 mt-2">
                {orgId ? (
                  <>
                    Your registration for <span className="text-white font-medium">{form.username}</span> ({form.email}) has been submitted to{' '}
                    <span className="text-indigo-400 font-semibold">{orgId}</span> administrators.
                    <br /><br />
                    Once an admin reviews and approves your account, you will receive an activation email & notification.
                  </>
                ) : (
                  <>
                    Organization workspace <span className="text-indigo-400 font-semibold">{createdOrgId || form.orgName}</span> and Admin account for <span className="text-white">{form.email}</span> are ready.
                  </>
                )}
              </p>
              <button
                onClick={() => {
                  if (createdOrgId && !orgId) {
                    window.location.href = getOrgWorkspaceUrl(createdOrgId)
                  } else {
                    router.push(backUrl)
                  }
                }}
                className="mt-6 w-full py-3 rounded-lg font-semibold text-white text-sm hover:opacity-90 transition-all"
                style={gradient}
              >
                {createdOrgId && !orgId ? `Go to ${createdOrgId} Workspace →` : 'Back to Sign In'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {!orgId && (
                <div>
                  <label className="block text-xs text-indigo-400 mb-1.5 uppercase tracking-wider font-semibold">Organization / Company Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.orgName}
                      onChange={(e) => set('orgName', e.target.value)}
                      placeholder="e.g. KMUTT Industrial Energy"
                      className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 pl-10"
                      style={inset}
                    />
                    <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  </div>
                </div>
              )}
              <Field label="Username / Full Name" value={form.username} onChange={(v) => set('username', v)} placeholder="your full name" />
              <Field label="Email" value={form.email} onChange={(v) => set('email', v)} placeholder="you@company.com" />
              <Field label="Phone Number" value={form.phone} onChange={(v) => set('phone', v)} placeholder="08x-xxx-xxxx" />
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="create a password"
                    className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 pr-12"
                    style={inset}
                  />
                  <button
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <Field label="Confirm Password" type="password" value={form.confirm} onChange={(v) => set('confirm', v)} placeholder="repeat password" />
              {form.confirm && form.password !== form.confirm && <p className="text-xs text-red-400">Passwords do not match.</p>}

              <button
                onClick={submit}
                disabled={loading}
                className="w-full py-3 rounded-lg font-semibold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-all"
                style={gradient}
              >
                <UserPlus size={16} /> {loading ? 'Creating…' : (orgId ? 'Register as Viewer' : 'Create Organization & Admin Account')}
              </button>
              <a href={backUrl} className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors pt-1">
                <ArrowLeft size={13} /> Back to Sign In
              </a>
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
