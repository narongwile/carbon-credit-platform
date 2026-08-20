// ---------------------------------------------------------------------------
// Tenant entitlements — the gate between what a SUPER ADMIN licenses per
// organization (organizations[].platforms[].licensed + features[].enabled)
// and what each admin/customer is allowed to see and use.
// ---------------------------------------------------------------------------

import { organizations } from './mockData'
import { PLATFORM_TEMPLATES } from './platforms'
import type { PlatformType } from './platforms'
import type { SensorDomain } from '@/types/fleet'
import { useAppStore } from './store'

// Registry platform id  <->  legacy org platformId used in mock org data.
const PLATFORM_LEGACY: Record<PlatformType, string> = {
  refrigerationDataLogger: 'carbonbox',
  bloodBox: 'bloodbox',
  eternityTransformers: 'eternity',
  automobile: 'automobile',
}

export const DOMAIN_TO_PLATFORM: Record<SensorDomain, PlatformType> = {
  transformer: 'eternityTransformers',
  carbonNode: 'refrigerationDataLogger',
  bloodBox: 'bloodBox',
  automobile: 'automobile',
}

export const getOrg = (orgId: string) => organizations.find((o) => o.id === orgId)

// Real per-org licenses (org_entitlements), populated by admin/layout.tsx's
// fetch of GET /orgs/:id/entitlements into useAppStore.orgEntitlements. Every
// function below checks this FIRST and only falls back to the 3-org mock seed
// when nothing has been loaded for this org yet (demo mode, or live data still
// in flight on first render) — mirroring the pattern admin/users/page.tsx and
// admin/notifications/page.tsx already used inline for licensedDomains(),
// applied once here so every consumer (including admin/layout.tsx's nav filter
// and EntitlementGuard, neither of which had a live-data path before) inherits
// it for free.
//
// getState() rather than a hook: these are plain functions called from many
// non-component contexts. A caller that needs to RE-RENDER when real data
// arrives (EntitlementGuard) subscribes to orgEntitlements itself via the
// store hook — see that component.
const realEntitlements = (orgId: string): string[] | undefined => useAppStore.getState().orgEntitlements[orgId]

/** Is the organization licensed for a given sensor platform? */
export function isPlatformLicensed(orgId: string, platform: PlatformType): boolean {
  const real = realEntitlements(orgId)
  if (real) return real.includes(platform)
  const legacy = PLATFORM_LEGACY[platform]
  return !!getOrg(orgId)?.platforms.some((p) => p.platformId === legacy && p.licensed)
}

export const isDomainLicensed = (orgId: string, domain: SensorDomain) =>
  isPlatformLicensed(orgId, DOMAIN_TO_PLATFORM[domain])

/**
 * Is a named feature available to the org?
 * Policy: every feature within a LICENSED product is available — owning the
 * product grants all of its features. Access is gated by product license only;
 * the per-feature toggle no longer restricts access (features of unlicensed
 * products remain unavailable).
 */
export function isFeatureEnabled(orgId: string, featureName: string): boolean {
  const real = realEntitlements(orgId)
  if (real) {
    // Real entitlements are a flat list of licensed platform ids — the feature
    // catalog (which feature belongs to which platform) still comes from the
    // PLATFORM_TEMPLATES registry, the same source the superadmin's licensing
    // UI reads, so "licensed for eternityTransformers" correctly unlocks
    // Historical Analytics / AI Predictive Diagnostics without needing a
    // separate per-feature flag anywhere in org_entitlements.
    return PLATFORM_TEMPLATES.some((p) => real.includes(p.id) && p.features.some((f) => f.name === featureName))
  }
  const org = getOrg(orgId)
  if (!org) return false
  return org.platforms.some((p) => p.licensed && p.features.some((f) => f.name === featureName))
}

/** Sensor domains the org is licensed for. */
export function licensedDomains(orgId: string): SensorDomain[] {
  return (['transformer', 'carbonNode', 'bloodBox', 'automobile'] as SensorDomain[]).filter((d) => isDomainLicensed(orgId, d))
}

// What a nav item / page requires to be visible.
export interface Entitlement {
  platform?: PlatformType
  feature?: string
}

export function isEntitled(orgId: string, req?: Entitlement): boolean {
  if (!req) return true
  if (req.platform && !isPlatformLicensed(orgId, req.platform)) return false
  if (req.feature && !isFeatureEnabled(orgId, req.feature)) return false
  return true
}
