// ---------------------------------------------------------------------------
// Unified fleet / multi-domain data model
// ---------------------------------------------------------------------------
// Mirrors the attached ERDs. A customer organization (tenant) owns SITES, and
// each site can host any combination of THREE sensor domains at the same time:
//   - transformer   (ETERNITY transformer monitoring)
//   - carbonNode     (refrigeration data logger)
//   - bloodBox       (BloodBOX cold-chain)
// A `sensors(base)` row attaches to exactly ONE host (CHECK exactly one host)
// and is physically carried by a device + interface (fleet ERD). Per-site KPIs
// across all three domains roll up into `v_site_operations`.
// ---------------------------------------------------------------------------

export type SensorDomain = 'transformer' | 'carbonNode' | 'bloodBox'

export const DOMAIN_META: Record<SensorDomain, { label: string; platform: string; accent: string }> = {
  transformer: { label: 'Transformer', platform: 'ETERNITY', accent: '#6366f1' },
  carbonNode: { label: 'Refrigeration Node', platform: 'CarbonBOX', accent: '#22c55e' },
  bloodBox: { label: 'BloodBOX', platform: 'BloodBOX', accent: '#ef4444' },
}

export interface Site {
  id: string
  orgId: string
  name: string
  address: string
  lat: number
  lng: number
}

interface HostBase {
  id: string
  orgId: string
  siteId: string
  name: string
  domain: SensorDomain
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'
  sensorCount: number
}

// transformers (ERD #1)
export interface TransformerHost extends HostBase {
  domain: 'transformer'
  model: string
  serial: string
  kva: number
  voltage: string
  healthIndex: number
  openAlarms: number
}

// carbon_nodes (refrigeration data logger)
export interface CarbonNodeHost extends HostBase {
  domain: 'carbonNode'
  cabinetZone: string
  targetMinC: number
  targetMaxC: number
  refrigerantType: string
  co2eSavedKg: number
  creditsIssued: number
}

// blood_boxes (ERD #4)
export interface BloodBoxHost extends HostBase {
  domain: 'bloodBox'
  boxCode: string
  setLowC: number
  setHighC: number
  floor: string
  excursions: number
  inTransit: boolean
}

export type SensorHost = TransformerHost | CarbonNodeHost | BloodBoxHost

// sensor_types (ERD #1)
export interface SensorType {
  id: number
  code: string
  unit: string
  defaultWarning: number
  defaultCritical: number
  inverted: boolean
}

// sensors (base) — attaches to exactly one host (ERD #5)
export interface Sensor {
  id: string
  orgId: string
  deviceId: string
  interfaceId: string
  sensorTypeId: number
  hostDomain: SensorDomain
  hostId: string
  mac: string
  currentValue: number
  currentStatus: 'NORMAL' | 'WARNING' | 'CRITICAL'
  lastReadingAt: string
}

// devices + interfaces (fleet ERD #2)
export interface FleetDevice {
  id: string
  orgId: string
  siteId: string
  mac: string
  chipId: string
  hardwareModel: string
  firmwareVersion: string
  provisioningState: 'provisioned' | 'pending' | 'decommissioned'
  status: 'online' | 'offline'
  lastSeenAt: string
  batteryPct: number
}

export interface DeviceInterface {
  id: string
  deviceId: string
  kind: 'can' | 'rs485' | 'i2c' | 'gpio_di' | 'gpio_do' | 'ct' | 'lora' | 'cellular' | 'gnss' | 'wifi'
  label: string
  status: 'up' | 'down'
}

// v_site_operations — unified per-site KPI across the 3 domains (data-flow #3)
export interface SiteOperations {
  siteId: string
  siteName: string
  domains: SensorDomain[]
  transformer: { count: number; avgHealth: number; openAlarms: number }
  carbonNode: { count: number; co2eSavedKg: number; creditsIssued: number }
  bloodBox: { count: number; excursions: number; inTransit: number }
}
