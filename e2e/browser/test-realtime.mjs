import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const B = 'http://localhost:4001';
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('dialog', (d) => d.accept());

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/pending', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const body = () => page.textContent('body');

console.log('--- 1. live indicator ---');
console.log('shows "Live" (socket connected):', (await body()).includes('Live'));

console.log('\n--- 2. a frame moves the numbers, without a poll ---');
console.log('before, oilTemp 63.4 on screen:', (await body()).includes('63.4'));
const sent = await post('/__test/frame', {
  id: 'TRA-9F2C',
  values: { oilTemp: 99.9, hydrogen: 118, moisture: 21, load: 72, extraSensor: 5 },
  timestamp: new Date().toISOString(),
});
console.log('frame delivered to', sent.sentTo, 'socket(s)');
// Deliberately far under the 10s poll: if this passes, it cannot have been the poll.
await page.waitForTimeout(1200);
const after = await body();
console.log('after 1.2s, oilTemp 99.9 on screen:', after.includes('99.9'));
console.log('stale 63.4 gone:', !after.includes('63.4'));

console.log('\n--- 3. a heartbeat (no values) must NOT blank the chips ---');
await post('/__test/frame', { id: 'TRA-9F2C', timestamp: new Date().toISOString() });
await page.waitForTimeout(800);
console.log('oilTemp 99.9 still shown after valueless frame:', (await body()).includes('99.9'));

console.log('\n--- 4. an unknown device id triggers an immediate reload ---');
// Register a brand-new pending device server-side, then announce it by frame.
// The page has never heard of tr-9901, so it should reload at once rather than
// waiting out the 10s poll.
await post('/__test/pending', {
  id: 'tr-9901', org_id: 'org-1', org_name: 'KMUTT', domain: 'transformer', name: 'tr-9901',
  mqtt_prefix: 'telemetry/org-1/eternity/tr-9901',
  first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), online: 1,
  last_sample: { oilTemp: 41.2, hydrogen: 80, moisture: 12 },
});
console.log('tr-9901 on screen before its frame:', (await body()).includes('tr-9901'));
await post('/__test/frame', { id: 'tr-9901', values: { oilTemp: 41.2 }, timestamp: new Date().toISOString() });
await page.waitForTimeout(1500);   // again, far under the 10s poll
console.log('tr-9901 on screen 1.5s after its first frame:', (await body()).includes('tr-9901'));

console.log('\n--- 5. reject now confirms before it blacklists ---');
let asked = null;
page.removeAllListeners('dialog');
page.on('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
await page.locator('button:has-text("Reject")').first().click();
await page.waitForTimeout(600);
console.log('confirm shown:', !!asked);
console.log('says it is permanent:', /permanent/i.test(asked || ''));
console.log('dismissing kept the device:', (await body()).includes('TRA-9F2C'));

await page.screenshot({ path: './screenshots/realtime.png', fullPage: false });
await browser.close();
