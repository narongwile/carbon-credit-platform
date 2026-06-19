import 'dotenv/config'
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { router } from './routes.js'
import { startMqtt } from './mqtt.js'
import { startEscalation } from './escalation.js'
import { startClearance } from './clearance.js'
import { startRetention } from './retention.js'
import { startReports } from './reports.js'
import { insertDeadLetter } from './repo.js'
import { authMiddleware } from './auth.js'
import { ping } from './db.js'
import { runMigrations } from './migrate.js'

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
if (process.env.NODE_ENV === 'production' && CORS_ORIGIN === '*') {
  console.warn('[security] CORS_ORIGIN is "*" in production — set it to your frontend origin')
}

const app = express()
app.disable('x-powered-by')
// Baseline security headers (no extra deps).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})
app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json({ limit: '15mb' })) // large limit for document upload
app.use(authMiddleware)                   // attach JWT claims (guards enforce)
app.use('/api', router)

// Global error handler → dead-letter (robustness; mirrors the Node-RED catch node)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  insertDeadLetter(`${req.method} ${req.path}`, err.message, req.body).catch(() => {})
  console.error('[error]', req.method, req.path, err.message)
  if (!res.headersSent) res.status(500).json({ error: 'internal error' })
})

const port = Number(process.env.PORT || 4000)

async function main() {
  // Auto-migrate: bootstrap schema + apply pending migrations (idempotent)
  await runMigrations()

  const dbOk = await ping()
  console.log(`[db] ${dbOk ? 'connected' : 'NOT reachable — check DB_* env'}`)
  startMqtt()
  startEscalation()
  startClearance()
  startRetention()
  startReports()
  app.listen(port, () => console.log(`[http] ONEOPS backend on :${port}`))
}

// Safety net: async route rejections surface here in Express 4 → dead-letter.
process.on('unhandledRejection', (reason) => {
  insertDeadLetter('unhandledRejection', String(reason), null).catch(() => {})
  console.error('[unhandledRejection]', reason)
})

main().catch((e) => { console.error(e); process.exit(1) })
