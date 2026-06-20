// ---------------------------------------------------------------------------
// BloodBOX domain data (ERD #4): transits, journey events, building floors.
// Powers the Indoor Tracking + Transit Map module screens.
// ---------------------------------------------------------------------------

export type JourneyEventType =
  | 'gps_checkin' | 'building_entered' | 'security_pass' | 'lift_entered' | 'lift_exited' | 'storage_arrived'
export type JourneySignal = 'GPS' | 'BLE' | 'BAROMETER' | 'MANUAL'

export interface JourneyEvent {
  id: string
  transitId: string
  type: JourneyEventType
  label: string
  floor: number
  signal: JourneySignal
  time: string
  done: boolean
}

export interface BuildingFloor {
  number: number
  label: string
}

export type BeaconStatus = 'active' | 'inactive' | 'low_battery'

export interface BleBeacon {
  id: string
  floor: number
  uuid: string
  major: number
  minor: number
  /** schematic position on the floor (percent) */
  x: number
  y: number
  txPower: number
  battery: number
  status: BeaconStatus
}

export interface BloodBoxTransit {
  id: string
  boxCode: string
  courier: string
  courierPhone: string
  fromLabel: string
  toLabel: string
  etaMin: number
  plannedEtaMin: number
  status: 'in_transit' | 'arrived' | 'delayed'
  transitState?: 'PACKING' | 'IN_TRANSIT' | 'DELIVERED'
  currentTempC: number
  maxTempC: number
  battery: number
  currentFloor: number
  targetFloor: number
  tempHistory: number[]
  /** schematic map position (percent) */
  x: number
  y: number
  signal4g: string
  lastConnection: string
}

export const buildingFloors: BuildingFloor[] = [
  { number: 5, label: 'คลังเลือด (เป้าหมาย)' },
  { number: 4, label: 'หอผู้ป่วยใน' },
  { number: 3, label: 'ห้องผ่าตัด' },
  { number: 2, label: 'ห้องปฏิบัติการ' },
  { number: 1, label: 'ประตูหลัก / จุดคัดกรอง' },
]

export const bloodBoxTransits: BloodBoxTransit[] = [
  {
    id: 't2', boxCode: 'BBOX-18', courier: 'สมชาย ขนส่ง', courierPhone: '081-123-4567',
    fromLabel: 'สภากาชาด', toLabel: 'รพ.ศูนย์ (คลังเลือด)',
    etaMin: 5, plannedEtaMin: 20, status: 'in_transit', transitState: 'IN_TRANSIT',
    currentTempC: 4.8, maxTempC: 6, battery: 65,
    currentFloor: 1, targetFloor: 5, tempHistory: [3.9, 4.0, 4.2, 4.1, 4.5, 4.8],
    x: 42, y: 75, signal4g: 'สัญญาณ 4G เสถียร', lastConnection: '1 นาทีที่แล้ว',
  },
  {
    id: 't3', boxCode: 'BBOX-22', courier: 'พยาบาลวิภา', courierPhone: '114',
    fromLabel: 'คลังเลือด ชั้น 1', toLabel: 'ห้องผ่าตัด ชั้น 5',
    etaMin: 2, plannedEtaMin: 5, status: 'in_transit', transitState: 'IN_TRANSIT',
    currentTempC: 4.5, maxTempC: 6, battery: 88,
    currentFloor: 3, targetFloor: 5, tempHistory: [4.2, 4.2, 4.3, 4.4, 4.5],
    x: 48, y: 55, signal4g: 'สัญญาณ 4G เสถียร', lastConnection: '1 นาทีที่แล้ว',
  },
  {
    id: 't1', boxCode: 'BBOX-09', courier: 'สมศักดิ์ ขนส่ง', courierPhone: '089-987-6543',
    fromLabel: 'ศูนย์บริจาค', toLabel: 'รพ.ศูนย์ (คลังเลือด)',
    etaMin: 45, plannedEtaMin: 40, status: 'delayed', transitState: 'IN_TRANSIT',
    currentTempC: 7.2, maxTempC: 6, battery: 42,
    currentFloor: 1, targetFloor: 5, tempHistory: [4.5, 4.8, 5.2, 6.1, 6.8, 7.2],
    x: 25, y: 60, signal4g: 'สัญญาณ 4G เสถียร', lastConnection: '1 นาทีที่แล้ว',
  },
]

export const journeyEvents: JourneyEvent[] = [
  { id: 'je-1', transitId: 'tx-1', type: 'gps_checkin', label: 'ถึงประตูโรงพยาบาล (GPS Check-in)', floor: 0, signal: 'GPS', time: '10:05', done: true },
  { id: 'je-2', transitId: 'tx-1', type: 'building_entered', label: 'เข้าสู่อาคารอุบัติเหตุ', floor: 1, signal: 'BLE', time: '10:08', done: true },
  { id: 'je-3', transitId: 'tx-1', type: 'security_pass', label: 'ผ่านจุดคัดกรอง ชั้น 1', floor: 1, signal: 'BLE', time: '10:10', done: true },
  { id: 'je-4', transitId: 'tx-1', type: 'lift_exited', label: 'ออกจากลิฟต์ ชั้น 5', floor: 5, signal: 'BAROMETER', time: '10:12', done: true },
  { id: 'je-5', transitId: 'tx-1', type: 'storage_arrived', label: 'ถึงหน้าคลังเลือด (รอสแกนรับเข้า)', floor: 5, signal: 'BLE', time: '10:15', done: false },
]

// BLE beacons placed on each floor — anchors for indoor positioning of boxes.
export const bleBeacons: BleBeacon[] = [
  { id: 'bcn-101', floor: 1, uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 1, minor: 11, x: 28, y: 60, txPower: -59, battery: 92, status: 'active' },
  { id: 'bcn-102', floor: 1, uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 1, minor: 12, x: 70, y: 40, txPower: -59, battery: 88, status: 'active' },
  { id: 'bcn-301', floor: 3, uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 3, minor: 31, x: 50, y: 50, txPower: -62, battery: 31, status: 'low_battery' },
  { id: 'bcn-501', floor: 5, uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 5, minor: 51, x: 40, y: 55, txPower: -59, battery: 76, status: 'active' },
  { id: 'bcn-502', floor: 5, uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 5, minor: 52, x: 64, y: 30, txPower: -59, battery: 0, status: 'inactive' },
]

export const journeyEventTypeLabels: Record<JourneyEventType, string> = {
  gps_checkin: 'GPS Check-in (ถึงหน้าอาคาร)',
  building_entered: 'เข้าสู่อาคาร',
  security_pass: 'ผ่านจุดคัดกรอง',
  lift_entered: 'เข้าลิฟต์',
  lift_exited: 'ออกจากลิฟต์',
  storage_arrived: 'ถึงคลังเลือด',
}

export const isExcursion = (t: BloodBoxTransit) => t.currentTempC > t.maxTempC
export const getJourney = (transitId: string) => journeyEvents.filter((e) => e.transitId === transitId)
export const getBeaconsByFloor = (floor: number) => bleBeacons.filter((b) => b.floor === floor)
