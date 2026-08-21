// Exact algorithm copied out of ChartAnalysisModal's correlations memo.
function pearson(xs, ys) {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let t = 0; t < n; t++) { mx += xs[t]; my += ys[t]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let t = 0; t < n; t++) {
    const dx = xs[t] - mx, dy = ys[t] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
const near = (a, b, tol = 1e-9) => a !== null && Math.abs(a - b) < tol;
let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = want === null ? got === null : near(got, want, 1e-6);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}  got=${got === null ? 'null' : got.toFixed(6)} want=${want === null ? 'null' : want}`);
  ok ? pass++ : fail++;
};

const x = [1, 2, 3, 4, 5];
t('perfect positive (y=2x+3)', pearson(x, x.map(v => 2 * v + 3)), 1);
t('perfect negative (y=-3x+10)', pearson(x, x.map(v => -3 * v + 10)), -1);
t('flat y -> null (undefined, not 0)', pearson(x, [7, 7, 7, 7, 7]), null);
t('flat x -> null', pearson([2, 2, 2, 2, 2], x), null);

// Textbook dataset with an independently known r.
const a = [43, 21, 25, 42, 57, 59];
const b = [99, 65, 79, 75, 87, 81];
t('textbook r=0.5298', pearson(a, b), 0.529809);

// Scale/offset invariance — the claim in the code comment that r is identical
// in normalize mode (min-max rescale is a positive linear transform).
const raw1 = [200, 450, 900, 610, 305, 780];
const raw2 = [31.2, 44.8, 79.1, 60.3, 35.5, 70.2];
const norm = (arr) => { const lo = Math.min(...arr), hi = Math.max(...arr); return arr.map(v => ((v - lo) / (hi - lo)) * 100); };
const rRaw = pearson(raw1, raw2);
const rNorm = pearson(norm(raw1), norm(raw2));
t('normalize-mode invariance', rNorm, rRaw);

// Symmetry
t('r(x,y) == r(y,x)', pearson(raw2, raw1), rRaw);

// Bound check on random data
let worst = 0;
for (let i = 0; i < 5000; i++) {
  const n = 5 + Math.floor(Math.random() * 20);
  const p = Array.from({ length: n }, () => Math.random() * 1000);
  const q = Array.from({ length: n }, () => Math.random() * 1000);
  const r = pearson(p, q);
  if (r !== null) worst = Math.max(worst, Math.abs(r));
}
console.log(`${worst <= 1 + 1e-12 ? 'PASS' : 'FAIL'} |r| never exceeds 1 over 5000 random samples (max |r| seen = ${worst.toFixed(6)})`);
worst <= 1 + 1e-12 ? pass++ : fail++;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
