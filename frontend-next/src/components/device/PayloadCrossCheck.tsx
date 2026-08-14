'use client'

// ---------------------------------------------------------------------------
// "Did this device send what we expect it to send?"
//
// Two rows that must be read TOGETHER: what actually arrived on the wire, and
// what the org's payload spec (display_params/param_labels) says should
// arrive. The whole value of showing them adjacently is being able to pair
// them without reading every key twice, so the colour does the pairing:
//
//   amber  — this key is in BOTH. Same meaning on both rows, which is the
//            point; a matched parameter lights up on the line above and the
//            line below and the eye connects them.
//   plain  — sent, but the spec never asked for it. Informational, not an
//            error: a device may report extra sensors.
//   rose   — expected, but absent from the last sample. This is the only row
//            that can show it, and it deliberately does NOT reuse amber —
//            one colour meaning "confirmed" on one line and "missing" on the
//            next, one line apart, is worse than no colour at all.
//
// Lives in one component rather than being written twice because admin/pending
// (onboarding: approve this device?) and admin/fleet (operations: why is this
// parameter missing?) ask the same question at different points in a device's
// life, and a cross-check whose colours mean different things on two pages is
// not a cross-check.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { Activity, AlertTriangle } from 'lucide-react'

const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
export const matchedChip = { background: 'rgba(251,191,36,0.10)', border: '1px solid #92702c' }
export const missingChip = { background: 'rgba(239,68,68,0.07)', border: '1px dashed #7f3a3a' }

export default function PayloadCrossCheck({
  sample, specKeys, labelOf, action, unconfiguredHint, missingNote, className = '',
}: {
  /** What actually arrived, in wire order: [key, value][]. */
  sample: [string, number | string][]
  /** What the org's spec expects for this product. Empty = not configured. */
  specKeys: string[]
  /** Wire key -> the name a human reads. */
  labelOf: (key: string) => string
  /** Optional trailing control on the Expected row (e.g. a Configure button). */
  action?: ReactNode
  /** Shown in place of the expected chips when no spec exists yet. */
  unconfiguredHint?: string
  /** Extra context appended to the missing-fields warning, per page. */
  missingNote?: string
  className?: string
}) {
  const sampleKeys = new Set(sample.map(([k]) => k))
  const specKeySet = new Set(specKeys)
  const missing = specKeys.filter((k) => !sampleKeys.has(k))

  return (
    <div className={className}>
      {sample.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Activity size={12} className="text-slate-500 flex-shrink-0" />
          {sample.map(([k, v]) => {
            const inSpec = specKeySet.has(k)
            return (
              <span key={k} className="text-[11px] px-2 py-0.5 rounded-md font-mono"
                style={inSpec ? matchedChip : inset}
                title={inSpec
                  ? `matches "${labelOf(k)}" in the expected payload`
                  : 'sent by this device but not in the expected payload for this product'}>
                <span className={inSpec ? 'text-amber-500/80' : 'text-slate-500'}>{k}</span>{' '}
                <span className={inSpec ? 'text-amber-300' : 'text-slate-200'}>{typeof v === 'number' ? v : String(v)}</span>
              </span>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider flex-shrink-0">Expected payload</span>
        {specKeys.length > 0 ? (
          specKeys.map((k) => {
            const present = sampleKeys.has(k)
            return (
              <span key={k} className="text-[11px] px-2 py-0.5 rounded-md"
                style={present ? matchedChip : missingChip}
                title={present ? 'reported in the last sample above' : 'not seen in the last sample — may be optional on this unit'}>
                <span className={present ? 'text-amber-300' : 'text-rose-400'}>{labelOf(k)}</span>
                <span className={`font-mono ml-1 ${present ? 'text-amber-500/70' : 'text-slate-600'}`}>{k}</span>
              </span>
            )
          })
        ) : (
          <span className="text-[11px] text-slate-600">{unconfiguredHint ?? 'not configured yet'}</span>
        )}
        {action}
      </div>

      {missing.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 text-[11px] text-rose-400">
          <AlertTriangle size={11} className="flex-shrink-0" />
          <span>
            {missing.length} expected field{missing.length === 1 ? '' : 's'} not in the last sample
            {' '}({missing.join(', ')}) — {missingNote ?? 'may be an optional sensor on this unit, or the firmware may not be sending it.'}
          </span>
        </div>
      )}
    </div>
  )
}
