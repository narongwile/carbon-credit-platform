'use client'

// ---------------------------------------------------------------------------
// Fleet — real devices, real presence, real firmware history, real
// connectivity log.
//
// This page used to be entirely fake: the device list came from fleetData.ts
// (a static seed keyed to the three demo org ids, so a real organization saw
// zero devices, always), and "Interfaces" (CAN/RS485/I2C/GPIO/CT) and "LoRa
// Peers" (DevAddr/spreading factor) described a per-channel hardware wiring
// inventory that no table in this schema captures — not a bug where the data
// exists but isn't wired, data the ingest pipeline has never collected.
// Cellular detail (IMEI/ICCID/APN/SIM status) is the same story.
//
// What IS real and is used instead:
//   • useFleetHosts(orgId) — the same live roster admin/devices and the map use.
//   • GET /api/fleet/:id/latest — device_presence (online/last_seen/rssi/batt/
//     fw/transport) plus this device's current values, per parameter.
//   • GET /api/nodes/:id/transport — transport_events (wifi/4G/LoRa switches,
//     with rssi and reason) merged with offline_sync_log backlog flushes. This
//     replaces the fabricated "Cellular Link" panel with the real equivalent:
//     which transport it's on now, and its actual recent switches — without
//     inventing IMEI/ICCID/SIM fields nothing tracks.
//   • GET /api/ota/deployments?nodeId= — real OTA history, server-scoped and
//     already joined to product/version, instead of fetching every device's
//     deployments and filtering client-side.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { useFleetHosts } from '@/lib/useManagedDevices'
import { api, useIsLive, type DevicePresence } from '@/lib/api'
import {
  Cpu, Wifi, WifiOff, Battery, Signal, History, CheckCircle, RotateCcw, XCircle, Stethoscope, ArrowRightLeft, Loader2, Plug, Construction, ListChecks,
} from 'lucide-react'
import SensorDetailsModal from '@/components/SensorDetailsModal'
import PayloadCrossCheck from '@/components/device/PayloadCrossCheck'
import { useParamLabels } from '@/lib/useParamLabels'
import type { SensorDomain } from '@/types/fleet'
import { fmtDateTime } from '@/lib/displayTime'
import clsx from 'clsx'
import FleetRiskMatrix from '@/components/transformer/FleetRiskMatrix'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Interfaces (per-channel hardware wiring) is kept as a declared placeholder
// for future work. Nothing in this schema records it today — there is no
// device_interfaces table and the ingest payload carries no channel inventory —
// so it deliberately renders as an empty, clearly-labelled section rather than
// the seeded CAN/RS485/I2C/GPIO/CT rows it used to show. Those rows came from
// fleetData.ts and were identical for every customer, which read as "your
// gateway has an RS485-A port that is up" when nothing had ever checked.
//
// To make it real: a device_interfaces table (node_id, kind, label, status),
// populated either from a provisioning record or from a channel inventory in
// the device's announce payload, then listed here per node.
const PLANNED_INTERFACE_KINDS = ['CAN', 'RS485', 'I2C', 'GPIO', 'CT'] as const

const fwResult: Record<string, { color: string; icon: React.ReactNode }> = {
  success:      { color: '#4ade80', icon: <CheckCircle size={12} /> },
  rolled_back:  { color: '#fbbf24', icon: <RotateCcw size={12} /> },
  failed:       { color: '#ef4444', icon: <XCircle size={12} /> },
  flashing:     { color: '#818cf8', icon: <Loader2 size={12} className="animate-spin" /> },
  downloading:  { color: '#818cf8', icon: <Loader2 size={12} className="animate-spin" /> },
  verifying:    { color: '#818cf8', icon: <Loader2 size={12} className="animate-spin" /> },
  accepted:     { color: '#818cf8', icon: <Loader2 size={12} className="animate-spin" /> },
  pending:      { color: '#6b7280', icon: <History size={12} /> },
}

type OtaDeployment = NonNullable<Awaited<ReturnType<typeof api.otaDeployments>>>[number]
type TransportEvent = NonNullable<Awaited<ReturnType<typeof api.transportEvents>>>[number]

