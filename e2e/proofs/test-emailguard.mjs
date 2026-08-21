// Run from the repo root: node e2e/proofs/test-emailguard.mjs
// Extracts the REAL generated test-email handler out of the built flow (not a
// hand-copied approximation of it) and drives it directly, so this proof
// breaks the moment the real handler's behavior changes instead of quietly
// testing a stale copy.
import fs from 'node:fs';
const flows = JSON.parse(fs.readFileSync('backend/node-red/flows.nodered-backend.json', 'utf8'));
// Named flowNode, NOT node — a mock `node` (with .send/.warn/.error) is a real
// parameter of the extracted handler itself further down; reusing the name
// here would shadow-and-confuse even though scoping keeps it technically safe.
const flowNode = flows.find((f) => f.type === 'function' && /email-template\/test/.test(f.name || ''));
if (!flowNode) { console.error('FAIL could not find the email-template/test function node — run `node backend/node-red/generate-nodered-backend.mjs` first'); process.exit(1); }
const body = flowNode.func;

// Real users table for the org under test.
const USERS = [
  { id: 'u-admin', email: 'admin@kmutt.ac.th', org_id: 'org-1' },
  { id: 'u-mate',  email: 'ops@kmutt.ac.th',   org_id: 'org-1' },
  { id: 'u-other', email: 'spy@evil.example',  org_id: 'org-2' },
];
const pool = {
  async query(sql, p) {
    if (/FROM users WHERE id=\?/.test(sql)) return [USERS.filter(u => u.id === p[0]).map(u => ({ email: u.email }))];
    if (/FROM users WHERE email=\? AND org_id=\?/.test(sql)) return [USERS.filter(u => u.email === p[0] && u.org_id === p[1]).map(u => ({ id: u.id }))];
    if (/FROM organizations/.test(sql)) return [[{ name: 'KMUTT' }]];
    return [[]];
  },
};
let sent = null;
let CURRENT_AUTH = null;
const globals = {
  pool,
  // The extracted body still carries its GUARD_OPEN preamble, so the guard has
  // to be stubbed or the handler short-circuits at 503 before any of the
  // recipient logic under test ever runs.
  guard: async () => ({ ok: true, auth: CURRENT_AUTH }),
  mailConfig: async () => ({
    transport: { sendMail: async (o) => { sent = o; return { messageId: 'x' }; } },
    from: 'noreply@platform.test', frontendUrl: 'https://platform.test',
  }),
};

async function call(auth, payload) {
  sent = null;
  CURRENT_AUTH = auth;
  const msg = { auth, req: { params: { orgId: 'org-1' }, headers: {} }, payload };
  const node = { send: (m) => { node._out = m; }, warn: (w) => console.log('   [node.warn]', w), error: (e) => console.log('   [node.error]', e), _out: null };
  const env = { get: () => '' };
  const global = { get: (k) => globals[k] };
  const fn = new Function('msg', 'node', 'env', 'global', body);
  let direct;
  try { direct = await fn(msg, node, env, global); } catch (e) { console.log('   [throw]', e.message); }
  await new Promise((r) => setTimeout(r, 200));
  const out = node._out || direct || msg;
  if (!sent) console.log('   [debug] status=', out?.statusCode, 'payload=', JSON.stringify(out?.payload));
  return { status: out?.statusCode ?? 200, payload: out?.payload, sentTo: sent?.to };
}

let pass = 0, fail = 0;
const t = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); cond ? pass++ : fail++; };

const admin = { userId: 'u-admin', orgId: 'org-1', role: 'admin' };

// 1. THE HOLE THAT WAS OPEN: arbitrary internet address.
let r = await call(admin, { targetEmail: 'victim@gmail.com' });
t('outside address is refused', r.status === 403 && !r.sentTo, `status=${r.status} sentTo=${r.sentTo ?? 'none'}`);

// 2. Another tenant's user is still "outside".
r = await call(admin, { targetEmail: 'spy@evil.example' });
t('another org\'s user is refused', r.status === 403 && !r.sentTo, `status=${r.status}`);

// 3. No targetEmail -> falls back to the requester's REAL address (the old
//    au.email fallback was dead: the JWT carries no email at all).
r = await call(admin, {});
t('defaults to the requester\'s own address', r.sentTo === 'admin@kmutt.ac.th', `sentTo=${r.sentTo}`);

// 4. A colleague in the same org is allowed.
r = await call(admin, { targetEmail: 'ops@kmutt.ac.th' });
t('same-org colleague is allowed', r.sentTo === 'ops@kmutt.ac.th', `sentTo=${r.sentTo}`);

// 5. Case-insensitive self-match must not trip the org lookup.
r = await call(admin, { targetEmail: 'ADMIN@KMUTT.AC.TH' });
t('self address in different case still works', r.sentTo && /admin@kmutt\.ac\.th/i.test(r.sentTo), `sentTo=${r.sentTo}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
