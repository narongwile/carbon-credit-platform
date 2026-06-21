'use client'

// ---------------------------------------------------------------------------
// Single shared WebSocket pipe to the Node-RED telemetry bridge (/ws/telemetry).
// One connection for the whole app — every page (Transformers, Refrigeration,
// BloodBOX) subscribes here instead of opening its own socket. Auto-reconnects
// and refcounts subscribers (closes when the last one unsubscribes).
// ---------------------------------------------------------------------------

export interface TelemetryFrame {
  id: string
  mac: string
  temperature: number | null
  doorOpen: boolean
  timestamp: string
  values?: Record<string, number>
  type?: string        // 'alarm' frames carry this; telemetry frames don't
  severity?: string
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080'

let ws: WebSocket | null = null
let connected = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const frameSubs = new Set<(f: TelemetryFrame) => void>()
const connSubs = new Set<(c: boolean) => void>()

function setConnected(c: boolean) {
  if (c === connected) return
  connected = c
  connSubs.forEach((cb) => cb(c))
}

function scheduleReconnect() {
  if (reconnectTimer || (frameSubs.size === 0 && connSubs.size === 0)) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 3000)
}

function connect() {
  if (typeof window === 'undefined') return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(WS_URL)
  } catch {
    scheduleReconnect()
    return
  }
  ws.onopen = () => setConnected(true)
  ws.onmessage = (e) => {
    let f: TelemetryFrame
    try { f = JSON.parse(e.data) } catch { return }
    frameSubs.forEach((cb) => cb(f))
  }
  ws.onclose = () => { setConnected(false); ws = null; scheduleReconnect() }
  ws.onerror = () => ws?.close()
}

function maybeClose() {
  if (frameSubs.size > 0 || connSubs.size > 0) return
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) { ws.onclose = null; ws.close(); ws = null }
  connected = false
}

/** Subscribe to every telemetry/alarm frame. Returns an unsubscribe fn. */
export function subscribeTelemetry(onFrame: (f: TelemetryFrame) => void): () => void {
  frameSubs.add(onFrame)
  connect()
  return () => { frameSubs.delete(onFrame); maybeClose() }
}

/** Subscribe to connection-state changes (fires immediately with the current state). */
export function subscribeConnection(onChange: (c: boolean) => void): () => void {
  connSubs.add(onChange)
  onChange(connected)
  connect()
  return () => { connSubs.delete(onChange); maybeClose() }
}

export function isTelemetryConnected(): boolean { return connected }
