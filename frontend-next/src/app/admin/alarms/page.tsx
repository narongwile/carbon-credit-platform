'use client'

// A Next.js App Router page file may only export `default` (plus a small set
// of framework-recognized names like `metadata`) — the build fails otherwise
// ("AlarmsManagementView is not a valid Page export field"). The actual view
// lives in @/components/AlarmsManagementView so admin/page.tsx's dashboard
// Alarm tab can reuse it (embedded mode) without importing from a route file.
import AlarmsManagementView from '@/components/AlarmsManagementView'

export default function AlarmsPage() {
  return <AlarmsManagementView />
}
