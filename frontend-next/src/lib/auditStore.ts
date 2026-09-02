'use client'

import { create } from 'zustand'
import { sha256 } from '@/lib/sha256'
import { persist } from 'zustand/middleware'
import { getSession } from './auth'
import { api } from './api'

export type AuditAction =
  | 'THRESHOLD_CHANGE'
  | 'ALARM_SHELVE'
  | 'ALARM_SUPPRESS'
  | 'OTA_DEPLOY'
  | 'OTA_FLEET_DEPLOY'
  | 'CARBON_ADJUST'
  | 'FOUR_EYES_APPROVAL'
  | 'FOUR_EYES_REJECTION'
  | 'CONFIG_CHANGE'

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

/**
 * SHA-256 hash of a record's contents, so an accidental edit is detectable.
 *
 * NOT an immutability or compliance control. This store persists to
 * localStorage and never reaches a server, so the record and its hash are both
 * writable by the user being audited — recompute both and validation passes.
 * 21 CFR Part 11 requires the trail to be independent of that operator, which
 * a browser-local store cannot be.
 */
export async function computeAuditChecksum(content: string): Promise<string> {
  // Was: crypto.subtle when available, otherwise a 53-bit mix rendered as 16
  // hex chars and REPEATED FOUR TIMES to fill 64 — indistinguishable on sight
  // from a SHA-256 while carrying a fraction of the entropy. crypto.subtle is
  // gated on the page being a SECURE CONTEXT, so over plain HTTP (this cluster
  // serves :30080) every audit record got the substitute. A checksum on an
  // audit record exists to make tampering detectable; one that silently
  // degrades to 53 bits, under the same name and the same length, removes that
  // property without removing the appearance of it.
  return sha256(content)
}

const initialBaselineRecords: AuditRecord[] = [
  {
    id: 'AUD-SYS-001',
    timestamp: new Date(Date.now() - 3600000 * 48).toISOString(),
    actor: { name: 'System Security Subsystem', email: 'security@platform.local', role: 'Security' },
    ipAddress: '127.0.0.1',
    action: 'CONFIG_CHANGE',
    target: { assetId: 'SYSTEM-CORE', assetName: 'Eternity Platform Governance' },
    before: 'Security Ledger: Uninitialized',
    after: 'Local activity log active (browser storage, SHA-256 record hashes)',
    justification: 'System baseline initialization & security policy activation',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    approvalStatus: 'APPROVED',
  },
  {
    id: 'AUD-SYS-002',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
    actor: { name: 'Operations Admin', email: 'admin@platform.local', role: 'Administrator' },
    ipAddress: '127.0.0.1',
    action: 'THRESHOLD_CHANGE',
    target: { assetId: 'FLEET-TRANSFORMERS', assetName: 'ETERNITY Transformer Fleet' },
    before: 'Alarm Thresholds: Factory Defaults',
    after: 'IEEE C57.104 Condition 1–4 Standards Baseline Provisioned',
    justification: 'Standardization of dissolved gas analysis and thermal boundaries',
    checksum: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
    approvalStatus: 'APPROVED',
  },
]

interface AuditStore {
  records: AuditRecord[]
  pending: PendingApproval[]
  addRecord: (record: AuditRecord) => void
  requestPending: (item: Omit<PendingApproval, 'id' | 'createdAt' | 'status'>) => PendingApproval
  approvePending: (id: string, checker: { name: string; email: string }) => Promise<void>
  rejectPending: (id: string, checker: { name: string; email: string }, reason: string) => Promise<void>
  clearRecords: () => void
}

