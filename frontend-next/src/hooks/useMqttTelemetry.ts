'use client'

import { useState, useEffect } from 'react'
import { subscribeTelemetry, subscribeConnection } from '@/lib/telemetryBus'

export interface TelemetryData {
  id: string
  mac: string
  temperature: number
  doorOpen: boolean
  timestamp: string
  values?: Record<string, number>
}

// Live node telemetry from the Node-RED WebSocket bridge, over a single shared
// connection (see telemetryBus). Returns the latest frame + connection state;
// degrades gracefully to mock data when no bridge is present.
export function useMqttTelemetry() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const offFrame = subscribeTelemetry((f) => {
      if (f.type === 'alarm') return                 // telemetry consumers ignore alarm frames
      setTelemetry(f as TelemetryData)
    })
    const offConn = subscribeConnection(setIsConnected)
    return () => { offFrame(); offConn() }
  }, [])

  return { telemetry, isConnected }
}
