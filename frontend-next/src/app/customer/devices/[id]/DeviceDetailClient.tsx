'use client'

// ---------------------------------------------------------------------------
// Viewer device detail — /customer/devices/:id
// ---------------------------------------------------------------------------
// The event log, documents and export blocks used to be a second, hand-written
// implementation of what the admin device pages already do. They drifted: the
// log ran the client-side alarm engine over a synthetic sine wave instead of
// reading alarm_events, there was no Transport & Connectivity section at all,
// and the export produced rows from that same fake series. A viewer therefore
// saw a different device than the admin looking at the same node.
//
// It now composes the shared components (NodeEventLog / NodeDocuments /
// NodeReportButton / DeviceLiveStatus), which take a nodeId and scope
// themselves by the session's role and departments — so there is one behaviour
// to fix when something is wrong with it.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { defaultNotificationChannels } from '@/lib/orgData'
import { allManagedDevices } from '@/lib/fleetData'
import { useAppStore } from '@/lib/store'
import { viewerCanManage, viewerCanAccess, getViewerUser } from '@/lib/viewer'
import type { ManagedDevice, NotificationChannelConfig } from '@/types/org'
import FixDashboard from '@/components/device/FixDashboard'
import FreestyleDashboard from '@/components/device/FreestyleDashboard'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import {
  ArrowLeft, Bell, ToggleLeft, ToggleRight, Save, LayoutGrid, Sparkles, Lock, Eye,
} from 'lucide-react'
import clsx from 'clsx'

const managedDevices = allManagedDevices()

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function DeviceDetailClient() {
  const params = useParams()
  const id = String(params?.id ?? '')
  const device: ManagedDevice = managedDevices.find((d) => d.id === id) ?? managedDevices[0]

  // Viewer -> department -> product access
  const viewerUserId = useAppStore((s) => s.viewerUserId)
  const domain = device.domain
  const canManage = !domain || viewerCanManage(viewerUserId, domain)
  const canView = !domain || viewerCanAccess(viewerUserId, domain)
  const me = getViewerUser(viewerUserId)

  const [view, setView] = useState<'fix' | 'freestyle'>(device.theme)
  const baseTemp = useMemo(() => parseFloat(device.lastValue ?? '5') || 5, [device])

  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)
  const [savedSetting, setSavedSetting] = useState(false)

  const toggleChannel = (cid: string) => setChannels((c) => c.map((x) => (x.id === cid ? { ...x, enabled: !x.enabled } : x)))
  const saveSetting = async () => { await new Promise((r) => setTimeout(r, 300)); setSavedSetting(true); setTimeout(() => setSavedSetting(false), 2000) }

  if (!canView) {
    return (
      <div className="p-6">
        <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back</Link>
        <div className="max-w-lg mx-auto mt-12 rounded-2xl p-8 text-center" style={surface}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.12)' }}><Lock size={26} className="text-red-400" /></div>
          <h2 className="text-lg font-bold text-white">No access to this device</h2>
          <p className="text-sm text-slate-500 mt-2">Your department is not permitted to view this product. Contact your organization admin.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
          <ArrowLeft size={15} /> Back
        </Link>
        <span className="text-base font-bold text-white">{device.name}</span>
        {/* device.status is seed data and never changes; this follows device_presence. */}
        <DeviceLiveStatus nodeId={id} />
        <span className="text-xs text-slate-500">{device.location}</span>

        <div className="ml-auto flex items-center gap-3">
          {/* Theme preview toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg" style={inset}>
            <button onClick={() => setView('fix')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'fix' ? 'text-white' : 'text-slate-500')} style={view === 'fix' ? { background: '#6366f1' } : {}}>
              <LayoutGrid size={13} /> FIX
            </button>
            <button onClick={() => setView('freestyle')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'freestyle' ? 'text-white' : 'text-slate-500')} style={view === 'freestyle' ? { background: '#f55f3e' } : {}}>
              <Sparkles size={13} /> Free Style
            </button>
          </div>
          {/* Same report as the admin pages: real stored readings, PDF/Excel/CSV/JSON. */}
          <NodeReportButton nodeId={id} deviceName={device.name} domain={domain} />
        </div>
      </div>
      <div className="text-[11px] text-slate-600 -mt-3">
        {view === device.theme ? 'Showing this device’s configured dashboard.' : 'Previewing alternate theme (device default: ' + device.theme.toUpperCase() + ').'}
      </div>

      {/* Dashboard (distinct per theme) */}
      {view === 'fix' ? <FixDashboard device={device} /> : <FreestyleDashboard device={device} />}

      {/* Maintenance documents — scoped to the viewer's department by the API. */}
      <NodeDocuments nodeId={id} />

      {/* Alarm log + Transport & Connectivity, acknowledgement with the
          department problem catalogue, CSV/PDF export — the admin component. */}
      <NodeEventLog nodeId={id} domain={domain} baseValue={baseTemp} by={me?.name ?? 'viewer'} />

      {/* Personal alarm / notification — every viewer can set this; alerts ONLY this user */}
      <div className="rounded-xl p-5 space-y-3" style={surface}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">My Alert Settings</h3>
          <span className="text-[10px] text-slate-500 flex items-center gap-1"><Bell size={11} /> personal — alerts only you · {me?.email ?? '—'}</span>
        </div>
        <AlarmParamConfig domain={device.domain} nodeId={id} orgId={device.orgId} />
        <div className="space-y-1.5">
          {channels.map((ch) => (
            <div key={ch.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inset}>
              <span className="text-sm text-slate-300">{ch.name}</span>
              <button onClick={() => toggleChannel(ch.id)}>
                {ch.enabled ? <ToggleRight size={20} className="text-indigo-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
              </button>
            </div>
          ))}
        </div>
        <button onClick={saveSetting} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={savedSetting ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : gradient}>
          <Save size={14} /> {savedSetting ? 'Saved!' : 'Save My Alert'}
        </button>
      </div>
      {!canManage && (
        <div className="rounded-lg px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2" style={inset}>
          <Eye size={13} /> You have view access — your alert settings here are personal. Org-wide alarm rules are configured by your admin.
        </div>
      )}
    </div>
  )
}
