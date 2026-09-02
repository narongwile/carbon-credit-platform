// Guards the 21 CFR Part 11 / ISA-84 Enterprise Security Audit Trail and Four-Eyes Dual Control.
//
// Verifies:
// 1. Database schema migration (migrate-v60.sql) declarations and immutability indexes
// 2. Node-RED REST endpoints registration and guard policy scoping
// 3. Multi-tenant isolation: strict org_id scoping on audit logs & pending tasks
// 4. Anti-Tamper: server-side IP extraction, timestamping, and SHA-256 checksums
// 5. Four-Eyes Dual Control (Two-Man Rule): Maker cannot approve their own operation
// 6. Electronic signature password verification for secondary authorization
// 7. Frontend API client and UI integration integrity
//
// Run: node e2e/proofs/test-audit-trail-and-four-eyes.mjs

import { readFileSync, existsSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)

// ── 1. SQL Schema Migration (migrate-v60.sql) ──────────────────────────────
const migPath = new URL('backend/sql/migrate-v60.sql', root)
t('migrate-v60.sql exists', existsSync(migPath))
const migSql = readFileSync(migPath, 'utf8')

t('migrate-v60 creates audit_trail_logs table', /CREATE TABLE IF NOT EXISTS audit_trail_logs\b/.test(migSql))
t('audit_trail_logs declares org_id', /org_id\s+VARCHAR\(64\)\s+NOT NULL/.test(migSql))
t('audit_trail_logs declares actor_id, actor_name, actor_email, actor_role',
  /actor_id.*actor_name.*actor_email.*actor_role/s.test(migSql))
t('audit_trail_logs declares ip_address', /ip_address\s+VARCHAR\(45\)\s+NOT NULL/.test(migSql))
t('audit_trail_logs declares action, before_val, after_val, justification',
  /action.*before_val.*after_val.*justification/s.test(migSql))
t('audit_trail_logs declares SHA-256 checksum column', /checksum\s+VARCHAR\(64\)\s+NOT NULL/.test(migSql))
t('audit_trail_logs declares created_at server timestamp', /created_at\s+DATETIME\(3\)\s+NOT NULL/.test(migSql))
t('audit_trail_logs declares multi-tenant indexes',
  /INDEX idx_atl_org_created \(org_id, created_at\)/.test(migSql) &&
  /INDEX idx_atl_org_action \(org_id, action\)/.test(migSql))

t('migrate-v60 creates audit_pending_approvals table', /CREATE TABLE IF NOT EXISTS audit_pending_approvals\b/.test(migSql))
t('audit_pending_approvals declares maker and checker columns',
  /maker_id.*maker_name.*checker_id.*checker_name/s.test(migSql))
t('audit_pending_approvals declares status enum (PENDING, APPROVED, REJECTED)',
  /status\s+ENUM\('PENDING','APPROVED','REJECTED'\)/.test(migSql))

// ── 2. Node-RED Flows & Endpoints ──────────────────────────────────────────
const flows = JSON.parse(readFileSync(new URL('backend/node-red/flows.nodered-backend.json', root), 'utf8'))
const byId = (id) => flows.find((n) => n.id === id)
const byUrl = (url, method) => flows.find((n) => n.type === 'http in' && n.url === url && (!method || n.method === method))

t('GET /api/orgs/:orgId/audit/logs endpoint registered', !!byUrl('/api/orgs/:orgId/audit/logs', 'get'))
t('POST /api/orgs/:orgId/audit/logs endpoint registered', !!byUrl('/api/orgs/:orgId/audit/logs', 'post'))
t('GET /api/orgs/:orgId/audit/pending endpoint registered', !!byUrl('/api/orgs/:orgId/audit/pending', 'get'))
t('POST /api/orgs/:orgId/audit/pending endpoint registered', !!byUrl('/api/orgs/:orgId/audit/pending', 'post'))
t('POST /api/orgs/:orgId/audit/pending/:id/approve endpoint registered', !!byUrl('/api/orgs/:orgId/audit/pending/:id/approve', 'post'))
t('POST /api/orgs/:orgId/audit/pending/:id/reject endpoint registered', !!byUrl('/api/orgs/:orgId/audit/pending/:id/reject', 'post'))

