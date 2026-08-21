import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

console.log('####### Scenario C: SUPERADMIN (no orgId of their own) must not be blocked by the orgReady gate #######');
{
  const page = await browser.newPage();
  const seen = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/orgs/') || u.includes('/api/fleet') || u.includes('/api/nodes/pending')) seen.push(u.replace('http://localhost:4001', ''));
  });

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('carbon-credit-platform-store', JSON.stringify({
      state: { selectedOrgId: 'org-1', isLiveMode: true, realtimeEnabled: true, viewerUserId: 'u-cc' },
      version: 0,
    }));
    localStorage.setItem('oneops_token', 'faketoken');
    // A superadmin has NO orgId — the gate must still let their fetches run,
    // using whichever org they've selected in the switcher (org-1 here).
    localStorage.setItem('eternity_user', JSON.stringify({
      id: 'u1', username: 'superadmin', role: 'superadmin', name: 'superadmin', email: 'superadmin',
    }));
  });

  await page.goto('http://localhost:3901/admin/transformers/detail/?id=tr-222', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const unique = [...new Set(seen)];
  console.log('org-scoped requests made:', JSON.stringify(unique, null, 2));
  console.log('PASS superadmin fetches still fire (gate did not deadlock them):', unique.length > 0);
  console.log('PASS superadmin uses their selected org (org-1 is correct HERE — it is the switcher value, not a stale leak):', unique.some((u) => u.includes('org-1')));

  await page.close();
}

await browser.close();
