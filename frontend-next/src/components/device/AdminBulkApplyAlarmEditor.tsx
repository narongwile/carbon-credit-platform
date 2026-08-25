'use client'

// ---------------------------------------------------------------------------
// Wraps AlarmParamConfig with the admin "Apply baseline to" scope picker
// (whole org / one department / one user's own department) — shared by
// admin/notifications (editing any device's or the org's baseline) and
// MyAlertSettings' admin accordion (editing one specific transformer's
// Device-Wide rule right from that device's own dashboard). An admin tuning
// a real device's numbers there can roll them out in bulk without navigating
// away to a separate settings page first.
//
// Bulk-applies the SHARED rule (alarm_rules) — never org_domain_rules for a
// department/user scope, only for the org-wide scope — see
// api.putOrgRuleDepartment's own doc comment for why that split exists.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import { useManagedDevices, useFleetHosts } from '@/lib/useManagedDevices'
import { useAlarmDB } from '@/server/alarmStore'
import { api, isLive } from '@/lib/api'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

export default function AdminBulkApplyAlarmEditor({
  domain, orgId = 'org-1', nodeId,
}: { domain: SensorDomain; orgId?: string; nodeId?: string }) {
  const { devices } = useManagedDevices(orgId)
  const { hosts } = useFleetHosts(orgId)
  const setRuleDB = useAlarmDB((s) => s.setRule)

  const [orgDepts, setOrgDepts] = useState<{ id: string; name: string }[]>([])
  const [orgUsers, setOrgUsers] = useState<{ id: string; name: string; departmentId?: string }[]>([])
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.departments(orgId).then((r) => { if (!cancelled && r) setOrgDepts(r as { id: string; name: string }[]) })
    api.users(orgId).then((rows) => {
      if (cancelled || !rows) return
      setOrgUsers((rows as Array<{ id: string; name: string; department_id?: string }>)
        .map((r) => ({ id: r.id, name: r.name, departmentId: r.department_id })))
    })
    return () => { cancelled = true }
  }, [orgId])

  const [applyScope, setApplyScope] = useState<'org' | 'department' | 'user'>('org')
  const [applyDeptId, setApplyDeptId] = useState('')
  const [applyUserId, setApplyUserId] = useState('')
  useEffect(() => { if (orgDepts.length && !orgDepts.some((d) => d.id === applyDeptId)) setApplyDeptId(orgDepts[0]?.id ?? '') }, [orgDepts, applyDeptId])
  useEffect(() => { if (orgUsers.length && !orgUsers.some((u) => u.id === applyUserId)) setApplyUserId(orgUsers[0]?.id ?? '') }, [orgUsers, applyUserId])

  const applyAllLabel = applyScope === 'org'
    ? `Apply Baseline to All ${DOMAIN_META[domain].platform} Devices (Org-Wide)`
    : applyScope === 'department'
      ? `Apply Baseline to ${orgDepts.find((d) => d.id === applyDeptId)?.name ?? 'Department'} Devices`
      : `Apply Baseline to ${orgUsers.find((u) => u.id === applyUserId)?.name ?? 'User'}'s Department Devices`

  // window.confirm before either branch: this overwrites, in bulk, whatever
  // alarm rule those devices currently have, with no undo — the same
  // confirm-before-bulk-destructive pattern admin/users and admin/pending
  // already use.
  const applyRule = async (rule: NodeAlarmRule) => {
    if (applyScope === 'org') {
      const targets = hosts.filter((h) => h.domain === domain)
      if (!window.confirm(`Apply these thresholds to all ${targets.length} ${DOMAIN_META[domain].platform} device(s) across your ENTIRE organization? This overwrites each device's current alarm rule and cannot be undone.`)) return
      targets.forEach((h) => setRuleDB(h.id, rule, orgId))
      if (isLive()) {
        const r = await api.putOrgRule(orgId, { rule })
        if (!r) { toast.error('Could not apply the rule across your organization'); return }
      }
      toast.success(`Applied to ${targets.length} ${DOMAIN_META[domain].platform} node(s) across your org`)
      return
    }

    const deptId = applyScope === 'department' ? applyDeptId : orgUsers.find((u) => u.id === applyUserId)?.departmentId
    if (!deptId) { toast.error(applyScope === 'user' ? 'This user has no department to scope the rule to' : 'Pick a department first'); return }
    const deptName = orgDepts.find((d) => d.id === deptId)?.name ?? deptId
    const targetIds = new Set(devices.filter((d) => d.domain === domain && d.departmentIds?.includes(deptId)).map((d) => d.id))
    if (!window.confirm(`Apply these thresholds to ${targetIds.size} ${DOMAIN_META[domain].platform} device(s) in ${deptName}? This overwrites each device's current alarm rule and cannot be undone.`)) return
    hosts.filter((h) => h.domain === domain && targetIds.has(h.id)).forEach((h) => setRuleDB(h.id, rule, orgId))
    if (!isLive()) { toast.success(`Applied to ${targetIds.size} device(s) in ${deptName} (demo — not persisted)`); return }
    const r = await api.putOrgRuleDepartment(orgId, {
      rule,
      departmentId: applyScope === 'department' ? applyDeptId : undefined,
      userId: applyScope === 'user' ? applyUserId : undefined,
    })
    if (!r) { toast.error(`Could not apply the rule to ${deptName}`); return }
    toast.success(`Applied to ${r.applied} ${DOMAIN_META[domain].platform} node(s) in ${deptName}`)
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Apply baseline to</label>
        <div className="flex gap-2 mb-2">
          {(['org', 'department', 'user'] as const).map((s) => (
            <button key={s} onClick={() => setApplyScope(s)}
              className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold transition-all', applyScope === s ? 'text-white' : 'text-slate-500')}
              style={applyScope === s ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
              {s === 'org' ? 'Whole organization' : s === 'department' ? 'One department' : 'One user'}
            </button>
          ))}
        </div>
        {applyScope === 'department' && (
          <select value={applyDeptId} onChange={(e) => setApplyDeptId(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
            {orgDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {applyScope === 'user' && (
          <select value={applyUserId} onChange={(e) => setApplyUserId(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={inset}>
            {orgUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      <AlarmParamConfig domain={domain} nodeId={nodeId} orgId={orgId} onApplyAll={applyRule} applyAllLabel={applyAllLabel} />
    </div>
  )
}
