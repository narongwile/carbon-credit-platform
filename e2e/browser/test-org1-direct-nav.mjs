import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

console.log('####### Scenario B: already-authenticated session, DIRECT navigation to /admin (no login form submit), stale selectedOrgId=org-1 persisted #######');
{
  const page = await browser.newPage();
  const seen = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/orgs/') || u.includes('/api/fleet')) seen.push(u.replace('http://localhost:4001', ''));
  });

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    // A stale selectedOrgId from an earlier session in this same browser...
    localStorage.setItem('carbon-credit-platform-store', JSON.stringify({
      state: { selectedOrgId: 'org-1', isLiveMode: true, realtimeEnabled: true, viewerUserId: 'u-cc' },
      version: 0,
    }));
    // ...and an ALREADY-SAVED session for the real eternity admin (as if
    // they logged in earlier, closed the tab, and are now opening a NEW
    // tab / navigating directly to a URL rather than going through the
    // login form again).
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({
      id: 'u1', username: 'eternity-admin', role: 'admin', orgId: 'org-eternity', name: 'eternity-admin', email: 'eternity-admin',
    }));
  });

  await page.goto('http://localhost:3901/admin/transformers/detail/?id=tr-222', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const storeAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('carbon-credit-platform-store');
    return raw ? JSON.parse(raw).state : null;
  });
  console.log('selectedOrgId after direct navigation:', storeAfter?.selectedOrgId);
  console.log('PASS corrected to org-eternity, not stuck at org-1:', storeAfter?.selectedOrgId === 'org-eternity');
  console.log('org-scoped requests made:', JSON.stringify([...new Set(seen)], null, 2));
  const usedOrg1 = seen.some((u) => u.includes('org-1'));
  console.log('PASS no request used stale org-1:', !usedOrg1);

  await page.close();
}

await browser.close();
