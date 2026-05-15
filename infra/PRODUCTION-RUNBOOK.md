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
phpmyadmin.thermexpertise.com A  <VPS_IP>
emqx.thermexpertise.com      A   <VPS_IP>
```

Verify locally:
```bash
for s in '' www. argocd. grafana. nodered. phpmyadmin. emqx.; do
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

| Service | URL | Login |
|---|---|---|
| ArgoCD | `https://argocd.thermexpertise.com` | `admin` / see `/root/.carbon-credit-secrets.txt` |
| Grafana | `https://grafana.thermexpertise.com` | `admin` / `iothub.2026` |
| Node-RED | `https://nodered.thermexpertise.com` | `admin` / `iothub.2026` |
| phpMyAdmin | `https://phpmyadmin.thermexpertise.com` | BasicAuth: `admin` / `iothub.2026`, then DB: `root` / `iothub.2026` |
| WordPress | `https://thermexpertise.com` | `admin` / `iothub.2026` |
| EMQX dashboard | `https://emqx.thermexpertise.com` | `admin` / `iothub.2026` |
| EMQX MQTT | `tcp://<VPS_IP>:1883`, `tls://<VPS_IP>:8883` | per-device JWT (via backend) |
| aaPanel | `http://<VPS_IP>:<bt_port>` | `admin` / `iothub.2026` |

All passwords are recorded in `/root/.carbon-credit-secrets.txt` (chmod 600).

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
