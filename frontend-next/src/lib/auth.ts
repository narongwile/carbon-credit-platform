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

// Real login via the backend (JWT). The username field carries the email.
// Maps the backend role ('viewer') to the app role ('customer').
export async function loginRemote(email: string, password: string): Promise<User | null> {
  const r = await api.login(email, password)
  if (!r?.user) return null
  const u = r.user
  const role = (u.role === 'viewer' ? 'customer' : u.role) as User['role']
  return { id: u.id, username: u.email || u.id, role, orgId: u.orgId || undefined, name: u.name || u.email || u.id, email: u.email || '' }
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
