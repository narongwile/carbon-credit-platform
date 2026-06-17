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

const app = express()
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
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
