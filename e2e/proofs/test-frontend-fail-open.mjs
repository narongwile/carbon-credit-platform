// Two "filter the UI by what the org owns" features that failed CLOSED on
// missing data, and one live-presence overlay that was fetched and discarded.
//
// 1. admin/reports (6a45f448) filtered its Product Domain pickers by
//    api.entitlements(orgId). That endpoint is a bare
//        SELECT platform FROM org_entitlements WHERE org_id=?
//    with no default, so an organization that simply has no rows yet — a newly
//    created one, or one whose admin has not set entitlements — returns [].
//    Filtering on that rendered ZERO chips in both the On-Demand studio and the
//    Automated Sequence modal ('all' included, since it shows only when
//    length > 1): an unusable report builder with nothing explaining why.
//    Absence of a licensing record is not a licensing decision, and these
//    chips are UX rather than access control — iiotReportGenerator runs
//    client-side over data the user can already read — so failing closed buys
//    no safety and costs a broken page.
//
// 2. admin/fleet (b5be4971) called useFleetLive(orgId) and never read the
//    result. useFleetHosts fetches ONCE per [live, orgId] with no poll and no
//    telemetry subscription, so every row's online/offline icon was frozen at
//    page load — a device that dropped while the admin watched stayed green —
//    while the discarded useFleetLive poll ran api.fleet every 5s regardless.
//
// Run from the repo root: node e2e/proofs/test-frontend-fail-open.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p) => strip(readFileSync(new URL(p, root), 'utf8'))

// ── 1. Entitlement pickers fail open ──────────────────────────────────────
{
  const src = read('frontend-next/src/app/admin/reports/page.tsx')

  t('reports derives an effective domain list with an explicit empty fallback',
    /const effectiveDomains: SensorDomain\[\] = orgDomains\.length > 0/.test(src) &&
    /'transformer', 'carbonNode', 'bloodBox', 'automobile'/.test(src))

  // Every picker must read the fallback, not the raw list.
  t('the On-Demand studio picker uses the effective list',
    /INDUSTRIAL_DOMAINS\.filter\(\(d\) => d\.id !== 'all' && effectiveDomains\.includes/.test(src))
  t('the Automated Sequence modal picker uses the effective list',
    /dm\.id === 'all' \? effectiveDomains\.length > 1 : effectiveDomains\.includes/.test(src))

  t('no picker filters on the raw entitlement list any more',
    !/orgDomains\.includes\(d\.id as SensorDomain\)/.test(src) &&
    !/orgDomains\.includes\(dm\.id as SensorDomain\)/.test(src),
    'an org with no org_entitlements row would see zero chips')

  // The single-domain default must follow the same list, or an unlicensed org
  // gets `domain: undefined` where the others get a concrete value.
  t('the report draft default uses the effective list',
    /effectiveDomains\.length === 1 \? effectiveDomains\[0\] : 'all'/.test(src))
}

// ── 2. The fleet list's presence is live ──────────────────────────────────
{
  const src = read('frontend-next/src/app/admin/fleet/page.tsx')

  t('admin/fleet actually reads the live fleet map it subscribes to',
    /const liveNode = liveNodes\.get\(h\.id\)/.test(src),
    'the hook was called and its 5s poll discarded')
  t('each row derives its status from the live row, falling back to the one-shot fetch',
    /statusFromLive\(liveNode\) === 'OFFLINE' : h\.status === 'OFFLINE'/.test(src))
  t('the row icon renders the live status, not the frozen one',
    /\{rowOffline \? <WifiOff/.test(src) && !/\{h\.status === 'OFFLINE' \? <WifiOff/.test(src))
  t('statusFromLive is imported rather than reimplemented',
    /import \{ useFleetLive, statusFromLive \} from '@\/lib\/useFleetLive'/.test(src))
}

// ── 3. The convention file records the fail-open rule ─────────────────────
// AGENTS.md previously said domain selectors "must be filtered by
// licensedDomains(orgId) or org_entitlements" — which, applied literally, is
// exactly what produced the empty picker.
{
  const agents = readFileSync(new URL('AGENTS.md', root), 'utf8')
  t('AGENTS.md records that an empty entitlement list means "not restricted"',
    /EMPTY list means "not restricted"/.test(agents))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
