'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import AlarmsManagementView from '@/components/AlarmsManagementView'

export default function RootAlarmsPage() {
  const router = useRouter()

  useEffect(() => {
    const session = getSession()
    if (session?.role === 'customer') {
      router.replace('/customer/alarms')
    } else {
      router.replace('/admin/alarms')
    }
  }, [router])

  return <AlarmsManagementView />
}
