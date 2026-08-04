import { useEffect, useState } from 'react'
import type { User } from '@/types'
import { api, apiEnabled, setToken } from './api'

export const authApiEnabled = apiEnabled

const USERS: User[] = [
  { id: 'u1', username: 'superadmin', role: 'superadmin', name: 'System Administrator', email: 'superadmin@eternity.io' },
  { id: 'u2', username: 'admin', role: 'admin', orgId: 'org-1', name: 'KMUTT Facility Admin', email: 'admin@kmutt.ac.th' },
  { id: 'u3', username: 'customer', role: 'customer', orgId: 'org-1', name: 'Facility Viewer', email: 'viewer@kmutt.ac.th' },
]

const PASSWORDS: Record<string, string> = {
  superadmin: 'admin123',
  admin: 'admin123',
  customer: 'customer123',
}

export function login(username: string, password: string): User | null {
  const user = USERS.find((u) => u.username === username)
  if (!user) return null
  if (PASSWORDS[username] !== password) return null
  return user
}

/**
 * Real login via the backend (JWT). The username field carries the email.
 * Maps the backend role ('viewer') to the app role ('customer').
 *
 * Returns the backend's actual error and status on failure — a wrong
 * password (401), too many attempts (429) and a suspended org (403) are
 * different situations needing different messages, not one generic
 * "Invalid credentials" that hides which one actually happened.
 */
export async function loginRemote(email: string, password: string): Promise<
  { ok: true; user: User } | { ok: false; status: number; error: string }
> {
  const r = await api.login(email, password)
  if (!r.ok) return r
  const u = r.user
  const role = (u.role === 'viewer' ? 'customer' : u.role) as User['role']
  return {
    ok: true,
    user: { id: u.id, username: u.email || u.id, role, orgId: u.orgId || undefined, name: u.name || u.email || u.id, email: u.email || '' },
  }
}

export function saveSession(user: User): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('eternity_user', JSON.stringify(user))
  }
}

export function getSession(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('eternity_user')
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('eternity_user')
  }
  setToken(null) // drop the JWT too
}

/**
 * The logged-in user's orgId, safe to read during render on a statically
 * exported page.
 *
 * getSession() checks `typeof window === 'undefined'` and returns null at
 * build time, so a page built as `const orgId = getSession()?.orgId ||
 * 'org-1'` bakes 'org-1' into the static HTML. In the browser that same line
 * runs with `window` defined and returns the REAL session synchronously, on
 * the very first client render — there is no microtask deferral to hide
 * behind, unlike zustand's persisted store. Every returning user therefore
 * hit a guaranteed hydration mismatch (React errors #418/#423/#425): the customer
 * portal computed a different orgId server vs. client, which meant a
 * different set of viewer <option>s and a different org name/logo in the very
 * first paint.
 *
 * This starts at the build-time default and swaps to the real value inside
 * useEffect, i.e. after hydration — an ordinary post-mount update, not a
 * mismatch, exactly like the collapsed-sidebar and hasHydrated patterns
 * already used elsewhere in this app.
 */
export function useSessionOrgId(fallback = 'org-1'): string {
  const [orgId, setOrgId] = useState(fallback)
  useEffect(() => {
    const real = getSession()?.orgId
    if (real) setOrgId(real)
  }, [fallback])
  return orgId
}

/**
 * The logged-in user's role, safe to read during render — same reasoning and
 * same fix shape as useSessionOrgId. `getSession()?.role` read directly in a
 * render body (e.g. `isSuper = getSession()?.role === 'superadmin'`) is null
 * in the statically-built HTML and the real role on the client's first paint,
 * so any JSX branching on it (extra columns, extra fields) mismatches.
 */
export function useSessionRole(): User['role'] | null {
  const [role, setRole] = useState<User['role'] | null>(null)
  useEffect(() => { setRole(getSession()?.role ?? null) }, [])
  return role
}

/**
 * The full session, safe to read during render — same reasoning as
 * useSessionOrgId/useSessionRole. Prefer this over calling getSession()
 * directly anywhere its result (or a field of it) is rendered into JSX rather
 * than only used inside an effect or an event handler, where the timing
 * doesn't matter because nothing gets hydrated against it.
 */
export function useSession(): User | null {
  const [session, setSession] = useState<User | null>(null)
  useEffect(() => { setSession(getSession()) }, [])
  return session
}

export function getDashboardRoute(user: User): string {
  switch (user.role) {
    case 'superadmin':
      return '/superadmin'
    case 'admin':
      return '/admin'
    case 'customer':
      return '/customer'
    default:
      return '/'
  }
}
