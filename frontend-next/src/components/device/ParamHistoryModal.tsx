'use client'

// ---------------------------------------------------------------------------
// Per-parameter history + threshold editor, opened from any sensor card.
// ---------------------------------------------------------------------------
// The cards and the two combined charts show the present and a sparkline; the
// questions an operator actually has are "what did this do last Tuesday?" and
// "at what value should it have warned me?". Both now live one click away, on
// every device page and for every role.
//
// The window is sent as an explicit from/to, not "last N minutes", so a period
// that ended in the past can be inspected. Bucketing is server-side and each
// bucket carries min/max as well as the mean — on a 30-day view a one-minute
// spike would otherwise be averaged out of existence, which is exactly the
// event worth looking at.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { ALARM_SCHEMA, defaultNodeRule, paramStatus, type AlarmParam } from '@/lib/alarmParams'
import { useAlarmDB } from '@/server/alarmStore'
import { downloadCSV } from '@/lib/exportFile'
import type { SensorDomain } from '@/types/fleet'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { X, Loader2, Save, Download, AlertTriangle, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

export interface ModalParam { key: string; label: string; unit?: string }

const QUICK = [
  { id: '1h', label: '1h', minutes: 60 },
  { id: '6h', label: '6h', minutes: 360 },
  { id: '24h', label: '24h', minutes: 1440 },
  { id: '7d', label: '7d', minutes: 10080 },
  { id: '30d', label: '30d', minutes: 43200 },
] as const

const MAX_POINTS = 300

interface Row { param_key: string; value: number; taken_at: string; v_min?: number; v_max?: number; n?: number }

/** UTC 'YYYY-MM-DD HH:MM:SS' — the contract the readings endpoint expects. */
const toUTC = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
/** Value for <input type="datetime-local">, which is always LOCAL wall time. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export default function ParamHistoryModal({
  nodeId, deviceName, orgId, domain, params, initialKey, canEditThresholds = true, onClose,
}: {
  nodeId: string
  deviceName?: string
  orgId?: string
  domain?: SensorDomain
  params: ModalParam[]
  initialKey?: string
  canEditThresholds?: boolean
  onClose: () => void
}) {
  const live = useIsLive()
  const setRule = useAlarmDB((s) => s.setRule)
  const hasHydrated = useAlarmDB((s) => s.hasHydrated)

  const [paramKey, setParamKey] = useState(initialKey ?? params[0]?.key ?? '')
  const [quick, setQuick] = useState<string>('24h')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [win, setWin] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - 1440 * 60_000, to: Date.now() }))
  const [thresh, setThresh] = useState<{ warn: number; critical: number } | null>(null)
  const [savingRule, setSavingRule] = useState(false)

  const param = params.find((p) => p.key === paramKey) ?? params[0]
  const schemaParam: AlarmParam | undefined = domain
    ? ALARM_SCHEMA[domain].params.find((p) => p.key === paramKey)
    : undefined
  const unit = param?.unit ?? schemaParam?.unit ?? ''

  // Esc closes, and the page behind must not scroll under the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Seed the threshold editor from the saved rule, falling back to the schema.
  useEffect(() => {
    if (!schemaParam) { setThresh(null); return }
    const saved = hasHydrated ? useAlarmDB.getState().rules[nodeId] : undefined
    const p = saved?.params.find((x) => x.key === paramKey)
    setThresh({ warn: p?.warn ?? schemaParam.warn, critical: p?.critical ?? schemaParam.critical })
  }, [nodeId, paramKey, schemaParam, hasHydrated])

  const range = useMemo(() => {
    if (custom) {
      const from = new Date(custom.from).getTime()
      const to = new Date(custom.to).getTime()
      if (!Number.isNaN(from) && !Number.isNaN(to) && to > from) return { from, to }
    }
    const minutes = QUICK.find((q) => q.id === quick)?.minutes ?? 1440
    const to = Date.now()
    return { from: to - minutes * 60_000, to }
  }, [custom, quick])

  const load = useCallback(() => {
    if (!live || !nodeId || !paramKey) { setRows(null); return }
    let cancelled = false
    setLoading(true)
    const bucketSec = Math.max(60, (range.to - range.from) / 1000 / MAX_POINTS)
    api.readingsWindow(nodeId, toUTC(range.from), toUTC(range.to), bucketSec, paramKey)
      .then((r) => { if (!cancelled) { setRows((r ?? []) as Row[]); setWin(range) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [live, nodeId, paramKey, range])

  useEffect(() => { load() }, [load])

  const data = useMemo(() => (rows ?? []).map((r) => ({
    ts: new Date(r.taken_at).getTime(),
    value: Number(r.value),
    // The band is the spread inside the bucket. Recharts stacks an Area from a
    // [low, high] tuple, so the spike survives the averaging.
    band: [Number(r.v_min ?? r.value), Number(r.v_max ?? r.value)] as [number, number],
  })).filter((d) => !Number.isNaN(d.ts)), [rows])

  const stats = useMemo(() => {
    if (!rows?.length) return null
    let min = Infinity, max = -Infinity, sum = 0, n = 0, warnN = 0, critN = 0
    for (const r of rows) {
      const w = r.n ?? 1
      min = Math.min(min, Number(r.v_min ?? r.value))
      max = Math.max(max, Number(r.v_max ?? r.value))
      sum += Number(r.value) * w
      n += w
      if (schemaParam && thresh) {
        const st = paramStatus(Number(r.value), { ...schemaParam, warn: thresh.warn, critical: thresh.critical })
        if (st === 'CRITICAL') critN += w
        else if (st === 'WARNING') warnN += w
      }
    }
    return { min, max, avg: sum / n, n, warnPct: (warnN / n) * 100, critPct: (critN / n) * 100 }
  }, [rows, schemaParam, thresh])

  const spanMs = win.to - win.from
  const fmtTick = (ts: number) => {
    const d = new Date(ts)
    return spanMs > 36 * 3600_000
      ? d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const saveThreshold = async () => {
    if (!domain || !thresh || !schemaParam) return
    setSavingRule(true)
    try {
      // Start from the saved rule so editing one parameter cannot reset the
      // limits somebody set on the other five.
      const base = (hasHydrated && useAlarmDB.getState().rules[nodeId]) || defaultNodeRule(domain)
      const next = {
        ...base,
        params: base.params.map((p) => (p.key === paramKey ? { ...p, warn: thresh.warn, critical: thresh.critical } : p)),
      }
      setRule(nodeId, next, orgId)
      toast.success(`${param?.label} thresholds saved`)
    } finally {
      setSavingRule(false)
    }
  }

  const exportCsv = () => {
    downloadCSV(
      `${nodeId}_${paramKey}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Time', `${param?.label ?? paramKey}${unit ? ` (${unit})` : ''}`, 'Min', 'Max', 'Samples'],
      (rows ?? []).map((r) => [new Date(r.taken_at).toLocaleString(), r.value, r.v_min ?? '', r.v_max ?? '', r.n ?? '']),
    )
  }

  const invalid = !!thresh && !!schemaParam &&
    (schemaParam.direction === 'high' ? thresh.critical <= thresh.warn : thresh.critical >= thresh.warn)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl my-auto"
        style={surface}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${param?.label ?? paramKey} history`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">
              {param?.label ?? paramKey}{unit && <span className="text-slate-500 font-normal text-sm"> · {unit}</span>}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{deviceName ?? nodeId} · {nodeId}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Parameter switcher — a combined chart opens here with both series */}
        {params.length > 1 && (
          <div className="px-5 flex flex-wrap gap-1.5 pb-3">
            {params.map((p) => (
              <button
                key={p.key}
                onClick={() => setParamKey(p.key)}
                className="text-[11px] px-2.5 py-1 rounded-md font-medium"
                style={p.key === paramKey ? gradient : inset}
              >
                <span className={p.key === paramKey ? 'text-white' : 'text-slate-400'}>{p.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Range controls */}
        <div className="px-5 flex flex-wrap items-center gap-2 pb-3">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={inset}>
            {QUICK.map((q) => (
              <button
                key={q.id}
                onClick={() => { setCustom(null); setQuick(q.id) }}
                className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${!custom && quick === q.id ? 'text-white' : 'text-slate-500'}`}
                style={!custom && quick === q.id ? { background: '#6366f1' } : {}}
              >
                {q.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={custom?.from ?? toLocalInput(range.from)}
            onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? toLocalInput(range.to) }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          <span className="text-slate-600 text-[11px]">→</span>
          <input
            type="datetime-local"
            value={custom?.to ?? toLocalInput(range.to)}
            onChange={(e) => setCustom((c) => ({ from: c?.from ?? toLocalInput(range.from), to: e.target.value }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          {custom && (
            <button onClick={() => setCustom(null)} className="text-[11px] text-slate-500 hover:text-white underline">reset</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {loading && <Loader2 size={13} className="animate-spin text-indigo-400" />}
            <button onClick={exportCsv} disabled={!rows?.length}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md text-slate-300 disabled:opacity-40" style={inset}>
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

        {/* Chart */}
        <div className="px-5">
          {!live ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-slate-600">
              Switch to Live mode to see stored history.
            </div>
          ) : data.length < 2 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-slate-600">
              {loading ? 'Loading…' : 'No readings stored in this period.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                <XAxis dataKey="ts" type="number" scale="time" domain={[win.from, win.to]}
                  tickFormatter={(v) => fmtTick(Number(v))}
                  tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }}
                  labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  formatter={(v: unknown, name: string) => {
                    if (Array.isArray(v)) return [`${v[0]} – ${v[1]}${unit ? ` ${unit}` : ''}`, 'Min–Max']
                    return [`${v}${unit ? ` ${unit}` : ''}`, name]
                  }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Area dataKey="band" stroke="none" fill="#6366f1" fillOpacity={0.16} name="Min–Max" isAnimationActive={false} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={1.6} dot={false} name="Average" isAnimationActive={false} />
                {thresh && <ReferenceLine y={thresh.warn} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: 'warn', fill: '#fbbf24', fontSize: 9, position: 'insideTopRight' }} />}
                {thresh && <ReferenceLine y={thresh.critical} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'critical', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="px-5 pt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              ['Min', `${stats.min.toFixed(2)}${unit && ` ${unit}`}`],
              ['Average', `${stats.avg.toFixed(2)}${unit && ` ${unit}`}`],
              ['Max', `${stats.max.toFixed(2)}${unit && ` ${unit}`}`],
              ['Samples', stats.n.toLocaleString()],
              ['Time in alarm', `${(stats.warnPct + stats.critPct).toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg px-3 py-2" style={inset}>
                <div className="text-[10px] text-slate-600 uppercase tracking-wider">{k}</div>
                <div className="text-sm text-slate-200 font-medium">{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Thresholds */}
        <div className="p-5 pt-4">
          {!schemaParam ? (
            <p className="text-[11px] text-slate-600">
              This parameter is not in the product’s alarm schema, so it has no thresholds to configure.
            </p>
          ) : (
            <div className="rounded-xl p-4" style={inset}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-indigo-400" /> Alarm &amp; notify thresholds
                </h3>
                <span className="text-[10px] text-slate-600">
                  alarms when the value goes {schemaParam.direction === 'high' ? 'above' : 'below'} these limits
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[10px] text-amber-400 mb-1 uppercase tracking-wider">Warning</span>
                  <input type="number" step="any" value={thresh?.warn ?? ''}
                    disabled={!canEditThresholds}
                    onChange={(e) => setThresh((t) => (t ? { ...t, warn: Number(e.target.value) } : t))}
                    className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Critical</span>
                  <input type="number" step="any" value={thresh?.critical ?? ''}
                    disabled={!canEditThresholds}
                    onChange={(e) => setThresh((t) => (t ? { ...t, critical: Number(e.target.value) } : t))}
                    className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                </label>
              </div>
              {invalid && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1.5 mt-2">
                  <AlertTriangle size={12} />
                  Critical must be {schemaParam.direction === 'high' ? 'higher' : 'lower'} than warning, or it can never fire.
                </p>
              )}
              <button
                onClick={saveThreshold}
                disabled={!canEditThresholds || invalid || savingRule}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={gradient}
              >
                {savingRule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save thresholds
              </button>
              <p className="text-[10px] text-slate-600 mt-2">
                Applies to this device. Notifications follow the same limits — the channels are chosen in My Alert Settings.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
