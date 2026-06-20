'use client'

import { useState } from 'react'
import { Database, Play, Copy, Download, Sparkles, Terminal, Table, CheckCircle2, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const TABLES = [
  { name: 'carbon_emissions', columns: ['id', 'org_id', 'emission_type', 'amount_tco2e', 'recorded_at'] },
  { name: 'sensor_readings', columns: ['id', 'sensor_id', 'value', 'status', 'taken_at'] },
  { name: 'sites', columns: ['id', 'org_id', 'name', 'lat', 'lng'] },
  { name: 'carbon_credits', columns: ['id', 'amount', 'status', 'issued_at'] },
]

interface HistoryItem { query: string; sql: string; ts: Date }

export default function SqlGenPage() {
  const [query, setQuery] = useState('')
  const [sql, setSql] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, string | number>[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [tab, setTab] = useState<'new' | 'history'>('new')

  const insert = (text: string) => setQuery((p) => p + (p && !p.endsWith(' ') ? ' ' : '') + text + ' ')

  const generate = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res: any = await api.aiQuery(query)
      const generatedSql = res.sql || `SELECT * FROM ${res.sources?.[0] || 'data'} LIMIT 10;`
      setSql(generatedSql)
      setResults(res.results || [])
      setHistory((h) => [{ query, sql: generatedSql, ts: new Date() }, ...h])
    } catch (e) {
      toast.error('Failed to generate SQL')
    } finally {
      setLoading(false)
    }
  }

  const copy = () => { navigator.clipboard.writeText(sql); toast.success('SQL copied') }
  const exportCSV = () => {
    if (!results.length) return
    const headers = Object.keys(results[0]).join(',')
    const rows = results.map((r) => Object.values(r).join(','))
    const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'query_export.csv'
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
    toast.success('CSV exported')
  }

  const highlight = (s: string) => {
    if (!s) return '-- Describe your requirement on the left to generate SQL'
    const kw = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'DESC', 'ASC', 'AS', 'AND', 'OR', 'SUM', 'COUNT', 'AVG', 'INTERVAL', 'NOW']
    let out = s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    kw.forEach((k) => { out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), `<span style="color:#f472b6;font-weight:700">${k}</span>`) })
    out = out.replace(/'(.*?)'/g, `<span style="color:#4ade80">'$1'</span>`)
    return out
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-white">SQL AI</h1>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-300" style={inset}><Database size={13} className="text-indigo-400" /> natural language → SQL</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Schema explorer */}
        <div className="rounded-xl p-4 overflow-y-auto max-h-[70vh]" style={surface}>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5"><Table size={13} /> Schema Explorer</h3>
          <div className="space-y-4">
            {TABLES.map((t) => (
              <div key={t.name}>
                <div className="flex items-center gap-1 text-sm font-bold text-indigo-400 mb-2"><ChevronRight size={13} /> {t.name}</div>
                <div className="pl-4 space-y-1.5">
                  {t.columns.map((c) => (
                    <button key={c} onClick={() => insert(c)} className="flex items-center gap-2 text-xs text-slate-500 font-mono hover:text-indigo-400 transition-colors w-full text-left">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-700" /> {c}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input + SQL */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl p-5" style={surface}>
            <div className="flex gap-5 mb-4" style={{ borderBottom: '1px solid #1e2433' }}>
              {(['new', 'history'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={clsx('text-sm font-bold pb-2.5 border-b-2 transition-colors capitalize', tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500')}>{t === 'new' ? 'New Query' : `History (${history.length})`}</button>
              ))}
            </div>
            {tab === 'new' ? (
              <>
                <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} placeholder="e.g. total emissions by type for the last year"
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 resize-none" style={inset} />
                <button onClick={generate} disabled={loading} className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
                  <Play size={14} /> {loading ? 'Generating…' : 'Generate SQL'}
                </button>
              </>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.length ? history.map((h, i) => (
                  <button key={i} onClick={() => { setQuery(h.query); setSql(h.sql); setTab('new') }} className="w-full text-left p-2.5 rounded-lg text-xs" style={inset}>
                    <div className="text-slate-300">{h.query}</div>
                    <div className="text-slate-600 mt-0.5">{h.ts.toLocaleTimeString()}</div>
                  </button>
                )) : <p className="text-xs text-slate-600">No history yet.</p>}
              </div>
            )}
          </div>

          {/* SQL output */}
          <div className="rounded-xl overflow-hidden" style={surface}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1e2433' }}>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Generated SQL</span>
              <button onClick={copy} disabled={!sql} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40"><Copy size={12} /> Copy</button>
            </div>
            <pre className="p-4 text-sm font-mono leading-relaxed overflow-x-auto" style={{ background: '#05070d' }} dangerouslySetInnerHTML={{ __html: highlight(sql) }} />
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={surface}>
              <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #1e2433' }}>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><CheckCircle2 size={13} className="text-green-400" /> {results.length} rows</span>
                <button onClick={exportCSV} className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"><Download size={12} /> Export CSV</button>
              </div>
              <table className="w-full text-sm">
                <thead><tr style={{ background: '#0a0e1a' }}>{Object.keys(results[0]).map((k) => <th key={k} className="text-left py-2 px-4 text-xs text-slate-500 font-medium">{k}</th>)}</tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #1e2433' }}>{Object.values(r).map((v, j) => <td key={j} className="py-2 px-4 text-slate-300 font-mono text-xs">{String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
