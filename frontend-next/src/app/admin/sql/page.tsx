'use client'

// ---------------------------------------------------------------------------
// Read-only SQL console (superadmin).
//
// This replaces "SQL AI", which was a prop end to end: the backend answered
// every question with the same hardcoded paragraph about BloodBOX units on
// Floor 3, the schema explorer listed four tables that have never existed
// (carbon_emissions, sensor_readings, sites, carbon_credits — the real ones
// are readings, nodes, alarm_events…), and because the response carried no
// `sql` field the page always displayed the same fallback SELECT no matter
// what was typed. No model is configured anywhere in this platform, so the
// natural-language half had nothing behind it; what is left is the half that
// can be real — browse the actual schema, run an actual query.
//
// Everything that makes "read-only" true is enforced server-side (see
// sqlConsoleFunc): SELECT/WITH only, single statement, no comments, secret
// tables refused, no database-qualified names, execution wrapped in a derived
// table so the row cap and the SELECT-ness are structural, and a query timeout.
// The notes in this UI describe those rules; they do not implement them.
//
// Isolation is by CONNECTION, also server-side: an org admin is handed their
// own iothub_<org> pool and an org with no tenant database of its own is
// refused rather than quietly given the shared one. Which database answered is
// echoed back and shown in the header, so it is never a guess.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Database, Play, Copy, Download, Table, CheckCircle2, ChevronRight, ChevronDown, Loader2, ShieldAlert, AlertTriangle } from 'lucide-react'
import { api, useIsLive } from '@/lib/api'
import { fmtHM } from '@/lib/displayTime'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const ROW_LIMITS = [50, 200, 500, 1000]

interface SchemaTable { name: string; columns: { name: string; type: string }[] }
interface HistoryItem { sql: string; ts: Date; rowCount: number }

