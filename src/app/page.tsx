'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { login, loginRemote, saveSession, getDashboardRoute, authApiEnabled } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { Boxes, Eye, EyeOff, Shield, Users, User } from 'lucide-react'
import clsx from 'clsx'

type RoleTab = 'superadmin' | 'admin' | 'customer'

// Demo creds: backend (email + JWT) when an API is configured, else mock usernames.
const ROLE_TABS: { id: RoleTab; label: string; icon: React.ReactNode; hint: { user: string; pass: string } }[] = authApiEnabled
  ? [
      { id: 'superadmin', label: 'Super Admin', icon: <Shield size={14} />, hint: { user: 'super@oneops.demo', pass: 'demo1234' } },
      { id: 'admin', label: 'Admin', icon: <Users size={14} />, hint: { user: 'admin@kmutt.demo', pass: 'demo1234' } },
      { id: 'customer', label: 'Customer', icon: <User size={14} />, hint: { user: 'viewer@kmutt.demo', pass: 'demo1234' } },
    ]
  : [
      { id: 'superadmin', label: 'Super Admin', icon: <Shield size={14} />, hint: { user: 'superadmin', pass: 'admin123' } },
      { id: 'admin', label: 'Admin', icon: <Users size={14} />, hint: { user: 'admin', pass: 'admin123' } },
      { id: 'customer', label: 'Customer', icon: <User size={14} />, hint: { user: 'customer', pass: 'customer123' } },
    ]

export default function LoginPage() {
  const router = useRouter()
  const [activeRole, setActiveRole] = useState<RoleTab>('admin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')
    if (!username || !password) {
      setError('Please enter username and password')
      return
    }
    setLoading(true)
    // Real backend (JWT) when configured; the username field carries the email.
    const user = authApiEnabled ? await loginRemote(username, password) : (await new Promise((r) => setTimeout(r, 600)), login(username, password))
    if (!user) {
      setError(authApiEnabled ? 'Invalid credentials.' : 'Invalid credentials. Check the hints below.')
      setLoading(false)
      return
    }
    saveSession(user)
    // Sync the active org + user so the app shows this tenant's data.
    if (user.orgId) useAppStore.getState().setSelectedOrgId(user.orgId)
    useAppStore.getState().setViewerUserId(user.id)
    router.push(getDashboardRoute(user))
  }

  const fillHint = (role: RoleTab) => {
    const tab = ROLE_TABS.find((t) => t.id === role)!
    setUsername(tab.hint.user)
    setPassword(tab.hint.pass)
    setActiveRole(role)
    setError('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0e1a' }}>
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)`,
          backgroundSize: '50px 50px',
        }}
      />
      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: '#6366f1' }} />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-5 blur-3xl" style={{ background: '#06b6d4' }} />

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Boxes size={24} className="text-white" />
            </div>
            <div className="text-left">
              <div className="text-2xl font-bold tracking-widest text-white">ONEOPS</div>
              <div className="text-xs tracking-[0.3em] text-indigo-400 uppercase">Operations Platform</div>
            </div>
          </div>
          <p className="text-slate-500 text-sm">Unified multi-sensor operations — Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8 glass" style={{ border: '1px solid #1e2433' }}>
          {/* Role selector */}
          <div className="flex rounded-lg p-1 mb-6" style={{ background: '#0a0e1a' }}>
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveRole(tab.id)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-all',
                  activeRole === tab.id
                    ? 'text-white'
                    : 'text-slate-500 hover:text-slate-300'
                )}
                style={activeRole === tab.id ? { background: '#6366f1' } : {}}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Enter username"
                className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Enter password"
                  className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all pr-12"
                  style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                />
                <button
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-xs py-2 px-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-3 rounded-lg font-semibold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: loading ? '#4f46e5' : 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </div>

          {/* Register / forgot password */}
          <div className="flex items-center justify-between mt-4 text-xs">
            <a href="/forgot/" className="text-slate-500 hover:text-indigo-400 transition-colors">Forgot password?</a>
            <a href="/register/" className="text-slate-400 hover:text-white transition-colors">Create an account →</a>
          </div>

          {/* Demo hints removed for production */}
        </div>

        <p className="text-center text-slate-700 text-xs mt-6">
          ONEOPS Unified Operations Platform v1.0 — © 2026
        </p>
      </div>
    </div>
  )
}
