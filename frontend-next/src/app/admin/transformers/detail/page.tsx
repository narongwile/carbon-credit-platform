// Static route — see src/app/admin/nodes/detail/page.tsx for why this moved
// off a dynamic [id] segment onto ?id= + useSearchParams.
import { Suspense } from 'react'
import TransformerDetailClient from './TransformerDetailClient'

export default function TransformerDetailPage() {
  return (
    <Suspense fallback={null}>
      <TransformerDetailClient />
    </Suspense>
  )
}
