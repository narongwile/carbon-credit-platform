// The dialogs that carry an irreversible operation must behave like dialogs,
// and must not be able to issue that operation twice.
//
// WHAT WAS MEASURED
// -----------------
// 37 files in frontend-next render their own `fixed inset-0` overlay. Counting
// what each one actually did:
//
//     handle Escape ........  6 / 37
//     lock body scroll .....  3 / 37
//     any focus handling ...  1 / 37
//     role="dialog" ........ 5 files
//     focus TRAP ........... 0
//
// So on almost all of them a screen reader is never told a dialog opened, Tab
// walks straight out of the panel into the page behind the backdrop where
// every control is still reachable, Escape does nothing, and the sheet behind
// scrolls under the pointer.
//
// On a settings panel that is a nuisance. This product puts the same pattern
// behind the four-eyes electronic signature, the OTA fleet firmware rollout,
// ISA-18.2 alarm shelving and the ISO 55000 criticality write.
//
// THE SECOND, WORSE FINDING
// -------------------------
// Auditing those specific dialogs for double-submit turned up three where a
// second click issued the operation a second time:
//
//   * admin/audit "Sign & Approve" and "Reject Request" — handleApprove set
//     isSubmitting and the button never read it, so an electronic signature
//     could be submitted twice against one pending operation. The password
//     field also carried placeholder="Enter admin123", printing the seed
//     credential on the face of a 21 CFR Part 11 signature prompt.
//   * admin/ota — neither handleDelete nor handleExecuteDeploy had any busy
//     state at all. Two clicks on "Deploy Fleet Update" dispatch a second OTA
//     command to every device in the domain and write a second
//     OTA_FLEET_DEPLOY row for one operator decision.
//   * admin/notifications handleAddShelve — awaited putShelving and then
//     recorded an ALARM_SHELVE audit action unconditionally, so a double click
//     wrote two shelving records and two audit rows. It also proceeded to
//     write that audit row after the backend save FAILED, telling the operator
//     alarms were silenced when they were still live.
//
// Run from the repo root: node e2e/proofs/test-modal-dialog-contract.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
// A missing file must fail every assertion that reads it, one line each,
// rather than throwing and hiding the rest of the report.
const read = (rel) => {
  try { return readFileSync(new URL('frontend-next/src/' + rel, root), 'utf8') }
  catch { return '' }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')

// ── 1. The shared primitive exists and keeps its whole contract ──────────
const modal = strip(read('components/ui/Modal.tsx'))

t('the dialog is announced as one', /role="dialog"/.test(modal) && /aria-modal="true"/.test(modal))
t('the dialog is announced by its own title, not just "dialog"',
  /aria-labelledby=\{titleId\}/.test(modal))
t('Escape closes it', /e\.key === 'Escape'/.test(modal))
t('the page behind is scroll-locked',
  /document\.body\.style\.overflow = 'hidden'/.test(modal) &&
  /document\.body\.style\.overflow = prevOverflow/.test(modal))
t('focus moves into the panel on open',
  /restoreFocusTo\.current = document\.activeElement/.test(modal) &&
  /const first = focusable\(\)\[0\]/.test(modal))
t('focus returns to the launcher on close',
  /restoreFocusTo\.current\?\.focus\?\.\(\)/.test(modal))

// The one thing no hand-rolled overlay in this repo had.
t('Tab is trapped inside the panel',
  /e\.key !== 'Tab'/.test(modal) &&
  /e\.shiftKey && active === firstEl/.test(modal) &&
  /!e\.shiftKey && active === lastEl/.test(modal),
  'without this, every control on the page behind a "modal" is still keyboard-reachable')

// The effect body is not idempotent; re-running it re-reads prevOverflow after
// the lock is applied (permanent scroll lock) and re-captures restoreFocusTo
// from the panel itself (focus returns to a removed node).
t('the open effect runs once per open, not once per render',
  /const onCloseRef = useRef\(onClose\)/.test(modal) &&
  /\}, \[open, focusable\]\)/.test(modal))

t('a mutation in flight cannot be dismissed out from under the operator',
  /if \(busy\) return/.test(modal) && /if \(busyRef\.current\) return/.test(modal),
  'Escape and backdrop must both be inert while busy')
t('the backdrop closes on mousedown, not click',
  /onMouseDown=/.test(modal) && !/onClick=\{\(e\) => \{[\s\S]{0,120}onClose\(\)/.test(modal),
  'a text drag that starts inside the panel and releases on the backdrop fires click there')

// ── 2. The high-consequence dialogs actually use it ──────────────────────
const wired = {
  'app/admin/audit/page.tsx': 3,        // approve, reject, request dual-control
  'app/admin/ota/page.tsx': 2,          // delete release, deploy firmware
  'app/admin/notifications/page.tsx': 3, // channels, bulk copy, ISA-18.2 shelving
  'app/admin/reports/page.tsx': 4,      // schedule builder, history, delete, preview
  'components/transformer/FleetRiskMatrix.tsx': 1, // ISO 55000 criticality
  'components/transformer/StudyModal.tsx': 1,      // every PdM study
}
for (const [rel, n] of Object.entries(wired)) {
  const src = strip(read(rel))
  t(`${rel} routes its dialogs through the shared Modal`,
    /import Modal from '@\/components\/ui\/Modal'/.test(src) &&
    (src.match(/<Modal\b/g) || []).length >= n,
    `${n} expected`)
  t(`${rel} has no hand-rolled overlay left`,
    !/className="fixed inset-0 z-\d+ flex items-center justify-center/.test(src))
}

// ── 3. No irreversible operation can be issued twice ─────────────────────
const audit = strip(read('app/admin/audit/page.tsx'))
t('the electronic signature cannot be submitted twice',
  /onClick=\{handleApprove\}\s*\n\s*disabled=\{isSubmitting \|\| !password\.trim\(\)\}/.test(audit),
  'isSubmitting was set by handleApprove and never read by the button')
t('the rejection cannot be recorded twice',
  /onClick=\{handleReject\}\s*\n\s*disabled=\{isSubmitting \|\| !rejectReason\.trim\(\)\}/.test(audit))
t('the signature prompt does not print the seed password',
  !/Enter admin123/.test(audit),
  'placeholder="Enter admin123" sat on a 21 CFR Part 11 signature field')

const ota = strip(read('app/admin/ota/page.tsx'))
t('the fleet firmware rollout cannot be dispatched twice',
  /if \(!deployTarget \|\| otaBusy\) return/.test(ota) &&
  /onClick=\{handleExecuteDeploy\}\s*\n\s*disabled=\{otaBusy\}/.test(ota),
  'a second click sent a second OTA command to every device in the domain')
t('the release delete cannot run twice',
  /if \(otaBusy\) return/.test(ota) &&
  /onClick=\{\(\) => handleDelete\(deleteConfirm\)\}\s*\n\s*disabled=\{otaBusy\}/.test(ota))

const notif = strip(read('app/admin/notifications/page.tsx'))
t('the ISA-18.2 shelving authorization cannot be written twice',
  /if \(shelveSaving\) return/.test(notif) &&
  /onClick=\{handleAddShelve\}\s*\n\s*disabled=\{shelveSaving\}/.test(notif))
t('a failed shelving save does not record an ALARM_SHELVE audit row',
  /alarms remain ACTIVE/.test(notif) &&
  /setShelveSaving\(false\)\s*\n\s*return/.test(notif),
  'it used to fall through to recordAuditAction and close, reporting success')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
