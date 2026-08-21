import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket') && !m.text().includes('tile.openstreetmap')) console.log('  [console err]', m.text().slice(0, 200)); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin@x.com', role: 'admin', orgId: 'org-1', name: 'admin' }));
});

console.log('####### Case A: device HAS its own coordinate (TRA-9F2C) #######');
await page.goto('http://localhost:3901/admin/transformers/detail/?id=TRA-9F2C', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
{
  const body = await page.textContent('body');
  console.log('PASS "Device Location" heading present:', body.includes('Device Location'));
  console.log('PASS shows real coordinate (13.73600, 100.52300):', body.includes('13.73600') && body.includes('100.52300'));
  console.log('PASS Google Maps link present:', body.includes('Google Maps'));
  const gmapsHref = await page.getAttribute('a:has-text("Google Maps")', 'href').catch(() => null);
  console.log('Google Maps href:', gmapsHref);
  console.log('PASS href points at the real coordinate:', gmapsHref?.includes('13.736') && gmapsHref?.includes('100.523'));
  console.log('PASS "Adjust" button shown for admin:', body.includes('Adjust this device'));
  console.log('PASS no "approximate" warning (this IS the device\'s own pin):', !body.includes('Approximate'));
  const leafletTiles = await page.locator('.leaflet-tile-container img, .leaflet-container').count();
  console.log('PASS a real Leaflet map rendered:', leafletTiles > 0);
}
await page.screenshot({ path: './screenshots/loc-case-a.png' });

console.log('\n####### Case B: device has NO coordinate, site has none either (tr-nositecoord) #######');
await page.goto('http://localhost:3901/admin/transformers/detail/?id=tr-nositecoord', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
{
  const body = await page.textContent('body');
  console.log('PASS "No location set yet" shown:', body.includes('No location set yet'));
  console.log('PASS offers to set the SITE\'s location first (not just the device\'s):', body.includes('Substation A') && body.includes('location'));
}
await page.screenshot({ path: './screenshots/loc-case-b.png' });

console.log('\n####### Case C: set the site location, verify it persists + shows as approximate #######');
{
  await page.click('button:has-text("Set")');
  await page.waitForTimeout(1500);
  const picker = page.locator('.leaflet-container').last();
  await picker.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await picker.click({ position: { x: 80, y: 100 } }); // avoid the top-left zoom control
  await page.waitForTimeout(1500);
  const body = await page.textContent('body');
  console.log('PASS toast/save happened, no longer "No location set":', !body.includes('No location set yet'));
  console.log('PASS shows "Approximate" (this is the SITE fallback, not the device\'s own):', body.includes('Approximate'));
  console.log('PASS offers "Set this device\'s exact position":', body.includes('Set this device') && body.includes('exact position'));
}
await page.screenshot({ path: './screenshots/loc-case-c.png' });

await browser.close();
