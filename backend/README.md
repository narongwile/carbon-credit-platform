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
mysql < sql/schema.sql        # create schema
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
engine + MySQL + REST API + notifications + escalation, all inside Node-RED):
```bash
npm run flows:backend     # → node-red/flows.nodered-backend.json
```
Requires in Node-RED: `functionExternalModules: true` in settings.js and the
`mysql2` module (pre-declared on the init function node), plus the same `DB_*`
and channel env vars on the Node-RED process. Trade-off: faster to run, but the
alarm engine lives as JS inside a function node (loses the TypeScript types /
unit tests / sharing with the frontend that the Express service keeps).

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

## Frontend wiring
Set `NEXT_PUBLIC_API_URL` (e.g. `https://api.oneops.example`). The frontend
`src/lib/api.ts` + `src/server/alarmStore.ts` sync rules/acks through this API and
fall back to localStorage when it is unreachable (so the static build still works).

## Notifications
Fill the channel env vars (SMTP / LINE Notify / Telegram bot / Google Chat
webhook) to enable real delivery; unset channels are skipped with a log line.
