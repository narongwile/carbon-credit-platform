// ---------------------------------------------------------------------------
// A transformer's size class, purely as a function of its nameplate rating.
// ---------------------------------------------------------------------------
// Deliberately NOT a stored column: a persisted class could disagree with the
// rated_kva sitting one row above it in the same panel the moment either one
// is edited without the other — exactly the "looks real, might be wrong"
// failure this whole nameplate feature exists to eliminate. Computed at
// render time from the one number that actually means something instead.
//
// Not coupled to alarm thresholds — those are already configurable per device
// via AlarmParamConfig, and duplicating that with class-based defaults here
// would be two systems able to disagree about the same thing.
// ---------------------------------------------------------------------------

export type TransformerClass = 'distribution' | 'medium_power' | 'large_power'

export const TRANSFORMER_CLASS_LABEL: Record<TransformerClass, string> = {
  distribution: 'Distribution',
  medium_power: 'Medium Power',
  large_power: 'Large Power',
}

/** null when there is no rating to classify — "not entered yet", not a guess. */
export function classifyByKva(ratedKva: number | null | undefined): TransformerClass | null {
  if (ratedKva === null || ratedKva === undefined || !isFinite(ratedKva) || ratedKva <= 0) return null
  if (ratedKva <= 1000) return 'distribution'
  if (ratedKva <= 2500) return 'medium_power'
  return 'large_power'
}
