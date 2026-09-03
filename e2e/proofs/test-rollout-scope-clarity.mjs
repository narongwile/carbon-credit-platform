// STEP 2's four rollout scopes must say what each one writes, and the panel
// must say when Step 1's ticks are not what gets overwritten.
//
// THE QUESTION THIS SETTLES
// -------------------------
// It was proposed that "Selected Devices" and "Whole Organization" be dropped,
// leaving only Departments and User Teams, because having four scopes after
// Step 1 has already ticked devices is confusing.
//
// The confusion is real; the removal would not be. Each scope writes something
// different, and those two write the things that matter most:
//
//   devices     api.putRule(id) per ticked device → that device's alarm_rules.
//               The everyday operation: fix one or two units.
//   org         api.putOrgRule(orgId) → every matching device's alarm_rules
//               AND org_domain_rules, the baseline a NEWLY PROVISIONED device
//               inherits. Nothing else in the product sets that baseline, so
//               removing this scope removes the capability outright.
//   department  putOrgRuleDepartment(departmentIds) → those departments' devices.
//   user        the same endpoint, resolving each user to their department.
//
// The actual defect is the relationship between the two steps. Step 1 is
// labelled "SELECT TARGET DEVICE(S) TO INSPECT & EDIT" — an inspection choice —
// while one of Step 2's options is named after it ("Selected Devices (2)"), so
// Step 1 silently has two jobs. In the reported screenshot two devices are
// ticked, the scope is Whole Organization, and the header reads "Deploying to 3
// device(s)": the checkboxes stay lit while the write goes somewhere else.
//
// That combination is legitimate — inspect two, roll out to all — it just must
// not be silent. So: keep the scopes, state what each writes, and surface the
// mismatch.
//
// Run from the repo root: node e2e/proofs/test-rollout-scope-clarity.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const raw = readFileSync(new URL('frontend-next/src/components/device/AdminBulkApplyAlarmEditor.tsx', root), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')

// ── 1. All four scopes survive ───────────────────────────────────────────
for (const [id, why] of [
  ["'devices'", 'the everyday one-or-two-device fix'],
  ["'org'", 'the ONLY writer of org_domain_rules, the baseline new devices inherit'],
  ["'department'", 'bulk apply by department'],
  ["'user'", 'bulk apply resolved from a user to their department'],
]) {
  t(`the ${id} rollout scope still exists`, src.includes(`id: ${id}`), why)
}
t('the scope union still admits all four',
  /useState<'devices' \| 'org' \| 'department' \| 'user'>/.test(src))

// ── 2. Each scope says what it writes ────────────────────────────────────
// The four buttons look interchangeable; two of them are not.
t('the panel explains the active scope',
  /applyScope === 'devices' && \(/.test(src) &&
  /applyScope === 'org' && \(/.test(src) &&
  /applyScope === 'department' && \(/.test(src) &&
  /applyScope === 'user' && \(/.test(src))
t('only the org scope claims to change what new devices inherit',
  /newly provisioned devices will inherit/.test(src) &&
  (src.match(/organization baseline is left as it is/g) || []).length === 3,
  'devices, department and user must each say they do NOT touch the baseline')

// ── 3. A Step 1 / Step 2 mismatch is stated, not silent ──────────────────
t('the panel warns when the ticked devices are not what gets written',
  /applyScope !== 'devices' && selectedDeviceIds\.length > 0 && \(/.test(src))
t('the warning gives both counts so the difference is visible',
  /Step 1 has <strong>\{selectedDeviceIds\.length\} device\(s\)<\/strong> ticked/.test(src) &&
  /<strong>\{targetDeviceIds\.size\} device\(s\)<\/strong>/.test(src))
t('the warning explains what the Step 1 selection is for instead',
  /only deciding which/.test(src) && /not what gets overwritten/.test(src))

// ── 4. The write paths behind the labels are unchanged ───────────────────
// The point of keeping the scopes is that they do different things; assert
// they still do, so this proof fails if a later edit collapses them.
t("the devices scope writes each device's own rule",
  /selectedDeviceIds\.map\(\(id\) => api\.putRule\(id, \{ orgId, rule \}\)\)/.test(src))
t('the org scope writes the organization baseline',
  /await api\.putOrgRule\(orgId, \{ rule \}\)/.test(src))
t('the department and user scopes go through the department endpoint',
  /departmentIds: applyScope === 'department' \? selectedDeptIds : undefined/.test(src) &&
  /userIds: applyScope === 'user' \? selectedUserIds : undefined/.test(src))

// ── 5. Every scope still confirms before an irreversible bulk write ──────
t('a bulk write is confirmed first',
  (src.match(/window\.confirm\(/g) || []).length >= 2 &&
  /cannot be undone/.test(src))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
