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
  // Org A — transformer + carbonNode (refrigeration) licensed
  { id: 'dept-bb', orgId: 'org-1', name: 'Department bb', themeIds: ['th-overview', 'th-fix', 'th-refrig'], productAccess: { transformer: 'manage', carbonNode: 'view' } },
  { id: 'dept-cc', orgId: 'org-1', name: 'Department cc', themeIds: ['th-overview', 'th-map'], productAccess: { carbonNode: 'manage' } },
  // Org B — transformer + bloodBox licensed
  { id: 'dept-dd', orgId: 'org-2', name: 'Department dd', themeIds: ['th-overview', 'th-twin'], productAccess: { transformer: 'manage', bloodBox: 'view' } },
  { id: 'dept-ee', orgId: 'org-2', name: 'Department ee', themeIds: ['th-overview', 'th-free', 'th-map'], productAccess: { bloodBox: 'manage' } },
]

export const managedUsers: ManagedUser[] = [
  // Org A
  { id: 'u-aa', orgId: 'org-1', name: 'User AA', username: 'aa', email: 'aa@org-a.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-bb', orgId: 'org-1', name: 'User BB', username: 'bb', email: 'bb@org-a.io', role: 'admin', departmentIds: [], status: 'active' },
  { id: 'u-cc', orgId: 'org-1', name: 'User CC', username: 'cc', email: 'cc@org-a.io', role: 'viewer', departmentIds: ['dept-bb'], status: 'active' },
  { id: 'u-dd', orgId: 'org-1', name: 'User DD', username: 'dd', email: 'dd@org-a.io', role: 'viewer', departmentIds: ['dept-bb'], status: 'active', productAccess: { transformer: 'view' } },
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
  { id: 'dev-1', orgId: 'org-1', name: 'Cold Room #1', serial: 'RFG-00:1A:01', deviceType: 'Refrigeration Logger', domain: 'carbonNode', location: 'Warehouse A', theme: 'fix', departmentIds: ['dept-bb'], status: 'online', lastValue: '4.1°C' },
  { id: 'dev-2', orgId: 'org-1', name: 'Cold Room #2', serial: 'RFG-00:1A:02', deviceType: 'Refrigeration Logger', domain: 'carbonNode', location: 'Warehouse A', theme: 'fix', departmentIds: ['dept-bb', 'dept-cc'], status: 'online', lastValue: '5.3°C' },
  { id: 'dev-3', orgId: 'org-1', name: 'Freezer #1', serial: 'RFG-00:1A:03', deviceType: 'Refrigeration Logger', domain: 'carbonNode', location: 'Warehouse B', theme: 'freestyle', departmentIds: ['dept-cc'], status: 'offline', lastValue: '-18.0°C' },
  { id: 'NAT-GW-01', orgId: 'org-1', name: 'NAT-GW-01 Formula EV', serial: 'NAT-GW-DEV2025', deviceType: 'Formula EV Telemetry Gateway', domain: 'automobile', location: 'Track / Test Bench', theme: 'fix', departmentIds: ['dept-bb'], status: 'online', lastValue: 'Fatigue 24%' },
  // Org B — transformers
  { id: 'dev-4', orgId: 'org-2', name: 'Transformer T1', serial: 'TRF-SN100231', deviceType: 'Power Transformer', domain: 'transformer', location: 'Substation North', theme: 'fix', departmentIds: ['dept-dd'], status: 'online', lastValue: '68.4°C' },
  { id: 'dev-5', orgId: 'org-2', name: 'Transformer T2', serial: 'TRF-SN100232', deviceType: 'Power Transformer', domain: 'transformer', location: 'Substation East', theme: 'freestyle', departmentIds: ['dept-dd', 'dept-ee'], status: 'online', lastValue: '82.1°C' },
  { id: 'dev-6', orgId: 'org-2', name: 'Transformer T3', serial: 'TRF-SN100233', deviceType: 'Power Transformer', domain: 'transformer', location: 'Substation West', theme: 'fix', departmentIds: ['dept-ee'], status: 'online', lastValue: '71.0°C' },
]

