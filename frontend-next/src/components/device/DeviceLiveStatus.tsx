'use client'

// ---------------------------------------------------------------------------
// Header badge showing what the DEVICE is doing, not what the app is doing.
// ---------------------------------------------------------------------------
// The device pages used to print a permanently spinning "Live" (and the node
// page a status from the seed fleet), so the header stayed green while the
// event log right below it said the device had been offline for ten minutes.
//
// The state comes from device_presence — the same row the offline sweep writes —
// so the badge, the Event Log and the Transport timeline can never disagree.
// It refreshes on every telemetry frame for this node (WebSocket) and polls as a
// backstop, because going offline produces no frame to react to.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api, useIsLive, type DevicePresence } from '@/lib/api'
import { subscribeTelemetry } from '@/lib/telemetryBus'
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { fmtDateTime } from '@/lib/displayTime'

/** Presence is authoritative, but the sweep only runs every 10s — a frame that
 *  just arrived means the device is up regardless of what the row still says. */
const FRESH_MS = 90_000

const ago = (iso: string | null | undefined): string => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return fmtDateTime(iso)
}

export default function DeviceLiveStatus({ nodeId }: { nodeId: string }) {
  const live = useIsLive()
  const [presence, setPresence] = useState<DevicePresence | null>(null)
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null)
  // Bumped on a timer purely to re-render: both "12s ago" and the amber
  // no-data state are functions of the clock, not of any state change.
  const [, tick] = useState(0)

  useEffect(() => {
    if (!live || !nodeId) { setPresence(null); setLastFrameAt(null); return }
    let cancelled = false
    const load = () => {
      api.latest(nodeId).then((r) => {
        if (cancelled || !r) return
        setPresence(r.presence ?? null)
        if (r.lastReadingAt) setLastFrameAt(new Date(r.lastReadingAt).getTime())
      })
    }
    load()
    const t = setInterval(load, 10000)
    const off = subscribeTelemetry((f) => {
      if (f.id === nodeId && f.type !== 'alarm') setLastFrameAt(Date.now())
    })
    // Re-render on a timer so "12s ago" keeps counting and a device that goes
    // quiet turns amber without waiting for the next poll. Re-setting
    // lastFrameAt to its own value would NOT do it — React bails out on an
    // unchanged value — hence a dedicated counter.
    const beat = setInterval(() => tick((n) => n + 1), 5000)
    return () => { cancelled = true; clearInterval(t); clearInterval(beat); off() }
  }, [live, nodeId])

  if (!live) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-500" title="Demo mode — no device is connected">
        <RefreshCw size={11} className="text-slate-500" /> Demo
      </span>
    )
  }

  const streaming = lastFrameAt !== null && Date.now() - lastFrameAt < FRESH_MS
  const online = streaming || presence?.online === 1
  const seenAt = (streaming && lastFrameAt ? new Date(lastFrameAt).toISOString() : null)
    || presence?.last_reading_at
    || presence?.last_seen
    || null

  // Online but nothing arriving = the link is quiet; the sweep has not declared
  // it offline yet. Saying so beats a green light that is about to turn red.
  const stale = online && !streaming

  const [color, dot, label] = stale
    ? ['text-amber-400', 'bg-amber-400', 'NO DATA']
    : online
      ? ['text-green-400', 'bg-green-400', 'ONLINE']
      : ['text-slate-500', 'bg-slate-500', 'OFFLINE']

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span
        className={`flex items-center gap-1.5 text-xs font-medium ${color}`}
        title={`Last reading ${ago(seenAt)}${presence?.fw ? ` · fw ${presence.fw}` : ''}${presence?.rssi != null ? ` · RSSI ${presence.rssi}` : ''}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dot} ${online && streaming ? 'animate-pulse' : ''}`} />
        {online ? <Wifi size={12} /> : <WifiOff size={12} />}
        {label}
        <span className="text-slate-600 font-normal">· {ago(seenAt)}</span>
      </span>

      {presence?.identity_conflict_at && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/90 text-rose-300 border border-rose-500/60 animate-pulse shadow-sm"
          title={`🚨 ตรวจพบอุปกรณ์ 2 ตัวแย่งกันส่งข้อมูลภายใต้ nodeId '${nodeId}' เดียวกัน (เริ่มตรวจพบ: ${fmtDateTime(presence.identity_conflict_at)}) กรุณาตรวจสอบการตั้งค่าฮาร์ดแวร์`}
        >
          <AlertTriangle size={11} className="text-rose-400" />
          <span>ID CONFLICT (ชนกัน)</span>
        </span>
      )}
    </span>
  )
}
