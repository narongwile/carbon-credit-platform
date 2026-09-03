// A maintenance shelf on screen must correspond to a real shelf.
//
// THE BUG THIS LOCKS OUT
// ----------------------
// Two places asserted that alarm suppression was in effect when it was not.
//
// 1. admin/notifications seeded its shelving list with a hardcoded entry —
//    "Main Substation TR-02 / TRF-SUBSTATION-02, oilTemp, WO-8491 Bushing
//    replacement & oil degassing, shelved by Somchai (Lead Electrical
//    Engineer)" — and the loader only replaced it when the server returned a
//    NON-EMPTY list:
//
//        if (res?.shelves && res.shelves.length > 0) setShelvedDevices(res.shelves)
//
//    An organization with no shelves — every organization until someone shelves
//    something — therefore kept that entry on screen permanently. The panel's
//    own empty state ("No active alarm shelving. All N fleet assets are
//    operating with full alarm monitoring active.") was unreachable.
//
// 2. CustomerAlarmsView rendered a fully hardcoded banner to every customer of
//    every organization, gated only on a dismiss button — no fetch, no org
//    check, no expiry:
//
//        Asset TRF-SUBSTATION-02 is currently in authorized maintenance
//        (WO-8491 ... · 7h remaining). Audio alarms are silenced ...
//
//    The "7h remaining" was a literal and never counted down.
//
// Why this matters more than an ordinary mock: a shelf is a statement that
// alarms on an asset are SUPPRESSED (ISA-18.2 §12). It tells an operator not to
// expect alerts from that device and to read silence as expected rather than as
// a fault. Both of these named an asset that is not in the reader's fleet,
// attributed the action to a person who never performed it, cited a work order
// that does not exist — and, because the fabricated entry occupied the panel, a
// GENUINE shelf on one of the reader's own assets was never shown.
//
// Run from the repo root: node e2e/proofs/test-shelving-is-real.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')
const read = (p) => strip(readFileSync(new URL(p, root), 'utf8'))

const admin = read('frontend-next/src/app/admin/notifications/page.tsx')
const customer = read('frontend-next/src/components/CustomerAlarmsView.tsx')

// ── 1. The fabricated shelf is gone from both surfaces ────────────────────
for (const [label, src] of [['admin/notifications', admin], ['CustomerAlarmsView', customer]]) {
  t(`${label} names no hardcoded shelved asset`,
    !/TRF-SUBSTATION-02/.test(src),
    'a shelf on screen claims alarms are suppressed for that asset')
  t(`${label} cites no hardcoded work order`,
    !/WO-8491/.test(src))
  t(`${label} attributes no shelf to a hardcoded person`,
    !/Somchai \(Lead Electrical Engineer\)/.test(src),
    'a shelf records WHO authorised the suppression')
}

// ── 2. Empty means empty ──────────────────────────────────────────────────
// The `length > 0` guard is the whole bug: it makes "server says nothing is
// shelved" indistinguishable from "the fetch has not happened", and resolves
// both in favour of whatever was seeded.
t('admin/notifications does not keep stale shelves when the server returns none',
  !/res\?\.shelves && res\.shelves\.length > 0/.test(admin) &&
  /setShelvedDevices\(res\?\.shelves \?\? \[\]\)/.test(admin))
t('admin/notifications starts with an empty shelf list',
  /\}>>\(\[\]\)/.test(admin),
  'a seeded demo entry survives every org that has no shelves')
t('admin/notifications clears the list when the fetch fails',
  /catch\(\(\) => \{ setShelveLoading\(false\); setShelvedDevices\(\[\]\) \}\)/.test(admin),
  'a failed fetch must not leave a shelf asserted on screen')

// ── 3. The customer banner is driven by this org's real shelves ───────────
t('CustomerAlarmsView fetches shelves for its own org',
  /api\.shelving\(orgId\)/.test(customer))
t('the customer banner renders only when a real shelf exists',
  /!shelveDismissed && activeShelves\.length > 0/.test(customer),
  'it used to render for every customer of every org, always')
t('the customer banner drops expired shelves',
  /new Date\(sh\.expiresAt\)\.getTime\(\) > Date\.now\(\)/.test(customer),
  'an expired shelf is not a shelf, and this view refetches rarely')
t('the remaining time is computed, not a literal',
  /new Date\(sh\.expiresAt\)\.getTime\(\) - Date\.now\(\)\) \/ 3600000/.test(customer),
  'the old banner said "7h remaining" forever')
t('the banner lists the real asset ids it was given',
  /\{sh\.nodeId\}/.test(customer))

// ── 4. The server side still scopes shelves to the caller's org ───────────
// The UI is only as honest as what it is handed.
{
  const flows = JSON.parse(readFileSync(new URL('backend/node-red/flows.nodered-backend.json', root), 'utf8'))
  const get = flows.find((n) => n.id === 'shelvingget_fn')
  t('the shelving endpoint exists', !!get)
  if (get) {
    t('it refuses a caller from another organization',
      /orgId!==au\.orgId/.test(get.func) && /outside your organization/.test(get.func))
    t('it returns only active, unexpired shelves',
      /s\.active && new Date\(s\.expiresAt\)\.getTime\(\) > now/.test(get.func))
  }
  // notify must actually honour a shelf, or the banner promises a suppression
  // that does not happen — the opposite failure, and worse.
  const notify = flows.find((n) => n.id === 'notify')
  t('notify still suppresses delivery for an active shelf',
    /maintenance_shelving/.test(notify?.func || ''))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
