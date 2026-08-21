// Drives the real Alarm & Notify editor and asserts each reading sensor gets
// ONE row carrying its engineered limits — not a duplicate phantom row with a
// limit guessed from the key's spelling.
//
// See e2e/proofs/test-alarm-param-discovery.mjs for the mechanism. Short
// version: the catalog is keyed by `key::direction` (a phase carries an over-
// and an under-voltage band on one key), while the two discovery passes after
// it tested BARE keys against that same map — a comparison that can never
// match, so every published parameter was added twice. The phantom copy saved
// into the rule enabled, at warn 80 / critical 100, which on a healthy 225 V
// phase is a permanent CRITICAL.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-alarm-discovery-ui.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/notifications', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const body = await page.textContent('body');
t('alarm config page rendered', !!body && body.length > 500, `${body?.length ?? 0} chars`);

// Count how many times each parameter label appears as an editable row. The
// duplicate is what this test exists to catch, so counting is the assertion.
const counts = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('[data-param-key]')) {
    const k = el.getAttribute('data-param-key');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
});

// --- non-vacuity guard -----------------------------------------------------
// Every assertion below is about how a DISCOVERED key is treated. If the
// device under test publishes nothing outside the catalog there is no such
// key, the interesting paths never execute, and the whole suite would pass
// while proving nothing — the exact trap test-xss-map-popup.mjs fell into.
// Fail loudly instead of passing quietly.
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-param-key]')].map((r) => ({
  key: r.getAttribute('data-param-key'),
  unrationalized: r.getAttribute('data-param-unrationalized') === 'true',
  checked: !!r.querySelector('input[type=checkbox]')?.checked,
})));
const unrat = rows.filter((r) => r.unrationalized);
t('at least one discovered (unrationalized) key is present to test against',
  unrat.length > 0, `${unrat.length} found — without one this suite proves nothing`);

// A guessed limit must never annunciate on its own (ISA-18.2 §6: an alarm
// needs a documented basis before it is allowed to fire).
t('every unrationalized row is left switched OFF',
  unrat.every((r) => !r.checked), unrat.map((r) => `${r.key}=${r.checked ? 'ON' : 'off'}`).join(' '));

// ...while the catalog rows, which do have engineered limits, stay armed.
const armedCatalog = rows.filter((r) => !r.unrationalized && r.checked);
t('catalog rows remain armed (the fix must not disarm real alarms)',
  armedCatalog.length > 0, `${armedCatalog.length} armed`);

if (Object.keys(counts).length === 0) {
  // The editor does not stamp data-param-key; fall back to counting the
  // catalog's own labels in the rendered text, which is still enough to see a
  // duplicate.
  const occurrences = (needle) => body.split(needle).length - 1;
  t('Top Oil Temperature appears once, not duplicated',
    occurrences('Top Oil Temperature') <= 1, `${occurrences('Top Oil Temperature')} occurrence(s)`);
  t('over-voltage and under-voltage bands both present',
    /Over-voltage/i.test(body) && /Under-voltage/i.test(body));
} else {
  for (const [k, n] of Object.entries(counts)) {
    if (k === 'VoltAN' || k === 'VoltBN' || k === 'VoltCN') {
      t(`${k} has exactly its 2 bands`, n === 2, `${n} row(s)`);
    } else {
      t(`${k} has exactly 1 row`, n === 1, `${n} row(s)`);
    }
  }
}

await page.screenshot({ path: './screenshots/alarm-discovery.png' });
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
