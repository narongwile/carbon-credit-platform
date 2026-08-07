'use client'

// ---------------------------------------------------------------------------
// Upload / replace / remove ONE organization's logo, for whoever is allowed to
// edit that org. The org admin reaches this through Settings → Organization
// branding (their own org only); a superadmin reaches it from the
// Organizations table, for any customer.
//
// No new endpoint: PUT /api/orgs/:orgId/branding already accepts a partial
// patch and already lets a superadmin write any org — guard() exempts them
// from the org-scope check that otherwise pins a caller to their own orgId.
// So this is a second place to reach the same write, not a second way to
// store a logo.
//
// The current logo is read from GET /api/orgs (which returns logo_url per org)
// rather than the store's orgLogos map: that map is hydrated by OrgBrand for
// whichever org the VIEWER belongs to, so for a superadmin editing some other
// customer it would simply be empty. The store is still updated on save, so a
// superadmin editing their own org sees the sidebar change immediately.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import { api, isLive, apiImageUrl } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Upload, Trash2, Building2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

/** Matches the client-side cap the Settings page uses; the backend's own limit is 5 MB. */
const MAX_BYTES = 512 * 1024

export default function OrgLogoEditor({ orgId, onSaved }: { orgId: string; onSaved?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const setOrgLogo = useAppStore((s) => s.setOrgLogo)
  const [logo, setLogo] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isLive()) { setLoaded(true); return }
    let cancelled = false
    api.orgs().then((orgs) => {
      if (cancelled) return
      setLogo(orgs?.find((o) => o.id === orgId)?.logo_url ?? null)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [orgId])

  const onPick = (file?: File) => {
    if (!file) return
    if (file.size > MAX_BYTES) { toast.error('Logo too large (max 512 KB)'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      const prev = logo
      setLogo(dataUrl)                                   // instant feedback
      if (!isLive()) { setOrgLogo(orgId, dataUrl); toast.success('Logo updated'); onSaved?.(); return }
      setBusy(true)
      // Never leave the new image on screen if the write failed — that is
      // exactly how a rejected upload used to look successful until a reload.
      const r = await api.updateOrgBranding(orgId, { logoUrl: dataUrl })
      if (!r) { setLogo(prev); setBusy(false); toast.error('Failed to save the logo'); return }
      // Re-read what was actually stored: the backend decodes the data URL into
      // org_logos and keeps only a served path in logo_url, so showing the path
      // here means this session matches what the next reload will render.
      const orgs = await api.orgs()
      const stored = orgs?.find((o) => o.id === orgId)?.logo_url ?? null
      setLogo(stored)
      setOrgLogo(orgId, stored ?? '')
      setBusy(false)
      toast.success('Logo updated')
      onSaved?.()
    }
    reader.readAsDataURL(file)
  }

  const onRemove = async () => {
    const prev = logo
    setLogo(null)
    if (!isLive()) { setOrgLogo(orgId, ''); toast.success('Logo removed'); onSaved?.(); return }
    setBusy(true)
    const r = await api.updateOrgBranding(orgId, { logoUrl: '' })
    setBusy(false)
    if (!r) { setLogo(prev); toast.error('Failed to remove the logo'); return }
    setOrgLogo(orgId, '')
    toast.success('Logo removed')
    onSaved?.()
  }

  const src = logo ? (logo.startsWith('/api') ? apiImageUrl(logo) : logo) : null

  return (
    <div className="flex items-center gap-5">
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0"
        style={{ background: src ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: '1px solid #1e2433' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="logo" className="w-full h-full object-contain" /> : <Building2 size={30} className="text-white" />}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || !loaded}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ? 'Saving…' : logo ? 'Change Logo' : 'Upload Logo'}
        </button>
        {logo && !busy && (
          <button onClick={onRemove}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-red-400"
            style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
            <Trash2 size={14} /> Remove
          </button>
        )}
        <span className="text-[10px] text-slate-600">PNG / SVG / JPG · square works best · max 512 KB</span>
      </div>
    </div>
  )
}
