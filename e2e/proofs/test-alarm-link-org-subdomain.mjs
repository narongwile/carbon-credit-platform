// Proves the "Open device" deep link in every alarm channel (email, LINE,
// Telegram, Google Chat) resolves to the org's real workspace host, in BOTH
// deployment environments.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// __buildBaseUrl rewrote the base host by REPLACING its first label whenever
// the hostname had >= 4 labels:
//
//     if (hostParts.length >= 4 && ...) { hostParts[0] = sub }
//
// That heuristic assumes label 0 is a replaceable subdomain, as in
// app.example.co.uk. It is wrong for the UAT host:
//
//     iiotplatform.27.254.143.144.nip.io   ->  7 labels, because the IP octets count
//
// so it overwrote 'iiotplatform' itself and produced
// https://<x>.27.254.143.144.nip.io — which matches NO ingress rule
// (frontend-next.yaml serves only `iiotplatform.<base>` and
// `*.iiotplatform.<base>`). Every Open-device link in every UAT alarm was dead.
//
// Second, independent bug in the same function: it stripped the "org-" prefix
// and aliased org-1 to 'eternity'. 'eternity' is a PRODUCT id (entitlements
// maps eternityTransformers -> 'eternity'), never an organization, and
// lib/orgResolver.getOrgFromLocation() reads the first label straight back out
// as the orgId. So even on production the link named a tenant that does not
// exist, and org-2 became the bare label "2".
//
// org-eternity is a REAL organization, seeded by migrate-v48.sql. That makes
// the old aliasing concretely worse than "names a tenant that does not exist":
//
//   org-eternity -> sub = 'eternity'   (the "org-" prefix stripped)
//   org-1        -> sub = 'eternity'   (the `sub === '1'` special case)
//
// Both produced https://eternity.iiotplatform...  — and guard() compares the
// :orgId path param to claims.orgId with STRICT equality, so 'eternity' never
// matches 'org-eternity'. The link opened a page that immediately 403'd
// "outside your organization" on the recipient's OWN org. For org-1 it also
// pointed at a subdomain named after a DIFFERENT real tenant (no data leak —
// guard still refuses — but the wrong company's address).
//
// Only three handlers (the logo endpoint and two org-move paths) do the
// `startsWith('org-') ? clean : 'org-'+clean` fallback; general auth does not.
//
// The contract is lib/orgResolver.getOrgWorkspaceUrl(): orgId VERBATIM,
// prepended to the iiotplatform root. Asserted here against both hosts.
//
// Run from the repo root: node e2e/proofs/test-alarm-link-org-subdomain.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const flows = JSON.parse(readFileSync(new URL('../../backend/node-red/flows.nodered-backend.json', import.meta.url), 'utf8'))

// Pull the real builder out of each delivery path so this tests the shipped
// code, not a re-implementation.
const paths = [
  ['notify (org/department)', 'notify', /const __buildBaseUrl = \(orgId\) => \{[\s\S]*?\n\};/],
  ['notifypersonal', 'notifypersonal', /const __buildPersonalBaseUrl = \(orgId\) => \{[\s\S]*?\n\};/],
]

const ENVS = [
  ['UAT  (nip.io)', 'https://iiotplatform.27.254.143.144.nip.io:30443', 'iiotplatform.27.254.143.144.nip.io'],
  ['PROD (custom)', 'https://iiotplatform.thermexpertise.com', 'iiotplatform.thermexpertise.com'],
]

for (const [label, nodeId, re] of paths) {
  const node = flows.find((n) => n.id === nodeId)
  if (!node) { t(`${label}: node present`, false, `no node id=${nodeId}`); continue }
  const m = node.func.match(re)
  if (!m) { t(`${label}: builder found`, false, 'builder not found in handler'); continue }

  for (const [envLabel, base, rootHost] of ENVS) {
    const env = { get: (k) => (k === 'APP_BASE_URL' ? base : undefined) }
    const fnName = m[0].slice(6, m[0].indexOf(' =', 6))
    const build = new Function('env', `${m[0]}; return ${fnName};`)(env)

    for (const org of ['org-eternity', 'org-1', 'org-2', 'kmutt']) {
      const url = build(org)
      const host = new URL(url).hostname

      t(`${label} · ${envLabel} · ${org}: host is <orgId>.${rootHost}`,
        host === `${org}.${rootHost}`, `got ${host}`)

      // The two specific regressions, asserted directly.
      t(`${label} · ${envLabel} · ${org}: keeps the iiotplatform root the ingress serves`,
        host.includes('.iiotplatform.'), `got ${host}`)
      t(`${label} · ${envLabel} · ${org}: uses the orgId verbatim, not a product alias`,
        host.startsWith(`${org}.`) && !host.startsWith('eternity.'), `got ${host}`)
    }

    // Re-running against a host that ALREADY carries an org label must not
    // stack labels (org-2.org-1.iiotplatform...).
    const already = { get: (k) => (k === 'APP_BASE_URL' ? `https://org-1.${rootHost}` : undefined) }
    const b2 = new Function('env', `${m[0]}; return ${m[0].slice(6, m[0].indexOf(' =', 6))};`)(already)
    t(`${label} · ${envLabel}: an existing org label is replaced, not stacked`,
      new URL(b2('org-2')).hostname === `org-2.${rootHost}`,
      `got ${new URL(b2('org-2')).hostname}`)
  }
}

