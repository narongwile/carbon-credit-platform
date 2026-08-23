# Production Deployment Runbook

End-to-end VPS bring-up for the Carbon Credit Platform on Ubuntu 24.04.3 LTS.

The orchestrator is [`infra/scripts/prod-deploy.sh`](scripts/prod-deploy.sh).
Each phase is **idempotent** — safe to re-run.

---

## 0. Pre-flight (from your laptop)

| Item | Required value |
|---|---|
| VPS | Ubuntu 24.04.3 LTS, ≥4 vCPU, ≥8 GB RAM, ≥40 GB disk |
| Domain | DNS provider you control |
| SSH key | `ssh-keygen -t ed25519 -C "you@laptop"` if you don't have one |
| Local tools | `ssh`, `dig` (optional, for DNS check) |

### 0.1 Create DNS records (TTL 300)

Point all of these `A` records to your VPS's public IPv4:

```
thermexpertise.com           A   <VPS_IP>
www.thermexpertise.com       A   <VPS_IP>
argocd.thermexpertise.com    A   <VPS_IP>
grafana.thermexpertise.com   A   <VPS_IP>
nodered.thermexpertise.com   A   <VPS_IP>
pma.thermexpertise.com A  <VPS_IP>
emqx.thermexpertise.com      A   <VPS_IP>
# Optional — only needed if you opt into BRIDGE_AAPANEL=1 (not recommended):
# aapanel.thermexpertise.com  A   <VPS_IP>
```

> **Why is `aapanel.${DOMAIN}` missing?** aaPanel is intentionally kept
> **outside** k3s as an out-of-band admin tool — if k3s/Traefik dies, you still
> need aaPanel + SSH to recover. Routing aaPanel through the very system it's
> meant to recover creates a chicken-and-egg failure mode. Reach it directly
> at `http://<VPS_IP>:<bt_port>`.

Verify locally:
```bash
for s in '' www. argocd. grafana. nodered. pma. emqx.; do
  echo -n "${s}thermexpertise.com → "; dig +short "${s}thermexpertise.com" @1.1.1.1
done
```

---

## 1. Copy the repo to the VPS

```bash
# From your laptop:
ssh root@<VPS_IP>
# On the VPS:
apt-get update -qq && apt-get install -y -qq git
git clone https://gitlab.com/narongwile/carbon-credit-platform.git /opt/carbon-credit-platform
cd /opt/carbon-credit-platform/infra
chmod +x scripts/prod-deploy.sh deploy-bootstrap.sh
```

---

## 2. Run phases — production sequence

> **Choose between two modes:**
> - **Manual gated** (recommended for first deploy) — run each phase, inspect, then proceed.
> - **One-shot** — `sudo ./scripts/prod-deploy.sh all` (skip last `harden` until SSH key confirmed).

### Phase 1 — PREPARE  (≈ 2 min)
Hardens the VPS: hostname, timezone, swap, kernel sysctls, deploy user with SSH key.

```bash
sudo \
  SSH_PUBKEY="ssh-ed25519 AAAA... you@laptop" \
  DEPLOY_USER=deploy \
  HOSTNAME_FQDN=vps.thermexpertise.com \
  TIMEZONE=Asia/Bangkok \
  ./scripts/prod-deploy.sh prepare
```

**Gate**: open a NEW terminal and test `ssh deploy@<VPS_IP>` — make sure key auth works.

### Phase 2 — DNS-CHECK  (≈ 5 s)
Fails fast if any required A record is missing or wrong. Let's Encrypt will fail without these.

```bash
sudo DOMAIN=thermexpertise.com ./scripts/prod-deploy.sh dns-check
# To override (not recommended): FORCE_DNS=1 ...
```

### Phase 3 — BOOTSTRAP  (≈ 8–12 min)
Runs `deploy-bootstrap.sh`: K3s, ArgoCD, cert-manager, seeded secrets, root App-of-Apps.

```bash
sudo \
  DOMAIN=thermexpertise.com \
  LE_EMAIL=admin@thermexpertise.com \
  ADMIN_USER=admin \
  ADMIN_PASSWORD='iothub.2026' \
  INSTALL_AAPANEL=1 \
  ./scripts/prod-deploy.sh bootstrap
```

> ⚠️ **Change `ADMIN_PASSWORD`** for real production. The default `iothub.2026`
> is fine for staging/dev only.

### Phase 4 — VERIFY  (waits up to 20 min)
Polls ArgoCD until every Application is `Synced + Healthy`; reports pods, certs, ingresses.

```bash
sudo ./scripts/prod-deploy.sh verify
```

