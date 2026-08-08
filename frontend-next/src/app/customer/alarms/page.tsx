'use client'

// Full-page route for the viewer's alarm feed. The actual view now lives in
// CustomerAlarmsView so it can also be embedded as the "Alarm" tab on the
// customer overview page (src/app/customer/page.tsx), mirroring how
// admin/page.tsx's Alarm tab embeds AlarmsManagementView instead of
// duplicating admin/alarms/page.tsx.

import CustomerAlarmsView from '@/components/CustomerAlarmsView'

export default function CustomerAlarmsPage() {
  return <CustomerAlarmsView />
}
