'use client'

// ---------------------------------------------------------------------------
// Sidebar shell shared by the admin and customer portals.
// ---------------------------------------------------------------------------
// The sidebar was a plain 14rem column that existed at every viewport. On a
// phone that is roughly half the screen, permanently, for navigation the user
// needs for one tap out of a hundred.
//
// Below lg it is now an off-canvas drawer behind a hamburger in a slim top bar,
// closing on backdrop click, on Escape, and on navigation. From lg up it stays
// docked and gains a collapse toggle that shrinks it to icons; that choice is
// remembered, because someone who wants the width back wants it on every page,
// not once.
//
// The portals keep rendering their own sidebar contents — they differ in brand,
// org/viewer switchers and badges. Only the responsive behaviour lives here, so
// there is one place to fix it rather than two that drift.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import clsx from 'clsx'

const STORAGE_KEY = 'oneops-nav-collapsed'

export interface SidebarCtx {
  /** Desktop icon-only mode. Never true inside the mobile drawer. */
  collapsed: boolean
  /** Close the mobile drawer — call from anything that navigates. */
  close: () => void
}

export default function AppShell({
  brand, sidebar, children,
}: {
  /** Compact brand for the mobile top bar (the sidebar renders its own). */
  brand?: React.ReactNode
  sidebar: (ctx: SidebarCtx) => React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Read the preference after mount: touching localStorage during render would
  // desync the server-rendered HTML and blank the sidebar on hydration.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === '1') } catch { /* private mode */ }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }, [])

  const close = useCallback(() => setOpen(false), [])

  // A drawer that survives navigation would cover the page the user just asked
  // for. Closing on pathname change also covers links deep inside the content.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0e1a' }}>
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(2,6,23,0.7)' }}
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          'flex flex-col flex-shrink-0 z-50 w-56 max-w-[80vw]',
          'fixed inset-y-0 left-0 lg:static lg:translate-x-0',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
          // Icon-only applies to the docked sidebar only; the drawer is opened
          // deliberately and should show labels.
          collapsed && 'lg:w-14',
        )}
        style={{ background: '#0d1117', borderRight: '1px solid #1e2433' }}
      >
        <button
          onClick={close}
          className="lg:hidden absolute top-3 right-3 z-10 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>

        {sidebar({ collapsed, close })}

        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex items-center justify-center gap-2 py-2 text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
          style={{ borderTop: '1px solid #1e2433' }}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <><PanelLeftClose size={15} /><span className="text-[11px]">Collapse</span></>}
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div
          className="lg:hidden flex items-center gap-2 px-3 h-12 flex-shrink-0"
          style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}
        >
          <button
            onClick={() => setOpen(true)}
            className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
            aria-label="Open navigation"
            aria-expanded={open}
          >
            <Menu size={20} />
          </button>
          {brand}
        </div>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

/**
 * One nav entry. `section` starts a labelled group — Floor Plans belongs with
 * Sites, not floating between the map and the trends, and the grouping says so
 * without moving the route (which would only break existing links).
 */
export interface NavEntry {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  section?: string
  /** Indented under the entry above it. */
  child?: boolean
}

/** Section heading, hidden when the sidebar is collapsed to icons. */
export function NavSection({ title, collapsed }: { title: string; collapsed: boolean }) {
  if (collapsed) return <div className="lg:my-2 lg:mx-3 lg:h-px" style={{ background: '#1e2433' }} />
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
      {title}
    </div>
  )
}
