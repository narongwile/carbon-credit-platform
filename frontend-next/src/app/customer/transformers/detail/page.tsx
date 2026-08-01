// Viewer-side transformer detail. A transformer opened from the customer portal
// used to land on the generic device page, which lists whatever param keys the
// device happens to publish (GHG, Hz, I3p, Ia…) — accurate, but it is not how
// anyone reads a transformer. This renders the same digital-twin view the admin
// gets: oil temperature, hydrogen, moisture, oil level and load against their
// thresholds, with the 3D twin and the asset frame around them.
//
// Same component, not a copy — only the fleet it resolves the id against (this
// viewer's organization) and where Back goes differ. Everything inside it is
// already scoped by the session's role and departments.
import { Suspense } from 'react'
import CustomerTransformerDetail from './CustomerTransformerDetail'

export default function CustomerTransformerDetailPage() {
  return (
    <Suspense fallback={null}>
      <CustomerTransformerDetail />
    </Suspense>
  )
}