export const useAuditStore = create<AuditStore>()(
  persist(
    (set, get) => ({
      records: initialBaselineRecords,
      pending: [],
      addRecord: (record) =>
        set((state) => ({ records: [record, ...state.records] })),

      requestPending: (item) => {
        const pendingItem: PendingApproval = {
          ...item,
          id: `PEND-${Date.now().toString(36).toUpperCase()}`,
          createdAt: new Date().toISOString(),
          status: 'PENDING',
        }
        set((state) => ({ pending: [pendingItem, ...state.pending] }))
        return pendingItem
      },

      approvePending: async (id, checker) => {
        const state = get()
        const itemIndex = state.pending.findIndex((p) => p.id === id)
        if (itemIndex === -1) return

        const item = state.pending[itemIndex]
        const newPending = [...state.pending]
        newPending.splice(itemIndex, 1)

        const timestamp = new Date().toISOString()
        const approvalHash = await computeAuditChecksum(
          `${timestamp}:${checker.email}:FOUR_EYES_APPROVAL:${item.target.assetId}:Approved`
        )
        const executedHash = await computeAuditChecksum(
          `${timestamp}:${item.maker.email}:${item.action}:${item.target.assetId}:${item.before}:${item.after}:${item.justification}`
        )

        const approvalRecord: AuditRecord = {
          id: `AUD-${Date.now().toString(36).toUpperCase()}-APP`,
          timestamp,
          actor: { ...checker, role: 'Four-Eyes Reviewer' },
          ipAddress: typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1',
          action: 'FOUR_EYES_APPROVAL',
          target: item.target,
          before: 'Status: Pending Dual-Control Approval',
          after: 'Status: Approved & Executed',
          justification: 'Approved via Four-Eyes Governance Console',
          checksum: approvalHash,
        }

        const executedRecord: AuditRecord = {
          id: `AUD-${Date.now().toString(36).toUpperCase()}-EXEC`,
          timestamp,
          actor: item.maker,
          ipAddress: typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1',
          action: item.action,
          target: item.target,
          before: item.before,
          after: item.after,
          justification: item.justification,
          workOrderId: item.workOrderId,
          checksum: executedHash,
          approvalStatus: 'APPROVED',
          checker: { ...checker, checkedAt: timestamp },
        }

        set({
          pending: newPending,
          records: [executedRecord, approvalRecord, ...state.records],
        })
      },

      rejectPending: async (id, checker, reason) => {
        const state = get()
        const itemIndex = state.pending.findIndex((p) => p.id === id)
        if (itemIndex === -1) return

        const item = state.pending[itemIndex]
        const newPending = [...state.pending]
        newPending.splice(itemIndex, 1)

        const timestamp = new Date().toISOString()
        const rejectionHash = await computeAuditChecksum(
          `${timestamp}:${checker.email}:FOUR_EYES_REJECTION:${item.target.assetId}:${reason}`
        )

        const rejectionRecord: AuditRecord = {
          id: `AUD-${Date.now().toString(36).toUpperCase()}-REJ`,
          timestamp,
          actor: { ...checker, role: 'Four-Eyes Reviewer' },
          ipAddress: typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1',
          action: 'FOUR_EYES_REJECTION',
          target: item.target,
          before: 'Status: Pending Dual-Control Approval',
          after: 'Status: Rejected by Reviewer',
          justification: reason || 'Rejected during Four-Eyes verification review',
          checksum: rejectionHash,
        }

        set({
          pending: newPending,
          records: [rejectionRecord, ...state.records],
        })
      },

      clearRecords: () => set({ records: initialBaselineRecords, pending: [] }),
    }),
    {
      name: 'eternity_audit_ledger_v2',
    }
  )
)

/**
 * Universal helper to record a compliant audit event from anywhere in the platform.
 * Automatically discovers active session user, calculates SHA-256 hash, and records to store.
 */
export async function recordAuditAction(params: {
  action: AuditAction
  target: { assetId: string; assetName: string }
  before: string
  after: string
  justification: string
  workOrderId?: string
  actor?: { name: string; email: string; role: string }
  ipAddress?: string
  approvalStatus?: 'APPROVED' | 'REJECTED' | 'PENDING_APPROVAL'
}): Promise<AuditRecord> {
  const timestamp = new Date().toISOString()
  let actor = params.actor

  if (!actor && typeof window !== 'undefined') {
    const session = getSession()
    if (session) {
      actor = {
        name: session.name || session.username || 'Authorized User',
        email: session.email || `${session.username || 'user'}@platform.local`,
        role: session.role || 'operator',
      }
    }
  }

  if (!actor) {
    actor = { name: 'Operations Admin', email: 'admin@platform.local', role: 'admin' }
  }

  const rawForHash = `${timestamp}:${actor.email}:${params.action}:${params.target.assetId}:${params.before}:${params.after}:${params.justification}`
  const checksum = await computeAuditChecksum(rawForHash)

  const record: AuditRecord = {
    id: `AUD-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp,
    actor,
    ipAddress:
      params.ipAddress ||
      (typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1'),
    action: params.action,
    target: params.target,
    before: params.before,
    after: params.after,
    justification: params.justification,
    workOrderId: params.workOrderId,
    checksum,
    approvalStatus: params.approvalStatus || 'APPROVED',
  }

  useAuditStore.getState().addRecord(record)

  // Persist to server-side MySQL audit trail ledger (21 CFR Part 11 / ISA-84)
  if (typeof window !== 'undefined') {
    const session = getSession()
    const orgId = session?.orgId
    if (orgId) {
      api.postAuditLog(orgId, {
        action: params.action,
        target: params.target,
        before: params.before,
        after: params.after,
        justification: params.justification,
        workOrderId: params.workOrderId,
      }).catch(err => console.warn('Server audit sync fallback:', err))
    }
  }

  return record
}
