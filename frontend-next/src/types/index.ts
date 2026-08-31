export type UserRole = 'superadmin' | 'admin' | 'customer'

export interface User {
  id: string
  username: string
  role: UserRole
  orgId?: string
  name: string
  email: string
}

export interface Organization {
  id: string
  name: string
  type: string
  country: string
  city: string
  lat: number
  lng: number
  transformerCount: number
  status: 'active' | 'inactive' | 'suspended'
  licenseTier: 'basic' | 'professional' | 'enterprise'
  platforms: PlatformAccess[]
  createdAt: string
  contactEmail: string
}

export interface PlatformAccess {
  platformId: string
  platformName: string
  licensed: boolean
  features: FeatureToggle[]
}

export interface FeatureToggle {
  id: string
  name: string
  enabled: boolean
  category: string
}

export type TransformerStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'

export interface Transformer {
  id: string
  name: string
  orgId: string
  location: string
  lat: number
  lng: number
  status: TransformerStatus
  healthIndex: number
  kva: number
  voltage: string
  // Optional: real values come from node_nameplates (migrate-v31) once an
  // admin enters them, not from the seed. Was populated by hashing the
  // device id into a fake manufacturer/date — see mockData.ts makeTransformer.
  manufacturer?: string
  installDate?: string
  model: string
  serialNumber: string
  sensors: SensorData
  lastUpdated: string
}

export interface SensorData {
  oilTemperature: SensorReading
  hydrogen: SensorReading
  moisture: SensorReading
  oilLevel: SensorReading
  load: SensorReading
  ambientTemperature: SensorReading
  /**
   * Optional extended channels — beyond the six every transformer reports.
   * A unit fitted with a bushing tap adapter, an arrester leakage CT or an
   * instrumented OLTC publishes these as well, and the PdM studios key
   * "is this sensor installed?" off their presence.
   *
   * Optional precisely BECAUSE absence is meaningful: an undefined channel
   * means no instrument is fitted, which the studios must render differently
   * from a measured value — never as a default that reads as a reading.
   *
   * Declared explicitly rather than via an index signature: a
   * `[key: string]: SensorReading | undefined` here would make every one of
   * the six required channels above possibly-undefined at each of their ~30
   * existing call sites (store.ts, the sensor cards, the alarm engine), which
   * is a much larger and riskier change than naming the channels we support.
   */
  bushingTanDelta?: SensorReading
  partialDischarge?: SensorReading
  surgeArresterCurrent?: SensorReading
  surgeCounter?: SensorReading
  oltcMotorCurrent?: SensorReading
  oltcOilTempDelta?: SensorReading
}

export interface SensorReading {
  value: number
  unit: string
  status: 'NORMAL' | 'WARNING' | 'CRITICAL'
  min: number
  max: number
  threshold: { warning: number; critical: number }
  trend: 'up' | 'down' | 'stable'
  delta: number
  history: TrendPoint[]
}

export interface TrendPoint {
  time: string
  value: number
}

export interface Alarm {
  id: string
  transformerId: string
  transformerName: string
  orgId: string
  severity: 'CRITICAL' | 'WARNING' | 'INFO'
  message: string
  sensor: string
  value: number
  unit: string
  threshold: number
  timestamp: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
  /**
   * When the condition returned to normal — set by the Node-RED clear sweep
   * (clearSweepFunc, every 60s) once the parameter has stayed inside the
   * deadband for CLEAR_AFTER_MIN, and by the presence handler for an offline
   * alarm when the device reports back.
   *
   * Acknowledgement and clearing are INDEPENDENT (ISA-18.2): a breach can
   * recover without anyone acknowledging it, and can be acknowledged while
   * still breaching. The console read only `acknowledged`, so a condition that
   * recovered days ago rendered identically to one breaching right now — same
   * severity chip, same Acknowledge button, nothing to tell them apart.
   */
  clearedAt?: string
  source?: 'edge' | 'cloud'
}

export interface AuditLog {
  id: string
  actor: string
  action: string
  target: string
  timestamp: string
  ipAddress: string
  status: 'success' | 'failure'
}

export interface PlatformStats {
  totalOrganizations: number
  activeTransformers: number
  dataVolume: string
  uptime: number
  activeAlarms: number
  criticalAlarms: number
}
