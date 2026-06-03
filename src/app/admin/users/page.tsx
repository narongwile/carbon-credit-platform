'use client'

import { useMemo, useState } from 'react'
import { useAppStore } from '@/lib/store'
import {
  departments as seedDepartments,
  managedUsers as seedUsers,
  dashboardThemes,
  roleLabels,
  getEventProblemsByDept,
} from '@/lib/orgData'
import { getOrgThemeGrants } from '@/lib/orgThemes'
import { licensedDomains } from '@/lib/entitlements'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { Department, ManagedUser, ManagedRole, EventProblem } from '@/types/org'
import {
  Users, Building2, ShieldCheck, Palette, Plus, Trash2, X, Check, Boxes,
  ToggleLeft, ToggleRight, Pencil, Eye, Settings2, Ban, ListChecks,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

type Tab = 'departments' | 'users' | 'roles' | 'permissions' | 'products' | 'events'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'departments', label: 'Departments', icon: Building2 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'roles', label: 'User Roles', icon: ShieldCheck },
  { id: 'permissions', label: 'Dashboard View Permission', icon: Palette },
  { id: 'products', label: 'Product Access', icon: Boxes },
  { id: 'events', label: 'Event Catalog', icon: ListChecks },
]

const ROLES: ManagedRole[] = ['admin', 'editor', 'viewer']

