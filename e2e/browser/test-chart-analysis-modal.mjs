import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const SCRATCH = './screenshots';

// Seed a real alarm rule on TRA-9F2C so the modal's threshold ReferenceLines
// have something real to render (mock GET /api/nodes/:id/rule 404s with no
// rule saved yet). Values are chosen INSIDE the synthetic reading range the
// mock's syntheticReadings() generates for TRA-9F2C (oilTemp ~54-70, hydrogen
// ~5-9) — a ReferenceLine outside the auto Y-domain is legitimately discarded
// by recharts (same behavior ParamHistoryModal already relies on), so a
// threshold picked far outside the plotted data would never draw and that is
// correct, not a bug to route around.
await fetch('http://localhost:4001/api/nodes/TRA-9F2C/rule', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rule: { domain: 'transformer', dwellMin: 5, hysteresis: 2, params: [
    { key: 'oilTemp', label: 'Oil Temp', unit: '°C', direction: 'high', warn: 64, critical: 69 },
    { key: 'hydrogen', label: 'Hydrogen', unit: 'ppm', direction: 'high', warn: 7, critical: 8.5 },
  ] } }),
});

async function openAsRole(role) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 300)}`));

  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((r) => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({
      id: 'u1', username: r, email: r, role: r, orgId: 'org-1', name: r,
    }));
  }, role);
  const path = role === 'admin' ? '/admin/transformers/detail?id=TRA-9F2C' : '/customer/transformers/detail?id=TRA-9F2C';
  await page.goto(`http://localhost:3901${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  return { browser, page };
}

