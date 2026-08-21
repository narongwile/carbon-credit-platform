// Proves the rate-of-rise alarm measures an actual RATE (change per unit time
// in the unit the rule declares), not a raw sample-to-sample delta.
//
// The old behaviour was broken in both directions at once:
//   - a genuine +10 ppm/day gassing trend on a 1-minute sampler NEVER fired,
//     because no consecutive delta ever reached 10;
//   - a single 10 ppm step between two 1-minute samples (= 14,400 ppm/day)
//     DID fire, treating a per-sample delta as if it were a per-day rate.
//
// Driven through the REAL generated Node-RED evaluate() extracted from the
// built flow, so this breaks if the deployed engine's behaviour changes.
//
// Run from the repo root: node e2e/proofs/test-rate-of-rise.mjs
import fs from 'node:fs';

const flows = JSON.parse(fs.readFileSync('backend/node-red/flows.nodered-backend.json', 'utf8'));
const initNode = flows.find((f) => f.type === 'function' && f.name === 'init pool + engine + guard');
if (!initNode) { console.error('FAIL could not find the init node — regenerate the flow first'); process.exit(1); }

// evaluate/breaches/cleared/rateWindowMs/mk all live inside the init node's
// body. Pull just those declarations out and eval them in isolation rather
// than running the whole init (which wants mysql, jwt, a live pool...).
const body = initNode.func;
const start = body.indexOf('function breaches(');
const endMark = "global.set('evaluate', evaluate);";
const end = body.indexOf(endMark);
if (start < 0 || end < 0) { console.error('FAIL could not locate the evaluate block inside init'); process.exit(1); }
const engineSrc = body.slice(start, end);
const evaluate = new Function(`${engineSrc}\nreturn evaluate;`)();

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

const MIN = 60_000;
const rule = (unit, warn) => ({
  domain: 'transformer', dwellMin: 999, hysteresis: 2, // dwell high so ONLY rate events appear
  params: [{ key: 'hydrogen', label: 'H2', unit: 'ppm', direction: 'high', warn: 1e9, critical: 1e9, rate: { unit, warn } }],
});
const rateEvents = (readings, r) => evaluate('TR-1', r, readings, {}).filter((e) => e.kind === 'rate');

// ---- A. a genuine +10 ppm/day trend, sampled once a minute for 3 days ----
{
  const readings = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i <= 3 * 1440; i++) {
    readings.push({ time: '', ts: t0 + i * MIN, values: { hydrogen: 100 + (10 / 1440) * i } });
  }
  const ev = rateEvents(readings, rule('ppm/day', 10));
  t('a real +10 ppm/day trend fires the 10 ppm/day alarm', ev.length > 0, `${ev.length} rate event(s)`);
}

// ---- B. a slower +4 ppm/day trend must NOT fire a 10 ppm/day alarm ----
{
  const readings = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i <= 3 * 1440; i++) {
    readings.push({ time: '', ts: t0 + i * MIN, values: { hydrogen: 100 + (4 / 1440) * i } });
  }
  const ev = rateEvents(readings, rule('ppm/day', 10));
  t('a +4 ppm/day trend does NOT fire a 10 ppm/day alarm', ev.length === 0, `${ev.length} rate event(s)`);
}

// ---- C. one 10 ppm step in 60s is not a per-day rate — and must not be
//         reported as one just because the raw delta happens to equal 10 ----
{
  const t0 = Date.UTC(2026, 0, 1);
  const readings = [
    { time: '', ts: t0, values: { hydrogen: 100 } },
    { time: '', ts: t0 + MIN, values: { hydrogen: 110 } },
    { time: '', ts: t0 + 2 * MIN, values: { hydrogen: 110 } },
  ];
  const ev = rateEvents(readings, rule('ppm/day', 10));
  t('a 10 ppm step across 60s does not fire on the raw delta alone', ev.length === 0,
    `${ev.length} rate event(s) — the samples are 1 min apart, far below the 1 h minimum for a /day rate`);
}

// ---- D. thermal: °C/h base is read from the unit, independently of /day ----
{
  const t0 = Date.UTC(2026, 0, 1);
  const readings = [];
  // +6 °C/h for 2 hours, sampled every minute.
  for (let i = 0; i <= 120; i++) readings.push({ time: '', ts: t0 + i * MIN, values: { hydrogen: 50 + (6 / 60) * i } });
  const hot = rateEvents(readings, rule('°C/h', 3));
  const cold = rateEvents(readings, rule('°C/h', 12));
  t('+6 °C/h fires a 3 °C/h alarm', hot.length > 0, `${hot.length} event(s)`);
  t('+6 °C/h does NOT fire a 12 °C/h alarm', cold.length === 0, `${cold.length} event(s)`);
}

// ---- E. an uninterpretable unit disables the rate check rather than
//         silently falling back to the old per-sample comparison ----
{
  const t0 = Date.UTC(2026, 0, 1);
  const readings = [
    { time: '', ts: t0, values: { hydrogen: 100 } },
    { time: '', ts: t0 + 2 * 3600_000, values: { hydrogen: 100000 } }, // enormous rise
  ];
  const ev = rateEvents(readings, rule('ppm', 10)); // no denominator at all
  t('a unit with no time base skips the rate check', ev.length === 0, `${ev.length} event(s)`);
}

// ---- F. equal timestamps must not divide by zero into a phantom alarm ----
{
  const t0 = Date.UTC(2026, 0, 1);
  const readings = [
    { time: '', ts: t0, values: { hydrogen: 100 } },
    { time: '', ts: t0, values: { hydrogen: 900 } }, // same ms
  ];
  const ev = rateEvents(readings, rule('ppm/day', 10));
  t('duplicate timestamps do not produce an Infinity rate', ev.length === 0, `${ev.length} event(s)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
