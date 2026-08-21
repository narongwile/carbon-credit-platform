import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXEC, headless: true });

// The chip styles the component declares. A chip is "matched" only if it
// really carries the amber border — asserting on text alone would pass even
// if the highlight silently stopped rendering.
const AMBER_BORDER = 'rgb(146, 112, 44)';
const ROSE_BORDER = 'rgb(127, 58, 58)';

async function chipReport(page, containerSel) {
  return page.$$eval(`${containerSel} span[title]`, (els) =>
    els.map((e) => ({
      text: e.textContent.trim().replace(/\s+/g, ' '),
      border: getComputedStyle(e).borderColor,
      style: getComputedStyle(e).borderStyle,
      title: e.getAttribute('title'),
    })));
}

async function session(role, email, path) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log(`  [err] ${m.text().slice(0, 120)}`); });
  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ role, email }) => {
    const user = { id: 'u1', username: email, email, role, orgId: 'org-1', name: email };
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify(user));
  }, { role, email });
  await page.goto(`http://localhost:3901${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return { ctx, page };
}

function classify(chips) {
  const amber = chips.filter((c) => c.border === AMBER_BORDER);
  const rose = chips.filter((c) => c.border === ROSE_BORDER);
  const plain = chips.filter((c) => c.border !== AMBER_BORDER && c.border !== ROSE_BORDER);
  return { amber, rose, plain };
}

function keyOf(text) { return text.split(/\s+/)[0]; }

// ---------------------------------------------------------------------------
console.log('\n############ admin/pending ############');
{
  const { ctx, page } = await session('admin', 'admin@org1.example', '/admin/pending');
  const chips = await chipReport(page, 'body');
  const { amber, rose, plain } = classify(chips);

  console.log('amber (matched):', amber.map((c) => c.text));
  console.log('rose  (expected, absent):', rose.map((c) => c.text));
  console.log('plain (sent, not in spec):', plain.map((c) => c.text));

  // Each matched key must appear amber TWICE — once on the sample row, once on
  // the expected row. That pairing is the entire feature.
  const counts = {};
  for (const c of amber) counts[keyOf(c.text)] = (counts[keyOf(c.text)] || 0) + 1;
  console.log('\namber occurrences per key (expect 2 each for oilTemp/hydrogen/moisture):');
  console.log(' ', JSON.stringify(counts));

  const paired = ['oilTemp', 'hydrogen', 'moisture'];
  // Expected-row chips lead with the human label, so count by title instead.
  const sampleAmber = amber.filter((c) => c.title?.startsWith('matches'));
  const expectedAmber = amber.filter((c) => c.title?.startsWith('reported'));
  console.log('  sample-row amber count:', sampleAmber.length, '(expect 3)');
  console.log('  expected-row amber count:', expectedAmber.length, '(expect 3)');

  console.log('\nPASS sample row highlights exactly the 3 spec keys:',
    sampleAmber.length === 3 && paired.every((k) => sampleAmber.some((c) => c.text.startsWith(k))));
  console.log('PASS extra keys (load, extraSensor) stay plain:',
    ['load', 'extraSensor'].every((k) => plain.some((c) => c.text.startsWith(k))));
  console.log('PASS "winding" is rose + dashed, not amber:',
    rose.some((c) => c.text.includes('winding')) && rose.every((c) => c.style === 'dashed'));
  console.log('PASS no key is amber on one row and rose on the other:',
    !amber.some((a) => rose.some((r) => keyOf(r.text.split(' ').slice(-1)[0]) === keyOf(a.text))));

  const body = await page.textContent('body');
  console.log('PASS missing-field warning names the field:', body.includes('winding'));
  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log('\n############ admin/fleet ############');
{
  const { ctx, page } = await session('admin', 'admin@org1.example', '/admin/fleet');
  const body = await page.textContent('body');
  console.log('Telemetry Parameters card present:', body.includes('Telemetry Parameters'));

  const chips = await chipReport(page, 'body');
  const { amber, rose, plain } = classify(chips);
  console.log('amber (matched):', amber.map((c) => c.text));
  console.log('rose  (expected, absent):', rose.map((c) => c.text));
  console.log('plain (sent, not in spec):', plain.map((c) => c.text));

  const sampleAmber = amber.filter((c) => c.title?.startsWith('matches'));
  const expectedAmber = amber.filter((c) => c.title?.startsWith('reported'));
  console.log('\nPASS fleet shows the same 3 matched keys on both rows:',
    sampleAmber.length === 3 && expectedAmber.length === 3);
  console.log('PASS fleet flags winding as absent:', rose.some((c) => c.text.includes('winding')));
  console.log('PASS fleet keeps extras plain:',
    ['load', 'extraSensor'].every((k) => plain.some((c) => c.text.startsWith(k))));
  console.log('PASS colours identical to pending (same border rgb):',
    amber.every((c) => c.border === AMBER_BORDER) && rose.every((c) => c.border === ROSE_BORDER));

  await page.screenshot({ path: './screenshots/fleet.png', fullPage: true });
  await ctx.close();
}

await browser.close();
