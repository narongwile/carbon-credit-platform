import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { nodeMeta, effectiveAccess, canSeeNode, eventNode } from './repo.js'

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const TTL = process.env.JWT_TTL || '12h'

// Fail fast: never run production on the dev signing secret.
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-me') {
  throw new Error('[auth] JWT_SECRET must be set to a strong value in production')
}

// In-memory login throttle (per client IP): too many FAILED attempts → 429.
const loginAttempts = new Map<string, { n: number; resetAt: number }>()
const clientIp = (req: Request) => ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()) || req.ip || 'unknown'
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const max = Number(process.env.LOGIN_MAX_ATTEMPTS || 10)
  const windowMs = Number(process.env.LOGIN_WINDOW_MIN || 15) * 60_000
  const key = clientIp(req)
  const rec = loginAttempts.get(key)
  if (rec && Date.now() < rec.resetAt && rec.n >= max) {
    return res.status(429).json({ error: 'too many login attempts — try again later' })
  }
  next()
}
export function noteLoginFailure(req: Request) {
  const windowMs = Number(process.env.LOGIN_WINDOW_MIN || 15) * 60_000
  const key = clientIp(req); const now = Date.now(); const rec = loginAttempts.get(key)
  if (!rec || now > rec.resetAt) loginAttempts.set(key, { n: 1, resetAt: now + windowMs })
  else rec.n++
}
export const noteLoginSuccess = (req: Request) => loginAttempts.delete(clientIp(req))

export interface Claims { userId: string; orgId: string; role: string }

export const signToken = (c: Claims) => jwt.sign(c, SECRET, { expiresIn: TTL } as jwt.SignOptions)
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)
export const hashPassword = (plain: string) => bcrypt.hash(plain, 10)

declare global { namespace Express { interface Request { auth?: Claims } } }

// Attach claims from a Bearer token (no rejection here — guards decide).
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization || ''
  const tok = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (tok) { try { req.auth = jwt.verify(tok, SECRET) as Claims } catch { /* invalid → unauthenticated */ } }
  next()
}

// Require a valid token (any role).
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  next()
}

// Require one of the given roles (superadmin always allowed).
export const requireRole = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  if (req.auth.role === 'superadmin' || roles.includes(req.auth.role)) return next()
  return res.status(403).json({ error: `requires role: ${roles.join('/')}` })
}

// Device (node) access: the :id node must be in the caller's org and within
// their effective product access + department; write ops require 'manage'.
export const requireNode = (write = false) => async (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  if (req.auth.role === 'superadmin') return next()
  const node = await nodeMeta(req.params.id)
  if (!node) return res.status(404).json({ error: 'node not found' })
  const access = await effectiveAccess(req.auth.userId)
  if (!access || !canSeeNode(access, node, write)) return res.status(403).json({ error: 'no access to this device' })
  next()
}

// Event access: viewers with `view` may acknowledge (to set root cause); set
// write=true to require `manage`. Always scoped to the event's node org + dept.
export const requireEvent = (write = false) => async (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  if (req.auth.role === 'superadmin') return next()
  const node = await eventNode(req.params.id)
  if (!node) return res.status(404).json({ error: 'event not found' })
  const access = await effectiveAccess(req.auth.userId)
  if (!access || !canSeeNode(access, node, write)) return res.status(403).json({ error: 'no access to this event' })
  next()
}

// Non-superadmin may only touch their own org (checks :orgId / :id route param,
// or an orgId in the body) — keeps admins inside their tenant.
export const orgScope = (param = 'orgId') => (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  if (req.auth.role === 'superadmin') return next()
  const target = (req.params[param] ?? req.body?.orgId) as string | undefined
  if (target && target !== req.auth.orgId) return res.status(403).json({ error: 'outside your organization' })
  next()
}
