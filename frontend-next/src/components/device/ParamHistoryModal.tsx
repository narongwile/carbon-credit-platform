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

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive } from '@/lib/api'
import { ALARM_SCHEMA, defaultNodeRule, paramStatus, type AlarmParam } from '@/lib/alarmParams'
import { useAlarmDB } from '@/server/alarmStore'
import { downloadCSV } from '@/lib/exportFile'
import { fmtHM, fmtDayMonth, fmtDateTime, toDisplayInput, fromDisplayInput, DISPLAY_TZ_LABEL } from '@/lib/displayTime'
import type { SensorDomain } from '@/types/fleet'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { X, Loader2, Save, Download, AlertTriangle, TrendingUp, Shield } from 'lucide-react'
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

// A real instant (ISO, with 'Z') — the contract the readings endpoint expects.
// This used to chop the 'Z' off ("UTC 'YYYY-MM-DD HH:MM:SS'"), which sounds
// harmless but is not: readings.taken_at is written in the DB's OWN wall-clock
// (+07:00 by default, not UTC — see dbWallClock() in the backend), so a window
// boundary that LOOKED like a timestamp but carried no zone was being compared
// literally against Bangkok-time rows. A "last 24h" window silently excluded
// roughly the most recent 7 hours of real data — confirmed against a live
// server: a reading taken 2 minutes earlier returned zero rows. Sending the
// full zoned instant lets the backend do that conversion correctly instead.
const toUTC = (ms: number) => new Date(ms).toISOString()
// A datetime-local input is the BROWSER's wall clock, but every label on this
// chart is pinned to DISPLAY_TZ. Leaving the picker on browser time meant an
// operator on a UTC laptop asked for 08:00 and got rows labelled 15:00 — the
// range and the axis disagreeing about the same number. Both ends now speak
// DISPLAY_TZ. See src/lib/displayTime.ts.

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
  // direction/enabled live here too, because a parameter that is NOT in the
  // product's alarm schema has nowhere else to get them from — and on a real
  // ETERNITY transformer (Oiltemp, H2, RHamb, Tbox…) that is most of them.
  const [thresh, setThresh] = useState<{ warn: number; critical: number; direction: 'high' | 'low'; enabled: boolean } | null>(null)
  /** The device's saved rule, server-first. Held so saving can extend it rather than rebuild it. */
  const [rule, setRuleState] = useState<NodeAlarmRule | null>(null)
  const [savingRule, setSavingRule] = useState(false)
  /** Every saved band for the open key — usually 0 or 1, but a physical
   * reading like a phase voltage can carry two independent rules on the
   * same key, one 'high' (over-voltage) and one 'low' (under-voltage). This
   * inline editor was built around exactly one rule per key: seeing two, it
   * would silently EDIT WHICHEVER ONE .find() happened to return first and
   * overwrite it into the other on save, corrupting a band the operator
   * never touched. Kept read-only in that case instead. */
  const [bands, setBands] = useState<NodeAlarmRule['params']>([])
  const dualBand = bands.length > 1

  // A caller may open a key that is not in `params`: the device decides what it
  // reports, and a merged two-topic transformer sends far more than the six
  // schema slots a page lists. The old `?? params[0]` then titled the modal
  // "Oil Temperature · °C" while charting VoltAB — the series was right, the
  // heading lied. An unrecognised key keeps its own identity instead, and joins
  // the switcher so it can be switched back to.
  const known = params.some((p) => p.key === paramKey)
  const param = known ? params.find((p) => p.key === paramKey) : paramKey ? { key: paramKey, label: paramKey } : params[0]
  const switchable = useMemo(
    () => (known || !paramKey ? params : [...params, { key: paramKey, label: paramKey }]),
    [params, paramKey, known],
  )
  // A key can carry two schema entries too (e.g. VoltAN over/under-voltage),
  // not just two entries in a saved device rule — .find() below only ever
  // returns the first (the 'high' band), so schemaMatches.length is checked
  // alongside the device's own saved rule when deciding whether this key is
  // dual-band.
  const schemaMatches = useMemo(
    () => (domain ? ALARM_SCHEMA[domain].params.filter((p) => p.key === paramKey) : []),
    [domain, paramKey],
  )
  const schemaParam: AlarmParam | undefined = schemaMatches[0]
  const unit = param?.unit ?? schemaParam?.unit ?? ''

  // Esc closes, and the page behind must not scroll under the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Seed the threshold editor. The SERVER's rule is the truth — the local
  // zustand copy is one browser's cache of it, so seeding from localStorage
  // alone showed two admins different "current" limits for the same device.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const remote = live ? await api.getRule(nodeId) : null
      if (cancelled) return
      const local = hasHydrated ? useAlarmDB.getState().rules[nodeId] : undefined
      const r = remote ?? local ?? null
      setRuleState(r)
      const matches = r?.params.filter((x) => x.key === paramKey) ?? []
      // A brand-new device with no saved rule yet is dual-band exactly when
      // the PRODUCT SCHEMA is (e.g. VoltAN over/under-voltage) — its own
      // rule.params is empty at that point, so matches.length alone would
      // say "single band" and only show the schema's first ('high') match.
      const effectiveBands = matches.length ? matches : schemaMatches
      setBands(effectiveBands)
      const saved = matches[0]
      if (effectiveBands.length > 1) {
        // Show the 'high' band's numbers if there is one, purely as the
        // read-only reference line default — the panel below disables
        // editing entirely once dualBand is true, so which one seeds the
        // (inert) form fields doesn't matter for correctness.
        const primary = effectiveBands.find((x) => x.direction === 'high') ?? effectiveBands[0]
        setThresh({ warn: primary.warn, critical: primary.critical, direction: primary.direction, enabled: true })
      } else if (saved) {
        setThresh({ warn: saved.warn, critical: saved.critical, direction: saved.direction, enabled: true })
      } else if (schemaParam) {
        setThresh({ warn: schemaParam.warn, critical: schemaParam.critical, direction: schemaParam.direction, enabled: true })
      } else {
        // Never configured and not in the schema: blank rather than a guessed
        // number. The observed min/avg/max above is what an admin should pick
        // from — inventing a limit here would look authoritative and be
        // arbitrary.
        setThresh({ warn: NaN, critical: NaN, direction: 'high', enabled: false })
      }
    })()
    return () => { cancelled = true }
  }, [nodeId, paramKey, schemaParam, schemaMatches, hasHydrated, live])

  const range = useMemo(() => {
    if (custom) {
      const from = fromDisplayInput(custom.from)
      const to = fromDisplayInput(custom.to)
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
  // Pinned to DISPLAY_TZ, not the browser: these readings are physically
  // Thai-time events (MySQL runs at +07:00 and the pool opens with that zone),
  // so a laptop set to UTC read every chart seven hours off.
  const fmtTick = (ts: number) => (spanMs > 36 * 3600_000 ? fmtDayMonth(ts) : fmtHM(ts))

  const saveThreshold = async () => {
    if (!thresh) return
    if (dualBand) return // guarded off in the UI too; belt-and-suspenders against a stale click
    setSavingRule(true)
    try {
      // Start from the saved rule so editing one parameter cannot reset the
      // limits somebody set on the others. defaultNodeRule only when this
      // device has no rule at all yet.
      const base: NodeAlarmRule = rule
        ?? (hasHydrated ? useAlarmDB.getState().rules[nodeId] : undefined)
        ?? (domain ? defaultNodeRule(domain) : { domain: '', params: [], dwellMin: 5, hysteresis: 2 })
      const exists = base.params.some((p) => p.key === paramKey)
      let params
      if (!thresh.enabled) {
        // Turning a parameter off means the engine should stop evaluating it.
        // A schema param reverts to schema defaults on re-enable; a custom one
        // simply leaves the rule.
        params = base.params.filter((p) => p.key !== paramKey)
      } else if (exists) {
        params = base.params.map((p) => (p.key === paramKey
          ? { ...p, warn: thresh.warn, critical: thresh.critical, direction: thresh.direction } : p))
      } else {
        // The case that did not exist before: a parameter with no schema entry
        // gets a real rule of its own. The engine matches purely on key (see
        // evaluate() in the generator), so nothing else has to know about it.
        params = [...base.params, {
          key: paramKey, label: param?.label ?? paramKey, unit,
          direction: thresh.direction, warn: thresh.warn, critical: thresh.critical,
        }]
      }
      const next: NodeAlarmRule = { ...base, domain: base.domain || domain || '', params }
      setRule(nodeId, next, orgId)
      setRuleState(next)
      toast.success(thresh.enabled
        ? `${param?.label ?? paramKey} thresholds saved`
        : `${param?.label ?? paramKey} will no longer raise alarms`)
    } finally {
      setSavingRule(false)
    }
  }

  const exportCsv = () => {
    downloadCSV(
      `${nodeId}_${paramKey}_${toUTC(win.from).slice(0, 10)}_${toUTC(win.to).slice(0, 10)}.csv`,
      ['Time', `${param?.label ?? paramKey}${unit ? ` (${unit})` : ''}`, 'Min', 'Max', 'Samples'],
      (rows ?? []).map((r) => [fmtDateTime(r.taken_at), r.value, r.v_min ?? '', r.v_max ?? '', r.n ?? '']),
    )
  }

  const blank = !!thresh && thresh.enabled && (!Number.isFinite(thresh.warn) || !Number.isFinite(thresh.critical))
  const invalid = !!thresh && thresh.enabled && !blank &&
    (thresh.direction === 'high' ? thresh.critical <= thresh.warn : thresh.critical >= thresh.warn)
  const canEdit = canEditThresholds && !dualBand

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
        {switchable.length > 1 && (
          <div className="px-5 flex flex-wrap gap-1.5 pb-3">
            {switchable.map((p) => (
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
            value={custom?.from ?? toDisplayInput(range.from)}
            onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? toDisplayInput(range.to) }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          <span className="text-slate-600 text-[11px]">→</span>
          <input
            type="datetime-local"
            value={custom?.to ?? toDisplayInput(range.to)}
            onChange={(e) => setCustom((c) => ({ from: c?.from ?? toDisplayInput(range.from), to: e.target.value }))}
            className="text-[11px] rounded-md px-2 py-1.5 text-slate-200" style={inset}
          />
          {custom && (
            <button onClick={() => setCustom(null)} className="text-[11px] text-slate-500 hover:text-white underline">reset</button>
          )}
          {/* Which zone every time on this screen is in. The readings are
              Thai-time events; saying so beats an operator discovering the
              answer by adding seven hours in their head. */}
          <span className="text-[10px] text-slate-600" title={`All times shown in ${DISPLAY_TZ_LABEL}`}>
            times in {DISPLAY_TZ_LABEL}
          </span>
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
                  labelFormatter={(v) => fmtDateTime(Number(v))}
                  formatter={(v: unknown, name: string) => {
                    if (Array.isArray(v)) return [`${v[0]} – ${v[1]}${unit ? ` ${unit}` : ''}`, 'Min–Max']
                    return [`${v}${unit ? ` ${unit}` : ''}`, name]
                  }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Area dataKey="band" stroke="none" fill="#6366f1" fillOpacity={0.16} name="Min–Max" isAnimationActive={false} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={1.6} dot={false} name="Average" isAnimationActive={false} />
                {dualBand ? (
                  // Both bands drawn from the real saved rule, not the single
                  // `thresh` slot — that slot only ever holds one direction's
                  // numbers, and drawing it alone here would silently hide
                  // whichever band it didn't happen to pick.
                  bands.map((b) => (
                    <Fragment key={b.direction}>
                      <ReferenceLine y={b.warn} stroke="#fbbf24" strokeDasharray="4 4"
                        label={{ value: `${b.direction} warn`, fill: '#fbbf24', fontSize: 9, position: 'insideTopRight' }} />
                      <ReferenceLine y={b.critical} stroke="#ef4444" strokeDasharray="4 4"
                        label={{ value: `${b.direction} critical`, fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />
                    </Fragment>
                  ))
                ) : (
                  <>
                    {thresh && <ReferenceLine y={thresh.warn} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: 'warn', fill: '#fbbf24', fontSize: 9, position: 'insideTopRight' }} />}
                    {thresh && <ReferenceLine y={thresh.critical} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'critical', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />}
                  </>
                )}
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

        {/* Thresholds. Available for EVERY parameter now, not only the six in
            the product's alarm schema — a real ETERNITY transformer reports
            Oiltemp/H2/RHamb/Tbox and none of those are schema keys, so this
            panel used to tell the operator their actual measurements could not
            be alarmed on at all. The engine matches on key alone, so a rule for
            any key works the moment it is saved. */}
        <div className="p-5 pt-4">
          {(
            <div className="rounded-xl p-4" style={inset}>
              {/* Read-only once a key carries two bands (e.g. a phase voltage
                  alarmed both over and under) — editing here would silently
                  overwrite whichever band .find() happened to return first
                  with the other's numbers. Both bands are still drawn on the
                  chart above; edit them from Alarm & Notify Settings, which
                  shows each band as its own row. */}
              {dualBand && (
                <p className="text-[11px] text-amber-300 mb-3 flex items-center gap-1.5">
                  <TrendingUp size={12} /> This reading has two alarm bands ({bands.map((b) => b.direction).join(' & ')}) —
                  edit both from Alarm &amp; Notify Settings. Shown here read-only.
                </p>
              )}

              {!canEditThresholds && (
                <p className="text-[11px] text-slate-400 mb-3 flex items-center gap-1.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <Shield size={13} className="text-indigo-400 shrink-0" />
                  <span>Official device thresholds set by Administrator (Read-Only). You can customize your own personal alerts in <strong>My Alert Settings</strong>.</span>
                </p>
              )}

              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-indigo-400" /> Alarm &amp; notify thresholds
                  {!schemaParam && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-normal"
                      style={{ color: '#a5b4fc', background: 'rgba(99,102,241,0.15)' }}>custom parameter</span>
                  )}
                </h3>
                {/* A parameter with no schema entry has no built-in direction,
                    so the admin picks it — "is a HIGH reading the problem, or a
                    LOW one" is the one thing the data cannot tell us. */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-600">alarms when the value goes</span>
                  <select value={thresh?.direction ?? 'high'} disabled={!canEdit || !!schemaParam}
                    onChange={(e) => setThresh((t) => (t ? { ...t, direction: e.target.value as 'high' | 'low' } : t))}
                    className="text-[10px] rounded px-1.5 py-1 text-slate-200 outline-none disabled:opacity-60"
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }}
                    title={schemaParam ? 'Fixed by the product alarm schema for this parameter' : 'Which way is the fault'}>
                    <option value="high">above</option>
                    <option value="low">below</option>
                  </select>
                  <span className="text-[10px] text-slate-600">these limits</span>
                </div>
              </div>

              {/* Off by default for a parameter nobody has configured — a
                  device must not start raising alarms on a value the moment
                  someone opens its chart. */}
              <label className="flex items-center gap-2 mb-3 text-[11px] cursor-pointer"
                style={{ color: thresh?.enabled ? '#e2e8f0' : '#64748b' }}>
                <input type="checkbox" checked={!!thresh?.enabled} disabled={!canEdit}
                  onChange={(e) => setThresh((t) => (t ? { ...t, enabled: e.target.checked } : t))} />
                Raise alarms for {param?.label ?? paramKey}
                {!thresh?.enabled && <span className="text-slate-600">— currently not monitored</span>}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[10px] text-amber-400 mb-1 uppercase tracking-wider">Warning</span>
                  <input type="number" step="any"
                    value={Number.isFinite(thresh?.warn as number) ? thresh!.warn : ''}
                    disabled={!canEdit || !thresh?.enabled}
                    placeholder={stats ? `observed ${stats.min.toFixed(1)}–${stats.max.toFixed(1)}` : ''}
                    onChange={(e) => setThresh((t) => (t ? { ...t, warn: e.target.value === '' ? NaN : Number(e.target.value) } : t))}
                    className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-red-400 mb-1 uppercase tracking-wider">Critical</span>
                  <input type="number" step="any"
                    value={Number.isFinite(thresh?.critical as number) ? thresh!.critical : ''}
                    disabled={!canEdit || !thresh?.enabled}
                    placeholder={stats ? `observed ${stats.min.toFixed(1)}–${stats.max.toFixed(1)}` : ''}
                    onChange={(e) => setThresh((t) => (t ? { ...t, critical: e.target.value === '' ? NaN : Number(e.target.value) } : t))}
                    className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                    style={{ background: '#0d1117', border: '1px solid #1e2433' }} />
                </label>
              </div>
              {invalid && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1.5 mt-2">
                  <AlertTriangle size={12} />
                  Critical must be {thresh?.direction === 'high' ? 'higher' : 'lower'} than warning, or it can never fire.
                </p>
              )}
              {blank && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-2">
                  <AlertTriangle size={12} />
                  Enter both limits. The range this parameter has actually reported is shown above.
                </p>
              )}
              {canEditThresholds ? (
                <button
                  onClick={saveThreshold}
                  disabled={!canEdit || invalid || blank || savingRule}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-all"
                  style={gradient}
                >
                  {savingRule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save thresholds
                </button>
              ) : (
                <div className="mt-3 py-2 px-3 rounded-lg text-xs text-slate-500 bg-slate-900/40 border border-slate-800/80 text-center flex items-center justify-center gap-1.5">
                  <Shield size={13} className="text-slate-500" />
                  <span>Read Only — Administrator access required to modify official device thresholds</span>
                </div>
              )}
              <p className="text-[10px] text-slate-600 mt-2">
                Applies to this device. Notifications follow the same limits — the channels are chosen in My Alert Settings.
                {!schemaParam && ' This parameter is not part of the product schema, so these limits exist only for this device.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
