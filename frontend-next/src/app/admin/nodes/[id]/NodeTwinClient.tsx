'use client'

import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { allManagedDevices } from '@/lib/fleetData'
import { DOMAIN_META } from '@/types/fleet'
import FixDashboard from '@/components/device/FixDashboard'
import NodeEventLog from '@/components/device/NodeEventLog'
import NodeDocuments from '@/components/device/NodeDocuments'
import NodeReportButton from '@/components/device/NodeReportButton'
import DeviceLiveStatus from '@/components/device/DeviceLiveStatus'
import { ArrowLeft } from 'lucide-react'
import type { ManagedDevice } from '@/types/org'

const devices = allManagedDevices()

// Admin / Super Admin digital-twin node detail. Reuses the FIX dashboard
// (3D twin + sensor readings + gauge + asset info + trend) for any node.
export default function NodeTwinClient() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')
  const device: ManagedDevice = devices.find((d) => d.id === id) ?? devices[0]
  const meta = device.domain ? DOMAIN_META[device.domain] : null

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
          <span className="text-[11px] text-slate-600 hidden xl:inline">3D Digital Twin · click any component to inspect</span>
          {/* device.status comes from the seed fleet and never changes. The badge
              follows device_presence instead, so it agrees with the Event Log. */}
          <DeviceLiveStatus nodeId={device.id} />
          <NodeReportButton nodeId={device.id} deviceName={device.name} domain={device.domain} />
        </div>
      </div>

      <FixDashboard device={device} />

      <NodeDocuments nodeId={device.id} />

      <NodeEventLog nodeId={device.id} domain={device.domain} baseValue={parseFloat(device.lastValue ?? '') || 4} />
    </div>
  )
}
