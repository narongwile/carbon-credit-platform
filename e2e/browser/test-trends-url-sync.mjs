import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

// admin/trends' "Compare Devices" claims URL deep-linking: read siteId/domain/
// param/devices/range from the URL on load, AND keep the URL in sync as the
// user changes the comparison, so the current view can be bookmarked/shared.
// Only the read half was ever wired up — `useRouter()` was imported and never
// called anywhere in the file, so the address bar never moved.
//
// The straightforward fix (call router.replace() from next/navigation) does
// NOT work in this app: it builds with output:'export' + trailingSlash:true
// (next.config.js), and under that combination the App Router's client-side
// query-string navigation silently drops the search params — confirmed here
// by intercepting the raw history.replaceState calls a real browser makes.
// The real fix uses window.history.replaceState directly. This test asserts
// the OUTCOME (the address bar actually reflects state), not the mechanism,
// so it stays valid if the mechanism changes again later.

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
let pageErrors = 0;
page.on('pageerror', (e) => { pageErrors++; console.log(`  [pageerror] ${String(e).slice(0, 300)}`); });

// Installed before any page script runs, so it catches the very first call —
// a naive post-load patch missed it in earlier debugging of this exact bug.
await page.addInitScript(() => {
  window.__historyCalls = [];
  const orig = history.replaceState.bind(history);
  history.replaceState = function (...args) { window.__historyCalls.push(String(args[2])); return orig(...args); };
});

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/trends/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const calls = await page.evaluate(() => window.__historyCalls);
const lastUrl = calls[calls.length - 1] || '';

check('the URL sync effect actually called the History API at least once', calls.length > 0, `calls=${calls.length}`);
check('the synced URL carries a real query string, not just the bare path', lastUrl.includes('?'), `last=${lastUrl}`);
check('the synced URL names the domain', lastUrl.includes('domain=transformer'), `last=${lastUrl}`);
check('the synced URL names the comparison range', lastUrl.includes('range='), `last=${lastUrl}`);
check('the synced URL lists the auto-selected devices (deep-linkable, not just readable on load)', lastUrl.includes('devices='), `last=${lastUrl}`);
check('the live address bar matches what History API was told (no redirect stripped it)', page.url().endsWith(lastUrl.replace(/^\//, '/')), `bar=${page.url()}`);
check('no uncaught page error (would catch an infinite replaceState loop crashing the tab)', pageErrors === 0);
check('replaceState call count is sane, not runaway (would be huge under an infinite-loop bug)', calls.length < 30, `calls=${calls.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
