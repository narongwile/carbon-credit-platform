import { create } from 'zustand'
import type { Transformer, Alarm, User } from '@/types'
import type { NodeDocument } from '@/types/org'
import { transformers as initialTransformers, alarms as initialAlarms } from './mockData'

interface AppState {
  user: User | null
  transformers: Transformer[]
  alarms: Alarm[]
  selectedOrgId: string
  selectedTransformerId: string | null
  realtimeEnabled: boolean
  /** The acting viewer (customer portal) — drives department-based access. */
  viewerUserId: string
  /** Per-organization uploaded logo (data URL), keyed by orgId. */
  orgLogos: Record<string, string>
  /** Node documents, scoped/visible per department. */
  documents: NodeDocument[]

  setUser: (user: User | null) => void
  setViewerUserId: (id: string) => void
  setOrgLogo: (orgId: string, dataUrl: string) => void
  addDocument: (doc: NodeDocument) => void
  removeDocument: (id: string) => void
  setSelectedOrgId: (orgId: string) => void
  setSelectedTransformerId: (id: string | null) => void
  updateTransformerSensor: (transformerId: string, sensorKey: string, value: number) => void
  acknowledgeAlarm: (alarmId: string, actor: string) => void
  toggleRealtime: () => void
  getTransformersByOrg: (orgId: string) => Transformer[]
  getAlarmsByOrg: (orgId: string) => Alarm[]
  getAlarmsByTransformer: (transformerId: string) => Alarm[]
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  transformers: initialTransformers,
  alarms: initialAlarms,
  selectedOrgId: 'org-1',
  selectedTransformerId: null,
  realtimeEnabled: true,
  viewerUserId: 'u-cc',
  orgLogos: {},
  documents: [],

  setUser: (user) => set({ user }),
  setViewerUserId: (id) => set({ viewerUserId: id }),
  setOrgLogo: (orgId, dataUrl) => set((s) => ({ orgLogos: { ...s.orgLogos, [orgId]: dataUrl } })),
  addDocument: (doc) => set((s) => ({ documents: [doc, ...s.documents] })),
  removeDocument: (id) => set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),
  setSelectedOrgId: (orgId) => set({ selectedOrgId: orgId }),
  setSelectedTransformerId: (id) => set({ selectedTransformerId: id }),
  toggleRealtime: () => set((s) => ({ realtimeEnabled: !s.realtimeEnabled })),

  updateTransformerSensor: (transformerId, sensorKey, value) =>
    set((state) => ({
      transformers: state.transformers.map((t) => {
        if (t.id !== transformerId) return t
        const sensor = t.sensors[sensorKey as keyof typeof t.sensors]
        const delta = parseFloat((value - sensor.value).toFixed(2))
        const trend = Math.abs(delta) < 0.05 ? 'stable' : delta > 0 ? 'up' : 'down'
        // oilLevel: low is bad (invert direction); all others: high is bad
        const invertedSensors = ['oilLevel']
        const status: 'NORMAL' | 'WARNING' | 'CRITICAL' = invertedSensors.includes(sensorKey)
          ? (value <= sensor.threshold.critical ? 'CRITICAL' : value <= sensor.threshold.warning ? 'WARNING' : 'NORMAL')
          : (value >= sensor.threshold.critical ? 'CRITICAL' : value >= sensor.threshold.warning ? 'WARNING' : 'NORMAL')
        const newHistory = [
          ...sensor.history.slice(-95),
          { time: new Date().toISOString(), value },
        ]
        return {
          ...t,
          lastUpdated: new Date().toISOString(),
          sensors: {
            ...t.sensors,
            [sensorKey]: { ...sensor, value, delta, trend, status, history: newHistory },
          },
        }
      }),
    })),

  acknowledgeAlarm: (alarmId, actor) =>
    set((state) => ({
      alarms: state.alarms.map((a) => {
        if (a.id !== alarmId) return a
        return {
          ...a,
          acknowledged: true,
          acknowledgedBy: actor,
          acknowledgedAt: new Date().toISOString(),
        }
      }),
    })),

  getTransformersByOrg: (orgId) => get().transformers.filter((t) => t.orgId === orgId),
  getAlarmsByOrg: (orgId) => get().alarms.filter((a) => a.orgId === orgId),
  getAlarmsByTransformer: (transformerId) =>
    get().alarms.filter((a) => a.transformerId === transformerId),
}))
