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

/** Domains the viewer can access at all (any of view/manage), across departments. */
export function viewerDomains(userId: string): SensorDomain[] {
  const set = new Set<SensorDomain>()
  for (const d of viewerDepartments(userId)) {
    Object.keys(d.productAccess ?? {}).forEach((k) => set.add(k as SensorDomain))
  }
  return Array.from(set)
}

export const viewerCanAccess = (userId: string, domain: SensorDomain): boolean =>
  viewerDepartments(userId).some((d) => !!d.productAccess?.[domain])

/** True if any of the viewer's departments grants 'manage' on the domain. */
export const viewerCanManage = (userId: string, domain: SensorDomain): boolean =>
  viewerDepartments(userId).some((d) => d.productAccess?.[domain] === 'manage')

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
