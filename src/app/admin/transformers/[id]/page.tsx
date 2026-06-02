// Server Component — required for generateStaticParams (static export)
import TransformerDetailClient from './TransformerDetailClient'

// Pre-generate all 15 transformer pages at build time
export function generateStaticParams() {
  return Array.from({ length: 15 }, (_, i) => ({ id: `t${i + 1}` }))
}

export default function TransformerDetailPage() {
  return <TransformerDetailClient />
}
