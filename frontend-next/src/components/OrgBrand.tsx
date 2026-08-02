'use client'

// ---------------------------------------------------------------------------
// Sidebar brand block: the org's own logo and display name instead of the
// platform default. Whatever the org admin sets under Settings → Organization
// branding shows here; without a custom name/logo it falls back to ONEOPS.
//
// The store's orgLogos/orgNames are deliberately not persisted (a logo data URL
// would blow the localStorage quota), so this component also hydrates them from
// the API on mount — otherwise a reload dropped the uploaded logo even though
// it was saved in the organizations table.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { api, useIsLive, apiImageUrl } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Boxes } from 'lucide-react'

export default function OrgBrand({ orgId }: { orgId: string }) {
  const live = useIsLive()
  const logo = useAppStore((s) => s.orgLogos[orgId])
  const name = useAppStore((s) => s.orgNames[orgId])
  const setOrgLogo = useAppStore((s) => s.setOrgLogo)
  const setOrgName = useAppStore((s) => s.setOrgName)

  useEffect(() => {
    if (!live || !orgId) return
    let cancelled = false
    api.orgs().then((orgs) => {
      if (cancelled) return
      const org = orgs?.find((o) => o.id === orgId)
      if (!org) return
      if (org.name) setOrgName(orgId, org.name)
      if (org.logo_url) setOrgLogo(orgId, org.logo_url)
    })
    return () => { cancelled = true }
  }, [live, orgId, setOrgLogo, setOrgName])

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0"
        style={{ background: logo ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
      >
        {/* The logo is stored as bytes and served by the API now, so the value
            here is a path — it needs the JWT as ?token=, which an <img> cannot
            send as a header. A data: URL (demo mode) is rendered as-is. */}
        {logo ? <img src={logo.startsWith('/api') ? apiImageUrl(logo) : logo} alt="logo" className="w-full h-full object-contain" /> : <Boxes size={14} className="text-white" />}
      </div>
      <span className="font-bold text-white tracking-wider text-sm truncate" title={name || 'ONEOPS'}>
        {name || 'ONEOPS'}
      </span>
    </div>
  )
}
