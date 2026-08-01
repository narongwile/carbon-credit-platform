'use client'

import { useSessionOrgId } from '@/lib/auth'
import TransformerDetailView from '@/components/transformer/TransformerDetailView'

export default function CustomerTransformerDetail() {
  // The viewer's own org, not the admin org switcher: a viewer has exactly one
  // tenant, and useSessionOrgId is mount-gated so the statically exported HTML
  // and the first client render agree.
  const orgId = useSessionOrgId()
  return <TransformerDetailView orgId={orgId} backHref="/customer/devices" />
}
