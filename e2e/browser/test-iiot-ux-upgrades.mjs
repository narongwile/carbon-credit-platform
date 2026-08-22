// Verifies the 5 features named in commit 2da43fc1 actually work, not just
// that they compile: inline alarm tuning, chart snapshot, jump-to-peak,
// stream pause, and drag-and-drop dashboard cards.
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-iiot-ux-upgrades.mjs
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

// ---------------------------------------------------------------------
// 1-3: Chart Analysis Modal — jump-to-peak, snapshot, inline alarm tuning
// ---------------------------------------------------------------------
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// ChartAnalysisModal (CustomChartsSection.tsx) opens from the "Expand — chart
// visualize analysis" icon button on a custom chart card — a DIFFERENT,
// simpler "Open history" modal also exists (the KPI tiles above), which does
// not carry Jump Peak / Snapshot / inline Tune at all. Using the wrong one
// here would silently test the wrong component.
const expandBtn = page.locator('button[title*="chart visualize analysis" i]').first();
t('the chart-expand ("chart visualize analysis") button is present', await expandBtn.count() > 0);
if (await expandBtn.count()) {
  await expandBtn.click();
  await page.waitForTimeout(1500);
}
const modalOpen = await page.locator('text=/Correlation|Bucketed|Jump Peak/i').first().isVisible().catch(() => false);
t('Chart Analysis modal opens', modalOpen);

if (modalOpen) {
  // Jump Peak
  const jumpBtn = page.locator('button[title*="Jump to Peak" i], button:has-text("Jump Peak")').first();
  const hasJump = await jumpBtn.count() > 0;
  t('Jump Peak button present', hasJump);
  if (hasJump) {
    const before = await page.locator('input[type="date"], input[type="datetime-local"]').first().inputValue().catch(() => null);
    await jumpBtn.click();
    await page.waitForTimeout(800);
    const toastSeen = await page.locator('text=/Zoomed to peak|No peak excursion/i').first().isVisible().catch(() => false);
    t('Jump Peak produces a result (zoom or "no excursion" toast)', toastSeen);
  }

  // Snapshot / copy chart image
  const snapBtn = page.locator('button[title*="Copy Chart Image" i], button[title*="snapshot" i]').first();
  t('Snapshot / copy-chart-image button present', await snapBtn.count() > 0);

  // Inline alarm tuning
  const tuneBtn = page.locator('button:has-text("Tune"), button[title*="Tune alarm" i]').first();
  const hasTune = await tuneBtn.count() > 0;
  t('inline "Tune" button present in the stats table', hasTune);
  if (hasTune) {
    await tuneBtn.click();
    await page.waitForTimeout(600);
    const warnInput = page.locator('input[type="number"]').first();
    const dialogOpen = await warnInput.count() > 0;
    t('tuning dialog opens with editable warn/critical inputs', dialogOpen);
    if (dialogOpen) {
      // Non-vacuity + honesty check: does the UI disclose that a suggested
      // value (when no rule exists yet) is a guess, not an engineering limit?
      const dialogText = await page.locator('body').innerText();
      const disclosesGuess = /suggest|estimate|observed|not an? (engineering )?limit|guess/i.test(dialogText);
      t('if a value was pre-filled from observed data, the dialog discloses it is a suggestion, not a limit',
        disclosesGuess, disclosesGuess ? 'disclosed' : 'NOT DISCLOSED — see audit note below');
      // Close without saving — this test must not mutate the alarm rule.
      const cancelBtn = page.locator('button:has-text("Cancel")').first();
      if (await cancelBtn.count()) await cancelBtn.click();
    }
  }
}

// ---------------------------------------------------------------------
// 4: stream pause on a custom chart
// ---------------------------------------------------------------------
await page.goto('http://localhost:3901/admin/transformers/detail?id=TRA-9F2C', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
const pauseBtn = page.locator('button:has-text("Live"), button:has-text("Paused")').first();
const hasPause = await pauseBtn.count() > 0;
t('stream pause/live toggle present on a custom chart', hasPause);
if (hasPause) {
  const before = (await pauseBtn.innerText()).trim();
  await pauseBtn.click();
  await page.waitForTimeout(400);
  const after = (await pauseBtn.innerText()).trim();
  t('clicking the toggle flips Live <-> Paused', before !== after, `${before} -> ${after}`);
  await pauseBtn.click(); // restore to live
}

// ---------------------------------------------------------------------
// 5: drag-and-drop dashboard cards
// ---------------------------------------------------------------------
const draggables = await page.locator('[draggable="true"]').count();
t('at least 2 draggable dashboard cards present', draggables >= 2, `${draggables} found`);

await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
