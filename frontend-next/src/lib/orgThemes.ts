// ---------------------------------------------------------------------------
// Per-organization dashboard theme grants — SUPER ADMIN managed ONLY.
// ---------------------------------------------------------------------------
// The set of dashboard themes a customer organization is entitled to use is
// governed exclusively by the super admin (see /superadmin/organizations).
// Org admins can only allocate THESE granted themes to their departments —
// they cannot add or remove themes from the organization's entitlement.
// ---------------------------------------------------------------------------

export const orgThemeGrants: Record<string, string[]> = {
  'org-1': ['th-overview', 'th-map', 'th-fix', 'th-free', 'th-refrig'],
  'org-2': ['th-overview', 'th-map', 'th-fix', 'th-free', 'th-twin'],
  'org-3': ['th-overview', 'th-fix'],
}

export const getOrgThemeGrants = (orgId: string): string[] =>
  orgThemeGrants[orgId] ?? ['th-overview']
