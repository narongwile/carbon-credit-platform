import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const SCRATCH = './screenshots';

// Real alarm rule so threshold lines/labels are in play at narrow widths too.
await fetch('http://localhost:4001/api/nodes/TRA-9F2C/rule', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rule: { domain: 'transformer', dwellMin: 5, hysteresis: 2, params: [
    { key: 'oilTemp', label: 'Oil Temp', unit: '°C', direction: 'high', warn: 64, critical: 69 },
    { key: 'hydrogen', label: 'Hydrogen', unit: 'ppm', direction: 'high', warn: 7, critical: 8.5 },
  ] } }),
});

// Real device profiles, not arbitrary numbers: the two ends of the phone range
// that actually matter — a small Android and a current iPhone.
const DEVICES = [
  { name: 'Android small', width: 360, height: 640, dpr: 3, mobile: true },
  { name: 'iPhone 14 Pro', width: 393, height: 852, dpr: 3, mobile: true },
];

let created = false;

for (const dev of DEVICES) {
  console.log(`\n########## ${dev.name} (${dev.width}x${dev.height}) ##########`);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr,
    isMobile: dev.mobile,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
  });
  await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // Below lg the page is tabbed (mobile tab switcher, merged from GitLab) and
  // Custom Charts lives under "Charts" — not a bug, just where it is on a
  // phone. Everything below is measured with that tab active, i.e. the state
  // a real mobile user is actually in when they look at these charts.
  const chartsTab = page.locator('button:has-text("Charts")').first();
  console.log(`  ${(await chartsTab.count()) > 0 ? 'PASS' : 'FAIL'} mobile tab switcher present`);
  await chartsTab.click();
  await page.waitForTimeout(1200);

  if (!created) {
    // Build the mixed-scale chart once; it persists in the mock's memory.
    await page.click('button:has-text("Add chart")');
    await page.waitForTimeout(600);
    await page.fill('input[placeholder="e.g. Oil health"]', 'Scale Mix');
    for (const label of ['Oil Temp', 'Hydrogen', 'Moisture']) {
      await page.locator(`label:has(input[type="checkbox"]):has-text("${label}")`).first().click();
    }
    await page.waitForTimeout(300);
    await page.click('button:has-text("Create chart")');
    await page.waitForTimeout(1800);
    created = true;
  }

  /** The single most important mobile bug: anything wider than the screen makes
   * the WHOLE page pan sideways, which on a touch device also fights vertical
   * scrolling. Measured on the real layout, not guessed from the CSS. */
  const pageOverflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log(`  page scrollWidth=${pageOverflow.scrollW} clientWidth=${pageOverflow.clientW}`);
  console.log(`  ${pageOverflow.scrollW <= pageOverflow.clientW + 1 ? 'PASS' : 'FAIL'} card page does not scroll horizontally`);

  // --- inline card chart (the merged iOS w-full min-w-0 fix) ---
  const card = page.locator('div.rounded-xl.p-3').filter({ hasText: 'Scale Mix' }).first();
  const cardSvg = card.locator('svg.recharts-surface').first();
  const svgBox = await cardSvg.boundingBox();
  console.log(`  inline chart svg width=${svgBox ? Math.round(svgBox.width) : 'null'}`);
  console.log(`  ${svgBox && svgBox.width > 100 ? 'PASS' : 'FAIL'} inline card chart actually has width (not collapsed)`);
  console.log(`  ${svgBox && svgBox.x + svgBox.width <= dev.width + 1 ? 'PASS' : 'FAIL'} inline card chart fits inside viewport`);

  // --- open the analysis modal ---
  await card.locator('button[title*="Expand"]').first().click();
  await page.waitForTimeout(1500);
  const modal = page.locator('div[role="dialog"][aria-label*="chart visualize analysis"]');
  console.log(`  ${(await modal.count()) === 1 ? 'PASS' : 'FAIL'} modal opens on mobile`);

  const modalOverflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log(`  with modal open: scrollWidth=${modalOverflow.scrollW} clientWidth=${modalOverflow.clientW}`);
  console.log(`  ${modalOverflow.scrollW <= modalOverflow.clientW + 1 ? 'PASS' : 'FAIL'} modal does not cause page-level horizontal scroll`);

  // Every descendant that pokes past the right edge of the screen — this is
  // what actually names the culprit instead of just saying "something overflows".
  const offenders = await page.evaluate((vw) => {
    const dlg = document.querySelector('div[role="dialog"][aria-label*="chart visualize analysis"]');
    if (!dlg) return [];
    // Content that is WIDER than the screen but lives inside its own
    // horizontal scroll container is correct, not a bug — that is exactly how
    // a wide table is supposed to be handled. Only unscrollable overflow,
    // which clips content or pans the whole page, counts as a failure.
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== dlg.parentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const out = [];
    for (const el of dlg.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (inScroller(el)) continue;
      if (r.right > vw + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    }
    // Only the outermost offenders — children inherit their parent's overflow.
    return out.filter((o, i) => !out.slice(0, i).some((p) => p.right >= o.right && p.width >= o.width)).slice(0, 8);
  }, dev.width);
  console.log(`  elements overflowing viewport right edge: ${offenders.length}`);
  for (const o of offenders) console.log(`     <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width} "${o.text}"`);
  console.log(`  ${offenders.length === 0 ? 'PASS' : 'FAIL'} no modal element overflows the screen`);

  // The modal chart itself must have real width, same collapse risk as the card.
  const modalSvg = modal.locator('svg.recharts-surface').first();
  const mBox = await modalSvg.boundingBox();
  console.log(`  modal chart svg width=${mBox ? Math.round(mBox.width) : 'null'}`);
  console.log(`  ${mBox && mBox.width > 100 ? 'PASS' : 'FAIL'} modal chart has real width`);

  // Controls must stay reachable — a 44px touch target is the Apple HIG floor,
  // but these are deliberately compact chips, so assert they're at least
  // tappable (>=24px) AND fully on-screen rather than clipped.
  for (const [label, sel] of [['Close', 'button[aria-label="Close"]'], ['CSV', 'button:has-text("CSV")'], ['Edit chart', 'button:has-text("Edit chart")']]) {
    const b = modal.locator(sel).first();
    if (!(await b.count())) { console.log(`  SKIP ${label} not present`); continue; }
    const bb = await b.boundingBox();
    const ok = bb && bb.x >= -1 && bb.x + bb.width <= dev.width + 1 && bb.height >= 24;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} "${label}" on-screen & tappable (x=${bb ? Math.round(bb.x) : '?'} w=${bb ? Math.round(bb.width) : '?'} h=${bb ? Math.round(bb.height) : '?'})`);
  }

  // The stats table is the widest fixed content in the modal (5 columns) —
  // it must either fit or scroll INSIDE its own container, never push the page.
  const tableInfo = await page.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label*="chart visualize analysis"]');
    const t = dlg?.querySelector('table');
    if (!t) return null;
    const wrap = t.parentElement;
    return {
      tableW: Math.round(t.getBoundingClientRect().width),
      tableScrollW: t.scrollWidth,
      wrapW: Math.round(wrap.getBoundingClientRect().width),
      wrapClientW: wrap.clientWidth,
      wrapScrollW: wrap.scrollWidth,
      wrapOverflowX: getComputedStyle(wrap).overflowX,
    };
  });
  if (tableInfo) {
    console.log(`  stats table: tableW=${tableInfo.tableW} wrapW=${tableInfo.wrapW} wrapScrollW=${tableInfo.wrapScrollW} overflowX=${tableInfo.wrapOverflowX}`);
    const contained = tableInfo.wrapScrollW <= tableInfo.wrapClientW + 1 || tableInfo.wrapOverflowX === 'auto' || tableInfo.wrapOverflowX === 'scroll';
    console.log(`  ${contained ? 'PASS' : 'FAIL'} stats table fits or scrolls within its own container`);
  }

  // How much of the first screen the controls eat before the chart appears —
  // "no overflow" is necessary but not sufficient; a chart pushed entirely
  // below the fold is still a bad mobile screen.
  const chartTop = await page.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label*="chart visualize analysis"]');
    const svg = dlg?.querySelector('svg.recharts-surface');
    return svg ? Math.round(svg.getBoundingClientRect().top) : null;
  });
  console.log(`  chart top edge at y=${chartTop} (viewport height ${dev.height})`);
  console.log(`  ${chartTop !== null && chartTop < dev.height * 0.75 ? 'PASS' : 'FAIL'} chart starts within the first screen`);

  // The collapsed date picker must still be reachable on a phone.
  const rangeToggle = modal.locator('button:has-text("Pick dates"), button:has-text("Custom range")').first();
  if (await rangeToggle.count()) {
    await rangeToggle.click();
    await page.waitForTimeout(400);
    const inputs = await modal.locator('input[type="datetime-local"]').count();
    const visible = await modal.locator('input[type="datetime-local"]').first().isVisible();
    console.log(`  ${inputs === 2 && visible ? 'PASS' : 'FAIL'} date inputs expand on demand (${inputs} inputs, visible=${visible})`);
    const afterExpand = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    console.log(`  ${afterExpand.s <= afterExpand.c + 1 ? 'PASS' : 'FAIL'} expanded date inputs do not overflow (${afterExpand.s} vs ${afterExpand.c})`);
    await rangeToggle.click();
    await page.waitForTimeout(300);
  } else {
    console.log('  FAIL date range toggle not found on mobile');
  }

  await page.screenshot({ path: `${SCRATCH}/mobile-${dev.width}-modal.png`, fullPage: false });
  await browser.close();
}

console.log('\nDone.');
