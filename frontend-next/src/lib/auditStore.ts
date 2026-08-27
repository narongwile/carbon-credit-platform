'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuditAction = 'THRESHOLD_CHANGE' | 'ALARM_SHELVE' | 'ALARM_SUPPRESS' | 'OTA_DEPLOY' | 'OTA_FLEET_DEPLOY' | 'CARBON_ADJUST' | 'FOUR_EYES_APPROVAL' | 'FOUR_EYES_REJECTION' | 'CONFIG_CHANGE'

export interface AuditRecord {
  id: string
  timestamp: string
  actor: { name: string; email: string; role: string }
  ipAddress: string
  action: AuditAction
  target: { assetId: string; assetName: string }
  before: string
  after: string
  justification: string
  workOrderId?: string
  checksum: string // SHA-256
  approvalStatus?: 'APPROVED' | 'REJECTED' | 'PENDING_APPROVAL'
  checker?: { name: string; email: string; checkedAt?: string; reason?: string }
}

export interface PendingApproval {
  id: string
  createdAt: string
  maker: { name: string; email: string; role: string }
  action: AuditAction
  target: { assetId: string; assetName: string }
  description: string
  before: string
  after: string
  justification: string
  workOrderId?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  checker?: { name: string; email: string }
  checkedAt?: string
  rejectReason?: string
}

interface AuditStore {
  records: AuditRecord[]
  pending: PendingApproval[]
  addRecord: (record: AuditRecord) => void
  approvePending: (id: string, checker: { name: string; email: string }) => void
  rejectPending: (id: string, checker: { name: string; email: string }, reason: string) => void
}

const mockRecords: AuditRecord[] = [
  {
    id: 'AUD-001',
    timestamp: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    actor: { name: 'Alice Chen', email: 'alice@eternity.com', role: 'Lead Operator' },
    ipAddress: '192.168.1.105',
    action: 'THRESHOLD_CHANGE',
    target: { assetId: 'TRF-01', assetName: 'Main Transformer TR-01' },
    before: 'Oil Temp Max: 85°C',
    after: 'Oil Temp Max: 90°C',
    justification: 'Summer peak load allowance',
    workOrderId: 'WO-19283',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  },
  {
    id: 'AUD-002',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
    actor: { name: 'Bob Smith', email: 'bob@eternity.com', role: 'Maintenance Tech' },
    ipAddress: '10.0.0.42',
    action: 'ALARM_SHELVE',
    target: { assetId: 'PMP-05', assetName: 'Cooling Pump 5' },
    before: 'Status: Active',
    after: 'Status: Shelved (8h)',
    justification: 'Routine bearing lubrication',
    workOrderId: 'WO-19284',
    checksum: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'
  },
  {
    id: 'AUD-003',
    timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
    actor: { name: 'Admin User', email: 'admin@eternity.com', role: 'System Admin' },
    ipAddress: '192.168.1.200',
    action: 'OTA_DEPLOY',
    target: { assetId: 'GW-11', assetName: 'Substation Gateway' },
    before: 'Firmware: v2.1.0',
    after: 'Firmware: v2.1.1-sec',
    justification: 'Security patch CVE-2023-XXXX',
    workOrderId: 'WO-19285',
    checksum: '1115dd800feaacefdf481f1f9070374a2a81e27880f187396db67958b207cbad',
    approvalStatus: 'APPROVED',
    checker: { name: 'Sarah Connor', email: 'sarah@eternity.com', checkedAt: new Date(Date.now() - 3600000 * 11).toISOString() }
  },
  {
    id: 'AUD-004',
    timestamp: new Date(Date.now() - 3600000 * 6).toISOString(),
    actor: { name: 'Sarah Connor', email: 'sarah@eternity.com', role: 'Security Chief' },
    ipAddress: '192.168.1.150',
    action: 'FOUR_EYES_APPROVAL',
    target: { assetId: 'GW-11', assetName: 'Substation Gateway' },
    before: 'Pending Approval',
    after: 'Approved',
    justification: 'Reviewed firmware hash, approved for deploy',
    checksum: '4a0a19218e082a343a1b17e5333409af9d98f0f5bde454581e01bc6642051280'
  },
  {
    id: 'AUD-005',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    actor: { name: 'Alice Chen', email: 'alice@eternity.com', role: 'Lead Operator' },
    ipAddress: '192.168.1.105',
    action: 'CARBON_ADJUST',
    target: { assetId: 'SITE-A', assetName: 'Plant Alpha' },
    before: 'Credits: 1200',
    after: 'Credits: 1150',
    justification: 'Manual adjustment for audit finding',
    workOrderId: 'WO-19286',
    checksum: 'e712a44015f5fc7cc45c222ff492a061405a399426f3455a7abcf739dbec0691'
  },
  {
    id: 'AUD-006',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    actor: { name: 'Bob Smith', email: 'bob@eternity.com', role: 'Maintenance Tech' },
    ipAddress: '10.0.0.42',
    action: 'CONFIG_CHANGE',
    target: { assetId: 'SENS-88', assetName: 'Vibration Sensor 88' },
    before: 'Polling Rate: 10s',
    after: 'Polling Rate: 5s',
    justification: 'Troubleshooting anomaly',
    checksum: '1b2a9d8213ba6804a29a65780ea4c16aeb328aab854ce620fc00f2e043a0e1cb'
  },
  {
    id: 'AUD-007',
    timestamp: new Date(Date.now() - 3600000 * 1).toISOString(),
    actor: { name: 'Admin User', email: 'admin@eternity.com', role: 'System Admin' },
    ipAddress: '192.168.1.200',
    action: 'OTA_FLEET_DEPLOY',
    target: { assetId: 'FLEET-ALL', assetName: 'Global Fleet' },
    before: 'Firmware: mixed',
    after: 'Firmware: v2.1.2-sec',
    justification: 'Critical security rollout',
    workOrderId: 'WO-19287',
    checksum: 'ff2520627718e0018a14b30cb9907cfa20216bbf6f5edbe18dfca6b052d9a3b6',
    approvalStatus: 'REJECTED',
    checker: { name: 'Sarah Connor', email: 'sarah@eternity.com', checkedAt: new Date(Date.now() - 3600000 * 0.5).toISOString(), reason: 'Insufficient testing on v2.1.2-sec' }
  },
  {
    id: 'AUD-008',
    timestamp: new Date(Date.now() - 3600000 * 0.5).toISOString(),
    actor: { name: 'Sarah Connor', email: 'sarah@eternity.com', role: 'Security Chief' },
    ipAddress: '192.168.1.150',
    action: 'FOUR_EYES_REJECTION',
    target: { assetId: 'FLEET-ALL', assetName: 'Global Fleet' },
    before: 'Pending Approval',
    after: 'Rejected',
    justification: 'Insufficient testing on v2.1.2-sec',
    checksum: '1dfba48eecab3ef2a5cd870fbdf851fcd882c20d7c71e81f1816bc8d249f0569'
  }
]

