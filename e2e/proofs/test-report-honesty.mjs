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
const GHOSTS = ['42.5','65.2','84.1','72.8','91.4','228.4','231.5','234.8','92.4°C','90.0°C','Duty Engineer','Substation 1'];
for (const g of GHOSTS) t(`no fabricated value ${JSON.stringify(g)}`, !src.includes(g));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
