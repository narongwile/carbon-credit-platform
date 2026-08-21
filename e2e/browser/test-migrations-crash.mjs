import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

let sawUncaughtCrash = false;
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  if (e.message.includes("Cannot read properties of undefined") && e.message.includes('length')) sawUncaughtCrash = true;
});
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('WebSocket') && !t.includes('ERR_CONNECTION_RESET') && !t.includes('404')) {
    console.log('[console error]', t.slice(0, 300));
    if (t.includes("Cannot read properties of undefined") && t.includes('length')) sawUncaughtCrash = true;
  }
});

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'super', email: 'superadmin', role: 'superadmin', name: 'super' }));
});
await page.goto('http://localhost:3901/superadmin/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

console.log('PASS page loaded before clicking:', !(await page.textContent('body')).includes('Application error'));

await page.click('button:has-text("Run migrations")');
await page.waitForTimeout(1000);
console.log('PASS migrations panel opened:', (await page.textContent('body')).includes('Schema migrations'));

// This click triggers the REAL POST /api/platform/migrations/run -> our mock
// answers exactly like migrationsRunFunc's own 502 path: {error: '...'} only.
await page.click('button:has-text("Run migrations"):not(:has-text("behind"))').catch(() => {});
// The button label includes a count when orgsBehind>0 ("Run migrations (1 behind)")
const runBtn = page.locator('div.fixed button:has-text("Run migrations")').last();
await runBtn.click();
await page.waitForTimeout(1500);

const bodyAfter = await page.textContent('body');
console.log('PASS page did NOT crash (no "Application error"):', !bodyAfter.includes('Application error'));
console.log('PASS no uncaught "Cannot read properties of undefined (reading \'length\')":', !sawUncaughtCrash);
console.log('PASS shows the real reason instead of a crash:', bodyAfter.includes('could not reach the migrate service'));
console.log('PASS panel still interactive (Schema migrations heading present):', bodyAfter.includes('Schema migrations'));

await page.screenshot({ path: './screenshots/migrations-502.png' });
await browser.close();
