// Static analysis over every Node-RED handler body in the generated flows.
//
// WHY THIS EXISTS
// ---------------
// Handler bodies live inside the generator as TEMPLATE STRINGS. That means no
// linter, no type checker and no editor ever looks at them: `npx eslint` sees a
// string literal, `tsc` sees nothing at all. They are the only code in this
// repo with zero static analysis, and they are also where alarm DELIVERY lives.
//
// That gap has already cost us once. A commit adding the 'webhook' channel
// deleted the `await fetch(...)` line out of notify's 'telegram' branch,
// leaving it computing `tok` and `chat` and then doing nothing with them.
// Org-level Telegram alarms stopped sending. No error, no exception, no failing
// test — the branch still ran, it just no longer did anything. The only visible
// trace was two variables that were assigned and never read, which is exactly
// what `no-unused-vars` reports and exactly what nothing was running.
//
// So: parse every handler body and fail on that signature. An unused variable
// in a handler is not a style nit here — it is the fingerprint of a statement
// that used to consume it and no longer exists.
//
// Run from the repo root: node backend/node-red/handler-deadcode.test.mjs

import { readFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(new URL('../../frontend-next/', import.meta.url))
let Linter
try {
  ({ Linter } = require('eslint'))
} catch {
  console.log('SKIP — eslint not installed (run npm ci in frontend-next first)')
  process.exit(0)
}

const flows = JSON.parse(readFileSync(new URL('./flows.nodered-backend.json', import.meta.url), 'utf8'))
const linter = new Linter()

// Node-RED injects these into every function node: the runtime objects, plus
// the packages declared as functionGlobalContext / functionExternalModules.
// They are real at runtime and undefined to a parser, so they are declared
// rather than reported — no-undef still has to catch a genuine typo.
const GLOBALS = {}
for (const g of [
  'msg', 'node', 'global', 'flow', 'context', 'env', 'RED',
  'mysql', 'jwt', 'bcrypt', 'CryptoJS', 'nodemailer', 'fetch', 'FormData',
  'Buffer', 'require', 'console', 'process',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'crypto',
  'AbortController', 'AbortSignal', 'Blob',
]) GLOBALS[g] = 'readonly'

const RULES = {
  // The signature that matters — see the header.
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
  // A typo'd identifier in a template string is otherwise a runtime-only
  // discovery, on whichever alarm happens to hit that branch first.
  'no-undef': 'error',
  // Each of these is silent at runtime and means something was half-removed.
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-self-assign': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': 'error',
  'no-unsafe-negation': 'error',
  'no-sparse-arrays': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
}

let scanned = 0
const findings = []
for (const n of flows) {
  if (typeof n.func !== 'string' || !n.func.trim()) continue
  scanned++
  // A handler body is a function body, not a program: `return` at top level is
  // legal there and a syntax error anywhere else, so wrap before parsing.
  const msgs = linter.verify(`async function __handler(){\n${n.func}\n}`, {
    parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
    env: { es2022: true },
    globals: GLOBALS,
    rules: RULES,
  })
  for (const m of msgs) findings.push({ id: n.id, name: n.name || '', m })
}

console.log(`scanned ${scanned} Node-RED handler bodies\n`)

if (!findings.length) {
  console.log(`PASS — no dead or unreachable code in any handler`)
  console.log(`\n1 passed, 0 failed`)
  process.exit(0)
}

for (const f of findings) {
  console.log(`FAIL — ${f.id}${f.name ? ' (' + f.name + ')' : ''}`)
  console.log(`    [${f.m.ruleId || 'PARSE'}] line ${f.m.line}: ${f.m.message}`)
}
console.log(`
An unused variable here usually means the statement that consumed it was
deleted. Check the surrounding branch still performs its send/query/write
before dismissing this as a style warning — that is precisely how org-level
Telegram delivery was lost.`)
console.log(`\n0 passed, ${findings.length} failed`)
process.exit(1)
