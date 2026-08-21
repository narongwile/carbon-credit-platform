import fs from 'node:fs';
import http from 'node:http';

const body = fs.readFileSync('./screenshots/migrationsRunFunc.body.js', 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

function makeGlobal() {
  const store = {
    guard: async () => ({ ok: true, auth: { role: 'superadmin', userId: 'u1' } }),
    auditLog: () => {},
  };
  return { get: (k) => store[k] };
}

// The real function body is fire-and-forget: it returns null immediately and
// calls node.send(msg) later when the inner async IIFE resolves — the same
// async-function-node pattern Node-RED itself expects. Awaiting the function
// call's return value (as my first pass at this test did) races the real
// work and reads msg before it's mutated. Wait for node.send instead.
async function run(bodySrc, envVars) {
  const env = { get: (k) => envVars[k] };
  let resolveSend;
  const sent = new Promise((res) => { resolveSend = res; });
  const node = { warn: () => {}, send: (m) => resolveSend(m) };
  const global = makeGlobal();
  const msg = { req: { headers: { authorization: 'Bearer x' } } };
  const fn = new AsyncFunction('msg', 'env', 'node', 'global', bodySrc);
  fn(msg, env, node, global);
  return sent;
}

console.log('--- Case 1: migrate-service down (nothing listening) ---');
{
  const msg = await run(body, { MIGRATE_URL: 'http://127.0.0.1:19999' });
  console.log('statusCode:', msg.statusCode, '| error:', msg.payload.error);
}

console.log('\n--- Case 2: fast success ---');
{
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, migrated: [{ orgId: 'org-9', db: 'iothub_org_9', applied: 3 }], failed: [], skipped: ['org-1'] }));
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const msg = await run(body, { MIGRATE_URL: `http://127.0.0.1:${port}` });
  console.log('statusCode:', msg.statusCode, '(expect undefined -> 200 default)');
  console.log('payload:', JSON.stringify(msg.payload));
  srv.close();
}

console.log('\n--- Case 3: a real slow migration (3s), well under the 10-minute timeout, must still succeed ---');
{
  const srv = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, migrated: [{ orgId: 'org-9', db: 'iothub_org_9', applied: 1 }], failed: [], skipped: [] }));
    }, 3000);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const t0 = Date.now();
  const msg = await run(body, { MIGRATE_URL: `http://127.0.0.1:${port}` });
  console.log('elapsed ms:', Date.now() - t0, '(should be ~3000, and NOT have errored)');
  console.log('statusCode:', msg.statusCode, '| ok:', msg.payload.ok);
  srv.close();
}

console.log('\n--- Case 4: timeout path — same code, signal swapped to a short value so the test does not take 10 real minutes ---');
{
  const srv = http.createServer(() => { /* never respond */ });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const shortBody = body.replace('AbortSignal.timeout(600000)', 'AbortSignal.timeout(300)').replace('10 minutes', '300ms (test override)');
  const t0 = Date.now();
  const msg = await run(shortBody, { MIGRATE_URL: `http://127.0.0.1:${port}` });
  console.log('elapsed ms:', Date.now() - t0, '(should be ~300, not hung)');
  console.log('statusCode:', msg.statusCode, '| error:', msg.payload.error);
  srv.close();
}
