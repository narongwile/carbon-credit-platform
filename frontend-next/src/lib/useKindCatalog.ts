'use client'

// ---------------------------------------------------------------------------
// The photo-kind / document-kind list an org actually uses (migrate-v40).
// ---------------------------------------------------------------------------
// Both pickers used to be frozen arrays in this file's neighbour, api.ts. That
// is a guess at every customer's documentation practice: a Thai utility files
// ใบรับรอง กฟภ., a DGA test result and a commissioning sheet, and none of
// those were expressible. The list is now per-org and admin-owned.
//
// Built-ins are merged in SERVER-side, so this hook always resolves to a
// usable list — and falls back to the same built-ins locally while loading or
// in demo mode, which is what lets every picker keep working with no backend.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { api, isLive, useIsLive, PHOTO_KINDS, DOC_KINDS, type CatalogKind, type KindScope } from '@/lib/api'

/** The compiled-in defaults, in the shape the API returns, for offline/loading use. */
const FALLBACK: Record<KindScope, CatalogKind[]> = {
  photo: PHOTO_KINDS.map((k, i) => ({ key: k.key, label: k.label, hint: k.hint, position: i, active: 1, builtin: true, protected: ['overview', 'thermal', 'condition'].includes(k.key) })),
  document: DOC_KINDS.map((k, i) => ({ key: k.key, label: k.label, position: i, active: 1, builtin: true, protected: false })),
}

export interface KindCatalog {
  /** Everything, including hidden entries — what the management screen edits. */
  all: CatalogKind[]
  /** Only what should be OFFERED for a new upload. */
  options: CatalogKind[]
  /** Resolve a stored key to its label, including keys hidden or since removed from the picker. */
  labelOf: (key: string) => string
  loading: boolean
  reload: () => void
}

export function useKindCatalog(orgId: string | null | undefined, scope: KindScope): KindCatalog {
  const live = useIsLive()
  const [all, setAll] = useState<CatalogKind[]>(FALLBACK[scope])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!live || !orgId) { setAll(FALLBACK[scope]); return }
    let cancelled = false
    setLoading(true)
    api.orgKinds(orgId, scope)
      .then((r) => { if (!cancelled && r?.kinds?.length) setAll(r.kinds) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [live, orgId, scope, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return {
    all,
    options: all.filter((k) => k.active),
    // A photo taken under a kind that has since been hidden — or a key this
    // build has never heard of — still renders as itself rather than blank.
    // Hiding a kind must never rewrite history.
    labelOf: (key: string) => all.find((k) => k.key === key)?.label ?? key,
    loading,
    reload,
  }
}

/** Non-hook variant for the rare caller outside React (report builders). */
export async function fetchKinds(orgId: string, scope: KindScope): Promise<CatalogKind[]> {
  if (!isLive()) return FALLBACK[scope]
  const r = await api.orgKinds(orgId, scope)
  return r?.kinds?.length ? r.kinds : FALLBACK[scope]
}
