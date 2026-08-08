'use client'

// ---------------------------------------------------------------------------
// The "Individual Device (Free Style)" dashboard — meant to embed a real,
// admin-composed Grafana dashboard for this specific device.
// ---------------------------------------------------------------------------
// This used to render entirely fabricated charts (hash-seeded fake series/
// gauge/bar values with no relationship to the device's real telemetry) and
// an "Open in Grafana" button that pointed at a per-tab-session "Embed URL"
// text box — pure local React state, saved nowhere, reset to blank on every
// navigation. The button and the fake charts together looked like a working
// feature but nothing behind either of them was real for any device, ever.
//
// device.grafanaUrl (migrate-v45, nodes.grafana_url) is now the actual,
// admin-set, persisted link — read from the real backend, editable here by
// anyone with manage access to this device (api.updateNodeProfile), and with
// no fabricated chart standing in when it is unset: an honest empty state
// instead.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ManagedDevice } from '@/types/org'
import { ExternalLink, LayoutDashboard, Pencil, Save, X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

// Grafana-flavoured palette, kept purely for visual continuity with the
// toolbar chrome — nothing under it is simulated data anymore.
const G = { page: '#111217', panel: '#181b1f', border: '#23262e', title: '#ccccdc', sub: '#8e8e8e' }

function validUrl(u: string): boolean {
  if (!u) return true // empty clears it
  return /^https?:\/\//i.test(u) && u.length <= 500
}

export default function FreestyleDashboard({
  device, canManage = false, onSaved,
}: {
  device: ManagedDevice
  /** Only someone with manage access to this device may change its Grafana link. */
  canManage?: boolean
  onSaved?: (grafanaUrl: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(device.grafanaUrl ?? '')
  const [saving, setSaving] = useState(false)
  // Held locally so a successful save renders immediately — the parent's
  // useManagedDevice roster has no refetch trigger, so without this the link
  // just saved would keep showing as unset until the next full page load.
  const [localUrl, setLocalUrl] = useState(device.grafanaUrl ?? null)

  // The device prop arrives asynchronously and can change (a different device
  // navigated to, or the roster eventually does reload) — keep both in sync
  // unless the admin is actively mid-edit, or that would clobber what just
  // got typed.
  useEffect(() => {
    if (editing) return
    setDraft(device.grafanaUrl ?? '')
    setLocalUrl(device.grafanaUrl ?? null)
  }, [device.grafanaUrl, editing])

  const save = async () => {
    const url = draft.trim()
    if (!validUrl(url)) { toast.error('Enter a valid http:// or https:// URL (max 500 characters).'); return }
    setSaving(true)
    const r = await api.updateNodeProfile(device.id, { grafanaUrl: url || null })
    setSaving(false)
    if (!r?.ok) { toast.error(r && 'error' in r ? String((r as { error?: string }).error) : 'Could not save the Grafana link.'); return }
    toast.success(url ? 'Grafana dashboard link saved.' : 'Grafana dashboard link cleared.')
    setEditing(false)
    setLocalUrl(url || null)
    onSaved?.(url || null)
  }

  const url = localUrl

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: G.page, border: `1px solid ${G.border}` }}>
      {/* Grafana toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${G.border}` }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f55f3e,#fff200)' }}>
            <LayoutDashboard size={13} className="text-[#111217]" />
          </span>
          <span className="text-sm font-semibold" style={{ color: G.title }}>Grafana</span>
          <span className="text-xs" style={{ color: G.sub }}>/ {device.name} — Free Style</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canManage && !editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs" style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}>
              <Pencil size={12} /> {url ? 'Edit link' : 'Set Grafana link'}
            </button>
          )}
          {url && !editing && (
            <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-white" style={{ background: '#f55f3e' }}>
              <ExternalLink size={12} /> Open in Grafana
            </a>
          )}
        </div>
      </div>

      {editing && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${G.border}` }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="https://grafana.example.com/d/abc123/this-device (or a /d-solo/... panel URL to embed)"
            className="flex-1 min-w-[260px] rounded px-3 py-2 text-xs outline-none"
            style={{ background: G.panel, border: `1px solid ${G.border}`, color: G.title }}
          />
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium text-white disabled:opacity-50" style={{ background: '#6366f1' }}>
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setEditing(false); setDraft(device.grafanaUrl ?? '') }} className="flex items-center gap-1.5 px-2.5 py-2 rounded text-xs text-slate-400" style={{ background: G.panel, border: `1px solid ${G.border}` }}>
            <X size={12} />
          </button>
          <p className="w-full text-[11px]" style={{ color: G.sub }}>
            This dashboard is composed and managed in Grafana itself — this just links this device to it. Leave blank and save to clear it.
            Embedding a full dashboard URL here will attempt to iframe it below; Grafana must have <code>allow_embedding</code> enabled for that to render instead of a blank frame — otherwise use &quot;Open in Grafana&quot;.
          </p>
        </div>
      )}

      {/* Body */}
      {url ? (
        <iframe src={url} title="Grafana dashboard" className="w-full" style={{ height: 560, border: 'none', background: G.page }} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(245,95,62,0.12)' }}>
            <AlertTriangle size={22} className="text-[#f55f3e]" />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: G.title }}>No Grafana dashboard configured for this device yet.</p>
            <p className="text-xs mt-1" style={{ color: G.sub }}>
              {canManage
                ? 'Click "Set Grafana link" above to attach this device’s dashboard.'
                : 'Ask an organization admin to attach this device’s Grafana dashboard.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
