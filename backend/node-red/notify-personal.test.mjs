import { readFileSync } from 'fs'
const flows = JSON.parse(readFileSync(new URL('./flows.nodered-backend.json', import.meta.url), 'utf8'))
const fn = flows.find(n => n.id === 'notifypersonal').func

// Test Case 1: All 4 channels (Email, Telegram, LINE, Google Chat) via user_prefs
{
  const posts = [], mails = []
  const userWithPrefs = [
    { id: 'u-1', email: 'u1@test.com', role: 'viewer',
      prefs: JSON.stringify({
        telegramBotApi: 'BOT1:tok@12345',
        lineMsgApi: 'LINETOK1@U1234567890',
        googleChatApi: 'https://chat.googleapis.com/v1/spaces/test1',
        alertChannels: { 'tr-001': { email: true, telegram: true, line: true, googlechat: true } }
      })
    }
  ]
  const pool = { query: async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN user_prefs')) return [userWithPrefs]
    if (sql.includes('FROM notification_channels WHERE user_id=?')) return [[]]
    return [[]]
  }}
  const globalCtx = { get: (k) => ({
    pool: pool,
    resolvePool: () => pool,
    mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails.push(m) } } }),
    notifyConfig: async () => ({ telegramToken: 'GLOBTOK', telegramChatId: 'GLOBCHAT' }),
  }[k]) }
  const node = { warn: (m) => console.log('  warn:', m), error: (m) => console.log('  ERROR:', m) }
  const fetchMock = async (url, opt) => { posts.push({ url, body: opt?.body, headers: opt?.headers }); return { ok: true } }

  const msg = { payload: [{
    nodeId: 'tr-001', orgId: 'org-1', personalUserId: 'u-1', paramKey: 'oilTemp',
    paramLabel: 'Oil Temperature', value: 89, unit: '°C', threshold: 85, severity: 'WARNING', time: new Date(0).toISOString()
  }]}

  new Function('env', 'node', 'global', 'msg', 'fetch', fn)({ get: () => '' }, node, globalCtx, msg, fetchMock)
  await new Promise(r => setTimeout(r, 200))

  if (!mails.some(m => m.to === 'u1@test.com' && m.html && m.html.includes('Oil Temperature'))) {
    console.error('FAIL - Case 1: Email delivery with HTML failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url.includes('api.telegram.org') && p.url.includes('/botBOT1:tok/sendMessage') && String(p.body).includes('"chat_id":"12345"'))) {
    console.error('FAIL - Case 1: Telegram with token@chat failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url.includes('api.line.me') && String(p.body).includes('"type":"flex"') && String(p.body).includes('U1234567890'))) {
    console.error('FAIL - Case 1: LINE Messaging API Flex bubble push failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url === 'https://chat.googleapis.com/v1/spaces/test1')) {
    console.error('FAIL - Case 1: Google Chat from user_prefs failed')
    process.exit(1)
  }
  console.log('PASS - Case 1: All 4 channels (Email, Telegram, LINE, Google Chat) via user_prefs work')
}

// Test Case 2: Credentials stored in notification_channels (admin/notifications) + Org Token Fallback
{
  const posts = [], mails = []
  const userNoPrefs = [
    { id: 'u-2', email: null, role: 'viewer', prefs: null }
  ]
  const dbChannels = [
    { channel: 'email', target: 'fallback-email@example.com', min_severity: 'WARNING', enabled: 1 },
    { channel: 'googlechat', target: 'https://chat.googleapis.com/v1/spaces/test_from_db', min_severity: 'WARNING', enabled: 1 },
    { channel: 'telegram', target: '998877', min_severity: 'WARNING', enabled: 1 },
    { channel: 'line', target: 'LINE_NOTIFY_RAW_TOKEN_12345', min_severity: 'WARNING', enabled: 1 },
  ]
  const orgTgChannels = [
    { target: 'ORGBOT:tok@ORGLIST' }
  ]
  const pool = { query: async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN user_prefs')) return [userNoPrefs]
    if (sql.includes('FROM notification_channels WHERE user_id=?')) return [dbChannels]
    if (sql.includes("WHERE org_id=? AND channel='telegram'")) return [orgTgChannels]
    if (sql.includes("WHERE org_id=? AND channel='line'")) return [[]]
    return [[]]
  }}
  const globalCtx = { get: (k) => ({
    pool: pool,
    resolvePool: () => pool,
    mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails.push(m) } } }),
    notifyConfig: async () => ({ telegramToken: '', telegramChatId: '', lineToken: '' }),
  }[k]) }
  const node = { warn: (m) => console.log('  warn:', m), error: (m) => console.log('  ERROR:', m) }
  const fetchMock = async (url, opt) => { posts.push({ url, body: opt?.body }); return { ok: true } }

  const msg = { payload: [{
    nodeId: 'tr-001', orgId: 'org-1', personalUserId: 'u-2', paramKey: 'oilTemp',
    paramLabel: 'Oil Temperature', value: 89, unit: '°C', threshold: 85, severity: 'WARNING', time: new Date(0).toISOString()
  }]}

  new Function('env', 'node', 'global', 'msg', 'fetch', fn)({ get: () => '' }, node, globalCtx, msg, fetchMock)
  await new Promise(r => setTimeout(r, 200))

  if (!mails.some(m => m.to === 'fallback-email@example.com')) {
    console.error('FAIL - Case 2: Email fallback to notification_channels failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url === 'https://chat.googleapis.com/v1/spaces/test_from_db')) {
    console.error('FAIL - Case 2: Google Chat fallback to notification_channels failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url.includes('api.telegram.org') && p.url.includes('/botORGBOT:tok/sendMessage') && String(p.body).includes('"chat_id":"998877"'))) {
    console.error('FAIL - Case 2: Telegram fallback to notification_channels & org bot token failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url.includes('notify-api.line.me/api/notify'))) {
    console.error('FAIL - Case 2: LINE Notify fallback failed')
    process.exit(1)
  }
  console.log('PASS - Case 2: All 4 channels fallback to notification_channels works')
}

console.log('All Personal Alarm coverage tests (Email, Telegram, LINE, Google Chat) passed!')
