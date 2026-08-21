import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

console.log('####### Scenario A: real LOGIN flow, browser has a stale persisted selectedOrgId=org-1 from an earlier session #######');
{
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log('  [console err]', m.text().slice(0, 150)); });
  const seen = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/orgs/') || u.includes('/api/fleet')) seen.push(u.replace('http://localhost:4001', ''));
  });

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  // Simulate: this browser previously had a session where selectedOrgId got
  // persisted as 'org-1' (e.g. an earlier demo/test in the same browser
  // profile) — zustand's persist middleware will rehydrate this on store
  // creation, independent of whatever login sets afterward.
  await page.evaluate(() => {
    localStorage.setItem('carbon-credit-platform-store', JSON.stringify({
      state: { selectedOrgId: 'org-1', isLiveMode: true, realtimeEnabled: true, viewerUserId: 'u-cc' },
      version: 0,
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Real login as the eternity-admin account (backend: role=admin, orgId=org-eternity)
  await page.fill('input[placeholder="Enter username"]', 'eternity-admin');
  await page.fill('input[placeholder="Enter password"]', 'x');
  await page.click('button:has-text("Sign In")');
  await page.waitForTimeout(1500);

  console.log('URL after login+wait:', page.url());
  console.log('eternity_user session saved:', await page.evaluate(() => localStorage.getItem('eternity_user')));

  const storeAfterLogin = await page.evaluate(() => {
    const raw = localStorage.getItem('carbon-credit-platform-store');
    return raw ? JSON.parse(raw).state : null;
  });
  console.log('selectedOrgId in persisted store AFTER login:', storeAfterLogin?.selectedOrgId);
  console.log('PASS selectedOrgId corrected to org-eternity, not stuck at org-1:', storeAfterLogin?.selectedOrgId === 'org-eternity');

  console.log('org-scoped requests actually made:', JSON.stringify([...new Set(seen)], null, 2));
  const usedOrg1 = seen.some((u) => u.includes('org-1'));
  const usedEternity = seen.some((u) => u.includes('org-eternity'));
  console.log('PASS no request used stale org-1:', !usedOrg1);
  console.log('PASS requests used the real org-eternity:', usedEternity);

  await page.close();
}

await browser.close();
