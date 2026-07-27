import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'

// ---------------------------------------------------------------------------
// Real-time telemetry bridge. The frontend (useMqttTelemetry hook) opens a
// WebSocket to /ws/telemetry; this fans every MQTT telemetry message out to all
// connected browsers. Sits on the same HTTP server as the REST API, so nginx
// reverse-proxies /ws -> backend with no extra Service/port.
// ---------------------------------------------------------------------------

const WS_PATH = '/ws/telemetry'
let wss: WebSocketServer | null = null

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
// the bridge is started and at least one client is listening.
export function broadcastTelemetry(nodeId: string, values: Record<string, number>, ts?: number): void {
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
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(msg) })
}
