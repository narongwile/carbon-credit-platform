'use client'

// ---------------------------------------------------------------------------
// Organization Logo Resolver for Printable PDF Reports
// ---------------------------------------------------------------------------
// Fetches or renders an organization's logo as a data: URL with dimensions,
// suitable for jsPDF.addImage().
//
// 1. Reads the org's uploaded logo from useAppStore.getState().orgLogos[orgId]
// 2. If it's a relative/API path, fetches with credentials and converts to data URL
// 3. Fallback: generates a crisp, high-resolution vector monogram badge on an
//    offscreen canvas with the organization's initials and brand styling.
// ---------------------------------------------------------------------------

import { api, apiImageUrl } from '@/lib/api'
import { useAppStore } from '@/lib/store'

export interface OrgLogoBlob {
  dataUrl: string
  format: 'PNG' | 'JPEG'
  width: number
  height: number
}

/**
 * Creates a clean, professional corporate monogram logo badge as a fallback
 * when no custom logo has been uploaded for the organization yet.
 */
export function createFallbackLogo(orgName: string): OrgLogoBlob {
  if (typeof document === 'undefined') {
    return { dataUrl: '', format: 'PNG', width: 48, height: 48 }
  }
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl: '', format: 'PNG', width: 48, height: 48 }

  // Draw rounded squircle background with gradient
  const r = 28
  const w = 160
  const h = 160
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.quadraticCurveTo(w, 0, w, r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()

  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#4f46e5') // Indigo-600
  grad.addColorStop(1, '#7c3aed') // Violet-600
  ctx.fillStyle = grad
  ctx.fill()

  // Subtle border
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.stroke()

  // Draw Initials
  const cleanName = (orgName || 'ONEOPS').trim()
  const words = cleanName.split(/[\s_-]+/).filter(Boolean)
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : cleanName.slice(0, 2).toUpperCase()

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials, w / 2, h / 2 + 3)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    format: 'PNG',
    width: 160,
    height: 160,
  }
}

/**
 * Resolves the organization's logo data URL for PDF reports.
 * Checks:
 * 1. useAppStore.getState().orgLogos[orgId] (cached/uploaded logo)
 * 2. Fetches from backend /api/orgs/:id/branding or /api/public/orgs/:id/logo
 * 3. Falls back to crisp corporate monogram badge
 */
export async function getOrgLogoDataUrl(orgId?: string, orgName?: string): Promise<OrgLogoBlob> {
  const store = useAppStore.getState()
  const effectiveOrgId = orgId || store.selectedOrgId || 'org-1'
  const effectiveOrgName = orgName || store.orgNames[effectiveOrgId] || 'ONEOPS'

  let rawLogo = store.orgLogos[effectiveOrgId]

  // If not in store, attempt to resolve via API
  if (!rawLogo && typeof window !== 'undefined') {
    try {
      const orgs = await api.orgs()
      const org = orgs?.find((o) => o.id === effectiveOrgId)
      if (org?.logo_url) {
        rawLogo = org.logo_url
        store.setOrgLogo(effectiveOrgId, rawLogo)
      }
    } catch {}
  }

  // If we have a rawLogo, convert/normalize to base64 DataURL
  if (rawLogo) {
    try {
      if (rawLogo.startsWith('data:image/')) {
        const isJpeg = rawLogo.startsWith('data:image/jpeg') || rawLogo.startsWith('data:image/jpg')
        const dims = await new Promise<{ width: number; height: number }>((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 100 })
          img.onerror = () => resolve({ width: 100, height: 100 })
          img.src = rawLogo!
        })
        return {
          dataUrl: rawLogo,
          format: isJpeg ? 'JPEG' : 'PNG',
          ...dims,
        }
      }

      // If it's a URL (path or remote)
      const url = rawLogo.startsWith('/api') ? apiImageUrl(rawLogo) : rawLogo
      const res = await fetch(url)
      if (res.ok) {
        const blob = await res.blob()
        const isJpeg = blob.type.includes('jpeg') || blob.type.includes('jpg')
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        const dims = await new Promise<{ width: number; height: number }>((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 100 })
          img.onerror = () => resolve({ width: 100, height: 100 })
          img.src = dataUrl
        })
        return {
          dataUrl,
          format: isJpeg ? 'JPEG' : 'PNG',
          ...dims,
        }
      }
    } catch {}
  }

  // Graceful fallback: corporate monogram badge
  return createFallbackLogo(effectiveOrgName)
}
