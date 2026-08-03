// ---------------------------------------------------------------------------
// Per-organization dashboard theme grants — SUPER ADMIN managed ONLY.
// ---------------------------------------------------------------------------
// The set of dashboard themes a customer organization is entitled to use is
// governed exclusively by the super admin (see /superadmin/organizations).
// Org admins can only allocate THESE granted themes to their departments —
// they cannot add or remove themes from the organization's entitlement.
//
// This used to be a module-level object listing org-1/2/3 and nothing else, and
// it was the reason the Dashboard View Permission tab looked broken:
//
//   · every other organization fell back to ['th-overview'], so its admin could
//     allocate exactly ONE theme no matter what the super admin intended — the
//     tab rendered a single row and looked half-finished
//   · setOrgThemeGrants mutated that object, so the super admin's own save
//     survived until the next page load and no further
//
// It is a table now (org_theme_grants, migrate-v28). The seeded values below are
// kept only as the demo-mode answer, so the app still demonstrates without a
// backend — in Live mode the grants come from the database.
// ---------------------------------------------------------------------------

import { api, isLive } from './api'

/** Demo-mode fallback only. Live mode reads org_theme_grants. */
export const orgThemeGrants: Record<string, string[]> = {
  'org-1': ['th-overview', 'th-map', 'th-fix', 'th-free', 'th-refrig'],
  'org-2': ['th-overview', 'th-map', 'th-fix', 'th-free', 'th-twin'],
  'org-3': ['th-overview', 'th-fix'],
}

/**
 * Synchronous demo-mode grants. Live callers should await fetchOrgThemeGrants
 * instead — this cannot see the database.
 */
export const getOrgThemeGrants = (orgId: string): string[] =>
  orgThemeGrants[orgId] ?? ['th-overview']

/**
 * What this organization is actually licensed for. Falls back to the demo map
 * when there is no backend, and to the demo map when the org has no rows yet, so
 * an organization created before migrate-v28 does not lose the themes its admin
 * had already allocated the moment this ships.
 */
export async function fetchOrgThemeGrants(orgId: string): Promise<string[]> {
  if (!isLive()) return getOrgThemeGrants(orgId)
  const r = await api.themeGrants(orgId)
  if (!r) return getOrgThemeGrants(orgId)
  return r.themeIds.length ? r.themeIds : getOrgThemeGrants(orgId)
}

/** Super admin only — the backend enforces it; returns false if the save failed. */
export async function saveOrgThemeGrants(orgId: string, themes: string[]): Promise<boolean> {
  orgThemeGrants[orgId] = themes          // keep demo mode in step
  if (!isLive()) return true
  return !!(await api.setThemeGrants(orgId, themes))
}
