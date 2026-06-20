'use client'

import { Toaster } from 'react-hot-toast'

export default function ToasterProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#0d1117',
          color: '#fff',
          border: '1px solid #1e2433',
          fontSize: '14px',
          maxWidth: '400px',
        },
        success: { iconTheme: { primary: '#4ade80', secondary: '#0d1117' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#0d1117' } },
      }}
    />
  )
}
