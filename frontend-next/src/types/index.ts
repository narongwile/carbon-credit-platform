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
  manufacturer: string
  installDate: string
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
