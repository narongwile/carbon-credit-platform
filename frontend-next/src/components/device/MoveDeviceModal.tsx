'use client'

// ---------------------------------------------------------------------------
// Reassign an already-ACTIVE device to a different organization.
//
// Genuinely different from a pending device's org picker (admin/pending):
// this device has real history, and under TENANT_DB_MODE that history lives
// in the CURRENT org's own database — moving it means the backend copies
// readings, alarms, photos and documents into the destination org's database
// and removes them from this one (POST /api/nodes/move). Superadmin only,
// and deliberately not undo-able from the UI — say so plainly before it runs.
//
// A device with second feeds merged into it (nodes.merge_into) must move as
// one group — the backend refuses a partial group outright — so this always
// carries the whole group, not just the device that opened it.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { X, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Org { id: string; name: string; status?: string }

export default function MoveDeviceModal({
  device, group, currentOrgId, onClose, onMoved,
}: {
  device: { id: string; name: string }
  /** Second feeds merged into `device` — moves together, always. */
  group: { id: string; name: string | null }[]
  currentOrgId: string
  onClose: () => void
  onMoved: (targetOrgId: string) => void
}) {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [targetOrgId, setTargetOrgId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    api.orgs().then((r) => {
      if (!r) return
      setOrgs(r.filter((o) => o.id !== currentOrgId && o.status !== 'suspended'))
    })
  }, [currentOrgId])

  const allIds = [device.id, ...group.map((g) => g.id)]
  const targetOrg = orgs.find((o) => o.id === targetOrgId)
  const ready = !!targetOrgId && confirmText.trim().toUpperCase() === 'MOVE'

  const move = async () => {
    setBusy(true)
    const r = await api.moveNodes(allIds, targetOrgId)
    setBusy(false)
    if (!r.ok && !r.results) { toast.error(r.error || 'Could not reach the server'); return }
    const results = r.results ?? []
    const failed = results.filter((x) => !x.ok)
    const warned = results.filter((x) => x.ok && x.warnings && x.warnings.length > 0)
    if (failed.length) {
      toast.error(failed.map((f) => `${f.nodeId}: ${f.error}`).join(' · '))
      // A partial group failure (207) can leave SOME devices moved and
      // others not — surfacing that clearly matters more here than almost
      // anywhere else in the app, since the whole point of moving as a group
      // was to keep them together.
      if (failed.length < results.length) {
        toast.error(`${results.length - failed.length} of ${results.length} moved — the group is now split. Re-open this device to check its current organization before retrying.`, { duration: 8000 })
      }
      return
    }
    if (warned.length) {
      toast.success(`Moved to ${targetOrg?.name ?? targetOrgId}`, { duration: 4000 })
      toast(warned.flatMap((w) => w.warnings ?? []).join(' · '), { icon: '⚠️', duration: 8000 })
    } else {
      toast.success(`Moved to ${targetOrg?.name ?? targetOrgId}`)
    }
    onMoved(targetOrgId)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-md rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-indigo-400" /> Move to another organization
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Moving</label>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm" style={inset}>
                <span className="text-white font-medium">{device.name}</span>
                <span className="text-[10px] font-mono text-slate-600 ml-auto">{device.id}</span>
              </div>
              {group.map((g) => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm ml-4" style={inset}>
                  <span className="text-[10px] text-slate-600">second feed</span>
                  <span className="text-slate-300">{g.name || g.id}</span>
                  <span className="text-[10px] font-mono text-slate-600 ml-auto">{g.id}</span>
                </div>
              ))}
            </div>
            {group.length > 0 && (
              <p className="text-[11px] text-slate-600 mt-1.5">
                Merged feeds move together with their primary — the backend refuses to split a group across two organizations.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Destination organization</label>
            <select value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
              <option value="" className="bg-[#0d1117]">— select an organization —</option>
              {orgs.map((o) => <option key={o.id} value={o.id} className="bg-[#0d1117]">{o.name}</option>)}
            </select>
          </div>

          <div className="rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              This moves real history — readings, alarms, photos, documents — into {targetOrg?.name ?? 'the destination organization'}&apos;s
              own database and removes it from this one. It is not reversible from this screen; moving back is a second, separate move.
              Any department/site assignment and old-org visibility grants are cleared, not carried over.
            </span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">
              Type <span className="font-mono text-slate-300">MOVE</span> to confirm
            </label>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder="MOVE"
              className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-700 font-mono outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          </div>
        </div>

        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={move} disabled={!ready || busy}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={gradient}>
            {busy ? 'Moving…' : `Move ${allIds.length > 1 ? `${allIds.length} devices` : 'device'}`}
          </button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
