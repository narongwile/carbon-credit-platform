'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, isLive } from '@/lib/api'

export interface Nameplate {
  has: boolean
  /** Linked transformer_models row (migrate-v32), if this unit uses the catalog. */
  modelId?: string | null
  modelCode?: string | null
  modelActive?: boolean | null
  // Raw per-unit values — null means "inherit from the linked model" once
  // modelId is set. This is what an edit form should read: showing the
  // model's value back as if it were typed in would make every override
  // look pre-filled instead of blank.
  manufacturer?: string | null
  model?: string | null
  serialNumber?: string | null
  ratedKva?: number | null
  voltageClass?: string | null
  coolingType?: string | null
  yearInstalled?: number | null
  updatedBy?: string | null
  updatedAt?: string
  pending?: string
  /** Effective values a read-only display should show: override ?? model's value. */
  resolved?: {
    model?: string | null
    manufacturer?: string | null
    ratedKva?: number | null
    voltageClass?: string | null
    coolingType?: string | null
  }
}

export interface TransformerModel {
  id: string
  modelCode: string
  manufacturer: string | null
  ratedKva: number | null
  voltageClass: string | null
  coolingType: string | null
  active: boolean
  createdBy: string | null
  updatedAt: string
}

/**
 * A device's real nameplate — kVA, voltage class, manufacturer, serial number.
 * Same shape as the device-photo fetch: a meta-only GET, no bytes, so both
 * Asset Info panels (FixDashboard, TransformerDetailView) can read it cheaply.
 */
export function useNodeNameplate(nodeId: string): { data: Nameplate | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<Nameplate | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (!isLive() || !nodeId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    api.nodeNameplate(nodeId).then((r) => { if (!cancelled) setData(r ?? { has: false }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId])

  useEffect(() => load(), [load])

  return { data, loading, refetch: load }
}

/**
 * An org's transformer model catalog (migrate-v32) — admin/superadmin only.
 * Always this org's own copy: /api/orgs/:orgId/transformer-models never reads
 * across a tenant boundary, even where two orgs use an identical model code.
 */
export function useTransformerModels(orgId: string): { models: TransformerModel[]; loading: boolean; refetch: () => void } {
  const [models, setModels] = useState<TransformerModel[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (!isLive() || !orgId) { setModels([]); return }
    let cancelled = false
    setLoading(true)
    api.transformerModels(orgId).then((r) => { if (!cancelled) setModels(Array.isArray(r) ? r : []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId])

  useEffect(() => load(), [load])

  return { models, loading, refetch: load }
}
