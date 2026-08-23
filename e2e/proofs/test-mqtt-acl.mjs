// Proves the EMQX ACL patterns actually match the topics the fleet uses, and
// actually deny the ones they are meant to.
//
// An ACL is the one config where "looks right" is worth nothing: a pattern
// that matches nothing silently denies the whole fleet at the next deploy,
// and a pattern that is one wildcard too wide silently grants cross-tenant
// access. Both failure modes are invisible until traffic hits them.
//
// Both had already happened here. Production granted `device` the open
// wildcards publish `telemetry/#` / subscribe `telemetry/#` — any device
// could publish as any node in any org and read the entire multi-tenant
// fleet. UAT was scoped but pinned the clientid at the wrong position
// (`telemetry/${clientid}/#`), which matches nothing a real device publishes,
// so every frame would have fallen through to {deny, all}.
//
// This reads the patterns straight out of the committed helm values and runs
// MQTT topic-filter matching against the REAL topics from
// e2e/fixtures/real-device-payloads.json.
//
// Run from the repo root: node e2e/proofs/test-mqtt-acl.mjs
import fs from 'node:fs';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

/** MQTT topic-filter match: '+' is exactly one level, '#' is the rest. */
function matches(filter, topic) {
  const f = filter.split('/'), s = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;          // '#' must be last; matches remainder
    if (i >= s.length) return false;
    if (f[i] === '+') continue;
    if (f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}

// sanity-check the matcher itself before trusting its verdicts below
t('matcher: exact', matches('a/b/c', 'a/b/c'));
t('matcher: + is one level', matches('a/+/c', 'a/x/c') && !matches('a/+/c', 'a/x/y/c'));
t('matcher: # is the remainder', matches('a/#', 'a/b/c') && !matches('a/#', 'b/c'));
t('matcher: parent does not match child without #', !matches('a/b', 'a/b/c'));

/** Pull one action's topic list out of a `{allow, {user, "device"}, ACTION, [...]}` block. */
function deviceRules(file, action) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`\\{allow,\\s*\\{user,\\s*"device"\\},\\s*${action},\\s*\\[([^\\]]*)\\]`, 's');
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const FILES = {
  prod: 'infra/helm-values/emqx-values.yaml',
  uat: 'infra/helm-values/emqx-values-uat.yaml',
};

const fixture = JSON.parse(fs.readFileSync('e2e/fixtures/real-device-payloads.json', 'utf8'));
const realTopics = fixture.frames.map((f) => ({ nodeId: f.nodeId, topic: `telemetry/org-1/eternity/${f.nodeId}` }));
// An alarm subtopic, seen live on the broker alongside the readings frames.
realTopics.push({ nodeId: 'tr-222', topic: 'telemetry/org-1/eternity/tr-222/alarm/hydrogen' });

for (const [env, file] of Object.entries(FILES)) {
  const pub = deviceRules(file, 'publish');
  const sub = deviceRules(file, 'subscribe');
  t(`${env}: device publish + subscribe rules found`, !!pub && !!sub,
    pub ? `${pub.length} publish, ${sub?.length} subscribe` : 'NOT FOUND');
  if (!pub || !sub) continue;

  // --- the rules must not be open wildcards -----------------------------
  const OPEN = ['telemetry/#', 'sensors/#', 'transformers/#', 'cmd/#', 'config/#', 'devices/#'];
  const openPub = pub.filter((p) => OPEN.includes(p));
  const openSub = sub.filter((p) => OPEN.includes(p));
  t(`${env}: no open publish wildcard`, openPub.length === 0, openPub.join(', '));
  t(`${env}: no open subscribe wildcard (cross-tenant read)`, openSub.length === 0, openSub.join(', '));

  // --- a device must be able to publish its OWN real topics -------------
  for (const { nodeId, topic } of realTopics) {
    const allowed = pub.some((p) => matches(p.replace('${clientid}', nodeId), topic));
    t(`${env}: ${nodeId} may publish ${topic}`, allowed,
      allowed ? '' : `no rule matches — this device would be DENIED. rules=${JSON.stringify(pub)}`);
  }

  // --- and must NOT be able to publish as another node ------------------
  const impersonations = [
    { as: 'tr-221', target: 'telemetry/org-1/eternity/tr-111' },
    { as: 'tr-111', target: 'telemetry/org-2/eternity/tr-999' },
  ];
  for (const { as, target } of impersonations) {
    const allowed = pub.some((p) => matches(p.replace('${clientid}', as), target));
    t(`${env}: ${as} may NOT publish to ${target}`, !allowed, allowed ? 'ALLOWED — impersonation possible' : '');
  }

  // --- subscribe must be scoped to its own downlink ---------------------
  const ownCmd = sub.some((p) => matches(p.replace('${clientid}', 'tr-111'), 'cmd/tr-111/reboot'));
  t(`${env}: a device may subscribe to its own cmd topic`, ownCmd);
  const otherCmd = sub.some((p) => matches(p.replace('${clientid}', 'tr-111'), 'cmd/tr-221/reboot'));
  t(`${env}: a device may NOT subscribe to another device's cmd topic`, !otherCmd);
  const otherCfg = sub.some((p) => matches(p.replace('${clientid}', 'tr-111'), 'config/tr-221/creds'));
  t(`${env}: a device may NOT read another device's config push`, !otherCfg,
    otherCfg ? 'ALLOWED — per-device credentials pushed over config/ would leak' : '');
  const fleetRead = sub.some((p) => matches(p.replace('${clientid}', 'tr-111'), 'telemetry/org-2/eternity/tr-999'));
  t(`${env}: a device may NOT read another org's telemetry`, !fleetRead);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
