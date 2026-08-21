import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 250)}`));

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/notifications', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

const bodyText = await page.textContent('body');
console.log(`${bodyText.includes('Phase A-N Voltage — Over-voltage') ? 'PASS' : 'FAIL'} Over-voltage row present`);
console.log(`${bodyText.includes('Phase A-N Voltage — Under-voltage') ? 'PASS' : 'FAIL'} Under-voltage row present (same key, opposite band)`);
console.log(`${bodyText.includes('Phase A-N Voltage Unbalance') ? 'PASS' : 'FAIL'} Voltage Unbalance row present`);

// Find the two VoltAN rows and their warn inputs independently.
const overRow = page.locator('tr').filter({ hasText: 'Phase A-N Voltage — Over-voltage' });
const underRow = page.locator('tr').filter({ hasText: 'Phase A-N Voltage — Under-voltage' });
console.log(`${(await overRow.count()) === 1 ? 'PASS' : 'FAIL'} exactly one over-voltage row (not merged/duplicated)`);
console.log(`${(await underRow.count()) === 1 ? 'PASS' : 'FAIL'} exactly one under-voltage row (not merged/duplicated)`);

const overWarnInput = overRow.locator('input[type="number"]').first();
const underWarnInput = underRow.locator('input[type="number"]').first();
const overWarnBefore = await overWarnInput.inputValue();
const underWarnBefore = await underWarnInput.inputValue();
console.log(`  over-voltage warn (seed) = ${overWarnBefore}, under-voltage warn (seed) = ${underWarnBefore}`);
console.log(`${overWarnBefore !== underWarnBefore ? 'PASS' : 'FAIL'} the two bands seed with DIFFERENT warn values (241.5 vs 218.5), not sharing one edit-state slot`);

// Edit ONLY the over-voltage warn field — the under-voltage field must not move.
await overWarnInput.fill('245');
await page.waitForTimeout(200);
const underWarnAfter = await underWarnInput.inputValue();
console.log(`  after editing over-voltage warn to 245: under-voltage warn is now ${underWarnAfter}`);
console.log(`${underWarnAfter === underWarnBefore ? 'PASS' : 'FAIL'} editing the over-voltage band did NOT bleed into the under-voltage band`);

// Confirm the checkboxes (enabled toggles) are also independent.
const overCheckbox = overRow.locator('input[type="checkbox"]');
const underCheckbox = underRow.locator('input[type="checkbox"]');
const underCheckedBefore = await underCheckbox.isChecked();
await overCheckbox.click();
await page.waitForTimeout(150);
const underCheckedAfter = await underCheckbox.isChecked();
console.log(`${underCheckedBefore === underCheckedAfter ? 'PASS' : 'FAIL'} toggling over-voltage's enabled checkbox did not flip under-voltage's`);

await page.screenshot({ path: './screenshots/dual-band-voltage.png', fullPage: false });
await browser.close();
