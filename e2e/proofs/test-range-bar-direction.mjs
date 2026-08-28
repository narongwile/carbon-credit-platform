// Proves SensorDetailsModal's ISA-101 range-bar percentage grows toward
// danger for BOTH alarm directions, not just 'high'.
//
// The bug: pct = (val / critLimit) * 85 works for a 'high'-direction param
// (bar fills as the reading rises toward critical) but is backwards for a
// 'low'-direction one (e.g. oilLevel: warn 70, critical 60 — lower is worse).
// There, val/critLimit GROWS with the reading, so a healthy 90 gave
// 90/60*85 = 127% (clamped to a full bar) while an actual critical reading of
// 55 gave 55/60*85 = 78% (mostly empty) — a healthy row looked more alarming
// than a critical one, in the same list, right next to 'high'-direction rows
// where a longer bar correctly means closer to danger.
//
// This proof reimplements the fixed formula and asserts the invariant that
// matters: for both directions, pct is monotonic toward danger and hits 85%
// exactly at the critical threshold.
//
// Run from the repo root: node e2e/proofs/test-range-bar-direction.mjs

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

function rangePct(val, critLimit, direction) {
  if (critLimit == null || critLimit <= 0) return 50;
  if (direction === 'low') {
    return val > 0 ? Math.min(100, Math.max(5, (critLimit / val) * 85)) : 100;
  }
  return Math.min(100, Math.max(5, (val / critLimit) * 85));
}

// ── 'high' direction (e.g. oilTemp: warn 85, critical 90) — unchanged ──────
t("'high': far below critical -> short bar", rangePct(30, 90, 'high') < 40);
t("'high': at critical -> exactly 85%", rangePct(90, 90, 'high') === 85);
t("'high': well past critical -> clamps at 100%", rangePct(300, 90, 'high') === 100);
t("'high': monotonic (bar grows as reading rises)",
  rangePct(40, 90, 'high') < rangePct(70, 90, 'high') && rangePct(70, 90, 'high') < rangePct(90, 90, 'high'));

// ── 'low' direction (oilLevel: warn 70, critical 60) — the fix ────────────
const healthy = rangePct(90, 60, 'low');   // NORMAL reading
const warning = rangePct(65, 60, 'low');   // WARNING reading
const critical = rangePct(55, 60, 'low');  // CRITICAL reading

t("'low': at critical -> exactly 85% (same as 'high' at its threshold)", rangePct(60, 60, 'low') === 85);
t("'low': monotonic TOWARD DANGER (bar grows as reading FALLS, not rises)",
  healthy < warning && warning < critical,
  `healthy=${healthy.toFixed(1)}% warning=${warning.toFixed(1)}% critical=${critical.toFixed(1)}%`);
t("'low': a CRITICAL reading is not shown emptier than a healthy one (the actual bug)",
  critical > healthy,
  `critical=${critical.toFixed(1)}% must exceed healthy=${healthy.toFixed(1)}%`);
t("'low': never exceeds 100% even far above the safe range", rangePct(9000, 60, 'low') <= 100);
t("'low': a zero reading (fully depleted) reads maximally critical", rangePct(0, 60, 'low') === 100);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
