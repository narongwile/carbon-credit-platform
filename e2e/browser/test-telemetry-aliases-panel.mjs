// Proves the admin/live-raw "Wire Key Reference" panel actually surfaces the
// raw-wire-key -> canonical-key alias table a firmware developer needs — see
// the header comment in admin/live-raw/page.tsx for why this exists: the raw
// key is discarded at ingest for an approved device, so this panel (backed by
// GET /api/telemetry/aliases, generated from the SAME table normalizeFunc
// uses) is the only way left to answer "which of my ESP's own field names is
// this".
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-telemetry-aliases-panel.mjs
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
await page.goto('http://localhost:3901/admin/live-raw', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2000);

const toggle = page.locator('button:has-text("Wire Key Reference")').first();
t('the Wire Key Reference toggle is on the page', await toggle.count() > 0);

// --- closed by default: no panel content until opened -----------------------
t('the panel is closed by default', await page.locator('text=Search either column...').count() === 0);

await toggle.click();
await page.waitForTimeout(1200);

t('opening the toggle reveals the search box', await page.locator('input[placeholder="Search either column..."]').count() > 0);

// --- real data from the mock endpoint, grouped by canonical key -------------
// Scoped to the panel's own table, not the whole page — the device cards
// further down also render several of these same words as live values
// (e.g. a raw 'hydrogen' key), which would let this pass even if the panel
// itself rendered nothing.
const panelTableEl = page.locator('table').first();
t('the panel table is present', await panelTableEl.count() > 0);
const rowText = await panelTableEl.evaluate((el) => el.innerText);
t('oilTemp row is present with its raw aliases', /oilTemp/.test(rowText) && /oil_temp_c/.test(rowText) && /Oiltemp/.test(rowText),
  rowText.includes('oilTemp') ? 'oilTemp found' : 'oilTemp missing');
t('ambientTemp row shows Tamb as one of its aliases', /ambientTemp/.test(rowText) && /Tamb/.test(rowText));
t('hydrogen row shows H2 as one of its aliases', /hydrogen/.test(rowText) && /\bH2\b/.test(rowText));

// --- non-vacuity: search actually filters, doesn't just always show everything
// Scoped to the panel's own table — the device cards further down the page
// also render a raw "hydrogen" value key, which would false-positive a
// whole-page text check regardless of whether the panel's filter works.
const search = page.locator('input[placeholder="Search either column..."]');
await search.fill('Tamb');
await page.waitForTimeout(500);
const filteredText = await panelTableEl.evaluate((el) => el.innerText);
t('searching "Tamb" narrows to the ambientTemp row', /ambientTemp/.test(filteredText) && !/hydrogen/.test(filteredText),
  filteredText.includes('hydrogen') ? 'hydrogen still shown — search did not filter' : 'filtered correctly');

await search.fill('');
await page.waitForTimeout(500);

// --- collapse works too ------------------------------------------------------
await toggle.click();
await page.waitForTimeout(500);
t('closing the toggle hides the panel again', await page.locator('input[placeholder="Search either column..."]').count() === 0);

await page.screenshot({ path: './screenshots/telemetry-aliases-panel.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
