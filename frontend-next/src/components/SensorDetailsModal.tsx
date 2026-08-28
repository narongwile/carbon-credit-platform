import React, { useMemo, useState, useEffect, useCallback } from 'react'
import {
  X, Activity, Battery, Wifi, Cpu, Clock, AlertTriangle, ExternalLink,
  ShieldAlert, CheckCircle2, Radio, Server, Gauge, Zap, AlertCircle,
  RefreshCw, Search, Copy, Check, Play, Pause, Filter
} from 'lucide-react'
import clsx from 'clsx'
import { api, type DevicePresence } from '@/lib/api'
import { fmtDateTime } from '@/lib/displayTime'
import { schemaLabel } from '@/lib/useParamLabels'
import { ALARM_SCHEMA } from '@/lib/alarmParams'
import type { SensorDomain } from '@/types/fleet'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

interface Props {
  isOpen: boolean
  onClose: () => void
  nodeId: string | null
  deviceName?: string
  domain?: SensorDomain
  orgId?: string
  presence?: DevicePresence | null
  values?: Record<string, number>
  lastReadingAt?: string | null
}

function formatUptime(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m ${seconds % 60}s`
}

function rssiQuality(rssi?: number | null): { text: string; color: string } {
  if (rssi == null) return { text: 'Not reported', color: 'text-slate-500' }
  if (rssi >= -65) return { text: 'Excellent signal', color: 'text-emerald-400' }
  if (rssi >= -78) return { text: 'Good signal', color: 'text-emerald-400' }
  if (rssi >= -88) return { text: 'Fair signal', color: 'text-amber-400' }
  return { text: 'Weak / Marginal', color: 'text-rose-400' }
}

function battQuality(batt?: number | null): { text: string; color: string } {
  if (batt == null) return { text: 'Line powered / N/A', color: 'text-slate-500' }
  if (batt >= 60) return { text: 'Healthy level', color: 'text-emerald-400' }
  if (batt >= 25) return { text: 'Moderate', color: 'text-amber-400' }
  return { text: 'Low / Recharge needed', color: 'text-rose-400' }
}

export default function SensorDetailsModal({
  isOpen,
  onClose,
  nodeId,
  deviceName,
  domain,
  orgId,
  presence: initialPresence,
  values: initialValues,
  lastReadingAt: initialLastReadingAt,
}: Props) {
  // Live states
  const [presence, setPresence] = useState(initialPresence)
  const [values, setValues] = useState(initialValues)
  const [lastReadingAt, setLastReadingAt] = useState(initialLastReadingAt)
  const [isPolling, setIsPolling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)

  // Search & filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<'ALL' | 'ALARM' | 'THERMAL' | 'ELECTRICAL' | 'GAS'>('ALL')

  // Sync when parent props change
  useEffect(() => {
    setPresence(initialPresence)
    setValues(initialValues)
    setLastReadingAt(initialLastReadingAt)
  }, [initialPresence, initialValues, initialLastReadingAt])

  // Live polling effect
  useEffect(() => {
    if (!isOpen || !nodeId || !isPolling) return
    const interval = setInterval(async () => {
      try {
        const lat = await api.latest(nodeId)
        if (lat) {
          if (lat.presence) setPresence(lat.presence)
          if (lat.values) setValues(lat.values)
          if (lat.lastReadingAt) setLastReadingAt(lat.lastReadingAt)
        }
      } catch (_) {}
    }, 3000)
    return () => clearInterval(interval)
  }, [isOpen, nodeId, isPolling])

  // Manual Refresh
  const handleRefresh = useCallback(async () => {
    if (!nodeId) return
    setIsRefreshing(true)
    try {
      const lat = await api.latest(nodeId)
      if (lat) {
        if (lat.presence) setPresence(lat.presence)
        if (lat.values) setValues(lat.values)
        if (lat.lastReadingAt) setLastReadingAt(lat.lastReadingAt)
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 400)
    }
  }, [nodeId])

  const online = presence?.online === 1
  const rssi = presence?.rssi ?? null
  const batt = presence?.batt ?? null
  const hasConflict = Boolean(presence?.identity_conflict_at)

  // Diagnostic KPI cards
  const stats = [
    {
      icon: Battery,
      label: 'Battery',
      value: batt != null ? `${batt}%` : '—',
      hint: battQuality(batt).text,
      hintColor: battQuality(batt).color,
    },
    {
      icon: Wifi,
      label: 'Signal (RSSI)',
      value: rssi != null ? `${rssi} dBm` : '—',
      hint: rssiQuality(rssi).text,
      hintColor: rssiQuality(rssi).color,
    },
    {
      icon: Cpu,
      label: 'Firmware & Uptime',
      value: presence?.fw || '—',
      hint: presence?.last_uptime ? `Up: ${formatUptime(presence.last_uptime)}` : (presence?.transport ? `via ${presence.transport}` : 'Active'),
      hintColor: 'text-indigo-400',
    },
    {
      icon: Radio,
      label: 'Transport & Memory',
      value: presence?.transport ? presence.transport.toUpperCase() : 'MQTT',
      hint: presence?.heap ? `${Math.round(presence.heap / 1024)} KB Free Heap` : 'Broker Connected',
      hintColor: 'text-cyan-400',
    },
    {
      icon: Clock,
      label: 'Liveness',
      value: online ? 'ONLINE' : 'OFFLINE',
      hint: presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never seen',
      hintColor: online ? 'text-emerald-400' : 'text-slate-500',
    },
  ]

  // Telemetry inspection with ISA-101 labels, units, and process alarm evaluation
  const telemetryAudit = useMemo(() => {
    const entries = Object.entries(values ?? {})
    const schemaParams = domain ? (ALARM_SCHEMA[domain]?.params ?? []) : []

    return entries.map(([key, rawVal]) => {
      const val = Number(rawVal)
      const label = schemaLabel(domain, key)
      const paramDef = schemaParams.find((p) => p.key === key)
      const unit = paramDef?.unit || ''

      let status: 'CRITICAL' | 'WARNING' | 'NORMAL' | 'UNRATED' = 'UNRATED'
      if (paramDef && !Number.isNaN(val)) {
        if (paramDef.direction === 'high') {
          if (val >= paramDef.critical) status = 'CRITICAL'
          else if (val >= paramDef.warn) status = 'WARNING'
          else status = 'NORMAL'
        } else {
          if (val <= paramDef.critical) status = 'CRITICAL'
          else if (val <= paramDef.warn) status = 'WARNING'
          else status = 'NORMAL'
        }
      }

      return {
        key,
        label,
        val,
        unit,
        status,
        warnLimit: paramDef?.warn ?? null,
        critLimit: paramDef?.critical ?? null,
        direction: paramDef?.direction ?? 'high',
      }
    })
  }, [values, domain])

  // Count active alarms
  const alarmingCount = useMemo(() => {
    return telemetryAudit.filter((p) => p.status === 'CRITICAL' || p.status === 'WARNING').length
  }, [telemetryAudit])

  // Filtered telemetry entries
  const filteredTelemetry = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return telemetryAudit.filter((p) => {
      // Category filter
      if (filterCategory === 'ALARM' && p.status !== 'CRITICAL' && p.status !== 'WARNING') return false
      if (filterCategory === 'THERMAL' && !p.key.toLowerCase().includes('temp')) return false
      if (filterCategory === 'ELECTRICAL' && !['volt', 'curr', 'load', 'pf', 'hz', 'thd', 'power', 'va'].some((k) => p.key.toLowerCase().includes(k))) return false
      if (filterCategory === 'GAS' && !['hydro', 'h2', 'moist', 'dga', 'gas'].some((k) => p.key.toLowerCase().includes(k))) return false

      // Text query
      if (!q) return true
      return p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || String(p.val).includes(q)
    })
  }, [telemetryAudit, searchQuery, filterCategory])

  // 1-Click Copy Diagnostic Snapshot
  const handleCopySnapshot = () => {
    if (!nodeId) return
    const alarms = telemetryAudit.filter((p) => p.status === 'CRITICAL' || p.status === 'WARNING')
    const summary = [
      `[DIAGNOSTICS SNAPSHOT] Asset: ${deviceName || nodeId} (${nodeId})`,
      `Domain: ${domain || 'Industrial IoT'} | Org: ${orgId || 'Default'}`,
      `Status: ${online ? 'ONLINE' : 'OFFLINE'} | Transport: ${presence?.transport || 'MQTT'}`,
      `Signal: ${rssi != null ? `${rssi} dBm` : 'N/A'} | Battery: ${batt != null ? `${batt}%` : 'N/A'} | Uptime: ${formatUptime(presence?.last_uptime)}`,
      `Last Seen: ${presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never'} | Last Telemetry: ${lastReadingAt ? fmtDateTime(lastReadingAt) : '—'}`,
      hasConflict ? `⚠️ CRITICAL: Hardware Identity Collision detected at ${presence?.identity_conflict_at ? fmtDateTime(presence.identity_conflict_at) : 'unknown time'}` : '',
      alarms.length > 0
        ? `\n🚨 Active Alarms (${alarms.length}):\n` + alarms.map((a) => ` - ${a.label} (${a.key}): ${a.val} ${a.unit} [${a.status}]`).join('\n')
        : '\n✅ All monitored telemetry within safe operational limits.',
      `\nReport generated: ${new Date().toISOString()} via ONEOPS Platform`,
    ].filter(Boolean).join('\n')

    // No .catch(): clipboard access can be denied (insecure context, no
    // permission, Safari's user-gesture window having closed) and the promise
    // then just rejects — the SOP handover button did nothing with no
    // feedback, on a "did the copy actually work" affordance whose whole
    // point is that feedback.
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      window.alert('Could not copy to clipboard — your browser blocked clipboard access.')
    })
  }

  // Direct APM deep-dive navigation
  const apmLink = useMemo(() => {
    if (!nodeId) return null
    const enc = encodeURIComponent(nodeId)
    if (domain === 'transformer') {
      return {
        label: '⚡ Open Transformer APM Studio',
        href: `/admin/transformers/detail?id=${enc}`,
      }
    }
    if (domain === 'carbonNode') {
      return {
        label: '❄️ Open CarbonBOX Refrigeration Studio',
        href: `/admin/carbon/detail?id=${enc}`,
      }
    }
    if (domain === 'bloodBox') {
      return {
        label: '🩸 Open BloodBOX Cold-Chain Studio',
        href: `/admin/bloodbox/detail?id=${enc}`,
      }
    }
    if (domain === 'automobile') {
      return {
        label: '🏎️ Open Vehicle Telemetry Studio',
        href: `/admin/automobile/detail?id=${enc}`,
      }
    }
    return {
      label: '📊 Open Asset Studio',
      href: `/admin/nodes/detail?id=${enc}`,
    }
  }, [nodeId, domain])

  if (!isOpen || !nodeId) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col max-h-[92vh] shadow-2xl border border-slate-800" style={surface}>
        {/* Header */}
        <div className="px-6 py-4 flex flex-wrap justify-between items-center border-b border-slate-800 bg-[#0a0e1a] gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0">
              <Activity size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">Sensor &amp; Hardware Diagnostics</h3>
                {domain && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
                    {domain}
                  </span>
                )}
                <span className={clsx(
                  'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1',
                  online
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                )}>
                  <span className={clsx('w-1.5 h-1.5 rounded-full', online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500')} />
                  {online ? 'Live Connected' : 'Offline'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                {deviceName ? `${deviceName} · ` : ''}{nodeId}
              </p>
            </div>
          </div>

          {/* Header Action Tools: Live Polling, Refresh, Copy Snapshot, Close */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setIsPolling(!isPolling)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all',
                isPolling
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 shadow-sm'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
              )}
              title={isPolling ? 'Pause live polling' : 'Enable live 3s polling'}
            >
              {isPolling ? <Pause size={12} className="text-emerald-400" /> : <Play size={12} />}
              <span>{isPolling ? 'Polling (3s)' : 'Live Polling'}</span>
            </button>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Manual Refresh"
            >
              <RefreshCw size={14} className={clsx(isRefreshing && 'animate-spin text-indigo-400')} />
            </button>

            <button
              onClick={handleCopySnapshot}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Copy Diagnostic Snapshot (SOP Handover)"
            >
              {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tier 1: Hardware Identity Conflict Alert (IEC 62443 Zero Trust) */}
          {hasConflict && (
            <div className="rounded-xl p-4 bg-rose-950/30 border border-rose-500/50 flex items-start gap-3 text-xs">
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 mt-0.5 flex-shrink-0 animate-pulse">
                <AlertTriangle size={18} />
              </div>
              <div className="space-y-1.5">
                <div className="font-bold text-rose-300 flex items-center gap-2 flex-wrap">
                  <span className="text-sm">⚠️ ตรวจพบฮาร์ดแวร์ส่งข้อมูลชนกัน (Hardware Identity Collision)</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-900/90 text-rose-200 border border-rose-500/50 font-bold">
                    3-TIER ARBITRATION ACTIVE
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  ระบบตรวจพบว่ามีอุปกรณ์ฮาร์ดแวร์มากกว่า 1 เครื่อง หรือมีสตรีมข้อมูลคู่ขนานที่แย่งกันส่งข้อมูลภายใต้ Node ID <strong className="text-white font-mono">{nodeId}</strong> นี้ (ตรวจพบความผิดปกติเมื่อ {presence?.identity_conflict_at ? fmtDateTime(presence.identity_conflict_at) : 'ไม่ทราบเวลา'})
                </p>
                <div className="text-[11px] text-rose-200/80 font-mono pt-1">
                  คำแนะนำ: ตรวจสอบหมายเลข MAC Address ของบอร์ด ESP32 หรือกดเข้าไปที่หน้า APM Studio เพื่อดูแบนเนอร์และเลือกโหมด Stream Arbitration (Max-Select หรือ Dual-Redundant Mean)
                </div>
              </div>
            </div>
          )}

          {/* Diagnostic KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="p-3.5 rounded-xl border border-slate-800/80 space-y-1" style={inset}>
                <div className="flex items-center text-slate-400 text-[10px] font-bold uppercase tracking-wider gap-1.5">
                  <s.icon size={13} className="text-slate-400 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </div>
                <div className="text-base font-black text-white capitalize truncate">{s.value}</div>
                <div className={clsx('text-[10px] font-semibold truncate', s.hintColor)}>
                  {s.hint}
                </div>
              </div>
            ))}
          </div>

          {/* Device Telemetry & Details Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left: Device Telemetry Values with Search, Filters & Visual Meters */}
            <div className="lg:col-span-2 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-1 border-b border-slate-800 gap-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Gauge size={14} className="text-emerald-400" />
                  Live Telemetry &amp; Process Alarms (ISA-101)
                </h4>
                <div className="flex items-center gap-2">
                  {alarmingCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-rose-950 text-rose-300 border border-rose-500/40 animate-pulse">
                      {alarmingCount} ALARMS ACTIVE
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500 font-mono">
                    {filteredTelemetry.length}/{telemetryAudit.length} shown
                  </span>
                </div>
              </div>

              {/* Search & Category Filter Pills */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search parameter (e.g. oilTemp, volt, h2)..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-slate-900/90 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-[10px] font-semibold">
                  {[
                    ['ALL', `All (${telemetryAudit.length})`],
                    ['ALARM', `Alarms (${alarmingCount})`],
                    ['THERMAL', 'Thermal'],
                    ['ELECTRICAL', 'Electrical'],
                    ['GAS', 'Gas/DGA'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setFilterCategory(key as any)}
                      className={clsx(
                        'px-2.5 py-1 rounded-md transition-all whitespace-nowrap',
                        filterCategory === key
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTelemetry.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500" style={inset}>
                  {searchQuery || filterCategory !== 'ALL'
                    ? 'No telemetry parameters matched your filter criteria.'
                    : 'No telemetry parameters currently reported by this node.'}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800/80 overflow-hidden" style={inset}>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                    {filteredTelemetry.map((p) => {
                      // Calculate percentage for visual range bar if threshold is known.
                      //
                      // For a 'low'-direction param (e.g. oilLevel: warn 70,
                      // critical 60 — lower is worse), val/critLimit grows
                      // WITH the reading: a healthy 90 gave 90/60*85 = 127%
                      // (clamped to a FULL bar) while an actual critical
                      // reading of 55 gave 55/60*85 = 78% (mostly empty) — the
                      // opposite of every 'high'-direction row in this same
                      // list, where a longer bar means closer to danger.
                      // critLimit/val keeps that invariant either way: pct
                      // hits 85% exactly at the critical threshold and grows
                      // as the reading approaches it, in both directions.
                      let pct = 50
                      if (p.critLimit != null && p.critLimit > 0) {
                        pct = p.direction === 'low'
                          ? (p.val > 0 ? Math.min(100, Math.max(5, (p.critLimit / p.val) * 85)) : 100)
                          : Math.min(100, Math.max(5, (p.val / p.critLimit) * 85))
                      }

                      return (
                        <div key={p.key} className="p-2.5 px-3 hover:bg-slate-800/30 transition-colors space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-200 truncate flex items-center gap-1.5">
                                <span>{p.label}</span>
                                <span className="text-[10px] font-mono text-slate-500">({p.key})</span>
                              </div>
                              {p.warnLimit != null && (
                                <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                  <span>Warn: {p.warnLimit} {p.unit}</span>
                                  {p.critLimit != null && <span>· Crit: {p.critLimit} {p.unit}</span>}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2.5 flex-shrink-0">
                              <span className="font-mono text-sm font-bold text-white">
                                {p.val} <span className="text-xs font-normal text-slate-400">{p.unit}</span>
                              </span>

                              <span className={clsx(
                                'text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase',
                                p.status === 'CRITICAL' ? 'bg-rose-950/80 text-rose-300 border border-rose-500/40 animate-pulse' :
                                p.status === 'WARNING' ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40' :
                                p.status === 'NORMAL' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/20' :
                                'bg-slate-800 text-slate-400'
                              )}>
                                {p.status}
                              </span>
                            </div>
                          </div>

                          {/* ISA-101 Visual Range Indicator */}
                          {p.critLimit != null && (
                            <div className="w-full bg-slate-800/60 h-1 rounded-full overflow-hidden flex">
                              <div
                                className={clsx(
                                  'h-full transition-all duration-300 rounded-full',
                                  p.status === 'CRITICAL' ? 'bg-rose-500' :
                                  p.status === 'WARNING' ? 'bg-amber-400' : 'bg-emerald-500'
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Technical Device Info & Transport Details */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider pb-1 border-b border-slate-800 flex items-center gap-2">
                <Server size={14} className="text-indigo-400" />
                Diagnostic Metadata
              </h4>

              <div className="rounded-xl p-3.5 space-y-2.5 text-xs" style={inset}>
                {[
                  ['Node ID', nodeId],
                  ['Organization', orgId || 'Default Org'],
                  ['Last Seen', presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never'],
                  ['Last Telemetry', lastReadingAt ? fmtDateTime(lastReadingAt) : '—'],
                  ['Transport Mode', presence?.transport ? presence.transport.toUpperCase() : 'MQTT Standard'],
                  ['Uptime Clock', presence?.last_uptime ? formatUptime(presence.last_uptime) : '—'],
                  ['Firmware Hash', presence?.fw || 'Default Release'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-slate-500">{k}</span>
                    <span className="font-mono text-slate-200 text-right truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer with Smart APM Deep-Dive */}
        <div className="px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800 bg-[#0a0e1a]">
          {apmLink ? (
            <a
              href={apmLink.href}
              className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              <ExternalLink size={14} />
              <span>{apmLink.label}</span>
            </a>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