You should see something like:
```
NAME         SYNC     HEALTH
emqx         Synced   Healthy
grafana      Synced   Healthy
mysql        Synced   Healthy
nodered      Synced   Healthy
phpmyadmin   Synced   Healthy
wordpress    Synced   Healthy
```

### Phase 5 — SMOKE  (≈ 30 s)
Functional tests: HTTPS reachability, Grafana admin login, phpMyAdmin BasicAuth, EMQX MQTT pub/sub, MySQL SELECT 1.

```bash
sudo \
  DOMAIN=thermexpertise.com \
  ADMIN_USER=admin \
  ADMIN_PASSWORD='iothub.2026' \
  ./scripts/prod-deploy.sh smoke
```

### Phase 6 — HARDEN  (≈ 5 s, run LAST)
Disables SSH password auth completely (key-only). **Run this only after you've
confirmed `ssh deploy@<VPS>` with the key works.**

```bash
sudo DEPLOY_USER=deploy ./scripts/prod-deploy.sh harden
```

---

## 3. Access URLs

Every service is reachable **two ways** — pick whichever is easier.

| Service | Domain (HTTPS + LE) | Direct IP (NodePort) | Login |
|---|---|---|---|
| ArgoCD | `https://argocd.thermexpertise.com` | `http://<VPS_IP>:30880` | `admin` / see `/root/.carbon-credit-secrets.txt` |
| aaPanel | `https://aapanel.${DOMAIN}` *(opt-in via `EDGE_PROXY=nginx`)* | `http://<VPS_IP>:8888` | `admin` / `iothub.2026` |
| EMQX Dashboard | `https://emqx.thermexpertise.com` | `http://<VPS_IP>:18083` | `admin` / `iothub.2026` |
| EMQX MQTT | — | `tcp://<VPS_IP>:1883`  ← DNATed | per-device JWT (via backend) |
| EMQX MQTT (direct) | — | `tcp://<VPS_IP>:31883` | per-device JWT |
| EMQX MQTTS | — | `tls://<VPS_IP>:8883`  ← DNATed | per-device JWT |
| EMQX MQTTS (direct) | — | `tls://<VPS_IP>:38883` | per-device JWT |
| EMQX API | — | `http://<VPS_IP>:30081` | `admin` / `iothub.2026` |
| Grafana | `https://grafana.thermexpertise.com` | `http://<VPS_IP>:3000` | `admin` / `iothub.2026` |
| Node-RED | `https://nodered.thermexpertise.com` | `http://<VPS_IP>:1880` | `admin` / `iothub.2026` |
| phpMyAdmin | `https://pma.thermexpertise.com` (Traefik BasicAuth) | `http://<VPS_IP>:30808` (no BasicAuth) | DB: `root` / `iothub.2026` |
| WordPress | `https://thermexpertise.com` | `http://<VPS_IP>:30088` | `admin` / `iothub.2026` |
| MySQL | — | `kubectl -n data port-forward svc/mysql 3306:3306` then `mysql://localhost:3306` | `root` / `iothub.2026` |

> **Domain vs IP — what's the difference?**
> - Domain: full HTTPS with valid Let's Encrypt cert + Traefik middleware
>   (e.g. phpMyAdmin BasicAuth). Use this in production-facing tools.
> - Direct IP: plain HTTP (no TLS), bypasses Traefik middleware. Use for
>   emergency/admin access when DNS is down or for quick smoke tests.

> **Security note on `phpMyAdmin` via IP**: the NodePort `:30808` skips the
> Traefik BasicAuth gate. phpMyAdmin's own login still requires MySQL
> credentials, but you lose the extra layer + Traefik rate-limit. Consider
> restricting `:30808` via UFW source-IP rules in production.

All passwords are recorded in `/root/.carbon-credit-secrets.txt` (chmod 600).

---

## 3a. Architecture decision: aaPanel sits OUTSIDE k3s

```
              ┌────────────────────────────────────────────┐
              │                  VPS host                  │
              │                                            │
   internet ──┼─►  :80, :443  ─►  k3s + Traefik  ─►  apps  │  ← platform plane
              │                                            │
              │            (independent)                   │
              │                                            │
   internet ──┼─►  :8888    ─►  aaPanel              ─►    │  ← admin plane
              │   (SSH :22) ─►  sshd                       │
              └────────────────────────────────────────────┘
```

**The two planes never talk to each other.** This is deliberate:

1. **Failure isolation** — if Traefik/k3s breaks, you still have aaPanel (and
   SSH) to debug and recover. The admin escape hatch must not depend on the
   system it is used to fix.
