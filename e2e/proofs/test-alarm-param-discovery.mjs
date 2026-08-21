// Proves the alarm editor offers ONE row per reading sensor, with the
// engineered limits from the catalog — not a duplicate phantom row carrying a
// limit guessed from the key's spelling.
//
// The bug: the catalog is stored in a Map keyed by rowId (`key::direction`),
// because one sensor can carry two independent bands (over- and under-voltage
// on the same phase). The two discovery passes that follow it carried BARE
// keys but tested them with `map.has(k)` against that rowId-keyed map, which
// can never match. So every parameter the device actually publishes was added
// a SECOND time as a phantom row with placeholder limits — and phantom rows
// are saved into the rule with enabled:true exactly like real ones.
//
// On a real ETERNITY transformer that is not cosmetic. It publishes VoltAN
// ≈ 225 V natively, so the phantom row became a 'VoltAN' rule at warn 80 V /
// critical 100 V, direction high — permanently CRITICAL on a healthy phase,
// sitting next to the real 241.5 / 253 V band it duplicated.
//
// This proof reimplements the resolution rule the component uses and asserts
// on it directly; test-alarm-discovery-ui.mjs drives the same thing through
// the real editor in a browser.
//
// Run from the repo root: node e2e/proofs/test-alarm-param-discovery.mjs

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const rowId = (p) => `${p.key}::${p.direction}`;

// A slice of READING_PAYLOAD_CATALOG.transformer: VoltAN deliberately carries
// two bands sharing one key, which is what breaks a bare-key lookup.
const CATALOG = [
  { key: 'oilTemp', label: 'Top Oil Temperature', unit: '°C', direction: 'high', warn: 85, critical: 90 },
  { key: 'VoltAN', label: 'Phase A-N — Over-voltage', unit: 'V', direction: 'high', warn: 241.5, critical: 253 },
  { key: 'VoltAN', label: 'Phase A-N — Under-voltage', unit: 'V', direction: 'low', warn: 218.5, critical: 207 },
  { key: 'hydrogen', label: 'Hydrogen H₂ (DGA)', unit: 'ppm', direction: 'high', warn: 150, critical: 300 },
];

// Exactly what a real ETERNITY publishes after the worker normalises it
// (fe26d5f3): canonical keys that collide with catalog keys, plus enclosure
// sensors that have no catalog entry at all.
const DISCOVERED = ['oilTemp', 'VoltAN', 'hydrogen', 'Tbox', 'RHamb'];

/** The fixed resolution: catalog rows keyed by rowId, discovery matched on bare keys. */
function buildParams() {
  const map = new Map();
  for (const p of CATALOG) map.set(rowId(p), { ...p });
  const catalogKeys = new Set(CATALOG.map((p) => p.key));
  for (const k of DISCOVERED) {
    if (catalogKeys.has(k) || map.has(k)) continue;
    map.set(k, { key: k, label: k, unit: '', direction: 'high', warn: 80, critical: 100, unrationalized: true });
  }
  return Array.from(map.values());
}

const params = buildParams();
const rowsFor = (key) => params.filter((p) => p.key === key);
const enabled = (p) => p.enabled ?? !p.unrationalized; // the component's default

// ---- 1. no duplicate phantom rows for keys the catalog already covers ----
t('oilTemp yields exactly one row', rowsFor('oilTemp').length === 1, `${rowsFor('oilTemp').length} row(s)`);
t('hydrogen yields exactly one row', rowsFor('hydrogen').length === 1, `${rowsFor('hydrogen').length} row(s)`);
t('VoltAN yields exactly its two catalog bands, no phantom third',
  rowsFor('VoltAN').length === 2, `${rowsFor('VoltAN').length} row(s)`);

// ---- 2. the surviving rows keep their ENGINEERED limits ----
const oil = rowsFor('oilTemp')[0];
t('oilTemp keeps the catalog limits 85/90, not the guessed 80/100',
  oil.warn === 85 && oil.critical === 90, `warn=${oil.warn} critical=${oil.critical}`);
const over = rowsFor('VoltAN').find((p) => p.direction === 'high');
t('VoltAN over-voltage keeps 241.5/253',
  over.warn === 241.5 && over.critical === 253, `warn=${over.warn} critical=${over.critical}`);

// This is the regression that mattered: a healthy 225 V phase must not breach.
const LIVE_VOLTAGE = 225.6;
const breachedHigh = rowsFor('VoltAN')
  .filter((p) => p.direction === 'high' && enabled(p))
  .filter((p) => LIVE_VOLTAGE >= p.critical);
t('a healthy 225.6 V phase raises no CRITICAL on any enabled VoltAN band',
  breachedHigh.length === 0, `${breachedHigh.length} band(s) would fire`);

// ---- 3. genuinely-unknown keys are still offered, but never armed ----
const tbox = rowsFor('Tbox')[0];
t('Tbox (no catalog entry) is still offered to the operator', !!tbox);
t('Tbox is marked unrationalized', tbox.unrationalized === true);
t('Tbox is NOT enabled by default (guessed limit must not annunciate)', enabled(tbox) === false);
t('RHamb is likewise offered but not armed',
  !!rowsFor('RHamb')[0] && enabled(rowsFor('RHamb')[0]) === false);

// ---- 4. catalog rows ARE armed by default — the fix must not disarm them ----
t('oilTemp stays enabled by default', enabled(oil) === true);
t('VoltAN over-voltage stays enabled by default', enabled(over) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
