import { rollupAndPurgeReadings } from './repo.js'

// Hourly: roll raw readings older than READINGS_RETENTION_DAYS into hourly
// buckets (readings_rollup), then purge the raw rows so `readings` stays lean.
export function startRetention(): void {
  const days = Number(process.env.READINGS_RETENTION_DAYS || 30)
  const tick = async () => {
    try {
      const purged = await rollupAndPurgeReadings(days)
      if (purged) console.log(`[retention] rolled up + purged ${purged} raw readings (> ${days}d)`)
    } catch (e) {
      console.error('[retention]', (e as Error).message)
    }
  }
  setInterval(tick, 3_600_000)
  console.log(`[retention] active — raw readings kept ${days} day(s), then downsampled`)
}
