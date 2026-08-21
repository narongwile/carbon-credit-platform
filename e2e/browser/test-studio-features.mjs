// Regression guard for the four VISUALIZER & ANALYSIS STUDIO capabilities that
// were silently dropped when a merge conflict in ChartAnalysisModal.tsx was
// resolved in favour of the more-correct-but-less-featured implementation:
// the raw-samples table view, the thresholds on/off toggle, the refresh
// button, and the brush. Plus the Δ Span stat and the footer timestamp.
//
// Run from e2e/browser/ with mock-backend.mjs on :4001 and next dev on :3901.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

// Build a chart with a saved alarm rule so the Thresholds toggle has something
// to act on (the button only renders when a plotted param has a saved rule).
await fetch('http://localhost:4001/api/nodes/TRA-9F2C/rule', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rule: { domain: 'transformer', dwellMin: 5, hysteresis: 2, params: [
    { key: 'oilTemp', label: 'Oil Temp', unit: '°C', direction: 'high', warn: 64, critical: 69 },
  ] } }),
});

await page.click('button:has-text("Add chart")');
await page.waitForTimeout(500);
await page.fill('input[placeholder="e.g. Oil health"]', 'Studio Check');
for (const label of ['Oil Temp', 'Hydrogen']) {
  await page.locator(`label:has(input[type="checkbox"]):has-text("${label}")`).first().click();
}
await page.waitForTimeout(300);
await page.click('button:has-text("Create chart")');
await page.waitForTimeout(1800);

const card = page.locator('div.rounded-xl.p-3').filter({ hasText: 'Studio Check' }).first();
await card.locator('button[title*="Expand"]').first().click();
await page.waitForTimeout(1500);
const modal = page.locator('div[role="dialog"][aria-label*="chart visualize analysis"]');
t('modal opened', (await modal.count()) === 1);

// --- 1. Brush (sub-range zoom without refetching) ---
t('brush rendered under the chart', (await modal.locator('.recharts-brush').count()) === 1);

// --- 2. Chart / table view toggle ---
const tableBtn = modal.locator('button[title="Raw telemetry samples"]');
const chartBtn = modal.locator('button[title="Chart view"]');
t('chart/table view toggle present', (await tableBtn.count()) === 1 && (await chartBtn.count()) === 1);
await tableBtn.click();
await page.waitForTimeout(600);
const tableText = await modal.textContent();
t('table view lists recorded samples with a row count',
  /Recorded telemetry samples \(\d+ rows?\)/.test(tableText), (tableText.match(/Recorded telemetry samples \([^)]*\)/) || [''])[0]);
const dataRows = await modal.locator('tbody tr').count();
t('table renders real sample rows', dataRows > 5, `rows=${dataRows}`);
t('table view has its own Download CSV', (await modal.locator('button:has-text("Download CSV")').count()) === 1);
// The chart must be gone while the table is showing — not both stacked.
t('chart is replaced, not duplicated, in table view', (await modal.locator('.recharts-surface').count()) === 0);
await chartBtn.click();
await page.waitForTimeout(600);
t('switching back restores the chart', (await modal.locator('.recharts-surface').count()) >= 1);

// --- 3. Thresholds on/off ---
const threshBtn = modal.locator('button:has-text("Thresholds")');
t('thresholds toggle present', (await threshBtn.count()) === 1);
const refLinesOn = await modal.locator('.recharts-reference-line').count();
await threshBtn.click();
await page.waitForTimeout(600);
const refLinesOff = await modal.locator('.recharts-reference-line').count();
t('toggling thresholds off removes the reference lines', refLinesOn > 0 && refLinesOff === 0, `on=${refLinesOn} off=${refLinesOff}`);
await threshBtn.click();
await page.waitForTimeout(600);
t('toggling back restores them', (await modal.locator('.recharts-reference-line').count()) === refLinesOn);

// --- 4. Refresh (refetch the SAME window) ---
const refreshBtn = modal.locator('button[aria-label="Refresh"]');
t('refresh button present', (await refreshBtn.count()) === 1);
const footerBefore = await modal.locator('text=/Last updated/').first().textContent();
await page.waitForTimeout(1100); // let the clock tick so the timestamp can differ
await refreshBtn.click();
await page.waitForTimeout(1200);
const footerAfter = await modal.locator('text=/Last updated/').first().textContent();
t('refresh re-reads the window and updates "Last updated"',
  !!footerBefore && !!footerAfter && footerBefore !== footerAfter, `${footerBefore} -> ${footerAfter}`);

// --- 5. Δ Span stat + footer ---
const finalText = await modal.textContent();
t('Δ Span column present in the stats table', finalText.includes('Δ Span'));
t('footer reports how the data was reduced', /buckets, averaged per bucket/.test(finalText));
t('Close analysis button present', (await modal.locator('button:has-text("Close analysis")').count()) === 1);

// --- and the correctness features must NOT have regressed ---
t('correlation panel still present', finalText.includes('How these parameters moved together'));
t('min-max band still drawn', (await modal.locator('.recharts-area').count()) >= 2);
t('In alarm column still present', finalText.includes('In alarm'));

await page.screenshot({ path: './screenshots/studio-features.png', fullPage: false });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