2. **No bootstrap-order coupling** — aaPanel runs whether or not k3s is up.
3. **Independent lifecycles** — GitOps drives k3s; aaPanel updates itself.
4. **Conceptual clarity** — "Is aaPanel part of the platform?" Answer: no.
   It's host infrastructure, like SSH or systemd.

### Five ways to reach aaPanel (pick one)

| Option | Mode | URL | Failure isolation |
|---|---|---|---|
| **A** *(default)* | direct IP only | `http://<VPS_IP>:8888` | ✅ fully isolated |
| **D-nginx** ⭐ *(RECOMMENDED)* | **nginx** as edge proxy on :80/:443 | `https://aapanel.${DOMAIN}` ← no port | ✅ |
| D-caddy | Caddy as edge proxy on :80/:443 | `https://aapanel.${DOMAIN}` ← no port | ✅ |
| B | Caddy sidecar on host (:8443) | `https://aapanel.${DOMAIN}:8443` ← has port | ✅ |
| C | k3s bridge | `https://aapanel.${DOMAIN}` | ❌ couples failure domains |

```bash
# Option D-nginx — nginx as edge proxy (RECOMMENDED — clean URLs, industry standard)
sudo \
  EDGE_PROXY=nginx \
  INSTALL_AAPANEL=1 \
  DOMAIN=thermexpertise.com \
  LE_EMAIL=admin@thermexpertise.com \
  ./scripts/prod-deploy.sh bootstrap

# Option D-caddy — Caddy as edge proxy (alternative, simpler config)
sudo EDGE_PROXY=caddy INSTALL_AAPANEL=1 ./scripts/prod-deploy.sh bootstrap

# Option B — Caddy sidecar (URL has :8443)
sudo AAPANEL_TLS=caddy INSTALL_AAPANEL=1 ./scripts/prod-deploy.sh bootstrap

# Option C — k3s bridge (NOT recommended)
sudo BRIDGE_AAPANEL=1 INSTALL_AAPANEL=1 ./scripts/prod-deploy.sh bootstrap
```

### Option D-nginx (recommended) — what happens

1. Traefik moves from `hostPort 80/443` → `NodePort 32080/32443` (no longer public)
2. nginx installs on host via apt, takes over `:80` and `:443` as the **only** public edge
3. nginx vhosts in `/etc/nginx/sites-available/edge.conf`:
   - `aapanel.${DOMAIN}` → `proxy_pass http://127.0.0.1:8888` (aaPanel direct — bypasses k3s)
   - everything else → `proxy_pass http://127.0.0.1:32080` (Traefik NodePort)
4. `certbot --nginx` issues real Let's Encrypt certs for all subdomains (HTTP-01)
5. certbot auto-renewal via `certbot.timer` (systemd)
6. UFW DENIES `:32080/:32443` externally → Traefik only reachable from `127.0.0.1`
7. **Every URL becomes clean**: `https://grafana.${DOMAIN}` (no `:30030`, no `:8443`)
8. Failure isolation preserved: nginx route to aaPanel doesn't go through k3s

### Why nginx over Caddy (for this project)

| | nginx | Caddy |
|---|---|---|
| Team familiarity | ✅ everyone reads nginx config | learning curve |
| aaPanel uses it | ✅ same mental model | different |
| Industry standard | ✅ AWS/GCP/CF reference docs | growing |
| Modules / ecosystem | ✅ vast | smaller |
| LE auto-renewal | certbot.timer (systemd, standard) | built-in |
| Config size for this task | ~25 lines | ~10 lines |
| Debug tools | `nginx -T/-t`, error.log | `caddy validate`, journalctl |

In both B and C you'll need a DNS A record:
```
aapanel.thermexpertise.com  A  <VPS_IP>
```

**Why Caddy (Option B) is the recommended HTTPS path:**
- Caddy runs as its own host systemd service — totally independent of k3s
- Auto-LE via DNS-01 (no port 80 conflict with Traefik)
- 3-line config; no nginx/certbot complexity
- If k3s/Traefik dies, Caddy → aaPanel still works
- If Caddy dies, direct `http://<IP>:8888` still works

---

## 3b. Connecting MQTT devices to EMQX

EMQX accepts connections out-of-the-box from any device, anywhere, using the
shared `device` credential. Every device must use a unique `clientid` —
the ACL restricts each device to its own topic namespace.

### Credentials

| User | Password | Permissions |
|---|---|---|
| `admin`  | `iothub.2026` | full access (`#`) — for backend services and ops tools |
| `device` | `iothub.2026` | scoped by clientid — see the topic table and the warning below it |

