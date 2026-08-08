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
   *
   * 'none' is a stored value, not an absence: product_access holds a row for it,
   * so the tab shows the deny an admin actually set rather than rendering it the
   * same as "never configured".
   */
  productAccess?: Record<string, 'none' | 'view' | 'manage'>
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
  /**
   * Only ever set while SUBMITTING the admin form — never returned by the API
   * and never held in the roster. Blank on an edit means "keep the current
   * password"; on a create it is required, because an account stored with a
   * NULL password_hash can never sign in.
   */
  password?: string
  /**
   * Per-user product-access override, keyed by sensor domain. Absent domain =
   * inherit from the user's department(s). An explicit value can only RESTRICT
   * (it is capped by the department grant): 'none' blocks, 'view'/'manage' lower
   * the level if the department allows more.
   */
  productAccess?: Record<string, 'none' | 'view' | 'manage'>
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
  /**
   * Lowest severity that reaches this channel. notify() enforces it —
   * "if (c.min_severity === 'CRITICAL' && e.severity !== 'CRITICAL') continue"
   * — and the column has always been stored and read; it just had no UI, so
   * every channel sat at the WARNING default and a separate, entirely fake
   * "severity routing" panel pretended to offer the same thing.
   */
  minSeverity?: 'WARNING' | 'CRITICAL'
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

// A document attached to a sensor node, visible only to the uploader's department.
export interface NodeDocument {
  id: string
  nodeId: string
  departmentId: string
  name: string
  size: string
  date: string
  uploadedBy: string
  dataUrl: string
}
