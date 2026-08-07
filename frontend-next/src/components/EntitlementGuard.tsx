'use client'

import { useAppStore } from '@/lib/store'
import { isPlatformLicensed, getOrg } from '@/lib/entitlements'
import type { PlatformType } from '@/lib/platforms'
import { Lock } from 'lucide-react'

// Guards a module page: only renders children when the current tenant
// (selectedOrgId) is licensed for the given platform. Otherwise shows a
// "not licensed" notice directing them to the super admin.
export default function EntitlementGuard({ platform, name, children }: { platform: PlatformType; name: string; children: React.ReactNode }) {
  const { selectedOrgId } = useAppStore()
  // isPlatformLicensed reads the store via getState() (a snapshot, not a
  // subscription — see entitlements.ts), so this component needs its own
  // subscription to the real entitlements admin/layout.tsx fetches; otherwise
  // a page reached directly (a bookmark, a refresh) rendered its FIRST paint
  // before that fetch resolved, decided "not licensed" from the still-empty
  // store, and never re-rendered once the real answer arrived — the org
  // stayed locked out of a platform it was actually licensed for until a
  // second navigation.
  useAppStore((s) => s.orgEntitlements[selectedOrgId])
  if (isPlatformLicensed(selectedOrgId, platform)) return <>{children}</>

  const org = getOrg(selectedOrgId)
  return (
    <div className="p-6">
      <div className="max-w-lg mx-auto mt-16 rounded-2xl p-8 text-center" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.12)' }}>
          <Lock size={26} className="text-red-400" />
        </div>
        <h2 className="text-lg font-bold text-white">{name} is not licensed</h2>
        <p className="text-sm text-slate-500 mt-2">
          <span className="text-slate-300 font-medium">{org?.name ?? 'This organization'}</span> is not entitled to the {name} platform.
          Ask your Super Admin to enable it under Organizations → Platform Access.
        </p>
      </div>
    </div>
  )
}