const roleColor: Record<ManagedRole, { color: string; bg: string }> = {
  admin: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  editor: { color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  viewer: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
}

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export default function UserManagementPage() {
  const { selectedOrgId } = useAppStore()
  const orgId = selectedOrgId || 'org-1'

  const [tab, setTab] = useState<Tab>('departments')
  const [departments, setDepartments] = useState<Department[]>(seedDepartments.filter((d) => d.orgId === orgId))
  const [users, setUsers] = useState<ManagedUser[]>(seedUsers.filter((u) => u.orgId === orgId))

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? '—'

  // ----- Departments -----
  const [newDept, setNewDept] = useState('')
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null)
  const [editingDeptName, setEditingDeptName] = useState('')
  const addDept = () => {
    if (!newDept.trim()) return
    setDepartments((d) => [...d, { id: `dept-${Date.now()}`, orgId, name: newDept.trim(), themeIds: ['th-overview'] }])
    setNewDept('')
  }
  const renameDept = (id: string, name: string) => {
    if (!name.trim()) return
    setDepartments((d) => d.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)))
    setEditingDeptId(null); setEditingDeptName('')
  }
  const removeDept = (id: string) => {
    setDepartments((d) => d.filter((x) => x.id !== id))
    setUsers((u) => u.map((x) => ({ ...x, departmentIds: x.departmentIds.filter((dd) => dd !== id) })))
  }

  // ----- Users -----
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)
  const [showNewUser, setShowNewUser] = useState(false)

  const upsertUser = (u: ManagedUser) => {
    setUsers((prev) => (prev.some((x) => x.id === u.id) ? prev.map((x) => (x.id === u.id ? u : x)) : [...prev, u]))
  }
  const removeUser = (id: string) => setUsers((u) => u.filter((x) => x.id !== id))

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">User Management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Departments, users, roles and dashboard view permissions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={inset}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition-all', tab === t.id ? 'text-white' : 'text-slate-500 hover:text-slate-300')}
            style={tab === t.id ? { background: '#6366f1' } : {}}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* DEPARTMENTS */}
      {tab === 'departments' && (
        <div className="space-y-4">
          <div className="flex gap-2 max-w-md">
            <input
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDept()}
              placeholder="New department name…"
              className="flex-1 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            />
            <button onClick={addDept} className="flex items-center gap-1.5 px-4 rounded-lg text-sm font-medium text-white" style={gradient}>
              <Plus size={15} /> Create
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {departments.map((d) => {
              const members = users.filter((u) => u.departmentIds.includes(d.id))
              return (
                <div key={d.id} className="rounded-xl p-4" style={surface}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}>
                        <Building2 size={15} className="text-indigo-400" />
                      </div>
                      {editingDeptId === d.id ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input value={editingDeptName} onChange={(e) => setEditingDeptName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && renameDept(d.id, editingDeptName)} autoFocus
                            className="flex-1 min-w-0 rounded-md px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset} />
                          <button onClick={() => renameDept(d.id, editingDeptName)} className="p-1 rounded-md text-green-400 hover:bg-green-500/10"><Check size={14} /></button>
                          <button onClick={() => setEditingDeptId(null)} className="p-1 rounded-md text-slate-500 hover:bg-white/5"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{d.name}</div>
                          <div className="text-xs text-slate-500">{members.length} member{members.length === 1 ? '' : 's'} · {d.themeIds.length} view{d.themeIds.length === 1 ? '' : 's'}</div>
                        </div>
                      )}
                    </div>
                    {editingDeptId !== d.id && (
                      <div className="flex items-center flex-shrink-0">
                        <button onClick={() => { setEditingDeptId(d.id); setEditingDeptName(d.name) }} className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-400 hover:bg-white/5">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => removeDept(d.id)} className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/5">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {members.length ? members.map((m) => (
                      <span key={m.id} className="text-[10px] px-2 py-0.5 rounded-md text-slate-300" style={inset}>{m.name}</span>
                    )) : <span className="text-xs text-slate-600">No users assigned</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* USERS */}
      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowNewUser(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
              <Plus size={15} /> New User
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                  {['User', 'Username', 'Role', 'Departments', 'Status', ''].map((h) => (
                    <th key={h} className="py-3 px-4 text-left text-xs text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: '#0d1117' }}>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #1e2433' }}>
                    <td className="py-3 px-4">
                      <div className="text-white font-medium">{u.name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-xs">{u.username}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={roleColor[u.role]}>{roleLabels[u.role]}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">
                      {u.departmentIds.length ? u.departmentIds.map(deptName).join(', ') : <span className="text-slate-600">org-level</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className={clsx('text-xs font-medium capitalize', u.status === 'active' ? 'text-green-400' : u.status === 'invited' ? 'text-amber-400' : 'text-slate-500')}>{u.status}</span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button onClick={() => setEditingUser(u)} className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-white/5"><Pencil size={13} /></button>
                      <button onClick={() => removeUser(u.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ROLES */}
      {tab === 'roles' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ROLES.map((r) => {
            const count = users.filter((u) => u.role === r).length
            const perms: Record<ManagedRole, string[]> = {
              admin: ['Manage departments & users', 'Assign roles & organize', 'Configure devices & alarms', 'Full dashboard access'],
              editor: ['Edit device settings', 'Acknowledge alarms', 'Export & schedule reports', 'View all assigned dashboards'],
              viewer: ['Read-only dashboards', 'Acknowledge alarms', 'View & export device graphs', 'Receive notifications'],
            }
            return (
              <div key={r} className="rounded-xl p-5" style={surface}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold capitalize px-2.5 py-1 rounded-full" style={roleColor[r]}>{roleLabels[r]}</span>
                  <span className="text-xs text-slate-500">{count} user{count === 1 ? '' : 's'}</span>
                </div>
                <ul className="space-y-1.5">
                  {perms[r].map((p) => (
                    <li key={p} className="flex items-center gap-2 text-xs text-slate-400"><Check size={12} className="text-indigo-400 flex-shrink-0" /> {p}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {/* PERMISSIONS */}
      {tab === 'permissions' && (
        <DashboardPermissions orgId={orgId} departments={departments} setDepartments={setDepartments} users={users} />
      )}

      {/* PRODUCT ACCESS */}
      {tab === 'products' && (
        <ProductAccess orgId={orgId} departments={departments} setDepartments={setDepartments} users={users} />
      )}

      {/* EVENT CATALOG */}
      {tab === 'events' && (
        <EventCatalog departments={departments} />
      )}

      {(editingUser || showNewUser) && (
        <UserModal
          user={editingUser}
          departments={departments}
          orgId={orgId}
          onClose={() => { setEditingUser(null); setShowNewUser(false) }}
          onSave={(u) => { upsertUser(u); setEditingUser(null); setShowNewUser(false) }}
        />
      )}
    </div>
  )
}

// ---- Dashboard View Permission tab ----------------------------------------
function DashboardPermissions({ orgId, departments, setDepartments, users }: {
  orgId: string
  departments: Department[]
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>
  users: ManagedUser[]
}) {
  const [selectedDept, setSelectedDept] = useState(departments[0]?.id ?? '')
  const dept = departments.find((d) => d.id === selectedDept)

  // Only themes the SUPER ADMIN has granted to this organization are selectable.
  const grantedIds = getOrgThemeGrants(orgId)
  const availableThemes = dashboardThemes.filter((t) => grantedIds.includes(t.id))

  const toggleTheme = (themeId: string) => {
    if (!grantedIds.includes(themeId)) return
    setDepartments((prev) => prev.map((d) => d.id !== selectedDept ? d : {
      ...d,
      themeIds: d.themeIds.includes(themeId) ? d.themeIds.filter((t) => t !== themeId) : [...d.themeIds, themeId],
    }))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* department + users in department selection */}
      <div className="rounded-xl p-4" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-3">Department</h3>
        <div className="space-y-1.5">
          {departments.map((d) => (
            <button key={d.id} onClick={() => setSelectedDept(d.id)}
              className={clsx('w-full text-left px-3 py-2 rounded-lg text-sm transition-all', selectedDept === d.id ? 'text-white' : 'text-slate-400 hover:bg-white/5')}
              style={selectedDept === d.id ? { background: 'rgba(99,102,241,0.15)' } : {}}>
              {d.name}
            </button>
          ))}
        </div>
        {dept && (
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid #1e2433' }}>
            <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Users in department</div>
            <div className="flex flex-wrap gap-1.5">
              {users.filter((u) => u.departmentIds.includes(dept.id)).map((u) => (
                <span key={u.id} className="text-[10px] px-2 py-0.5 rounded-md text-slate-300" style={inset}>{u.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* theme selection (multiple) */}
      <div className="rounded-xl p-4 lg:col-span-2" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-1">Dashboard Themes <span className="text-slate-500 font-normal">(select multiple)</span></h3>
        <p className="text-xs text-slate-500 mb-1">Themes enabled here become visible to every user in {dept?.name ?? 'this department'}.</p>
        <p className="text-[11px] text-slate-600 mb-3 flex items-center gap-1.5">
          <Palette size={12} className="text-violet-400" />
          The themes available to your organization are managed by Super Admin.
        </p>
        {availableThemes.length === 0 ? (
          <div className="p-4 rounded-lg text-xs text-slate-500" style={inset}>
            No dashboard themes have been granted to your organization yet. Contact your Super Admin to enable themes.
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {availableThemes.map((th) => {
            const on = dept?.themeIds.includes(th.id)
            return (
              <button key={th.id} onClick={() => toggleTheme(th.id)} className="flex items-center justify-between p-3 rounded-lg text-left transition-all"
                style={{ background: '#0a0e1a', border: `1px solid ${on ? th.accent : '#1e2433'}` }}>
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">{th.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{th.description}</div>
                </div>
                {on ? <ToggleRight size={22} style={{ color: th.accent }} /> : <ToggleLeft size={22} className="text-slate-600" />}
              </button>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}

// ---- Product Access per department -----------------------------------------
// Admin assigns which licensed products each department's users can See / Manage.
function ProductAccess({ orgId, departments, setDepartments, users }: {
  orgId: string
  departments: Department[]
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>
  users: ManagedUser[]
}) {
  const domains = licensedDomains(orgId)

  const setAccess = (deptId: string, domain: SensorDomain, level: 'none' | 'view' | 'manage') => {
    setDepartments((prev) => prev.map((d) => {
      if (d.id !== deptId) return d
      const pa = { ...(d.productAccess ?? {}) }
      if (level === 'none') delete pa[domain]
      else pa[domain] = level
      return { ...d, productAccess: pa }
    }))
  }

  const LEVELS = [
    { id: 'none', label: 'None', icon: Ban, color: '#475569' },
    { id: 'view', label: 'View', icon: Eye, color: '#06b6d4' },
    { id: 'manage', label: 'Manage', icon: Settings2, color: '#22c55e' },
  ] as const

  if (!domains.length) {
    return <div className="rounded-xl p-4 text-sm text-slate-500" style={inset}>This organization has no licensed products yet.</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Choose which licensed products each department can access. <span className="text-cyan-400">View</span> = users can open the monitoring view; <span className="text-green-400">Manage</span> = view &amp; control. Applies to every user in the department.
      </p>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
              <th className="py-3 px-4 text-left text-xs text-slate-500 font-medium">Department</th>
              {domains.map((d) => (
                <th key={d} className="py-3 px-4 text-left text-xs font-medium" style={{ color: DOMAIN_META[d].accent }}>{DOMAIN_META[d].platform}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background: '#0d1117' }}>
            {departments.map((dept) => {
              const members = users.filter((u) => u.departmentIds.includes(dept.id)).length
              return (
                <tr key={dept.id} style={{ borderBottom: '1px solid #1e2433' }}>
                  <td className="py-3 px-4">
                    <div className="text-white font-medium">{dept.name}</div>
                    <div className="text-[10px] text-slate-600">{members} user{members === 1 ? '' : 's'}</div>
                  </td>
                  {domains.map((domain) => {
                    const current = dept.productAccess?.[domain] ?? 'none'
                    return (
                      <td key={domain} className="py-3 px-4">
                        <div className="flex gap-1">
                          {LEVELS.map((lv) => {
                            const on = current === lv.id
                            return (
                              <button key={lv.id} onClick={() => setAccess(dept.id, domain, lv.id)} title={lv.label}
                                className={clsx('flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all', on ? 'text-white' : 'text-slate-500')}
                                style={on ? { background: `${lv.color}26`, border: `1px solid ${lv.color}` } : { background: '#0a0e1a', border: '1px solid #1e2433' }}>
                                <lv.icon size={11} /> {lv.label}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- Per-department Event Catalog (CRUD) -----------------------------------
// Admin manages each department's own eventProblem list — the catalog that
// populates the viewer's detailed-monitoring event dropdown.
function EventCatalog({ departments }: { departments: Department[] }) {
  const [selectedDept, setSelectedDept] = useState(departments[0]?.id ?? '')
  const [catalog, setCatalog] = useState<Record<string, EventProblem[]>>(
    () => Object.fromEntries(departments.map((d) => [d.id, getEventProblemsByDept(d.id).map((e) => ({ ...e }))])),
  )
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const list = catalog[selectedDept] ?? []
  const update = (next: EventProblem[]) => setCatalog((c) => ({ ...c, [selectedDept]: next }))

  const add = () => {
    if (!draft.trim()) return
    update([...list, { id: `ev-${selectedDept}-${Date.now()}`, label: draft.trim(), departmentId: selectedDept }])
    setDraft(''); toast.success('Event added')
  }
  const remove = (id: string) => { update(list.filter((e) => e.id !== id)); toast.success('Event removed') }
  const startEdit = (e: EventProblem) => { setEditingId(e.id); setEditingLabel(e.label) }
  const saveEdit = () => {
    if (!editingLabel.trim()) return
    update(list.map((e) => (e.id === editingId ? { ...e, label: editingLabel.trim() } : e)))
    setEditingId(null); setEditingLabel(''); toast.success('Event updated')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Department picker */}
      <div className="rounded-xl p-4" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-3">Department</h3>
        <div className="space-y-1.5">
          {departments.map((d) => (
            <button key={d.id} onClick={() => setSelectedDept(d.id)}
              className={clsx('w-full text-left px-3 py-2 rounded-lg text-sm transition-all', selectedDept === d.id ? 'text-white' : 'text-slate-400 hover:bg-white/5')}
              style={selectedDept === d.id ? { background: 'rgba(99,102,241,0.15)' } : {}}>
              {d.name}
              <span className="text-[10px] text-slate-600 ml-1.5">{(catalog[d.id] ?? []).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Event list CRUD */}
      <div className="rounded-xl p-5 lg:col-span-2 space-y-3" style={surface}>
        <h3 className="text-sm font-semibold text-white">Event Problem Catalog</h3>
        <p className="text-[11px] text-slate-500">These problem types appear in the event-log dropdown for users in this department.</p>

        <div className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="New event problem…"
            className="flex-1 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
          <button onClick={add} className="flex items-center gap-1.5 px-4 rounded-lg text-sm font-medium text-white" style={gradient}><Plus size={15} /> Add</button>
        </div>

        <div className="space-y-1.5">
          {list.map((e) => (
            <div key={e.id} className="flex items-center gap-2 p-2.5 rounded-lg" style={inset}>
              {editingId === e.id ? (
                <>
                  <input value={editingLabel} onChange={(ev) => setEditingLabel(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && saveEdit()}
                    className="flex-1 rounded-md px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500" style={{ background: '#0d1117', border: '1px solid #1e2433' }} autoFocus />
                  <button onClick={saveEdit} className="p-1.5 rounded-md text-green-400 hover:bg-green-500/10"><Check size={14} /></button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 rounded-md text-slate-500 hover:bg-white/5"><X size={14} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-slate-200">{e.label}</span>
                  <button onClick={() => startEdit(e)} className="p-1.5 rounded-md text-slate-500 hover:text-indigo-400 hover:bg-white/5"><Pencil size={13} /></button>
                  <button onClick={() => remove(e.id)} className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/5"><Trash2 size={13} /></button>
                </>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-xs text-slate-600 py-2">No event problems yet — add one above.</p>}
        </div>
      </div>
    </div>
  )
}

// ---- User create/edit modal ------------------------------------------------
function UserModal({ user, departments, orgId, onClose, onSave }: {
  user: ManagedUser | null
  departments: Department[]
  orgId: string
  onClose: () => void
  onSave: (u: ManagedUser) => void
}) {
  const [form, setForm] = useState<ManagedUser>(
    user ?? { id: `u-${Date.now()}`, orgId, name: '', username: '', email: '', role: 'viewer', departmentIds: [], status: 'invited' }
  )
  const toggleDept = (id: string) =>
    setForm((f) => ({ ...f, departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((d) => d !== id) : [...f.departmentIds, id] }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">{user ? 'Edit User' : 'New User'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Full Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <LabeledInput label="Username" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))} />
          </div>
          <LabeledInput label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Role (assign roll)</label>
            <div className="flex gap-2">
              {ROLES.map((r) => (
                <button key={r} onClick={() => setForm((f) => ({ ...f, role: r }))}
                  className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all', form.role === r ? 'text-white' : 'text-slate-500')}
                  style={form.role === r ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                  {roleLabels[r]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Assign Departments (organize)</label>
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => {
                const on = form.departmentIds.includes(d.id)
                return (
                  <button key={d.id} onClick={() => toggleDept(d.id)}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all', on ? 'text-white' : 'text-slate-400')}
                    style={on ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : inset}>
                    {d.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button onClick={() => onSave(form)} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white" style={gradient}>Save</button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
    </div>
  )
}
