// ---------------------------------------------------------------------------
// Organization hierarchy types
// ---------------------------------------------------------------------------
// Models the System Overview diagram:
//   Super Admin -> Organization (by sensor type) -> Admin
//                  -> Department (view) -> Users
// plus the device / role / theme / notification entities the Admin and Viewer
// flows operate on.
// ---------------------------------------------------------------------------

export type ManagedRole = 'admin' | 'editor' | 'viewer'

export interface Department {
  id: string
  orgId: string
  name: string
  /** Dashboard theme ids this department is permitted to view. */
  themeIds: string[]
  /**
   * Per-product access for this department's users, keyed by sensor domain
   * ('transformer' | 'carbonNode' | 'bloodBox'). Absent = no access.
   * 'view' = can see the monitoring view; 'manage' = can see & manage.
   */
  productAccess?: Record<string, 'view' | 'manage'>
}

export interface ManagedUser {
  id: string
  orgId: string
  name: string
  username: string
  email: string
  role: ManagedRole
  /** A user can belong to multiple departments. */
  departmentIds: string[]
  status: 'active' | 'invited' | 'disabled'
}

export interface ManagedDevice {
  id: string
  orgId: string
  name: string
  serial: string
  /** Sensor type / model. */
  deviceType: string
  /** Sensor domain: refrigerationDataLogger / bloodBox / eternityTransformers. */
  domain?: 'transformer' | 'carbonNode' | 'bloodBox'
  /** Site that hosts this device. */
  siteId?: string
  location: string
  /** Dashboard render style for this device. */
  theme: 'fix' | 'freestyle'
  /** A device can be assigned to multiple departments. */
  departmentIds: string[]
  status: 'online' | 'offline'
  picture?: string
  lastValue?: string
}

export interface DashboardTheme {
  id: string
  name: string
  description: string
  /** Which sensor platform this theme targets ('shared' = any). */
  platformType: string
  accent: string
}

export type NotificationChannelId = 'email' | 'line' | 'telegram' | 'googlechat'

export interface NotificationChannelConfig {
  id: NotificationChannelId
  name: string
  enabled: boolean
  /** Address / token / webhook target. */
  target: string
}

export type ReportSequence = 'daily' | 'weekly' | 'monthly'

export interface ReportSchedule {
  id: string
  name: string
  scope: 'device' | 'department'
  scopeId: string
  sequence: ReportSequence
  format: 'PDF' | 'XLSX' | 'CSV'
  enabled: boolean
}

export interface EventProblem {
  id: string
  label: string
  /** The department this problem list belongs to (per-department event catalog). */
  departmentId?: string
}
