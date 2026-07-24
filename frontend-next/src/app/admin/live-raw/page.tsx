'use client'

// ---------------------------------------------------------------------------
// Live Raw Telemetry — shows EVERY key/value an online device publishes, live.
// The domain dashboards render curated fields (temp, hydrogen, …); this page is
// the go-live verification surface: whatever an ESP32 puts in its `values`
// object shows up here verbatim, no allow-list.
//
// Two data sources merged, so it works even before the WS cert is trusted:
//   • HTTP baseline — polls /api/fleet (device list) + /api/fleet/:id/latest
//     (all stored values) every few seconds.
//   • WS overlay — subscribeTelemetry() pushes real-time frames (frame.values)
//     the moment the browser can reach wss:///ws/telemetry.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { subscribeTelemetry, subscribeConnection } from '@/lib/telemetryBus'
import { Radio, RefreshCw, Wifi, WifiOff, Database } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface DeviceRow {
  id: string
  name: string
  online: 0 | 1 | null
  values: Record<string, number>
  ts: string | null
  src: 'ws' | 'http' | null
  pending?: boolean
}

export default function LiveRawTelemetryPage() {
  const live = useIsLive()
  const orgId = useAppStore((s) => s.selectedOrgId)
  const [rows, setRows] = useState<Map<string, DeviceRow>>(new Map())
  const [connected, setConnected] = useState(false)
  const [lastPoll, setLastPoll] = useState<string>('—')
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // HTTP baseline: device list + every stored value per device.
  const poll = useCallback(async () => {
    if (!live || !orgId) return
    // ACTIVE fleet (readings) + PENDING devices (last_sample). A freshly-connected
    // ESP is auto-registered as 'pending' and is NOT in /api/fleet (active only),
    // so without the pending poll a brand-new device would never appear here.
    const [fleet, pending] = await Promise.all([api.fleet(orgId), api.pendingNodes(orgId)])
    if (!fleet && !pending) return
    const next = new Map(rowsRef.current)
    const keep = new Set<string>()
    ;(fleet ?? []).forEach((f) => keep.add(f.id))
    ;(pending ?? []).forEach((p) => keep.add(p.id))
    for (const id of Array.from(next.keys())) if (!keep.has(id)) next.delete(id)
    await Promise.all(
      (fleet ?? []).map(async (f) => {
        const latest = await api.latest(f.id)
        const prev = next.get(f.id)
        // Don't clobber a fresher WS frame with a slower HTTP poll.
        const httpTs = latest?.lastReadingAt ?? null
        const keepWs = prev?.src === 'ws' && prev.ts && httpTs && new Date(prev.ts) >= new Date(httpTs)
        next.set(f.id, {
          id: f.id,
          name: f.name,
          online: f.online,
          values: keepWs ? prev!.values : (latest?.values ?? prev?.values ?? {}),
          ts: keepWs ? prev!.ts : (httpTs ?? prev?.ts ?? null),
          src: keepWs ? 'ws' : 'http',
          pending: false,
        })
      })
    )
    // Pending (unapproved) devices — last_sample IS the raw values the ESP sent.
    ;(pending ?? []).forEach((p) => {
      const prev = next.get(p.id)
      if (prev && prev.src === 'ws' && !prev.pending) return // an active WS row wins
      next.set(p.id, {
        id: p.id,
        name: p.name || p.id,
        online: p.online,
        values: p.last_sample ?? prev?.values ?? {},
        ts: p.last_seen ?? prev?.ts ?? null,
        src: 'http',
        pending: true,
      })
    })
    setRows(next)
    setLastPoll(new Date().toLocaleTimeString())
  }, [live, orgId])

  useEffect(() => {
    if (!live) return
    poll()
    const t = setInterval(poll, 4000)
    return () => clearInterval(t)
  }, [live, poll])

  // WS overlay: merge real-time frames as they arrive (all keys in frame.values).
  useEffect(() => {
    if (!live) return
    const offConn = subscribeConnection(setConnected)
    const offFrame = subscribeTelemetry((f) => {
      if (f.type === 'alarm' || !f.values) return
      setRows((cur) => {
        const next = new Map(cur)
        const prev = next.get(f.id)
        next.set(f.id, {
          id: f.id,
          name: prev?.name ?? f.id,
          online: 1,
          values: { ...(prev?.values ?? {}), ...f.values },
          ts: f.timestamp,
          src: 'ws',
        })
        return next
      })
    })
    return () => { offConn(); offFrame() }
  }, [live])

  const list = Array.from(rows.values()).sort((a, b) => a.id.localeCompare(b.id))
  const totalKeys = list.reduce((n, r) => n + Object.keys(r.values).length, 0)

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio size={20} className="text-indigo-400" /> Live Raw Telemetry
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Every value each online device publishes — no field filtering. Go-live verification.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={connected ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80' } : { background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />} {connected ? 'WS live' : 'WS offline'}
          </span>
          <button onClick={poll} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-slate-300 hover:text-white" style={inset}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {!live ? (
        <div className="rounded-xl p-8 text-center" style={surface}>
          <Database size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">Live backend is not enabled — switch to <span className="text-white font-medium">Live</span> mode to see real telemetry.</p>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={surface}>
          <Radio size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">No telemetry yet for this organization. An online ESP32 publishing MQTT will appear here within seconds.</p>
          <p className="text-xs text-slate-600 mt-2">Last poll: {lastPoll}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span><span className="text-white font-semibold">{list.length}</span> devices</span>
            <span><span className="text-white font-semibold">{totalKeys}</span> values</span>
            <span>Last poll: {lastPoll}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {list.map((r) => {
              const keys = Object.keys(r.values).sort()
              return (
                <div key={r.id} className="rounded-xl p-4" style={surface}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${r.online === 1 ? 'bg-emerald-400' : 'bg-slate-600'}`}
                        style={r.online === 1 ? { boxShadow: '0 0 6px #4ade80' } : {}} />
                      <span className="text-sm font-semibold text-white truncate">{r.name || r.id}</span>
                      <span className="text-[10px] text-slate-500 font-mono truncate">{r.id}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.pending && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>PENDING</span>
                      )}
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                        style={r.src === 'ws' ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80' } : { background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>
                        {r.src === 'ws' ? 'LIVE' : 'HTTP'}
                      </span>
                    </div>
                  </div>
                  {keys.length === 0 ? (
                    <p className="text-xs text-slate-600 py-2">No values received yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {keys.map((k) => (
                        <div key={k} className="rounded-lg px-2.5 py-1.5" style={inset}>
                          <div className="text-[10px] text-slate-500 font-mono truncate" title={k}>{k}</div>
                          <div className="text-sm text-white font-semibold tabular-nums">
                            {typeof r.values[k] === 'number' ? Number(r.values[k].toFixed(3)) : String(r.values[k])}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-3">
                    {r.ts ? `updated ${new Date(r.ts).toLocaleTimeString()}` : 'no timestamp'}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
