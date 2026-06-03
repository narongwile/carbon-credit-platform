// ---------------------------------------------------------------------------
// Tenant entitlements — the gate between what a SUPER ADMIN licenses per
// organization (organizations[].platforms[].licensed + features[].enabled)
// and what each admin/customer is allowed to see and use.
// ---------------------------------------------------------------------------

import { organizations } from './mockData'
import type { PlatformType } from './platforms'
import type { SensorDomain } from '@/types/fleet'

// Registry platform id  <->  legacy org platformId used in mock org data.
const PLATFORM_LEGACY: Record<PlatformType, string> = {
  refrigerationDataLogger: 'carbonbox',
  bloodBox: 'bloodbox',
  eternityTransformers: 'eternity',
}

export const DOMAIN_TO_PLATFORM: Record<SensorDomain, PlatformType> = {
  transformer: 'eternityTransformers',
  carbonNode: 'refrigerationDataLogger',
  bloodBox: 'bloodBox',
}

export const getOrg = (orgId: string) => organizations.find((o) => o.id === orgId)

/** Is the organization licensed for a given sensor platform? */
export function isPlatformLicensed(orgId: string, platform: PlatformType): boolean {
  const legacy = PLATFORM_LEGACY[platform]
  return !!getOrg(orgId)?.platforms.some((p) => p.platformId === legacy && p.licensed)
}

export const isDomainLicensed = (orgId: string, domain: SensorDomain) =>
  isPlatformLicensed(orgId, DOMAIN_TO_PLATFORM[domain])

/** Is a named feature enabled on any platform the org is licensed for? */
export function isFeatureEnabled(orgId: string, featureName: string): boolean {
  const org = getOrg(orgId)
  if (!org) return false
  return org.platforms.some((p) => p.licensed && p.features.some((f) => f.name === featureName && f.enabled))
}

/** Sensor domains the org is licensed for. */
export function licensedDomains(orgId: string): SensorDomain[] {
  return (['transformer', 'carbonNode', 'bloodBox'] as SensorDomain[]).filter((d) => isDomainLicensed(orgId, d))
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
