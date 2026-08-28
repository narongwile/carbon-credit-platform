'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Chrome for a PdM "engineering study" — a panel you open, consult, and close,
 * as opposed to the live readouts that stay on the page.
 *
 * The transformer page had four of these stacked as inline sub-tabs, so the
 * ambient monitoring surface was mostly periodic-review material: bushing
 * tan-delta (an annual offline Doble test), arrester/OLTC condition (an
 * inspection reference), BESS peak-shaving (a what-if study) and RUL (a
 * planning figure). Only the dissolved-gas verdict and the dynamic rating are
 * things an operator reads while deciding something now, and the dynamic
 * rating — the one panel with a live feed behind it — sat second of four with
 * BESS buried a further level down behind a toggle.
 *
 * Adds what the hand-rolled modals in this page lacked: Escape to close, a
 * backdrop click, focus moved into the dialog on open and returned to the
 * trigger on close, and the page scroll locked while open.
 */
export default function StudyModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  accent = 'indigo',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon: React.ReactNode
  accent?: 'indigo' | 'cyan' | 'emerald' | 'amber' | 'rose'
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusTo.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)

    // Lock page scroll so the sheet behind the dialog does not move.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreFocusTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const accentStyle: Record<string, { bg: string; fg: string }> = {
    indigo: { bg: 'rgba(79,70,229,0.2)', fg: '#a5b4fc' },
    cyan: { bg: 'rgba(8,145,178,0.2)', fg: '#67e8f9' },
    emerald: { bg: 'rgba(5,150,105,0.2)', fg: '#6ee7b7' },
    amber: { bg: 'rgba(217,119,6,0.2)', fg: '#fcd34d' },
    rose: { bg: 'rgba(225,29,72,0.2)', fg: '#fda4af' },
  }
  const a = accentStyle[accent] ?? accentStyle.indigo

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Without this a click anywhere inside the panel bubbles to the
        // backdrop handler and closes the dialog mid-interaction.
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[90vh] bg-[#0d1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-[#0a0e1a]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg flex-shrink-0" style={{ background: a.bg, color: a.fg }}>
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
