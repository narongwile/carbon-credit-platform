import type { User } from '@/types'

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
