import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'
import { effectiveAccess, canSeeNode, type Access } from './repo.js'

// ---------------------------------------------------------------------------
// Real-time telemetry bridge. The frontend (useMqttTelemetry hook, via
// telemetryBus.ts) opens a WebSocket to /ws/telemetry and sends {token} as its
// first message. Sits on the same HTTP server as the REST API, so nginx
// reverse-proxies /ws -> backend with no extra Service/port.
//
// Fail-closed: a socket that never sends a valid token is never registered
// and receives nothing. A registered socket only receives a frame for a node
// it could also read over REST — same rule requireNode()/canSeeNode() apply
// to GET /nodes/:id/readings etc. Without this, every connected browser (any
// org, any role) received every org's live telemetry, because only the REST
// endpoints were ever gated — the socket was wide open.
// ---------------------------------------------------------------------------

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const WS_PATH = '/ws/telemetry'
let wss: WebSocketServer | null = null

interface Session { orgId: string; role: string; access: Access | null }
const sessions = new WeakMap<WebSocket, Session>()

// Shape the frontend expects (src/hooks/useMqttTelemetry.ts TelemetryData),
// plus the raw values map for richer consumers.
interface TelemetryFrame {
  id: string
  mac: string
  temperature: number | null
  doorOpen: boolean
  timestamp: string
  values: Record<string, number>
}

export interface NodeMeta { org_id: string; domain: string; department_id: string | null }

function firstNumber(values: Record<string, number>, keys: string[]): number | null {
  for (const k of keys) if (typeof values[k] === 'number') return values[k]
  return null
}

export function startWsBridge(server: Server): void {
  // noServer: we handle the HTTP upgrade ourselves so non-telemetry paths are
  // rejected cleanly instead of hijacked.
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0]
    if (path !== WS_PATH) { socket.destroy(); return }
    wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit('connection', ws, req))
  })

  // Heartbeat: drop dead peers so we don't leak sockets behind the proxy.
  wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('error', () => ws.terminate())
    ws.on('close', () => sessions.delete(ws))

    // First (and any later) message is {token: "..."} — verify and register
    // this socket's org/role/access snapshot. Anything else is ignored.
    ws.on('message', (data) => {
      (async () => {
        let body: unknown
        try { body = JSON.parse(data.toString()) } catch { return }
        const tok = (body as { token?: string } | null)?.token
        if (!tok) return
        try {
          const claims = jwt.verify(tok, SECRET) as { userId: string; orgId: string; role: string }
          const access = (claims.role === 'admin' || claims.role === 'superadmin') ? null : await effectiveAccess(claims.userId)
          sessions.set(ws, { orgId: claims.orgId, role: claims.role, access })
        } catch { /* invalid token → not registered → receives nothing */ }
      })().catch(() => {})
    })
  })

  const interval = setInterval(() => {
    wss?.clients.forEach((c) => {
      const ws = c as WebSocket & { isAlive?: boolean }
      if (ws.isAlive === false) return ws.terminate()
      ws.isAlive = false
      ws.ping()
    })
  }, 30000)
  wss.on('close', () => clearInterval(interval))

  console.log(`[ws] telemetry bridge on ${WS_PATH}`)
}

// Called by the MQTT message handler for every telemetry sample. No-op until
// the bridge is started and at least one client is listening. `meta` is the
// node's org/domain/department (ingest() already looked it up for evaluation,
// so this costs no extra query); a frame for a node with no resolvable meta
// (not provisioned) is dropped rather than broadcast unscoped.
export function broadcastTelemetry(nodeId: string, values: Record<string, number>, meta: NodeMeta | null, ts?: number): void {
  if (!wss || wss.clients.size === 0) return
  const frame: TelemetryFrame = {
    id: nodeId,
    mac: nodeId,
    temperature: firstNumber(values, ['temperature', 'temp', 'tempC', 'oilTemp']),
    doorOpen: Number(values.door ?? values.doorOpen ?? 0) > 0,
    timestamp: new Date(ts ?? Date.now()).toISOString(),
    values,
  }
  const msg = JSON.stringify(frame)
  wss.clients.forEach((c) => {
    if (c.readyState !== WebSocket.OPEN) return
    const s = sessions.get(c)
    if (!s) return                                    // never authenticated → nothing
    if (s.role === 'superadmin') { c.send(msg); return }
    if (!meta || meta.org_id !== s.orgId) return
    if (s.role === 'admin') { c.send(msg); return }
    if (s.access && canSeeNode(s.access, meta, false)) c.send(msg)
  })
}
