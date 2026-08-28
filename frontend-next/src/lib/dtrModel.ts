/**
 * Dynamic Thermal Rating — the single implementation.
 *
 * Why this file exists: the DTR model lived inside DynamicThermalRating.tsx,
 * and every OTHER consumer of a "dynamic capacity" number — the exported PDF
 * summary, the BESS peak-shaving studio and the diagnostics Copilot — used a
 * flat `nameplateKva * 1.146` instead. That constant is a frozen snapshot of
 * one particular condition (mild ambient, some wind, forced-air cooling), so:
 *
 *   - on a 40 degC windless day with only natural cooling the real model gives
 *     ~0.80x nameplate, while those three consumers still reported 114.6% —
 *     overstating available capacity by more than 40%, in the direction that
 *     encourages loading a transformer that has no headroom;
 *   - the PDF could state a different capacity than the DTR panel rendered on
 *     screen for the same asset at the same moment.
 *
 * One function, one set of coefficients, so those cannot drift apart again.
 *
 * Coefficients are the same ones the DTR panel has always used (IEEE C57.115 /
 * IEC 60076-7 style ambient/wind/solar correction). They are engineering
 * approximations for indicative planning, not a substitute for a full thermal
 * model with real winding time constants.
 */

export type CoolingStage = 'ONAN' | 'ONAF1' | 'ONAF2'

export interface DtrInputs {
  nameplateKva: number
  /** degC. */
  ambientTemp: number
  /** m/s — NOT km/h. Open-Meteo must be queried with wind_speed_unit=ms. */
  windSpeed: number
  /** W/m2. */
  solarIrradiance: number
  coolingStage: CoolingStage
}

export interface DtrResult {
  dynamicRatingKva: number
  ambientFactor: number
  windFactor: number
  solarFactor: number
  coolingMultiplier: number
}

/** ~0.8% capacity per degC below the 40 degC rating ambient. */
const AMBIENT_PCT_PER_DEG = 0.008
/** ~1.2% capacity per m/s of wind above a 1 m/s still-air baseline. */
const WIND_PCT_PER_MS = 0.012
/** Derate under intense sun. */
const SOLAR_DERATE = 0.985
const SOLAR_DERATE_ABOVE_WM2 = 800

export function coolingMultiplierFor(stage: CoolingStage): number {
  return stage === 'ONAN' ? 0.8 : stage === 'ONAF1' ? 1.0 : 1.25
}

export function computeDynamicRating(i: DtrInputs): DtrResult {
  const ambientFactor = 1 + (40 - i.ambientTemp) * AMBIENT_PCT_PER_DEG
  const windFactor = 1 + Math.max(0, i.windSpeed - 1) * WIND_PCT_PER_MS
  const solarFactor = i.solarIrradiance > SOLAR_DERATE_ABOVE_WM2 ? SOLAR_DERATE : 1.0
  const coolingMultiplier = coolingMultiplierFor(i.coolingStage)
  return {
    dynamicRatingKva: Math.round(i.nameplateKva * ambientFactor * windFactor * solarFactor * coolingMultiplier),
    ambientFactor,
    windFactor,
    solarFactor,
    coolingMultiplier,
  }
}

/**
 * Conservative rating for callers that have no live weather feed.
 *
 * Used by the transformer detail page, the PDF export and the BESS studio,
 * none of which receive wind or irradiance. Rather than assume a favourable
 * condition (which is exactly how the 1.146 constant overstated capacity),
 * this credits ONLY the measured ambient temperature and assumes:
 *   - no wind cooling (windSpeed 0),
 *   - no solar derate,
 *   - base forced-air cooling (ONAF1, multiplier 1.0), not the 1.25x
 *     second-stage boost.
 * Every assumption errs toward LESS capacity, so a caller acting on this
 * number is never told it has more headroom than it does.
 *
 * `ambientTemp` is optional because most units do not publish it; when absent
 * the rating falls back to plain nameplate (factor 1.0), which is the neutral
 * assumption rather than a favourable one.
 */
export function conservativeDynamicRating(nameplateKva: number, ambientTemp?: number | null): DtrResult {
  return computeDynamicRating({
    nameplateKva,
    ambientTemp: ambientTemp ?? 40,
    windSpeed: 0,
    solarIrradiance: 0,
    coolingStage: 'ONAF1',
  })
}
