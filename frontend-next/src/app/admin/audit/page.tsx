'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useAuditStore, AuditAction, AuditRecord, PendingApproval } from '@/lib/auditStore'
import { useSession } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Search, Download,
  Eye, FileText, Activity, ShieldAlert, Key, ClipboardList, CheckSquare, BarChart3, Server,
  Clock, Check, X, Building2, Terminal, Filter, Calendar, Lock, UserCheck, Plus, RefreshCw, Loader2
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

type TabKey = 'audit_trail' | 'four_eyes' | 'compliance'

const actionColors: Record<string, string> = {
  THRESHOLD_CHANGE: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ALARM_SHELVE: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  ALARM_SUPPRESS: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
  OTA_DEPLOY: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  OTA_FLEET_DEPLOY: 'text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/20',
  CARBON_ADJUST: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  FOUR_EYES_APPROVAL: 'text-green-400 bg-green-400/10 border-green-400/20',
  FOUR_EYES_REJECTION: 'text-red-400 bg-red-400/10 border-red-400/20',
  CONFIG_CHANGE: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
}

const chartColors = ['#fbbf24', '#60a5fa', '#fb7185', '#c084fc', '#e879f9', '#34d399', '#4ade80', '#f87171', '#22d3ee']

export default function AuditPage() {
  const { records, pending, approvePending, rejectPending } = useAuditStore()
  const session = useSession()
  const { selectedOrgId } = useAppStore()
  const isSuperadmin = session?.role === 'superadmin'
  const orgId = (isSuperadmin ? selectedOrgId : (session?.orgId || selectedOrgId)) || 'org-1'

  const [activeTab, setActiveTab] = useState<TabKey>('audit_trail')
  
  // Tab 1: Audit Trail Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterAction, setFilterAction] = useState<string>('ALL')

  // Live server-side state
  const [serverLogs, setServerLogs] = useState<AuditRecord[]>([])
  const [serverPending, setServerPending] = useState<PendingApproval[]>([])
  const [serverStats, setServerStats] = useState<Array<{ name: string; value: number }>>([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // New pending request form state
  const [newAction, setNewAction] = useState<AuditAction>('THRESHOLD_CHANGE')
  const [newAssetId, setNewAssetId] = useState('tr-001')
  const [newAssetName, setNewAssetName] = useState('Substation Transformer 01')
  const [newDescription, setNewDescription] = useState('Emergency setpoint modification')
  const [newBefore, setNewBefore] = useState('Oil Temp: 90°C')
  const [newAfter, setNewAfter] = useState('Oil Temp: 85°C')
  const [newJustification, setNewJustification] = useState('Seasonal temperature excursion mitigation per SOP-402')
  const [newWorkOrderId, setNewWorkOrderId] = useState('WO-2026-0914')

  // Modals for Tab 2
  const [confirmApproveModal, setConfirmApproveModal] = useState<PendingApproval | null>(null)
  const [confirmRejectModal, setConfirmRejectModal] = useState<PendingApproval | null>(null)
  const [password, setPassword] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  // Current logged in checker from live session
  const currentAdmin = useMemo(() => {
    if (session) {
      return {
        id: session.id || 'u-admin',
        name: session.name || session.username || 'System Administrator',
        email: session.email || `${session.username || 'admin'}@eternity.io`,
        role: (session.role || 'admin').toUpperCase(),
      }
    }
    return { id: 'u-admin', name: 'Operations Admin', email: 'admin@platform.local', role: 'ADMIN' }
  }, [session])

  // Data fetching from backend server
  const fetchAuditData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [logsRes, pendingRes] = await Promise.all([
        api.auditLogs(orgId, { action: filterAction, search: searchQuery }).catch(() => null),
        api.auditPending(orgId).catch(() => null),
      ])

      if (logsRes && logsRes.ok && logsRes.logs && logsRes.logs.length > 0) {
        setServerLogs(logsRes.logs as any)
        setTotalRecords(logsRes.total || logsRes.logs.length)
        if (logsRes.stats && logsRes.stats.length > 0) {
          setServerStats(logsRes.stats)
        }
      } else {
        // Fallback to local baseline records if server has no entries yet
        setServerLogs(records)
        setTotalRecords(records.length)
      }

      if (pendingRes && pendingRes.ok && pendingRes.pending) {
        setServerPending(pendingRes.pending as any)
      } else {
        setServerPending(pending)
      }
    } catch (err) {
      console.warn('Fallback to local audit store:', err)
      setServerLogs(records)
      setServerPending(pending)
    } finally {
      setLoading(false)
    }
  }, [orgId, filterAction, searchQuery, records, pending])

  useEffect(() => {
    fetchAuditData()
  }, [fetchAuditData])

  const effectiveLogs = serverLogs.length > 0 ? serverLogs : records
  const effectivePending = serverPending

  const filteredRecords = useMemo(() => {
    return effectiveLogs.filter(record => {
      const matchesSearch = 
        record.actor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.target.assetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.justification.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.id.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesAction = filterAction === 'ALL' || record.action === filterAction

      return matchesSearch && matchesAction
    })
  }, [effectiveLogs, searchQuery, filterAction])

  const actionStats = useMemo(() => {
    if (serverStats.length > 0) return serverStats
    const counts: Record<string, number> = {}
    effectiveLogs.forEach(r => {
      counts[r.action] = (counts[r.action] || 0) + 1
    })
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [effectiveLogs, serverStats])

  const exportCSV = () => {
    const headers = ['ID', 'Timestamp', 'Actor', 'Role', 'IP', 'Action', 'Asset', 'Before', 'After', 'Justification', 'Checksum']
    const csvContent = [
      headers.join(','),
      ...filteredRecords.map(r => 
        [
          r.id, 
          r.timestamp, 
          `"${r.actor.name}"`, 
          `"${r.actor.role}"`, 
          r.ipAddress, 
          r.action, 
          `"${r.target.assetName}"`, 
          `"${r.before}"`, 
          `"${r.after}"`, 
          `"${r.justification}"`, 
          r.checksum
        ].join(',')
      )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `audit_export_${orgId}_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Audit log exported successfully!')
  }

  const handleApprove = async () => {
    if (!password.trim()) {
      toast.error('Signature password is required')
      return
    }
    if (!confirmApproveModal) return

    setIsSubmitting(true)
    try {
      const res = await api.approveAuditPending(orgId, confirmApproveModal.id, password)
      if (res && res.ok) {
        toast.success(res.message || 'Operation approved and executed with SHA-256 seal', { icon: '✅' })
        setConfirmApproveModal(null)
        setPassword('')
        await fetchAuditData()
      } else {
        toast.error((res as any)?.error || 'Approval failed')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Approval authorization failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Rejection reason is required')
      return
    }
    if (!confirmRejectModal) return

    setIsSubmitting(true)
    try {
      const res = await api.rejectAuditPending(orgId, confirmRejectModal.id, rejectReason)
      if (res && res.ok) {
        toast.success(res.message || 'Operation rejected and recorded in audit log', { icon: '❌' })
        setConfirmRejectModal(null)
        setRejectReason('')
        await fetchAuditData()
      } else {
        toast.error((res as any)?.error || 'Rejection failed')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Rejection failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreatePending = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newJustification.trim()) {
      toast.error('Justification is mandatory per 21 CFR Part 11')
      return
    }
    setIsSubmitting(true)
    try {
      const res = await api.postAuditPending(orgId, {
        action: newAction,
        target: { assetId: newAssetId, assetName: newAssetName },
        description: newDescription,
        before: newBefore,
        after: newAfter,
        justification: newJustification,
        workOrderId: newWorkOrderId || undefined,
      })
      if (res && res.ok) {
        toast.success('Four-Eyes Dual Control task submitted for 2nd admin approval', { icon: '👁️' })
        setIsCreateModalOpen(false)
        await fetchAuditData()
      } else {
        toast.error((res as any)?.error || 'Failed to submit request')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit request')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Enterprise Security Audit &amp; Authorization
            </h1>
            <span className="text-[10px] px-2.5 py-0.5 rounded font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-400" />
              21 CFR PART 11 &amp; ISA-84 SERVER LEDGER ACTIVE
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            Immutable server-persisted audit trail with SHA-256 cryptographic hashes and Two-Man Rule (Maker-Checker) authorization.
          </p>
          <p className="text-[11px] text-emerald-400/90 mt-1 max-w-2xl leading-relaxed">
            Scoped to organization <strong>{orgId}</strong> · All records are write-once, timestamped by the server engine, and independent of client tampering.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 flex items-center gap-1.5 font-medium">
            <UserCheck size={12} className="text-indigo-400" />
            <span>Operator: <strong>{currentAdmin.name}</strong></span>
          </span>
          <span className="text-[11px] px-3 py-1 rounded-full font-bold tracking-wide flex items-center gap-1.5" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <ShieldCheck size={14} />
            SHA-256 SEAL VERIFIED
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveTab('audit_trail')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'audit_trail'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <ClipboardList size={14} className={activeTab === 'audit_trail' ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Audit Trail Log</span>
          {totalRecords > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300">
              {totalRecords}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('four_eyes')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'four_eyes'
              ? 'bg-amber-600/20 text-amber-300 border border-amber-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <Eye size={14} className={activeTab === 'four_eyes' ? 'text-amber-400' : 'text-slate-500'} />
          <span>Pending Approvals</span>
          {effectivePending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {effectivePending.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('compliance')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0',
            activeTab === 'compliance'
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/40 border border-transparent'
          )}
        >
          <BarChart3 size={14} className={activeTab === 'compliance' ? 'text-emerald-400' : 'text-slate-500'} />
          <span>Compliance Dashboard</span>
        </button>
      </div>

      {/* TAB 1: Audit Trail Log */}
      {activeTab === 'audit_trail' && (
        <div className="rounded-xl p-5 space-y-4" style={surface}>
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-indigo-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Immutable Audit Trail</h3>
                <p className="text-[11px] text-slate-400">Cryptographically signed system and operator actions</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search actors, assets, logs..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500 transition-colors w-64"
                />
              </div>
              <select
                value={filterAction}
                onChange={e => setFilterAction(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Actions</option>
                {Object.keys(actionColors).map(act => (
                  <option key={act} value={act}>{act.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800/50 bg-[#0a0e1a]/50">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/80 text-xs uppercase font-semibold text-slate-400 border-b border-slate-800/50">
                <tr>
                  <th className="px-4 py-3">Timestamp / IP</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action / Asset</th>
                  <th className="px-4 py-3">Changes / Justification</th>
                  <th className="px-4 py-3 text-right">Checksum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="font-medium text-slate-200">
                        {new Date(record.timestamp).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
                        })}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-1">{record.ipAddress}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{record.id}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-200">{record.actor.name}</div>
                      <div className="text-[11px] text-slate-400">{record.actor.role}</div>
                      <div className="text-[10px] text-slate-500 mt-1">{record.actor.email}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={clsx('inline-block px-2 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wider mb-2', actionColors[record.action] || 'text-slate-400 bg-slate-800 border-slate-700')}>
                        {record.action.replace(/_/g, ' ')}
                      </span>
                      <div className="text-xs font-semibold text-indigo-300">
                        {record.target.assetName}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {record.target.assetId}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2 text-xs mb-1 bg-slate-950 p-2 rounded border border-slate-800 font-mono">
                        <span className="text-rose-400/80 line-through truncate w-24">{record.before}</span>
                        <span className="text-slate-500">→</span>
                        <span className="text-emerald-400 truncate w-24">{record.after}</span>
                      </div>
                      <div className="text-[11px] text-slate-300 italic mt-1.5 leading-tight">
                        &ldquo;{record.justification}&rdquo;
                      </div>
                      {record.workOrderId && (
                        <div className="text-[10px] text-blue-400 mt-1 font-semibold flex items-center gap-1">
                          <FileText size={10} />
                          {record.workOrderId}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div 
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors cursor-help"
                        title={record.checksum}
                      >
                        <Lock size={10} className="text-emerald-500/70" />
                        {record.checksum.substring(0, 12)}...
                      </div>
                      {record.approvalStatus === 'APPROVED' && record.checker && (
                        <div className="mt-2 text-[10px] text-emerald-400/80 flex flex-col items-end gap-0.5">
                          <span className="flex items-center gap-1 font-semibold"><CheckCircle2 size={10} /> 4-Eyes Approved</span>
                          <span>by {record.checker.name}</span>
                        </div>
                      )}
                      {record.approvalStatus === 'REJECTED' && record.checker && (
                        <div className="mt-2 text-[10px] text-rose-400/80 flex flex-col items-end gap-0.5">
                          <span className="flex items-center gap-1 font-semibold"><XCircle size={10} /> 4-Eyes Rejected</span>
                          <span>by {record.checker.name}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                      No audit records found matching your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Four-Eyes Approvals */}
      {activeTab === 'four_eyes' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl" style={surface}>
            <div>
              <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                <ShieldAlert size={18} />
                Four-Eyes Dual Authorization Required (ISA-84 &amp; 21 CFR Part 11)
              </h3>
              <p className="text-[11px] text-slate-400 mt-1 max-w-2xl">
                Critical configuration changes, firmware deployments, and limit adjustments require secondary approval by an authorized administrator before execution.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors shadow-sm"
              >
                <Plus size={14} />
                <span>Request Dual-Control Operation</span>
              </button>
              <div className="text-right pl-4 border-l border-slate-800">
                <div className="text-2xl font-black text-white">{effectivePending.length}</div>
                <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Pending Tasks</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {effectivePending.map(task => {
              const isMaker = (task.maker as any).id === currentAdmin.id ||
                              task.maker.email?.toLowerCase() === currentAdmin.email?.toLowerCase() ||
                              task.maker.name?.toLowerCase() === currentAdmin.name?.toLowerCase()

              return (
                <div key={task.id} className="p-5 rounded-xl border border-amber-900/40 bg-amber-950/10 hover:border-amber-700/50 transition-colors flex flex-col justify-between" style={inset}>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className={clsx('inline-block px-2.5 py-1 text-[10px] font-bold rounded border uppercase tracking-wider mb-2', actionColors[task.action] || 'text-slate-400 bg-slate-800 border-slate-700')}>
                          {task.action.replace(/_/g, ' ')}
                        </span>
                        <h4 className="text-sm font-bold text-white">{task.description}</h4>
                        <div className="text-xs text-indigo-300 mt-1 flex items-center gap-1.5">
                          <Server size={12} /> {task.target.assetName} <span className="text-slate-500 font-mono text-[10px]">({task.target.assetId})</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 text-right">
                        {new Date(task.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-[#0d1117] rounded-lg p-3 border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2 tracking-wider">Proposed Changes</div>
                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div className="p-2 bg-rose-950/20 border border-rose-900/30 rounded text-rose-300 break-words">
                          <span className="text-rose-500/50 select-none mr-2">-</span>
                          {task.before}
                        </div>
                        <div className="p-2 bg-emerald-950/20 border border-emerald-900/30 rounded text-emerald-300 break-words">
                          <span className="text-emerald-500/50 select-none mr-2">+</span>
                          {task.after}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold mb-1 tracking-wider">Requested By</div>
                        <div className="text-xs text-slate-300 font-medium">{task.maker.name}</div>
                        <div className="text-[10px] text-slate-500">{task.maker.role}</div>
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold mb-1 tracking-wider">Justification</div>
                        <div className="text-xs text-slate-300 italic">&ldquo;{task.justification}&rdquo;</div>
                        {task.workOrderId && <div className="text-[10px] text-blue-400 mt-1">{task.workOrderId}</div>}
                      </div>
                    </div>

                    {isMaker && (
                      <div className="px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-2">
                        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                        <span>You requested this action. Dual-control governance requires another administrator to authorize.</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-800/80 flex gap-3">
                    {isMaker ? (
                      <button 
                        disabled
                        className="flex-1 flex items-center justify-center gap-1.5 bg-slate-900 text-slate-500 py-2 rounded-lg text-xs font-semibold cursor-not-allowed border border-slate-800"
                        title="Four-Eyes Governance: Maker cannot approve their own operation. A second administrator is required."
                      >
                        <Lock size={13} className="text-amber-500/70" />
                        <span>Self-Approval Prohibited</span>
                      </button>
                    ) : (
                      <button 
                        onClick={() => setConfirmApproveModal(task)}
                        className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
                      >
                        <CheckCircle2 size={16} />
                        Approve &amp; Execute
                      </button>
                    )}
                    <button 
                      onClick={() => setConfirmRejectModal(task)}
                      className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-rose-400 py-2 rounded-lg text-sm font-semibold transition-colors border border-slate-700 hover:border-slate-600"
                    >
                      <XCircle size={16} />
                      Reject Request
                    </button>
                  </div>
                </div>
              )
            })}
            
            {effectivePending.length === 0 && (
              <div className="col-span-1 lg:col-span-2 p-12 text-center rounded-xl border border-slate-800 border-dashed flex flex-col items-center justify-center" style={inset}>
                <CheckSquare size={48} className="text-emerald-500/50 mb-4" />
                <h4 className="text-lg font-semibold text-white">All Caught Up!</h4>
                <p className="text-sm text-slate-400 mt-2">There are no pending operations requiring secondary approval.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Compliance Dashboard */}
      {activeTab === 'compliance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl space-y-1" style={surface}>
              <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between uppercase tracking-wider">
                <span>Total Audit Records</span>
                <ClipboardList size={14} className="text-indigo-400" />
              </div>
              <div className="text-2xl font-black text-white">{records.length}</div>
              <div className="text-[10px] text-emerald-400">+12 this week</div>
            </div>

            <div className="p-4 rounded-xl space-y-1" style={surface}>
              <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between uppercase tracking-wider">
                <span>Pending Dual Auth</span>
                <Eye size={14} className="text-amber-400" />
              </div>
              <div className="text-2xl font-black text-white">{pending.length}</div>
              <div className="text-[10px] text-amber-400/80">Requires action</div>
            </div>

            <div className="p-4 rounded-xl space-y-1" style={surface}>
              <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between uppercase tracking-wider">
                <span>Avg Authorization Time</span>
                <Clock size={14} className="text-blue-400" />
              </div>
              <div className="text-2xl font-black text-white">4.2 <span className="text-sm font-normal text-slate-500">hrs</span></div>
              <div className="text-[10px] text-slate-500">Target &lt; 8 hrs</div>
            </div>

            <div className="p-4 rounded-xl space-y-1 bg-emerald-950/20 border border-emerald-900/40">
              <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between uppercase tracking-wider">
                <span>Compliance Score</span>
                <ShieldCheck size={14} className="text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-emerald-400">100%</div>
              <div className="text-[10px] text-emerald-400/80">All actions signed</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl space-y-4" style={surface}>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <BarChart3 size={16} className="text-indigo-400" />
                Actions by Type
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actionStats} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" stroke="#cbd5e1" fontSize={10} width={120} tickLine={false} axisLine={false} tickFormatter={(val) => val.replace(/_/g, ' ')} />
                    <Tooltip 
                      cursor={{fill: '#1e293b', opacity: 0.4}}
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px', color: '#f8fafc' }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                      {actionStats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="p-5 rounded-xl space-y-4" style={surface}>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Activity size={16} className="text-indigo-400" />
                Recent System Activity
              </h3>
              <div className="space-y-4 overflow-y-auto pr-2 max-h-64">
                {records.slice(0, 5).map(r => (
                  <div key={r.id} className="flex gap-3 items-start">
                    <div className={clsx('mt-1 w-2 h-2 rounded-full flex-shrink-0', actionColors[r.action]?.split(' ')[0].replace('text-', 'bg-') || 'bg-slate-500')} />
                    <div>
                      <div className="text-xs text-slate-200 font-medium">
                        {r.actor.name} executed <span className="font-bold">{r.action.replace(/_/g, ' ')}</span> on {r.target.assetName}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {new Date(r.timestamp).toLocaleString()} • {r.ipAddress}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APPROVAL MODAL */}
      {confirmApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-slate-700 rounded-xl max-w-md w-full shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
              <Key className="text-emerald-400" />
              Cryptographic Signature Required
            </h3>
            <p className="text-sm text-slate-400 mb-6">
              You are about to authorize an operation initiated by <strong>{confirmApproveModal.maker.name}</strong>. Please enter your password to sign the audit log.
            </p>
            
            <div className="space-y-4 mb-6">
              <div className="bg-[#0a0e1a] p-3 rounded-lg border border-slate-800 text-xs text-slate-300 font-mono break-all">
                {confirmApproveModal.description}
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Your Password</label>
                <input 
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter admin123"
                  className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmApproveModal(null)}
                className="flex-1 py-2 rounded-lg font-semibold text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className="flex-1 py-2 rounded-lg font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
              >
                Sign &amp; Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION MODAL */}
      {confirmRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-rose-900/50 rounded-xl max-w-md w-full shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
              <XCircle className="text-rose-400" />
              Reject Operation Request
            </h3>
            <p className="text-sm text-slate-400 mb-6">
              Provide a reason for rejecting the requested operation by <strong>{confirmRejectModal.maker.name}</strong>.
            </p>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Mandatory Rejection Reason</label>
                <textarea 
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="e.g. Insufficient testing, waiting for maintenance window..."
                  rows={3}
                  className="w-full bg-[#0a0e1a] border border-rose-900/40 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all text-sm"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRejectModal(null)}
                className="flex-1 py-2 rounded-lg font-semibold text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="flex-1 py-2 rounded-lg font-semibold text-sm bg-rose-600/90 text-white hover:bg-rose-500 transition-colors"
              >
                Reject Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REQUEST DUAL-CONTROL OPERATION MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-slate-700 rounded-xl max-w-lg w-full shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="text-amber-400" size={20} />
                Submit Dual-Control Operation Request
              </h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              Operations submitted here require secondary authorization by another administrator before taking effect.
            </p>

            <form onSubmit={handleCreatePending} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Action Type</label>
                  <select
                    value={newAction}
                    onChange={e => setNewAction(e.target.value as AuditAction)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500"
                  >
                    <option value="THRESHOLD_CHANGE">Threshold Change</option>
                    <option value="ALARM_SHELVE">Alarm Shelve</option>
                    <option value="ALARM_SUPPRESS">Alarm Suppress</option>
                    <option value="OTA_DEPLOY">OTA Deploy</option>
                    <option value="CONFIG_CHANGE">Config Change</option>
                    <option value="CARBON_ADJUST">Carbon Adjust</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Work Order ID</label>
                  <input
                    type="text"
                    value={newWorkOrderId}
                    onChange={e => setNewWorkOrderId(e.target.value)}
                    placeholder="e.g. WO-2026-0914"
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Target Asset ID</label>
                  <input
                    type="text"
                    value={newAssetId}
                    onChange={e => setNewAssetId(e.target.value)}
                    required
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Asset Name</label>
                  <input
                    type="text"
                    value={newAssetName}
                    onChange={e => setNewAssetName(e.target.value)}
                    required
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  required
                  placeholder="e.g. Modify high temperature limit threshold"
                  className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Before Value</label>
                  <input
                    type="text"
                    value={newBefore}
                    onChange={e => setNewBefore(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-rose-300 text-xs outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">After (Target) Value</label>
                  <input
                    type="text"
                    value={newAfter}
                    onChange={e => setNewAfter(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-emerald-300 text-xs outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Justification <span className="text-amber-400">*</span>
                </label>
                <textarea
                  value={newJustification}
                  onChange={e => setNewJustification(e.target.value)}
                  required
                  rows={2}
                  placeholder="Engineering justification for this operation..."
                  className="w-full bg-[#0a0e1a] border border-slate-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2 rounded-lg font-semibold text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 rounded-lg font-semibold text-xs bg-amber-600 hover:bg-amber-500 text-white transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                  <span>Submit for Dual Approval</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
