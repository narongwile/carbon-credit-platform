'use client'

// ---------------------------------------------------------------------------
// Alarm "database" — persisted rule + acknowledgement store (localStorage).
// This is the persistence layer for the alarm backend; swap the persist
// storage for a REST/DB adapter to move it server-side without touching the UI.
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NodeAlarmRule } from '@/server/alarmEngine'
import { api } from '@/lib/api'

interface Ack { by: string; at: string }

interface AlarmDB {
  hasHydrated: boolean
  /** Per-node rule overrides (absent = use the domain default). */
  rules: Record<string, NodeAlarmRule>
  /** Acknowledgements keyed by event id. */
  acks: Record<string, Ack>

  setRule: (nodeId: string, rule: NodeAlarmRule, orgId?: string) => void
  clearRule: (nodeId: string) => void
  ackEvent: (eventId: string, by: string) => void
}

export const useAlarmDB = create<AlarmDB>()(
  persist(
    (set) => ({
      hasHydrated: false,
      rules: {},
      acks: {},
      setRule: (nodeId, rule, orgId) => {
        set((s) => ({ rules: { ...s.rules, [nodeId]: rule } }))
        void api.putRule(nodeId, { orgId: orgId ?? 'unknown', rule }) // best-effort sync; no-op without backend
      },
      clearRule: (nodeId) => set((s) => { const r = { ...s.rules }; delete r[nodeId]; return { rules: r } }),
      ackEvent: (eventId, by) => {
        set((s) => ({ acks: { ...s.acks, [eventId]: { by, at: new Date().toISOString() } } }))
        void api.ackEvent(eventId, { by })
      },
    }),
    {
      name: 'oneops-alarm-db',
      onRehydrateStorage: () => (state) => { if (state) state.hasHydrated = true },
    },
  ),
)
