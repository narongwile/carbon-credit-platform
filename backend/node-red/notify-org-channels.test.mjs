import { readFileSync } from 'fs'
const flows = JSON.parse(readFileSync(new URL('./flows.nodered-backend.json', import.meta.url), 'utf8'))
const fn = flows.find(n => n.id === 'notify').func

// notify-routing.test.mjs deliberately returns NO org channels ("no org
// channels" — it isolates the per-USER alertChannels fan-out). That left the
// ORG/DEPARTMENT channel loop — the notification_channels rows an admin
// configures on admin/notifications — with zero coverage, and a real
// regression slipped through exactly there: a commit adding the 'webhook'
// channel deleted the `await fetch(...)` line out of the 'telegram' branch,
// leaving it computing `tok`/`chat` and then doing nothing. Org-level
// Telegram alarms silently stopped sending, with no error anywhere.
//
// This file covers that loop: every configured org channel must actually
// perform its send, and min_severity must still gate delivery.

const CHANNELS = [
  { channel: 'email',      target: 'ops@x.com',                        min_severity: 'WARNING',  enabled: 1, department_id: null, user_id: null },
  { channel: 'telegram',   target: 'TGTOKEN:abc@999',                  min_severity: 'WARNING',  enabled: 1, department_id: null, user_id: null },
  { channel: 'line',       target: 'LINETOKEN@Uorg',                   min_severity: 'WARNING',  enabled: 1, department_id: null, user_id: null },
  { channel: 'googlechat', target: 'https://chat.googleapis.com/org',  min_severity: 'WARNING',  enabled: 1, department_id: null, user_id: null },
  { channel: 'webhook',    target: 'https://erp.example.com/hook',     min_severity: 'WARNING',  enabled: 1, department_id: null, user_id: null },
  // CRITICAL-only: must NOT fire on the WARNING alarm used below.
  { channel: 'email',      target: 'critical-only@x.com',              min_severity: 'CRITICAL', enabled: 1, department_id: null, user_id: null },
]

const mails = [], posts = []
const pool = { query: async (sql) => {
  if (sql.includes('notification_channels')) return [CHANNELS]
  if (sql.includes('FROM users u JOIN user_prefs')) return [[]]   // no per-user subscriptions: isolate the ORG loop
  return [[]]
}}
const globalCtx = { get: (k) => ({
  pool: pool,
  resolvePool: () => pool,
  mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails.push(m.to) } } }),
  notifyConfig: async () => ({ telegramToken: 'GLOBALTOK', telegramChatId: 'GLOBALCHAT', lineToken: 'GLOBALLINE' }),
}[k]) }
const node = { warn: (m) => console.log('  warn:', m), error: (m) => console.log('  ERROR:', m) }
globalThis.fetch = async (url, opt) => { posts.push({ url, body: opt?.body }); return { ok: true } }

// WARNING (not CRITICAL) on purpose, so the min_severity gate has something to exclude.
const msg = { payload: { nodeId: 'tr-001', orgId: 'org-1', departmentId: 'dept-a', paramKey: 'oilTemp',
  paramLabel: 'Oil Temperature', value: 88, unit: '°C', threshold: 85, severity: 'WARNING', kind: 'threshold', time: new Date(0).toISOString() } }

const env = { get: (k) => (k === 'CORS_ORIGIN' ? 'https://iiotplatform.thermexpertise.com' : undefined) }
new Function('env', 'node', 'global', 'msg', 'fetch', fn)(env, node, globalCtx, msg, globalThis.fetch)

await new Promise(r => setTimeout(r, 300))
console.log('\nemails ->', mails)
console.log('posts  ->', posts.map(p => p.url.replace(/bot[^/]*/, 'bot***')))

let pass = 0, fail = 0
const ok = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label); cond ? pass++ : fail++ }

ok('org email channel sent', mails.includes('ops@x.com'))
ok('org TELEGRAM channel actually sent (regression: the fetch was deleted, leaving a dead branch)',
   posts.some(p => p.url.includes('api.telegram.org') && p.url.includes('/sendMessage')))
ok('org telegram used the token and chat id parsed from token@chat',
   posts.some(p => p.url.includes('/botTGTOKEN:abc/') && String(p.body).includes('"chat_id":"999"')))
ok('org LINE channel sent', posts.some(p => p.url.includes('api.line.me')))
ok('org google chat channel sent', posts.some(p => p.url === 'https://chat.googleapis.com/org'))
ok('org webhook channel sent', posts.some(p => p.url === 'https://erp.example.com/hook'))
ok('webhook payload carries the alarm details, not an empty ping',
   posts.some(p => p.url === 'https://erp.example.com/hook' && String(p.body).includes('oilTemp') && String(p.body).includes('WARNING')))
ok('CRITICAL-only channel NOT contacted for a WARNING alarm (min_severity gate holds)',
   !mails.includes('critical-only@x.com'))

// --- Per-channel fallback test (regression: all-or-nothing !channels.length) ---
// When an org has an email channel configured, but chat channels are not configured or
// disabled (as mail-sink-guard does in UAT), Telegram, Google Chat, and LINE must still
// fall back to global notifyConfig credentials.
const mails2 = [], posts2 = []
const pool2 = { query: async (sql) => {
  if (sql.includes('notification_channels')) {
    return [[{ channel: 'email', target: 'ops2@x.com', min_severity: 'WARNING', enabled: 1, department_id: null, user_id: null }]]
  }
  return [[]]
}}
const globalCtx2 = { get: (k) => ({
  pool: pool2,
  resolvePool: () => pool2,
  mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails2.push(m.to) } } }),
  notifyConfig: async () => ({ telegramToken: 'GLOBALTOK', telegramChatId: 'GLOBALCHAT', lineToken: 'GLOBALLINE', googleChatWebhook: 'https://chat.googleapis.com/global_fallback' }),
}[k]) }
globalThis.fetch = async (url, opt) => { posts2.push({ url, body: opt?.body }); return { ok: true } }

new Function('env', 'node', 'global', 'msg', 'fetch', fn)(env, node, globalCtx2, msg, globalThis.fetch)
await new Promise(r => setTimeout(r, 300))

ok('fallback: email still delivered to org target', mails2.includes('ops2@x.com'))
ok('fallback: telegram sent to platform fallback when org has only email',
   posts2.some(p => p.url.includes('/botGLOBALTOK/') && String(p.body).includes('"chat_id":"GLOBALCHAT"')))
ok('fallback: google chat sent to platform fallback when org has only email',
   posts2.some(p => p.url === 'https://chat.googleapis.com/global_fallback'))
ok('fallback: line sent to platform fallback when org has only email',
   posts2.some(p => p.url.includes('api.line.me')))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
