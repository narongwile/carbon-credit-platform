// Fails when a NEW "assigned a value but never used" appears in the frontend.
//
// WHY THIS EXISTS
// ---------------
// The frontend has no unused-variable detection at all. `.eslintrc.json`
// extends only `next/core-web-vitals`, which does not enable
// no-unused-vars for TypeScript — verified by dropping a file containing
// `const neverUsed = 42` into src/ and watching `next lint` report nothing.
//
// That is the same blind spot that hid the org-level Telegram regression in
// the Node-RED handler strings: a value computed and then never consumed is
// the fingerprint left behind when the statement that used it gets deleted.
// backend/node-red/handler-deadcode.test.mjs closes that gap for the flow;
// this closes it for the app, where the same class has already produced real
// bugs found by hand in this range:
//
//   * admin/reports called useRouter() and never used the result, so
//     ?siteId=/&domain= deep links worked in one direction only;
//   * AlarmParamConfig implemented toggleAll() — including its toast — and
//     never gave it a control, so "enable/disable every parameter" existed in
//     the code and was unreachable in an editor with up to 80 rows.
//
// BASELINE, NOT ZERO
// ------------------
// 29 occurrences remain, mostly frozen useState in the PdM studios whose
// setters are never called (constants wearing a state hook). Fixing those is
// a product decision about those panels, not a mechanical cleanup, so this
// gate records them and fails only on additions. Removing one is always safe:
// the baseline is a ceiling, never a requirement.
//
// Run from the repo root: node e2e/proofs/test-frontend-deadcode.mjs

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const FE = new URL('../../frontend-next/', import.meta.url).pathname
const BASELINE = new URL('./frontend-deadcode-baseline.json', import.meta.url).pathname

const RULE = JSON.stringify({
  '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
})

let raw
try {
  raw = execSync(
    `npx eslint --no-eslintrc --parser @typescript-eslint/parser ` +
    `--parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} ` +
    `--plugin @typescript-eslint --rule '${RULE}' --ext .ts,.tsx src --format unix`,
    { cwd: FE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }
  )
} catch (e) {
  // eslint exits non-zero when it reports anything — that is the normal path.
  raw = (e.stdout || '') + (e.stderr || '')
  if (!raw.includes('no-unused-vars') && !raw.trim()) {
    console.log('SKIP — could not run eslint (dependencies not installed?)')
    process.exit(0)
  }
}

// Only "assigned a value but never used" — an unused IMPORT is tidiness, an
// unused computed value is the signature this gate is about.
const found = new Set()
for (const line of raw.split('\n')) {
  const m = line.match(/^(.*?):\d+:\d+:\s+'([^']+)' is assigned a value but never used/)
  if (!m) continue
  const file = m[1].replace(/^.*?\/frontend-next\//, '')
  found.add(`${file} :: ${m[2]}`)
}

const current = [...found].sort()

if (process.env.UPDATE_DEADCODE_BASELINE === '1') {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
  console.log(`baseline written: ${current.length} entries`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log('FAIL — no baseline file; regenerate with UPDATE_DEADCODE_BASELINE=1')
  process.exit(1)
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')))
const added = current.filter((x) => !baseline.has(x))
const fixed = [...baseline].filter((x) => !found.has(x))

console.log(`baseline ${baseline.size} · current ${current.length} · new ${added.length} · cleared ${fixed.length}\n`)

if (fixed.length) {
  console.log('Cleared since the baseline (thank you — shrink the baseline when convenient):')
  for (const f of fixed) console.log('  - ' + f)
  console.log()
}

if (added.length) {
  console.log('FAIL — new computed-but-unused value(s):\n')
  for (const a of added) console.log('  ✗ ' + a)
  console.log(`
A value assigned and never read usually means the statement that consumed it
was removed. Check the surrounding code still performs its send/write/render
before dismissing this as tidiness — that is exactly how org-level Telegram
delivery was lost, and how admin/reports' deep links and AlarmParamConfig's
enable-all control were found dead.

If the variable is deliberately unused, prefix it with _.`)
  process.exit(1)
}

console.log('PASS — no new computed-but-unused values in the frontend')
console.log('\n1 passed, 0 failed')
process.exit(0)
