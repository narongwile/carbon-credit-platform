import fs from 'node:fs';
// Strip comments first: the fix deliberately DOCUMENTS the removed constants,
// so a raw substring search matches its own explanation and reports a false
// positive. Only executable code is evidence here.
const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = decomment(fs.readFileSync('frontend-next/src/lib/iiotReportGenerator.ts', 'utf8'));
const adm = decomment(fs.readFileSync('frontend-next/src/app/admin/reports/page.tsx', 'utf8'));
const cus = decomment(fs.readFileSync('frontend-next/src/app/customer/reports/page.tsx', 'utf8'));
let pass = 0, fail = 0;
const t = (name, ok, detail='') => { console.log(`${ok?'PASS':'FAIL'} ${name}${detail?'  '+detail:''}`); ok?pass++:fail++; };

// The exact fabricated constants that used to be printed as measurements.
//
// Matched on a NUMBER boundary, not as a bare substring. '65.2' as a substring
// also matches inside '365.25' — the days-per-year term in the RUL conversion
// `remainingHours / (365.25 * 24)` — so this reported a fabricated measurement
// against a correct astronomical constant. A false positive here is expensive:
// it costs the next reader the time to disprove it, and it teaches them to
// distrust the gate.
const GHOSTS = ['42.5','65.2','84.1','72.8','91.4','228.4','231.5','234.8','92.4°C','90.0°C','Duty Engineer','Substation 1'];
for (const g of GHOSTS) {
  const numeric = /^[\d.]+$/.test(g);
  const re = numeric
    ? new RegExp(`(?<![\\d.])${g.replace(/\./g, '\\.')}(?![\\d.])`)
    : new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  t(`no fabricated value ${JSON.stringify(g)}`, !re.test(src));
}

t('no alarm-count floors (|| 2 / || 1)', !/alarms\.length \|\| 2|\|\| 1\b/.test(src));
t('no hardcoded MTTR of 35', !/mttrMinutes = 35/.test(src));
t('no invented energy (assets x days x 1250)', !src.includes('1250'));
t('no compliance floor Math.max(85', !src.includes('Math.max(85'));
t('no universal max<95 compliance rule', !src.includes('Number(r.max) < 95'));
t('alarms come from the real endpoint', src.includes('api.orgAlarms('));
t('compliance judged via paramStatus + real limits', src.includes('paramStatus(') && src.includes('ALARM_SCHEMA'));
t('MTTR derived from cleared alarms', src.includes('closed.length'));

// KPI cards must not resurrect the fabricated fallbacks.
for (const [n, s] of [['admin', adm], ['customer', cus]]) {
  t(`${n} KPI: no ?? 98 health fallback`, !s.includes('healthIndexAvg ?? 98'));
  t(`${n} KPI: no ?? 99.2 compliance fallback`, !s.includes('complianceRate ?? 99.2'));
  t(`${n} KPI: no ?? 37500 energy fallback`, !s.includes('37500'));
  t(`${n} KPI: no ?? 18.74 carbon fallback`, !s.includes('18.74'));
  t(`${n} KPI: routes through na()`, s.includes('na(metrics?.'));
}
t('admin: no ?? 35 MTTR fallback', !adm.includes('mttrMinutes ?? 35'));
t('no "certified" claim left in generator footer', !/certified by/.test(src));

// ---------------------------------------------------------------------------
// Advertised analyses that do not exist in the codebase.
//
// The reports page used to sell Duval triangle risk, a winding hot-spot
// calculation, an insulation thermal aging factor and IEEE 519 harmonic
// analysis, alongside badges asserting IEEE C57.104 / IEC 60076 / HACCP /
// FDA 21 CFR compliance — while iiotReportGenerator.ts's own header
// explicitly disclaims implementing or certifying against every one of them.
// grep the generator for any of these and there is nothing to find.
//
// This is checked on the UI copy, not the generator: the lie was never in the
// maths, it was in what the screen promised the maths would do.
// ---------------------------------------------------------------------------
// Still unimplemented — grep the generator and there is nothing to find, so
// the UI must not name them at all.
const PHANTOM_ANALYSES = [
  ['thermal aging factor', /aging factor/i],
  ['IEEE 519 harmonic analysis', /IEEE ?519/i],
  ['IEC 60076 conformance', /IEC ?60076/i],
  ['FDA 21 CFR conformance', /21 ?CFR/i],
];
for (const [label, re] of PHANTOM_ANALYSES) {
  t(`admin reports page does not advertise ${label}`, !re.test(adm));
  t(`customer reports page does not advertise ${label}`, !re.test(cus));
}

// Duval Triangle 1 and the C57.91 aging model USED to be in the list above.
// 2189cf43 actually implemented them, so naming the method is now truthful and
// the old assertion was pinning the UI to a stale fact.
//
// The permission is tied to the implementation rather than simply granted: the
// UI may name one of these only while the generator still contains the
// function that computes it. Delete the maths and the advertisement becomes a
// phantom again, and this fails.
const BACKED_ANALYSES = [
  ['Duval Triangle 1', /duval/i, /function diagnoseDuvalTriangle1\s*\(/],
  ['IEEE C57.91 paper aging', /C57\.?91/i, /arrhenius/i],
];
for (const [label, uiRe, implRe] of BACKED_ANALYSES) {
  const advertised = uiRe.test(adm) || uiRe.test(cus);
  t(`${label} is implemented in the generator if the UI names it`,
    !advertised || implRe.test(src),
    advertised ? 'the UI advertises it — the generator must compute it' : 'not advertised');
}

// A DGA verdict must never be produced for an asset with no gas sensors. The
// studios had exactly this problem: catalogue constants substituted for
// missing channels, rendered indistinguishably from measurements, then turned
// into an engineering verdict.
t('the DGA verdict is gated on the asset actually reporting gases',
  /hasDGA \? diagnoseDuvalTriangle1\([^)]*\) : '/.test(src),
  'without the guard, a transformer with no DGA sensor gets an invented fault type');

// ---------------------------------------------------------------------------
// Implementing a published formula is not conformance to the standard that
// publishes it, and it is certainly not certification. This distinction is the
// whole point: the maths may be named, the accreditation may not.
//
// The exported artifact header carried
//   "# Audit Engine: ONEOPS Certified Ingestion Engine v2.0
//    (ISO 50001 / IEEE C57.104 / GHG Protocol)"
// — printed into a document an auditor may read. Nothing there is certified by
// anyone, ISO 50001 appeared nowhere else in the file, and the module's own
// header disclaims the GHG Protocol.
// ---------------------------------------------------------------------------
t('no artifact claims to be a CERTIFIED engine',
  !/Certified Ingestion Engine/i.test(src));
t('no artifact claims ISO 50001, which is implemented nowhere',
  !/50001/.test(src));
t('the exported header states that no conformance is asserted',
  /Conformance: none asserted/.test(src));

// The generator genuinely implements these two published formulae, so the UI
// is allowed to name them — this asserts the honest copy stayed, guarding the
// opposite failure (over-correcting into claiming nothing at all).
t('MKT is still implemented in the generator', /function calculateMKT/.test(src));
t('admin reports page still credits MKT to USP', /MKT/.test(adm) && /USP/i.test(adm));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
