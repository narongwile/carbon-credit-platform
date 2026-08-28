'use client'

import { AlertTriangle } from 'lucide-react'

/**
 * One banner for every PdM studio panel whose numbers are NOT this asset's
 * measurements.
 *
 * These studios were built as visualisations first and wired to telemetry
 * second, so several of them render engineering verdicts — remaining life,
 * capital-replacement budgets, laboratory certificates, IEEE/IEC severity
 * bands — computed from constants baked into the component. On screen a
 * fabricated figure is indistinguishable from a measured one: same font, same
 * units, same colour-coded status chip.
 *
 * That is the specific failure this repo keeps finding and fixing (a weather
 * fallback labelled "Ultrasonic Mast Sensor", a keyword matcher badged "LLM
 * AGENT ACTIVE", arc-flash protection reported "ARMED" with nothing behind
 * it). The rule that came out of those: reference data may be shown, but it
 * must never be able to be mistaken for a reading off this transformer.
 *
 * Use it for a whole panel. For a single value inside an otherwise-real panel,
 * label that value instead.
 */
export default function DemoDataBanner({
  title,
  detail,
}: {
  /** What is not real, in a few words. */
  title: string
  /** What the operator should use instead, or what would make it real. */
  detail: string
}) {
  return (
    <div
      className="rounded-xl p-3.5 flex items-start gap-3 text-xs"
      style={{ background: 'rgba(69,26,3,0.25)', border: '1px solid rgba(249,115,22,0.35)' }}
    >
      <div className="p-1.5 rounded-md text-amber-300 mt-0.5 flex-shrink-0" style={{ background: 'rgba(249,115,22,0.18)' }}>
        <AlertTriangle size={15} />
      </div>
      <div className="space-y-1 min-w-0">
        <div className="font-bold text-amber-300">{title}</div>
        <p className="text-slate-300 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}
