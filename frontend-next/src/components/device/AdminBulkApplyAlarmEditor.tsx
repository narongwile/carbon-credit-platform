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

import { useEffect, useMemo, useState } from 'react'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import { useManagedDevices, useFleetHosts } from '@/lib/useManagedDevices'
import { useAlarmDB } from '@/server/alarmStore'
import { api, isLive } from '@/lib/api'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import { Check, Users, Building2, Globe, Search, Sliders, Cpu } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

export default function AdminBulkApplyAlarmEditor({
  domain, orgId = 'org-1', nodeId,
}: { domain: SensorDomain; orgId?: string; nodeId?: string }) {
  const { devices } = useManagedDevices(orgId)
  const { hosts } = useFleetHosts(orgId)
  const setRuleDB = useAlarmDB((s) => s.setRule)

  const domainDevices = useMemo(() => {
    return devices.filter((d) => d.domain === domain)
  }, [devices, domain])

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

  const [applyScope, setApplyScope] = useState<'devices' | 'org' | 'department' | 'user'>('devices')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(() => {
    if (nodeId) return [nodeId]
    return []
  })
  const [deviceSearch, setDeviceSearch] = useState('')
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState('')

  // Sync selected devices when domain or nodeId changes
  useEffect(() => {
    if (nodeId) {
      setSelectedDeviceIds([nodeId])
      setApplyScope('devices')
    } else if (domainDevices.length && selectedDeviceIds.length === 0) {
      setSelectedDeviceIds(domainDevices.map((d) => d.id))
    }
  }, [nodeId, domain, domainDevices.length])

  // Seed default selections when lists load
  useEffect(() => {
    if (orgDepts.length && selectedDeptIds.length === 0) {
      setSelectedDeptIds([orgDepts[0].id])
    }
  }, [orgDepts, selectedDeptIds.length])

  useEffect(() => {
    if (orgUsers.length && selectedUserIds.length === 0) {
      setSelectedUserIds([orgUsers[0].id])
    }
  }, [orgUsers, selectedUserIds.length])

  const toggleDevice = (id: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((d) => d !== id) : prev) : [...prev, id]
    )
  }
  const selectAllDevices = () => setSelectedDeviceIds(domainDevices.map((d) => d.id))
  const clearDevices = () => { if (domainDevices.length) setSelectedDeviceIds([domainDevices[0].id]) }

  const toggleDept = (id: string) => {
    setSelectedDeptIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((d) => d !== id) : prev) : [...prev, id]
    )
  }

  const selectAllDepts = () => setSelectedDeptIds(orgDepts.map((d) => d.id))
  const clearDepts = () => { if (orgDepts.length) setSelectedDeptIds([orgDepts[0].id]) }

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((u) => u !== id) : prev) : [...prev, id]
    )
  }

  const selectAllUsers = () => setSelectedUserIds(orgUsers.map((u) => u.id))
  const clearUsers = () => { if (orgUsers.length) setSelectedUserIds([orgUsers[0].id]) }

  const filteredDevices = useMemo(() => {
    if (!deviceSearch.trim()) return domainDevices
    const q = deviceSearch.toLowerCase()
    return domainDevices.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      (d.location && d.location.toLowerCase().includes(q))
    )
  }, [domainDevices, deviceSearch])

  // Target device resolution
  const targetDeviceIds = useMemo(() => {
    if (applyScope === 'devices') {
      return new Set(selectedDeviceIds)
    }
    if (applyScope === 'org') {
      return new Set(hosts.filter((h) => h.domain === domain).map((h) => h.id))
    }
    const targetDeptSet = new Set<string>()
    if (applyScope === 'department') {
      selectedDeptIds.forEach((d) => targetDeptSet.add(d))
    } else if (applyScope === 'user') {
      selectedUserIds.forEach((uId) => {
        const u = orgUsers.find((x) => x.id === uId)
        if (u?.departmentId) targetDeptSet.add(u.departmentId)
      })
    }
    return new Set(
      devices
        .filter((d) => d.domain === domain && d.departmentIds?.some((deptId) => targetDeptSet.has(deptId)))
        .map((d) => d.id)
    )
  }, [applyScope, selectedDeviceIds, domain, hosts, devices, selectedDeptIds, selectedUserIds, orgUsers])

  const applyAllLabel = useMemo(() => {
    const platform = DOMAIN_META[domain]?.platform ?? domain
    const count = targetDeviceIds.size
    if (applyScope === 'devices') {
      if (selectedDeviceIds.length === 1) {
        const devName = domainDevices.find((d) => d.id === selectedDeviceIds[0])?.name || selectedDeviceIds[0]
        return `Apply Baseline to ${devName} (${selectedDeviceIds[0]})`
      }
      const names = selectedDeviceIds.map((id) => domainDevices.find((d) => d.id === id)?.name || id).join(', ')
      const truncated = names.length > 35 ? `${names.slice(0, 32)}…` : names
      return `Apply Baseline to ${selectedDeviceIds.length} Selected ${platform} Devices (${truncated})`
    }
    if (applyScope === 'org') {
      return `Apply Baseline to All ${platform} Devices (${count} Devices, Org-Wide)`
    }
    if (applyScope === 'department') {
      const deptLabel = selectedDeptIds.length === 1
        ? (orgDepts.find((d) => d.id === selectedDeptIds[0])?.name ?? '1 Department')
        : `${selectedDeptIds.length} Departments`
      return `Apply Baseline to ${deptLabel} (${count} ${platform} Devices)`
    }
    const userLabel = selectedUserIds.length === 1
      ? (orgUsers.find((u) => u.id === selectedUserIds[0])?.name ?? '1 User')
      : `${selectedUserIds.length} Users`
    return `Apply Baseline to ${userLabel}'s Teams (${count} ${platform} Devices)`
  }, [applyScope, domain, targetDeviceIds.size, selectedDeviceIds, domainDevices, selectedDeptIds, orgDepts, selectedUserIds, orgUsers])

  // window.confirm before bulk write
  const applyRule = async (rule: NodeAlarmRule) => {
    const platform = DOMAIN_META[domain]?.platform ?? domain

    if (applyScope === 'devices') {
      if (selectedDeviceIds.length === 0) {
        toast.error('Please select at least one device')
        return
      }
      const names = selectedDeviceIds.map((id) => domainDevices.find((d) => d.id === id)?.name || id).join(', ')
      if (!window.confirm(`Apply these alarm thresholds to ${selectedDeviceIds.length} ${platform} device(s) (${names})? This overwrites each device's current alarm rule and cannot be undone.`)) return

      selectedDeviceIds.forEach((id) => setRuleDB(id, rule, orgId))

      if (!isLive()) {
        toast.success(`Applied to ${selectedDeviceIds.length} device(s) (demo — not persisted)`)
        return
      }

      const results = await Promise.allSettled(
        selectedDeviceIds.map((id) => api.putRule(id, { orgId, rule }))
      )
      const successCount = results.filter((r) => r.status === 'fulfilled' && (r as any).value).length
      if (selectedDeviceIds.length === domainDevices.length) {
        await api.putOrgRule(orgId, { rule }).catch(() => {})
      }
      toast.success(`Applied alarm thresholds to ${successCount} ${platform} device(s) successfully!`)
      return
    }

    if (applyScope === 'org') {
      const targets = hosts.filter((h) => h.domain === domain)
      if (!window.confirm(`Apply these thresholds to all ${targets.length} ${platform} device(s) across your ENTIRE organization? This overwrites each device's current alarm rule and cannot be undone.`)) return
      targets.forEach((h) => setRuleDB(h.id, rule, orgId))
      if (isLive()) {
        const r = await api.putOrgRule(orgId, { rule })
        if (!r) { toast.error('Could not apply the rule across your organization'); return }
      }
      toast.success(`Applied to ${targets.length} ${platform} node(s) across your org`)
      return
    }

    if (applyScope === 'department' && selectedDeptIds.length === 0) {
      toast.error('Select at least one department')
      return
    }
    if (applyScope === 'user' && selectedUserIds.length === 0) {
      toast.error('Select at least one user')
      return
    }

    const scopeDesc = applyScope === 'department'
      ? `${selectedDeptIds.length} department(s)`
      : `${selectedUserIds.length} user(s)`

    if (!window.confirm(`Apply these thresholds to ${targetDeviceIds.size} ${platform} device(s) across ${scopeDesc}? This overwrites each device's current alarm rule and cannot be undone.`)) return

    hosts.filter((h) => h.domain === domain && targetDeviceIds.has(h.id)).forEach((h) => setRuleDB(h.id, rule, orgId))

    if (!isLive()) {
      toast.success(`Applied to ${targetDeviceIds.size} device(s) across ${scopeDesc} (demo — not persisted)`)
      return
    }

    const r = await api.putOrgRuleDepartment(orgId, {
      rule,
      departmentIds: applyScope === 'department' ? selectedDeptIds : undefined,
      userIds: applyScope === 'user' ? selectedUserIds : undefined,
    })
    if (!r) { toast.error(`Could not apply the rule to ${scopeDesc}`); return }
    toast.success(`Applied to ${r.applied} ${platform} node(s) across ${scopeDesc}`)
  }

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return orgUsers
    const q = userSearch.toLowerCase()
    return orgUsers.filter((u) => {
      const deptName = orgDepts.find((d) => d.id === u.departmentId)?.name ?? ''
      return u.name.toLowerCase().includes(q) || deptName.toLowerCase().includes(q)
    })
  }, [orgUsers, orgDepts, userSearch])

  return (
    <div className="space-y-3.5">
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider font-medium">
          Apply baseline to
        </label>
        <div className="flex flex-wrap gap-2 mb-2.5">
          {[
            { id: 'devices', label: 'Select Devices', icon: Sliders },
            { id: 'org', label: 'Whole organization', icon: Globe },
            { id: 'department', label: 'Departments', icon: Building2 },
            { id: 'user', label: 'Users', icon: Users },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setApplyScope(id as any)}
              className={clsx(
                'flex-1 min-w-[120px] py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
                applyScope === id ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              )}
              style={applyScope === id ? { background: 'rgba(99,102,241,0.22)', border: '1px solid #6366f1' } : inset}
            >
              <Icon size={13} className={applyScope === id ? 'text-indigo-400' : 'text-slate-500'} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Multi-Device Picker */}
        {applyScope === 'devices' && (
          <div className="p-3.5 rounded-xl border border-slate-800/90 space-y-3" style={{ background: '#0a0e1a' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white flex items-center gap-2">
                <Sliders size={13} className="text-indigo-400" />
                Select Target {DOMAIN_META[domain]?.platform || 'Devices'} ({selectedDeviceIds.length} of {domainDevices.length} selected)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllDevices}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline"
                >
                  Select All ({domainDevices.length})
                </button>
                <span className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={clearDevices}
                  className="text-[11px] text-slate-400 hover:text-slate-300 underline"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Search Filter */}
            {domainDevices.length > 3 && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  placeholder={`Search ${domain} devices by name, ID, or site…`}
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500"
                  style={inset}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
              {filteredDevices.map((d) => {
                const isSelected = selectedDeviceIds.includes(d.id)
                const isOnline = d.status === 'online'
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDevice(d.id)}
                    className={clsx(
                      'flex items-center justify-between p-2.5 rounded-lg text-xs font-medium transition-all border text-left',
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/80 text-white shadow-sm'
                        : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={clsx('w-4 h-4 rounded flex items-center justify-center text-[9px] border shrink-0', isSelected ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 bg-slate-800')}>
                        {isSelected && <Check size={10} />}
                      </div>
                      <div className="min-w-0 truncate">
                        <span className="font-semibold block truncate text-slate-200">{d.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono block truncate">{d.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className={clsx('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-emerald-400' : 'bg-slate-500')} />
                      <span className="text-[10px] text-slate-400 uppercase">{d.status}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Multi-Department Picker */}
        {applyScope === 'department' && (
          <div className="p-3 rounded-xl border border-slate-800/90 space-y-2.5" style={{ background: '#0a0e1a' }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                <Building2 size={12} className="text-indigo-400" />
                Select Departments ({selectedDeptIds.length} of {orgDepts.length} selected · {targetDeviceIds.size} devices)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllDepts}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                >
                  Select All
                </button>
                <span className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={clearDepts}
                  className="text-[10px] text-slate-400 hover:text-slate-300 underline"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {orgDepts.map((d) => {
                const isSelected = selectedDeptIds.includes(d.id)
                const deptDeviceCount = devices.filter((x) => x.domain === domain && x.departmentIds?.includes(d.id)).length
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDept(d.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                      isSelected
                        ? 'bg-indigo-950/50 border-indigo-500/80 text-white shadow-sm'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    )}
                  >
                    <div className={clsx('w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] border', isSelected ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 bg-slate-800')}>
                      {isSelected && <Check size={10} />}
                    </div>
                    <span>{d.name}</span>
                    <span className="text-[10px] opacity-60">({deptDeviceCount})</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Multi-User Picker */}
        {applyScope === 'user' && (
          <div className="p-3 rounded-xl border border-slate-800/90 space-y-2.5" style={{ background: '#0a0e1a' }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                <Users size={12} className="text-indigo-400" />
                Select Users ({selectedUserIds.length} of {orgUsers.length} selected · {targetDeviceIds.size} devices)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllUsers}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                >
                  Select All
                </button>
                <span className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={clearUsers}
                  className="text-[10px] text-slate-400 hover:text-slate-300 underline"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Search Filter */}
            {orgUsers.length > 4 && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter users or departments…"
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500"
                  style={inset}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
              {filteredUsers.map((u) => {
                const isSelected = selectedUserIds.includes(u.id)
                const deptName = orgDepts.find((d) => d.id === u.departmentId)?.name
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleUser(u.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border text-left',
                      isSelected
                        ? 'bg-indigo-950/50 border-indigo-500/80 text-white shadow-sm'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    )}
                  >
                    <div className={clsx('w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] border shrink-0', isSelected ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 bg-slate-800')}>
                      {isSelected && <Check size={10} />}
                    </div>
                    <span>{u.name}</span>
                    {deptName && <span className="text-[10px] text-indigo-300/70 bg-indigo-950/60 px-1 rounded">[{deptName}]</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <AlarmParamConfig
        domain={domain}
        nodeId={applyScope === 'devices' ? (selectedDeviceIds.length === 1 ? selectedDeviceIds[0] : undefined) : nodeId}
        orgId={orgId}
        onApplyAll={applyRule}
        applyAllLabel={applyAllLabel}
        targetDeviceIds={targetDeviceIds}
      />
    </div>
  )
}
