// Every file ArgoCD renders must be parseable YAML, and no file anywhere may
// carry git conflict markers.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// 9e445d5f committed an unresolved merge conflict into
// infra/k8s/custom-apps/base/node-red.yaml:
//
//     <<<<<<< HEAD
//             checksum/flow: "ca94f00046652cb1"
//     =======
//             checksum/flow: "ca94f00046652cb1"
//     >>>>>>> f9918bbe (feat(notifications): ...)
//
// Both sides were byte-identical — the conflict was trivial — but the markers
// made the file invalid YAML, and kustomize refuses to build a directory when
// any resource in it fails to parse. So the ENTIRE app stopped deploying:
//
//     ComparisonError: Failed to load target state: ... `kustomize build
//     .../overlays/uat` failed: MalformedYAMLError: yaml: line 24: could not
//     find expected ':' in File: node-red.yaml
//
// Nothing caught it. tsc, eslint, next build and every existing proof cover
// TypeScript, SQL and the Node-RED handler strings — none of them read the
// manifests, even though sync-nodered-flow.sh rewrites node-red.yaml on every
// single flow change. The script rewrote the checksum INSIDE the conflict
// region and reported success on a file that could not be parsed.
//
// This had already happened once before: 5cd9af8f, "fix(k8s): resolve syntax
// error in node-red.yaml for ArgoCD kustomize". Twice in the same file is a
// missing gate, not bad luck.
//
// Conflict markers are checked across the whole repo, not just k8s: the same
// paste in a .ts file is a build error, but in a .sql migration or a Node-RED
// handler string it can reach production far more quietly.
//
// Run from the repo root: node e2e/proofs/test-k8s-manifests-parse.mjs

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { load } from 'js-yaml'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'vendor', 'out'])
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) yield* walk(full)
    else yield full
  }
}

// ── 1. No conflict markers anywhere ───────────────────────────────────────
// Anchored to line start with the trailing space/newline git actually emits,
// so a file legitimately DISCUSSING the markers (this one, and the CI comment
// that explains the outage) is not itself a finding.
const MARKER = /^(?:<{7} |>{7} |={7}$)/m
const TEXT_EXT = /\.(ya?ml|ts|tsx|js|jsx|mjs|cjs|sql|go|json|sh|md)$/i

const offenders = []
for (const file of walk(ROOT)) {
  if (!TEXT_EXT.test(file)) continue
  const rel = relative(ROOT, file)
  if (rel === relative(ROOT, new URL(import.meta.url).pathname)) continue
  if (rel === '.gitlab-ci.yml') continue   // its comment quotes the markers
  let txt
  try { txt = readFileSync(file, 'utf8') } catch { continue }
  if (MARKER.test(txt)) offenders.push(rel)
}
t('no unresolved git conflict markers anywhere in the repo',
  offenders.length === 0,
  offenders.length ? offenders.join(', ') : '')

// ── 2. Every k8s manifest parses ──────────────────────────────────────────
// kustomize refuses to build a directory when ANY resource in it fails to
// parse, so one bad file takes the whole app offline — not just its own
// workload.
const manifests = [...walk(join(ROOT, 'infra', 'k8s'))].filter((f) => /\.ya?ml$/i.test(f))
t('found k8s manifests to check', manifests.length > 0, `${manifests.length} files`)

const unparseable = []
for (const file of manifests) {
  const rel = relative(ROOT, file)
  const txt = readFileSync(file, 'utf8')
  try {
    // loadAll equivalent: split on document separators the same way kustomize
    // does, so a break in ANY document is caught, not just the first.
    for (const doc of txt.split(/^---\s*$/m)) {
      if (doc.trim()) load(doc)
    }
  } catch (e) {
    unparseable.push(`${rel}: ${String(e.message).split('\n')[0]}`)
  }
}
t('every k8s manifest is valid YAML',
  unparseable.length === 0,
  unparseable.length ? '\n      ' + unparseable.join('\n      ') : `${manifests.length} parsed`)

