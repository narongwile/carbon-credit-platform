// ---------------------------------------------------------------------------
// Mock unified fleet data
// ---------------------------------------------------------------------------
// Demonstrates that ONE customer organization can run all three sensor domains
// at the same time across its sites (per the attached ERDs). org-1 and org-2
// both host transformers + carbon_nodes + blood_boxes.
// ---------------------------------------------------------------------------

import type {
  Site, SensorHost, SensorType, Sensor, FleetDevice, DeviceInterface, SiteOperations, SensorDomain,
} from '@/types/fleet'

export const sites: Site[] = [
  { id: 'site-1a', orgId: 'org-1', name: 'KMUTT Main Substation', address: '126 Pracha Uthit Rd, Bangkok', lat: 13.6512, lng: 100.4964 },
  { id: 'site-1b', orgId: 'org-1', name: 'KMUTT Cold Storage Wing', address: '126 Pracha Uthit Rd, Bangkok', lat: 13.6518, lng: 100.4971 },
  { id: 'site-2a', orgId: 'org-2', name: 'Factory Alpha Plant', address: 'Amata City, Chonburi', lat: 13.3611, lng: 100.9847 },
  { id: 'site-3a', orgId: 'org-3', name: 'Industrial Corp HQ', address: 'Jurong, Singapore', lat: 1.3521, lng: 103.8198 },
]

export const sensorTypes: SensorType[] = [
  { id: 1, code: 'OIL_TEMP', unit: '°C', defaultWarning: 80, defaultCritical: 95, inverted: false },
  { id: 2, code: 'HYDROGEN', unit: 'ppm', defaultWarning: 150, defaultCritical: 300, inverted: false },
  { id: 3, code: 'FRIDGE_TEMP', unit: '°C', defaultWarning: 8, defaultCritical: 10, inverted: false },
  { id: 4, code: 'DOOR', unit: '', defaultWarning: 1, defaultCritical: 1, inverted: false },
  { id: 5, code: 'BLOOD_TEMP', unit: '°C', defaultWarning: 6, defaultCritical: 8, inverted: false },
  { id: 6, code: 'IMPACT_G', unit: 'g', defaultWarning: 2, defaultCritical: 4, inverted: false },
]

