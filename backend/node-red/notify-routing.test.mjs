import { readFileSync } from 'fs'
const flows = JSON.parse(readFileSync(new URL('./flows.nodered-backend.json', import.meta.url), 'utf8'))
const fn = flows.find(n => n.id === 'notify').func

const USERS = [
  // saved a selection for tr-001
  { id:'u-dept-a', email:'a@x.com', role:'viewer', department_id:'dept-a',
    prefs: JSON.stringify({ telegramBotApi:'TOK@777', lineMsgApi:'LTOK@Uabc', googleChatApi:'https://chat.googleapis.com/hook',
      alertChannels:{ 'tr-001':{ email:true, telegram:true, line:true, googlechat:true } } }) },
  // right node, WRONG department -> must be skipped
  { id:'u-dept-b', email:'b@x.com', role:'viewer', department_id:'dept-b',
    prefs: JSON.stringify({ alertChannels:{ 'tr-001':{ email:true } } }) },
  // admin, no department -> hears everything
  { id:'u-admin', email:'admin@x.com', role:'admin', department_id:null,
    prefs: JSON.stringify({ alertChannels:{ 'tr-001':{ email:true } } }) },
  // has tokens but never saved a selection -> must NOT be contacted
  { id:'u-optout', email:'c@x.com', role:'viewer', department_id:'dept-a',
    prefs: JSON.stringify({ telegramBotApi:'TOK@1' }) },
  // saved for a DIFFERENT node -> must be skipped
  { id:'u-othernode', email:'d@x.com', role:'viewer', department_id:'dept-a',
    prefs: JSON.stringify({ alertChannels:{ 'cn-01':{ email:true } } }) },
  // corrupt prefs must not abort the loop
  { id:'u-broken', email:'e@x.com', role:'viewer', department_id:'dept-a', prefs:'{not json' },
]

const mails = [], posts = []
const pool = { query: async (sql) => {
  if (sql.includes('notification_channels')) return [[]]           // no org channels
  if (sql.includes('FROM users u JOIN user_prefs')) return [USERS]
  return [[]]
}}
const globalCtx = { get: (k) => ({
  pool: pool,
  resolvePool: () => pool,
  mailConfig: async () => ({ from:'noreply@x', transport:{ sendMail: async (m) => { mails.push(m.to) } } }),
  notifyConfig: async () => ({ telegramChatId:'GLOBALCHAT' }),
}[k]) }
const node = { warn: (m)=>console.log('  warn:', m), error: (m)=>console.log('  ERROR:', m) }
globalThis.fetch = async (url, opt) => { posts.push({ url, body: opt?.body }); return { ok:true } }

const msg = { payload: { nodeId:'tr-001', orgId:'org-1', departmentId:'dept-a', paramKey:'oilTemp',
  paramLabel:'Oil Temperature', value:99, unit:'°C', threshold:95, severity:'CRITICAL', kind:'threshold', time:new Date(0).toISOString() } }

// CORS_ORIGIN doubles as the app origin, so deep links work without extra config.
const env = { get: (k) => (k === 'CORS_ORIGIN' ? 'https://iiotplatform.thermexpertise.com' : undefined) }
new Function('env','node','global','msg','fetch', fn)(env, node, globalCtx, msg, globalThis.fetch)

await new Promise(r => setTimeout(r, 300))
console.log('\nemails ->', mails)
console.log('posts  ->', posts.map(p => p.url.replace(/bot[^/]*/,'bot***')))
const ok = (label, cond) => console.log((cond?'PASS':'FAIL')+' — '+label)
ok('dept-a viewer emailed', mails.includes('a@x.com'))
ok('wrong-department viewer NOT emailed', !mails.includes('b@x.com'))
ok('admin emailed regardless of department', mails.includes('admin@x.com'))
ok('user with tokens but no selection NOT contacted', !mails.includes('c@x.com'))
ok('selection for another node NOT contacted', !mails.includes('d@x.com'))
ok('corrupt prefs did not abort the loop', mails.includes('admin@x.com') && mails.length===2)
ok('telegram used chat id from token@chat', posts.some(p=>p.url.includes('api.telegram.org') && String(p.body).includes('"chat_id":"777"')))
ok('line used Messaging API push for token@userId', posts.some(p=>p.url.includes('api.line.me/v2/bot/message/push')))
ok('google chat posted to the saved webhook', posts.some(p=>p.url==='https://chat.googleapis.com/hook'))

// --- rich payloads + deep links -------------------------------------------
const body = (host) => JSON.parse(posts.find(p => p.url.includes(host)).body)
const tg = body('api.telegram.org'), line = body('api.line.me'), gc = body('chat.googleapis.com')
const VIEWER_LINK = 'https://iiotplatform.thermexpertise.com/customer/devices/tr-001/'

ok('telegram sends HTML, not a bare line', tg.parse_mode === 'HTML' && tg.text.includes('<b>'))
ok('telegram carries an Open device button', tg.reply_markup.inline_keyboard[0][0].url === VIEWER_LINK)
ok('line sends a flex bubble, not text', line.messages[0].type === 'flex' && line.messages[0].contents.type === 'bubble')
ok('line altText keeps the plain summary', line.messages[0].altText.includes('Oil Temperature'))
ok('line header is severity-coloured', line.messages[0].contents.header.backgroundColor === '#EF4444')
ok('line footer button opens the device', line.messages[0].contents.footer.contents[0].action.uri === VIEWER_LINK)
ok('google chat sends a card', Array.isArray(gc.cardsV2) && gc.cardsV2[0].card.header.subtitle === 'tr-001')
ok('google chat keeps a text fallback', typeof gc.text === 'string' && gc.text.length > 0)
ok('google chat button opens the device',
   gc.cardsV2[0].card.sections[0].widgets.some(w => w.buttonList?.buttons?.[0]?.onClick?.openLink?.url === VIEWER_LINK))
ok('viewer link points at /customer/, never /admin/', !JSON.stringify([tg,line,gc]).includes('/admin/nodes/'))
ok('links end in a slash (trailingSlash export)', VIEWER_LINK.endsWith('/') && tg.reply_markup.inline_keyboard[0][0].url.endsWith('/'))
