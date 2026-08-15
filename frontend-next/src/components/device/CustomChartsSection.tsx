'use client'

// ---------------------------------------------------------------------------
// Admin-configurable trend charts, rendered below the device's photo gallery.
// Unlike the two fixed 2-series charts above (CHART_ROLES, pattern-matched
// against a hardcoded set of roles), every chart here is admin-composed: any
// number of this device's own parameters, any number of charts. Each fetches
// its own window in one round trip via readingsGetFunc's paramKey=a,b,c form.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, useIsLive, type ChartDefinition } from '@/lib/api'
import type { SensorDomain } from '@/types/fleet'
import { fmtHM, fmtDayMonth } from '@/lib/displayTime'
import ChartBuilderModal, { type AvailableParam } from './ChartBuilderModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Plus, Pencil, LayoutDashboard } from 'lucide-react'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const tooltipStyle = { background: '#0d1117', border: '1px solid #1e2433', borderRadius: '8px', fontSize: '11px' }

// A fixed, high-contrast palette rather than random colors — legible against
// the dark surface and stable across re-renders/re-orderings of the same chart.
const PALETTE = ['#6366f1', '#f97316', '#22d3ee', '#a78bfa', '#4ade80', '#fbbf24', '#ec4899', '#38bdf8']

const QUICK = [
  { id: '1h', label: '1h', minutes: 60 },
  { id: '24h', label: '24h', minutes: 1440 },
  { id: '7d', label: '7d', minutes: 10080 },
] as const

interface Row { param_key: string; value: number; taken_at: string }

function MultiParamChart({ nodeId, chart, paramByKey }: { nodeId: string; chart: ChartDefinition; paramByKey: Map<string, AvailableParam> }) {
  const [quick, setQuick] = useState<(typeof QUICK)[number]['id']>('24h')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    const minutes = QUICK.find((q) => q.id === quick)?.minutes ?? 1440
    const to = Date.now()
    const from = to - minutes * 60_000
    const bucketSec = Math.max(60, (to - from) / 1000 / 200)
    api.readingsWindow(nodeId, new Date(from).toISOString(), new Date(to).toISOString(), bucketSec, chart.paramKeys.join(','))
      .then((r) => { if (!cancelled) setRows((r ?? []) as Row[]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, chart.paramKeys, quick])

  useEffect(() => load(), [load])

  const data = useMemo(() => {
    const spanHours = quick === '7d' ? 168 : quick === '24h' ? 24 : 1
    const byTime = new Map<string, Record<string, number | string>>()
    for (const r of rows ?? []) {
      const row = byTime.get(r.taken_at) ?? { time: spanHours > 36 ? fmtDayMonth(r.taken_at) : fmtHM(r.taken_at), ts: new Date(r.taken_at).getTime() }
      row[r.param_key] = Number(r.value)
      byTime.set(r.taken_at, row)
    }
    return Array.from(byTime.values()).sort((a, b) => (a.ts as number) - (b.ts as number))
  }, [rows, quick])

  const nameOf = (key: string) => {
    const p = paramByKey.get(key)
    return p ? (p.unit ? `${p.label} (${p.unit})` : p.label) : key
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        {QUICK.map((q) => (
          <button key={q.id} onClick={() => setQuick(q.id)}
            className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${quick === q.id ? 'text-white' : 'text-slate-500'}`}
            style={quick === q.id ? { background: '#6366f1' } : inset}>
            {q.label}
          </button>
        ))}
        {loading && <span className="text-[10px] text-slate-600 ml-1">loading…</span>}
      </div>
      {!data.length ? (
        <div className="h-[140px] flex items-center justify-center text-[11px] text-slate-600">
          {loading ? 'Loading…' : 'No stored readings in this period'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
            {chart.paramKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.5}
                dot={false} name={nameOf(key)} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default function CustomChartsSection({
  nodeId, orgId, domain, availableParams, canConfigure,
}: {
  nodeId: string
  orgId?: string
  domain: SensorDomain
  availableParams: AvailableParam[]
  canConfigure: boolean
}) {
  const live = useIsLive()
  const [charts, setCharts] = useState<ChartDefinition[] | null>(null)
  const [editing, setEditing] = useState<ChartDefinition | 'new' | null>(null)

  const reload = useCallback(() => {
    if (!live) { setCharts([]); return }
    api.listCharts(nodeId).then((r) => setCharts(r ?? []))
  }, [nodeId, live])

  useEffect(() => { reload() }, [reload])

  const paramByKey = useMemo(() => {
    const m = new Map<string, AvailableParam>()
    for (const p of availableParams) m.set(p.key, p)
    return m
  }, [availableParams])

  // Nothing configured and the viewer cannot add one — no point showing an
  // empty section header on every device page that has never used this.
  if (!canConfigure && charts !== null && charts.length === 0) return null

  return (
    <div className="flex-shrink-0 p-3" style={{ borderTop: '1px solid #1e2433' }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <LayoutDashboard size={11} /> Custom Charts
        </div>
        {canConfigure && live && (
          <button onClick={() => setEditing('new')} title="Add a chart"
            className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400">
            <Plus size={11} /> Add chart
          </button>
        )}
      </div>

      {!live ? (
        <p className="text-[11px] text-slate-600">Switch to Live mode to configure custom charts.</p>
      ) : charts === null ? (
        <p className="text-[11px] text-slate-600">Loading…</p>
      ) : charts.length === 0 ? (
        <p className="text-[11px] text-slate-600">
          No custom charts yet{canConfigure ? ' — combine any parameters this device reports into a chart of your own.' : '.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {charts.map((c) => (
            <div key={c.id} className="rounded-xl p-3" style={inset}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-medium text-slate-200 truncate">{c.title}</div>
                {canConfigure && (
                  <button onClick={() => setEditing(c)} title="Edit this chart"
                    className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-white/5 shrink-0">
                    <Pencil size={11} />
                  </button>
                )}
              </div>
              <MultiParamChart nodeId={nodeId} chart={c} paramByKey={paramByKey} />
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ChartBuilderModal
          nodeId={nodeId}
          orgId={orgId}
          domain={domain}
          availableParams={availableParams}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}
