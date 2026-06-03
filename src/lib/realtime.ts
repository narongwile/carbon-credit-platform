'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from './store'

const SENSOR_KEYS = ['oilTemperature', 'hydrogen', 'moisture', 'oilLevel', 'load', 'ambientTemperature']

const VARIANCES: Record<string, number> = {
  oilTemperature: 0.4,
  hydrogen: 2.5,
  moisture: 0.2,
  oilLevel: 0.08,
  load: 0.8,
  ambientTemperature: 0.1,
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

function fluctuate(value: number, variance: number, min: number, max: number): number {
  const delta = (Math.random() - 0.5) * variance * 2
  return parseFloat(clamp(value + delta, min, max).toFixed(2))
}

export function useRealtimeData() {
  const realtimeEnabled = useAppStore((s) => s.realtimeEnabled)
  const updateTransformerSensor = useAppStore((s) => s.updateTransformerSensor)
  // Use a ref so the interval callback always reads latest transformers without re-subscribing
  const transformersRef = useRef(useAppStore.getState().transformers)

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      transformersRef.current = state.transformers
    })
  }, [])

  useEffect(() => {
    if (!realtimeEnabled) return

    const id = setInterval(() => {
      transformersRef.current.forEach((t) => {
        SENSOR_KEYS.forEach((key) => {
          const sensor = t.sensors[key as keyof typeof t.sensors]
          const newVal = fluctuate(sensor.value, VARIANCES[key] ?? 0.5, sensor.min, sensor.max)
          updateTransformerSensor(t.id, key, newVal)
        })
      })
    }, 1500)

    return () => clearInterval(id)
  }, [realtimeEnabled, updateTransformerSensor])
}
