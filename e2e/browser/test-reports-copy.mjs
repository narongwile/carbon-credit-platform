// Verifies the reports page renders only claims the engine can actually back.
//
// The page used to advertise Duval triangle risk, a winding hot-spot
// calculation, an insulation thermal aging factor and IEEE 519 harmonic
// analysis — with IEEE C57.104 / IEC 60076 / HACCP / FDA 21 CFR badges — while
// iiotReportGenerator.ts's own header explicitly disclaims implementing or
// certifying against every one of them. test-report-honesty.mjs greps the
// source; this asserts what a user actually SEES in a real browser, which is
// where the claim was being made.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-reports-copy.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/reports', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

const body = await page.textContent('body');
t('reports page actually rendered', !!body && body.length > 500, `${body?.length ?? 0} chars`);

// --- claims with no implementation behind them ---
for (const [label, needle] of [
  ['Duval triangle', 'duval'],
  ['thermal aging factor', 'aging factor'],
  ['IEEE 519', 'ieee 519'],
  ['IEC 60076', 'iec 60076'],
  ['IEEE C57.104', 'c57.104'],
  ['FDA 21 CFR', '21 cfr'],
]) {
  t(`page does not show "${label}"`, !body.toLowerCase().includes(needle));
}

// --- claims the engine really does back, which must NOT have been over-corrected away ---
t('page still offers the asset health section', /Asset Health/i.test(body));
t('page still offers the MKT cold-chain section', /MKT/.test(body));
t('MKT is still attributed to the USP formula', /USP/i.test(body));
t('page still offers the alarm/MTTR section', /MTTR/i.test(body));
t('page states it is not an accredited audit', /not an accredited compliance audit/i.test(body));

await page.screenshot({ path: './screenshots/reports-copy.png', fullPage: false });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
