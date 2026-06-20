// Server Component — required for generateStaticParams (static export)
import TransformerDetailClient from './TransformerDetailClient'
import { getTransformerHostIds } from '@/lib/fleetData'

// Pre-generate a detail page for every canonical fleet transformer host
export function generateStaticParams() {
  return getTransformerHostIds().map((id) => ({ id }))
}

export default function TransformerDetailPage() {
  return <TransformerDetailClient />
}
