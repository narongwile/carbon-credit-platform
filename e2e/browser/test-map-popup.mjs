import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket') && !m.text().includes('tile.openstreetmap')) console.log('  [console err]', m.text().slice(0, 200)); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin@x.com', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/map/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('markers on map:', await page.locator('.leaflet-interactive').count());

// Click the CRITICAL device's marker to open its popup.
const markers = await page.locator('.leaflet-interactive').all();
let openedCritical = false;
for (const m of markers) {
  await m.click({ force: true });
  await page.waitForTimeout(400);
  const popupText = await page.locator('.leaflet-popup-content').textContent().catch(() => '');
  if (popupText?.includes('TR-Critical')) { openedCritical = true; break; }
  await page.keyboard.press('Escape').catch(() => {});
}
console.log('PASS found and opened the TR-Critical marker:', openedCritical);

if (openedCritical) {
  const popupText = await page.locator('.leaflet-popup-content').textContent();
  console.log('popup text:', popupText.replace(/\s+/g, ' ').trim());
  console.log('PASS badge shows "Critical":', popupText.includes('Critical'));
  console.log('PASS "View Dashboard" button present:', popupText.includes('View Dashboard'));

  await page.click('button:has-text("View Dashboard")');
  await page.waitForTimeout(1000);
  console.log('URL after clicking View Dashboard:', page.url());
  console.log('PASS navigated to the transformer detail page for tr-critical:', page.url().includes('/admin/transformers/detail') && page.url().includes('tr-critical'));
}

await page.screenshot({ path: './screenshots/map-popup.png' });
await browser.close();
