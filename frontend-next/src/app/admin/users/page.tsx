'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { api, isLive } from '@/lib/api'
import {
  departments as seedDepartments,
  managedUsers as seedUsers,
  dashboardThemes,
  roleLabels,
  getEventProblemsByDept,
} from '@/lib/orgData'
import { getOrgThemeGrants, fetchOrgThemeGrants } from '@/lib/orgThemes'
import { licensedDomains, DOMAIN_TO_PLATFORM } from '@/lib/entitlements'
import { useManagedDevices } from '@/lib/useManagedDevices'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { Department, ManagedUser, ManagedRole, EventProblem } from '@/types/org'
import {
  Users, Building2, Palette, Plus, Trash2, X, Check, Boxes,
  ToggleLeft, ToggleRight, Pencil, Eye, EyeOff, Settings2, Ban, ListChecks, Upload, FileSpreadsheet, MapPin, HardDrive,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { generatePassword } from '@/lib/password'

type Tab = 'departments' | 'users' | 'permissions' | 'products' | 'devices' | 'events'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'departments', label: 'Departments', icon: Building2 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'permissions', label: 'Dashboard View Permission', icon: Palette },
  { id: 'products', label: 'Product Access', icon: Boxes },
  // Per-USER device restriction (migrate-v42). Sits next to Product Access
  // because they are the two per-person narrowings — that one by product
  // line, this one by individual device.
  { id: 'devices', label: 'Device Access', icon: HardDrive },
  { id: 'events', label: 'Event Catalog', icon: ListChecks },
]

