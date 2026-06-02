// Server Component — generateStaticParams for static export
import { managedDevices } from '@/lib/orgData'
import DeviceDetailClient from './DeviceDetailClient'

export function generateStaticParams() {
  return managedDevices.map((d) => ({ id: d.id }))
}

export default function DeviceDetailPage() {
  return <DeviceDetailClient />
}