export default function FleetPage() {
  const live = useIsLive()
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'
  const { hosts, loaded: fleetLoaded } = useFleetHosts(orgId)

  const [activeId, setActiveId] = useState('')
  const [fleetView, setFleetView] = useState<'connectivity' | 'risk'>('connectivity')
  useEffect(() => { if (hosts.length && !hosts.some((h) => h.id === activeId)) setActiveId(hosts[0]?.id ?? '') }, [hosts, activeId])
  const active = hosts.find((h) => h.id === activeId)

  const [sites, setSites] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!live) { setSites({}); return }
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSites(Object.fromEntries(r.sites.map((s) => [s.id, s.name]))) })
    return () => { cancelled = true }
  }, [live, orgId])
  const siteName = (id: string) => sites[id] ?? id

  const [presence, setPresence] = useState<DevicePresence | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [lastReadingAt, setLastReadingAt] = useState<string | null>(null)
  const [transport, setTransport] = useState<TransportEvent[]>([])
  const [deployments, setDeployments] = useState<OtaDeployment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [showDiag, setShowDiag] = useState(false)

  useEffect(() => {
    if (!activeId || !live) { setPresence(null); setValues({}); setTransport([]); setDeployments([]); return }
    let cancelled = false
    setDetailLoading(true)
    Promise.all([
      api.latest(activeId),
      api.transportEvents(activeId),
      api.otaDeployments({ nodeId: activeId }),
    ]).then(([lat, tr, dep]) => {
      if (cancelled) return
      setPresence(lat?.presence ?? null)
      setValues(lat?.values ?? {})
      setLastReadingAt(lat?.lastReadingAt ?? null)
      setTransport(tr ?? [])
      setDeployments(dep ?? [])
      setDetailLoading(false)
    })
    return () => { cancelled = true }
  }, [activeId, live])

  const online = presence?.online === 1

  // Actual-vs-expected payload, the same cross-check admin/pending runs at
  // approval time. It belongs here too, and arguably matters MORE here: at
  // approval the device is new and someone is already looking closely, whereas
  // a parameter that silently stops arriving six months later — a dead sensor,
  // a firmware regression that renamed a key — has no other place in the
  // product that would show it. Before this, the check simply disappeared the
  // moment a device was approved.
  //
  // Scoped to the active device (nodeId passed through), so a per-device
  // display_params override shows that device's real spec rather than the
  // org-wide default it may deliberately differ from.
  const activeDomain = active?.domain as SensorDomain | undefined
  const { labelOf } = useParamLabels(orgId, activeDomain, activeId || undefined)
  const [specKeys, setSpecKeys] = useState<string[]>([])
  useEffect(() => {
    if (!live || !activeId || !activeDomain) { setSpecKeys([]); return }
    let cancelled = false
    api.displayParams(orgId, activeDomain, activeId).then((r) => {
      if (!cancelled) setSpecKeys(r?.paramKeys ?? [])
    })
    return () => { cancelled = true }
  }, [live, orgId, activeId, activeDomain])

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Fleet — Devices &amp; Asset Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Live device presence, firmware OTA history, and ISO 55000 CapEx Risk Planning</p>
        </div>

        <div className="flex items-center gap-1 bg-[#0a0e1a] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setFleetView('connectivity')}
            className={clsx(
              'text-xs px-3 py-1.5 rounded-md font-semibold transition-all',
              fleetView === 'connectivity' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            📡 Connectivity &amp; OTA
          </button>
          <button
            onClick={() => setFleetView('risk')}
            className={clsx(
              'text-xs px-3 py-1.5 rounded-md font-semibold transition-all',
              fleetView === 'risk' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            🏢 Fleet Risk Matrix
          </button>
        </div>
      </div>

      {fleetView === 'risk' ? (
        <FleetRiskMatrix hosts={hosts} sites={sites} />
      ) : (
        <>
          {!live && (
            <div className="rounded-xl p-3 text-xs text-amber-300" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
              Demo mode shows sample devices — switch to Live for this organization&apos;s real fleet.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Device list */}
        <div className="space-y-2">
          {!fleetLoaded ? (
            <p className="text-sm text-slate-500 p-4">Loading fleet…</p>
          ) : hosts.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No devices in this organization yet.</p>
          ) : hosts.map((h) => (
            <button key={h.id} onClick={() => setActiveId(h.id)} className="w-full text-left p-4 rounded-xl transition-all" style={{ ...surface, borderColor: activeId === h.id ? '#6366f1' : '#1e2433' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}><Cpu size={15} className="text-indigo-400" /></span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{h.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{h.id}</div>
                  </div>
                </div>
                {h.status === 'OFFLINE' ? <WifiOff size={15} className="text-slate-600 flex-shrink-0" /> : <Wifi size={15} className="text-green-400 flex-shrink-0" />}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                <span className="truncate">{siteName(h.siteId)}</span>
                <span className="capitalize flex-shrink-0 ml-2">{h.domain}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Device detail */}
        {active && (
          <div className="lg:col-span-2 space-y-4">
            {/* Header / presence */}
            <div className="rounded-xl p-5" style={surface}>
              <div className="flex items-center justify-between mb-3">
                <div className="min-w-0">
                  <div className="text-base font-bold text-white truncate">{active.name}</div>
                  <div className="text-xs text-slate-500 font-mono truncate">{active.id}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setShowDiag(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm relative group hover:brightness-110 transition-all"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    <Stethoscope size={13} /> Diagnostics
                    {presence?.identity_conflict_at && (
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping absolute -top-0.5 -right-0.5" title="Hardware Collision Active" />
                    )}
                  </button>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={online ? { color: '#4ade80', background: 'rgba(74,222,128,0.12)' } : { color: '#94a3b8', background: 'rgba(148,163,184,0.12)' }}>
                    {detailLoading ? '…' : online ? 'online' : 'offline'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Firmware', presence?.fw || '—'],
                  ['Battery', presence?.batt != null ? `${presence.batt}%` : '—'],
                  ['Signal', presence?.rssi != null ? `${presence.rssi} dBm` : '—'],
                  ['Last seen', presence?.last_seen ? fmtDateTime(presence.last_seen) : 'never'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg p-2.5" style={inset}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{k}</div>
                    <div className="text-sm text-white font-medium truncate">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Telemetry parameters — actual vs expected, shared with
                admin/pending so the colours mean the same thing on both. */}
            <div className="rounded-xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <ListChecks size={14} className="text-amber-400" /> Telemetry Parameters
                <a href="/admin/pending" className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-normal">MQTT setup</a>
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                What this device last reported, against what this organization expects it to send. Amber on both
                rows is a matched parameter; rose is expected but absent.
              </p>
              {detailLoading ? (
                <p className="text-xs text-slate-600">Loading…</p>
              ) : !live ? (
                <p className="text-xs text-slate-600">Demo mode — switch to Live to cross-check real telemetry.</p>
              ) : (
                <PayloadCrossCheck
                  sample={Object.entries(values)}
                  specKeys={specKeys}
                  labelOf={labelOf}
                  unconfiguredHint="no payload spec configured for this product — every field the device sends is shown as-is"
                  missingNote="check the sensor, or whether this unit's firmware still reports it."
                />
              )}
              {live && !detailLoading && Object.keys(values).length === 0 && (
                <p className="text-xs text-slate-600">No readings recorded for this device yet.</p>
              )}
            </div>

            {/* Interfaces — declared placeholder, see PLANNED_INTERFACE_KINDS */}
            <div className="rounded-xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <Plug size={14} className="text-indigo-400" /> Interfaces
                <span className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider" style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>
                  <Construction size={10} /> planned
                </span>
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Per-channel wiring inventory for this gateway. Not collected yet — devices do not report a channel
                inventory, so there is nothing to show rather than something to guess.
              </p>
              <div className="flex flex-wrap gap-2">
                {PLANNED_INTERFACE_KINDS.map((k) => (
                  <span key={k} className="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-600" style={{ ...inset, borderStyle: 'dashed' }}>
                    {k}
                  </span>
                ))}
              </div>
            </div>

            {/* Connectivity — current transport + real switch history */}
            <div className="rounded-xl p-5" style={surface}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Signal size={14} className="text-red-400" /> Connectivity
                {presence?.transport && (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium uppercase" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                    {presence.transport}
                  </span>
                )}
              </h3>
              {detailLoading ? (
                <p className="text-xs text-slate-600">Loading…</p>
              ) : transport.length === 0 ? (
                <p className="text-xs text-slate-600">No transport switches recorded for this device.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {transport.slice(0, 15).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs py-1.5" style={{ borderTop: '1px solid #1e2433' }}>
                      <ArrowRightLeft size={11} className={t.isOfflineSync ? 'text-amber-400' : 'text-indigo-400'} />
                      <span className="text-slate-300 flex-1 truncate">{t.desc}</span>
                      <span className="text-slate-600 flex-shrink-0">{fmtDateTime(t.ts)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Firmware OTA history — real, server-scoped */}
            <div className="rounded-xl p-5" style={surface}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><History size={14} className="text-indigo-400" /> Firmware OTA History</h3>
                <a href="/admin/ota" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Manage OTA</a>
              </div>
              <div className="space-y-2">
                {detailLoading ? (
                  <p className="text-xs text-slate-600">Loading…</p>
                ) : deployments.length === 0 ? (
                  <p className="text-xs text-slate-600">No OTA deployments recorded for this device.</p>
                ) : deployments.map((d) => {
                  const r = fwResult[d.status] ?? fwResult.pending
                  return (
                    <div key={d.release_id + d.started_at} className="flex items-center justify-between p-3 rounded-lg" style={inset}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded flex items-center justify-center bg-black/20 flex-shrink-0" style={{ color: r.color }}>{r.icon}</div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white truncate">{d.product ? `${d.product} ${d.version}` : d.release_id.slice(0, 8)}</div>
                          <div className="text-[10px] text-slate-500">{fmtDateTime(d.completed_at || d.started_at)}</div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="text-xs font-bold" style={{ color: r.color }}>{d.status.replace('_', ' ').toUpperCase()}</div>
                        {d.status !== 'success' && d.progress_pct != null && d.progress_pct > 0 && d.progress_pct < 100 && (
                          <div className="text-[10px] text-slate-600">{d.progress_pct}%</div>
                        )}
                        {d.error_msg && <div className="text-[10px] text-red-400 max-w-[160px] truncate" title={d.error_msg}>{d.error_msg}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )}

      <SensorDetailsModal
        isOpen={showDiag}
        onClose={() => setShowDiag(false)}
        nodeId={active?.id ?? null}
        deviceName={active?.name}
        domain={active?.domain}
        orgId={orgId}
        presence={presence}
        values={values}
        lastReadingAt={lastReadingAt}
      />
    </div>
  )
}