export default function SqlConsolePage() {
  const live = useIsLive()

  const [schema, setSchema] = useState<SchemaTable[] | null>(null)
  const [schemaError, setSchemaError] = useState('')
  const [database, setDatabase] = useState('')
  const [blocked, setBlocked] = useState<string[]>([])
  const [openTable, setOpenTable] = useState<string | null>(null)
  const [sql, setSql] = useState('')
  const [running, setRunning] = useState(false)
  const [limit, setLimit] = useState(200)
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [meta, setMeta] = useState<{ rowCount: number; truncated: boolean; elapsedMs: number } | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [tab, setTab] = useState<'query' | 'history'>('query')

  useEffect(() => {
    if (!live) return
    let cancelled = false
    api.sqlSchema().then((r) => {
      if (cancelled) return
      if (!r.ok) { setSchemaError(r.error); setSchema([]); return }
      setSchemaError('')
      setSchema(r.tables ?? [])
      setBlocked(r.blocked ?? [])
      setDatabase(r.database ?? '')
    })
    return () => { cancelled = true }
  }, [live])

  const insert = (text: string) => setSql((p) => p + (p && !/\s$/.test(p) ? ' ' : '') + text)

  const run = async () => {
    if (!sql.trim() || running) return
    setRunning(true); setError('')
    const res = await api.runSql(sql.trim(), limit)
    setRunning(false)
    if (!res.ok) {
      setError(res.error); setColumns([]); setRows([]); setMeta(null)
      return
    }
    setColumns(res.columns ?? [])
    setRows(res.rows ?? [])
    setMeta({ rowCount: res.rowCount, truncated: res.truncated, elapsedMs: res.elapsedMs })
    if (res.database) setDatabase(res.database)
    setHistory((h) => [{ sql: sql.trim(), ts: new Date(), rowCount: res.rowCount }, ...h].slice(0, 25))
  }

  const copy = () => { navigator.clipboard.writeText(sql); toast.success('Query copied') }

  const exportCSV = () => {
    if (!rows.length) return
    // Quote every field: a value containing a comma, quote or newline would
    // otherwise silently shift every column after it.
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [columns.map(esc).join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    link.download = 'query_export.csv'
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
    toast.success('CSV exported')
  }

  // The server refuses an org whose data still lives in the shared control
  // database — there is no way to confine a query to their rows there, so the
  // honest answer is "not yet", with what has to change to make it available.
  if (schemaError && /own database/i.test(schemaError)) {
    return (
      <div className="p-6">
        <div className="rounded-xl p-5 flex items-start gap-3 max-w-2xl" style={surface}>
          <ShieldAlert size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h1 className="text-base font-bold text-white">SQL console not available for this organization</h1>
            <p className="text-sm text-slate-400 mt-1">
              This console gives you your organization&apos;s own database and nothing else. Your data currently lives in
              the shared platform database, where a query could reach other customers&apos; rows — so it is refused
              rather than opened up. A platform administrator can migrate this organization onto its own database to
              enable it.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">SQL Console</h1>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-300" style={inset}>
          <Database size={13} className="text-indigo-400" /> read-only
        </span>
        {database && (
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-400" style={inset} title="Every query on this page runs against this database only">
            {database === 'control' ? 'platform database' : database}
          </span>
        )}
      </div>

      {!live && (
        <div className="rounded-xl p-3 flex items-center gap-2 text-xs text-amber-300" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <AlertTriangle size={14} /> Demo mode has no database — switch to Live to run queries.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Schema explorer — the real database, not a hardcoded list */}
        <div className="rounded-xl p-4 overflow-y-auto max-h-[70vh]" style={surface}>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5">
            <Table size={13} /> Schema {schema && <span className="text-slate-600">({schema.length})</span>}
          </h3>
          {schema === null ? (
            <p className="text-xs text-slate-600">{live ? 'Loading schema…' : 'Live mode required.'}</p>
          ) : schemaError ? (
            <p className="text-xs text-red-400">{schemaError}</p>
          ) : schema.length === 0 ? (
            <p className="text-xs text-slate-600">No tables found.</p>
          ) : (
            <div className="space-y-1">
              {schema.map((t) => (
                <div key={t.name}>
                  <button
                    onClick={() => setOpenTable(openTable === t.name ? null : t.name)}
                    className="flex items-center gap-1 text-sm font-bold text-indigo-400 hover:text-indigo-300 w-full text-left py-0.5"
                  >
                    {openTable === t.name ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="truncate">{t.name}</span>
                  </button>
                  {openTable === t.name && (
                    <div className="pl-5 pb-2 space-y-1">
                      <button onClick={() => insert(t.name)} className="text-[10px] text-slate-500 hover:text-indigo-400">
                        insert table name
                      </button>
                      {t.columns.map((c) => (
                        <button key={c.name} onClick={() => insert(c.name)}
                          className="flex items-baseline gap-2 text-xs text-slate-500 font-mono hover:text-indigo-400 w-full text-left">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-700 flex-shrink-0" />
                          <span className="truncate">{c.name}</span>
                          <span className="text-[9px] text-slate-700 truncate">{c.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {blocked.length > 0 && (
            <p className="text-[10px] text-slate-600 mt-4 pt-3" style={{ borderTop: '1px solid #1e2433' }}>
              Not queryable (credentials / secrets): {blocked.join(', ')}
            </p>
          )}
        </div>

        {/* Query + results */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl p-5" style={surface}>
            <div className="flex gap-5 mb-4" style={{ borderBottom: '1px solid #1e2433' }}>
              {(['query', 'history'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={clsx('text-sm font-bold pb-2.5 border-b-2 transition-colors capitalize',
                    tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500')}>
                  {t === 'query' ? 'Query' : `History (${history.length})`}
                </button>
              ))}
            </div>

            {tab === 'query' ? (
              <>
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }}
                  rows={6}
                  spellCheck={false}
                  placeholder={'SELECT node_id, param_key, COUNT(*) AS n\nFROM readings\nWHERE taken_at > NOW() - INTERVAL 1 DAY\nGROUP BY node_id, param_key\nORDER BY n DESC'}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono"
                  style={inset}
                />
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <button onClick={run} disabled={running || !live || !sql.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={gradient}>
                    {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {running ? 'Running…' : 'Run'}
                  </button>
                  <button onClick={copy} disabled={!sql} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40">
                    <Copy size={12} /> Copy
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 ml-auto">
                    Row limit
                    <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                      className="rounded-lg px-2 py-1 text-xs text-slate-200 outline-none" style={inset}>
                      {ROW_LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-2.5 text-[10px] text-slate-600">
                  SELECT or WITH only, one statement at a time, no comments, no database-qualified names, capped at the
                  row limit above and 8s of runtime. Enforced on the server — ⌘/Ctrl + Enter runs.
                </p>
              </>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.length ? history.map((h, i) => (
                  <button key={i} onClick={() => { setSql(h.sql); setTab('query') }}
                    className="w-full text-left p-2.5 rounded-lg text-xs hover:bg-white/3" style={inset}>
                    <div className="text-slate-300 font-mono truncate">{h.sql}</div>
                    <div className="text-slate-600 mt-0.5">{fmtHM(h.ts)} · {h.rowCount} row{h.rowCount === 1 ? '' : 's'}</div>
                  </button>
                )) : <p className="text-xs text-slate-600">No queries run yet.</p>}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-red-300 font-mono text-xs leading-relaxed">{error}</span>
              </div>
            </div>
          )}

          {meta && !error && (
            <div className="rounded-xl overflow-hidden" style={surface}>
              <div className="flex items-center justify-between px-4 py-2.5 flex-wrap gap-2" style={{ borderBottom: '1px solid #1e2433' }}>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-green-400" />
                  {meta.rowCount} row{meta.rowCount === 1 ? '' : 's'} · {meta.elapsedMs}ms
                  {meta.truncated && <span className="text-amber-400 normal-case font-normal">· capped at {limit}, there may be more</span>}
                </span>
                {rows.length > 0 && (
                  <button onClick={exportCSV} className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300">
                    <Download size={12} /> Export CSV
                  </button>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="p-4 text-xs text-slate-600">The query ran and returned no rows.</p>
              ) : (
                <div className="overflow-x-auto max-h-[45vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr style={{ background: '#0a0e1a' }}>
                        {columns.map((k) => <th key={k} className="text-left py-2 px-4 text-xs text-slate-500 font-medium whitespace-nowrap">{k}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #1e2433' }}>
                          {columns.map((c) => (
                            <td key={c} className="py-2 px-4 text-slate-300 font-mono text-xs whitespace-nowrap">
                              {r[c] === null ? <span className="text-slate-700 italic">NULL</span> : String(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
