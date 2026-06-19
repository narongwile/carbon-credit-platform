import nodemailer from 'nodemailer'
import axios from 'axios'
import type { AlarmEvent } from '../engine.js'

export type Channel = 'email' | 'line' | 'telegram' | 'googlechat'

// Timestamps are stored UTC; format human-facing output in the display tz (ICT).
const DISPLAY_TZ = process.env.DISPLAY_TZ || 'Asia/Bangkok'
function localTime(iso: string): string {
  try { return new Date(iso).toLocaleString('en-GB', { timeZone: DISPLAY_TZ, hour12: false }) + ` (${DISPLAY_TZ})` } catch { return iso }
}

function message(ev: AlarmEvent, prefix = ''): string {
  return `${prefix}[${ev.severity}] ${ev.paramLabel} = ${ev.value}${ev.unit} (limit ${ev.threshold}) on ${ev.nodeId} — ${ev.kind} @ ${localTime(ev.time)}`
}

// ---- Email -----------------------------------------------------------------
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null

async function sendEmail(to: string, ev: AlarmEvent) {
  if (!mailer) { console.log('[notify:email skipped — SMTP not configured]', to); return }
  await mailer.sendMail({ from: process.env.MAIL_FROM || 'alerts@oneops.local', to, subject: `ONEOPS ${ev.severity}: ${ev.paramLabel}`, text: message(ev) })
}

// ---- LINE Notify -----------------------------------------------------------
async function sendLine(token: string, ev: AlarmEvent) {
  const t = token || process.env.LINE_NOTIFY_TOKEN
  if (!t) { console.log('[notify:line skipped]'); return }
  await axios.post('https://notify-api.line.me/api/notify', new URLSearchParams({ message: message(ev, ' ') }), {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

// ---- Telegram --------------------------------------------------------------
async function sendTelegram(ev: AlarmEvent) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) { console.log('[notify:telegram skipped]'); return }
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: message(ev) })
}

// ---- Google Chat -----------------------------------------------------------
async function sendGoogleChat(webhook: string, ev: AlarmEvent) {
  const url = webhook || process.env.GOOGLE_CHAT_WEBHOOK
  if (!url) { console.log('[notify:googlechat skipped]'); return }
  await axios.post(url, { text: message(ev) })
}

export interface ChannelCfg { channel: Channel; target?: string; min_severity?: 'WARNING' | 'CRITICAL' }

export async function dispatch(ev: AlarmEvent, channels: ChannelCfg[], escalation = false): Promise<void> {
  for (const c of channels) {
    if (c.min_severity === 'CRITICAL' && ev.severity !== 'CRITICAL') continue
    const e = escalation ? { ...ev, paramLabel: `ESCALATION · ${ev.paramLabel}` } : ev
    try {
      if (c.channel === 'email' && c.target) await sendEmail(c.target, e)
      else if (c.channel === 'line') await sendLine(c.target || '', e)
      else if (c.channel === 'telegram') await sendTelegram(e)
      else if (c.channel === 'googlechat') await sendGoogleChat(c.target || '', e)
    } catch (err) {
      console.error(`[notify:${c.channel}]`, (err as Error).message)
    }
  }
}