const approveFn = byId('auditpendingapprove_fn')
t('auditpendingapprove_fn has bcrypt declared in libs',
  Array.isArray(approveFn?.libs) && approveFn.libs.some(l => l.var === 'bcrypt' && l.module === 'bcryptjs'))

// ── 3. Four-Eyes Dual Control (Maker != Checker) Enforcement ───────────────
t('approve handler enforces Maker != Checker (anti-self-approval rule)',
  /Four-Eyes Violation: Maker cannot approve their own operation/i.test(approveFn?.func || ''))
t('approve handler requires electronic signature password',
  /Password required for electronic signature/i.test(approveFn?.func || ''))
t('approve handler verifies password against users table password_hash',
  /SELECT password_hash FROM users WHERE/i.test(approveFn?.func || '') &&
  /bcrypt\.compare/i.test(approveFn?.func || ''))
t('approve handler generates dual audit records (Execution + Four-Eyes Signature)',
  /FOUR_EYES_APPROVAL/i.test(approveFn?.func || '') &&
  /audit_trail_logs/i.test(approveFn?.func || ''))

// ── 4. Anti-Tamper & Multi-Tenant Isolation ────────────────────────────────
const logsGetFn = byId('auditlogsget_fn')
t('auditlogsget_fn scopes strictly by org_id in SQL',
  /org_id = \?/i.test(logsGetFn?.func || '') &&
  /WHERE.*whereSql/i.test(logsGetFn?.func || ''))
t('auditlogsget_fn forbids cross-tenant access for non-superadmin',
  /au\.role!=='superadmin' && orgId!==au\.orgId/i.test(logsGetFn?.func || ''))

const logsPostFn = byId('auditlogspost_fn')
t('auditlogspost_fn extracts real client IP from headers/socket',
  /x-forwarded-for/i.test(logsPostFn?.func || '') &&
  /remoteAddress/i.test(logsPostFn?.func || ''))
