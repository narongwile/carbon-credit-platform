# ONEOPS Backend (alarm/telemetry service)

Express REST API + MQTT ingest + **alarm engine** + MySQL, designed to run
in-cluster alongside **Node-RED** and **MySQL** (`mysql.data.svc.cluster.local:3306`,
user `admin`). The same alarm engine as the frontend (`src/server/alarmEngine.ts`)
runs server-side, so device → edge → server all evaluate identically.

## Data flow
```
Device ──MQTT(telemetry/#)──▶ Node-RED ──HTTP POST /api/nodes/:id/readings──▶ backend
                                                        │
backend also subscribes to MQTT directly ◀─────────────┘
   └─ persist reading → load saved rule → ENGINE.evaluate → insert NEW events
        → dispatch notifications (Email/LINE/Telegram/Google Chat)
escalation loop: unacked CRITICAL > N min → re-dispatch (escalation)
```

## Run
```bash
cp .env.example .env          # defaults already target the cluster MySQL/MQTT
mysql < sql/schema.sql        # create core schema (+ device_presence)
mysql < sql/bloodbox.sql      # BloodBOX domain tables (run after schema.sql)
mysql < sql/seed-nodes.sql    # optional: demo fleet so /api/fleet has data
npm install && npm run dev    # or: npm run build && npm start
```
Docker: `docker build -t oneops-backend .`  ·  k8s: `kubectl apply -f k8s/backend.yaml`

### Node-RED — you do NOT hand-build the flow
The flow is generated, not drawn by hand:
```bash
npm run flows        # regenerate node-red/flows.json (override BACKEND_URL / MQTT_HOST / MQTT_PORT / MQTT_TOPIC via env)
```
Then in Node-RED: **Menu → Import → select `node-red/flows.json` → Deploy**. It wires
`telemetry/#` → normalize → `POST /api/nodes/:id/readings`, plus a debug node, an
error catch, and a manual "Simulate reading" inject for testing without a broker.

### Option B — Node-RED as the WHOLE backend (no Express service)
If you prefer one tool, generate an all-in-one Node-RED backend (MQTT + alarm
engine + MySQL + REST API + notifications + escalation + **BloodBOX domain**,
all inside Node-RED):
```bash
npm run flows:backend     # → node-red/flows.nodered-backend.json
```
This flow serves the full REST surface — including the BloodBOX endpoints
(`/api/bloodbox/transits`, `/journey`, `/floors`, `/beacons`, `/boxes/:id/location`) —
so it is feature-equivalent to the Express service. Run `sql/bloodbox.sql` first.
Requires in Node-RED: `functionExternalModules: true` in settings.js and the
`mysql2` + `nodemailer` modules (pre-declared on the relevant function nodes),
plus the same `DB_*`, `SMTP_*` and channel env vars on the Node-RED process.
Notifications route **per-tenant** through the `notification_channels` table
(org + department + `min_severity` filter) and support **Email/LINE/Telegram/
Google Chat** — full parity with the Express service; the env tokens act as a
single-destination fallback when no DB channels exist. Trade-off: faster to run,
but the alarm engine lives as JS inside a function node (loses the TypeScript
types / unit tests / sharing with the frontend that the Express service keeps).

## REST API
| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | liveness + DB ping |
| GET/PUT | `/api/nodes/:id/rule` | get/save a node's alarm rule (engine config) |
| PUT  | `/api/orgs/:orgId/rule` | **apply one rule to every org node of a domain** (admin) |
| GET  | `/api/nodes/:id/events` | engine-emitted events |
| POST | `/api/events/:id/ack` | acknowledge `{ by, eventProblemId }` |
| GET/POST | `/api/nodes/:id/readings` | read / ingest telemetry `{ values, ts }` |
| GET/POST | `/api/nodes/:id/documents` | department-scoped documents |
| GET  | `/api/fleet?orgId=&domain=` | **fleet list (all products)** — nodes + presence + open-alarm severity (powers transformer & refrigeration overviews) |
| GET  | `/api/fleet/:id/latest` | latest reading per channel for one node |
| GET  | `/api/bloodbox/transits?orgId=` | BloodBOX cold-chain transits |
| POST | `/api/bloodbox/transits/:id/temp` | **report transit temp → bridged into the alarm engine** (excursion alerts in transit) |
| GET/POST | `/api/bloodbox/transits/:id/journey` | indoor journey events (scan log; a scan carrying `tempC` is bridged into the engine too) |
| GET  | `/api/bloodbox/floors?orgId=` | building floors |
| GET/POST/DELETE | `/api/bloodbox/beacons` | BLE beacon management (indoor anchors) |
| GET/POST | `/api/bloodbox/boxes/:id/location` | current indoor location / move box |

## Presence / offline detection
The ESP32 `P/status` (birth/will) and `P/heartbeat` messages are routed by the
Node-RED `normalize` node to a **presence** handler that upserts `device_presence`
(`online`, `last_seen`, `rssi`, `batt`, `fw`). A 60 s **offline sweep** marks any
device unseen for more than `OFFLINE_AFTER_S` (default 90 s) offline, raises a
CRITICAL `offline` event, and dispatches it through the same per-tenant notify
path as any alarm. (Presence handling lives in the Node-RED backend flow; the
Express service ingests readings — add the same sweep there if you run Express.)

## Device firmware (ESP32-S3)
The ESP32 firmware in [`firmware/esp32`](../firmware/esp32) publishes the spec
per-channel telemetry envelope (`{device_id, channel, value, ...}`). The Node-RED
`normalize` node accepts it directly, maps spec channel names → alarm-engine param
keys (`oil_temp_c→oilTemp`, `dga_h2_ppm→hydrogen`, `temp_c→tempHigh+tempLow`, …),
and feeds `ingest → evaluate`. Point the device at `telemetry/#` (set
`OO_TOPIC_ROOT "telemetry"`); `device_id` must match a provisioned node id.

## Frontend wiring
Set `NEXT_PUBLIC_API_URL` (e.g. `https://api.oneops.example`). The frontend
`src/lib/api.ts` + `src/server/alarmStore.ts` sync rules/acks through this API and
fall back to localStorage when it is unreachable (so the static build still works).

## Notifications
Fill the channel env vars (SMTP / LINE Notify / Telegram bot / Google Chat
webhook) to enable real delivery; unset channels are skipped with a log line.
