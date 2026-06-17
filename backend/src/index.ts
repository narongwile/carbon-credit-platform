import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { router } from './routes.js'
import { startMqtt } from './mqtt.js'
import { startEscalation } from './escalation.js'
import { startClearance } from './clearance.js'
import { ping } from './db.js'

const app = express()
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(express.json({ limit: '15mb' })) // large limit for document upload
app.use('/api', router)

const port = Number(process.env.PORT || 4000)

async function main() {
  const dbOk = await ping()
  console.log(`[db] ${dbOk ? 'connected' : 'NOT reachable — check DB_* env'}`)
  startMqtt()
  startEscalation()
  startClearance()
  app.listen(port, () => console.log(`[http] ONEOPS backend on :${port}`))
}

main().catch((e) => { console.error(e); process.exit(1) })
