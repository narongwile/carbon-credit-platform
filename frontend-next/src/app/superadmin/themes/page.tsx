'use client'

// ---------------------------------------------------------------------------
// Dashboard Theme catalog — read-only.
// ---------------------------------------------------------------------------
// This page used to let a superadmin "create" and "delete" themes through a
// form, and toggle a per-platform "3D template provisioned" switch — both
// local React state only, nothing persisted, and both promising something a
// form cannot actually deliver: a theme id is wired to a real dashboard
// component and a real nav destination (THEME_NAV in orgData.ts) elsewhere
// in the codebase. Typing a name into "New Theme" cannot create that
// component or that route, so persisting the form to a real table would
// only have made the illusion survive a refresh — clicking the "new" theme
// would still render nothing.
//
// What actually exists is the fixed set below (dashboardThemes) — this is
// the real catalog the app ships with, not seed data to edit. Granting one
// to an org or a department IS real and lives elsewhere:
//   · superadmin/organizations — which themes an org is licensed for
//     (org_theme_grants)
//   · admin/users → Dashboard View Permission — which of those a department
//     actually sees (department_themes)
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { dashboardThemes, THEME_NAV } from '@/lib/orgData'
import { PLATFORM_TEMPLATES } from '@/lib/platforms'
import { Palette, LayoutGrid, Search, ArrowRight } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const platformName: Record<string, string> = {
  shared: 'Shared (any platform)',
  ...Object.fromEntries(PLATFORM_TEMPLATES.map((p) => [p.id, p.name])),
}

export default function ThemesPage() {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const themes = q ? dashboardThemes.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q)) : dashboardThemes

  // Themes that resolve to the exact same nav destination(s) — real, not a
  // display glitch: th-fix/th-free/th-refrig/th-twin all currently unlock
  // only /customer/devices, so granting any one of them is indistinguishable
  // from granting any other today.
  const navKey = (id: string) => (THEME_NAV[id] ?? []).slice().sort().join('|')
  const groups = new Map<string, string[]>()
  for (const t of dashboardThemes) {
    const k = navKey(t.id)
    if (!k) continue
    groups.set(k, [...(groups.get(k) ?? []), t.id])
  }
  const overlapping = new Set(Array.from(groups.values()).filter((g) => g.length > 1).flat())

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard Themes</h1>
          <p className="text-sm text-slate-500 mt-1">The fixed set of dashboard views the platform ships with, and what each actually unlocks</p>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search themes…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
        </div>
      </div>

      <div className="rounded-xl p-4 text-xs text-slate-500 flex items-start gap-2" style={inset}>
        <Palette size={14} className="text-indigo-400 flex-shrink-0 mt-0.5" />
        <span>
          Adding a genuinely new theme means a new dashboard component and a new nav route, not a form here — this list is a
          reference. To license a theme to an org, use <span className="text-slate-300">Organizations</span>; to decide which
          of an org&apos;s licensed themes a department actually sees, use <span className="text-slate-300">User Management → Dashboard View Permission</span>.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {themes.map((th) => {
          const hrefs = THEME_NAV[th.id] ?? []
          return (
            <div key={th.id} className="rounded-xl p-5" style={surface}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${th.accent}1f` }}>
                  <LayoutGrid size={18} style={{ color: th.accent }} />
                </div>
                {overlapping.has(th.id) && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.12)' }}>
                    Same view as others
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-white">{th.name}</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{th.description}</p>
              <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid #1e2433' }}>
                <div className="flex items-center gap-1.5">
                  <Palette size={12} className="text-slate-600" />
                  <span className="text-[11px] text-slate-400">{platformName[th.platformType] ?? th.platformType}</span>
                </div>
                {hrefs.length > 0 && (
                  <div className="flex items-start gap-1.5">
                    <ArrowRight size={12} className="text-slate-600 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-slate-500 font-mono">{hrefs.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {themes.length === 0 && (
          <div className="col-span-full rounded-xl p-8 text-center text-sm text-slate-500" style={surface}>No theme matches that search.</div>
        )}
      </div>
    </div>
  )
}