const mockPending: PendingApproval[] = [
  {
    id: 'PEND-001',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    maker: { name: 'Alice Chen', email: 'alice@eternity.com', role: 'Lead Operator' },
    action: 'THRESHOLD_CHANGE',
    target: { assetId: 'TRF-02', assetName: 'Main Transformer TR-02' },
    description: 'Increase critical temperature threshold',
    before: 'Temp Critical: 100°C',
    after: 'Temp Critical: 110°C',
    justification: 'Supplier confirmed safe operating limit up to 115°C',
    workOrderId: 'WO-19300',
    status: 'PENDING'
  },
  {
    id: 'PEND-002',
    createdAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    maker: { name: 'Admin User', email: 'admin@eternity.com', role: 'System Admin' },
    action: 'OTA_DEPLOY',
    target: { assetId: 'TRF-02', assetName: 'Main Transformer TR-02' },
    description: 'Deploy new predictive maintenance AI model',
    before: 'Model v1.4',
    after: 'Model v2.0-rc1',
    justification: 'Fixes false positives on load spike',
    workOrderId: 'WO-19301',
    status: 'PENDING'
  },
  {
    id: 'PEND-003',
    createdAt: new Date(Date.now() - 3600000 * 0.2).toISOString(),
    maker: { name: 'Bob Smith', email: 'bob@eternity.com', role: 'Maintenance Tech' },
    action: 'ALARM_SUPPRESS',
    target: { assetId: 'VIB-09', assetName: 'Turbine Vibration Sensor' },
    description: 'Suppress vibration alarms for 24 hours',
    before: 'Suppression: OFF',
    after: 'Suppression: ON (24h)',
    justification: 'Known faulty sensor waiting for replacement part',
    workOrderId: 'WO-19302',
    status: 'PENDING'
  }
]

export const useAuditStore = create<AuditStore>()(
  persist(
    (set, get) => ({
      records: mockRecords,
      pending: mockPending,
      addRecord: (record) => set((state) => ({ records: [record, ...state.records] })),
      approvePending: (id, checker) => {
        set((state) => {
          const itemIndex = state.pending.findIndex(p => p.id === id)
          if (itemIndex === -1) return state
          
          const item = state.pending[itemIndex]
          const newPending = [...state.pending]
          newPending.splice(itemIndex, 1)

          const timestamp = new Date().toISOString()

          const approvalRecord: AuditRecord = {
            id: `AUD-${Date.now()}`,
            timestamp,
            actor: { ...checker, role: 'Reviewer' },
            ipAddress: '127.0.0.1',
            action: 'FOUR_EYES_APPROVAL',
            target: item.target,
            before: 'Pending Approval',
            after: 'Approved',
            justification: 'Approved via Four-Eyes dashboard',
            checksum: Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2)
          }

          const executedRecord: AuditRecord = {
            id: `AUD-${Date.now() + 1}`,
            timestamp,
            actor: item.maker,
            ipAddress: '127.0.0.1',
            action: item.action,
            target: item.target,
            before: item.before,
            after: item.after,
            justification: item.justification,
            workOrderId: item.workOrderId,
            checksum: Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2),
            approvalStatus: 'APPROVED',
            checker: { ...checker, checkedAt: timestamp }
          }

          return {
            pending: newPending,
            records: [executedRecord, approvalRecord, ...state.records]
          }
        })
      },
      rejectPending: (id, checker, reason) => {
        set((state) => {
          const itemIndex = state.pending.findIndex(p => p.id === id)
          if (itemIndex === -1) return state
          
          const item = state.pending[itemIndex]
          const newPending = [...state.pending]
          newPending.splice(itemIndex, 1)

          const timestamp = new Date().toISOString()

          const rejectionRecord: AuditRecord = {
            id: `AUD-${Date.now()}`,
            timestamp,
            actor: { ...checker, role: 'Reviewer' },
            ipAddress: '127.0.0.1',
            action: 'FOUR_EYES_REJECTION',
            target: item.target,
            before: 'Pending Approval',
            after: 'Rejected',
            justification: reason,
            checksum: Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2)
          }

          return {
            pending: newPending,
            records: [rejectionRecord, ...state.records]
          }
        })
      }
    }),
    {
      name: 'audit-storage',
    }
  )
)
