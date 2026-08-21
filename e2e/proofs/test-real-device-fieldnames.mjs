// Proves the real ETERNITY transformer's actual wire spellings — Oiltemp, H2,
// OilMoisture, Tamb — now normalize to the canonical param keys the alarm
// rules and device pages look up (oilTemp, hydrogen, moisture, ambientTemp).
//
// Before this fix, worker/main.go's paramMap and this Node-RED 'normalize'
// node both had zero entries for these spellings (confirmed via grep against
// a real MQTT payload from the device), so top-oil-temperature — the single
// most safety-critical transformer parameter — was stored under the raw key
// 'Oiltemp' and never evaluated by any alarm rule, which only ever addresses
// 'oilTemp'. Tbox/RHamb/RHbox are deliberately left unmapped: no existing
// canonical param or defensible engineering threshold exists for them yet, so
// this proof also checks they pass through UNCHANGED rather than being
// silently guessed at.
//
// Driven through the REAL generated Node-RED 'normalize' function extracted
// from the built flow — run `node backend/node-red/generate-nodered-backend.mjs`
// first if the generator source has changed since the committed flow was last
// built.
//
// Run from the repo root: node e2e/proofs/test-real-device-fieldnames.mjs
import fs from 'node:fs';

const flows = JSON.parse(fs.readFileSync('backend/node-red/flows.nodered-backend.json', 'utf8'));
const node = flows.find((f) => f.type === 'function' && f.name && f.name.startsWith('normalize ('));
if (!node) { console.error('FAIL could not find the normalize function node — regenerate the flow first'); process.exit(1); }

const fn = new Function('msg', node.func);

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

function normalize(values) {
  const [out] = fn({ payload: { nodeId: 'TR-1', values, ts: Date.now() }, topic: 'P/TR-1/readings' });
  return out.payload.values;
}

// ---- the real payload's field spellings, exactly as the device sends them ----
const v = normalize({
  Oiltemp: 62.4,
  H2: 3,
  OilMoisture: 12,
  Tamb: 31.2,
  Tbox: 28.5,
  RHamb: 55,
  RHbox: 40,
  VoltAN: 225.6, // already-canonical key, must pass through unaffected
});

t("Oiltemp -> oilTemp", v.oilTemp === 62.4, `got ${JSON.stringify(v)}`);
t("H2 -> hydrogen", v.hydrogen === 3);
t("OilMoisture -> moisture", v.moisture === 12);
t("Tamb -> ambientTemp", v.ambientTemp === 31.2);
t("Tbox passes through unmapped (no canonical param exists yet)", v.Tbox === 28.5);
t("RHamb passes through unmapped (no canonical param exists yet)", v.RHamb === 55);
t("RHbox passes through unmapped (no canonical param exists yet)", v.RHbox === 40);
t("already-canonical VoltAN is untouched", v.VoltAN === 225.6);
t("no stray raw keys survive for the mapped fields", v.Oiltemp === undefined && v.H2 === undefined && v.OilMoisture === undefined && v.Tamb === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
