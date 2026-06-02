// ---------------------------------------------------------------------------
// Mock organization hierarchy data
// ---------------------------------------------------------------------------
// Mirrors the "System Overview" diagram exactly:
//   Org A "Refrigeration Datalogger" (org-1): admins AA/BB,
//       Dept bb (view1) -> CC, DD ; Dept cc (view2) -> EE, FF, GG
//   Org B "Transformer" (org-2): admins HH/II,
//       Dept dd (view1) -> JJ, KK ; Dept ee (view2) -> LL, MM, NN
// ---------------------------------------------------------------------------

import type {
  Department, ManagedUser, ManagedDevice, DashboardTheme,
  NotificationChannelConfig, ReportSchedule, EventProblem,
} from '@/types/org'

export const dashboardThemes: DashboardTheme[] = [
  { id: 'th-overview', name: 'Overview Grid', description: 'All devices status grid + alarm summary', platformType: 'shared', accent: '#6366f1' },
  { id: 'th-map', name: 'Device Location Map', description: 'Geographic device map view', platformType: 'shared', accent: '#06b6d4' },
  { id: 'th-fix', name: 'Individual Device (FIX)', description: 'Picture, status and last value per device', platformType: 'shared', accent: '#22c55e' },
  { id: 'th-free', name: 'Individual Device (Free Style)', description: 'Custom gauge / graph composition', platformType: 'shared', accent: '#a78bfa' },
  { id: 'th-refrig', name: 'Refrigeration Node Grid', description: 'Cold-chain temperature & door monitor', platformType: 'refrigerationDataLogger', accent: '#22c55e' },
  { id: 'th-twin', name: 'Transformer Digital Twin', description: '3D transformer + DGA telemetry', platformType: 'eternityTransformers', accent: '#6366f1' },
]

export const roleLabels: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

export const departments: Department[] = [
  // Org A — Refrigeration Datalogger
  { id: 'dept-bb', orgId: 'org-1', name: 'Department bb', themeIds: ['th-overview', 'th-fix', 'th-refrig'] },
  { id: 'dept-cc', orgId: 'org-1', name: 'Department cc', themeIds: ['th-overview', 'th-map'] },
  // Org B — Transformer
  { id: 'dept-dd', orgId: 'org-2', name: 'Department dd', themeIds: ['th-overview', 'th-twin'] },
  { id: 'dept-ee', orgId: 'org-2', name: 'Department ee', themeIds: ['th-overview', 'th-free', 'th-map'] },
]

export const managedUsers: ManagedUser[] = [
  // Org A
  { id: 'u-aa', orgId: 'org-1', name: 'User AA', username: 'aa', email: 'aa@org-a.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-bb', orgId: 'org-1', name: 'User BB', username: 'bb', email: 'bb@org-a.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-cc', orgId: 'org-1', name: 'User CC', username: 'cc', email: 'cc@org-a.io', role: 'viewer', departmentIds: ['dept-bb'], status: 'active' },
  { id: 'u-dd', orgId: 'org-1', name: 'User DD', username: 'dd', email: 'dd@org-a.io', role: 'viewer', departmentIds: ['dept-bb'], status: 'active' },
  { id: 'u-ee', orgId: 'org-1', name: 'User EE', username: 'ee', email: 'ee@org-a.io', role: 'viewer', departmentIds: ['dept-cc'], status: 'active' },
  { id: 'u-ff', orgId: 'org-1', name: 'User FF', username: 'ff', email: 'ff@org-a.io', role: 'editor', departmentIds: ['dept-cc'], status: 'active' },
  { id: 'u-gg', orgId: 'org-1', name: 'User GG', username: 'gg', email: 'gg@org-a.io', role: 'viewer', departmentIds: ['dept-cc'], status: 'invited' },
  // Org B
  { id: 'u-hh', orgId: 'org-2', name: 'User HH', username: 'hh', email: 'hh@org-b.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-ii', orgId: 'org-2', name: 'User II', username: 'ii', email: 'ii@org-b.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-jj', orgId: 'org-2', name: 'User JJ', username: 'jj', email: 'jj@org-b.io', role: 'viewer', departmentIds: ['dept-dd'], status: 'active' },
  { id: 'u-kk', orgId: 'org-2', name: 'User KK', username: 'kk', email: 'kk@org-b.io', role: 'viewer', departmentIds: ['dept-dd'], status: 'active' },
  { id: 'u-ll', orgId: 'org-2', name: 'User LL', username: 'll', email: 'll@org-b.io', role: 'viewer', departmentIds: ['dept-ee'], status: 'active' },
  { id: 'u-mm', orgId: 'org-2', name: 'User MM', username: 'mm', email: 'mm@org-b.io', role: 'editor', departmentIds: ['dept-ee'], status: 'active' },
  { id: 'u-nn', orgId: 'org-2', name: 'User NN', username: 'nn', email: 'nn@org-b.io', role: 'viewer', departmentIds: ['dept-ee'], status: 'disabled' },
]

