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
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useManagedDevice } from '@/lib/useManagedDevices'
import { useAppStore } from '@/lib/store'
import { useSessionOrgId } from '@/lib/auth'
import { useIsLive } from '@/lib/api'
import { useMyAccess, levelOf } from '@/lib/useMyAccess'
import { viewerCanManage, viewerCanAccess, getViewerUser } from '@/lib/viewer'
import FixDashboard from '@/components/device/FixDashboard'
import FreestyleDashboard from '@/components/device/FreestyleDashboard'
import MyAlertSettings from '@/components/device/MyAlertSettings'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import {
  ArrowLeft, LayoutGrid, Sparkles, Lock, Eye,
} from 'lucide-react'
import clsx from 'clsx'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function DeviceDetailClient() {
  const id = useSearchParams().get('id') ?? ''
  const live = useIsLive()
  // The real session's org — getViewerUser(viewerUserId)?.orgId used to
  // resolve this, but viewerUserId is the customer portal's DEMO "acting
  // viewer" picker (defaults to a persona id a real login never sets), so
  // this silently fell back to the 'org-1' literal for every real viewer
  // whose org was not org-1.
  const orgId = useSessionOrgId()
  const viewerUserId = useAppStore((s) => s.viewerUserId)
  const me = getViewerUser(viewerUserId)
  // Was `find(...) ?? managedDevices[0]`: opening a device id this viewer's org
  // does not have showed the FIRST seed device's name and location instead of
  // saying it does not exist.
  const { device, loaded, found, verified } = useManagedDevice(orgId, id)
  const domain = device?.domain
  // GET /api/fleet (behind useManagedDevice) already scopes which devices the
  // SIGNED-IN viewer can see — but `found` alone isn't proof of that: an id
  // not in this org's real roster still falls back to a STATIC cross-org
  // seed list (useManagedDevice's allManagedDevices() branch, meant for the
  // admin twin's "superadmin can open any node" case), with `found: true`
  // and zero relationship to the caller's real access. `verified` is true
  // only for the first, real branch — checking `live` alone (an earlier
  // version of this fix did) treated "the fetch mechanism is real" as "this
  // specific device passed access control," which they are not the same
  // claim: a viewer could open /customer/devices/detail?id=<another org's
  // seed device id> and see its fabricated name/location/dashboard, because
  // that id matches the seed list even though /api/fleet correctly omitted
  // it from their own roster.
  //
  // The mock viewerCanAccess() (keyed on viewerUserId, a demo persona id no
  // real login ever sets) evaluated to "no access" for every real viewer, so
  // this page showed "access denied" for every device, every real viewer,
  // regardless of their actual department — that half of the original bug
  // report. levelOf(myAccess, domain) supplies the view/manage DISTINCTION
  // real access doesn't expose any other way, defaulting to the safer
  // 'none' while it is still loading.
  const myAccess = useMyAccess()
  const canView = !domain || (live ? verified : viewerCanAccess(viewerUserId, domain))
  const canManage = !domain || (live ? levelOf(myAccess, domain) === 'manage' : viewerCanManage(viewerUserId, domain))
  // The device arrives asynchronously, so the theme cannot seed useState.
  // null = "follow the device's configured theme"; a value = user preview.
  const [viewOverride, setViewOverride] = useState<'fix' | 'freestyle' | null>(null)
  const baseTemp = useMemo(() => parseFloat(device?.lastValue ?? '5') || 5, [device])

  if (!device) {
    return (
      <div className="p-6">
        <Link href="/customer/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back</Link>
        <div className="max-w-lg mx-auto mt-12 rounded-2xl p-8 text-center" style={surface}>
          <h2 className="text-lg font-bold text-white">{loaded && !found ? 'Device not found' : 'Loading device…'}</h2>
          {loaded && !found && <p className="text-sm text-slate-500 mt-2">No device with id “{id}” in your organization.</p>}
        </div>
      </div>
    )
  }

  const view = viewOverride ?? device.theme

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
            <button onClick={() => setViewOverride('fix')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'fix' ? 'text-white' : 'text-slate-500')} style={view === 'fix' ? { background: '#6366f1' } : {}}>
              <LayoutGrid size={13} /> FIX
            </button>
            <button onClick={() => setViewOverride('freestyle')} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold', view === 'freestyle' ? 'text-white' : 'text-slate-500')} style={view === 'freestyle' ? { background: '#f55f3e' } : {}}>
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
      <MyAlertSettings nodeId={id} domain={domain} orgId={device.orgId} profileHref="/customer/profile" />

      {!canManage && (
        <div className="rounded-lg px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2" style={inset}>
          <Eye size={13} /> You have view access — your alert settings here are personal. Org-wide alarm rules are configured by your admin.
        </div>
      )}
    </div>
  )
}