t('auditlogspost_fn generates SHA-256 cryptographic checksum on server',
  /CryptoJS\.SHA256\(/.test(logsPostFn?.func || ''))

// ── 5. Frontend API & UI Integration ───────────────────────────────────────
const apiTs = readFileSync(new URL('frontend-next/src/lib/api.ts', root), 'utf8')
t('api.ts exports auditLogs method', /auditLogs:\s*\(orgId:\s*string/.test(apiTs))
t('api.ts exports postAuditLog method', /postAuditLog:\s*\(orgId:\s*string/.test(apiTs))
t('api.ts exports auditPending method', /auditPending:\s*\(orgId:\s*string/.test(apiTs))
t('api.ts exports postAuditPending method', /postAuditPending:\s*\(orgId:\s*string/.test(apiTs))
t('api.ts exports approveAuditPending method', /approveAuditPending:\s*\(orgId:\s*string/.test(apiTs))
t('api.ts exports rejectAuditPending method', /rejectAuditPending:\s*\(orgId:\s*string/.test(apiTs))

const auditPage = readFileSync(new URL('frontend-next/src/app/admin/audit/page.tsx', root), 'utf8')
t('admin/audit/page.tsx connects to live selectedOrgId', /useAppStore\(\)/.test(auditPage) && /selectedOrgId/.test(auditPage))
t('admin/audit/page.tsx removed "LOCAL TO THIS BROWSER — NOT A COMPLIANCE RECORD"',
  !auditPage.includes('LOCAL TO THIS BROWSER — NOT A COMPLIANCE RECORD'))
t('admin/audit/page.tsx displays 21 CFR Part 11 & ISA-84 server ledger status badge',
  /21 CFR PART 11 &amp; ISA-84 SERVER LEDGER ACTIVE/.test(auditPage))
t('admin/audit/page.tsx enforces anti-self-approval in UI',
  /Self-Approval Prohibited/.test(auditPage) && /isMaker/.test(auditPage))
t('admin/audit/page.tsx exports CSV with correct newline format (not \\\\n)',
  /\.join\('\\n'\)/.test(auditPage) && !/\.join\('\\\\n'\)/.test(auditPage))

// ---------------------------------------------------------------------------
// The electronic signature must FAIL CLOSED.
//
// The checks above assert that bcrypt is declared and that bcrypt.compare
// appears in the handler. Both were true while the handler also opened with
//
//     let passwordValid = (password === 'admin123' || password === 'password'
//                          || password === 'admin');
//
// so this file passed 38/38 with a hardcoded credential list in the one place
// that stands between an admin session and executing ANOTHER admin's firmware
// deployment, setpoint change or emergency override. Asserting that a
// verification call is present is not the same as asserting it decides the
// outcome; these check the paths where it did not.
// ---------------------------------------------------------------------------
{
  // Comments stripped: the assertions below are NEGATIVE, and the fix
  // deliberately quotes the old backdoor in a comment explaining it. Matching
  // raw text would fail on the very explanation of the fix.
  const fn = (approveFn?.func || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  t('the signature check contains no hardcoded credentials',
    !/'admin123'|password === 'password'|password === 'admin'/.test(fn),
    'a well-known password in an auth path is a backdoor regardless of what else is checked')

  t('passwordValid starts false',
    /let passwordValid = false;/.test(fn),
    'seeding it from a literal meant every later branch could only widen access')

  t('no branch ORs a previous pass back in',
    !/\|\| passwordValid/.test(fn),
    'the non-bcrypt branch did exactly this, re-admitting the hardcoded value')

  // A checker whose users row has no password_hash used to skip the verify
  // block entirely, leaving the seeded value in place.
  t('an account with no stored hash is refused, not skipped',
    /no password set and therefore cannot sign/i.test(fn))

  // catch(_){} around the verify meant any query error was a silent pass.
  t('a verification error refuses instead of falling through',
    /Could not verify the electronic signature/i.test(fn) &&
    !/\}\s*catch\(_\)\s*\{\s*\}\s*\n\s*if \(!passwordValid\)/.test(fn))

  t('an unavailable comparator refuses instead of degrading',
    /Signature verification is unavailable/i.test(fn))

  // `crypto` is not in this node's libs, so the old sha256 fallback would have
  // thrown into the silent catch — reaching the seeded value again.
  // Every module a handler USES must be declared in its libs. A Node-RED
  // function node runs in a vm.createContext sandbox that is a bare object
  // literal, so it inherits none of the host's globals — the same reason
  // FETCH_LIB exists. All three audit handlers call crypto.createHash to build
  // the tamper-evident checksum that IS the Part 11 record, and none declared
  // crypto: each threw before its INSERT, so the trail recorded nothing while
  // the operation it was meant to witness went ahead. (On Node 20 the host's
  // global `crypto` is WebCrypto, which has no createHash, so even inheriting
  // globals would not have saved it.)
  for (const id of ['auditlogspost_fn', 'auditpendingapprove_fn', 'auditpendingreject_fn']) {
    const n = flows.find((x) => x.id === id)
    const body = n?.func || ''
    const declared = (n?.libs || []).map((l) => l.var)
    for (const [used, mod] of [[/\bCryptoJS\.SHA256/, 'CryptoJS'], [/\bcrypto\.createHash/, 'crypto'], [/\bbcrypt\.compare/, 'bcrypt'], [/\bmysql\./, 'mysql']]) {
      if (used.test(body)) {
        t(`${id} declares '${mod}' in libs, which it uses`,
          declared.includes(mod),
          `declared: ${JSON.stringify(declared)}`)
      }
    }
  }

  // The two-man rule itself, enforced server-side: the UI disables the button
  // for the maker, but that is a client affordance, not a control.
  t('the server refuses a maker approving their own operation',
    /Four-Eyes Violation/.test(fn) &&
    /task\.maker_id === checkerId/.test(fn) &&
    /maker_email\.toLowerCase\(\) === checkerEmail\.toLowerCase\(\)/.test(fn))
}

  // Node's built-in 'crypto' is not resolvable in this sandbox, and declared as
  // an external module npm would fetch the deprecated `crypto` stub, which has
  // no createHash — so the trail would still write nothing, just differently.
  // crypto-js is the dependency this deployment already installs (INIT_LIBS),
  // and CryptoJS.SHA256(x).toString() is byte-identical to
  // createHash('sha256').update(x).digest('hex').
  for (const id of ['auditlogspost_fn', 'auditpendingapprove_fn', 'auditpendingreject_fn']) {
    const n = flows.find((x) => x.id === id)
    t(`${id} hashes with crypto-js, not node's built-in crypto`,
      !/crypto\.createHash/.test(n?.func || '') &&
      (n?.libs || []).every((l) => l.module !== 'crypto'))
  }

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
