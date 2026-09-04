// The carbon page must account for the assets it says it accounts for, and
// must say which assets it leaves out.
//
// WHAT HAPPENED
// -------------
// 332dac58 "align carbon accounting to substation transformers" narrowed the
// page to transformers by deleting the per-domain branch:
//
//     if (domain === 'transformer')      { kva-based }
//     else if (domain === 'carbonNode')  { 1.45 kW chiller }
//     else if (domain === 'bloodBox')    { 0.22 kWh/day cold-chain box }
//     else if (domain === 'automobile')  { 42 kWh/day EV telemetry }
//
// and replacing it with the transformer formula, unconditionally. But the
// device list it maps over is useManagedDevices(orgId) — EVERY device in the
// organization — and the platform still ships all four domains: SensorDomain
// in types/fleet.ts is 'transformer' | 'carbonNode' | 'bloodBox' |
// 'automobile', and admin/bloodbox and admin/automobile are live pages.
//
// So the change did not scope the page to transformers. It relabelled every
// asset as one:
//
//     bloodBox     0.22 kWh/day  ->  17,340 kWh/day    ~78,800x
//     carbonNode   34.8          ->  17,340              ~498x
//     automobile   42            ->  17,340              ~413x
//
//     (1250 kVA x 0.85 pf x 0.68 load x 24 h = 17,340 kWh/day)
//
// That number is summed into totalScope2Tco2e, which feeds the GHG Protocol
// scope breakdown, the fleet energy figure and the SBTi 1.5C trajectory — on
// a page badged "GHG PROTOCOL & ISO 14064-1 COMPLIANT". The asset table made
// it visible without making it legible: it still printed each row's real
// domain badge next to the words "1250 kVA Substation Transformer".
//
// THE OTHER HALF
// --------------
// Filtering the list fixes the overstatement and creates its mirror image: a
// mixed fleet then shows a total that silently omits devices. A corporate
// inventory that quietly drops assets is wrong in the other direction, so the
// exclusion has to be stated on the page, not just performed.
//
// Run from the repo root: node e2e/proofs/test-carbon-domain-scope.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const readSrc = (rel) => {
  try { return readFileSync(new URL('frontend-next/src/' + rel, root), 'utf8') }
  catch { return '' }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')

const raw = readSrc('app/admin/carbon/page.tsx')
const src = strip(raw)
const fleet = strip(readSrc('types/fleet.ts'))

// ── 1. The premise: the other domains still exist ────────────────────────
// If they were ever genuinely removed from the product this gate should be
// deleted, not weakened — so it asserts the premise it depends on.
t('the platform still ships more than one sensor domain',
  /'transformer' \| 'carbonNode' \| 'bloodBox' \| 'automobile'/.test(fleet),
  'if this ever narrows to transformer-only, this whole gate is moot')

// ── 2. The narrowing happens on the device list ──────────────────────────
t('the inventory is built from transformers only',
  /devices\.filter\(\(d\) => \(d\.domain \|\| 'transformer'\) === 'transformer'\)/.test(src),
  'the transformer formula applied to an unfiltered list relabels, it does not scope')
t('the mapped list is the filtered one, not the raw device list',
  /return transformerDevices\.map\(\(d\) => \{/.test(src) &&
  !/return devices\.map\(\(d\) => \{/.test(src))

// A regression here is silent — every figure still renders, just too large —
// so pin the constants the overstatement was built from.
t('the transformer energy model is unchanged for actual transformers',
  /const kva = \(d as any\)\.kva \|\| 1250/.test(src) &&
  /const loadFactor = 0\.68/.test(src) &&
  /const pf = 0\.85/.test(src) &&
  /Math\.round\(kva \* pf \* loadFactor \* 24 \* periodDays\)/.test(src))

// ── 3. What is left out is stated, not silently dropped ─────────────────
t('the page counts what it excluded',
  /const excludedDeviceCount = devices\.length - transformerDevices\.length/.test(src))
const flat = src.replace(/\s+/g, ' ')
t('the page tells the operator when assets are excluded',
  /excludedDeviceCount > 0 && \(/.test(src) &&
  /are not substation transformers and are/.test(flat) &&
  /excluded<\/strong> from every figure on this page/.test(flat))
t('the exclusion notice says the corporate inventory is therefore incomplete',
  /not complete from this page alone/.test(flat),
  'a GHG inventory that quietly omits assets is wrong in the other direction')
t('the synced-fleet badge distinguishes accounted assets from total assets',
  /\{assetInventory\.length\} of \{devices\.length\} Assets Accounted/.test(src),
  'it used to read "{devices.length} Assets" while accounting for a different set')

// ── 4. No control that cannot change anything ───────────────────────────
// Once the page is transformer-only, "All" and "Substation Transformers"
// select the same rows.
t('the dead domain filter is gone',
  !/setDomainFilter/.test(src) && !/const \[domainFilter/.test(src))
t('the table renders the accounted inventory directly',
  !/filteredAssetInventory/.test(src))

// ── 5. The export carries the same set as the screen ────────────────────
t('the CSV/report export is built from the same accounted inventory',
  /const rows = assetInventory\.map\(\(a\) =>/.test(src),
  'an export that disagrees with the screen is the harder bug to find')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
