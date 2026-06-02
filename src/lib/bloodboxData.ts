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
    id: 'tx-1', boxCode: 'BOX-CHY-001', courier: 'อสม. สมใจ รักดี', courierPhone: '081-xxx-xxxx',
    fromLabel: 'รพ.สต. เชียงยืน', toLabel: 'คลังเลือด รพ.ศูนย์', etaMin: 12, plannedEtaMin: 15,
    status: 'in_transit', currentTempC: 4.2, maxTempC: 8, battery: 85, currentFloor: 5, targetFloor: 5,
    tempHistory: [4.0, 4.1, 4.3, 4.2, 4.1, 4.2], x: 46, y: 46, signal4g: 'สัญญาณ 4G เสถียร', lastConnection: 'เมื่อสักครู่',
  },
  {
    id: 'tx-2', boxCode: 'BOX-CHY-002', courier: 'อสม. สมหมาย ใจดี', courierPhone: '082-xxx-xxxx',
    fromLabel: 'รพ.สต. โกสุมพิสัย', toLabel: 'คลังเลือด รพ.ศูนย์', etaMin: 25, plannedEtaMin: 20,
    status: 'delayed', currentTempC: 9.5, maxTempC: 8, battery: 62, currentFloor: 1, targetFloor: 5,
    tempHistory: [4.5, 5.2, 6.8, 7.9, 8.8, 9.5], x: 72, y: 22, signal4g: 'สัญญาณ 4G อ่อน', lastConnection: '2 นาทีที่แล้ว',
  },
  {
    id: 'tx-5', boxCode: 'BOX-CHY-005', courier: 'อสม. วันดี ศรีสุข', courierPhone: '083-xxx-xxxx',
    fromLabel: 'รพ.สต. บรบือ', toLabel: 'คลังเลือด รพ.ศูนย์', etaMin: 45, plannedEtaMin: 45,
    status: 'in_transit', currentTempC: 3.8, maxTempC: 8, battery: 91, currentFloor: 1, targetFloor: 5,
    tempHistory: [3.6, 3.7, 3.9, 3.8, 3.8, 3.8], x: 84, y: 78, signal4g: 'สัญญาณ 4G เสถียร', lastConnection: '1 นาทีที่แล้ว',
  },
]

export const journeyEvents: JourneyEvent[] = [
  { id: 'je-1', transitId: 'tx-1', type: 'gps_checkin', label: 'ถึงประตูโรงพยาบาล (GPS Check-in)', floor: 0, signal: 'GPS', time: '10:05', done: true },
  { id: 'je-2', transitId: 'tx-1', type: 'building_entered', label: 'เข้าสู่อาคารอุบัติเหตุ', floor: 1, signal: 'BLE', time: '10:08', done: true },
  { id: 'je-3', transitId: 'tx-1', type: 'security_pass', label: 'ผ่านจุดคัดกรอง ชั้น 1', floor: 1, signal: 'BLE', time: '10:10', done: true },
  { id: 'je-4', transitId: 'tx-1', type: 'lift_exited', label: 'ออกจากลิฟต์ ชั้น 5', floor: 5, signal: 'BAROMETER', time: '10:12', done: true },
  { id: 'je-5', transitId: 'tx-1', type: 'storage_arrived', label: 'ถึงหน้าคลังเลือด (รอสแกนรับเข้า)', floor: 5, signal: 'BLE', time: '10:15', done: false },
]

export const isExcursion = (t: BloodBoxTransit) => t.currentTempC > t.maxTempC
export const getJourney = (transitId: string) => journeyEvents.filter((e) => e.transitId === transitId)
