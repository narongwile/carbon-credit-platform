// Guards the PdM studios against presenting fabricated numbers as this
// asset's measurements.
//
// The studios were built visualisation-first and wired to telemetry second.
// Eight of the nine make no backend call at all, so every number they show
// arrives as a prop — and TransformerDetailView's liveTelemetry substitutes
// catalogue constants (H2 65, CH4 45, C2H2 3.2, moisture 22, hot-spot =
// oilTemp + 14, ...) whenever the asset does not publish that channel, which
// for DGA is most transformers. On screen a substituted constant is
// indistinguishable from a reading: same font, same units, same colour-coded
// IEEE/IEC status chip. Several of these panels then emit engineering
// verdicts from it — fault type, remaining life in years, replacement budget.
//
// This asserts the two invariants that keep that honest:
//   1. every studio whose dataset is baked into the component renders a
//      DemoDataBanner;
//   2. no studio attributes fabricated records to a real, named external
//      laboratory or authority.
//
// Run from the repo root: node e2e/proofs/test-studio-data-provenance.mjs

import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const DIR = new URL('../../frontend-next/src/components/transformer/', import.meta.url);
const read = (f) => readFileSync(new URL(f, DIR), 'utf8');

// ── 1. Studios whose displayed dataset is a constant in the file ──────────
// Each of these carries a hardcoded fleet / certificate / gas set that is NOT
// derived from this asset, so each must disclose that on screen.
const MUST_DISCLOSE = [
  ['FleetRiskMatrix.tsx', 'takes no props at all — the entire fleet table, including the capex budget total, is a constant'],
  ['LabDgaIngestion.tsx', 'ships sample laboratory certificates with CERTIFIED status and oil-quality figures'],
  ['DgaDuvalTriangle.tsx', 'renders a Duval fault verdict from gases that fall back to catalogue constants'],
  ['InsulationAgingRul.tsx', 'computes remaining life from a literal service-hours figure and an estimated hot-spot'],
];

for (const [file, why] of MUST_DISCLOSE) {
  const src = read(file);
  t(`${file} renders a DemoDataBanner (${why})`,
    /<DemoDataBanner/.test(src) && /from '@\/components\/transformer\/DemoDataBanner'/.test(src));
}

// The banner component itself must exist and take the two explaining props.
const banner = read('DemoDataBanner.tsx');
t('DemoDataBanner exists and requires a title and a detail',
  /title:\s*string/.test(banner) && /detail:\s*string/.test(banner));

// ── 2. No fabricated record may name a real external body ─────────────────
// Attributing an invented CERTIFIED test result to a real accredited lab or a
// national utility is not a labelling nit — it is putting words in a third
// party's mouth, on a document an engineer may forward.
const REAL_BODIES = [
  'SGS',
  'MEA Central',
  'PEA High-Voltage',
  'Doble laboratory',
];
const lab = read('LabDgaIngestion.tsx');
for (const name of REAL_BODIES) {
  t(`LabDgaIngestion does not attribute sample records to "${name}"`,
    !lab.includes(name),
    lab.includes(name) ? 'a fabricated CERTIFIED record names a real organisation' : '');
}

// The sample records must still be recognisable AS samples.
t('LabDgaIngestion sample records are labelled as samples',
  /sample record/i.test(lab));

// ── 3. The measured flags must actually reach a consumer ──────────────────
// liveTelemetry computes `measured.*` to distinguish a reading from a
// substituted constant. It is only worth computing if something reads it.
const detail = readFileSync(new URL('../../frontend-next/src/components/transformer/TransformerDetailView.tsx', import.meta.url), 'utf8');
t('liveTelemetry exposes measured flags', /measured:\s*\{/.test(detail));
t('measured.dga is passed to the Duval studio, not only to the PDF',
  /gasesMeasured=\{liveTelemetry\.measured\.dga\}/.test(detail),
  'the flag existed but only the PDF consumed it, leaving every on-screen studio unlabelled');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