export const defaultNotificationChannels: NotificationChannelConfig[] = [
  { id: 'email', name: 'Email', enabled: true, target: 'ops@customer.com', minSeverity: 'WARNING' },
  { id: 'line', name: 'LINE', enabled: true, target: 'LINE Notify token ••••', minSeverity: 'WARNING' },
  { id: 'telegram', name: 'Telegram', enabled: false, target: '@ops_bot', minSeverity: 'WARNING' },
  { id: 'googlechat', name: 'Google Chat', enabled: false, target: 'webhook ••••', minSeverity: 'WARNING' },
]

export const eventProblems: EventProblem[] = [
  // Thermal & Oil
  { id: 'ev-top-oil-high', label: 'Top Oil Temperature High (> 85°C)' },
  { id: 'ev-top-oil-critical', label: 'Top Oil Temperature Critical (Insulation Damage Risk > 90°C)' },
  { id: 'ev-winding-temp', label: 'Winding / Hot-Spot Temp High' },
  // Voltage
  { id: 'ev-over-voltage-warn', label: 'Over Voltage Warning (> +5% rated voltage)' },
  { id: 'ev-over-voltage-crit', label: 'Over Voltage Critical (Equipment Damage Risk > +10%)' },
  { id: 'ev-under-voltage-warn', label: 'Under Voltage Warning (< -5% rated voltage)' },
  { id: 'ev-under-voltage-crit', label: 'Under Voltage Critical (< -10% rated voltage)' },
  // Current
  { id: 'ev-over-current-warn', label: 'Over Current (Overload) Warning (> 100% to 115%)' },
  { id: 'ev-over-current-crit', label: 'Over Current (Short Circuit) Critical (> 115%)' },
  // Power Quality
  { id: 'ev-voltage-unbalance-warn', label: 'Voltage Unbalance High (> 2% between phases)' },
  { id: 'ev-voltage-unbalance-crit', label: 'Voltage Unbalance Critical (> 5% between phases)' },
  // Event/Fault
  { id: 'ev-external-fault', label: 'External Fault/Event (Animals, Lightning, Grid Trip)' },
  { id: 'ev-sensor-fault', label: 'Sensor Fault / Communication Loss' },
  { id: 'ev-offline', label: 'Device Offline' },
  { id: 'ev-other', label: 'Other / Manual Note' },
]

