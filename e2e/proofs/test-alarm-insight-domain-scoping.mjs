// Proves getAlarmInsight() resolves tempHigh/tempLow per-domain instead of
// returning whichever domain's text happened to be registered under the bare
// key. carbonNode (fridge) and bloodBox (blood cold-chain) both use the
// canonical keys tempHigh/tempLow — see ALARM_SCHEMA.carbonNode/.bloodBox in
// alarmParams.ts, same key names, different thresholds. Without domain
// scoping, whichever domain's insight text was added LAST wins for BOTH
// products: a BloodBOX cold-chain excursion would render refrigerator
// troubleshooting text ("check door seal gasket") instead of a blood-safety
// SOP escalation, on a real device event log (NodeEventLog.tsx). See also
// e2e/proofs/test-riskmap.mjs, which proves the equivalent fix on the
// notify-email side (a separate copy of the same risk-text concept).
//
// Runs the REAL exported ALARM_RISK_INSIGHTS + getAlarmInsight — no
// reimplementation that could drift from what ships. TS-only syntax is
// stripped with the same targeted approach test-schema-label-bands.mjs
// already uses (this repo's CI runs proofs under plain node:20-alpine, so a
// full TS toolchain / --experimental-strip-types is not an option here).
//
// Run from the repo root: node e2e/proofs/test-alarm-insight-domain-scoping.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'frontend-next/src');

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const src = fs.readFileSync(path.join(SRC, 'lib/alarmParams.ts'), 'utf8');

const insightsStart = src.indexOf('export const ALARM_RISK_INSIGHTS');
const insightsEnd = src.indexOf('\n}', insightsStart) + 2;
const insightsBody = src.slice(insightsStart, insightsEnd)
  .replace(/export const ALARM_RISK_INSIGHTS[^=]*=/, 'const ALARM_RISK_INSIGHTS =');

const fnStart = src.indexOf('export function getAlarmInsight');
const fnEnd = src.indexOf('\n}', fnStart) + 2;
const fnBody = src.slice(fnStart, fnEnd)
  .replace('export function getAlarmInsight', 'function getAlarmInsight')
  .replace(/:\s*string,\s*domain\?\s*:\s*SensorDomain\s*\)/, ', domain)')
  .replace(/\)\s*:\s*AlarmRiskInsight\s*\|\s*undefined\s*\{/, ') {');

const getAlarmInsight = new Function(`${insightsBody}\n${fnBody}\nreturn getAlarmInsight;`)();

t('harness loaded the real getAlarmInsight + ALARM_RISK_INSIGHTS',
  typeof getAlarmInsight === 'function' && !!getAlarmInsight('oilTemp'),
  `oilTemp -> ${JSON.stringify(getAlarmInsight('oilTemp'))}`);

const carbonHigh = getAlarmInsight('tempHigh', 'carbonNode');
const bloodHigh = getAlarmInsight('tempHigh', 'bloodBox');
const carbonLow = getAlarmInsight('tempLow', 'carbonNode');
const bloodLow = getAlarmInsight('tempLow', 'bloodBox');
const noDomainHigh = getAlarmInsight('tempHigh');

t('carbonNode tempHigh resolves', !!carbonHigh, JSON.stringify(carbonHigh));
t('bloodBox tempHigh resolves', !!bloodHigh, JSON.stringify(bloodHigh));
t('carbonNode and bloodBox get DIFFERENT tempHigh insight text', carbonHigh.category !== bloodHigh.category && carbonHigh.action !== bloodHigh.action,
  `carbonNode: ${carbonHigh.category} / bloodBox: ${bloodHigh.category}`);
t('bloodBox tempHigh text is actually about blood, not a fridge', /blood/i.test(bloodHigh.risk) && !/compressor|condenser|evaporator/i.test(bloodHigh.action),
  bloodHigh.action);
t('carbonNode tempHigh text is actually about a fridge, not blood', /compressor|condenser|evaporator|door seal/i.test(carbonHigh.action) && !/blood/i.test(carbonHigh.action),
  carbonHigh.action);
t('same distinction holds for tempLow', carbonLow.category !== bloodLow.category && /blood/i.test(bloodLow.risk) && !/blood/i.test(carbonLow.risk));

// A THIRD domain with no specific entry must get an honest generic fallback,
// not silently inherit carbonNode's or bloodBox's wording.
t('a domain with no specific tempHigh entry gets a neutral generic fallback, not carbonNode/bloodBox text',
  noDomainHigh.category !== carbonHigh.category && noDomainHigh.category !== bloodHigh.category && !/blood|compressor|condenser/i.test(noDomainHigh.action),
  JSON.stringify(noDomainHigh));

// Non-colliding keys (carbonNode-exclusive) must be unaffected by this change.
const door = getAlarmInsight('door', 'carbonNode');
t('a non-colliding carbonNode key (door) still resolves correctly', !!door && door.category === 'Enclosure & Access', JSON.stringify(door));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
