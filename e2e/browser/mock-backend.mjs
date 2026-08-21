import http from 'node:http';
import { WebSocketServer } from '/home/user/carbon-credit-platform/backend/node_modules/ws/wrapper.mjs';

// In-memory state for the two endpoints under test, so a PUT is visible on
// the next GET — the thing I actually need to prove (save -> refetch -> chips
// update).
const state = {
  // 'winding' is deliberately in the spec but NOT in any device's sample, so
  // there is always one rose "expected but absent" chip to assert on; 'load'
  // and 'extraSensor' are the reverse (sent, not in spec) and must stay plain.
  displayParams: { 'org-1::transformer': { keys: ['oilTemp', 'hydrogen', 'moisture', 'winding'], layout: {} } },
  paramLabels: { 'org-1::transformer': { oilTemp: 'Oil Temp (custom)' } },
  // Deliberately DIFFERENT from the frontend's hardcoded fallback default, so
  // a passing test proves the value came from THIS fetch, not just the
  // page's built-in fallback happening to render.
  mqtt: { host: 'mqtt.fromserver.example', port: '18830', username: 'srvdevice', password: 'SrvSecret42', tls: true },
  // Fleet for the device-move test: TRA-9F2C is a primary with one merged
  // second feed (TRA-9F2C-B), so the "moves together" behaviour has something
  // real to exercise. moved tracks ids the mock has "relocated" so GET
  // /api/fleet reflects it on the next fetch, same as the real backend would.
  fleet: [
    { id: 'TRA-9F2C', org_id: 'org-1', name: 'TRA-9F2C', domain: 'transformer', site_id: 'site-1', department_id: null, lat: 13.736, lng: 100.523, online: 1, last_seen: new Date().toISOString(), rssi: -60, fw: '1.0', alarm: null, sensor_count: 5 },
    { id: 'tr-nositecoord', org_id: 'org-1', name: 'TR-NoSiteCoord', domain: 'transformer', site_id: 'site-1', department_id: null, lat: null, lng: null, online: 1, last_seen: new Date().toISOString(), rssi: -60, fw: '1.0', alarm: 'WARNING' },
    { id: 'tr-critical', org_id: 'org-1', name: 'TR-Critical', domain: 'transformer', site_id: 'site-1', department_id: null, lat: 13.745, lng: 100.531, online: 1, last_seen: new Date().toISOString(), rssi: -60, fw: '1.0', alarm: 'CRITICAL' },
  ],
  feeds: { 'TRA-9F2C': [{ id: 'TRA-9F2C-B', name: 'TRA-9F2C-B', domain: 'transformer', mqtt_prefix: 'telemetry/org-1/eternity/TRA-9F2C-B' }] },
  moved: new Set(),
  sites: [{ id: 'site-1', name: 'Substation A', address: null, lat: null, lng: null }],
  // Per-node custom chart definitions (migrate-v47) and the ONE alarm rule
  // per node those charts' threshold editor reads/writes — same shape a real
  // node-scoped alarm_rules row and chart_definitions rows would have.
  charts: {},
  rules: {},
};

// Synthetic reading history so a multi-param custom chart has real series to
// plot: two gentle sine-ish curves per node, 90 minutes of 1-minute samples.
function syntheticReadings(nodeId, paramKeys, sinceMin) {
  const now = Date.now();
  const points = Math.min(sinceMin, 90);
  const out = [];
  for (const key of paramKeys) {
    const base = key === 'oilTemp' ? 60 : key === 'load' ? 40 : key === 'hydrogen' ? 5 : 20;
    const amp = key === 'oilTemp' ? 8 : key === 'load' ? 15 : key === 'hydrogen' ? 2 : 5;
    // Per-key PHASE offset, not just amplitude: with every series sharing one
    // phase they were all exact affine transforms of the same sine, so every
    // correlation pair came out at a perfect +1.00 — which a broken
    // implementation that simply always returns 1 would also produce. A
    // quarter-turn on moisture makes it near-uncorrelated with oilTemp while
    // hydrogen stays strongly correlated, so the test can tell those apart.
    const phase = key === 'moisture' ? Math.PI / 2 : key === 'hydrogen' ? 0.6 : 0;
    for (let i = points; i >= 0; i--) {
      const t = new Date(now - i * 60000);
      const v = base + amp * Math.sin((points - i) / 12 + phase) + (nodeId.length % 3);
      out.push({ param_key: key, value: Math.round(v * 100) / 100, taken_at: t.toISOString().slice(0, 19).replace('T', ' ') });
    }
  }
  return out;
}

