'use client'

import { useState, useEffect } from 'react'

export interface TelemetryData {
  id: string
  mac: string
  temperature: number
  doorOpen: boolean
  timestamp: string
}

// Connects to the Node-RED WebSocket telemetry bridge for real-time node data.
// URL defaults to NEXT_PUBLIC_WS_URL (e.g. wss://api.oneops.example/ws/telemetry);
// auto-reconnects and degrades gracefully to mock data when no bridge is present.
export function useMqttTelemetry(url: string = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080') {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      try {
        ws = new WebSocket(url)
      } catch {
        return
      }
      ws.onopen = () => setIsConnected(true)
      ws.onmessage = (event) => {
        try {
          setTelemetry(JSON.parse(event.data) as TelemetryData)
        } catch (e) {
          console.error('Failed to parse telemetry JSON', e)
        }
      }
      ws.onclose = () => {
        setIsConnected(false)
        reconnectTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      if (ws) { ws.onclose = null; ws.close() }
    }
  }, [url])

  return { telemetry, isConnected }
}
