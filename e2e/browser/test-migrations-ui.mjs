import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log('[console]', m.text().slice(0, 150)); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'superadmin', email: 'sa@x.com', role: 'superadmin', name: 'superadmin' }));
});
await page.goto('http://localhost:3901/superadmin/organizations', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const migBtn = page.locator('button[title*="Schema migration"], button[title*="tenant database"]').first();
console.log('migrations button found:', await migBtn.count() > 0);
await migBtn.click();
await page.waitForTimeout(800);

const panelVisible = await page.locator('text=Schema migrations').count();
console.log('panel opened:', panelVisible > 0);

const runBtn = page.locator('button:has-text("Run migrations")').last();
console.log('run button found:', await runBtn.count() > 0);
await runBtn.click();
await page.waitForTimeout(1200);

const body = await page.textContent('body');
console.log('\n--- what the superadmin actually sees ---');
console.log('shows the REAL backend error text ("could not reach the migrate service: fetch failed"):', body.includes('could not reach the migrate service: fetch failed'));
console.log('does NOT show only the old generic toast with nothing else:', !(body.includes('Could not reach the migrate service') && !body.includes('fetch failed')));

await page.waitForTimeout(300); await page.screenshot({ path: './screenshots/migrations.png' });
await browser.close();