export const managedDevices: ManagedDevice[] = [
  // Org A — refrigeration nodes
  { id: 'dev-1', orgId: 'org-1', name: 'Cold Room #1', serial: 'RFG-00:1A:01', deviceType: 'Refrigeration Logger', location: 'Warehouse A', theme: 'fix', departmentIds: ['dept-bb'], status: 'online', lastValue: '4.1°C' },
  { id: 'dev-2', orgId: 'org-1', name: 'Cold Room #2', serial: 'RFG-00:1A:02', deviceType: 'Refrigeration Logger', location: 'Warehouse A', theme: 'fix', departmentIds: ['dept-bb', 'dept-cc'], status: 'online', lastValue: '5.3°C' },
  { id: 'dev-3', orgId: 'org-1', name: 'Freezer #1', serial: 'RFG-00:1A:03', deviceType: 'Refrigeration Logger', location: 'Warehouse B', theme: 'freestyle', departmentIds: ['dept-cc'], status: 'offline', lastValue: '-18.0°C' },
  // Org B — transformers
  { id: 'dev-4', orgId: 'org-2', name: 'Transformer T1', serial: 'TRF-SN100231', deviceType: 'Power Transformer', location: 'Substation North', theme: 'fix', departmentIds: ['dept-dd'], status: 'online', lastValue: '68.4°C' },
  { id: 'dev-5', orgId: 'org-2', name: 'Transformer T2', serial: 'TRF-SN100232', deviceType: 'Power Transformer', location: 'Substation East', theme: 'freestyle', departmentIds: ['dept-dd', 'dept-ee'], status: 'online', lastValue: '82.1°C' },
  { id: 'dev-6', orgId: 'org-2', name: 'Transformer T3', serial: 'TRF-SN100233', deviceType: 'Power Transformer', location: 'Substation West', theme: 'fix', departmentIds: ['dept-ee'], status: 'online', lastValue: '71.0°C' },
]

export const defaultNotificationChannels: NotificationChannelConfig[] = [
  { id: 'email', name: 'Email', enabled: true, target: 'ops@customer.com' },
  { id: 'line', name: 'LINE', enabled: true, target: 'LINE Notify token ••••' },
  { id: 'telegram', name: 'Telegram', enabled: false, target: '@ops_bot' },
  { id: 'googlechat', name: 'Google Chat', enabled: false, target: 'webhook ••••' },
]

export const eventProblems: EventProblem[] = [
  { id: 'ev-temp-high', label: 'Temperature High' },
  { id: 'ev-temp-low', label: 'Temperature Low' },
  { id: 'ev-door-open', label: 'Door Left Open' },
  { id: 'ev-power-loss', label: 'Power Loss' },
  { id: 'ev-sensor-fault', label: 'Sensor Fault' },
  { id: 'ev-offline', label: 'Device Offline' },
  { id: 'ev-other', label: 'Other / Manual Note' },
]

export const reportSchedules: ReportSchedule[] = [
  { id: 'rs-1', name: 'Daily Cold-Chain Summary', scope: 'department', scopeId: 'dept-bb', sequence: 'daily', format: 'PDF', enabled: true },
  { id: 'rs-2', name: 'Weekly Transformer Health', scope: 'department', scopeId: 'dept-dd', sequence: 'weekly', format: 'XLSX', enabled: true },
  { id: 'rs-3', name: 'Monthly Compliance Export', scope: 'device', scopeId: 'dev-1', sequence: 'monthly', format: 'PDF', enabled: false },
]

// Convenience selectors -----------------------------------------------------
export const getDepartmentsByOrg = (orgId: string) => departments.filter((d) => d.orgId === orgId)
export const getUsersByOrg = (orgId: string) => managedUsers.filter((u) => u.orgId === orgId)
export const getDevicesByOrg = (orgId: string) => managedDevices.filter((d) => d.orgId === orgId)
export const getThemeById = (id: string) => dashboardThemes.find((t) => t.id === id)
