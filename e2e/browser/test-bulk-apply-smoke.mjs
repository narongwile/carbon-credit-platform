import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

// Lightweight smoke check for the admin department/user bulk-apply UI added
// to admin/notifications — not a full fixture-backed round-trip test (this
// mock has no /api/orgs/:orgId/departments or /rule/department endpoint, and
// no department-scoped fleet fixture yet), just proof the new scope picker
// renders and switches without throwing, on top of the tsc/lint/build
// coverage the change already has.

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
let pageErrors = 0;
page.on('pageerror', (e) => { pageErrors++; console.log(`  [pageerror] ${String(e).slice(0, 300)}`); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/notifications', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2000);

let pass = 0, fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); ok ? pass++ : fail++; };

// Baseline, not zero: admin/notifications already throws a pre-existing
// "Text content does not match server-rendered HTML" hydration warning on
// every load, confirmed present with or without this change (checked by
// temporarily stashing this diff and rerunning) — a real, separate bug this
// feature did not introduce and is not the scope of fixing here. What THIS
// test needs to prove is that switching the new scope picker doesn't throw
// anything ADDITIONAL, so it compares against the baseline count instead of
// asserting zero.
const baselineErrors = pageErrors;

const bodyText = await page.textContent('body');
check('"Apply baseline to" scope picker present', bodyText.includes('Apply baseline to'));

await page.locator('button', { hasText: 'One department' }).click();
await page.waitForTimeout(300);
check('department select appears after choosing "One department"', await page.locator('select').count() > 0);

await page.locator('button', { hasText: 'One user' }).click();
await page.waitForTimeout(300);
const bodyText2 = await page.textContent('body');
check('button label switches to a scoped "Apply Baseline to …" wording, not the org-wide one', bodyText2.includes("Apply Baseline to") && bodyText2.includes("'s Department Devices"));

await page.locator('button', { hasText: 'Whole organization' }).click();
await page.waitForTimeout(300);
const bodyText3 = await page.textContent('body');
check('switching back to "Whole organization" restores the org-wide button wording', bodyText3.includes('Apply Baseline to All') && bodyText3.includes('(Org-Wide)'));
check('no NEW uncaught error from switching scope (beyond the known pre-existing hydration warning)', pageErrors === baselineErrors);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
