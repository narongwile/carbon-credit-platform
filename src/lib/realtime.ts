'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import { subscribeTelemetry, subscribeConnection } from './telemetryBus'

// Map Node-RED telemetry value keys → transformer sensor keys (handles the
// firmware/flow naming variants for the same channel).
const TX_KEY_MAP: Record<string, string> = {
  oilTemp: 'oilTemperature', oilTemperature: 'oilTemperature', temp: 'oilTemperature',
  hydrogen: 'hydrogen', h2: 'hydrogen',
  moisture: 'moisture', h2o: 'moisture',
  oilLevel: 'oilLevel', level: 'oilLevel',
  load: 'load',
  ambient: 'ambientTemperature', ambientTemp: 'ambientTemperature', ambientTemperature: 'ambientTemperature',
}

// ── Offline fallback only (no live pipe): gentle fluctuation so the demo moves
// without a backend. Real Node-RED data takes over the moment WS connects. ──
const SENSOR_KEYS = ['oilTemperature', 'hydrogen', 'moisture', 'oilLevel', 'load', 'ambientTemperature']
const VARIANCES: Record<string, number> = {
  oilTemperature: 0.4, hydrogen: 2.5, moisture: 0.2, oilLevel: 0.08, load: 0.8, ambientTemperature: 0.1,
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const fluctuate = (value: number, variance: number, min: number, max: number) =>
  parseFloat(clamp(value + (Math.random() - 0.5) * variance * 2, min, max).toFixed(2))

// Apply one live telemetry frame to the matching transformer's sensors.
function applyFrame(id: string, values: Record<string, number>) {
  const st = useAppStore.getState()
  if (!st.realtimeEnabled) return
  const t = st.transformers.find((x) => x.id === id)
  if (!t) return
  for (const [k, v] of Object.entries(values)) {
    const key = TX_KEY_MAP[k]
    if (key && key in t.sensors && typeof v === 'number') st.updateTransformerSensor(t.id, key, v)
  }
}

// Drives the Transformers pages from real Node-RED telemetry (shared WS pipe),
// replacing the old random simulation. Random fluctuation now runs only as an
// offline fallback while the live pipe is disconnected.
export function useRealtimeData() {
  const realtimeEnabled = useAppStore((s) => s.realtimeEnabled)
  const connectedRef = useRef(false)

  // Live: every telemetry frame from Node-RED updates the matching transformer.
  useEffect(() => {
    const offFrame = subscribeTelemetry((f) => {
      if (f.type === 'alarm' || !f.values) return
      applyFrame(f.id, f.values)
    })
    const offConn = subscribeConnection((on) => { connectedRef.current = on })
    return () => { offFrame(); offConn() }
  }, [])

  // Fallback: gentle random fluctuation ONLY while the live pipe is down.
  useEffect(() => {
    if (!realtimeEnabled) return
    const id = setInterval(() => {
      if (connectedRef.current) return                 // live data is flowing — don't fake it
      const st = useAppStore.getState()
      st.transformers.forEach((t) => {
        SENSOR_KEYS.forEach((key) => {
          const sensor = t.sensors[key as keyof typeof t.sensors]
          st.updateTransformerSensor(t.id, key, fluctuate(sensor.value, VARIANCES[key] ?? 0.5, sensor.min, sensor.max))
        })
      })
    }, 1500)
    return () => clearInterval(id)
  }, [realtimeEnabled])
}
