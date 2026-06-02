// Server Component — generateStaticParams for static export
import { allManagedDevices } from '@/lib/fleetData'
import DeviceDetailClient from './DeviceDetailClient'

export function generateStaticParams() {
  return allManagedDevices().map((d) => ({ id: d.id }))
}

export default function DeviceDetailPage() {
  return <DeviceDetailClient />
}
