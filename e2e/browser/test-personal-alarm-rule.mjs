import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

// Proves the customer-facing half of "personal alarm thresholds": a
// customer/viewer can see and edit their OWN threshold section on the
// transformer dashboard (not gated admin-only like the shared device rule
// below it), it round-trips through GET/PUT /api/nodes/:id/personal-rule
// (NOT /api/nodes/:id/rule — the shared, admin-only rule), and an admin sees
// both sections while a customer sees only their own.

const NODE_ID = 'TRA-9F2C';
let pass = 0, fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); ok ? pass++ : fail++; };

async function openAsRole(role) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 300)}`));

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((r) => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: r, email: r, role: r, orgId: 'org-1', name: r }));
  }, role);
  const path = role === 'admin' ? `/admin/transformers/detail?id=${NODE_ID}` : `/customer/transformers/detail?id=${NODE_ID}`;
  await page.goto(`http://localhost:3901${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  return { browser, page };
}

console.log('####### Scenario A: customer sees their own section, not the admin one #######');
{
  const { browser, page } = await openAsRole('customer');
  const bodyText = await page.textContent('body');

  check('"My Alert Settings" panel present', bodyText.includes('My Alert Settings'));
  check('"2. My Personal Alarm Thresholds" section present for a customer', bodyText.includes('My Personal Alarm Thresholds'));
  check('admin-only "Device-Wide Alarm Thresholds & Rule Engine (Admin)" section ABSENT for a customer', !bodyText.includes('Device-Wide Alarm Thresholds & Rule Engine'));

  // Expand the personal-threshold accordion and edit one row.
  await page.locator('button', { hasText: 'My Personal Alarm Thresholds' }).click();
  await page.waitForTimeout(500);

  const row = page.locator('tr, div').filter({ hasText: 'Top Oil Temperature' }).first();
  const warnInput = row.locator('input[type="number"]').first();
  const before = await warnInput.inputValue().catch(() => null);
  check('found an editable threshold input inside the personal section', before !== null);

  if (before !== null) {
    const edited = String(Number(before) + 3);
    await warnInput.fill(edited);
    await page.locator('button', { hasText: 'Save My Personal Alarm Thresholds' }).click();
    await page.waitForTimeout(500);

    // The shared rule endpoint must be untouched — a personal save must never
    // write alarm_rules. GET returns 404 (mock's "no rule" convention) when
    // nothing has ever been saved there.
    const sharedRes = await page.evaluate((id) => fetch(`http://localhost:4001/api/nodes/${id}/rule`).then((r) => r.status), NODE_ID);
    check('shared /rule endpoint still has NO rule (404) — the personal save did not touch it', sharedRes === 404);

    const personalRes = await page.evaluate((id) => fetch(`http://localhost:4001/api/nodes/${id}/personal-rule`).then((r) => r.json()), NODE_ID);
    const savedWarn = personalRes?.rule?.params?.find((p) => p.key === 'oilTemp')?.warn;
    check(`personal-rule endpoint stored the edited value (${edited})`, String(savedWarn) === edited);

    // Reload and confirm it round-trips into the UI, not just the mock's store.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.locator('button', { hasText: 'My Personal Alarm Thresholds' }).click();
    await page.waitForTimeout(500);
    const row2 = page.locator('tr, div').filter({ hasText: 'Top Oil Temperature' }).first();
    const after = await row2.locator('input[type="number"]').first().inputValue().catch(() => null);
    check(`after reload, the personal editor shows the persisted value (${edited}), not the factory default`, after === edited);
  }

  await page.screenshot({ path: './screenshots/personal-alarm-rule-customer.png', fullPage: false }).catch(() => {});
  await browser.close();
}

console.log('\n####### Scenario B: admin sees BOTH sections on the same device #######');
{
  const { browser, page } = await openAsRole('admin');
  const bodyText = await page.textContent('body');
  check('"My Personal Alarm Thresholds" section present for admin too', bodyText.includes('My Personal Alarm Thresholds'));
  check('admin-only "Device-Wide Alarm Thresholds & Rule Engine (Admin)" section present for admin', bodyText.includes('Device-Wide Alarm Thresholds & Rule Engine'));
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
