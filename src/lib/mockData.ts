import type { Organization, Transformer, Alarm, AuditLog, PlatformStats, TrendPoint } from '@/types'
import { hosts, sites } from './fleetData'
import type { TransformerHost } from '@/types/fleet'

function generateHistory(baseValue: number, variance: number, points: number = 96): TrendPoint[] {
  const history: TrendPoint[] = []
  const now = new Date()
  let current = baseValue

  for (let i = points - 1; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 15 * 60 * 1000)
    current = current + (Math.random() - 0.5) * variance
    current = Math.max(baseValue * 0.8, Math.min(baseValue * 1.2, current))
    history.push({
      time: time.toISOString(),
      value: parseFloat(current.toFixed(2)),
    })
  }
  return history
}

export const organizations: Organization[] = [
  {
    id: 'org-1',
    name: 'KMUTT University',
    type: 'Educational',
    country: 'Thailand',
    city: 'Bangkok',
    lat: 13.6512,
    lng: 100.4964,
    transformerCount: 5,
    status: 'active',
    licenseTier: 'enterprise',
    contactEmail: 'facilities@kmutt.ac.th',
    createdAt: '2022-01-15',
    platforms: [
      {
        platformId: 'eternity',
        platformName: 'ETERNITY',
        licensed: true,
        features: [
          { id: 'f1', name: 'Digital Twin Visualization', enabled: true, category: 'core' },
          { id: 'f2', name: 'Real-time Telemetry', enabled: true, category: 'core' },
          { id: 'f3', name: 'AI Predictive Diagnostics', enabled: true, category: 'ai' },
          { id: 'f4', name: 'Historical Analytics', enabled: true, category: 'analytics' },
          { id: 'f5', name: 'Report Generation', enabled: true, category: 'reporting' },
        ],
      },
      {
        platformId: 'carbonbox',
        platformName: 'CarbonBOX',
        licensed: true,
        features: [
          { id: 'f6', name: 'Emission Tracking', enabled: true, category: 'carbon' },
          { id: 'f7', name: 'Compliance Reporting', enabled: true, category: 'carbon' },
          { id: 'f8', name: 'Carbon Credit Marketplace', enabled: false, category: 'carbon' },
        ],
      },
      {
        platformId: 'bloodbox',
        platformName: 'BloodBOX',
        licensed: false,
        features: [
          { id: 'f9', name: 'IoT Sensor Integration', enabled: false, category: 'iot' },
          { id: 'f10', name: 'API Integration', enabled: false, category: 'api' },
        ],
      },
    ],
  },
  {
    id: 'org-2',
    name: 'Factory Alpha Industries',
    type: 'Manufacturing',
    country: 'Thailand',
    city: 'Chonburi',
    lat: 13.3611,
    lng: 100.9847,
    transformerCount: 3,
    status: 'active',
    licenseTier: 'professional',
    contactEmail: 'ops@factory-alpha.com',
    createdAt: '2021-08-20',
    platforms: [
      {
        platformId: 'eternity',
        platformName: 'ETERNITY',
        licensed: true,
        features: [
          { id: 'f1', name: 'Digital Twin Visualization', enabled: true, category: 'core' },
          { id: 'f2', name: 'Real-time Telemetry', enabled: true, category: 'core' },
          { id: 'f3', name: 'AI Predictive Diagnostics', enabled: false, category: 'ai' },
          { id: 'f4', name: 'Historical Analytics', enabled: true, category: 'analytics' },
          { id: 'f5', name: 'Report Generation', enabled: true, category: 'reporting' },
        ],
      },
      {
        platformId: 'carbonbox',
        platformName: 'CarbonBOX',
        licensed: false,
        features: [
          { id: 'f6', name: 'Emission Tracking', enabled: false, category: 'carbon' },
          { id: 'f7', name: 'Compliance Reporting', enabled: false, category: 'carbon' },
          { id: 'f8', name: 'Carbon Credit Marketplace', enabled: false, category: 'carbon' },
        ],
      },
      {
        platformId: 'bloodbox',
        platformName: 'BloodBOX',
        licensed: true,
        features: [
          { id: 'f9', name: 'IoT Sensor Integration', enabled: true, category: 'iot' },
          { id: 'f10', name: 'API Integration', enabled: true, category: 'api' },
        ],
      },
    ],
  },
  {
    id: 'org-3',
    name: 'Industrial Corp Ltd',
    type: 'Industrial',
    country: 'Singapore',
    city: 'Singapore',
    lat: 1.3521,
    lng: 103.8198,
    transformerCount: 3,
    status: 'active',
    licenseTier: 'enterprise',
    contactEmail: 'systems@industrial-corp.sg',
    createdAt: '2020-03-10',
    platforms: [
      {
        platformId: 'eternity',
        platformName: 'ETERNITY',
        licensed: true,
        features: [
          { id: 'f1', name: 'Digital Twin Visualization', enabled: true, category: 'core' },
          { id: 'f2', name: 'Real-time Telemetry', enabled: true, category: 'core' },
          { id: 'f3', name: 'AI Predictive Diagnostics', enabled: true, category: 'ai' },
          { id: 'f4', name: 'Historical Analytics', enabled: true, category: 'analytics' },
          { id: 'f5', name: 'Report Generation', enabled: true, category: 'reporting' },
        ],
      },
      {
        platformId: 'carbonbox',
        platformName: 'CarbonBOX',
        licensed: true,
        features: [
          { id: 'f6', name: 'Emission Tracking', enabled: true, category: 'carbon' },
          { id: 'f7', name: 'Compliance Reporting', enabled: true, category: 'carbon' },
          { id: 'f8', name: 'Carbon Credit Marketplace', enabled: true, category: 'carbon' },
        ],
      },
      {
        platformId: 'bloodbox',
        platformName: 'BloodBOX',
        licensed: true,
        features: [
          { id: 'f9', name: 'IoT Sensor Integration', enabled: true, category: 'iot' },
          { id: 'f10', name: 'API Integration', enabled: true, category: 'api' },
        ],
      },
    ],
  },
]

