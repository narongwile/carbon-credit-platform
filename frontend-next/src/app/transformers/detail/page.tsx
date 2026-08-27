'use client'

import { Suspense } from 'react'
import TransformerDetailView from '@/components/transformer/TransformerDetailView'
import { useSessionRole, useSessionOrgId } from '@/lib/auth'

function UniversalTransformerDetail() {
  const role = useSessionRole()
  const customerOrgId = useSessionOrgId()
  const isAdmin = role === 'admin' || role === 'superadmin'

  return (
    <TransformerDetailView
      orgId={!isAdmin && customerOrgId ? customerOrgId : undefined}
      backHref={isAdmin ? '/admin' : '/customer/devices'}
    />
  )
}

export default function TransformerDetailPage() {
  return (
    <Suspense fallback={null}>
      <UniversalTransformerDetail />
    </Suspense>
  )
}
