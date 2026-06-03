// ---------------------------------------------------------------------------
// Platform Registry
// ---------------------------------------------------------------------------
// Single source of truth for the sensor-type platforms that a SUPERADMIN can
// provision for a new customer organization. Adding a new product line to the
// unified operation-management platform is as simple as appending a template
// here — the superadmin "New Platform" wizard, the organization entitlements
// modal, and the per-tenant navigation all read from this list.
// ---------------------------------------------------------------------------

import type { FeatureToggle } from '@/types'

export type PlatformType =
  | 'refrigerationDataLogger'
  | 'bloodBox'
  | 'eternityTransformers'

export interface PlatformFeatureTemplate {
  name: string
  category: string
  /** Default state when a tenant is first provisioned with this platform. */
  defaultEnabled: boolean
}

export interface PlatformTemplate {
  /** Stable identifier persisted on the organization's PlatformAccess. */
  id: PlatformType
  /** Customer-facing product name. */
  name: string
  /** Compact label used in chips / tables. */
  shortName: string
  /** What kind of physical device/sensor this platform onboards. */
  sensorType: string
  description: string
  /** lucide-react icon name (resolved by the UI). */
  icon: string
  /** Accent color used for cards, chips, gradients. */
  accent: string
  /** Headline telemetry channels surfaced in the catalog. */
  metrics: string[]
  /** Live module route once a tenant is provisioned (empty = scaffolded). */
  moduleRoute: string
  /** Maturity of the module behind the platform. */
  status: 'live' | 'beta' | 'scaffold'
  /** Feature flags offered to tenants on this platform. */
  features: PlatformFeatureTemplate[]
}

export const PLATFORM_TEMPLATES: PlatformTemplate[] = [
  {
    id: 'refrigerationDataLogger',
    name: 'Refrigeration Data Logger',
    shortName: 'CarbonBOX',
    sensorType: 'Temperature & Door Sensor (Cold Chain)',
    description:
      'Cold-chain refrigeration monitoring with per-node temperature, door-open detection and carbon-credit accrual. Ships with the live node grid + analytics module.',
    icon: 'Thermometer',
    accent: '#22c55e',
    metrics: ['Temperature (°C)', 'Door Open/Closed', 'Compressor Cycle', 'CO₂e Saved'],
    moduleRoute: '/admin/refrigeration',
    status: 'live',
    features: [
      { name: 'Live Node Grid', category: 'core', defaultEnabled: true },
      { name: 'Temperature Analytics', category: 'analytics', defaultEnabled: true },
      { name: 'Door-Open Alerting', category: 'alerting', defaultEnabled: true },
      { name: 'Carbon Credit Accrual', category: 'carbon', defaultEnabled: false },
      { name: 'CSV Report Export', category: 'reporting', defaultEnabled: true },
    ],
  },
  {
    id: 'bloodBox',
    name: 'BloodBOX Cold Storage',
    shortName: 'BloodBOX',
    sensorType: 'Medical-Grade Temperature & Humidity Sensor',
    description:
      'Medical cold-storage monitoring for blood banks and vaccine fridges. Tracks temperature, humidity and inventory with regulated audit trails.',
    icon: 'Droplet',
    accent: '#ef4444',
    metrics: ['Temperature (°C)', 'Transit ETA', 'Indoor Floor (BLE/Barometer)', 'Excursion Time'],
    moduleRoute: '/admin/bloodbox',
    status: 'live',
    features: [
      { name: 'Cold Storage Monitoring', category: 'core', defaultEnabled: true },
      { name: 'Inventory Tracking', category: 'inventory', defaultEnabled: false },
      { name: 'Excursion Audit Trail', category: 'compliance', defaultEnabled: true },
      { name: 'API Integration', category: 'api', defaultEnabled: false },
    ],
  },
  {
    id: 'eternityTransformers',
    name: 'ETERNITY Transformer Monitoring',
    shortName: 'ETERNITY',
    sensorType: 'Power Transformer DGA & Thermal Sensor',
    description:
      'Industrial power-transformer monitoring with a digital-twin view, dissolved-gas analysis and AI predictive diagnostics.',
    icon: 'Zap',
    accent: '#6366f1',
    metrics: ['Oil Temperature', 'Hydrogen (H₂)', 'Moisture', 'Load %'],
    moduleRoute: '/admin',
    status: 'live',
    features: [
      { name: 'Digital Twin Visualization', category: 'core', defaultEnabled: true },
      { name: 'Real-time Telemetry', category: 'core', defaultEnabled: true },
      { name: 'AI Predictive Diagnostics', category: 'ai', defaultEnabled: false },
      { name: 'Historical Analytics', category: 'analytics', defaultEnabled: true },
      { name: 'Report Generation', category: 'reporting', defaultEnabled: true },
    ],
  },
]

export function getPlatformTemplate(id: PlatformType): PlatformTemplate | undefined {
  return PLATFORM_TEMPLATES.find((p) => p.id === id)
}

/** Build the per-org feature toggle list for a freshly provisioned platform. */
export function buildDefaultFeatures(id: PlatformType): FeatureToggle[] {
  const template = getPlatformTemplate(id)
  if (!template) return []
  return template.features.map((f, i) => ({
    id: `${id}-f${i + 1}`,
    name: f.name,
    enabled: f.defaultEnabled,
    category: f.category,
  }))
}

export const statusBadge: Record<PlatformTemplate['status'], { label: string; color: string; bg: string }> = {
  live: { label: 'LIVE', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  beta: { label: 'BETA', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  scaffold: { label: 'SCAFFOLD', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
}