> ⚠️ **One shared login for the entire fleet.** Every device authenticates as
> `device` with the same password, so recovering it from a single board in the
> field (flash dumps are not hard) yields the whole fleet, and there is no
> per-device revocation. Step 5 of the rollout below replaces this.

### Endpoints

| Protocol | URL | Notes |
|---|---|---|
| MQTT (plain TCP) | `tcp://<VPS_IP>:1883` | LAN/VPN/dev; or `:31883` direct NodePort |
| MQTT over TLS    | `tls://<VPS_IP>:8883` | production — uses CA from `/opt/emqx/etc/certs/` |
| MQTT over WebSocket (plain) | `ws://<VPS_IP>:30083/mqtt` | browser dev |
| MQTT over WebSocket (TLS)   | `wss://<VPS_IP>:30084/mqtt` | browser prod |

### Topic naming convention

```
telemetry/<orgId>/<product>/<nodeId>[/...]   ← what the fleet actually uses
devices/<clientid>/...        device publishes its own data
sensors/<clientid>/...        sensor readings
cmd/<clientid>/...            commands TO the device (subscribe)
config/<clientid>/...         config push TO the device (subscribe)
broadcast/...                 broadcast to all devices (subscribe-only)
```

The ingest path is `telemetry/<orgId>/<product>/<nodeId>` — four segments,
with the node id LAST. `worker/main.go`'s `autoRegisterPending` parses the org
and product out of it, and `topicNodeID` reads the id from position 3. Real
frames look like `telemetry/org-1/eternity/tr-111`, and alarm subtopics extend
it (`telemetry/org-1/eternity/tr-222/alarm/hydrogen`) without moving the id.

`<clientid>` is the MQTT `clientId` set by the device on connect, and the ACL
scopes each device to its own topics with it.

> **Read this before trusting the line above.** Until the ACL fix that ships
> with `topicNodeID`, this section claimed the scoping was enforced while the
> production `acl.conf` actually granted `device` the open wildcards
> `publish telemetry/#, sensors/#, transformers/#` and
> `subscribe cmd/#, config/#, telemetry/#`. Any device could therefore publish
> as any node in any org, and read the whole multi-tenant fleet's telemetry.
> The UAT file was scoped but pinned the clientid at the wrong position
> (`telemetry/${clientid}/#`), so it matched nothing real.
>
> Two further limits still apply, and neither is closed by the ACL alone:
>
> 1. **The ACL binds a clientid, not an identity.** Every device shares the one
>    `device` login, so a client may present any clientid it likes. Scoping
>    bounds accidental cross-talk between honest devices; it does not stop
>    someone who has the shared password. Per-device credentials are what turn
>    `${clientid}` into an authenticated claim — see the rollout below.
> 2. **MQTT authorises the TOPIC, never the payload.** The broker cannot see
>    the `nodeId` inside a frame, so a device allowed onto its own topic could
>    still name another node in the body. `worker/main.go` now rejects any
>    frame whose payload `nodeId` disagrees with its topic
>    (`MQTT_IDENTITY_ENFORCE=warn` downgrades this to log-only for a migration
>    window; the heartbeat line reports `identity-mismatch` counts either way).

### Hardening rollout — order matters

Applying the scoped ACL before confirming clientids will disconnect the fleet.

1. **Verify the assumption first.** The scoped rules require
   `clientid == nodeId`. Check what is actually connected — EMQX Dashboard →
   Clients, or:
   ```bash
   curl -s -u "$APIKEY_ID:$APIKEY_SECRET" \
     "https://emqx.thermexpertise.com/api/v5/clients?limit=1000" \
     | jq -r '.data[] | "\(.clientid)\t\(.username)"' | sort
   ```
   Any device whose clientid is not its node id will be denied by the new ACL.
   Fix those first (firmware) or the fleet drops when you apply it.
2. **Arm the payload check in warn mode.** Deploy the worker with
   `MQTT_IDENTITY_ENFORCE=warn` and watch a few heartbeat lines. A steady
   `0 identity-mismatch` means no device disagrees with its own topic.
3. **Switch it to enforce** (the default — remove the env var).
4. **Apply the scoped ACL**, then confirm every device reconnects and
   `ingest … N readings` keeps climbing.
5. **Per-device credentials.** Issue one per node at approval time via the
   same EMQX REST endpoint the seed Job already uses
   (`POST /api/v5/authentication/password_based:built_in_database/users`),
   push it to the device over `config/<clientid>/`, and narrow the shared
   `device` login to bootstrap only. This is what actually authenticates a
   device — and it must be provisioned **per board after flashing**, not baked
   into a firmware image, or two boards from the same image still share one
   identity.
