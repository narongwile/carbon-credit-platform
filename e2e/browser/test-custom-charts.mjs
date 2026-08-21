import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log('  [console err]', m.text().slice(0, 300)); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const bodyText = await page.textContent('body');
console.log('PASS "Custom Charts" section present:', bodyText.includes('Custom Charts'));
console.log('PASS "Add chart" button present:', bodyText.includes('Add chart'));
console.log('PASS empty-state hint present:', bodyText.includes('combine any parameters'));

// Open the builder
await page.click('button:has-text("Add chart")');
await page.waitForTimeout(400);
let modalText = await page.textContent('body');
console.log('PASS builder modal opened ("New chart"):', modalText.includes('New chart'));

// Title
await page.fill('input[placeholder="e.g. Oil health"]', 'Oil Health Test');

// Select two parameters (oilTemp, load) by their visible labels
const checkboxLabels = await page.locator('label:has(input[type="checkbox"])').allTextContents();
console.log('available parameter labels:', checkboxLabels.slice(0, 10));
async function checkParam(label) {
  const loc = page.locator(`label:has(input[type="checkbox"]):has-text("${label}")`).first();
  await loc.click();
}
await checkParam('Oil Temp');
await checkParam('Hydrogen');
await page.waitForTimeout(300);

modalText = await page.textContent('body');
console.log('PASS threshold panel appeared for selected params:', modalText.includes('Alert & notify thresholds') || modalText.includes('Alert &amp; notify thresholds'));

// Enable + set threshold for the first selected param
const alertCheckboxes = page.locator('label:has-text("alert on this") input[type="checkbox"]');
const alertCount = await alertCheckboxes.count();
console.log('threshold rows found:', alertCount);
if (alertCount > 0) {
  await alertCheckboxes.first().click();
  await page.waitForTimeout(200);
  const warnInput = page.locator('input[placeholder="warn"]').first();
  const critInput = page.locator('input[placeholder="critical"]').first();
  await warnInput.fill('80');
  await critInput.fill('95');
}

// Save
await page.click('button:has-text("Create chart")');
await page.waitForTimeout(800);

let afterSave = await page.textContent('body');
console.log('PASS modal closed after save:', !afterSave.includes('New chart'));
console.log('PASS chart title now visible:', afterSave.includes('Oil Health Test'));

// Confirm a recharts SVG line chart actually rendered (not just empty state)
const chartLines = await page.locator('.recharts-line').count();
console.log('PASS chart rendered with series lines, count:', chartLines);

// Edit: rename
await page.click('button[title="Edit this chart"]');
await page.waitForTimeout(400);
let editModal = await page.textContent('body');
console.log('PASS edit modal opened ("Edit chart"):', editModal.includes('Edit chart'));
console.log('PASS existing title pre-filled:', await page.inputValue('input[placeholder="e.g. Oil health"]') === 'Oil Health Test');

await page.fill('input[placeholder="e.g. Oil health"]', 'Oil Health Renamed');
await page.click('button:has-text("Save changes")');
await page.waitForTimeout(800);
let afterRename = await page.textContent('body');
console.log('PASS renamed chart visible:', afterRename.includes('Oil Health Renamed'));

// Delete
await page.click('button[title="Edit this chart"]');
await page.waitForTimeout(400);
await page.click('button:has-text("Delete")');
await page.waitForTimeout(200);
await page.click('button:has-text("Confirm")');
await page.waitForTimeout(800);
let afterDelete = await page.textContent('body');
console.log('PASS chart removed after delete:', !afterDelete.includes('Oil Health Renamed'));
console.log('PASS empty-state hint back:', afterDelete.includes('combine any parameters'));

await page.screenshot({ path: './screenshots/custom-charts-final.png', fullPage: true });
await browser.close();
