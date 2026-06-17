import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { nodeMeta, effectiveAccess, canSeeNode, eventNode } from './repo.js'

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const TTL = process.env.JWT_TTL || '12h'

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

// Acknowledge requires 'manage' on the domain of the event's node (own org).
export const requireEventManage = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) return res.status(401).json({ error: 'authentication required' })
  if (req.auth.role === 'superadmin') return next()
  const node = await eventNode(req.params.id)
  if (!node) return res.status(404).json({ error: 'event not found' })
  const access = await effectiveAccess(req.auth.userId)
  if (!access || !canSeeNode(access, node, true)) return res.status(403).json({ error: 'manage required to acknowledge' })
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
