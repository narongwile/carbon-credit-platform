// Proves schemaLabel() names the MEASURED QUANTITY, not one of its alarm bands.
//
// One telemetry key can carry two alarm rows — a phase voltage alarms both
// over and under, a frequency both high and low — differing only in
// `direction`. That is a property of the alarm rules; the meter reports one
// number either way.
//
// schemaLabel() used to be a bare `.find()`, returning whichever row was
// declared first and dragging its band suffix along. It is the shared label
// resolver behind FIVE screens that all render it as "what is this reading
// called" (readings picker, payload cross-check, catalog editor, org payload
// spec, pending-device approval), so a device publishing `Hz` showed up as
// "Frequency — Over" in every one of them, as if the sensor itself were an
// over-limit condition.
//
// Runs the REAL exported function against the REAL ALARM_SCHEMA — no
// reimplementation that could drift from what ships.
//
// Run from the repo root: node e2e/proofs/test-schema-label-bands.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'frontend-next/src');

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

// --- load the real ALARM_SCHEMA and the real schemaLabel ------------------
// Both are TS with `@/` imports and a 'use client' directive, so rather than
// stand up a bundler this strips the TS-only syntax it needs and evaluates the
// two pieces directly. If either file's shape changes enough to break this,
// that is a signal worth failing on, not routing around.
const stripTypes = (s) => s
  .replace(/^'use client'\s*$/m, '')
  .replace(/^import[\s\S]*?from\s*'[^']+'\s*$/gm, '')
  .replace(/^export type[^\n]*$/gm, '')
  .replace(/^export interface[\s\S]*?^\}$/gm, '');

const schemaSrc = fs.readFileSync(path.join(SRC, 'lib/alarmParams.ts'), 'utf8');
const schemaBody = schemaSrc.slice(
  schemaSrc.indexOf('export const ALARM_SCHEMA'),
  schemaSrc.indexOf('export const getAlarmSchema'),
).replace(/export const ALARM_SCHEMA[^=]*=/, 'const ALARM_SCHEMA =');

const labelSrc = fs.readFileSync(path.join(SRC, 'lib/useParamLabels.ts'), 'utf8');
const sepDecl = labelSrc.slice(labelSrc.indexOf('const BAND_SEPARATOR'), labelSrc.indexOf('\n', labelSrc.indexOf('const BAND_SEPARATOR')));
const fnStart = labelSrc.indexOf('export function schemaLabel');
const fnEnd = labelSrc.indexOf('\n}', fnStart) + 2;
const fnBody = labelSrc.slice(fnStart, fnEnd)
  .replace('export function schemaLabel', 'function schemaLabel')
  .replace(/:\s*SensorDomain\s*\|\s*undefined/, '')
  .replace(/:\s*string\)/, ')')
  .replace(/\)\s*:\s*string\s*\{/, ') {')
  .replace(/\(label:\s*string\)/, '(label)');

const schemaLabel = new Function(`${stripTypes(schemaBody)}\n${sepDecl}\n${fnBody}\nreturn schemaLabel;`)();

// sanity: the harness above actually produced a working function
t('harness loaded the real schemaLabel + ALARM_SCHEMA',
  typeof schemaLabel === 'function' && schemaLabel('transformer', 'oilTemp') === 'Top Oil Temperature',
  `oilTemp -> ${JSON.stringify(schemaLabel('transformer', 'oilTemp'))}`);

// --- 1. dual-band keys resolve to the quantity, with no band suffix -------
for (const [key, expected] of [
  ['VoltAN', 'Phase A-N Voltage'],
  ['VoltBN', 'Phase B-N Voltage'],
  ['VoltCN', 'Phase C-N Voltage'],
  ['Hz', 'Frequency'],
]) {
  const got = schemaLabel('transformer', key);
  t(`${key} -> "${expected}" (no band suffix)`, got === expected, `got ${JSON.stringify(got)}`);
}

// --- 2. no label anywhere still leaks a band suffix through this path -----
const dualBandKeys = ['VoltAN', 'VoltBN', 'VoltCN', 'Hz'];
const leaked = dualBandKeys.filter((k) => /—/.test(schemaLabel('transformer', k)));
t('no dual-band key resolves to a label still containing the band separator',
  leaked.length === 0, leaked.length ? leaked.join(', ') : '');

// --- 3. single-band keys are untouched (the fix must not rewrite them) ----
for (const [key, expected] of [
  ['oilTemp', 'Top Oil Temperature'],
  ['hydrogen', 'Hydrogen H₂ (DGA)'],
  ['moisture', 'Moisture'],
  ['ambientTemp', 'Ambient Temperature'],
  ['VoltUnbalanceAN', 'Phase A-N Voltage Unbalance'],
  ['PFTotal', 'Power Factor (3-phase)'],
  ['THD_VoltAB', 'Voltage THD A-B'],
]) {
  const got = schemaLabel('transformer', key);
  t(`${key} keeps its label unchanged`, got === expected, `got ${JSON.stringify(got)}`);
}

// --- 4. unknown keys still fall through to the raw wire key --------------
t('an unknown key falls back to the raw key',
  schemaLabel('transformer', 'Tbox') === 'Tbox', `got ${JSON.stringify(schemaLabel('transformer', 'Tbox'))}`);
t('no domain falls back to the raw key',
  schemaLabel(undefined, 'VoltAN') === 'VoltAN');

// --- 5. other domains unaffected -----------------------------------------
t('carbonNode label still resolves',
  schemaLabel('carbonNode', 'tempHigh') === 'Temperature (high)',
  `got ${JSON.stringify(schemaLabel('carbonNode', 'tempHigh'))}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
