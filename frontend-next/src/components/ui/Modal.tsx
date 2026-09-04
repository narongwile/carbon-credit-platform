'use client'

import { useCallback, useEffect, useId, useRef } from 'react'

/**
 * The one dialog shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * 37 files in this app render their own `fixed inset-0` overlay. A survey of
 * them found 6 that closed on Escape, 3 that locked the page scroll and 1 that
 * did anything at all with focus. The rest are a div on top of the page: a
 * screen reader is never told a dialog opened, Tab walks straight out of the
 * panel and into the page underneath it, Escape does nothing, and the sheet
 * behind the backdrop scrolls under the pointer.
 *
 * That is a nuisance on a settings panel. On this product it is not, because
 * the same pattern carries the four-eyes electronic signature, the OTA
 * firmware rollout and the bulk threshold write — operations where the person
 * confirming needs to be certain what they are confirming, and where the
 * record of who confirmed it is the point.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   role="dialog" + aria-modal   the dialog is announced as one
 *   aria-labelledby              announced by its own title, not "dialog"
 *   focus moved in on open       the keyboard starts inside the panel
 *   focus TRAPPED while open     Tab and Shift+Tab cycle within the panel
 *   focus restored on close      the launcher gets the keyboard back
 *   Escape closes                unless `busy`
 *   backdrop click closes        unless `busy`
 *   page scroll locked           the sheet behind cannot move
 *
 * THE `busy` CONTRACT
 * -------------------
 * `busy` is not decoration. While a write is in flight, Escape and the
 * backdrop are inert, so a dialog cannot be dismissed out from under a request
 * whose result the operator then never sees. Pass it whenever the dialog owns
 * an in-flight mutation, and disable the submit button from the same state so
 * the write cannot be issued twice.
 */
export default function Modal({
  open,
  onClose,
  title,
  busy = false,
  className = '',
  overlayClassName = '',
  zIndex,
  labelledBy,
  children,
}: {
  open: boolean
  /** Called for Escape and backdrop click. Ignored while `busy`. */
  onClose: () => void
  /**
   * Accessible name. Supply this OR `labelledBy` pointing at an element id
   * inside `children` — a dialog announced only as "dialog" is why the
   * pre-existing overlays were unusable without sight of the screen.
   */
  title?: string
  /** A mutation is in flight: Escape and backdrop click are disabled. */
  busy?: boolean
  /** Classes for the panel. */
  className?: string
  /** Classes for the backdrop, e.g. a different scrim or alignment. */
  overlayClassName?: string
  /** Stacking level for nested dialogs. Defaults to 50. */
  zIndex?: number
  /** id of an element inside `children` that names the dialog. */
  labelledBy?: string
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  // Callers overwhelmingly pass `onClose={() => setThing(null)}` — a new
  // function identity every render. Keeping it in the dependency array would
  // tear down and re-run the effect on every render while the dialog is open,
  // and two of the things the effect does are not idempotent: prevOverflow
  // would be re-read after the lock was applied (leaving the page permanently
  // scroll-locked) and restoreFocusTo would be re-captured from the panel
  // itself (so closing would focus a removed node instead of the launcher).
  // Held in a ref so the effect depends only on `open`.
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { busyRef.current = busy }, [busy])

  const autoId = useId()
  const titleId = labelledBy ?? (title ? `modal-title-${autoId}` : undefined)

  const focusable = useCallback(() => {
    const root = panelRef.current
    if (!root) return [] as HTMLElement[]
    const nodes = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    // A disabled-looking control can still be visible; an element inside a
    // collapsed section cannot be focused at all, and including it would make
    // the trap appear to skip a tab stop.
    return Array.from(nodes).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
    )
  }, [])

  useEffect(() => {
    if (!open) return
    restoreFocusTo.current = document.activeElement as HTMLElement | null

    // Prefer the first real control so typing starts where the operator
    // expects; fall back to the panel, which is why it carries tabIndex={-1}.
    const first = focusable()[0]
    if (first) first.focus()
    else panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (busyRef.current) return
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      // The trap. Without it Tab leaves the panel on the last control and
      // continues into the page behind the backdrop, where every control is
      // still reachable and clickable by keyboard while the dialog claims to
      // be modal.
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current?.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = panelRef.current?.contains(active ?? null)

      if (!inside) {
        e.preventDefault()
        ;(e.shiftKey ? lastEl : firstEl).focus()
      } else if (e.shiftKey && active === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      restoreFocusTo.current?.focus?.()
    }
  }, [open, focusable])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm ${overlayClassName}`}
      style={{ zIndex: zIndex ?? 50 }}
      role="presentation"
      onMouseDown={(e) => {
        // mousedown, not click: a click whose press started inside the panel
        // and whose release landed on the backdrop (a text drag that overshot)
        // fires click on the backdrop and would close the dialog mid-edit.
        if (e.target !== e.currentTarget) return
        if (busy) return
        onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titleId ? undefined : title}
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className={`outline-none ${className}`}
      >
        {title && !labelledBy && (
          <span id={titleId} className="sr-only">
            {title}
          </span>
        )}
        {children}
      </div>
    </div>
  )
}
