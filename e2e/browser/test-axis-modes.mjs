import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// Build a chart mixing two very different scales (the reported problem).
await page.click('button:has-text("Add chart")');
await page.waitForTimeout(500);
await page.fill('input[placeholder="e.g. Oil health"]', 'Scale Mix');
for (const label of ['Oil Temp', 'Hydrogen', 'Moisture']) {
  await page.locator(`label:has(input[type="checkbox"]):has-text("${label}")`).first().click();
}
await page.waitForTimeout(300);
await page.click('button:has-text("Create chart")');
await page.waitForTimeout(1500);

const body = await page.textContent('body');
console.log('chart created:', body.includes('Scale Mix'));

// Scope to the custom chart's own card — the page also renders the two legacy
// fixed TrendCharts above, whose axes/lines would otherwise be counted too.
const card = page.locator('div.rounded-xl.p-3').filter({ hasText: 'Scale Mix' });
const countAxes = async () => await card.locator('.recharts-yAxis').count();
const countLines = async () => await card.locator('.recharts-line').count();

// --- default mode should be Dual axis ---
console.log('\n=== mode buttons present ===');
for (const m of ['Dual axis', 'Same axis', 'Normalize %']) {
  console.log(`  ${(await page.locator(`button:has-text("${m}")`).count()) > 0 ? 'PASS' : 'FAIL'} "${m}" button`);
}

console.log('\n=== DUAL AXIS (default) ===');
await page.waitForTimeout(500);
let axes = await countAxes();
console.log(`  Y axes rendered: ${axes}`);
console.log(`  ${axes === 2 ? 'PASS' : 'FAIL'} two Y axes (mixed units -> left + right)`);
console.log(`  lines: ${await countLines()}`);

console.log('\n=== SAME AXIS ===');
await card.locator('button:has-text("Same axis")').click();
await page.waitForTimeout(800);
axes = await countAxes();
console.log(`  Y axes rendered: ${axes}`);
console.log(`  ${axes === 1 ? 'PASS' : 'FAIL'} single Y axis`);

console.log('\n=== NORMALIZE % ===');
await card.locator('button:has-text("Normalize %")').click();
await page.waitForTimeout(800);
axes = await countAxes();
const afterNorm = await page.textContent('body');
const ticks = await card.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
console.log(`  Y axes rendered: ${axes}`);
console.log(`  y-axis ticks: ${JSON.stringify(ticks)}`);
console.log(`  ${axes === 1 ? 'PASS' : 'FAIL'} single 0-100% axis`);
console.log(`  ${ticks.some((t) => t.includes('%')) ? 'PASS' : 'FAIL'} axis ticks are percentages`);
console.log(`  ${ticks.includes('0%') && ticks.includes('100%') ? 'PASS' : 'FAIL'} axis spans 0%..100%`);
console.log(`  ${afterNorm.includes('scaled to 0–100% of its own range') ? 'PASS' : 'FAIL'} explanatory note shown`);
console.log(`  ${(await countLines()) === 3 ? 'PASS' : 'FAIL'} all 3 series still drawn`);

await page.screenshot({ path: './screenshots/axis-normalize.png', fullPage: false });

// back to dual for the screenshot comparison
await card.locator('button:has-text("Dual axis")').click();
await page.waitForTimeout(800);
await page.screenshot({ path: './screenshots/axis-dual.png', fullPage: false });

// cleanup
await page.click('button[title="Edit this chart"]');
await page.waitForTimeout(400);
await page.click('button:has-text("Delete")');
await page.waitForTimeout(200);
await page.click('button:has-text("Confirm")');
await page.waitForTimeout(600);

await browser.close();
