import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

async function loginAs(page, role, email, orgId) {
  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ role, email, orgId }) => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: email, email, role, orgId, name: email }));
  }, { role, email, orgId });
}

// ============================================================
// FIX #1a: admin Dashboard -> Device Location tab -> View Dashboard click
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'admin', 'admin', 'org-1');
  await page.goto('http://localhost:3901/admin/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Device Location")');
  await page.waitForTimeout(2000);
  console.log('markers on admin dashboard map:', await page.locator('.leaflet-interactive').count());
  const markers = await page.locator('.leaflet-interactive').all();
  let opened = false;
  for (const m of markers) {
    await m.click({ force: true });
    await page.waitForTimeout(400);
    const btn = page.locator('button:has-text("View Dashboard")');
    if (await btn.count() > 0) { await btn.first().click(); opened = true; break; }
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(1000);
  console.log('FIX1a admin Dashboard>Device Location: clicked "View Dashboard":', opened);
  console.log('FIX1a admin Dashboard>Device Location: navigated to a device detail page:', /\/admin\/(transformers|nodes)\/detail\/?\?id=/.test(page.url()));
  await ctx.close();
}

// ============================================================
// FIX #1b: customer Overview -> Device Location tab -> View Dashboard click
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'customer', 'viewer1', 'org-1');
  await page.goto('http://localhost:3901/customer/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Device Location")');
  await page.waitForTimeout(2000);
  const markers = await page.locator('.leaflet-interactive').all();
  let opened = false;
  for (const m of markers) {
    await m.click({ force: true });
    await page.waitForTimeout(400);
    const btn = page.locator('button:has-text("View Dashboard")');
    if (await btn.count() > 0) { await btn.first().click(); opened = true; break; }
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(1000);
  console.log('FIX1b customer Overview>Device Location: clicked "View Dashboard":', opened);
  console.log('FIX1b customer Overview>Device Location: navigated to a customer device detail page:', /\/customer\/(transformers|devices)\/detail\/?\?id=/.test(page.url()));
  await ctx.close();
}

// ============================================================
// FIX #1c: customer/map full page -> View Dashboard click
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'customer', 'viewer1', 'org-1');
  await page.goto('http://localhost:3901/customer/map/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const markers = await page.locator('.leaflet-interactive').all();
  let opened = false;
  for (const m of markers) {
    await m.click({ force: true });
    await page.waitForTimeout(400);
    const btn = page.locator('button:has-text("View Dashboard")');
    if (await btn.count() > 0) { await btn.first().click(); opened = true; break; }
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(1000);
  console.log('FIX1c customer/map: clicked "View Dashboard":', opened);
  console.log('FIX1c customer/map: navigated to a customer device detail page:', /\/customer\/(transformers|devices)\/detail\/?\?id=/.test(page.url()));
  await ctx.close();
}

// ============================================================
// FIX #2: real sensor count on admin Overview tab (TRA-9F2C -> 5 sensors, not fake)
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await loginAs(page, 'admin', 'admin', 'org-1');
  await page.goto('http://localhost:3901/admin/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const body = await page.textContent('body');
  console.log('FIX2: page shows "5 sensors" for TRA-9F2C (real count from mock last_sample-derived sensor_count):', body.includes('5 sensors'));
  await ctx.close();
}

// ============================================================
// FIX #3: geolocation request + manual lat/lng inputs + expand on "Adjust this device's position"
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['geolocation'], geolocation: { latitude: 14.1234, longitude: 101.5678 } });
  const page = await ctx.newPage();
  await loginAs(page, 'admin', 'admin', 'org-1');
  await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.click('button:has-text("Adjust this device")');
  await page.waitForTimeout(500);
  let body = await page.textContent('body');
  console.log('FIX3: editing panel opened:', body.includes('Click or drag the pin'));
  console.log('FIX3: geolocation button present:', body.includes('Use my current location') || body.includes('Locating'));
  console.log('FIX3: manual lat/lng inputs present:', await page.locator('input[placeholder="Lat"]').count() > 0 && await page.locator('input[placeholder="Lng"]').count() > 0);
  console.log('FIX3: expand button present:', body.includes('Expand'));

  // Wait for the auto-fired geolocation request to resolve, then use it
  await page.waitForFunction(() => document.body.innerText.includes('Use my current location'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.click('button:has-text("Use my current location")');
  await page.waitForTimeout(1000);
  body = await page.textContent('body');
  console.log('FIX3: "Device location saved" toast after using GPS position:', body.includes('Device location saved'));

  // Re-open and test the expand button
  await page.click('button:has-text("Adjust this device")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Expand")');
  await page.waitForTimeout(500);
  const modalOpen = await page.locator('[role="dialog"]').count() > 0;
  console.log('FIX3: expanded modal opened:', modalOpen);

  // Test manual lat/lng entry inside the expanded modal
  await page.fill('input[placeholder="Lat"]', '15.5');
  await page.fill('input[placeholder="Lng"]', '102.75');
  await page.click('button[title="Set this exact coordinate"]');
  await page.waitForTimeout(1000);
  body = await page.textContent('body');
  console.log('FIX3: "Device location saved" toast after manual lat/lng entry:', body.includes('Device location saved'));

  await page.screenshot({ path: './screenshots/fix3-final.png' });
  await ctx.close();
}

await browser.close();
