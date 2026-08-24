// Proves DisplayParamPicker's "Who sees this" can target specific people
// (migrate-v52), not just a department — opens the picker from a real
// transformer dashboard, switches to "Limit to specific people", picks two
// users, saves, and asserts the real PUT body the backend received names
// them (userIds), not a departmentId.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-display-params-people.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

const configureBtn = page.locator('button:has-text("Configure")').first();
t('the Configure button is reachable from the device dashboard', await configureBtn.count() > 0);
await configureBtn.click();
await page.waitForTimeout(1500);

t('the Displayed parameters modal opens', await page.locator('text=Displayed parameters').count() > 0);

const peopleToggle = page.locator('button:has-text("Limit to specific people")').first();
t('the "Limit to specific people" toggle is offered', await peopleToggle.count() > 0);
await peopleToggle.click();
await page.waitForTimeout(800);

// --- non-vacuity: the department select must be gone once "people" mode is active
t('switching to "people" mode hides the department dropdown', await page.locator('option:has-text("Everyone in this organization")').count() === 0);

const viewerARow = page.locator('button:has-text("Viewer A")').first();
const viewerBRow = page.locator('button:has-text("Viewer B")').first();
t('active org users are listed (Viewer A)', await viewerARow.count() > 0);
t('active org users are listed (Viewer B)', await viewerBRow.count() > 0);
t('a pending user is excluded from the picker', await page.locator('button:has-text("Viewer Pending")').count() === 0);
// An admin's OWN dashboard bypasses per-person scoping entirely (same
// exemption as department scoping), so naming one here would silently do
// nothing — excluded to avoid that dead end.
t('an admin user is excluded from the picker (targeting them would be a no-op)', await page.locator('button:has-text("Org Admin")').count() === 0);

await viewerARow.click();
await viewerBRow.click();
await page.waitForTimeout(400);

t('the selected-count reflects both picks', (await page.locator('text=2 selected').count()) > 0);
t('the toggle button itself shows the count too', (await peopleToggle.textContent())?.includes('(2)') ?? false);

// --- capture the real PUT the frontend sends ------------------------------
const putPromise = page.waitForRequest((req) => req.url().includes('/display-params') && req.method() === 'PUT');
const saveBtn = page.locator('button:has-text("Save")').first();
await saveBtn.click();
const putReq = await putPromise;
const putBody = JSON.parse(putReq.postData() || '{}');

t('the save targets userIds, not a departmentId', Array.isArray(putBody.userIds) && putBody.userIds.length === 2, JSON.stringify(putBody));
t('departmentId is not sent when targeting specific people', putBody.departmentId === undefined, JSON.stringify(putBody));
t('the two userIds are exactly Viewer A and Viewer B',
  putBody.userIds && putBody.userIds.includes('u-viewer-a') && putBody.userIds.includes('u-viewer-b'), JSON.stringify(putBody.userIds));

await page.waitForTimeout(500);
t('the modal closes after a successful save', await page.locator('text=Displayed parameters').count() === 0);

await page.screenshot({ path: './screenshots/display-params-people.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