// Hosts — note every site mixes domains, and every org has all three.
export const hosts: SensorHost[] = [
  // --- org-1 / site-1a ---
  { id: 'tr-001', orgId: 'org-1', siteId: 'site-1a', name: 'TR-001', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-6787', serial: 'SN100231', kva: 2500, voltage: '22kV/0.4kV', healthIndex: 92, openAlarms: 0 },
  { id: 'tr-002', orgId: 'org-1', siteId: 'site-1a', name: 'TR-002', domain: 'transformer', status: 'WARNING', sensorCount: 6, model: 'TR-5512', serial: 'SN100232', kva: 1500, voltage: '11kV/0.4kV', healthIndex: 74, openAlarms: 2 },
  { id: 'cn-01', orgId: 'org-1', siteId: 'site-1a', name: 'Cold Room A1', domain: 'carbonNode', status: 'NORMAL', sensorCount: 2, cabinetZone: 'Zone A', targetMinC: 2, targetMaxC: 8, refrigerantType: 'R-134a', co2eSavedKg: 1820, creditsIssued: 14 },
  { id: 'bb-01', orgId: 'org-1', siteId: 'site-1a', name: 'BloodBOX A', domain: 'bloodBox', status: 'NORMAL', sensorCount: 3, boxCode: 'BB-A-001', setLowC: 2, setHighC: 6, floor: 'Floor 1', excursions: 0, inTransit: false },

  // --- org-1 / site-1b ---
  { id: 'tr-003', orgId: 'org-1', siteId: 'site-1b', name: 'TR-003', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-6787', serial: 'SN100240', kva: 2000, voltage: '22kV/0.4kV', healthIndex: 88, openAlarms: 0 },
  { id: 'tr-004', orgId: 'org-1', siteId: 'site-1a', name: 'TR-004', domain: 'transformer', status: 'CRITICAL', sensorCount: 6, model: 'TR-9001', serial: 'SN100241', kva: 3000, voltage: '33kV/11kV', healthIndex: 45, openAlarms: 2 },
  { id: 'tr-005', orgId: 'org-1', siteId: 'site-1b', name: 'TR-005', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-5512', serial: 'SN100242', kva: 1500, voltage: '11kV/0.4kV', healthIndex: 96, openAlarms: 0 },
  { id: 'cn-02', orgId: 'org-1', siteId: 'site-1b', name: 'Freezer B1', domain: 'carbonNode', status: 'CRITICAL', sensorCount: 2, cabinetZone: 'Zone B', targetMinC: -20, targetMaxC: -15, refrigerantType: 'R-404A', co2eSavedKg: 2630, creditsIssued: 21 },
  { id: 'cn-03', orgId: 'org-1', siteId: 'site-1b', name: 'Cold Room B2', domain: 'carbonNode', status: 'NORMAL', sensorCount: 2, cabinetZone: 'Zone B', targetMinC: 2, targetMaxC: 8, refrigerantType: 'R-134a', co2eSavedKg: 1410, creditsIssued: 11 },
  { id: 'bb-02', orgId: 'org-1', siteId: 'site-1b', name: 'BloodBOX B', domain: 'bloodBox', status: 'WARNING', sensorCount: 3, boxCode: 'BB-B-002', setLowC: 2, setHighC: 6, floor: 'Floor 2', excursions: 1, inTransit: true },
  { id: 'bb-03', orgId: 'org-1', siteId: 'site-1b', name: 'BloodBOX C', domain: 'bloodBox', status: 'NORMAL', sensorCount: 3, boxCode: 'BB-C-003', setLowC: 2, setHighC: 6, floor: 'B1', excursions: 0, inTransit: false },

  // --- org-2 / site-2a ---
  { id: 'tr-101', orgId: 'org-2', siteId: 'site-2a', name: 'TR-101', domain: 'transformer', status: 'CRITICAL', sensorCount: 6, model: 'TR-9001', serial: 'SN200110', kva: 3000, voltage: '33kV/11kV', healthIndex: 58, openAlarms: 3 },
  { id: 'tr-102', orgId: 'org-2', siteId: 'site-2a', name: 'TR-102', domain: 'transformer', status: 'WARNING', sensorCount: 6, model: 'TR-6787', serial: 'SN200111', kva: 2500, voltage: '22kV/0.4kV', healthIndex: 68, openAlarms: 1 },
  { id: 'tr-103', orgId: 'org-2', siteId: 'site-2a', name: 'TR-103', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-5512', serial: 'SN200112', kva: 1500, voltage: '11kV/0.4kV', healthIndex: 91, openAlarms: 0 },
  { id: 'cn-101', orgId: 'org-2', siteId: 'site-2a', name: 'Plant Cold Store', domain: 'carbonNode', status: 'NORMAL', sensorCount: 2, cabinetZone: 'Dock', targetMinC: 0, targetMaxC: 5, refrigerantType: 'R-290', co2eSavedKg: 3120, creditsIssued: 26 },
  { id: 'bb-101', orgId: 'org-2', siteId: 'site-2a', name: 'BloodBOX P1', domain: 'bloodBox', status: 'NORMAL', sensorCount: 3, boxCode: 'BB-P-101', setLowC: 2, setHighC: 6, floor: 'Floor 1', excursions: 0, inTransit: false },

  // --- org-3 / site-3a (Industrial Corp — multi-domain enterprise) ---
  { id: 'tr-301', orgId: 'org-3', siteId: 'site-3a', name: 'TR-301', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-9001', serial: 'SN300110', kva: 3000, voltage: '115kV/22kV', healthIndex: 94, openAlarms: 0 },
  { id: 'tr-302', orgId: 'org-3', siteId: 'site-3a', name: 'TR-302', domain: 'transformer', status: 'WARNING', sensorCount: 6, model: 'TR-6787', serial: 'SN300111', kva: 2500, voltage: '33kV/11kV', healthIndex: 71, openAlarms: 1 },
  { id: 'tr-303', orgId: 'org-3', siteId: 'site-3a', name: 'TR-303', domain: 'transformer', status: 'NORMAL', sensorCount: 6, model: 'TR-5512', serial: 'SN300112', kva: 2000, voltage: '22kV/0.4kV', healthIndex: 89, openAlarms: 0 },
  { id: 'cn-301', orgId: 'org-3', siteId: 'site-3a', name: 'Plant 1 Cold Store', domain: 'carbonNode', status: 'NORMAL', sensorCount: 2, cabinetZone: 'Plant 1', targetMinC: 2, targetMaxC: 8, refrigerantType: 'R-134a', co2eSavedKg: 2450, creditsIssued: 19 },
  { id: 'bb-301', orgId: 'org-3', siteId: 'site-3a', name: 'BloodBOX S1', domain: 'bloodBox', status: 'NORMAL', sensorCount: 3, boxCode: 'BB-S-301', setLowC: 2, setHighC: 6, floor: 'Floor 1', excursions: 0, inTransit: false },
]

/** Canonical transformer host ids (single source of truth for transformer pages). */
export const getTransformerHostIds = (): string[] =>
  hosts.filter((h) => h.domain === 'transformer').map((h) => h.id)

// A representative slice of sensors (base) — each bound to exactly one host.
export const sensors: Sensor[] = [
  { id: 's-1', orgId: 'org-1', deviceId: 'dev-tr1', interfaceId: 'if-tr1-ct', sensorTypeId: 1, hostDomain: 'transformer', hostId: 'tr-001', mac: '00:1A:2B:00:00:01', currentValue: 68.4, currentStatus: 'NORMAL', lastReadingAt: new Date().toISOString() },
  { id: 's-2', orgId: 'org-1', deviceId: 'dev-tr1', interfaceId: 'if-tr1-rs485', sensorTypeId: 2, hostDomain: 'transformer', hostId: 'tr-001', mac: '00:1A:2B:00:00:02', currentValue: 115.4, currentStatus: 'NORMAL', lastReadingAt: new Date().toISOString() },
  { id: 's-3', orgId: 'org-1', deviceId: 'dev-cn1', interfaceId: 'if-cn1-i2c', sensorTypeId: 3, hostDomain: 'carbonNode', hostId: 'cn-01', mac: '00:1A:2B:00:00:03', currentValue: 4.1, currentStatus: 'NORMAL', lastReadingAt: new Date().toISOString() },
  { id: 's-4', orgId: 'org-1', deviceId: 'dev-bb1', interfaceId: 'if-bb1-ble', sensorTypeId: 5, hostDomain: 'bloodBox', hostId: 'bb-01', mac: '00:1A:2B:00:00:04', currentValue: 4.6, currentStatus: 'NORMAL', lastReadingAt: new Date().toISOString() },
]

export const fleetDevices: FleetDevice[] = [
  { id: 'dev-tr1', orgId: 'org-1', siteId: 'site-1a', mac: '00:1A:2B:00:00:01', chipId: 'ESP32-AABB01', hardwareModel: 'EDGE-TR-v3', firmwareVersion: '2.4.1', provisioningState: 'provisioned', status: 'online', lastSeenAt: new Date().toISOString(), batteryPct: 100 },
  { id: 'dev-cn1', orgId: 'org-1', siteId: 'site-1a', mac: '00:1A:2B:00:00:03', chipId: 'ESP32-AABB03', hardwareModel: 'RDL-v2', firmwareVersion: '1.9.0', provisioningState: 'provisioned', status: 'online', lastSeenAt: new Date().toISOString(), batteryPct: 86 },
  { id: 'dev-bb1', orgId: 'org-1', siteId: 'site-1a', mac: '00:1A:2B:00:00:04', chipId: 'ESP32-AABB04', hardwareModel: 'BBOX-v1', firmwareVersion: '1.2.3', provisioningState: 'provisioned', status: 'online', lastSeenAt: new Date().toISOString(), batteryPct: 72 },
]

export const deviceInterfaces: DeviceInterface[] = [
  { id: 'if-tr1-ct', deviceId: 'dev-tr1', kind: 'ct', label: 'CT-1', status: 'up' },
  { id: 'if-tr1-rs485', deviceId: 'dev-tr1', kind: 'rs485', label: 'RS485-A', status: 'up' },
  { id: 'if-cn1-i2c', deviceId: 'dev-cn1', kind: 'i2c', label: 'I2C-0', status: 'up' },
  { id: 'if-bb1-lora', deviceId: 'dev-bb1', kind: 'lora', label: 'LoRaWAN', status: 'up' },
  { id: 'if-bb1-gnss', deviceId: 'dev-bb1', kind: 'gnss', label: 'GNSS (4G SIM module)', status: 'up' },
  { id: 'if-bb1-wifi', deviceId: 'dev-bb1', kind: 'wifi', label: 'WiFi RTT (primary)', status: 'up' },
  { id: 'if-bb1-cell', deviceId: 'dev-bb1', kind: 'cellular', label: '4G LTE (fallback)', status: 'up' },
]

// Selectors ----------------------------------------------------------------
export const getSitesByOrg = (orgId: string) => sites.filter((s) => s.orgId === orgId)
export const getHostsBySite = (siteId: string) => hosts.filter((h) => h.siteId === siteId)
export const getHostsByOrg = (orgId: string) => hosts.filter((h) => h.orgId === orgId)
export const getOrgDomains = (orgId: string): SensorDomain[] =>
  Array.from(new Set(getHostsByOrg(orgId).map((h) => h.domain)))

// v_site_operations — unified per-site KPI roll-up across the 3 domains.
export function getSiteOperations(siteId: string): SiteOperations {
  const site = sites.find((s) => s.id === siteId)!
  const list = getHostsBySite(siteId)
  const tr = list.filter((h) => h.domain === 'transformer') as Extract<SensorHost, { domain: 'transformer' }>[]
  const cn = list.filter((h) => h.domain === 'carbonNode') as Extract<SensorHost, { domain: 'carbonNode' }>[]
  const bb = list.filter((h) => h.domain === 'bloodBox') as Extract<SensorHost, { domain: 'bloodBox' }>[]
  return {
    siteId,
    siteName: site?.name ?? siteId,
    domains: Array.from(new Set(list.map((h) => h.domain))),
    transformer: {
      count: tr.length,
      avgHealth: tr.length ? Math.round(tr.reduce((a, t) => a + t.healthIndex, 0) / tr.length) : 0,
      openAlarms: tr.reduce((a, t) => a + t.openAlarms, 0),
    },
    carbonNode: {
      count: cn.length,
      co2eSavedKg: cn.reduce((a, c) => a + c.co2eSavedKg, 0),
      creditsIssued: cn.reduce((a, c) => a + c.creditsIssued, 0),
    },
    bloodBox: {
      count: bb.length,
      excursions: bb.reduce((a, b) => a + b.excursions, 0),
      inTransit: bb.filter((b) => b.inTransit).length,
    },
  }
}

// ---------------------------------------------------------------------------
// Adapter: project fleet hosts onto the ManagedDevice view-model used by the
// Admin Device Management and Customer Devices UIs. This is the single source
// of truth so those screens, the multi-domain Sites page, and the fleet ERD
// all stay consistent.
// ---------------------------------------------------------------------------
import type { ManagedDevice } from '@/types/org'

const DOMAIN_DEFAULTS = {
  transformer: { deviceType: 'Power Transformer', theme: 'fix' as const, dept: { 'site-1a': 'dept-bb', 'site-1b': 'dept-cc', 'site-2a': 'dept-dd' } as Record<string, string> },
  carbonNode: { deviceType: 'Refrigeration Logger', theme: 'fix' as const, dept: { 'site-1a': 'dept-bb', 'site-1b': 'dept-cc', 'site-2a': 'dept-dd' } as Record<string, string> },
  bloodBox: { deviceType: 'BloodBOX Cold Storage', theme: 'freestyle' as const, dept: { 'site-1a': 'dept-bb', 'site-1b': 'dept-cc', 'site-2a': 'dept-ee' } as Record<string, string> },
}

function hostToDevice(h: SensorHost): ManagedDevice {
  const d = DOMAIN_DEFAULTS[h.domain]
  const site = sites.find((s) => s.id === h.siteId)
  const lastValue =
    h.domain === 'transformer' ? '68.4°C'
    : h.domain === 'carbonNode' ? `${h.targetMaxC}°C`
    : '4.6°C'
  const serial = h.domain === 'transformer' ? h.serial : h.domain === 'bloodBox' ? h.boxCode : h.id.toUpperCase()
  const dept = d.dept[h.siteId]
  return {
    id: h.id,
    orgId: h.orgId,
    name: h.name,
    serial,
    deviceType: d.deviceType,
    domain: h.domain,
    siteId: h.siteId,
    location: site?.name ?? h.siteId,
    theme: d.theme,
    departmentIds: dept ? [dept] : [],
    status: h.status === 'OFFLINE' ? 'offline' : 'online',
    lastValue,
  }
}

export const managedDevicesFromFleet = (orgId: string): ManagedDevice[] =>
  getHostsByOrg(orgId).map(hostToDevice)

/** All hosts across every org, projected as devices (for static params etc). */
export const allManagedDevices = (): ManagedDevice[] => hosts.map(hostToDevice)
