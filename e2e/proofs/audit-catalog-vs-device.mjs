// Audit: what the real fleet publishes vs what the alarm catalog can address.
//
// Not a pass/fail regression test — a report. It answers the two questions
// that have produced every dead-alarm bug in this codebase so far:
//
//   1. Which parameters does a device actually publish that NOTHING in the
//      catalog or paramMap can name? (invisible readings)
//   2. Which catalog entries name a key that NO device ever publishes?
//      (dead alarms — a rule that looks configured and can never fire)
//
// Ground truth is e2e/fixtures/real-device-payloads.json, captured from the
// live fleet. Run from the repo root:
//   node e2e/proofs/audit-catalog-vs-device.mjs
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync('e2e/fixtures/real-device-payloads.json', 'utf8'));
const src = fs.readFileSync('frontend-next/src/components/device/AlarmParamConfig.tsx', 'utf8');
const schemaSrc = fs.readFileSync('frontend-next/src/lib/alarmParams.ts', 'utf8');
const worker = fs.readFileSync('worker/main.go', 'utf8');

// --- catalog keys for the transformer domain -------------------------------
const catalogBlock = src.slice(src.indexOf('transformer: ['), src.indexOf('carbonNode: ['));
const catalogKeys = new Set([...catalogBlock.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]));

// --- keys auto-seeded into every new device's rule --------------------------
const schemaBlock = schemaSrc.slice(schemaSrc.indexOf('transformer: {'), schemaSrc.indexOf('carbonNode: {'));
const schemaKeys = new Set([...schemaBlock.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]));

// --- worker paramMap: raw wire key -> canonical key -------------------------
const mapBlock = worker.slice(worker.indexOf('var paramMap = map[string]string{'), worker.indexOf('func canonicalParam'));
const paramMap = new Map([...mapBlock.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
const canonical = (k) => paramMap.get(k) ?? k;

// --- every key the fleet really publishes -----------------------------------
const published = new Map(); // canonical key -> [{node, raw}]
for (const f of fixture.frames) {
  for (const raw of Object.keys(f.values)) {
    const c = canonical(raw);
    if (!published.has(c)) published.set(c, []);
    published.get(c).push({ node: f.nodeId, raw });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nfleet publishes ${published.size} distinct parameters across ${fixture.frames.length} feeds`);
console.log(`transformer catalog offers ${catalogKeys.size}; ${schemaKeys.size} are auto-armed on every new device\n`);

// ---------------------------------------------------------------------------
console.log('='.repeat(78));
console.log('A. PUBLISHED BUT UNREACHABLE — real readings no alarm rule can name');
console.log('='.repeat(78));
const unreachable = [...published.entries()].filter(([c]) => !catalogKeys.has(c));
if (!unreachable.length) console.log('  (none)');
for (const [c, uses] of unreachable) {
  const raws = [...new Set(uses.map((u) => u.raw))].join(', ');
  console.log(`  ${pad(c, 24)} raw=${pad(raws, 22)} on ${[...new Set(uses.map((u) => u.node))].join(',')}`);
}

console.log('');
console.log('='.repeat(78));
console.log('B. DEAD CATALOG ENTRIES — offered in the editor, never published');
console.log('='.repeat(78));
const dead = [...catalogKeys].filter((k) => !published.has(k));
if (!dead.length) console.log('  (none)');
for (const k of dead) {
  console.log(`  ${pad(k, 24)}${schemaKeys.has(k) ? '  *** ALSO AUTO-ARMED ON EVERY NEW DEVICE ***' : ''}`);
}

console.log('');
console.log('='.repeat(78));
console.log('C. DEAD *ARMED* ALARMS — auto-enabled rules that can never fire');
console.log('='.repeat(78));
const deadArmed = [...schemaKeys].filter((k) => !published.has(k));
if (!deadArmed.length) console.log('  (none)');
for (const k of deadArmed) console.log(`  ${k}`);

console.log('');
console.log('='.repeat(78));
console.log('D. WORKING — published AND addressable');
console.log('='.repeat(78));
const working = [...published.keys()].filter((k) => catalogKeys.has(k));
for (const k of working) console.log(`  ${pad(k, 24)}${schemaKeys.has(k) ? ' (armed by default)' : ''}`);

console.log(`\nsummary: ${unreachable.length} unreachable · ${dead.length} dead catalog · ${deadArmed.length} dead ARMED · ${working.length} working\n`);

// ---------------------------------------------------------------------------
// The two conditions that are outright bugs, asserted so this file fails CI
// rather than merely printing a report nobody reads.
//
// A dead entry in the CATALOG is legitimate — the catalog is a menu, and a
// transformer with a winding probe or a multi-gas DGA head should be able to
// enable those even though this fleet's hardware has neither. So `dead` is
// reported but not asserted on.
//
// A dead entry in ALARM_SCHEMA is never legitimate: defaultNodeRule() copies
// that list verbatim into every new device's rule, so it ships ARMED. An armed
// alarm on a key nothing publishes reads as coverage in the editor and cannot
// fire at any reading.
//
// An unreachable published parameter is likewise always a bug: the device is
// spending bandwidth on a measurement no rule can name and no chart can plot.
// ---------------------------------------------------------------------------
let failures = 0;
if (deadArmed.length) {
  console.log(`FAIL ${deadArmed.length} alarm(s) are armed on every new device but can never fire: ${deadArmed.join(', ')}`);
  failures++;
} else {
  console.log('PASS no auto-armed alarm names a key the fleet never publishes');
}
if (unreachable.length) {
  console.log(`FAIL ${unreachable.length} published parameter(s) cannot be named by any rule: ${unreachable.map(([c]) => c).join(', ')}`);
  failures++;
} else {
  console.log('PASS every parameter the fleet publishes is addressable');
}
process.exit(failures ? 1 : 0);
