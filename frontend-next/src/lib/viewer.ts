// ---------------------------------------------------------------------------
// Viewer access resolution: user -> department(s) -> product access + events.
// A logged-in viewer only sees/manages products their department(s) grant, and
// the detailed-monitoring event dropdown is the union of their departments'
// event-problem catalogs.
// ---------------------------------------------------------------------------

import { managedUsers, departments, getEventProblemsByDept } from '@/lib/orgData'
import type { EventProblem, ManagedUser } from '@/types/org'
import type { SensorDomain } from '@/types/fleet'

export const getViewerUser = (userId: string): ManagedUser | undefined =>
  managedUsers.find((u) => u.id === userId)

export const viewerDepartments = (userId: string) => {
  const u = getViewerUser(userId)
  if (!u) return []
  return departments.filter((d) => u.departmentIds.includes(d.id))
}

export type AccessLevel = 'none' | 'view' | 'manage'
const RANK: Record<AccessLevel, number> = { none: 0, view: 1, manage: 2 }

/** Highest level granted by the user's department(s) for a domain. */
function departmentLevel(userId: string, domain: SensorDomain): AccessLevel {
  let best: AccessLevel = 'none'
  for (const d of viewerDepartments(userId)) {
    const l = d.productAccess?.[domain]
    if (l && RANK[l] > RANK[best]) best = l
  }
  return best
}

/** Explicit per-user override for a domain (undefined = inherit department). */
export const userOverride = (userId: string, domain: SensorDomain): AccessLevel | undefined =>
  getViewerUser(userId)?.productAccess?.[domain]

/**
 * Effective access = department grant, but a per-user override can only RESTRICT
 * it (never elevate beyond what the department allows).
 */
export function viewerEffectiveLevel(userId: string, domain: SensorDomain): AccessLevel {
  const dept = departmentLevel(userId, domain)
  const ov = userOverride(userId, domain)
  if (ov === undefined) return dept
  return RANK[ov] < RANK[dept] ? ov : dept
}

/** Domains the viewer can access at all (effective >= view), across departments. */
export function viewerDomains(userId: string): SensorDomain[] {
  const domains: SensorDomain[] = []
  const set = new Set<SensorDomain>()
  for (const d of viewerDepartments(userId)) {
    Object.keys(d.productAccess ?? {}).forEach((k) => set.add(k as SensorDomain))
  }
  set.forEach((domain) => {
    if (RANK[viewerEffectiveLevel(userId, domain)] >= RANK.view) domains.push(domain)
  })
  return domains
}

export const viewerCanAccess = (userId: string, domain: SensorDomain): boolean =>
  RANK[viewerEffectiveLevel(userId, domain)] >= RANK.view

/** True if the viewer's effective access on the domain is 'manage'. */
export const viewerCanManage = (userId: string, domain: SensorDomain): boolean =>
  viewerEffectiveLevel(userId, domain) === 'manage'

/** Union of the viewer's departments' event-problem catalogs. */
export function viewerEventProblems(userId: string): EventProblem[] {
  const seen = new Set<string>()
  const out: EventProblem[] = []
  for (const d of viewerDepartments(userId)) {
    for (const ev of getEventProblemsByDept(d.id)) {
      if (!seen.has(ev.id)) { seen.add(ev.id); out.push(ev) }
    }
  }
  return out.length ? out : []
}
