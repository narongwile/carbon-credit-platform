'use client'

// ---------------------------------------------------------------------------
// Data Quality — how much of what this org's devices reported is trustworthy.
//
// This page used to be entirely fabricated: three hardcoded "Bronze / Silver /
// Gold" medallion cards (98%, 1.2M records, "Healthy") and a seven-point trend
// array written into the source. It described a data lake that is not deployed
// here — the Airflow / Spark / MinIO / Superset Applications that would make
// one all sit under argocd/platform-stack/disabled — so an operator reading it
// was being shown invented numbers on the one screen whose entire job is
// telling them whether their data can be trusted.
//
// What it shows now is real and already being recorded:
//   • readings.quality — the enum ('good','sim','error','stale') the ingest
//     path writes per reading.
//   • readings_rollup.n / .bad_n — the same good/not-good split, aggregated
//     hourly by the retention tick before it purges raw rows, so history
//     outlives retention.
//   • device_presence — which devices are actually reporting.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ShieldCheck, CheckCircle2, AlertTriangle, Radio, Loader2, Database } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { api, useIsLive } from '@/lib/api'
import { fmtDayMonth } from '@/lib/displayTime'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }

const RANGES = [7, 14, 30] as const

/** How each stored quality value should read, and what colour it carries. */
const QUALITY_META: Record<string, { label: string; hint: string; color: string }> = {
  good:  { label: 'Good',    hint: 'Accepted as reported',                  color: '#22c55e' },
  sim:   { label: 'Simulated', hint: 'Generated, not measured',             color: '#a78bfa' },
  stale: { label: 'Stale',   hint: 'Device repeated an old value',          color: '#f59e0b' },
  error: { label: 'Error',   hint: 'Device flagged the reading as bad',     color: '#ef4444' },
}

type DQ = NonNullable<Awaited<ReturnType<typeof api.dataQuality>>>

export default function DataQualityPage() {
  const live = useIsLive()
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const [days, setDays] = useState<number>(7)
  const [data, setData] = useState<DQ | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!live) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    api.dataQuality(orgId, days).then((r) => {
      if (cancelled) return
      setData(r); setLoading(false)
    })
    return () => { cancelled = true }
  }, [live, orgId, days])

  const pct = data?.totals.goodPct
  const health = pct === null || pct === undefined ? null : pct >= 99 ? 'Healthy' : pct >= 95 ? 'Degraded' : 'Poor'
  const healthColor = health === 'Healthy' ? '#22c55e' : health === 'Degraded' ? '#f59e0b' : '#ef4444'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Data Quality</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            How much of what your devices reported was accepted as good
          </p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', days === d ? 'text-white' : 'text-slate-400')}
              style={days === d ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : surface}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!live ? (
        <div className="rounded-2xl p-5 text-sm text-slate-400" style={surface}>
          Demo mode has no ingest history. Switch to Live to see this organization&apos;s real data quality.
        </div>
      ) : loading ? (
        <div className="rounded-2xl p-5 flex items-center gap-2 text-sm text-slate-400" style={surface}>
          <Loader2 size={15} className="animate-spin" /> Loading…
        </div>
      ) : !data ? (
        <div className="rounded-2xl p-5 text-sm text-slate-400" style={surface}>
          Could not load data quality for this organization.
        </div>
      ) : data.totals.samples === 0 ? (
        <div className="rounded-2xl p-5 text-sm text-slate-400" style={surface}>
          No readings recorded in the last {data.days} days across {data.devices} device{data.devices === 1 ? '' : 's'}.
          Nothing to score yet — this is not a quality problem.
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl p-5" style={surface}>
              <div className="flex justify-between items-start mb-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${healthColor}1f`, color: healthColor }}>
                  <ShieldCheck size={20} />
                </div>
                <span className="text-xs font-bold" style={{ color: healthColor }}>{health}</span>
              </div>
              <div className="text-3xl font-bold text-white">{pct?.toFixed(2)}%</div>
              <p className="text-sm text-slate-500 mt-1">good readings, last {data.days} days</p>
            </div>

            <div className="rounded-2xl p-5" style={surface}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
                <Database size={20} />
              </div>
              <div className="text-3xl font-bold text-white">{data.totals.samples.toLocaleString()}</div>
              <p className="text-sm text-slate-500 mt-1">
                readings scored · <span className="text-red-400">{data.totals.bad.toLocaleString()}</span> not good
              </p>
            </div>

            <div className="rounded-2xl p-5" style={surface}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
                <Radio size={20} />
              </div>
              <div className="text-3xl font-bold text-white">{data.presence.online}<span className="text-lg text-slate-600">/{data.devices}</span></div>
              <p className="text-sm text-slate-500 mt-1">
                devices reporting
                {data.presence.never > 0 && <> · <span className="text-amber-400">{data.presence.never} never seen</span></>}
              </p>
            </div>
          </div>

          {/* Breakdown by stored quality value */}
          <div className="rounded-2xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-4">Breakdown</h3>
            <div className="space-y-3">
              {Object.entries(data.byQuality)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => {
                  const m = QUALITY_META[k] ?? { label: k, hint: 'Unrecognised quality value', color: '#64748b' }
                  const share = data.totals.samples ? (n / data.totals.samples) * 100 : 0
                  return (
                    <div key={k}>
                      <div className="flex justify-between items-baseline text-sm mb-1">
                        <span className="font-medium" style={{ color: m.color }}>{m.label}</span>
                        <span className="text-slate-400">{n.toLocaleString()} <span className="text-slate-600">({share.toFixed(1)}%)</span></span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#0a0e1a' }}>
                        <div className="h-full rounded-full" style={{ width: `${share}%`, background: m.color }} />
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1">{m.hint}</p>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Trend */}
          {data.trend.length > 1 && (
            <div className="rounded-2xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-4">{data.days}-day trend</h3>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dq-good" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} tickFormatter={(d) => fmtDayMonth(`${d}T00:00:00`)} />
                  <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: '#0a0e1a', border: '1px solid #1e2433', borderRadius: 8, color: '#fff' }}
                    formatter={(v: number, _n, p) => [`${v}% good · ${p.payload.samples.toLocaleString()} readings`, 'Quality']}
                    labelFormatter={(d) => fmtDayMonth(`${d}T00:00:00`)}
                  />
                  <Area type="monotone" dataKey="goodPct" stroke="#22c55e" strokeWidth={2.5} fill="url(#dq-good)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Where to actually go and fix something */}
          <div className="rounded-2xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-1">Devices reporting bad readings</h3>
            <p className="text-xs text-slate-500 mb-4">Ranked by number of not-good readings in the last {data.days} days.</p>
            {data.worst.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle2 size={15} /> Every device reported clean data in this period.
              </p>
            ) : (
              <div className="space-y-2">
                {data.worst.map((w) => (
                  <div key={w.nodeId} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{w.name}</div>
                      <div className="text-[11px] text-slate-600 font-mono truncate">{w.nodeId}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <AlertTriangle size={13} className="text-amber-400" />
                      <span className="text-sm text-slate-300">{w.bad.toLocaleString()}<span className="text-slate-600">/{w.samples.toLocaleString()}</span></span>
                      <span className="text-xs font-bold w-14 text-right" style={{ color: w.badPct >= 20 ? '#ef4444' : '#f59e0b' }}>{w.badPct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-600">
            Source: {data.sources.length ? data.sources.join(' + ') : 'no data'} · &quot;not good&quot; means the ingest
            path stored a quality other than <span className="font-mono">good</span>.
          </p>
        </>
      )}
    </div>
  )
}
