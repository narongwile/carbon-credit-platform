// Proves the transformer detail page renders on a fresh load instead of
// crashing with "Rendered more hooks than during the previous render".
//
// TransformerDetailView.tsx called two useMemo hooks (modalParams, available)
// AFTER an `if (!transformer) return (...)` early return. `transformer` comes
// from useLiveTransformer(), which is null while data is still loading — so
// the very first render of every visit to this page took the early-return
// branch and skipped those two hooks, then the next render (data arrived)
// called them. React's Rules of Hooks require the exact same hooks in the
// exact same order on every render; violating it isn't a lint nitpick, it's
// a full-page crash — reproduced live via this script BEFORE the fix landed:
// 17 repeated "Rendered more hooks..." errors and the page stuck on Next.js's
// red error overlay, on every single load.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-transformer-detail-crash.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
// A fresh navigation, not a client-side transition — this is exactly the
// "transformer still null on the very first render" scenario, and a
// client-side <Link> nav from an already-loaded page would not reproduce it.
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const hookErrors = errors.filter((e) => /Rendered (more|fewer) hooks/i.test(e));
t('no "Rendered more/fewer hooks" error on a fresh page load', hookErrors.length === 0,
  hookErrors.length ? `${hookErrors.length} occurrence(s)` : '');

const bodyText = await page.locator('body').innerText();
t('the Next.js error overlay ("Unhandled Runtime Error") is NOT shown', !bodyText.includes('Unhandled Runtime Error'));
t('the real page content rendered (device id visible)', bodyText.includes('TRA-9F2C'));
t('sensor reading cards rendered (Oil Temp)', /Oil Temp/i.test(bodyText));

await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
