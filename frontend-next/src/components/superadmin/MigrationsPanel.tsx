'use client'

// ---------------------------------------------------------------------------
// Schema migration status, and the button that fixes it.
// ---------------------------------------------------------------------------
// This replaced a "Deploy Update" button that had no onClick at all. Deploying
// is GitOps here — ArgoCD watches the repo — so a deploy button in the console
// would be a second, unaudited path to production. What genuinely had no UI,
// and needed one, is the step deploying does NOT do: bringing every tenant
// database up to the schema the freshly-deployed code expects. Forgetting it
// leaves an org silently running an older schema than the code beside it,
// which is exactly the failure migrate.ts's own comments warn about.
//
// The control database is reported but deliberately NOT runnable from here:
// /migrate/all-orgs is tenant-only and the control schema is applied by the
// deploy-time Job. A button that claimed to fix it would be lying.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { api, useIsLive, type MigrationStatus, type MigrationRunResult } from '@/lib/api'
import { X, Database, Play, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

/** Status + a refresh, shared by the header badge and the panel. */
export function useMigrationStatus() {
  const live = useIsLive()
  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    if (!live) { setStatus(null); return }
    setLoading(true)
    api.migrationStatus().then((r) => setStatus(r)).finally(() => setLoading(false))
  }, [live])

  useEffect(() => { reload() }, [reload])
  return { status, loading, reload }
}

export default function MigrationsPanel({
  status, loading, reload, onClose,
}: {
  status: MigrationStatus | null
  loading: boolean
  reload: () => void
  onClose: () => void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationRunResult | null>(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    const r = await api.runMigrations()
    setRunning(false)
    if (!r) { toast.error('Could not reach the migrate service'); return }
    setResult(r)
    if (r.ok) toast.success(`${r.migrated.length} database${r.migrated.length === 1 ? '' : 's'} up to date`)
    else toast.error(`${r.failed.length} organization${r.failed.length === 1 ? '' : 's'} failed — see the list`)
    reload()
  }

  const behind = status?.orgsBehind ?? 0

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-16 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Database size={15} className="text-indigo-400" /> Schema migrations
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {status
                ? <>This build ships <b className="text-slate-300">{status.expected}</b> migration files, newest <span className="font-mono text-slate-400">{status.newest}</span>.</>
                : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={reload} disabled={loading} className="p-2 rounded-lg text-slate-400 hover:text-white disabled:opacity-40" title="Re-check">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
        </div>

        {!status ? (
          <p className="p-8 text-center text-xs text-slate-600">
            {loading ? 'Checking every database…' : 'Switch to Live mode to check migration status.'}
          </p>
        ) : (
          <>
            <div className="p-5 space-y-3">
              {/* Control DB — reported, never run from here. */}
              <div className="rounded-lg p-3" style={inset}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">Control database</span>
                  <span className="text-[10px] font-mono text-slate-600">{status.control.db}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{status.control.applied} applied</span>
                  {status.controlBehind === 0
                    ? <CheckCircle2 size={13} className="text-emerald-400" />
                    : <AlertTriangle size={13} className="text-amber-400" />}
                </div>
                {status.controlBehind > 0 && (
                  <p className="text-[11px] text-amber-400 mt-1.5">
                    {status.controlBehind} file{status.controlBehind === 1 ? '' : 's'} not applied
                    ({status.control.pending.slice(0, 4).join(', ')}{status.control.pending.length > 4 ? '…' : ''}).
                    The control schema is applied by the deploy Job — this needs a deploy, not the button below.
                  </p>
                )}
              </div>

              {!status.tenantMode ? (
                <p className="text-[11px] text-slate-500">
                  TENANT_DB_MODE is off — every organization shares the control database above, so there are no tenant
                  databases to migrate.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Tenant databases</span>
                    <span className="text-[10px]" style={{ color: behind ? '#fbbf24' : '#4ade80' }}>
                      {behind ? `${behind} behind` : 'all up to date'}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                    {status.orgs.map((o) => {
                      const ok = !o.error && o.pending.length === 0
                      return (
                        <div key={o.orgId} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={inset}>
                          <span className="text-xs text-white truncate flex-1 min-w-0">{o.name || o.orgId}</span>
                          {o.onControlDb ? (
                            <span className="text-[10px] text-slate-600">on the control database</span>
                          ) : (
                            <>
                              <span className="text-[9px] font-mono text-slate-600 truncate max-w-[140px]">{o.db}</span>
                              <span className="text-[10px] text-slate-500 shrink-0">{o.applied}/{status.expected}</span>
                              {ok
                                ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                                : <AlertTriangle size={12} className="text-amber-400 shrink-0" />}
                            </>
                          )}
                        </div>
                      )
                    })}
                    {status.orgs.length === 0 && <p className="text-[11px] text-slate-600">No organizations.</p>}
                  </div>
                  {/* Why an org is behind, spelled out rather than left to a count. */}
                  {status.orgs.filter((o) => !o.onControlDb && (o.error || o.pending.length)).map((o) => (
                    <p key={o.orgId} className="text-[11px] text-amber-400">
                      <b>{o.name || o.orgId}</b>: {o.error
                        ? `database unreachable — ${o.error}`
                        : `${o.pending.length} pending (${o.pending.slice(0, 4).join(', ')}${o.pending.length > 4 ? '…' : ''})`}
                    </p>
                  ))}
                </>
              )}
            </div>

            {/* Result of the last run — per organization, which is the point. */}
            {result && (
              <div className="mx-5 mb-4 rounded-lg p-3 space-y-1.5" style={inset}>
                <div className="flex items-center gap-2 text-xs font-medium" style={{ color: result.ok ? '#4ade80' : '#f87171' }}>
                  {result.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {result.ok ? 'Every tenant database is current' : 'Some organizations failed'}
                </div>
                {result.migrated.map((m) => (
                  <div key={m.orgId} className="flex items-center gap-2 text-[11px]">
                    <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                    <span className="text-slate-300">{m.orgId}</span>
                    <span className="font-mono text-slate-600">{m.db}</span>
                    <span className="ml-auto text-slate-500">{m.applied} applied</span>
                  </div>
                ))}
                {result.failed.map((f) => (
                  <div key={f.orgId} className="flex items-start gap-2 text-[11px]">
                    <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-slate-300 shrink-0">{f.orgId}</span>
                    <span className="text-red-400 break-all">{f.error}</span>
                  </div>
                ))}
                {result.skipped.length > 0 && (
                  <p className="text-[10px] text-slate-600">
                    Skipped (they share the control database): {result.skipped.join(', ')}
                  </p>
                )}
                {result.error && <p className="text-[11px] text-red-400">{result.error}</p>}
              </div>
            )}

            <div className="p-5 flex items-center gap-3" style={{ borderTop: '1px solid #1e2433' }}>
              <button onClick={run} disabled={running || !status.canRun || !status.tenantMode}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={gradient}>
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {running ? 'Running…' : behind ? `Run migrations (${behind} behind)` : 'Run migrations'}
              </button>
              <p className="text-[11px] text-slate-600 flex-1">
                {!status.canRun
                  ? 'MIGRATE_URL is not configured on this deployment — there is no migrate service to call.'
                  : 'Brings every tenant database up to the schema this build expects. Safe to re-run: already-applied files are skipped.'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
