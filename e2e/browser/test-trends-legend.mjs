import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log('  [err]', m.text().slice(0, 200)); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/trends/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const body = await page.textContent('body');
console.log('PASS page loaded (Compare Devices heading):', body.includes('Compare Devices'));

const lineCount = async () => await page.locator('.recharts-line-curve').count();
const legendBtns = () => page.locator('[role="group"][aria-label*="hide"] button');

await page.waitForTimeout(1000);
const initialLines = await lineCount();
console.log(`initial lines drawn: ${initialLines}`);
console.log('PASS at least 2 lines rendered (3 devices preselected):', initialLines >= 2);

const btnCount = await legendBtns().count();
console.log('PASS custom interactive legend rendered:', btnCount >= 2);

// --- hover to isolate ---
const firstBtn = legendBtns().first();
const firstLabel = await firstBtn.getAttribute('title');
await firstBtn.hover();
await page.waitForTimeout(300);
const opacities = await page.locator('.recharts-line-curve').evaluateAll((els) => els.map((e) => e.getAttribute('stroke-opacity')));
console.log('stroke-opacity values while hovering first legend entry:', opacities);
const hasDimmed = opacities.some((o) => o !== null && parseFloat(o) < 0.5);
const hasFull = opacities.some((o) => o === null || parseFloat(o) >= 0.9);
console.log('PASS hover dims other lines while keeping one full-opacity:', hasDimmed && hasFull);

// move mouse away to clear focus before the click test
await page.mouse.move(50, 50);
await page.waitForTimeout(300);

// --- click to hide ---
await firstBtn.click();
await page.waitForTimeout(500);
const stillSameButtonCount = await legendBtns().count();
console.log('PASS legend keeps all entries after hiding one (does not vanish):', stillSameButtonCount === btnCount);

const opacitiesAfterHide = await page.locator('.recharts-line-curve').evaluateAll((els) => els.map((e) => e.getAttribute('stroke-opacity')));
console.log('stroke-opacity after hiding first device:', opacitiesAfterHide);
console.log('PASS the hidden line has stroke-opacity 0 (invisible, not removed):', opacitiesAfterHide.includes('0'));

const hiddenBtnOpacity = await firstBtn.evaluate((el) => getComputedStyle(el).opacity);
console.log('PASS hidden legend entry visually dimmed:', parseFloat(hiddenBtnOpacity) < 1);
const hiddenBtnStrike = await firstBtn.evaluate((el) => getComputedStyle(el.querySelector('span:last-child')).textDecorationLine);
console.log('PASS hidden legend entry struck through:', hiddenBtnStrike.includes('line-through'));

// --- click the SAME device again (by title, since legend order is stable now) to restore ---
const sameBtn = page.locator(`[role="group"][aria-label*="hide"] button[title*="${firstLabel.split(' —')[0]}"]`).first();
await sameBtn.click();
await page.waitForTimeout(500);
const opacitiesRestored = await page.locator('.recharts-line-curve').evaluateAll((els) => els.map((e) => e.getAttribute('stroke-opacity')));
console.log('stroke-opacity after un-hiding:', opacitiesRestored);
console.log('PASS click again restores the line (no more 0-opacity line):', !opacitiesRestored.includes('0'));

await page.screenshot({ path: './screenshots/trends-final.png', fullPage: true });
await browser.close();
