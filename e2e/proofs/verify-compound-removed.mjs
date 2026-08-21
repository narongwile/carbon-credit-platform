import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,200)));

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/notifications', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

const bodyText = await page.textContent('body');
console.log(`${!bodyText.includes('Compound Alarms') ? 'PASS' : 'FAIL'} "Compound Alarms" tab is gone from the page`);
console.log(`${bodyText.includes('Reading Parameters') ? 'PASS' : 'FAIL'} "Reading Parameters" tab still present`);
console.log(`${!bodyText.includes('Top Oil Temperature High / Critical') ? 'PASS' : 'FAIL'} the dead "High / Critical" combined row is gone`);
console.log(`${bodyText.includes('Top Oil Temperature') ? 'PASS' : 'FAIL'} the real oilTemp reading row is still there`);

await page.screenshot({ path: './screenshots/notifications-alarmconfig.png', fullPage: false });
await browser.close();