6. **Move devices to TLS 8883.** The listener already exists; `1883` sends the
   shared password in clear.

### Quick test (laptop → VPS)

```bash
# Install mosquitto-clients (Ubuntu/Debian)
sudo apt install mosquitto-clients

# Subscribe to commands for clientid esp32-001
mosquitto_sub -h <VPS_IP> -p 1883 \
  -u device -P 'iothub.2026' \
  -i esp32-001 \
  -t 'cmd/esp32-001/#' -v

# In another terminal — publish a temperature reading
mosquitto_pub -h <VPS_IP> -p 1883 \
  -u device -P 'iothub.2026' \
  -i esp32-001 \
  -t devices/esp32-001/temperature \
  -m '{"value":24.5,"unit":"C","ts":1700000000}' -q 1

# TLS variant (production)
mosquitto_pub -h <VPS_IP> -p 8883 \
  --cafile /path/to/ca.crt \
  -u device -P 'iothub.2026' \
  -i esp32-001 -t devices/esp32-001/temperature -m '24.5' -q 1
```

### Example device code (ESP32 / Arduino PubSubClient)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
WiFiClient   wifi;
PubSubClient mqtt(wifi);

const char* MQTT_HOST = "your.vps.ip";
const int   MQTT_PORT = 1883;
const char* CLIENT_ID = "esp32-001";        // unique per device
const char* MQTT_USER = "device";
const char* MQTT_PASS = "iothub.2026";

void setup() {
  // ... WiFi.begin() ...
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.connect(CLIENT_ID, MQTT_USER, MQTT_PASS);
  mqtt.subscribe("cmd/esp32-001/#");
}

void loop() {
  mqtt.loop();
  mqtt.publish("devices/esp32-001/temperature", "24.5");
  delay(5000);
}
```

### Managing users beyond the bootstrap pair

The bootstrap CSV is read **once** on EMQX's first start. After that, manage
users via the dashboard (`https://emqx.${DOMAIN}`) or REST API:

```bash
# Add a new device user (per-device credentials)
curl -u "admin:iothub.2026" \
  -X POST https://emqx.thermexpertise.com/api/v5/authentication/password_based%3Abuilt_in_database/users \
  -H 'content-type: application/json' \
  -d '{"user_id":"esp32-002","password":"<strong-random>"}'
```

For production, **migrate from the shared `device` credential to per-device
credentials** — this is the single highest-value security upgrade for IoT.

---

## 4. GitOps workflow (post-deploy)

Everything is now driven by Git. To change a service:

```bash
# On your laptop:
git clone https://gitlab.com/narongwile/carbon-credit-platform.git
cd carbon-credit-platform
$EDITOR infra/helm-values/grafana-values.yaml   # bump replicas, add datasource, etc.
git commit -am "grafana: bump replicas to 2"
git push origin main
# ArgoCD auto-syncs within ~3 min. Watch:
ssh deploy@<VPS>  "k3s kubectl get app -n argocd -w"
```

To add a brand-new service: drop an `Application` YAML into
`infra/argocd/platform-stack/` and a corresponding values file under
`infra/helm-values/`. The root App-of-Apps picks it up automatically.

---

## 5. Troubleshooting

| Symptom | First thing to check |
|---|---|
| `Phase 2 dns-check` fails | DNS A records — wait for TTL, recheck with `dig` |
| Certs stuck `Ready=False` | `kubectl describe certificate -A` — usually DNS or HTTP-01 reachability |
| Pod `ImagePullBackOff` | `kubectl describe pod -n <ns> <pod>` — registry creds or image tag |
| ArgoCD app `OutOfSync` | Git push didn't reach; manually `argocd app sync <name>` or `kubectl -n argocd patch app …` |
| MySQL pod `CrashLoopBackOff` | Wrong secret keys; check `kubectl logs -n data mysql-0` |
| EMQX dashboard rejects login | Did `envFromSecret: emqx-dashboard` get applied? `kubectl get pod -n data <emqx> -o yaml \| grep -A2 envFrom` |
| SSH locked out | Use VPS provider's console (Hetzner/OVH/etc.) to re-enable password auth or re-add key |

---

## 6. Rollback

ArgoCD makes rollback trivial:

```bash
# Roll a single app back to a previous Git revision:
git revert <bad-commit>
git push origin main
# ArgoCD reconciles within 3 minutes.

# OR via ArgoCD UI / CLI for a specific sync:
argocd app history grafana
argocd app rollback grafana <revision>
```

Cluster-level disaster recovery: re-run `bootstrap` against a fresh VPS. PVCs
are local-path — restore from your backup target (set up separately).
