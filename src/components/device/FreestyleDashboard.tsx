'use client'

import { useMemo, useState } from 'react'
import type { ManagedDevice } from '@/types/org'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { RefreshCw, ExternalLink, Link2, Clock, LayoutDashboard } from 'lucide-react'

// Grafana-flavoured palette
const G = { page: '#111217', panel: '#181b1f', border: '#23262e', title: '#ccccdc', sub: '#8e8e8e' }
const SERIES = { green: '#73bf69', blue: '#5794f2', yellow: '#fade2a', red: '#f2495c', orange: '#ff9830', purple: '#b877d9' }

const RANGES = ['Last 6 hours', 'Last 24 hours', 'Last 7 days', 'Last 30 days']

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

function GrafanaPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md overflow-hidden" style={{ background: G.panel, border: `1px solid ${G.border}` }}>
      <div className="px-3 py-2 text-xs font-medium" style={{ color: G.title, borderBottom: `1px solid ${G.border}` }}>{title}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function MiniGauge({ value, color }: { value: number; color: string }) {
  const cx = 70, cy = 70, r = 54
  const polar = (f: number) => { const a = Math.PI - f * Math.PI; return [cx + r * Math.cos(a), cy - r * Math.sin(a)] }
  const [sx, sy] = polar(0), [ex, ey] = polar(value / 100)
  const large = value / 100 > 0.5 ? 1 : 0
  return (
    <svg width="140" height="84" viewBox="0 0 140 80" className="mx-auto">
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`} fill="none" stroke="#2a2d34" strokeWidth="10" strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="26" fontWeight="700">{value}</text>
    </svg>
  )
}

export default function FreestyleDashboard({ device }: { device: ManagedDevice }) {
  const [range, setRange] = useState(RANGES[1])
  const [embedUrl, setEmbedUrl] = useState('')
  const [showEmbed, setShowEmbed] = useState(false)

  const seed = hash(device.id)
  const series = useMemo(() => {
    const out: { t: string; a: number; b: number }[] = []
    for (let i = 23; i >= 0; i--) out.push({ t: `${i}:00`, a: 50 + ((seed + i * 7) % 35), b: 30 + ((seed + i * 11) % 40) })
    return out.reverse()
  }, [seed])
  const bars = useMemo(() => ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'].map((n, i) => ({ n, v: 20 + ((seed + i * 13) % 70) })), [seed])
  const barColor = (v: number) => (v > 75 ? SERIES.red : v > 55 ? SERIES.orange : SERIES.green)
  const gaugeVal = 40 + (seed % 55)
  const statVal = (parseFloat(device.lastValue ?? '0') || 24 + (seed % 40))

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: G.page, border: `1px solid ${G.border}` }}>
      {/* Grafana toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${G.border}` }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f55f3e,#fff200)' }}>
            <LayoutDashboard size={13} className="text-[#111217]" />
          </span>
          <span className="text-sm font-semibold" style={{ color: G.title }}>Grafana</span>
          <span className="text-xs" style={{ color: G.sub }}>/ {device.name} — Free Style</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs" style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}>
            <Clock size={12} />
            <select value={range} onChange={(e) => setRange(e.target.value)} className="bg-transparent outline-none" style={{ color: G.title }}>
              {RANGES.map((r) => <option key={r} value={r} style={{ background: G.panel }}>{r}</option>)}
            </select>
          </div>
          <button className="p-1.5 rounded" style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}><RefreshCw size={13} /></button>
          <button onClick={() => setShowEmbed((s) => !s)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs" style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}>
            <Link2 size={12} /> Embed URL
          </button>
          <a href={embedUrl || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-white" style={{ background: '#f55f3e' }}>
            <ExternalLink size={12} /> Open in Grafana
          </a>
        </div>
      </div>

      {showEmbed && (
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${G.border}` }}>
          <input
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            placeholder="Paste Grafana panel/dashboard embed URL (e.g. https://grafana.example.com/d-solo/...)"
            className="w-full rounded px-3 py-2 text-xs outline-none"
            style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}
          />
          <p className="text-[11px] mt-1.5" style={{ color: G.sub }}>
            Free-Style dashboards are composed and managed in Grafana. Provide an embed URL to render the live dashboard; otherwise a reference layout is shown.
          </p>
        </div>
      )}

      {/* Body */}
      {embedUrl ? (
        <iframe src={embedUrl} title="Grafana dashboard" className="w-full" style={{ height: 520, border: 'none', background: G.page }} />
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <GrafanaPanel title="Time series — primary metric">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={series} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES.green} stopOpacity={0.4} /><stop offset="100%" stopColor={SERIES.green} stopOpacity={0} /></linearGradient>
                    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES.blue} stopOpacity={0.3} /><stop offset="100%" stopColor={SERIES.blue} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 2" stroke="#2a2d34" />
                  <XAxis dataKey="t" stroke={G.sub} fontSize={10} tickLine={false} minTickGap={28} />
                  <YAxis stroke={G.sub} fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: G.panel, border: `1px solid ${G.border}`, borderRadius: 4, color: G.title }} />
                  <Area type="monotone" dataKey="a" stroke={SERIES.green} strokeWidth={2} fill="url(#ga)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="b" stroke={SERIES.blue} strokeWidth={2} fill="url(#gb)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </GrafanaPanel>
          </div>
          <GrafanaPanel title="Stat">
            <div className="flex flex-col items-center justify-center h-[200px]">
              <div className="text-5xl font-bold" style={{ color: SERIES.green }}>{statVal.toFixed(1)}</div>
              <div className="text-xs mt-2" style={{ color: G.sub }}>current value</div>
            </div>
          </GrafanaPanel>
          <GrafanaPanel title="Gauge">
            <div className="flex items-center justify-center h-[180px]">
              <MiniGauge value={gaugeVal} color={gaugeVal > 75 ? SERIES.red : gaugeVal > 55 ? SERIES.orange : SERIES.green} />
            </div>
          </GrafanaPanel>
          <div className="lg:col-span-2">
            <GrafanaPanel title="Bar gauge — by node">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={bars} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#2a2d34" vertical={false} />
                  <XAxis dataKey="n" stroke={G.sub} fontSize={10} tickLine={false} />
                  <YAxis stroke={G.sub} fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: G.panel, border: `1px solid ${G.border}`, borderRadius: 4, color: G.title }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                    {bars.map((b) => <Cell key={b.n} fill={barColor(b.v)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </GrafanaPanel>
          </div>
        </div>
      )}
    </div>
  )
}
