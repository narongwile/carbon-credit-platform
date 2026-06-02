import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ONEOPS — Unified Operations Platform',
  description:
    'Unified operation-management platform for multi-sensor IoT fleets — refrigeration data loggers, BloodBOX cold storage and ETERNITY transformer monitoring.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased" style={{ background: '#0a0e1a', color: 'white' }}>
        {children}
      </body>
    </html>
  )
}