// 'editor' is a real value in ManagedRole/roleLabels/roleColor (existing users
// can already have it, so those stay renderable), but the backend's guard()
// only ever distinguishes admin/superadmin from viewer-or-customer — an
// 'editor' account is neither, so it fell through with no defined behaviour.
// Not offered as an assignable role here.
const ROLES: ManagedRole[] = ['admin', 'viewer']

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

  // Live load from the backend (departments + users) when an API is configured.
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.departments(orgId).then((rows) => {
      if (cancelled || !rows) return
      // themeIds are filled from department_themes by the permissions tab; a
      // hardcoded default here is what made the tab look configured when it was not.
      setDepartments((rows as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, orgId, name: r.name, themeIds: [] })))
    })
    api.users(orgId).then((rows) => {
      if (cancelled || !rows) return
      setUsers((rows as Array<{ id: string; name: string; email?: string; username?: string; role?: string; department_id?: string; department_ids?: string[] }>).map((r) => ({
        // username is a stored column now — fall back only for rows created
        // before migrate-v22, which have none yet.
        id: r.id, orgId, name: r.name, username: r.username || r.email || r.id, email: r.email || '',
        role: (r.role === 'admin' ? 'admin' : 'viewer'),
        // department_ids is the real set; the singular column is the pre-v25 shape.
        departmentIds: r.department_ids ?? (r.department_id ? [r.department_id] : []), status: 'active',
      })))
    })
    return () => { cancelled = true }
  }, [orgId])

  // ----- Departments -----
  const [newDept, setNewDept] = useState('')
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null)
  const [editingDeptName, setEditingDeptName] = useState('')
  // These used to update local state and fire the request without awaiting it,
  // so a rejected save (duplicate, lost session, backend down) still looked like
  // it worked until the next reload silently dropped it.
  const dupDept = (name: string, exceptId?: string) =>
    departments.some((d) => d.id !== exceptId && d.name.trim().toLowerCase() === name.trim().toLowerCase())

  const addDept = async () => {
    const name = newDept.trim()
    if (!name) return
    if (dupDept(name)) { toast.error(`“${name}” already exists`); return }
    const id = `dept-${Date.now()}`
    if (isLive()) {
      const r = await api.saveDepartment(orgId, { id, name })
      if (!r) { toast.error('Could not create the department'); return }
    }
    setDepartments((d) => [...d, { id, orgId, name, themeIds: ['th-overview'] }])
    setNewDept('')
  }
  const renameDept = async (id: string, raw: string) => {
    const name = raw.trim()
    if (!name) return
    if (dupDept(name, id)) { toast.error(`“${name}” already exists`); return }
    if (isLive()) {
      const r = await api.saveDepartment(orgId, { id, name })
      if (!r) { toast.error('Could not rename the department'); return }
    }
    setDepartments((d) => d.map((x) => (x.id === id ? { ...x, name } : x)))
    setEditingDeptId(null); setEditingDeptName('')
  }
  const removeDept = async (id: string) => {
    const dept = departments.find((d) => d.id === id)
    const members = users.filter((u) => u.departmentIds.includes(id))
    // Deleting a department un-scopes its people; say so before it happens
    // rather than after they lose their product access.
    const msg = members.length
      ? `Delete “${dept?.name}”? ${members.length} user${members.length === 1 ? '' : 's'} will be left without a department.`
      : `Delete “${dept?.name}”?`
    if (!window.confirm(msg)) return
    if (isLive()) {
      const r = await api.deleteDepartment(id)
      if (!r) { toast.error('Could not delete the department'); return }
    }
    setDepartments((d) => d.filter((x) => x.id !== id))
    setUsers((u) => u.map((x) => ({ ...x, departmentIds: x.departmentIds.filter((dd) => dd !== id) })))
    toast.success('Department deleted')
  }

  // ----- Users -----
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)
  const [showNewUser, setShowNewUser] = useState(false)

  const upsertUser = async (u: ManagedUser) => {
    if (isLive()) {
      const r = await api.saveUser(orgId, { id: u.id, email: u.email, username: u.username, name: u.name, role: u.role, departmentId: u.departmentIds[0], departmentIds: u.departmentIds, password: u.password })
      // null covers the 409 the backend returns when the username is taken —
      // the one failure an admin can actually act on.
      if (!r) { toast.error('Could not save the user — the username or email may already be in use'); return }
    }
    setUsers((prev) => (prev.some((x) => x.id === u.id) ? prev.map((x) => (x.id === u.id ? u : x)) : [...prev, u]))
    setEditingUser(null); setShowNewUser(false)
  }
  const removeUser = (id: string) => { setUsers((u) => u.filter((x) => x.id !== id)); if (isLive()) api.deleteUser(id) }

  // ----- Employee Directory (CSV allowlist) -----
  const [directory, setDirectory] = useState<any[]>([])
  const [dirLoading, setDirLoading] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isLive()) return
    api.getDirectory(orgId).then((rows) => { if (rows) setDirectory(rows) })
  }, [orgId])

  const handleCSV = (file?: File) => {
    if (!file) return
    setDirLoading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const text = reader.result as string
      const lines = text.split(/\r?\n/).filter(Boolean)
      if (lines.length < 2) { toast.error('CSV must have a header row + data'); setDirLoading(false); return }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const nameIdx = headers.findIndex(h => h === 'name' || h === 'ชื่อ' || h === 'ชื่อ-นามสกุล')
      const emailIdx = headers.findIndex(h => h === 'email' || h === 'อีเมล')
      const phoneIdx = headers.findIndex(h => h === 'phone' || h === 'เบอร์โทร' || h === 'tel')
      const deptIdx = headers.findIndex(h => h === 'department' || h === 'แผนก' || h === 'dept')

      const rows = lines.slice(1).map(line => {
        const cols = line.split(',')
        const deptName = deptIdx >= 0 ? cols[deptIdx]?.trim() : undefined
        const deptMatch = deptName ? departments.find(d => d.name.toLowerCase() === deptName.toLowerCase()) : undefined
        return {
          name: nameIdx >= 0 ? cols[nameIdx]?.trim() : undefined,
          email: emailIdx >= 0 ? cols[emailIdx]?.trim() : undefined,
          phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() : undefined,
          departmentId: deptMatch?.id ?? undefined,
        }
      }).filter(r => r.name || r.email || r.phone)

      const res = await api.uploadDirectory(orgId, rows, true)
      if (res) {
        toast.success(`Imported ${res.imported} employee records`)
        const fresh = await api.getDirectory(orgId)
        if (fresh) setDirectory(fresh)
      } else {
        toast.error('Failed to upload directory')
      }
      setDirLoading(false)
    }
    reader.readAsText(file)
  }

  const clearDir = async () => {
    await api.clearDirectory(orgId)
    setDirectory([])
    toast.success('Directory cleared')
  }

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
        <div className="space-y-5">
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleCSV(e.target.files?.[0])} />
              <button onClick={() => csvRef.current?.click()} disabled={dirLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1' }}>
                <Upload size={15} /> {dirLoading ? 'Importing…' : 'Upload CSV Directory'}
              </button>
              {directory.length > 0 && (
                <button onClick={clearDir} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-red-400" style={inset}>
                  <Trash2 size={13} /> Clear Directory
                </button>
              )}
            </div>
            <button onClick={() => setShowNewUser(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={gradient}>
              <Plus size={15} /> New User
            </button>
          </div>

          {/* Employee Directory (allowlist) */}
          {directory.length > 0 && (
            <div className="rounded-xl p-4" style={surface}>
              <div className="flex items-center gap-2 mb-3">
                <FileSpreadsheet size={15} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Employee Directory</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>{directory.length} records</span>
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e2433' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                      {['Name', 'Email', 'Phone', 'Department'].map(h => (
                        <th key={h} className="py-2 px-3 text-left text-xs text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ background: '#0d1117' }}>
                    {directory.slice(0, 20).map((d: any) => (
                      <tr key={d.id} style={{ borderBottom: '1px solid #1e2433' }}>
                        <td className="py-2 px-3 text-slate-200 text-xs">{d.name || '—'}</td>
                        <td className="py-2 px-3 text-slate-400 text-xs">{d.email || '—'}</td>
                        <td className="py-2 px-3 text-slate-400 text-xs">{d.phone || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 text-xs">{d.department_id ? deptName(d.department_id) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {directory.length > 20 && <div className="text-xs text-slate-600 text-center py-2">… and {directory.length - 20} more</div>}
              </div>
              <p className="text-[10px] text-slate-600 mt-2">CSV format: Name, Email, Phone, Department — self-registering users matching these records will auto-join as viewers.</p>
            </div>
          )}

          {/* User table */}
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

      {/* PERMISSIONS */}
      {tab === 'permissions' && (
        <DashboardPermissions orgId={orgId} departments={departments} setDepartments={setDepartments} users={users} />
      )}

      {/* PRODUCT ACCESS */}
      {tab === 'products' && (
        <ProductAccess orgId={orgId} departments={departments} setDepartments={setDepartments} users={users} setUsers={setUsers} />
      )}

      {/* PER-USER DEVICE ACCESS */}
      {tab === 'devices' && (
        <DeviceAccess orgId={orgId} users={users} />
      )}

      {/* EVENT CATALOG */}
      {tab === 'events' && (
        <EventCatalog orgId={orgId} departments={departments} />
      )}

      {(editingUser || showNewUser) && (
        <UserModal
          user={editingUser}
          departments={departments}
          setDepartments={setDepartments}
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

  // Departments arrive from the users endpoint without their themes (that is a
  // separate table); merge the stored policy in once it lands.
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.departmentThemes(orgId).then((byDept) => {
      if (cancelled || !byDept) return
      setDepartments((ds) => ds.map((d) => (byDept[d.id] ? { ...d, themeIds: byDept[d.id] } : { ...d, themeIds: [] })))
    })
    return () => { cancelled = true }
  }, [orgId, setDepartments])

  // ---- Sites a department may see -----------------------------------------
  // Themes decide WHICH SCREENS a team gets; this decides WHICH PLACES. A
  // customer running a dozen plants had every viewer seeing every plant, because
  // the fleet query — which also drives the map, the floor plans and the alarm
  // feed — filtered by organization and department but never by site.
  const [sites, setSites] = useState<{ id: string; name: string }[]>([])
  const [deptSites, setDeptSites] = useState<Record<string, string[]>>({})
  const [savingSites, setSavingSites] = useState(false)
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.sites(orgId).then((r) => { if (!cancelled && r) setSites(r.sites ?? []) })
    api.departmentSites(orgId).then((r) => { if (!cancelled && r) setDeptSites(r) })
    return () => { cancelled = true }
  }, [orgId])

  const toggleSite = async (siteId: string) => {
    if (!dept) return
    const cur = deptSites[dept.id] ?? []
    const next = cur.includes(siteId) ? cur.filter((s) => s !== siteId) : [...cur, siteId]
    setDeptSites((m) => ({ ...m, [dept.id]: next }))
    if (!isLive()) return
    setSavingSites(true)
    const r = await api.setDepartmentSites(orgId, dept.id, next)
    setSavingSites(false)
    if (!r) {
      setDeptSites((m) => ({ ...m, [dept.id]: cur }))
      toast.error('Could not save the site permission')
    }
  }
  const selectedSites = dept ? (deptSites[dept.id] ?? []) : []

  // Only themes the SUPER ADMIN has granted to this organization are selectable.
  // This read a frontend const covering org-1/2/3, so every other organization
  // fell back to ['th-overview'] and its admin saw a one-row tab no matter what
  // the super admin had actually granted.
  const [grantedIds, setGrantedIds] = useState<string[]>(() => getOrgThemeGrants(orgId))
  useEffect(() => {
    let cancelled = false
    fetchOrgThemeGrants(orgId).then((ids) => { if (!cancelled) setGrantedIds(ids) })
    return () => { cancelled = true }
  }, [orgId])
  const availableThemes = dashboardThemes.filter((t) => grantedIds.includes(t.id))

  // The toggle used to change React state only, so the whole tab reverted on
  // reload — it described a permission policy the backend never had. It writes
  // the department's theme set through now, and rolls back if that fails.
  const toggleTheme = async (themeId: string) => {
    if (!grantedIds.includes(themeId) || !dept) return
    const next = dept.themeIds.includes(themeId)
      ? dept.themeIds.filter((t) => t !== themeId)
      : [...dept.themeIds, themeId]
    const prev = dept.themeIds
    setDepartments((ds) => ds.map((d) => (d.id !== selectedDept ? d : { ...d, themeIds: next })))
    if (isLive()) {
      const r = await api.setDepartmentThemes(orgId, selectedDept, next)
      if (!r) {
        setDepartments((ds) => ds.map((d) => (d.id !== selectedDept ? d : { ...d, themeIds: prev })))
        toast.error('Could not save the dashboard permission')
      }
    }
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

      {/* Sites this department may see */}
      <div className="rounded-xl p-4 lg:col-span-3" style={surface}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <MapPin size={14} className="text-cyan-400" /> Sites
          <span className="text-slate-500 font-normal">(select multiple)</span>
          {savingSites && <span className="text-[10px] text-slate-600">saving…</span>}
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          {selectedSites.length === 0 ? (
            <>
              <span className="text-amber-400">No restriction.</span> Everyone in {dept?.name ?? 'this department'} sees
              devices, maps, floor plans and alarms at <span className="text-slate-300">every</span> site. Pick sites to
              limit them; clearing the selection removes the limit again.
            </>
          ) : (
            <>
              {dept?.name ?? 'This department'} sees only the {selectedSites.length} selected
              site{selectedSites.length === 1 ? '' : 's'} — in the device list, the sensor map, the floor plans and the
              alarm feed. A device not assigned to any site stays visible to everyone.
            </>
          )}
        </p>
        {sites.length === 0 ? (
          <div className="p-4 rounded-lg text-xs text-slate-500" style={inset}>
            This organization has no sites yet. Add them from a device’s Site panel or the Sites page, then come back to
            decide who sees which.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sites.map((st) => {
              const on = selectedSites.includes(st.id)
              return (
                <button key={st.id} onClick={() => toggleSite(st.id)} disabled={!dept}
                  className="flex items-center justify-between p-3 rounded-lg text-left transition-all disabled:opacity-40"
                  style={{ background: '#0a0e1a', border: `1px solid ${on ? '#06b6d4' : '#1e2433'}` }}>
                  <span className="text-sm text-slate-200 truncate">{st.name}</span>
                  {on ? <ToggleRight size={22} style={{ color: '#06b6d4' }} /> : <ToggleLeft size={22} className="text-slate-600" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Per-user device access (migrate-v42) -----------------------------------
//
// The per-PERSON view of node_user_visibility; the device page
// (DepartmentAccessEditor) is the per-DEVICE view onto the same table. This
// one is the primary editor because the thing an admin actually decides is
// "which devices may this contractor see", and only here can they see that
// whole list at once.
//
// RESTRICT-ONLY, and the copy has to keep saying so: a device ticked here is
// still hidden unless the person's department could see it anyway. Ticking
// nothing is not "sees nothing" — it is "no restriction".
function DeviceAccess({ orgId, users }: { orgId: string; users: ManagedUser[] }) {
  const { devices } = useManagedDevices(orgId)
  const [byUser, setByUser] = useState<Record<string, string[]> | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isLive()) { setByUser({}); return }
    let cancelled = false
    api.nodeVisibility(orgId).then((r) => {
      if (cancelled) return
      setByUser(r?.byUser ?? {})
      setPending(r?.pending ?? null)
    })
    return () => { cancelled = true }
  }, [orgId])

  // Admins are never restricted by this table (accessFor skips it for them),
  // so offering the control for them would be a switch that does nothing.
  const scopable = users.filter((u) => u.role !== 'admin')
  useEffect(() => {
    if (scopable.length && !scopable.some((u) => u.id === selectedUser)) setSelectedUser(scopable[0]?.id ?? '')
  }, [scopable, selectedUser])

  const current = byUser?.[selectedUser] ?? []
  const restricted = current.length > 0

  const save = async (nodeIds: string[]) => {
    if (!selectedUser) return
    setSaving(true)
    const r = await api.setUserVisibleNodes(selectedUser, nodeIds)
    setSaving(false)
    if (!r?.ok) { toast.error('Could not save device access'); return }
    setByUser((m) => ({ ...(m ?? {}), [selectedUser]: nodeIds }))
    toast.success(nodeIds.length === 0 ? 'Restriction cleared — sees everything their department allows' : `Limited to ${nodeIds.length} device${nodeIds.length === 1 ? '' : 's'}`)
  }
  const toggle = (nodeId: string) => save(current.includes(nodeId) ? current.filter((x) => x !== nodeId) : [...current, nodeId])

  return (
    <div className="rounded-xl p-5 space-y-4" style={surface}>
      <div>
        <h3 className="text-sm font-semibold text-white">Device Access</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Limit one person to specific devices. This only <span className="text-slate-300">narrows</span> what their
          department already allows — it can never grant a device their department cannot see.
        </p>
      </div>

      {pending && (
        <p className="text-[11px] text-amber-400">Needs {pending} — run the migration before using this.</p>
      )}

      {scopable.length === 0 ? (
        <p className="text-xs text-slate-600">No non-admin users yet. Admins always see every device in the organization.</p>
      ) : (
        <>
          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Person</label>
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full max-w-sm rounded-lg px-3 py-2 text-sm text-white outline-none" style={inset}>
              {scopable.map((u) => {
                const n = byUser?.[u.id]?.length ?? 0
                return <option key={u.id} value={u.id}>{u.name || u.email || u.id}{n > 0 ? ` — limited to ${n}` : ' — not restricted'}</option>
              })}
            </select>
          </div>

          <div className="rounded-lg p-3" style={inset}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs text-slate-400">
                {restricted
                  ? `Limited to ${current.length} of ${devices.length} device${devices.length === 1 ? '' : 's'}`
                  : `Not restricted — sees all ${devices.length} device${devices.length === 1 ? '' : 's'} their department allows`}
              </span>
              {restricted && (
                <button onClick={() => save([])} disabled={saving}
                  className="text-[11px] text-slate-400 hover:text-white disabled:opacity-50">
                  Clear restriction
                </button>
              )}
            </div>
            {devices.length === 0 ? (
              <p className="text-xs text-slate-600">No devices in this organization yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
                {devices.map((d) => {
                  const on = current.includes(d.id)
                  return (
                    <button key={d.id} onClick={() => toggle(d.id)} disabled={saving}
                      className={clsx('flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-all disabled:opacity-50', on ? 'text-white' : 'text-slate-400')}
                      style={on ? { background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e' } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                      <span className="w-3 h-3 rounded-sm flex-shrink-0" style={on ? { background: '#22c55e' } : { border: '1px solid #334155' }} />
                      <span className="truncate">{d.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {!restricted && (
              <p className="text-[11px] text-amber-400/80 mt-2">
                Selecting the first device turns this person from unrestricted into restricted — from then on they see only
                what is ticked here.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---- Product Access per department -----------------------------------------
// Admin assigns which licensed products each department's users can See / Manage.
const ACCESS_RANK: Record<'none' | 'view' | 'manage', number> = { none: 0, view: 1, manage: 2 }

function ProductAccess({ orgId, departments, setDepartments, users, setUsers }: {
  orgId: string
  departments: Department[]
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>
  users: ManagedUser[]
  setUsers: React.Dispatch<React.SetStateAction<ManagedUser[]>>
}) {
  // Which product columns to show. licensedDomains() reads the static mock org
  // list (mockData.ts) — only org-1/2/3 are in it, so any real org provisioned
  // afterward (every org a superadmin actually creates) got "no licensed
  // products yet" here even with real org_entitlements rows, because
  // getOrg(orgId) came back undefined. Read the real entitlements instead;
  // mock stays only as the offline/demo fallback.
  const [domains, setDomains] = useState<SensorDomain[]>(() => licensedDomains(orgId))
  useEffect(() => {
    if (!isLive()) { setDomains(licensedDomains(orgId)); return }
    let cancelled = false
    api.entitlements(orgId).then((ents) => {
      if (cancelled || !ents) return
      setDomains((['transformer', 'carbonNode', 'bloodBox'] as SensorDomain[]).filter((d) => ents.includes(DOMAIN_TO_PLATFORM[d])))
    })
    return () => { cancelled = true }
  }, [orgId])
  const [scope, setScope] = useState<'dept' | 'user'>('dept')

  // This tab wrote but never read. Every cell rendered from React state that
  // started empty, so an admin who reloaded saw "None" on every department and
  // "Inherit" on every user regardless of what was stored — the screen forgot
  // the policy it had just saved, and re-saving from that blank view would
  // overwrite the real one.
  useEffect(() => {
    if (!isLive()) return
    let cancelled = false
    api.orgProductAccess(orgId).then((r) => {
      if (cancelled || !r) return
      setDepartments((ds) => ds.map((d) => ({ ...d, productAccess: (r.departments[d.id] ?? {}) as Department['productAccess'] })))
      setUsers((us) => us.map((u) => ({ ...u, productAccess: (r.users[u.id] ?? {}) as ManagedUser['productAccess'] })))
    })
    return () => { cancelled = true }
  }, [orgId, setDepartments, setUsers])

  const setAccess = async (deptId: string, domain: SensorDomain, level: 'none' | 'view' | 'manage') => {
    const prevPa = departments.find((d) => d.id === deptId)?.productAccess
    setDepartments((prev) => prev.map((d) => {
      if (d.id !== deptId) return d
      const pa = { ...(d.productAccess ?? {}) }
      // 'none' is stored, not deleted: a department is denied by default, and a
      // row saying so is what an admin sees when they come back.
      pa[domain] = level
      return { ...d, productAccess: pa }
    }))
    if (!isLive()) return
    const r = await api.setProductAccess({ scope: 'department', scopeId: deptId, domain, level })
    if (!r) {
      setDepartments((prev) => prev.map((d) => (d.id === deptId ? { ...d, productAccess: prevPa } : d)))
      toast.error('Could not save the product access')
    }
  }

  // department-derived level for a user (from local state)
  const deptLevel = (u: ManagedUser, domain: SensorDomain): 'none' | 'view' | 'manage' => {
    let best: 'none' | 'view' | 'manage' = 'none'
    for (const d of departments.filter((x) => u.departmentIds.includes(x.id))) {
      const l = d.productAccess?.[domain]
      if (l && ACCESS_RANK[l] > ACCESS_RANK[best]) best = l
    }
    return best
  }
  const effectiveLevel = (u: ManagedUser, domain: SensorDomain): 'none' | 'view' | 'manage' => {
    const dl = deptLevel(u, domain)
    const ov = u.productAccess?.[domain]
    if (ov === undefined) return dl
    return ACCESS_RANK[ov] < ACCESS_RANK[dl] ? ov : dl
  }
  const setUserAccess = async (userId: string, domain: SensorDomain, value: 'inherit' | 'none' | 'view' | 'manage') => {
    const prevPa = users.find((u) => u.id === userId)?.productAccess
    setUsers((prev) => prev.map((u) => {
      if (u.id !== userId) return u
      const pa = { ...(u.productAccess ?? {}) }
      if (value === 'inherit') delete pa[domain]
      else pa[domain] = value
      return { ...u, productAccess: pa }
    }))
    if (!isLive()) return
    // 'inherit' used to be sent as level:'none' — an explicit DENY row. Putting a
    // user back to "Inherit (dept: manage)" therefore locked them out of the
    // product their department grants, and the UI showed the opposite. It is the
    // absence of a row, so the backend deletes it.
    const r = await api.setProductAccess({ scope: 'user', scopeId: userId, domain, level: value })
    if (!r) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, productAccess: prevPa } : u)))
      toast.error('Could not save the product access')
    }
  }

  const LEVELS = [
    { id: 'none', label: 'None', icon: Ban, color: '#475569' },
    { id: 'view', label: 'View', icon: Eye, color: '#06b6d4' },
    { id: 'manage', label: 'Manage', icon: Settings2, color: '#22c55e' },
  ] as const
  const levelColor = (l: string) => (l === 'manage' ? '#22c55e' : l === 'view' ? '#06b6d4' : '#475569')

  if (!domains.length) {
    return <div className="rounded-xl p-4 text-sm text-slate-500" style={inset}>This organization has no licensed products yet.</div>
  }

  return (
    <div className="space-y-3">
      {/* scope toggle */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={inset}>
        {(['dept', 'user'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={clsx('px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all', scope === s ? 'text-white' : 'text-slate-500')}
            style={scope === s ? { background: '#6366f1' } : {}}>
            {s === 'dept' ? 'By Department' : 'By User'}
          </button>
        ))}
      </div>

      {scope === 'dept' ? (
        <>
          <p className="text-xs text-slate-500">
            Which licensed products each department can access. <span className="text-cyan-400">View</span> = open monitoring; <span className="text-green-400">Manage</span> = view &amp; control. Applies to every user in the department.
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
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Restrict access per individual user. <span className="text-slate-300">Inherit</span> uses the department grant; an explicit value can only <span className="text-amber-400">narrow</span> it (never exceed the department). The <span className="text-slate-300">effective</span> level is shown below each choice.
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#0a0e1a', borderBottom: '1px solid #1e2433' }}>
                  <th className="py-3 px-4 text-left text-xs text-slate-500 font-medium">User</th>
                  {domains.map((d) => (
                    <th key={d} className="py-3 px-4 text-left text-xs font-medium" style={{ color: DOMAIN_META[d].accent }}>{DOMAIN_META[d].platform}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: '#0d1117' }}>
                {users.filter((u) => u.role !== 'admin').map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #1e2433' }}>
                    <td className="py-3 px-4">
                      <div className="text-white font-medium">{u.name}</div>
                      <div className="text-[10px] text-slate-600">{u.departmentIds.map((id) => departments.find((d) => d.id === id)?.name).filter(Boolean).join(', ') || 'no dept'}</div>
                    </td>
                    {domains.map((domain) => {
                      const ov = u.productAccess?.[domain] ?? 'inherit'
                      const eff = effectiveLevel(u, domain)
                      const dl = deptLevel(u, domain)
                      return (
                        <td key={domain} className="py-3 px-4">
                          <select value={ov} onChange={(e) => setUserAccess(u.id, domain, e.target.value as 'inherit' | 'none' | 'view' | 'manage')}
                            className="rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500" style={inset}>
                            <option value="inherit">Inherit (dept: {dl})</option>
                            <option value="none">None</option>
                            <option value="view">View</option>
                            <option value="manage">Manage</option>
                          </select>
                          <div className="text-[10px] mt-1 font-medium" style={{ color: levelColor(eff) }}>→ {eff}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Per-department Event Catalog (CRUD) -----------------------------------
// Admin manages each department's own eventProblem list — the catalog that
// populates the viewer's detailed-monitoring event dropdown.
function EventCatalog({ orgId, departments }: { orgId: string; departments: Department[] }) {
  const [selectedDept, setSelectedDept] = useState(departments[0]?.id ?? '')
  const [catalog, setCatalog] = useState<Record<string, EventProblem[]>>(
    () => Object.fromEntries(departments.map((d) => [d.id, getEventProblemsByDept(d.id).map((e) => ({ ...e }))])),
  )
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  // Live catalog for the selected department (admin-managed root causes).
  useEffect(() => {
    if (!isLive() || !selectedDept) return
    let cancelled = false
    api.eventProblems(orgId, selectedDept).then((rows) => {
      if (cancelled || !rows) return
      setCatalog((c) => ({ ...c, [selectedDept]: rows.map((r) => ({ id: r.id, label: r.label, departmentId: selectedDept })) }))
    })
    return () => { cancelled = true }
  }, [orgId, selectedDept])

  const list = catalog[selectedDept] ?? []
  const update = (next: EventProblem[]) => setCatalog((c) => ({ ...c, [selectedDept]: next }))

  const add = () => {
    if (!draft.trim()) return
    const id = `ev-${selectedDept}-${Date.now()}`, label = draft.trim()
    update([...list, { id, label, departmentId: selectedDept }])
    setDraft(''); toast.success('Event added')
    if (isLive()) api.saveEventProblem({ id, orgId, departmentId: selectedDept, label })
  }
  const remove = (id: string) => { update(list.filter((e) => e.id !== id)); toast.success('Event removed'); if (isLive()) api.deleteEventProblem(id) }
  const startEdit = (e: EventProblem) => { setEditingId(e.id); setEditingLabel(e.label) }
  const saveEdit = () => {
    if (!editingLabel.trim()) return
    const label = editingLabel.trim()
    update(list.map((e) => (e.id === editingId ? { ...e, label } : e)))
    if (isLive() && editingId) api.saveEventProblem({ id: editingId, orgId, departmentId: selectedDept, label })
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
function UserModal({ user, departments, setDepartments, orgId, onClose, onSave }: {
  user: ManagedUser | null
  departments: Department[]
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>
  orgId: string
  onClose: () => void
  onSave: (u: ManagedUser) => void
}) {
  const [form, setForm] = useState<ManagedUser>(
    user ?? { id: `u-${Date.now()}`, orgId, name: '', username: '', email: '', role: 'viewer', departmentIds: [], status: 'invited' }
  )
  const [touched, setTouched] = useState(false)
  // Blank on EDIT means "leave the password alone"; on CREATE it means the
  // account would have no password_hash and could never sign in, so it is
  // required there.
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const pwOk = user ? (!password || password.length >= 8) : password.length >= 8
  const valid = !!form.name.trim() && !!form.username.trim() && EMAIL_RE.test(form.email.trim()) && pwOk
  const toggleDept = (id: string) =>
    setForm((f) => ({ ...f, departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((d) => d !== id) : [...f.departmentIds, id] }))

  // Dashboard View Permission is a per-DEPARTMENT policy (department_themes),
  // set on its own tab elsewhere on this page — but the outer `departments`
  // list only carries real themeIds once that other tab has actually been
  // opened (its useEffect is what fetches them). Opening New/Edit User first
  // showed every department as having zero themes, whether or not that was
  // true. Fetched here too so an admin assigning a department can see and
  // edit what dashboards that department gets without leaving this modal.
  const [grantedThemeIds, setGrantedThemeIds] = useState<string[]>(() => getOrgThemeGrants(orgId))
  const [themesLoaded, setThemesLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchOrgThemeGrants(orgId).then((ids) => { if (!cancelled) setGrantedThemeIds(ids) })
    if (!isLive()) { setThemesLoaded(true); return () => { cancelled = true } }
    api.departmentThemes(orgId).then((byDept) => {
      if (cancelled || !byDept) { setThemesLoaded(true); return }
      setDepartments((ds) => ds.map((d) => (byDept[d.id] ? { ...d, themeIds: byDept[d.id] } : d)))
      setThemesLoaded(true)
    })
    return () => { cancelled = true }
  }, [orgId, setDepartments])
  const availableThemes = dashboardThemes.filter((t) => grantedThemeIds.includes(t.id))

  // Saves the DEPARTMENT's theme set immediately (same write the Dashboard
  // View Permission tab makes) — this toggle does not belong to the user
  // record being edited here, it belongs to whichever department(s) that
  // user is in, same as it does on the other tab.
  const [savingTheme, setSavingTheme] = useState<string | null>(null)
  const toggleDeptTheme = async (deptId: string, themeId: string) => {
    const dept = departments.find((d) => d.id === deptId)
    if (!dept || !grantedThemeIds.includes(themeId)) return
    const next = dept.themeIds.includes(themeId) ? dept.themeIds.filter((t) => t !== themeId) : [...dept.themeIds, themeId]
    const prev = dept.themeIds
    setDepartments((ds) => ds.map((d) => (d.id !== deptId ? d : { ...d, themeIds: next })))
    if (!isLive()) return
    setSavingTheme(deptId)
    const r = await api.setDepartmentThemes(orgId, deptId, next)
    setSavingTheme(null)
    if (!r) {
      setDepartments((ds) => ds.map((d) => (d.id !== deptId ? d : { ...d, themeIds: prev })))
      toast.error('Could not save the dashboard permission')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl" style={surface}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #1e2433' }}>
          <h2 className="text-base font-bold text-white">{user ? 'Edit User' : 'New User'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Full Name" required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              error={touched && !form.name.trim() ? 'Required' : undefined} />
            {/* Not independently editable — kept equal to Email so there is one
                identifier to type and remember, not two that can drift apart.
                Still required/sent as its own field: login can match on either. */}
            <LabeledInput label="Username" required disabled value={form.username}
              onChange={() => {}}
              hint="Same as email"
              error={touched && !form.username.trim() ? 'Required' : undefined} />
          </div>
          <LabeledInput label="Email" required value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v, username: v }))}
            error={touched && !form.email.trim() ? 'Required' : touched && !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid email address' : undefined} />

          {/* Without this the account is created with no password_hash, and login
              rejects those — which is why every new user needed a hash written
              into the table by hand before they could sign in. */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">
              Password{!user && <span className="text-red-400 ml-0.5">*</span>}
              {user && <span className="text-slate-600 normal-case tracking-normal ml-1.5">— leave blank to keep the current one</span>}
            </label>
            <div className="flex gap-2">
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={user ? '••••••••' : 'At least 8 characters'}
                className="flex-1 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ ...inset, ...(touched && !pwOk ? { border: '1px solid #ef4444' } : {}) }} />
              <button onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'}
                className="px-3 rounded-lg text-slate-400 hover:text-white" style={inset}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button
                onClick={() => { const p = generatePassword(); setPassword(p); setShowPw(true); navigator.clipboard?.writeText(p); toast.success('Password generated and copied') }}
                className="px-3 rounded-lg text-xs font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap" style={inset}>
                Generate
              </button>
            </div>
            {touched && !pwOk && <p className="text-[10px] text-red-400 mt-1">{password ? 'At least 8 characters' : 'Required'}</p>}
          </div>
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

          {/* Dashboard View Permission — connected here instead of only on its
              own tab, so an admin setting up (or moving) a user does not have
              to leave this modal to check or change what dashboards their
              department(s) can see. Editing it here writes the same
              department_themes policy the separate tab does, immediately. */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
              <Palette size={12} className="text-violet-400" /> Dashboard View Permission
            </label>
            {form.departmentIds.length === 0 ? (
              <p className="text-[11px] text-slate-600">Assign a department above to set which dashboards it can see.</p>
            ) : !themesLoaded ? (
              <p className="text-[11px] text-slate-600">Loading…</p>
            ) : availableThemes.length === 0 ? (
              <p className="text-[11px] text-slate-600">No dashboard themes have been granted to this organization yet — ask Super Admin.</p>
            ) : (
              <div className="space-y-2">
                {form.departmentIds.map((deptId) => {
                  const dept = departments.find((d) => d.id === deptId)
                  if (!dept) return null
                  return (
                    <div key={deptId} className="p-2.5 rounded-lg" style={inset}>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        {dept.name}
                        {savingTheme === deptId && <span className="normal-case text-slate-600">saving…</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {availableThemes.map((th) => {
                          const on = dept.themeIds.includes(th.id)
                          return (
                            <button key={th.id} onClick={() => toggleDeptTheme(deptId, th.id)}
                              className={clsx('px-2.5 py-1 rounded-md text-[11px] transition-all', on ? 'text-white' : 'text-slate-400')}
                              style={on ? { background: `${th.accent}26`, border: `1px solid ${th.accent}` } : { background: '#0d1117', border: '1px solid #1e2433' }}>
                              {th.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 p-5" style={{ borderTop: '1px solid #1e2433' }}>
          <button
            onClick={() => { setTouched(true); if (valid) onSave({ ...form, name: form.name.trim(), username: form.username.trim(), email: form.email.trim(), password: password || undefined }) }}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={gradient}>Save</button>
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white" style={inset}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/


function LabeledInput({ label, value, onChange, required, error, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; error?: string; disabled?: boolean; hint?: string }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ ...inset, ...(error ? { border: '1px solid #ef4444' } : {}) }} />
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      {hint && !error && <p className="text-[10px] text-slate-600 mt-1">{hint}</p>}
    </div>
  )
}