// Build a rich Transformer (with digital-twin sensors) from a canonical fleet
// transformer host. The fleet host is the single source of truth for identity,
// org, site, rating and status; this only synthesizes the sensor telemetry.
function makeTransformer(host: TransformerHost): Transformer {
  const status = host.status === 'OFFLINE' ? 'NORMAL' : host.status
  const isWarning = status === 'WARNING'
  const isCritical = status === 'CRITICAL'
  const site = sites.find((s) => s.id === host.siteId)
  // deterministic small offset per host so map pins don't overlap
  const seed = host.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const jitter = ((seed % 20) - 10) / 5000

  return {
    id: host.id,
    name: host.name,
    orgId: host.orgId,
    location: site ? site.name : host.siteId,
    lat: (site?.lat ?? 13.7) + jitter,
    lng: (site?.lng ?? 100.5) + jitter,
    status,
    healthIndex: host.healthIndex,
    kva: host.kva,
    voltage: host.voltage,
    manufacturer: ['ABB', 'Siemens', 'Schneider Electric', 'GE', 'Mitsubishi'][seed % 5],
    installDate: `201${seed % 9}-0${(seed % 9) + 1}-15`,
    model: host.model,
    serialNumber: host.serial,
    lastUpdated: new Date().toISOString(),
    sensors: {
      oilTemperature: {
        value: isCritical ? 92 : isWarning ? 82 : 68.4,
        unit: '°C',
        status: isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL',
        min: 45,
        max: 105,
        threshold: { warning: 80, critical: 95 },
        trend: isWarning ? 'up' : 'stable',
        delta: isWarning ? 2.3 : -0.5,
        history: generateHistory(isCritical ? 92 : isWarning ? 82 : 68, isCritical ? 4 : 3),
      },
      hydrogen: {
        value: isCritical ? 210 : isWarning ? 145 : 120,
        unit: 'ppm',
        status: isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL',
        min: 0,
        max: 500,
        threshold: { warning: 150, critical: 300 },
        trend: isWarning ? 'up' : 'stable',
        delta: isWarning ? 8.2 : 1.1,
        history: generateHistory(isCritical ? 210 : isWarning ? 145 : 120, 15),
      },
      moisture: {
        value: isCritical ? 35 : isWarning ? 28 : 18,
        unit: 'ppm',
        status: isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL',
        min: 0,
        max: 50,
        threshold: { warning: 25, critical: 35 },
        trend: 'stable',
        delta: 0.2,
        history: generateHistory(isCritical ? 35 : isWarning ? 28 : 18, 2),
      },
      oilLevel: {
        value: isCritical ? 55 : isWarning ? 65 : 78,
        unit: '%',
        status: isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL',
        min: 0,
        max: 100,
        threshold: { warning: 70, critical: 60 },
        trend: isWarning ? 'down' : 'stable',
        delta: isWarning ? -1.5 : 0,
        history: generateHistory(isCritical ? 55 : isWarning ? 65 : 78, 2),
      },
      load: {
        value: isCritical ? 95 : isWarning ? 85 : 65,
        unit: '%',
        status: isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL',
        min: 0,
        max: 100,
        threshold: { warning: 80, critical: 95 },
        trend: isWarning ? 'up' : 'stable',
        delta: isWarning ? 3.1 : -1.2,
        history: generateHistory(isCritical ? 95 : isWarning ? 85 : 65, 5),
      },
      ambientTemperature: {
        value: 32,
        unit: '°C',
        status: 'NORMAL',
        min: 10,
        max: 50,
        threshold: { warning: 40, critical: 50 },
        trend: 'stable',
        delta: 0.5,
        history: generateHistory(32, 2),
      },
    },
  }
}

