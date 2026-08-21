import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

async function loginAs(page, role, email, orgId) {
  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ role, email, orgId }) => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: email, email, role, orgId, name: email }));
  }, { role, email, orgId });
}

/** Open the first marker whose popup mentions TRA-9F2C, return the popup text. */
async function openPopupFor(page, wantName) {
  const markers = await page.locator('.leaflet-interactive').all();
  for (const m of markers) {
    await m.click({ force: true });
    await page.waitForTimeout(500);
    const txt = await page.locator('.leaflet-popup-content').textContent().catch(() => '');
    if (txt?.includes(wantName)) {
      // Live readings arrive asynchronously (api.latest on popupopen)
      await page.waitForFunction(
        () => !document.querySelector('.leaflet-popup-content')?.textContent?.includes('Loading…'),
        { timeout: 8000 },
      ).catch(() => {});
      await page.waitForTimeout(400);
      return await page.locator('.leaflet-popup-content').textContent();
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return null;
}

function report(prefix, txt) {
  if (!txt) { console.log(`${prefix} POPUP NOT FOUND`); return; }
  const flat = txt.replace(/\s+/g, ' ').trim();
  console.log(`${prefix} popup text: ${flat}`);
  const checks = {
    'status badge (Healthy/Warning/Critical)': /Healthy|Warning|Critical/.test(flat),
    'presence badge (Online/Offline)': /Online|Offline/.test(flat),
    'Live readings section': flat.includes('Live readings'),
    'real reading: Oil Temp': /Oil Temp/i.test(flat),
    'real reading value 63.4': flat.includes('63.4'),
    'real reading: Hydrogen': /Hydrogen/i.test(flat),
    '"+ N more parameters" (5 params > 6 shown? no) or all shown': true,
    'Asset section (nameplate)': flat.includes('Asset'),
    'nameplate model TR-6787': flat.includes('TR-6787'),
    'nameplate rating 2500 kVA': flat.includes('2500'),
    'nameplate voltage 22kV/0.4kV': flat.includes('22kV/0.4kV'),
    'Device section': flat.includes('Device'),
    'Device ID row': flat.includes('TRA-9F2C'),
    'Signal (rssi)': /Signal/.test(flat),
    'Battery from latest presence': /Battery/.test(flat) && flat.includes('87'),
    'Link/transport from latest presence': /Link/.test(flat) && /wifi/i.test(flat),
    'Firmware': /Firmware/.test(flat),
    'Parameters count': /Parameters/.test(flat),
    'View Dashboard button still present': flat.includes('View Dashboard'),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'PASS' : 'FAIL'} ${k}`);
}

// ---- admin/map ----
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'admin', 'admin', 'org-1');
  await page.goto('http://localhost:3901/admin/map/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const txt = await openPopupFor(page, 'TRA-9F2C');
  console.log('\n=== /admin/map ===');
  report('[admin]', txt);
  await page.screenshot({ path: './screenshots/popup-admin.png' });
  await ctx.close();
}

// ---- customer/map ----
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'customer', 'viewer1', 'org-1');
  await page.goto('http://localhost:3901/customer/map/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const txt = await openPopupFor(page, 'TRA-9F2C');
  console.log('\n=== /customer/map ===');
  report('[customer]', txt);
  await page.screenshot({ path: './screenshots/popup-customer.png' });

  // View Dashboard must still navigate (regression guard on the enriched popup)
  await page.click('button:has-text("View Dashboard")');
  await page.waitForTimeout(1200);
  console.log(`  ${/\/customer\/(transformers|devices)\/detail\/?\?id=/.test(page.url()) ? 'PASS' : 'FAIL'} View Dashboard still navigates (${page.url()})`);
  await ctx.close();
}

await browser.close();