// ── The "Test send" preview link ──────────────────────────────────────────
// admin/settings' channel test is how an admin verifies email/LINE/Telegram/
// Google Chat delivery actually works. Its sample payload built the link from
// mc.frontendUrl — the platform-wide FRONTEND_URL, with NO org label — so the
// one button whose entire job is "prove the notification looks right" sent a
// link that did not match what a real alarm produces. Testing the channel
// could not test the link.
{
  const node = flows.find((n) => n.id === 'emailtpltest_fn')
  if (!node) {
    t('emailtpltest handler present', false)
  } else {
    const m = node.func.match(/link: \(function\(\)\{[\s\S]*?\}\)\(\),/)
    if (!m) {
      t('test-send builds its link with the org-scoped host', false, 'link builder not found')
    } else {
      const body = m[0].replace(/^link: /, '').replace(/,$/, '')
      for (const [envLabel, base, rootHost] of ENVS) {
        for (const org of ['org-eternity', 'org-2']) {
          const env = { get: (k) => (k === 'APP_BASE_URL' ? base : undefined) }
          const out = new Function('env', 'mc', 'orgId', `return (${body})`)(env, { frontendUrl: base }, org)
          t(`test-send · ${envLabel} · ${org}: link uses the org's own host`,
            new URL(out).hostname === `${org}.${rootHost}`, `got ${out}`)
        }
      }
    }
  }
}

// ── Every base-URL builder in the flow, not just the ones named above ─────
// The three checks above name their subject nodes explicitly. That is how the
// bug came back: commit f83c4a64 added POST /api/nodes/:id/personal-rule/test
// with a FOURTH, private copy of the builder carrying the original pre-fix
// logic (strip 'org-', alias org-1 -> 'eternity', replace hostParts[0] when the
// host has >= 4 labels). All 56 assertions above still passed, because that
// handler was not on the list.
//
// So this section discovers the builders instead of naming them: it walks every
// handler body, extracts anything shaped like a base-URL builder by brace
// matching, and runs the SAME contract against each. A fifth copy is covered
// the moment it is written.
{
  // Pull `const <name> = (arg) => { ... }` out of a body by matching braces,
  // so indentation and spacing style don't matter.
  const extract = (src) => {
    const out = []
    const re = /const\s+(__build\w*BaseUrl)\s*=\s*\(\s*(\w+)\s*\)\s*=>\s*\{/g
    let m
    while ((m = re.exec(src))) {
      let depth = 1
      let i = re.lastIndex
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
      }
      if (depth === 0) out.push([m[1], src.slice(m.index, i)])
    }
    return out
  }

  const found = []
  for (const n of flows) {
    if (typeof n.func !== 'string') continue
    for (const [name, body] of extract(n.func)) found.push([n.id, name, body])
  }

  // If this drops to the count at the time of writing without a deliberate
  // change, a delivery path lost its org scoping rather than gained one.
  t(`discovered every base-URL builder in the flow`, found.length >= 3,
    `${found.length} builder(s): ${found.map(([id, nm]) => `${id}/${nm}`).join(', ')}`)

  for (const [nodeId, name, body] of found) {
    for (const [envLabel, base, rootHost] of ENVS) {
      const env = { get: (k) => (k === 'APP_BASE_URL' ? base : undefined) }
      let build
      try {
        build = new Function('env', `${body}; return ${name};`)(env)
      } catch (err) {
        t(`${nodeId}/${name}: builder is evaluable`, false, err.message)
        continue
      }
      for (const org of ['org-eternity', 'org-1', 'org-2']) {
        const host = new URL(build(org)).hostname
        t(`${nodeId}/${name} · ${envLabel} · ${org}: host is <orgId>.${rootHost}`,
          host === `${org}.${rootHost}`, `got ${host}`)
      }
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
