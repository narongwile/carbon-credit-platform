'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useManagedDevice } from '@/lib/useManagedDevices'
import { useAppStore } from '@/lib/store'
import { DOMAIN_META } from '@/types/fleet'
import FixDashboard from '@/components/device/FixDashboard'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeSitePanel from '@/components/device/NodeSitePanel'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import MyAlertSettings from '@/components/device/MyAlertSettings'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

// Admin / Super Admin digital-twin node detail. Reuses the FIX dashboard
// (3D twin + sensor readings + gauge + asset info + trend) for any node.
export default function NodeTwinClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = searchParams.get('id') ?? ''
  const orgId = useAppStore((s) => s.selectedOrgId) || 'org-1'
  // Was `devices.find(...) ?? devices[0]` — an id that is not in the roster
  // rendered the FIRST device's name, serial and location while the panels below
  // loaded the requested id, so the page described the wrong asset.
  const { device, loaded, found } = useManagedDevice(orgId, id)
  const meta = device?.domain ? DOMAIN_META[device.domain] : null

  if (!device) {
    return (
      <div className="p-6">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-4">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="max-w-lg mx-auto mt-12 rounded-2xl p-8 text-center" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <h2 className="text-lg font-bold text-white">{loaded && !found ? 'Device not found' : 'Loading device…'}</h2>
          {loaded && !found && <p className="text-sm text-slate-500 mt-2">No node with id “{id}” in this organization.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
          <ArrowLeft size={15} /> Back
        </button>
        <span className="text-base font-bold text-white">{device.name}</span>
        {meta && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: meta.accent, background: `${meta.accent}1f` }}>{meta.platform}</span>}
        <span className="text-xs text-slate-500">{device.location} · {device.serial}</span>
        <div className="ml-auto flex items-center gap-3">
          {/* Was "3D Digital Twin · click any component to inspect", which stayed
              on the page after the twin became a fallback behind the uploaded
              photo — it told an admin to click parts of an image. */}
          <span className="text-[11px] text-slate-600 hidden xl:inline">Hover the photo to upload or replace it</span>
          {/* device.status comes from the seed fleet and never changes. The badge
              follows device_presence instead, so it agrees with the Event Log. */}
          <DeviceLiveStatus nodeId={device.id} />
          <NodeReportButton nodeId={device.id} deviceName={device.name} domain={device.domain} />
        </div>
      </div>

      {/* When device is a transformer, offer 1-click access to the dedicated Advanced APM Studio */}
      {device.domain === 'transformer' && (
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-indigo-950/40 border border-indigo-500/40 flex items-center justify-between gap-3 flex-wrap shadow-lg">
          <div className="flex items-center gap-2.5">
            <span className="text-base">⚡</span>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>หน้าหม้อแปลงไฟฟ้าแบบละเอียดพิเศษ (Tier-1 Transformer APM Studio)</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                  DGA · DTR · Bushing · 5-Threats
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                เปิดดูสามเหลี่ยมดูวาล์ว, อัตราเร่งเสื่อมกระดาษ RUL, ความจุบุชชิ่ง tan δ, กับดักฟ้าผ่า และ GenAI Copilot
              </p>
            </div>
          </div>
          <Link
            href={`/admin/transformers/detail?id=${encodeURIComponent(device.id)}`}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap hover:scale-105"
          >
            <span>เปิดหน้า Transformer APM Studio</span>
            <ExternalLink size={13} />
          </Link>
        </div>
      )}

      <FixDashboard device={device} />

      {/* Which of the customer's sites this unit is at, and what else is there.
          ETERNITY's customers run from one substation to a dozen plants, so the
          device page has to answer that without a detour through Sites. */}
      <NodeSitePanel nodeId={device.id} orgId={device.orgId} currentSiteId={device.siteId} domain={device.domain} />

      <NodeDocuments nodeId={device.id} orgId={device.orgId} deviceName={device.name} />

      <NodeEventLog nodeId={device.id} domain={device.domain} baseValue={parseFloat(device.lastValue ?? '') || 4} />

      {/* An admin carries the pager for these devices too — same personal
          alerting a viewer gets, stored against their own user. */}
      <MyAlertSettings nodeId={device.id} domain={device.domain} orgId={device.orgId} />
    </div>
  )
}