// Single source of truth: derive the rich transformer list from fleet hosts.
export const transformers: Transformer[] = hosts
  .filter((h): h is TransformerHost => h.domain === 'transformer')
  .map(makeTransformer)

// Generate alarms from any non-NORMAL transformer host — single source of truth.
type AlarmKey = 'oilTemp' | 'hydrogen' | 'oilLevel'
const ALARM_CFG: Record<AlarmKey, { sensor: string; unit: string; msg: (v: number) => string }> = {
  oilTemp: { sensor: 'Oil Temperature', unit: '°C', msg: (v) => `Oil Temperature exceeded critical threshold (${v}°C)` },
  hydrogen: { sensor: 'Hydrogen H2', unit: 'ppm', msg: (v) => `Dissolved hydrogen rising above warning level (${v} ppm)` },
  oilLevel: { sensor: 'Oil Level', unit: '%', msg: (v) => `Oil level critically low (${v}%)` },
}
const sensorOf = (t: Transformer, key: AlarmKey) =>
  key === 'oilTemp' ? t.sensors.oilTemperature : key === 'hydrogen' ? t.sensors.hydrogen : t.sensors.oilLevel

export const alarms: Alarm[] = transformers.flatMap((t, ti) => {
  const out: Alarm[] = []
  const add = (severity: 'CRITICAL' | 'WARNING', key: AlarmKey) => {
    const s = sensorOf(t, key)
    const cfg = ALARM_CFG[key]
    out.push({
      id: `a-${t.id}-${out.length + 1}`,
      transformerId: t.id,
      transformerName: t.name,
      orgId: t.orgId,
      severity,
      message: cfg.msg(s.value),
      sensor: cfg.sensor,
      value: s.value,
      unit: cfg.unit,
      threshold: severity === 'CRITICAL' ? s.threshold.critical : s.threshold.warning,
      timestamp: new Date(Date.now() - (ti * 13 + out.length * 7 + 5) * 60000).toISOString(),
      acknowledged: false,
    })
  }
  if (t.status === 'CRITICAL') { add('CRITICAL', 'oilTemp'); add('CRITICAL', 'oilLevel') }
  else if (t.status === 'WARNING') { add('WARNING', 'hydrogen') }
  return out
})

export const auditLogs: AuditLog[] = [
  {
    id: 'al1',
    actor: 'superadmin',
    action: 'Updated entitlement',
    target: 'KMUTT University - AI Diagnostics',
    timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
    ipAddress: '192.168.1.1',
    status: 'success',
  },
  {
    id: 'al2',
    actor: 'superadmin',
    action: 'Created organization',
    target: 'New Factory Ltd',
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    ipAddress: '192.168.1.1',
    status: 'success',
  },
  {
    id: 'al3',
    actor: 'admin@org-2',
    action: 'Acknowledged alarm',
    target: 'TR-007 - Load Warning',
    timestamp: new Date(Date.now() - 3 * 3600000).toISOString(),
    ipAddress: '10.0.0.45',
    status: 'success',
  },
  {
    id: 'al4',
    actor: 'unknown',
    action: 'Login attempt failed',
    target: 'superadmin account',
    timestamp: new Date(Date.now() - 5 * 3600000).toISOString(),
    ipAddress: '203.55.12.88',
    status: 'failure',
  },
  {
    id: 'al5',
    actor: 'superadmin',
    action: 'Deployed platform update',
    target: 'ETERNITY v2.4.1',
    timestamp: new Date(Date.now() - 8 * 3600000).toISOString(),
    ipAddress: '192.168.1.1',
    status: 'success',
  },
  {
    id: 'al6',
    actor: 'admin@org-3',
    action: 'Generated report',
    target: 'TR-011 Monthly Report',
    timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
    ipAddress: '10.0.1.22',
    status: 'success',
  },
  {
    id: 'al7',
    actor: 'superadmin',
    action: 'Modified license tier',
    target: 'Factory Alpha - Professional',
    timestamp: new Date(Date.now() - 24 * 3600000).toISOString(),
    ipAddress: '192.168.1.1',
    status: 'success',
  },
]

export const platformStats: PlatformStats = {
  totalOrganizations: 124,
  activeTransformers: 4247,
  dataVolume: '4.2 PB',
  uptime: 99.97,
  activeAlarms: 23,
  criticalAlarms: 4,
}