async function run(role) {
  console.log(`\n########## ROLE: ${role} ##########`);
  const { browser, page } = await openAsRole(role);

  // Build a mixed-scale multi-param chart, same as the axis-mode test, so
  // there is a real chart card with an Expand button to click. Admin builds
  // it; a viewer/customer session cannot (canConfigure gates ChartBuilderModal),
  // so a viewer run instead expects the chart the admin run already created
  // to still be there (charts persist in the mock's in-memory state).
  if (role === 'admin') {
    await page.click('button:has-text("Add chart")');
    await page.waitForTimeout(500);
    await page.fill('input[placeholder="e.g. Oil health"]', 'Scale Mix');
    for (const label of ['Oil Temp', 'Hydrogen', 'Moisture']) {
      await page.locator(`label:has(input[type="checkbox"]):has-text("${label}")`).first().click();
    }
    await page.waitForTimeout(300);
    await page.click('button:has-text("Create chart")');
    await page.waitForTimeout(1500);
  }

  const body1 = await page.textContent('body');
  console.log(`${body1.includes('Scale Mix') ? 'PASS' : 'FAIL'} chart card "Scale Mix" present`);

  const card = page.locator('div.rounded-xl.p-3').filter({ hasText: 'Scale Mix' });
  const expandBtn = card.locator('button[title*="Expand"]');
  console.log(`${(await expandBtn.count()) === 1 ? 'PASS' : 'FAIL'} Expand button present on the card (role=${role})`);

  const editBtn = card.locator('button[title="Edit this chart"]');
  const editCount = await editBtn.count();
  if (role === 'admin') console.log(`${editCount === 1 ? 'PASS' : 'FAIL'} Edit (pencil) button present for admin`);
  else console.log(`${editCount === 0 ? 'PASS' : 'FAIL'} Edit (pencil) button ABSENT for viewer/customer (read-only)`);

  await expandBtn.click();
  await page.waitForTimeout(1200);

  const modal = page.locator('div[role="dialog"][aria-label*="chart visualize analysis"]');
  console.log(`${(await modal.count()) === 1 ? 'PASS' : 'FAIL'} modal opened with aria-label containing "chart visualize analysis"`);

  const modalText = await modal.textContent();
  console.log(`${modalText.includes('Scale Mix') ? 'PASS' : 'FAIL'} modal header shows chart title`);
  console.log(`${modalText.includes('3 parameters') ? 'PASS' : 'FAIL'} modal shows parameter count`);

  // Quick-range buttons (bigger set than the inline card: 1h/6h/24h/7d/30d)
  for (const label of ['1h', '6h', '24h', '7d', '30d']) {
    const has = (await modal.locator(`button:has-text("${label}")`).count()) > 0;
    console.log(`${has ? 'PASS' : 'FAIL'} quick-range "${label}" button present`);
  }

  // Axis mode toggle carried over
  for (const label of ['Dual axis', 'Same axis', 'Normalize %']) {
    const has = (await modal.locator(`button:has-text("${label}")`).count()) > 0;
    console.log(`${has ? 'PASS' : 'FAIL'} axis mode "${label}" button present`);
  }

  await page.waitForTimeout(800);
  let lines = await modal.locator('.recharts-line').count();
  let areas = await modal.locator('.recharts-area').count();
  console.log(`  lines=${lines} areas(min-max band)=${areas}`);
  console.log(`${lines === 3 ? 'PASS' : 'FAIL'} 3 series lines drawn`);
  console.log(`${areas === 3 ? 'PASS' : 'FAIL'} 3 min-max band areas drawn`);

  // Threshold reference lines — oilTemp/hydrogen were seeded directly (in
  // range of the synthetic data), moisture gets a schema-default rule entry
  // from ChartBuilderModal's own "seed a threshold for a newly added schema
  // param" behavior when the chart was created. All 3 series now have a
  // saved rule, so up to 6 lines (3 params * warn+critical) COULD render —
  // but moisture's product-schema critical (35) sits outside its synthetic
  // data range (~17-27), and recharts' own ReferenceLine default
  // (ifOverflow="discard") correctly omits a line that would fall outside
  // the plotted Y-domain rather than drawing something misleading. 5 of 6
  // is the CORRECT outcome here, not a bug — the same discard rule
  // ParamHistoryModal already relies on.
  let refLines = await modal.locator('.recharts-reference-line').count();
  console.log(`  reference lines=${refLines}`);
  console.log(`${refLines === 5 ? 'PASS' : 'FAIL'} 5 of 6 threshold reference lines render (1 correctly discarded as out-of-range)`);
  console.log(`${modalText.includes('warn') && modalText.includes('crit') ? 'PASS' : 'FAIL'} threshold labels rendered`);

  // Stats table
  console.log(`${modalText.includes('Average') && modalText.includes('Samples') ? 'PASS' : 'FAIL'} stats table present (Average/Samples columns)`);

  // --- threshold diagnostics (direction-aware, from the device's real rule) ---
  console.log(`${modalText.includes('Latest') && modalText.includes('In alarm') ? 'PASS' : 'FAIL'} diagnostics columns present (Latest / In alarm)`);
  // The Parameter column's palette dot is also a rounded-full span, so match
  // on the badges that actually carry text rather than on shape alone.
  const badges = (await modal.locator('td span.rounded-full').allTextContents())
    .map((b) => b.trim()).filter(Boolean);
  console.log(`  status badges: ${JSON.stringify(badges)}`);
  const validBadge = badges.length > 0 && badges.every((b) => ['NORMAL', 'WARNING', 'CRITICAL'].includes(b));
  console.log(`${validBadge ? 'PASS' : 'FAIL'} every status badge is a real evaluated status`);
  const pctCells = (modalText.match(/\d+\.\d%/g) || []);
  console.log(`  in-alarm percentages: ${JSON.stringify(pctCells.slice(0, 6))}`);
  console.log(`${pctCells.length > 0 ? 'PASS' : 'FAIL'} in-alarm percentage computed`);

  // --- correlation ---
  console.log(`${modalText.includes('How these parameters moved together') ? 'PASS' : 'FAIL'} correlation panel present`);
  const rTexts = await modal.locator('span.tabular-nums').allTextContents();
  const rVals = rTexts.map((t) => parseFloat(t)).filter((v) => !Number.isNaN(v));
  console.log(`  reported r values: ${JSON.stringify(rTexts)}`);
  console.log(`${rVals.length === 3 ? 'PASS' : 'FAIL'} 3 pairs reported for a 3-parameter chart (got ${rVals.length})`);
  console.log(`${rVals.every((v) => Math.abs(v) <= 1) ? 'PASS' : 'FAIL'} every |r| <= 1`);
  // The mock gives oilTemp/hydrogen a small phase gap and moisture a quarter
  // turn, so a correct implementation MUST report a spread — all-identical
  // values would mean the pairing or the maths is not really running.
  const spread = rVals.length ? Math.max(...rVals) - Math.min(...rVals) : 0;
  console.log(`  spread between strongest and weakest r = ${spread.toFixed(2)}`);
  console.log(`${spread > 0.2 ? 'PASS' : 'FAIL'} r values differ per pair (not a constant)`);
  console.log(`${modalText.includes('not causation') ? 'PASS' : 'FAIL'} causation caveat shown`);
  console.log(`${modalText.includes('bucketed averages') ? 'PASS' : 'FAIL'} bucketed-means limitation stated`);

  // Legend: hide one series, confirm line count drops and legend chip shows struck-through
  const legendChips = modal.locator('button:has-text("Oil Temp")').first();
  await legendChips.click();
  await page.waitForTimeout(500);
  lines = await modal.locator('.recharts-line').count();
  console.log(`${lines === 2 ? 'PASS' : 'FAIL'} hiding a series via legend drops rendered lines to 2 (was 3)`);
  await legendChips.click(); // restore
  await page.waitForTimeout(500);
  lines = await modal.locator('.recharts-line').count();
  console.log(`${lines === 3 ? 'PASS' : 'FAIL'} re-clicking legend chip restores the series (3 lines again)`);

  // CSV export button present + enabled
  const csvBtn = modal.locator('button:has-text("CSV")');
  console.log(`${(await csvBtn.count()) === 1 ? 'PASS' : 'FAIL'} CSV export button present`);
  console.log(`${!(await csvBtn.isDisabled()) ? 'PASS' : 'FAIL'} CSV export button enabled (rows loaded)`);

  await page.screenshot({ path: `${SCRATCH}/chart-analysis-modal-${role}.png`, fullPage: false });

  // Escape closes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  console.log(`${(await page.locator('div[role="dialog"][aria-label*="chart visualize analysis"]').count()) === 0 ? 'PASS' : 'FAIL'} Escape closes the modal`);

  await browser.close();
}

await run('admin');
await run('customer');

console.log('\nDone.');
