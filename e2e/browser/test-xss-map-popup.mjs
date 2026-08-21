import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

// The mock fleet carries a device whose id is  TR-X" onmouseover=alert(1) x="
// — a shape an MQTT topic segment can legally hold, with nothing between the
// broker and the nodes table restricting it.
const EVIL_ID = 'TR-X" onmouseover=alert(1) x="';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Any dialog at all means script executed — the whole point of the test.
let dialogFired = false;
page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`));

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const markers = await page.locator('path.leaflet-interactive').count();
console.log(`markers rendered: ${markers}`);
console.log(`${markers >= 3 ? 'PASS' : 'FAIL'} map rendered the fleet including the hostile device`);

// Open every marker until we find the popup belonging to the hostile device.
let opened = false;
for (let i = 0; i < markers; i++) {
  await page.locator('path.leaflet-interactive').nth(i).click({ force: true });
  await page.waitForTimeout(500);
  const txt = await page.locator('.leaflet-popup').first().textContent().catch(() => '');
  if (txt && txt.includes('Evil Device')) { opened = true; break; }
}
console.log(`${opened ? 'PASS' : 'FAIL'} hostile device popup opened`);

const popupHtml = await page.locator('.leaflet-popup-content').first().innerHTML();

// 1. The injected handler must not have become a real attribute.
const injectedAttr = await page.evaluate(() => {
  const el = document.querySelector('.leaflet-popup-content [onmouseover]');
  return el ? el.outerHTML.slice(0, 120) : null;
});
console.log(`  element carrying an onmouseover attribute: ${injectedAttr ?? 'none'}`);
console.log(`${injectedAttr === null ? 'PASS' : 'FAIL'} no onmouseover attribute was injected into the DOM`);

// 2. The quote must be sitting inside the attribute VALUE, not terminating it.
const attrValue = await page.evaluate(() => {
  const b = document.querySelector('.leaflet-popup-content .gsm-open-btn, .leaflet-popup-content .gsm-reposition-btn');
  return b ? b.getAttribute('data-node-id') : null;
});
console.log(`  data-node-id read back: ${JSON.stringify(attrValue)}`);
console.log(`${attrValue === EVIL_ID ? 'PASS' : 'FAIL'} the id round-trips EXACTLY through the escaped attribute (button still targets the right device)`);

// 3. Escaping must be visible in the serialized HTML.
console.log(`${popupHtml.includes('&quot;') ? 'PASS' : 'FAIL'} the quote is HTML-escaped in the markup`);

// 4. Hover the button — this is what the injected handler was meant to trigger.
const btn = page.locator('.leaflet-popup-content .gsm-open-btn, .leaflet-popup-content .gsm-reposition-btn').first();
if (await btn.count()) { await btn.hover(); await page.waitForTimeout(600); }
console.log(`${!dialogFired ? 'PASS' : 'FAIL'} hovering the popup button executed no script`);

await page.screenshot({ path: './screenshots/xss-popup.png' });
await browser.close();
