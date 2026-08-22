// Proves the readings picker names the MEASURED QUANTITY, not one of its
// alarm bands — checked on the rendered screen, because that is where the
// wrong name was visible.
//
// One telemetry key can carry two alarm rows differing only in `direction`
// (a phase voltage alarms over AND under; a frequency high AND low). That is
// a property of the alarm rules — the meter reports one number either way.
// schemaLabel() used to resolve such a key with a bare `.find()`, returning
// whichever row was declared first and dragging its band suffix along, so a
// device publishing `Hz` was labelled "Frequency — Over" as though the sensor
// itself were an over-limit condition. It is the shared label resolver behind
// five screens, so the same wrong name appeared in all of them.
//
// e2e/proofs/test-schema-label-bands.mjs covers the resolver directly; this
// covers what an operator actually sees.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-param-label-bands.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

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
t('the readings Configure button is present', await configureBtn.count() > 0);
await configureBtn.click();
await page.waitForTimeout(1800);

const inputs = await page.locator('input[title*="Display name" i]').all();
const names = [];
for (const i of inputs) names.push((await i.inputValue()).trim());
t('the picker rendered its parameter rows', names.length > 0, `${names.length} rows`);

// --- non-vacuity guard --------------------------------------------------
// Every assertion below is about how a DUAL-BAND key is labelled. The mock
// device seeds Hz and VoltAN precisely so those rows exist; without them this
// suite would pass while proving nothing, the trap test-xss-map-popup.mjs
// fell into.
const dualBandPresent = names.some((n) => /^Frequency/.test(n)) && names.some((n) => /^Phase A-N Voltage/.test(n));
t('dual-band keys (Hz, VoltAN) are present to test against', dualBandPresent,
  dualBandPresent ? '' : `NONE — assertions below would be vacuous. names=${JSON.stringify(names)}`);

// --- the regression -----------------------------------------------------
const banded = names.filter((n) => n.includes(' — '));
t('no displayed parameter name carries an alarm-band suffix',
  banded.length === 0, banded.length ? JSON.stringify(banded) : '');

t('Hz is named "Frequency", not "Frequency — Over"', names.includes('Frequency'),
  `got ${JSON.stringify(names.filter((n) => n.startsWith('Frequency')))}`);
t('VoltAN is named "Phase A-N Voltage", not "… — Over-voltage"', names.includes('Phase A-N Voltage'),
  `got ${JSON.stringify(names.filter((n) => n.startsWith('Phase A-N Voltage')))}`);

// --- single-band names must be untouched by the fix ---------------------
t('single-band names still resolve normally (Moisture)', names.includes('Moisture'));
t('a key with no schema entry still shows its raw wire key (extraSensor)', names.includes('extraSensor'));

await page.screenshot({ path: './screenshots/param-label-bands.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
