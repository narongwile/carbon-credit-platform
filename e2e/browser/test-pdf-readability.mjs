// Downloads the real report PDF from the running app and checks that every
// piece of text is actually legible on the page.
//
// A PDF page is white no matter what theme the app is in. The three section
// headings were coloured slate-100 (241,245,249) — lifted from the dark UI
// palette — and drawn from y=35 downward, clear of the 28pt dark header
// banner. So they were rendered white-on-white: present in the file, invisible
// to the reader.
//
// This asserts on the PDF's own content stream rather than on the source, so
// it stays true whatever the drawing code is refactored into. jsPDF writes
// colours as normalised RGB followed by the `rg` operator, e.g.
// slate-100 -> "0.945 0.961 0.976 rg".
//
// Needs mock-backend.mjs on :4001 and next dev on :3901.
// Run from e2e/browser/: node test-pdf-readability.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken');
  localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin' }));
});
await page.goto('http://localhost:3901/admin/reports', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);

const btn = page.getByRole('button', { name: /Generate .* Download PDF/i }).first();
t('the Generate & Download PDF button is present', await btn.count() > 0);

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  btn.click(),
]);
const out = path.join(os.tmpdir(), 'iiot-report-check.pdf');
await download.saveAs(out);
const size = fs.statSync(out).size;
t('a PDF was produced', size > 2000, `${size} bytes`);

const raw = fs.readFileSync(out, 'latin1');
t('the file really is a PDF', raw.startsWith('%PDF'), raw.slice(0, 8));

// jsPDF emits uncompressed content streams by default, so the drawing
// operators are readable straight out of the file.
const rgOps = [...raw.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g)]
  .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
t('colour operators found in the content stream', rgOps.length > 0, `${rgOps.length} fill-colour ops`);

const near = (c, r, g, b) => Math.abs(c[0] - r) < 0.01 && Math.abs(c[1] - g) < 0.01 && Math.abs(c[2] - b) < 0.01;

// --- the regression: slate-100 text must be gone -------------------------
const slate100 = rgOps.filter((c) => near(c, 0.945, 0.961, 0.976));
t('no slate-100 (white-on-white) fill colour is set anywhere',
  slate100.length === 0, `${slate100.length} occurrence(s)`);

// --- and the headings must now be drawn in the dark colour ---------------
const slate800 = rgOps.filter((c) => near(c, 0.118, 0.161, 0.231));
t('the dark section-heading colour IS used', slate800.length >= 1, `${slate800.length} occurrence(s)`);

// --- non-vacuity: the headings must actually be in the document ----------
// Without this the two assertions above would pass on an empty PDF.
const headings = ['Executive Fleet KPIs', 'Asset Health', 'Alarm Incident Log'];
const present = headings.filter((h) => raw.includes(h));
t('the section headings this is about are present in the PDF',
  present.length > 0, `found: ${present.join(', ') || 'NONE — assertions above would be vacuous'}`);

// --- the footer disclaimer must survive to the page, not run off it ------
// It was drawn as one long unwrapped line and clipped mid-sentence; the
// clause that fell off the right edge was the one telling the reader this is
// not an accredited certificate.
t('the footer disclaimer is complete in the PDF, not clipped',
  raw.includes('Not an accredited compliance certificate'),
  raw.includes('accredited') ? 'present' : 'MISSING — clipped off the page');

// --- pure white text is only legitimate over a filled dark table header ---
const white = rgOps.filter((c) => near(c, 1, 1, 1));
console.log(`  (pure-white fills: ${white.length} — expected, autoTable paints them onto dark header rows)`);

fs.unlinkSync(out);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