// Per-department event-problem catalogs. Each department in a customer org keeps
// its OWN list of problem types; the viewer's detailed-monitoring event log
// dropdown is populated from the user's department list.
export const departmentEventProblems: Record<string, EventProblem[]> = {
  // org-1 · dept-bb (transformer focus)
  'dept-bb': [
    { id: 'ev-bb-oiltemp', label: 'Top Oil Temp High / Critical (>85°C / >90°C)', departmentId: 'dept-bb' },
    { id: 'ev-bb-voltage', label: 'Over / Under Voltage (+5% / -5%)', departmentId: 'dept-bb' },
    { id: 'ev-bb-overcurrent', label: 'Over Current / Short Circuit Risk (>115%)', departmentId: 'dept-bb' },
    { id: 'ev-bb-unbalance', label: 'Voltage Unbalance (>2% / >5%)', departmentId: 'dept-bb' },
    { id: 'ev-bb-extfault', label: 'External Fault/Event (Lightning, Animals, etc.)', departmentId: 'dept-bb' },
    { id: 'ev-bb-h2', label: 'Hydrogen (H₂) Rising (DGA)', departmentId: 'dept-bb' },
    { id: 'ev-bb-offline', label: 'Device Offline', departmentId: 'dept-bb' },
    { id: 'ev-bb-other', label: 'Other / Manual Note', departmentId: 'dept-bb' },
  ],
  // org-1 · dept-cc (refrigeration focus)
  'dept-cc': [
    { id: 'ev-cc-temphigh', label: 'Temperature High', departmentId: 'dept-cc' },
    { id: 'ev-cc-door', label: 'Door Left Open', departmentId: 'dept-cc' },
    { id: 'ev-cc-defrost', label: 'Defrost Failure', departmentId: 'dept-cc' },
    { id: 'ev-cc-power', label: 'Power Loss', departmentId: 'dept-cc' },
    { id: 'ev-cc-other', label: 'Other / Manual Note', departmentId: 'dept-cc' },
  ],
  // org-2 · dept-dd (transformer focus)
  'dept-dd': [
    { id: 'ev-dd-oiltemp', label: 'Oil Temperature High', departmentId: 'dept-dd' },
    { id: 'ev-dd-moisture', label: 'Moisture High', departmentId: 'dept-dd' },
    { id: 'ev-dd-offline', label: 'Device Offline', departmentId: 'dept-dd' },
    { id: 'ev-dd-other', label: 'Other / Manual Note', departmentId: 'dept-dd' },
  ],
  // org-2 · dept-ee (bloodbox focus)
  'dept-ee': [
    { id: 'ev-ee-excursion', label: 'Temperature Excursion', departmentId: 'dept-ee' },
    { id: 'ev-ee-battery', label: 'Battery Low', departmentId: 'dept-ee' },
    { id: 'ev-ee-lid', label: 'Lid Opened in Transit', departmentId: 'dept-ee' },
    { id: 'ev-ee-signal', label: 'Signal Lost', departmentId: 'dept-ee' },
    { id: 'ev-ee-other', label: 'Other / Manual Note', departmentId: 'dept-ee' },
  ],
}

export const getEventProblemsByDept = (deptId: string): EventProblem[] =>
  departmentEventProblems[deptId] ?? eventProblems

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

// ---------------------------------------------------------------------------
// Dashboard View Permission -> what a viewer's navigation actually shows.
// ---------------------------------------------------------------------------
// The admin toggles themes per department; without this map that policy was
// stored and never applied, so every viewer saw the same menu.
//
// Only entries listed here are gated. Alarms, Reports and Profile deliberately
// are not: they are not dashboards, and a viewer who cannot reach their own
// profile (to set a password or their notification channels) is locked out of
// the product by a display preference.
export const THEME_NAV: Record<string, string[]> = {
  // Alarms and Reports hang off the overview: they are the same "what is my
  // fleet doing" question over time. They used to appear in NO theme at all, so
  // the moment an admin granted any theme both items vanished from every
  // viewer's nav with no way to grant them back — the gate was fail-closed for
  // two menu items nobody could open.
  'th-overview': ['/customer', '/customer/alarms', '/customer/reports', '/customer/trends'],
  // Indoor and outdoor location are one idea to an operator, and the admin nav
  // already groups them the same way. Both are the Sites feature's surface: a
  // site's floor plan and the same site's pin on the map.
  'th-map': ['/customer/map'],
  'th-fix': ['/customer/devices', '/customer/trends'],
  'th-free': ['/customer/devices', '/customer/trends'],
  'th-refrig': ['/customer/devices', '/customer/trends'],
  'th-twin': ['/customer/devices', '/customer/trends'],
}

/**
 * Nav hrefs no theme can gate. Profile is here because a viewer who cannot
 * reach it cannot change their own password or alert channels — locking someone
 * out of their own account is never the intent behind a dashboard permission.
 */
export const UNGATED_NAV = ['/customer/profile']

/** Hrefs a set of granted themes unlocks. Empty set = no policy = no gating. */
export function navHrefsForThemes(themeIds: string[]): Set<string> | null {
  if (!themeIds.length) return null
  const out = new Set<string>()
  for (const t of themeIds) for (const href of THEME_NAV[t] ?? []) out.add(href)
  return out
}
