import { readFileSync } from 'fs'
const flows = JSON.parse(readFileSync(new URL('./flows.nodered-backend.json', import.meta.url), 'utf8'))
const fn = flows.find(n => n.id === 'notifypersonal').func

// Test Case 1: Credentials stored in user_prefs (Profile / My Alert Settings)
{
  const posts = [], mails = []
  const userWithPrefs = [
    { id: 'u-1', email: 'u1@test.com', role: 'viewer',
      prefs: JSON.stringify({
        telegramBotApi: 'BOT1:tok@12345',
        googleChatApi: 'https://chat.googleapis.com/v1/spaces/test1',
        alertChannels: { 'tr-001': { telegram: true, googlechat: true } }
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
    mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails.push(m.to) } } }),
    notifyConfig: async () => ({ telegramToken: 'GLOBTOK', telegramChatId: 'GLOBCHAT' }),
  }[k]) }
  const node = { warn: (m) => console.log('  warn:', m), error: (m) => console.log('  ERROR:', m) }
  const fetchMock = async (url, opt) => { posts.push({ url, body: opt?.body }); return { ok: true } }

  const msg = { payload: [{
    nodeId: 'tr-001', orgId: 'org-1', personalUserId: 'u-1', paramKey: 'oilTemp',
    paramLabel: 'Oil Temperature', value: 89, unit: '°C', threshold: 85, severity: 'WARNING', time: new Date(0).toISOString()
  }]}

  new Function('env', 'node', 'global', 'msg', 'fetch', fn)({ get: () => '' }, node, globalCtx, msg, fetchMock)
  await new Promise(r => setTimeout(r, 200))

  if (!posts.some(p => p.url.includes('api.telegram.org') && p.url.includes('/botBOT1:tok/sendMessage') && String(p.body).includes('"chat_id":"12345"'))) {
    console.error('FAIL - Case 1: Telegram with token@chat failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url === 'https://chat.googleapis.com/v1/spaces/test1')) {
    console.error('FAIL - Case 1: Google Chat from user_prefs failed')
    process.exit(1)
  }
  console.log('PASS - Case 1: Personal alarm via user_prefs works')
}

// Test Case 2: Credentials stored in notification_channels (admin/notifications)
{
  const posts = [], mails = []
  const userNoPrefs = [
    { id: 'u-2', email: 'u2@test.com', role: 'viewer', prefs: null }
  ]
  const dbChannels = [
    { channel: 'googlechat', target: 'https://chat.googleapis.com/v1/spaces/test_from_db', min_severity: 'WARNING', enabled: 1 },
    { channel: 'telegram', target: '998877', min_severity: 'WARNING', enabled: 1 },
  ]
  const orgTgChannels = [
    { target: 'ORGBOT:tok@ORGLIST' }
  ]
  const pool = { query: async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN user_prefs')) return [userNoPrefs]
    if (sql.includes('FROM notification_channels WHERE user_id=?')) return [dbChannels]
    if (sql.includes("WHERE org_id=? AND channel='telegram'")) return [orgTgChannels]
    return [[]]
  }}
  const globalCtx = { get: (k) => ({
    pool: pool,
    resolvePool: () => pool,
    mailConfig: async () => ({ from: 'noreply@x', transport: { sendMail: async (m) => { mails.push(m.to) } } }),
    notifyConfig: async () => ({ telegramToken: '', telegramChatId: '' }),
  }[k]) }
  const node = { warn: (m) => console.log('  warn:', m), error: (m) => console.log('  ERROR:', m) }
  const fetchMock = async (url, opt) => { posts.push({ url, body: opt?.body }); return { ok: true } }

  const msg = { payload: [{
    nodeId: 'tr-001', orgId: 'org-1', personalUserId: 'u-2', paramKey: 'oilTemp',
    paramLabel: 'Oil Temperature', value: 89, unit: '°C', threshold: 85, severity: 'WARNING', time: new Date(0).toISOString()
  }]}

  new Function('env', 'node', 'global', 'msg', 'fetch', fn)({ get: () => '' }, node, globalCtx, msg, fetchMock)
  await new Promise(r => setTimeout(r, 200))

  if (!posts.some(p => p.url === 'https://chat.googleapis.com/v1/spaces/test_from_db')) {
    console.error('FAIL - Case 2: Google Chat fallback to notification_channels failed')
    process.exit(1)
  }
  if (!posts.some(p => p.url.includes('api.telegram.org') && p.url.includes('/botORGBOT:tok/sendMessage') && String(p.body).includes('"chat_id":"998877"'))) {
    console.error('FAIL - Case 2: Telegram fallback to notification_channels & org bot token failed')
    process.exit(1)
  }
  console.log('PASS - Case 2: Personal alarm fallback to notification_channels & org bot token works')
}

console.log('All Personal Alarm notify tests passed!')
