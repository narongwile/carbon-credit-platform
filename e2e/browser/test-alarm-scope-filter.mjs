// Proves the per-device alarm editor lists the parameters THAT device reports,
// not the whole product catalog.
//
// READING_PAYLOAD_CATALOG.transformer is a menu for every transformer this
// platform supports — 80 rows. A given unit publishes a fraction of it: the
// fleet's sensor box (tr-222) sends 7 values, so 91% of the editor was
// parameters that device will never report.
//
// That is not merely noise. Every one of those rows can be ticked, given
// thresholds and saved, producing an alarm that looks configured and can never
// fire at any reading — the same trap as the dead-key bugs (overVoltage,
// load, windingTemp) this session already removed from the auto-armed schema.
//
// A row survives the filter if the device reported it OR the saved rule
// already covers it: an alarm you configured has to stay reachable during an
// outage, and after a sensor fails and stops sending the very parameter you
// were watching.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-alarm-scope-filter.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const rowCount = () => page.locator('[data-param-key]').count();
const shownKeys = () => page.evaluate(() =>
  [...new Set([...document.querySelectorAll('[data-param-key]')].map((r) => r.getAttribute('data-param-key')))]);

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);

// The editor lives behind an admin disclosure on the device dashboard.
const disclosure = page.locator('button:has-text("Device-Wide Alarm Thresholds")').first();
t('the admin threshold editor is reachable from the device dashboard', await disclosure.count() > 0);
await disclosure.scrollIntoViewIfNeeded();
await disclosure.click();
await page.waitForTimeout(2500);

t('the scope toggle is offered on a per-device editor', await page.locator('[data-scope-filter]').count() > 0);

const scoped = await rowCount();
const scopedKeys = await shownKeys();
t('the editor opens scoped to this device, not the full catalog', scoped > 0 && scoped < 30,
  `${scoped} rows: ${JSON.stringify(scopedKeys)}`);

// --- non-vacuity: the catalog really is much larger than what is shown ----
// Without this the assertion above would pass on a broken editor showing
// nothing at all.
await page.locator('button:has-text("Full catalog")').first().click();
await page.waitForTimeout(900);
const full = await rowCount();
t('"Full catalog" reveals the whole product menu', full > scoped * 3,
  `${scoped} scoped vs ${full} full — ${Math.round((1 - scoped / full) * 100)}% was noise`);

// --- and back again -------------------------------------------------------
await page.locator("button:has-text(\"This device's sensors\")").first().click();
await page.waitForTimeout(900);
t('switching back re-applies the device scope', await rowCount() === scoped, `${await rowCount()} rows`);

// --- what IS shown must be things the device actually reports -------------
// The mock device's live sample drives this; every key shown should either be
// in that sample or already carry a saved rule.
const liveKeys = await page.evaluate(async () => {
  const r = await fetch('http://localhost:4001/api/fleet/TRA-9F2C/latest').then((x) => x.json()).catch(() => null);
  return r && r.values ? Object.keys(r.values) : [];
});
t('the live sample endpoint returned keys to check against', liveKeys.length > 0, JSON.stringify(liveKeys));
// Every scoped row must be a key the device reported. Anything else would
// mean the catalog is leaking back through the filter.
const unreported = scopedKeys.filter((k) => !liveKeys.includes(k));
t('every scoped row is a key this device actually reports',
  unreported.length === 0,
  unreported.length ? `leaked from the catalog: ${JSON.stringify(unreported)}` : `all ${scopedKeys.length} are reported`);

// And the converse: nothing the device reports may be missing, or an operator
// could not configure an alarm on a sensor that is plainly sending data.
const missing = liveKeys.filter((k) => !scopedKeys.includes(k));
t('no reported key is missing from the scoped list', missing.length === 0,
  missing.length ? `reported but hidden: ${JSON.stringify(missing)}` : '');

await page.screenshot({ path: './screenshots/alarm-scope-filter.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
