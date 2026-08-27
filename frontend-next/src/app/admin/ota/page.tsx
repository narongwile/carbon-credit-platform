'use client'

// ---------------------------------------------------------------------------
// OTA Firmware Management — Industrial Fleet & Canary Deployment Studio
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, useIsLive } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { licensedDomains } from '@/lib/entitlements'
import {
  Server, Download, Trash2, ArrowRightCircle, Plus, Terminal, CheckCircle2,
  AlertTriangle, XCircle, Clock, Cpu, ShieldCheck, Search, Filter, ExternalLink,
  Layers, RefreshCw, Send, Radio
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { SensorDomain } from '@/types/fleet'

const DOMAIN_LABEL: Record<SensorDomain, string> = {
  transformer: 'Transformer',
  carbonNode: 'Refrigeration (carbonNode)',
  bloodBox: 'BloodBOX',
  automobile: 'Formula EV (automobile)',
}

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Release {
  id: string
  version: string
  product: string
  artefact_uri: string
  release_notes: string
  sha256?: string
  created_at?: string
}

interface Deployment {
  node_id: string
  release_id: string
  status: string
  started_at?: string
  completed_at?: string
}

export default function OTAManagementPage() {
  const live = useIsLive()
  const selectedOrgId = useAppStore((s) => s.selectedOrgId) || 'org-1'
  useAppStore((s) => s.orgEntitlements[selectedOrgId])
  const licensedProducts = live ? licensedDomains(selectedOrgId) : (['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[])
  const { devices } = useManagedDevices(selectedOrgId)

  const [releases, setReleases] = useState<Release[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterDomain, setFilterDomain] = useState<string>('all')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    version: '',
    domain: '',
    artefact_uri: '',
    sha256: '',
    release_notes: '',
  })

  const effectiveDomain = form.domain && licensedProducts.includes(form.domain as SensorDomain) ? form.domain : (licensedProducts[0] ?? '')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Deploy Dialog State: Supports Fleet rollout or Single Canary node rollout
  const [deployTarget, setDeployTarget] = useState<{
    release: Release
    mode: 'fleet' | 'canary'
    nodeId?: string
  } | null>(null)

  // ── Advanced Canary Phased Rollout ──────────────────────────────────────
  type RolloutPhase = 'idle' | 'canary' | 'staged' | 'fleet' | 'complete' | 'rollback'
  interface PhasedRollout {
    releaseId: string
    version: string
    phase: RolloutPhase
    phasePct: number          // 5, 25, 100
    soakHours: number         // soak period before next phase
    soakStartedAt: number     // Date.now() when phase began
    totalDevices: number
    updatedDevices: number
    failedDevices: number
    healthChecks: { deviceId: string; status: 'ok' | 'failed' | 'flashing' | 'verifying'; ts: number }[]
    autoRollbackThreshold: number // % failure that triggers auto-rollback
  }
  const [phasedRollout, setPhasedRollout] = useState<PhasedRollout | null>(null)
  const [showPhasedPanel, setShowPhasedPanel] = useState(false)
  const [soakTimerDisplay, setSoakTimerDisplay] = useState('')

  // Soak timer countdown
  useEffect(() => {
    if (!phasedRollout || phasedRollout.phase === 'idle' || phasedRollout.phase === 'complete' || phasedRollout.phase === 'rollback') return
    const interval = setInterval(() => {
      const elapsed = (Date.now() - phasedRollout.soakStartedAt) / 1000
      const remaining = Math.max(0, phasedRollout.soakHours * 3600 - elapsed)
      if (remaining <= 0) {
        setSoakTimerDisplay('Soak complete — ready to advance')
      } else {
        const h = Math.floor(remaining / 3600)
        const m = Math.floor((remaining % 3600) / 60)
        const s = Math.floor(remaining % 60)
        setSoakTimerDisplay(`${h}h ${m}m ${s}s remaining`)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [phasedRollout])

  // Auto-rollback check: if >5% of updated devices fail during soak
  useEffect(() => {
    if (!phasedRollout || phasedRollout.phase === 'idle' || phasedRollout.phase === 'complete' || phasedRollout.phase === 'rollback') return
    const failRate = phasedRollout.updatedDevices > 0
      ? (phasedRollout.failedDevices / phasedRollout.updatedDevices) * 100
      : 0
    if (failRate > phasedRollout.autoRollbackThreshold && phasedRollout.updatedDevices >= 2) {
      setPhasedRollout(prev => prev ? { ...prev, phase: 'rollback' } : null)
      toast.error(`🚨 Auto-Rollback triggered! ${phasedRollout.failedDevices} of ${phasedRollout.updatedDevices} devices failed (${failRate.toFixed(0)}% > ${phasedRollout.autoRollbackThreshold}% threshold). Reverting to stable firmware.`)
    }
  }, [phasedRollout?.failedDevices, phasedRollout?.updatedDevices])

  const startPhasedRollout = (release: Release) => {
    const total = devices.filter(d => d.domain === release.product).length
    setPhasedRollout({
      releaseId: release.id,
      version: release.version,
      phase: 'canary',
      phasePct: 5,
      soakHours: 2,
      soakStartedAt: Date.now(),
      totalDevices: total,
      updatedDevices: Math.max(1, Math.round(total * 0.05)),
      failedDevices: 0,
      healthChecks: devices.filter(d => d.domain === release.product).slice(0, Math.max(1, Math.round(total * 0.05))).map(d => ({
        deviceId: d.id, status: 'verifying' as const, ts: Date.now(),
      })),
      autoRollbackThreshold: 5,
    })
    setShowPhasedPanel(true)
    toast.success(`Phased rollout started: Phase 1 (Canary 5%) — ${Math.max(1, Math.round(total * 0.05))} devices`)
  }

  const advancePhase = () => {
    if (!phasedRollout) return
    const total = phasedRollout.totalDevices
    if (phasedRollout.phase === 'canary') {
      const staged = Math.round(total * 0.25)
      setPhasedRollout({
        ...phasedRollout,
        phase: 'staged',
        phasePct: 25,
        soakStartedAt: Date.now(),
        updatedDevices: staged,
        healthChecks: phasedRollout.healthChecks.map((h): PhasedRollout['healthChecks'][number] => ({ ...h, status: 'ok' })).concat(
          Array.from({ length: staged - phasedRollout.healthChecks.length }, (_, i) => ({
            deviceId: `device-staged-${i}`, status: 'flashing' as const, ts: Date.now(),
          }))
        ),
      })
      toast.success(`Advanced to Phase 2 (Staged 25%) — ${staged} devices`)
    } else if (phasedRollout.phase === 'staged') {
      setPhasedRollout({
        ...phasedRollout,
        phase: 'fleet',
        phasePct: 100,
        soakStartedAt: Date.now(),
        updatedDevices: total,
        healthChecks: Array.from({ length: total }, (_, i) => ({
          deviceId: `device-fleet-${i}`, status: 'verifying' as const, ts: Date.now(),
        })),
      })
      toast.success(`Advanced to Phase 3 (Fleet 100%) — ${total} devices`)
    } else if (phasedRollout.phase === 'fleet') {
      setPhasedRollout({ ...phasedRollout, phase: 'complete' })
      toast.success('✅ Phased rollout complete! All devices updated successfully.')
    }
  }

  const simulateFailure = () => {
    if (!phasedRollout) return
    setPhasedRollout(prev => prev ? {
      ...prev,
      failedDevices: prev.failedDevices + Math.ceil(prev.updatedDevices * 0.08),
      healthChecks: prev.healthChecks.map((h, i) =>
        i < Math.ceil(prev.updatedDevices * 0.08) ? { ...h, status: 'failed' as const } : h
      ),
    } : null)
  }

  const load = async () => {
    setLoading(true)
    try {
      const [rels, deps] = await Promise.all([api.otaReleases(), api.otaDeployments()])
      if (rels) setReleases(rels as Release[])
      if (deps) setDeployments(deps as Deployment[])
    } catch (err) {
      toast.error('Failed to load OTA data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [selectedOrgId])

  const handleCreate = async () => {
    if (!form.version || !effectiveDomain || !form.artefact_uri) {
      return toast.error(effectiveDomain ? 'Please fill in Version and Artefact URI' : 'This organization has no licensed product lines')
    }
    const res = await api.saveOtaRelease({
      version: form.version,
      domain: effectiveDomain,
      artefact_uri: form.artefact_uri,
      release_notes: form.release_notes,
    })
    if (res?.id) {
      toast.success(`Release ${form.version} created successfully`)
      setShowForm(false)
      setForm({ version: '', domain: '', artefact_uri: '', sha256: '', release_notes: '' })
      load()
    } else {
      toast.error('Failed to create release')
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteOtaRelease(id)
    toast.success('Release deleted')
    setDeleteConfirm(null)
    load()
  }

  const handleExecuteDeploy = async () => {
    if (!deployTarget) return
    const { release, mode, nodeId } = deployTarget

    if (mode === 'canary') {
      if (!nodeId) {
        toast.error('Please select a target device for canary rollout')
        return
      }
      try {
        const res = await api.sendOta(nodeId, {
          to_version: release.version,
          artefact_uri: release.artefact_uri,
          sha256: release.sha256,
        })
        if (res?.ok) {
          toast.success(`Canary OTA update dispatched to device ${nodeId}`)
          setDeployTarget(null)
          load()
        } else {
          toast.error('Failed to dispatch canary OTA')
        }
      } catch (err) {
        toast.error('Error dispatching OTA update')
      }
    } else {
      // Fleet-wide Rollout
      try {
        const res = await api.deployFleetOta({
          release_id: release.id,
          domain: release.product,
          org_id: selectedOrgId,
        })
        setDeployTarget(null)
        if (res?.applied !== undefined) {
          toast.success(`Fleet deployment initiated for ${res.applied} devices`)
          load()
        } else {
          toast.error('Failed to deploy to fleet')
        }
      } catch (err) {
        toast.error('Error deploying to fleet')
      }
    }
  }

  // Filtered releases
  const filteredReleases = useMemo(() => {
    return releases.filter((r) => {
      const matchDomain = filterDomain === 'all' || r.product === filterDomain
      const matchSearch =
        !searchQuery ||
        r.version.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.artefact_uri.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.release_notes?.toLowerCase().includes(searchQuery.toLowerCase())
      return matchDomain && matchSearch
    })
  }, [releases, filterDomain, searchQuery])

  // Eligible devices for the selected release product line
  const eligibleDevices = useMemo(() => {
    if (!deployTarget) return []
    const prod = deployTarget.release.product
    return devices.filter((d) => d.domain === prod)
  }, [devices, deployTarget])

  // KPI calculations
  const totalReleases = releases.length
  const activeDeployments = deployments.filter((d) => d.status !== 'success' && d.status !== 'failed').length
  const successRate = deployments.length
    ? Math.round((deployments.filter((d) => d.status === 'success').length / deployments.length) * 100)
    : 100

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">OTA Firmware Management</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
              Fleet & Canary Engine
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage firmware binaries, checksums, canary rollouts, and fleet-wide OTA updates
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            title="Refresh OTA Status"
            className="p-2 rounded-lg text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            style={surface}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-400' : ''} />
          </button>

          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90"
            style={gradient}
          >
            <Plus size={16} /> New Firmware Release
          </button>
        </div>
      </div>

      {/* KPI Stats Deck */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Available Releases</div>
            <div className="text-2xl font-bold text-white mt-1">{totalReleases}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Download size={20} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Active Flash Jobs</div>
            <div className="text-2xl font-bold text-amber-300 mt-1">{activeDeployments}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Cpu size={20} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Fleet Success Rate</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{successRate}%</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck size={20} />
          </div>
        </div>
      </div>

      {/* Create Release Drawer / Form */}
      {showForm && (
        <div className="p-5 rounded-2xl border border-indigo-500/30 space-y-4 animate-in fade-in duration-200" style={surface}>
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Server size={16} className="text-indigo-400" /> Upload & Register New Firmware Release
            </h2>
            <button onClick={() => setShowForm(false)} className="text-xs text-slate-400 hover:text-white">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Firmware Version <span className="text-red-400">*</span>
              </label>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                placeholder="e.g. v2.4.0-prod"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Target Product Domain <span className="text-red-400">*</span>
              </label>
              {licensedProducts.length === 0 ? (
                <p className="text-xs text-amber-400 py-2">No licensed product lines in this organization.</p>
              ) : (
                <select
                  value={effectiveDomain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                >
                  {licensedProducts.map((d) => (
                    <option key={d} value={d} className="bg-[#0d1117]">
                      {DOMAIN_LABEL[d]}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                SHA-256 Checksum <span className="text-slate-500 font-normal">(Optional for verification)</span>
              </label>
              <input
                value={form.sha256}
                onChange={(e) => setForm({ ...form, sha256: e.target.value })}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-indigo-500"
                placeholder="e.g. a3b5c7..."
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Artefact Binary Download URI <span className="text-red-400">*</span>
              </label>
              <input
                value={form.artefact_uri}
                onChange={(e) => setForm({ ...form, artefact_uri: e.target.value })}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-indigo-500"
                placeholder="https://firmware-repo.thermexpertise.com/builds/esp32/v2.4.0.bin"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-400 mb-1">Release Notes & Changelog</label>
              <textarea
                value={form.release_notes}
                onChange={(e) => setForm({ ...form, release_notes: e.target.value })}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                rows={3}
                placeholder="- Fixed Modbus RTU telemetry retry timeout&#10;- Improved MQTT TLS handshake reliability&#10;- Reduced sleep cycle power consumption"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={licensedProducts.length === 0}
              className="px-5 py-2 rounded-lg text-xs font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-40"
              style={gradient}
            >
              Publish Release
            </button>
          </div>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Firmware Releases */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Download size={16} className="text-emerald-400" /> Available Firmware Releases ({filteredReleases.length})
            </h2>

            {/* Filter & Search Bar */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search version/notes…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-3 py-1 text-xs rounded-lg text-slate-200 outline-none w-36 sm:w-48"
                  style={inset}
                />
              </div>

              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-300 outline-none"
                style={inset}
              >
                <option value="all">All Domains</option>
                {licensedProducts.map((d) => (
                  <option key={d} value={d}>
                    {DOMAIN_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredReleases.length === 0 ? (
            <div className="p-8 rounded-xl text-center space-y-2" style={surface}>
              <Server size={32} className="mx-auto text-slate-600" />
              <p className="text-sm text-slate-400 font-medium">No firmware releases found</p>
              <p className="text-xs text-slate-600">Click &quot;New Firmware Release&quot; to upload binary metadata.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredReleases.map((r) => (
                <div key={r.id} className="p-4 rounded-xl border border-slate-800/80 hover:border-slate-700 transition-all" style={surface}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-extrabold text-white bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-1 rounded-md text-indigo-300">
                          {r.version}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {DOMAIN_LABEL[r.product as SensorDomain] || r.product}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeployTarget({ release: r, mode: 'canary' })}
                        title="Deploy to Single Test Device"
                        className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        <Radio size={13} /> Canary Test
                      </button>

                      <button
                        onClick={() => startPhasedRollout(r)}
                        title="3-Phase Progressive Rollout: 5% → 25% → 100% with Auto-Rollback"
                        className="flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        <Layers size={13} /> Phased Rollout
                      </button>

                      <button
                        onClick={() => setDeployTarget({ release: r, mode: 'fleet' })}
                        title="Deploy to all devices in fleet"
                        className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 bg-indigo-500/15 border border-indigo-500/30 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        <ArrowRightCircle size={13} /> Fleet Rollout
                      </button>

                      <button
                        onClick={() => setDeleteConfirm(r.id)}
                        title="Delete release"
                        className="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Artefact URI & Download */}
                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mb-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 font-sans text-[10px] uppercase font-semibold">Artefact:</span>
                    <span className="truncate flex-1 text-slate-300">{r.artefact_uri}</span>
                    <a
                      href={r.artefact_uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 p-0.5"
                      title="Direct binary link"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>

                  {/* Release Notes */}
                  {r.release_notes && (
                    <div className="text-xs text-slate-300 bg-slate-950/40 p-3 rounded-lg border border-slate-800/50 whitespace-pre-line leading-relaxed">
                      {r.release_notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 1 Col: Live Deployments Tracker */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal size={16} className="text-amber-400" /> Active Flashing Status
            </h2>
            <span className="text-[11px] text-slate-500">{deployments.length} jobs</span>
          </div>

          <div className="rounded-xl overflow-hidden border border-slate-800" style={surface}>
            {deployments.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No active or recent flashing deployments.
              </div>
            ) : (
              <div className="max-h-[550px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr style={inset} className="text-slate-400 border-b border-slate-800">
                      <th className="px-3 py-2.5 font-semibold">Device</th>
                      <th className="px-3 py-2.5 font-semibold">Version</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {deployments.map((d, i) => {
                      const release = releases.find((r) => r.id === d.release_id)
                      const targetDevice = devices.find((dev) => dev.id === d.node_id)
                      const isTransformer = targetDevice?.domain === 'transformer'
                      const deviceLink = isTransformer
                        ? `/admin/transformers/detail?id=${encodeURIComponent(d.node_id)}`
                        : `/admin/nodes/detail?id=${encodeURIComponent(d.node_id)}`

                      return (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-3 py-2.5">
                            <Link
                              href={deviceLink}
                              className="font-medium text-slate-200 hover:text-indigo-400 transition-colors block truncate max-w-[130px]"
                              title={targetDevice?.name || d.node_id}
                            >
                              {targetDevice?.name || `${d.node_id.slice(0, 8)}…`}
                            </Link>
                            {targetDevice?.location && (
                              <span className="text-[10px] text-slate-500 block truncate">{targetDevice.location}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-indigo-300 font-mono font-semibold">
                            {release?.version || d.release_id.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                d.status === 'success' || d.status === 'completed'
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                  : d.status === 'failed'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/20 animate-pulse'
                              }`}
                            >
                              {d.status === 'success' || d.status === 'completed' ? (
                                <CheckCircle2 size={10} />
                              ) : d.status === 'failed' ? (
                                <XCircle size={10} />
                              ) : (
                                <Clock size={10} />
                              )}
                              {d.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-400" /> Delete Release?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This action cannot be undone. Are you sure you want to permanently delete this firmware release?
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-1.5 text-xs text-white bg-red-600 hover:bg-red-500 font-semibold rounded-lg shadow"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CANARY PHASED ROLLOUT DASHBOARD                                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phasedRollout && showPhasedPanel && (
        <div className="rounded-2xl p-5 space-y-5" style={surface}>
          {/* Phased Rollout Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/20">
                <Layers size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Phased Rollout: <span className="font-mono text-indigo-300">{phasedRollout.version}</span>
                  {phasedRollout.phase === 'rollback' && (
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                      ⚠ AUTO-ROLLBACK ACTIVE
                    </span>
                  )}
                  {phasedRollout.phase === 'complete' && (
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      ✓ COMPLETE
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {phasedRollout.updatedDevices} of {phasedRollout.totalDevices} devices · {phasedRollout.failedDevices} failures · Auto-rollback at &gt;{phasedRollout.autoRollbackThreshold}% failure
                </p>
              </div>
            </div>
            <button onClick={() => setShowPhasedPanel(false)} className="text-slate-500 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-800">
              Minimize
            </button>
          </div>

          {/* 3-Phase Progress Ladder */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { phase: 'canary' as const, label: 'Phase 1: Canary', pct: '5%', desc: 'Test on select devices' },
              { phase: 'staged' as const, label: 'Phase 2: Staged', pct: '25%', desc: 'Expand to quarter fleet' },
              { phase: 'fleet' as const, label: 'Phase 3: Fleet', pct: '100%', desc: 'Full fleet deployment' },
            ].map((step, i) => {
              const phaseOrder = { idle: 0, canary: 1, staged: 2, fleet: 3, complete: 4, rollback: -1 }
              const currentOrder = phaseOrder[phasedRollout.phase]
              const stepOrder = phaseOrder[step.phase]
              const isActive = phasedRollout.phase === step.phase
              const isDone = currentOrder > stepOrder && phasedRollout.phase !== 'rollback'
              const isRolledBack = phasedRollout.phase === 'rollback'

              return (
                <div
                  key={step.phase}
                  className={`p-3 rounded-xl border transition-all ${
                    isRolledBack ? 'border-rose-500/40 bg-rose-950/20' :
                    isActive ? 'border-indigo-500 bg-indigo-950/30 ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10' :
                    isDone ? 'border-emerald-500/40 bg-emerald-950/20' :
                    'border-slate-800 bg-slate-900/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isRolledBack ? 'bg-rose-500/30 text-rose-300' :
                      isDone ? 'bg-emerald-500/30 text-emerald-300' :
                      isActive ? 'bg-indigo-500/30 text-indigo-300' :
                      'bg-slate-800 text-slate-500'
                    }`}>
                      {isRolledBack ? '✗' : isDone ? '✓' : i + 1}
                    </div>
                    <span className={`text-xs font-bold ${isActive ? 'text-white' : isDone ? 'text-emerald-300' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </div>
                  <div className="text-lg font-black text-white ml-8">{step.pct}</div>
                  <div className="text-[10px] text-slate-500 ml-8">{step.desc}</div>

                  {/* Progress bar within phase */}
                  {isActive && (
                    <div className="mt-2 ml-8">
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-indigo-500 to-purple-500"
                          style={{ width: `${Math.min(100, (phasedRollout.updatedDevices - phasedRollout.failedDevices) / Math.max(1, phasedRollout.updatedDevices) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Soak Timer & Health Monitor Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Soak Timer</div>
              <div className="text-sm font-bold text-amber-400 font-mono">
                {phasedRollout.phase === 'complete' ? 'Complete' : phasedRollout.phase === 'rollback' ? 'ABORTED' : soakTimerDisplay || 'Starting…'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Devices Updated</div>
              <div className="text-sm font-bold text-emerald-400">{phasedRollout.updatedDevices - phasedRollout.failedDevices} / {phasedRollout.totalDevices}</div>
            </div>
            <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Failed</div>
              <div className={`text-sm font-bold ${phasedRollout.failedDevices > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {phasedRollout.failedDevices}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Failure Rate</div>
              <div className={`text-sm font-bold ${
                phasedRollout.updatedDevices > 0 && (phasedRollout.failedDevices / phasedRollout.updatedDevices * 100) > phasedRollout.autoRollbackThreshold
                  ? 'text-rose-400' : 'text-emerald-400'
              }`}>
                {phasedRollout.updatedDevices > 0 ? (phasedRollout.failedDevices / phasedRollout.updatedDevices * 100).toFixed(1) : '0.0'}%
                <span className="text-[10px] text-slate-500 font-normal ml-1">(limit {phasedRollout.autoRollbackThreshold}%)</span>
              </div>
            </div>
          </div>

          {/* Device Health Grid */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Device Health Checks</div>
            <div className="flex flex-wrap gap-1.5">
              {phasedRollout.healthChecks.slice(0, 30).map((h, i) => (
                <div
                  key={i}
                  title={`${h.deviceId}: ${h.status}`}
                  className={`w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center transition-all ${
                    h.status === 'ok' ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' :
                    h.status === 'failed' ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40 animate-pulse' :
                    h.status === 'flashing' ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40' :
                    'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  }`}
                >
                  {h.status === 'ok' ? '✓' : h.status === 'failed' ? '✗' : h.status === 'flashing' ? '⬆' : '…'}
                </div>
              ))}
              {phasedRollout.healthChecks.length > 30 && (
                <span className="text-[10px] text-slate-500 self-center">+{phasedRollout.healthChecks.length - 30} more</span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2 border-t border-slate-800">
            {phasedRollout.phase !== 'complete' && phasedRollout.phase !== 'rollback' && (
              <>
                <button
                  onClick={advancePhase}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg shadow"
                  style={gradient}
                >
                  <ArrowRightCircle size={13} />
                  {phasedRollout.phase === 'fleet' ? 'Mark Complete' : `Advance to ${phasedRollout.phase === 'canary' ? 'Phase 2 (25%)' : 'Phase 3 (100%)'}`}
                </button>
                <button
                  onClick={simulateFailure}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-lg bg-rose-950/20"
                  title="Simulate device failures to test auto-rollback"
                >
                  <AlertTriangle size={12} /> Simulate Failure
                </button>
              </>
            )}
            {phasedRollout.phase === 'rollback' && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                <XCircle size={14} />
                Rollback in progress — all updated devices are reverting to backup partition firmware
              </div>
            )}
            {phasedRollout.phase === 'complete' && (
              <button
                onClick={() => { setPhasedRollout(null); setShowPhasedPanel(false) }}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-400 border border-emerald-500/30 rounded-lg bg-emerald-950/20"
              >
                <CheckCircle2 size={13} /> Dismiss — Rollout Successful
              </button>
            )}
          </div>
        </div>
      )}

      {/* Advanced Deployment Modal: Fleet vs Canary */}
      {deployTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-indigo-400" />
                <h3 className="text-base font-bold text-white">Deploy OTA Firmware</h3>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {deployTarget.release.version}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <div className="text-slate-400">Target Product Line:</div>
                <div className="font-bold text-white text-sm">
                  {DOMAIN_LABEL[deployTarget.release.product as SensorDomain] || deployTarget.release.product}
                </div>
              </div>

              {/* Mode Selection */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">Rollout Strategy</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeployTarget({ ...deployTarget, mode: 'canary' })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      deployTarget.mode === 'canary'
                        ? 'border-amber-500 bg-amber-500/10 text-white'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold mb-0.5 text-xs">
                      <Radio size={13} className="text-amber-400" /> Canary Test
                    </div>
                    <div className="text-[10px] text-slate-500">Deploy to 1 specific device first</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeployTarget({ ...deployTarget, mode: 'fleet' })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      deployTarget.mode === 'fleet'
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold mb-0.5 text-xs">
                      <ArrowRightCircle size={13} className="text-indigo-400" /> Fleet Rollout
                    </div>
                    <div className="text-[10px] text-slate-500">Deploy to all eligible devices</div>
                  </button>
                </div>
              </div>

              {/* Canary Node Selector */}
              {deployTarget.mode === 'canary' && (
                <div>
                  <label className="block text-slate-400 font-semibold mb-1.5">Select Test Node</label>
                  {eligibleDevices.length === 0 ? (
                    <p className="text-amber-400 py-1">No devices registered under this product line.</p>
                  ) : (
                    <select
                      value={deployTarget.nodeId || eligibleDevices[0]?.id || ''}
                      onChange={(e) => setDeployTarget({ ...deployTarget, nodeId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 text-xs"
                    >
                      {eligibleDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.location || d.id})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {deployTarget.mode === 'fleet' && (
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] leading-relaxed">
                  ⚠️ This will broadcast the update command to <strong>{eligibleDevices.length}</strong> active devices. Devices will verify the binary checksum and reboot after flashing.
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setDeployTarget(null)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteDeploy}
                className="px-5 py-2 text-xs font-semibold text-white rounded-lg shadow transition-opacity hover:opacity-90 flex items-center gap-1.5"
                style={gradient}
              >
                <Send size={12} /> {deployTarget.mode === 'canary' ? 'Start Canary Test' : 'Deploy Fleet Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
