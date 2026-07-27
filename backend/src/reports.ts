import nodemailer from 'nodemailer'
import { dueSchedules, nodeIdsForScope, summaryReadings, markScheduleRun } from './repo.js'

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null

const seqDays = (s: string) => (s === 'weekly' ? 7 : s === 'monthly' ? 30 : 1)

// Every 15 min: run due report schedules → build a CSV summary of the period's
// readings for the scope → email it to the recipients (mirrors the Node-RED cron).
export function startReports(): void {
  const tick = async () => {
    try {
      const due = await dueSchedules()
      for (const s of due) {
        const nodeIds = await nodeIdsForScope(s.org_id as string, s.scope as string, (s.scope_id as string) ?? null)
        const rows = await summaryReadings(nodeIds, seqDays(s.sequence as string))
        let csv = 'node_id,param_key,n,avg,min,max\n'
        for (const r of rows) csv += `${r.node_id},${r.param_key},${r.n},${Number(r.a).toFixed(2)},${Number(r.mn).toFixed(2)},${Number(r.mx).toFixed(2)}\n`
        const to = String(s.recipients || '').trim()
        if (to && mailer) {
          await mailer.sendMail({
            from: process.env.MAIL_FROM || 'alerts@oneops.local', to,
            subject: `ONEOPS Report: ${s.name}`, text: `Automated ${s.sequence} ${s.scope} report.`,
            attachments: [{ filename: `${String(s.name).replace(/\s+/g, '_')}.csv`, content: csv }],
          })
        } else {
          console.log(`[reports] ${s.name}: email skipped (no SMTP/recipients), ${nodeIds.length} nodes`)
        }
        await markScheduleRun(s.id as string, s.sequence as string)
      }
    } catch (e) {
      console.error('[reports]', (e as Error).message)
    }
  }
  setInterval(tick, 900_000)
  console.log('[reports] scheduler active — due schedules every 15 min')
}