// ── 3. The file sync-nodered-flow.sh rewrites, specifically ───────────────
// It edits node-red.yaml on every flow change and reports success without
// re-reading the result, so this file is the most likely to be silently broken.
{
  const rel = 'infra/k8s/custom-apps/base/node-red.yaml'
  const txt = readFileSync(join(ROOT, rel), 'utf8')
  let docs = 0, err = null
  try {
    for (const doc of txt.split(/^---\s*$/m)) if (doc.trim()) { load(doc); docs++ }
  } catch (e) { err = String(e.message).split('\n')[0] }
  t('node-red.yaml parses', err === null, err || `${docs} documents`)

  // The annotation the script maintains must survive as a real scalar, not be
  // buried in a conflict region where it parses as nothing.
  t('node-red.yaml carries exactly one checksum/flow annotation',
    (txt.match(/^\s*checksum\/flow:/gm) || []).length === 1,
    `${(txt.match(/^\s*checksum\/flow:/gm) || []).length} found`)
}

// ── 4. No orphan manifests in a deploy overlay ───────────────────────────
// 86a18931 re-synced infra/k8s/custom-apps/overlays/uat/mysql-migrations-configmap.yaml
// — 2,500 lines headed "SQL shipped to the mysql-auto-migrate Job" — sitting in
// the directory ArgoCD renders. But the overlay's kustomization.yaml does not
// list it, so kustomize never emits it and the cluster never sees it. Both the
// Job and the kustomization say why: the SQL now ships INSIDE the
// migrate-service image (backend/Dockerfile: COPY sql ./sql) "so schema and
// runner can never drift apart", and the 65 KB ConfigMap was removed on purpose.
//
// Nothing was broken by it — and that is the danger. A file that looks
// authoritative, is kept in sync by CI, and is applied by nothing will convince
// the next person that migrations are delivered that way. They add a
// migrate-vN.sql, update the ConfigMap, and it silently never runs.
//
// Scoped to overlays/: they are small and curated (4 manifests here), unlike
// base/, which deliberately parks legacy components (ai-agents, mosquitto,
// mqtt-bridge) that no kustomization lists.
{
  const overlays = []
  const walkDirs = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let st; try { st = statSync(full) } catch { continue }
      if (!st.isDirectory()) continue
      if (/(^|\/)overlays\/[^/]+$/.test(full.replace(/\\/g, '/'))) overlays.push(full)
      walkDirs(full)
    }
  }
  walkDirs(join(ROOT, 'infra', 'k8s'))

  t('found deploy overlays to check', overlays.length > 0, `${overlays.length}`)

  for (const dir of overlays) {
    const kPath = join(dir, 'kustomization.yaml')
    let kText
    try { kText = readFileSync(kPath, 'utf8') } catch { continue }
    const onDisk = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f) && f !== 'kustomization.yaml')
    // Substring match against the kustomization text: enough to tell "listed"
    // from "orphaned" without reimplementing kustomize's resource resolution.
    const orphans = onDisk.filter((f) => !kText.includes(f))
    t(`${relative(ROOT, dir)} has no manifest that kustomize never renders`,
      orphans.length === 0,
      orphans.length ? `orphaned: ${orphans.join(', ')} — delete it or list it in kustomization.yaml` : `${onDisk.length} manifests, all listed`)
  }
}

// ── 5. Migrations have exactly one delivery mechanism ────────────────────
// Two sources for the same SQL is the drift this repo already closed once.
{
  const cm = join(ROOT, 'infra', 'k8s', 'custom-apps', 'overlays', 'uat', 'mysql-migrations-configmap.yaml')
  let exists = true
  try { statSync(cm) } catch { exists = false }
  t('the mysql-migrations ConfigMap is not back in the deploy overlay', !exists,
    'the migrate-service image ships backend/sql; a second copy can only drift from it')

  const dockerfile = readFileSync(join(ROOT, 'backend', 'Dockerfile'), 'utf8')
  t('the migrate image still ships backend/sql beside its runner',
    /^COPY sql \.\/sql/m.test(dockerfile),
    'if this ever goes, the Job has no SQL at all')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
