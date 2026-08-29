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

    for (const org of ['org-1', 'org-2', 'kmutt']) {
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
