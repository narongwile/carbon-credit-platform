// ---------------------------------------------------------------------------
// Fleet ERD #2 — firmware history, cellular links, LoRa peers (mock)
// ---------------------------------------------------------------------------

export interface DeviceFirmwareHistory {
  id: string
  deviceId: string
  fromVersion: string
  toVersion: string
  artefactSha256: string
  initiatedAt: string
  completedAt: string | null
  result: 'success' | 'failed' | 'rolled_back' | 'abandoned'
  failureReason?: string
  performedBy: string
}

export interface CellularLink {
  deviceId: string
  imei: string
  iccid: string
  apn: string
  operatorMccMnc: string
  lastRssiDbm: number
  lastBand: string
  dataUsedMb: number
  simStatus: 'active' | 'suspended' | 'inactive'
}

export interface LoraPeer {
  id: string
  interfaceId: string
  devaddr: string
  spreadingFactor: string
  freqBand: string
  lastSeenAt: string
  lastRssiDbm: number
}

export const deviceFirmwareHistory: DeviceFirmwareHistory[] = [
  { id: 'fw-1', deviceId: 'dev-tr1', fromVersion: '2.3.9', toVersion: '2.4.1', artefactSha256: '9f2a…c41b', initiatedAt: '2026-05-12T02:10:00Z', completedAt: '2026-05-12T02:18:00Z', result: 'success', performedBy: 'superadmin' },
  { id: 'fw-2', deviceId: 'dev-cn1', fromVersion: '1.8.7', toVersion: '1.9.0', artefactSha256: '3b71…aa90', initiatedAt: '2026-05-20T09:00:00Z', completedAt: '2026-05-20T09:06:00Z', result: 'success', performedBy: 'superadmin' },
  { id: 'fw-3', deviceId: 'dev-bb1', fromVersion: '1.2.2', toVersion: '1.2.3', artefactSha256: 'c00f…12de', initiatedAt: '2026-05-28T14:30:00Z', completedAt: null, result: 'rolled_back', failureReason: 'CRC mismatch on flash', performedBy: 'superadmin' },
]

export const cellularLinks: CellularLink[] = [
  { deviceId: 'dev-tr1', imei: '356938035643809', iccid: '8966032820000123456', apn: 'iot.true.th', operatorMccMnc: '52000', lastRssiDbm: -71, lastBand: 'LTE B3', dataUsedMb: 184.2, simStatus: 'active' },
  // BloodBOX GNSS module carries a 4G SIM — internet fallback when WiFi drops.
  { deviceId: 'dev-bb1', imei: '356938035699001', iccid: '8966032820000987654', apn: 'iot.ais.th', operatorMccMnc: '52003', lastRssiDbm: -83, lastBand: 'LTE B8', dataUsedMb: 92.6, simStatus: 'active' },
]

export const loraPeers: LoraPeer[] = [
  { id: 'lp-1', interfaceId: 'if-bb1-lora', devaddr: '26011A2B', spreadingFactor: 'SF9', freqBand: 'AS923', lastSeenAt: new Date().toISOString(), lastRssiDbm: -98 },
]

export const getFirmwareByDevice = (deviceId: string) => deviceFirmwareHistory.filter((f) => f.deviceId === deviceId)
export const getCellularByDevice = (deviceId: string) => cellularLinks.find((c) => c.deviceId === deviceId)
