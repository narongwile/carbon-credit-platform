'use client'

/**
 * Resolves the active organization ID from the current hostname or query parameter.
 *
 * Supported formats:
 * - Subdomain on nip.io:  "org-1.27.254.143.144.nip.io" -> "org-1"
 * - Subdomain on custom:  "kmutt.thermexpertise.com"     -> "kmutt"
 * - Subdomain on local:   "org-1.localhost:3000"         -> "org-1"
 * - Query param fallback: "?org=org-1"                   -> "org-1"
 * - Root domains:         "iiotplatform.27.254.143.144.nip.io" -> null (Root)
 *                         "iiotplatform.thermexpertise.com"    -> null (Root)
 *                         "localhost" / "127.0.0.1" (no ?org)   -> null (Root)
 */
export function getOrgFromLocation(): string | null {
  if (typeof window === 'undefined') return null

  // 1. Explicit query parameter override
  try {
    const param = new URLSearchParams(window.location.search).get('org')
    if (param && param.trim()) return param.trim()
  } catch { /* ignore */ }

  // 2. Subdomain resolution from window.location.hostname
  const host = (window.location.hostname || '').toLowerCase()
  const parts = host.split('.')
  if (parts.length >= 2) {
    const sub = parts[0]
    const generic = new Set([
      'iiotplatform', 'www', 'app', 'dashboard', 'localhost',
      'nodered', 'argocd', 'grafana', 'emqx', 'pma', 'api', 'admin'
    ])
    // If the subdomain is not generic and not purely numeric (IP address octet like "27")
    if (!generic.has(sub) && !/^\d+$/.test(sub)) {
      return sub
    }
  }

  return null
}

/**
 * Returns whether the current page is being accessed via the root platform domain.
 */
export function isRootPlatform(): boolean {
  return getOrgFromLocation() === null
}

/**
 * Constructs a URL to an organization's dedicated subdomain workspace.
 */
export function getOrgWorkspaceUrl(orgId: string, path = '/'): string {
  if (typeof window === 'undefined' || !orgId) return path
  const host = window.location.hostname.toLowerCase()
  const port = window.location.port ? `:${window.location.port}` : ''
  const protocol = window.location.protocol

  // If already on nip.io: "org-1.27.254.143.144.nip.io"
  if (host.includes('nip.io')) {
    const nipParts = host.split('.nip.io')[0].split('.')
    const ipParts = nipParts.filter(p => /^\d+$/.test(p))
    if (ipParts.length === 4) {
      const ip = ipParts.join('.')
      return `${protocol}//${orgId}.${ip}.nip.io${port}${path}`
    }
  }

  // If on production domain: "iiotplatform.thermexpertise.com" or "xxx.thermexpertise.com"
  if (host.includes('thermexpertise.com')) {
    return `${protocol}//${orgId}.thermexpertise.com${port}${path}`
  }

  // Local development fallback
  if (host === 'localhost' || host === '127.0.0.1') {
    const glue = path.includes('?') ? '&' : '?'
    return `${protocol}//${host}${port}${path}${glue}org=${encodeURIComponent(orgId)}`
  }

  return `${protocol}//${orgId}.${host}${port}${path}`
}