const PENDING = process.env.EMPTY ? [] : [
  {
    id: 'TRA-9F2C', org_id: 'org-1', org_name: 'KMUTT', domain: 'transformer', name: 'TRA-9F2C',
    mqtt_prefix: 'telemetry/org-1/eternity/TRA-9F2C', first_seen: new Date(Date.now() - 48000).toISOString(),
    last_seen: new Date(Date.now() - 3000).toISOString(), online: 1,
    last_sample: { oilTemp: 63.4, hydrogen: 118, moisture: 21, load: 72, extraSensor: 5 },
  },
];

const wsClients = new Set();

function send(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-user-id',
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { /* ignore */ }

  console.log(req.method, url.pathname, JSON.stringify(body).slice(0, 200));

  if (req.method === 'OPTIONS') return send(res, 204, {});

  // Test control: fan a telemetry frame out to every connected WS client.
  if (req.method === 'POST' && url.pathname === '/__test/frame') {
    for (const c of wsClients) { try { c.send(JSON.stringify(body)); } catch { /* ignore */ } }
    return send(res, 200, { ok: true, sentTo: wsClients.size });
  }
  // Test control: make a new device pending, as auto-registration would.
  if (req.method === 'POST' && url.pathname === '/__test/pending') {
    PENDING.push(body);
    return send(res, 200, { ok: true, count: PENDING.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const role = body.email === 'superadmin' ? 'superadmin' : 'admin';
    // eternity-admin's real org is org-eternity, NOT org-1 — used to test
    // whether a stale persisted selectedOrgId (from an earlier org-1
    // session in the same browser storage) gets corrected on login/mount.
    const orgId = role === 'superadmin' ? undefined : (body.email === 'eternity-admin' ? 'org-eternity' : 'org-1');
    return send(res, 200, { token: 'faketoken', user: { id: 'u1', email: body.email, role, orgId, name: body.email } });
  }
  if (req.method === 'GET' && url.pathname === '/api/nodes/pending') {
    const filterOrg = url.searchParams.get('orgId');
    return send(res, 200, filterOrg ? PENDING.filter((p) => p.org_id === filterOrg) : PENDING);
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/departments$/)) return send(res, 200, [{ id: 'dept-1', name: 'Substation A' }]);
  if (req.method === 'GET' && url.pathname === '/api/orgs') return send(res, 200, [{ id: 'org-1', name: 'KMUTT', status: 'active' }, { id: 'org-2', name: 'Siriraj Hospital', status: 'active' }, { id: 'org-eternity', name: 'Eternity', status: 'active' }]);
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/product-access$/)) return send(res, 200, []);
  if (req.method === 'GET' && url.pathname === '/api/fleet') {
    return send(res, 200, state.fleet.filter((d) => !state.moved.has(d.id)));
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/nodes\/[^/]+\/feeds$/)) {
    const id = url.pathname.split('/')[3];
    return send(res, 200, { id, feeds: (state.feeds[id] || []).filter((f) => !state.moved.has(f.id)) });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/nodes\/[^/]+\/departments$/)) {
    return send(res, 200, { id: url.pathname.split('/')[3], owner: null, granted: [], effective: [] });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/nodes\/[^/]+\/photos$/)) return send(res, 200, { nodeId: url.pathname.split('/')[3], photos: [] });
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/kinds$/)) return send(res, 200, { scope: 'photo', kinds: [] });
  // POST /api/nodes/move — the real endpoint under test. Marks every id
  // "moved" so a refetch of /api/fleet (which the frontend does after a
  // successful move) shows it gone, exactly like the real backend's data
  // relocation would.
  if (req.method === 'POST' && url.pathname === '/api/nodes/move') {
    const { nodeIds, targetOrgId } = body;
    if (!Array.isArray(nodeIds) || !nodeIds.length || !targetOrgId) {
      return send(res, 400, { error: 'nodeIds (non-empty array) and targetOrgId are required' });
    }
    if (targetOrgId === 'org-does-not-exist') {
      return send(res, 400, { error: 'target organization does not exist or is suspended' });
    }
    for (const id of nodeIds) state.moved.add(id);
    const results = nodeIds.map((id) => ({ id, ok: true, moved: true, fromOrg: 'org-1', toOrg: targetOrgId, warnings: [] }))
      .map((r) => ({ nodeId: r.id, ok: r.ok, moved: r.moved, fromOrg: r.fromOrg, toOrg: r.toOrg, warnings: r.warnings }));
    return send(res, 200, { ok: true, results });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/fleet\/[^/]+\/latest$/)) {
    return send(res, 200, {
      presence: { online: 1, last_seen: new Date(Date.now() - 4000).toISOString(), rssi: -61, batt: 87, fw: '1.4.2', transport: 'wifi' },
      // Same shape as the pending row's last_sample on purpose: three matched,
      // two extra, and 'winding' from the spec absent.
      values: { oilTemp: 63.4, hydrogen: 118, moisture: 21, load: 72, extraSensor: 5 },
      lastReadingAt: new Date(Date.now() - 4000).toISOString(),
    });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/sites$/)) {
    return send(res, 200, { sites: state.sites, floors: [] });
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/orgs\/[^/]+\/sites$/)) {
    const b = body;
    const existing = state.sites.find((s) => s.id === b.id);
    if (existing) Object.assign(existing, { name: b.name, address: b.address ?? existing.address, lat: b.lat ?? existing.lat, lng: b.lng ?? existing.lng });
    else state.sites.push({ id: b.id || `site-${Date.now()}`, name: b.name, address: b.address ?? null, lat: b.lat ?? null, lng: b.lng ?? null });
    return send(res, 200, { ok: true, id: b.id || state.sites[state.sites.length - 1].id });
  }
  if (req.method === 'PUT' && url.pathname.match(/^\/api\/nodes\/[^/]+\/location$/)) {
    const id = url.pathname.split('/')[3];
    const node = state.fleet.find((d) => d.id === id);
    const b = body;
    if (node) {
      if (b.lat !== undefined) node.lat = b.lat;
      if (b.lng !== undefined) node.lng = b.lng;
      if (b.siteId !== undefined) node.site_id = b.siteId;
    }
    return send(res, 200, { ok: true, id, lat: node?.lat, lng: node?.lng, siteId: node?.site_id });
  }
  // Record<nodeId, {model, ratedKva, voltageClass}> — the real shape
  // api.orgNameplates expects (the generic []-fallback below is an array and
  // would silently render no Asset section on the map popup).
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/nameplates$/)) {
    return send(res, 200, {
      'TRA-9F2C': { model: 'TR-6787', ratedKva: 2500, voltageClass: '22kV/0.4kV' },
      'tr-critical': { model: 'TR-9001', ratedKva: 3000, voltageClass: '33kV/11kV' },
    });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/entitlements$/)) return send(res, 200, ['eternityTransformers', 'refrigerationDataLogger', 'bloodBox']);
  if (req.method === 'GET' && url.pathname.match(/^\/api\/orgs\/[^/]+\/transformer-models$/)) return send(res, 200, []);

  if (url.pathname.match(/^\/api\/orgs\/([^/]+)\/display-params$/)) {
    const orgId = url.pathname.split('/')[3];
    const domain = url.searchParams.get('domain') || body.domain;
    const key = `${orgId}::${domain}`;
    if (req.method === 'GET') {
      const cur = state.displayParams[key];
      return send(res, 200, { domain, nodeId: url.searchParams.get('nodeId') || null, scope: cur ? 'org' : 'none', paramKeys: cur?.keys ?? [], layout: cur?.layout ?? {} });
    }
    if (req.method === 'PUT') {
      state.displayParams[key] = { keys: body.paramKeys || [], layout: body.layout || {} };
      return send(res, 200, { ok: true, count: (body.paramKeys || []).length, devices: (body.nodeIds || []).length });
    }
  }
  if (url.pathname.match(/^\/api\/orgs\/([^/]+)\/param-labels$/)) {
    const orgId = url.pathname.split('/')[3];
    const domain = url.searchParams.get('domain') || body.domain;
    const key = `${orgId}::${domain}`;
    if (req.method === 'GET') {
      const cur = state.paramLabels[key] || {};
      return send(res, 200, { domain, nodeId: null, labels: cur, own: cur });
    }
    if (req.method === 'PUT') {
      state.paramLabels[key] = { ...(state.paramLabels[key] || {}), ...(body.labels || {}) };
      return send(res, 200, { ok: true, set: Object.keys(body.labels || {}).length, cleared: 0 });
    }
  }

  // Custom multi-parameter trend charts (migrate-v47).
  {
    const m1 = url.pathname.match(/^\/api\/nodes\/([^/]+)\/charts$/);
    if (m1) {
      const nodeId = m1[1];
      if (req.method === 'GET') {
        return send(res, 200, (state.charts[nodeId] || []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
      }
      if (req.method === 'POST') {
        if (!body.title || !Array.isArray(body.paramKeys) || !body.paramKeys.length) {
          return send(res, 400, { error: !body.title ? 'title required' : 'select at least one parameter' });
        }
        const list = (state.charts[nodeId] ||= []);
        const id = `chart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        list.push({ id, title: body.title, paramKeys: body.paramKeys, sortOrder: list.length, createdBy: 'mock-admin', updatedAt: new Date().toISOString() });
        return send(res, 200, { ok: true, id });
      }
    }
    const m2 = url.pathname.match(/^\/api\/nodes\/([^/]+)\/charts\/([^/]+)$/);
    if (m2) {
      const [, nodeId, chartId] = m2;
      const list = state.charts[nodeId] || [];
      const chart = list.find((c) => c.id === chartId);
      if (req.method === 'PUT') {
        if (!chart) return send(res, 404, { error: 'chart not found' });
        if (typeof body.title === 'string' && body.title.trim()) chart.title = body.title.trim();
        if (Array.isArray(body.paramKeys)) {
          if (!body.paramKeys.length) return send(res, 400, { error: 'select at least one parameter' });
          chart.paramKeys = body.paramKeys;
        }
        chart.updatedAt = new Date().toISOString();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        const idx = list.findIndex((c) => c.id === chartId);
        if (idx >= 0) list.splice(idx, 1);
        return send(res, 200, { ok: true, deleted: idx >= 0 });
      }
    }
  }

  // Per-node alarm rule (thresholds) — same node-keyed shape putRuleFunc uses.
  if (url.pathname.match(/^\/api\/nodes\/[^/]+\/rule$/)) {
    const nodeId = url.pathname.split('/')[3];
    if (req.method === 'GET') {
      const r = state.rules[nodeId];
      if (!r) return send(res, 404, { error: 'no rule' });
      return send(res, 200, r);
    }
    if (req.method === 'PUT') {
      state.rules[nodeId] = body.rule;
      return send(res, 200, { ok: true });
    }
  }

  // Readings history — supports a comma-separated paramKey for multi-series
  // custom charts, same contract as the real readingsGetFunc extension.
  if (req.method === 'GET' && url.pathname.match(/^\/api\/nodes\/[^/]+\/readings$/)) {
    const nodeId = url.pathname.split('/')[3];
    const keys = (url.searchParams.get('paramKey') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const sinceMin = Number(url.searchParams.get('sinceMin') || 1440);
    const paramKeys = keys.length ? keys : ['oilTemp'];
    return send(res, 200, syntheticReadings(nodeId, paramKeys, Math.round(sinceMin)));
  }

  // A viewer's own access grant — real shape ({departmentIds, levels, role}),
  // not the generic []-fallback below, which crashed customer/layout.tsx's
  // myAccess.departmentIds.length read.
  if (req.method === 'GET' && url.pathname === '/api/me/access') {
    return send(res, 200, { role: 'viewer', departmentId: null, departmentIds: [], levels: { transformer: 'view', carbonNode: 'view', bloodBox: 'view' } });
  }

  if (req.method === 'GET' && url.pathname === '/api/platform/mqtt') return send(res, 200, state.mqtt);
  if (req.method === 'PUT' && url.pathname === '/api/platform/mqtt') {
    if (body.host !== undefined) state.mqtt.host = body.host;
    if (body.port !== undefined) state.mqtt.port = body.port;
    if (body.username !== undefined) state.mqtt.username = body.username;
    if (body.password !== undefined) state.mqtt.password = body.password;
    if (body.tls !== undefined) state.mqtt.tls = !!body.tls;
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/platform/migrations') {
    return send(res, 200, { tenantMode: true, expected: 46, newest: 'migrate-v46.sql', control: { db: 'iothub', applied: 46, pending: [] }, orgs: [{ orgId: 'org-9', name: 'Acme', db: 'iothub_org_9', onControlDb: false, applied: 44, pending: ['migrate-v45.sql', 'migrate-v46.sql'], error: null }], orgsBehind: 1, controlBehind: 0, canRun: true });
  }
  // Byte-for-byte the REAL migrationsRunFunc's 502 path (generate-nodered-
  // backend.mjs): when fetch() to the migrate service itself throws/times
  // out, it sends msg.payload={error:'...'} — ONLY that field, no ok/
  // migrated/failed/skipped. An earlier version of this mock sent the full
  // safe shape here, which is why api.runMigrations() blindly trusting the
  // body (`if (body) return body`) never got caught until it hit a real
  // 502 in production and MigrationsPanel's `r.failed.length` threw on the
  // missing field.
  if (req.method === 'POST' && url.pathname === '/api/platform/migrations/run') {
    return send(res, 502, { error: 'could not reach the migrate service: fetch failed' });
  }
  if (req.method === 'GET' && url.pathname === '/api/platform/stats') {
    return send(res, 200, { orgs: 2, devices: 1, online: 1, alarms: 0, critical: 0, degraded: [], status: 'OPERATIONAL' });
  }

  // Permissive fallback: anything else (PhotoStrip, audit log, etc.) gets an
  // empty-but-valid answer rather than a 404 that could mask a real failure
  // behind console noise.
  if (req.method === 'GET') return send(res, 200, []);
  return send(res, 200, { ok: true });
});

// Stand-in for Node-RED's /ws/telemetry bridge. Frames are driven by the test
// over a tiny control endpoint rather than on a timer, so assertions are
// deterministic instead of racing a heartbeat.
const wss = new WebSocketServer({ server, path: '/ws/telemetry' });
wss.on('connection', (sock) => {
  wsClients.add(sock);
  sock.on('close', () => wsClients.delete(sock));
  sock.on('message', () => { /* the frontend sends {token} first; nothing to verify here */ });
});

server.listen(4001, () => console.log('mock backend on :4001 (+ ws /ws/telemetry)'));
