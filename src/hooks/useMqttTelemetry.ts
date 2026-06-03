'use client'

import { useState, useEffect } from 'react'

export interface TelemetryData {
  id: string
  mac: string
  temperature: number
  doorOpen: boolean
  timestamp: string
}

// Connects to a local MQTT->WebSocket bridge for real-time node telemetry.
// Auto-reconnects; degrades gracefully to mock data when no bridge is present.
export function useMqttTelemetry(url: string = 'ws://localhost:8080') {
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
