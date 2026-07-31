// Static route — see src/app/admin/nodes/detail/page.tsx for why this moved
// off a dynamic [id] segment onto ?id= + useSearchParams.
import { Suspense } from 'react'
import DeviceDetailClient from './DeviceDetailClient'

export default function DeviceDetailPage() {
  return (
    <Suspense fallback={null}>
      <DeviceDetailClient />
    </Suspense>
  )
}
