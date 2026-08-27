// Proves every key in AlarmParamConfig's DEFAULT_TRANSFORMER_KEYS fallback
// actually exists in READING_PAYLOAD_CATALOG.transformer.
//
// The bug this locks out: that fallback list was copied out of realtime.ts's
// SENSOR_KEYS — the TELEMETRY PAYLOAD names ('oilTemperature',
// 'windingTemperature', 'load') — and used to filter the ALARM CATALOG, whose
// keys are 'oilTemp' / 'windingTemp' and which has no 'load' row at all.
// realtime.ts's own TX_KEY_MAP is the thing that renames oilTemp ->
// oilTemperature on the wire, so the two namespaces look interchangeable and
// are not. `allParams.filter(p => list.includes(p.key))` then matched only
// hydrogen, moisture and oilLevel: both temperature alarms — the primary
// transformer alarms — vanished from the editor with no error, no empty state,
// no console warning. Just three rows where there should have been five.
//
// It reaches users on the path with the least data to fall back on: a device
// with no display-params configured and no telemetry seen yet, which after the
// department-scoping change is also the personal-threshold editor's fallback.
//
// A rename inside either namespace re-breaks this silently, which is exactly
// why it is asserted rather than reviewed.
//
// Run from the repo root: node e2e/proofs/test-default-transformer-keys.mjs

import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const src = readFileSync(new URL('../../frontend-next/src/components/device/AlarmParamConfig.tsx', import.meta.url), 'utf8');

// ── The fallback list, read from source ────────────────────────────────────
const declMatch = src.match(/const DEFAULT_TRANSFORMER_KEYS = \[([^\]]*)\]/);
t('DEFAULT_TRANSFORMER_KEYS is declared once, as a module-level constant',
  !!declMatch, declMatch ? '' : '(not found — was it inlined back into the hooks?)');
if (!declMatch) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const fallbackKeys = [...declMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
t('fallback list is non-empty', fallbackKeys.length > 0, `(${fallbackKeys.length} keys)`);

// ── The transformer catalog, read from the same source ─────────────────────
// READING_PAYLOAD_CATALOG.transformer runs from its `transformer: [` opener to
// the next domain key at the same depth; every row declares `key: '<k>'`.
const catStart = src.indexOf('export const READING_PAYLOAD_CATALOG');
t('READING_PAYLOAD_CATALOG found', catStart >= 0);
const txStart = src.indexOf('transformer: [', catStart);
const txEnd = src.indexOf('\n  carbonNode:', txStart);
t('transformer catalog block delimited', txStart > 0 && txEnd > txStart);
const catalogKeys = new Set(
  [...src.slice(txStart, txEnd).matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1])
);
t('transformer catalog parsed', catalogKeys.size > 10, `(${catalogKeys.size} distinct keys)`);

// ── The assertion that matters ─────────────────────────────────────────────
const missing = fallbackKeys.filter((k) => !catalogKeys.has(k));
t('every fallback key exists in the transformer catalog',
  missing.length === 0,
  missing.length ? `MISSING: ${missing.join(', ')} — these look like telemetry payload names, not catalog keys` : `(${fallbackKeys.join(', ')})`);

// The two temperature alarms are the whole point of the fallback: a
// transformer editor that opens without them is not a usable editor.
for (const k of ['oilTemp', 'windingTemp']) {
  t(`fallback includes '${k}' (top transformer alarm)`, fallbackKeys.includes(k));
}

// Guard the specific confusion that caused it, in both directions.
for (const wire of ['oilTemperature', 'windingTemperature', 'ambientTemperature']) {
  t(`fallback does NOT carry the wire name '${wire}'`, !fallbackKeys.includes(wire));
}

// And prove the two namespaces really are distinct, so the check above is not
// vacuously true because someone renamed the catalog to match the wire.
t("catalog uses 'oilTemp', not the wire's 'oilTemperature'",
  catalogKeys.has('oilTemp') && !catalogKeys.has('oilTemperature'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
