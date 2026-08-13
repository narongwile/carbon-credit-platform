#!/usr/bin/env bash
# ============================================================
# Carbon Credit Platform — GitOps Bootstrap (v3)
# Target: Ubuntu 24.04.3 LTS (single-node)
#
# Philosophy:
#   This script ONLY bootstraps. It installs K3s + ArgoCD,
#   seeds shared secrets, then applies the root App-of-Apps.
#   Everything else (EMQX, MySQL, Grafana, phpMyAdmin, Node-RED,
#   WordPress) is reconciled by ArgoCD from Git. No imperative
#   `kubectl apply` of workloads. No drift.
#
# Idempotent. Re-runnable. Safe.
#
# Usage:
#   sudo ./deploy-bootstrap.sh                  # full bootstrap
#   sudo INSTALL_AAPANEL=1 ./deploy-bootstrap.sh # also install aaPanel
#   sudo PRESERVE_AAPANEL_WEB=1 ./deploy-bootstrap.sh # keep host nginx
# ============================================================
set -euo pipefail

# ── Constants ────────────────────────────────────────────────
readonly INSTALL_K3S_VERSION="${INSTALL_K3S_VERSION:-v1.31.6+k3s1}"
readonly ARGOCD_VERSION="${ARGOCD_VERSION:-v2.13.2}"
readonly CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.16.2}"
readonly DOMAIN="${DOMAIN:-thermexpertise.com}"
readonly LE_EMAIL="${LE_EMAIL:-admin@${DOMAIN}}"
readonly REPO_URL="${REPO_URL:-https://gitlab.com/narongwile/carbon-credit-platform.git}"
readonly REPO_BRANCH="${REPO_BRANCH:-main}"
readonly REPO_DIR="/opt/carbon-credit-platform"
readonly SECRETS_LOG="/root/.carbon-credit-secrets.txt"
readonly KUBECTL="k3s kubectl"

# ── Fixed admin credentials (override with env vars in production!) ──
readonly ADMIN_USER="${ADMIN_USER:-admin}"
readonly ADMIN_PASSWORD="${ADMIN_PASSWORD:-iothub.2026}"

# ── Colors ───────────────────────────────────────────────────
readonly G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' C='\033[0;36m' N='\033[0m'
log()  { echo -e "${G}[✓]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*" >&2; }
info() { echo -e "${C}[i]${N} $*"; }

# ── Helpers ──────────────────────────────────────────────────
gen_password() {
  # 24-char URL-safe random password
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 24 || true
}

record_secret() {
  # record_secret <label> <value>
  local label="$1" value="$2"
  printf '[%s] %s = %s\n' "$(date -Iseconds)" "$label" "$value" >>"${SECRETS_LOG}"
}

ensure_secret() {
  # ensure_secret <namespace> <name> <key1=val1> [<key2=val2> ...]
  # Creates the secret only if it does not already exist. Returns the
  # values via $RESULT (associative-style "key=value" lines).
  local ns="$1" name="$2"; shift 2
  if $KUBECTL get secret "$name" -n "$ns" &>/dev/null; then
    info "Secret ${ns}/${name} already exists — keeping"
    return 0
  fi
  local args=()
  for kv in "$@"; do args+=(--from-literal="${kv}"); done
  $KUBECTL create secret generic "$name" -n "$ns" "${args[@]}"
  log "Secret ${ns}/${name} created"
}

# ── Pre-flight ───────────────────────────────────────────────
preflight() {
  echo
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║   Carbon Credit Platform — GitOps Bootstrap (Ubuntu 24)  ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo

  [[ $EUID -eq 0 ]] || { err "Must run as root (use sudo)."; exit 1; }

  if ! grep -qE '^VERSION_ID="24\.' /etc/os-release 2>/dev/null; then
    warn "Not Ubuntu 24.x — proceeding anyway"
  else
    log "Ubuntu 24.x detected"
  fi

  local ram_mb disk_gb
  ram_mb=$(awk '/^MemTotal:/{printf "%d\n", $2/1024}' /proc/meminfo)
  (( ram_mb < 3500 )) && warn "RAM ${ram_mb}MB (recommend ≥4GB)" || log "RAM ${ram_mb}MB"

  disk_gb=$(df -BG --output=avail / | awk 'NR==2 {gsub(/G/,""); print $1}')
  (( disk_gb < 20 )) && { err "Disk ${disk_gb}GB free (need ≥20GB)"; exit 1; }
  log "Disk ${disk_gb}GB free"

  info "K3s ${INSTALL_K3S_VERSION} | ArgoCD ${ARGOCD_VERSION} | cert-manager ${CERT_MANAGER_VERSION}"
  info "Domain ${DOMAIN} | Repo ${REPO_URL}@${REPO_BRANCH}"
  echo
}

# ── Step 1: System packages ──────────────────────────────────
system_setup() {
  log "[1/8] Installing system packages…"
  export DEBIAN_FRONTEND=noninteractive

  apt-get update -qq
  # Ubuntu 24.04 cloud images may ship without rsyslog; install it so
  # /var/log/auth.log exists for fail2ban. Also pin iptables for k3s/nft.
  apt-get install -y -qq --no-install-recommends \
    curl git jq ufw fail2ban unattended-upgrades \
    ca-certificates gnupg lsb-release \
    rsyslog iptables apparmor apparmor-utils \
    >/dev/null

  # Unattended upgrades
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  # fail2ban — use systemd backend (Ubuntu 24 may not always have auth.log)
  if [[ ! -f /etc/fail2ban/jail.local ]]; then
    cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
backend = systemd
banaction = ufw
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
    systemctl enable --now fail2ban >/dev/null 2>&1 || warn "fail2ban not started"
  fi

  log "System packages OK"
}

# ── Step 2: Firewall ─────────────────────────────────────────
setup_firewall() {
  log "[2/8] Configuring UFW…"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null

  # Ingress (domain access via Traefik)
  ufw allow 22/tcp    comment 'SSH'             >/dev/null
  ufw allow 80/tcp    comment 'HTTP/Traefik'    >/dev/null
  ufw allow 443/tcp   comment 'HTTPS/Traefik'   >/dev/null
  # MQTT (standard ports — DNATed to NodePorts below)
  ufw allow 1883/tcp  comment 'EMQX MQTT'       >/dev/null
  ufw allow 8883/tcp  comment 'EMQX MQTTS'      >/dev/null
  # aaPanel admin (default 8888 — re-detected after install)
  ufw allow 8888/tcp  comment 'aaPanel'         >/dev/null

  # ── Service NodePorts — direct IP access for every service ──
  # http://VPS_IP:<port> works alongside the domain-based Traefik routes.
  # Standard ports (1880, 3000) — needs K3s service-node-port-range=1024-32767.
  ufw allow 1880/tcp  comment 'Node-RED NodePort'     >/dev/null
  ufw allow 3000/tcp  comment 'Grafana NodePort'      >/dev/null
  # Helper/admin NodePorts in 30xxx range
  ufw allow 30081/tcp comment 'EMQX API NodePort'     >/dev/null
  ufw allow 30083/tcp comment 'EMQX WS NodePort'      >/dev/null
  ufw allow 30084/tcp comment 'EMQX WSS NodePort'     >/dev/null
  ufw allow 30088/tcp comment 'WordPress NodePort'    >/dev/null
  ufw allow 18083/tcp comment 'EMQX Dashboard'        >/dev/null
  ufw allow 30443/tcp comment 'ArgoCD NodePort'       >/dev/null
  ufw allow 30808/tcp comment 'phpMyAdmin NodePort'   >/dev/null
  ufw allow 31883/tcp comment 'EMQX MQTT NodePort'    >/dev/null
  ufw allow 38883/tcp comment 'EMQX MQTTS NodePort'   >/dev/null

  # K3s API only from local + cluster CIDRs
  ufw allow from 127.0.0.0/8 to any port 6443 proto tcp comment 'K3s local'  >/dev/null
  ufw allow from 10.42.0.0/16 to any port 6443 proto tcp comment 'K3s pods'  >/dev/null
  ufw allow from 10.43.0.0/16 to any port 6443 proto tcp comment 'K3s svcs'  >/dev/null

  ufw --force enable >/dev/null
  log "UFW enabled"
}

# ── Step 3: Pre-empt host services that bind 80/443 ──────────
free_web_ports() {
  log "[3/8] Freeing host ports 80/443…"
  if [[ "${PRESERVE_AAPANEL_WEB:-0}" == "1" ]]; then
    warn "PRESERVE_AAPANEL_WEB=1 — leaving host nginx/apache running"
    warn "  → You MUST remap Traefik or aaPanel to non-conflicting ports."
    return
  fi
  # In EDGE_PROXY=nginx mode, nginx IS the edge — don't stop it.
  local skip_nginx=0
  [[ "${EDGE_PROXY:-}" == "nginx" ]] && skip_nginx=1

  local svc
  for svc in nginx apache2 httpd; do
    [[ "$svc" == "nginx" ]] && (( skip_nginx )) && { info "Keeping nginx (edge proxy)"; continue; }
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      warn "Stopping $svc (conflicts with edge proxy on 80/443)"
      systemctl disable --now "$svc" >/dev/null 2>&1 || true
    fi
  done
  # Host MySQL would conflict with k8s MySQL service externally — only stop
  # it if it actually binds 0.0.0.0:3306. Local-bound is fine.
  if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE '^0\.0\.0\.0:3306$'; then
    warn "Host MySQL bound 0.0.0.0:3306 — stopping (k8s runs MySQL in-cluster)"
    systemctl disable --now mysql mysqld 2>/dev/null || true
  fi
}

# ── Step 4: Install K3s ──────────────────────────────────────
install_k3s() {
  log "[4/8] Installing K3s…"

  # Pre-seed K3s config — extends NodePort range down to 1024 so we can use
  # the *standard* service ports (1880 for Node-RED, 3000 for Grafana, etc.).
  # This file is read by k3s on every start, so it survives re-installs.
  mkdir -p /etc/rancher/k3s
  cat >/etc/rancher/k3s/config.yaml <<'EOF'
# Managed by deploy-bootstrap.sh — edits here are overwritten on next run.
disable:
  - servicelb           # we use Traefik hostPort instead
write-kubeconfig-mode: "0644"
kube-apiserver-arg:
  - "service-node-port-range=1024-32767"
EOF
  log "K3s config → /etc/rancher/k3s/config.yaml (NodePort 1024-32767)"

  if command -v k3s &>/dev/null && systemctl is-active --quiet k3s; then
    info "K3s already installed ($(k3s --version | head -1)) — restarting to pick up config"
    systemctl restart k3s
  else
    # NOTE: INSTALL_K3S_VERSION is declared `readonly` at the top of this
    # script. The `VAR=value cmd` prefix form ALSO requires assignment, which
    # bash refuses for readonly vars. Export it instead so the subshell sees
    # it through the environment (no re-assignment needed).
    export INSTALL_K3S_VERSION
    curl -sfL https://get.k3s.io | sh -
  fi

  info "Waiting for node Ready…"
  local i=0
  until $KUBECTL wait --for=condition=Ready nodes --all --timeout=30s &>/dev/null; do
    (( ++i >= 20 )) && { err "K3s node not Ready after 10 min"; exit 1; }
    sleep 30
  done
  log "K3s Ready: $($KUBECTL get nodes --no-headers | awk '{print $1, $2}')"

  # Make kubectl/k9s discoverable for the operator
  install -m 0644 /etc/rancher/k3s/k3s.yaml /root/.kube/config 2>/dev/null \
    || { mkdir -p /root/.kube && cp /etc/rancher/k3s/k3s.yaml /root/.kube/config; }
  export KUBECONFIG=/root/.kube/config
}

# ── Step 5: Sync repo (for namespaces.yaml + Application manifests) ──
sync_repo() {
  log "[5/8] Syncing repo to ${REPO_DIR}…"
  if [[ -d "${REPO_DIR}/.git" ]]; then
    git -C "${REPO_DIR}" fetch --quiet origin
    git -C "${REPO_DIR}" reset --quiet --hard "origin/${REPO_BRANCH}"
  else
    git clone --quiet --branch "${REPO_BRANCH}" "${REPO_URL}" "${REPO_DIR}"
  fi
  log "Repo @ $(git -C "${REPO_DIR}" log --oneline -1)"
}

# ── Step 6: Namespaces + shared secrets ──────────────────────
seed_cluster() {
  log "[6/8] Applying namespaces + seeding secrets…"

  $KUBECTL apply -f "${REPO_DIR}/infra/k3s/namespaces.yaml"
  # Ensure all target namespaces exist (some Helm charts run before
  # Application-managed namespace creation completes).
  local ns
  for ns in argocd cert-manager monitoring data app web carbon-credit iiot-uat; do
    $KUBECTL create namespace "$ns" --dry-run=client -o yaml | $KUBECTL apply -f -
  done

  # Pre-create the secrets file with restrictive perms
  : >"${SECRETS_LOG}"
  chmod 600 "${SECRETS_LOG}"

  info "Using fixed credentials  user='${ADMIN_USER}'  password='${ADMIN_PASSWORD}'"
  info "(override with ADMIN_USER=… ADMIN_PASSWORD=… env vars)"

  # Make sure we have htpasswd/openssl for hash generation
  command -v htpasswd >/dev/null || apt-get install -y -qq apache2-utils >/dev/null
  command -v openssl  >/dev/null || apt-get install -y -qq openssl       >/dev/null

  local pw="${ADMIN_PASSWORD}"

  # ─ MySQL ─ chart: bitnami/mysql expects keys: mysql-root-password,
  #   mysql-replication-password, mysql-password
  ensure_secret data mysql-credentials \
    "mysql-root-password=${pw}" \
    "mysql-replication-password=${pw}" \
    "mysql-password=${pw}"
  record_secret "mysql root@data"        "${pw}"
  record_secret "mysql appuser@data"     "${pw} (user: app)"

  # ─ Grafana ─ chart: grafana/grafana expects keys: admin-user, admin-password
  ensure_secret monitoring grafana-admin \
    "admin-user=${ADMIN_USER}" "admin-password=${pw}"
  record_secret "grafana ${ADMIN_USER}@monitoring" "${pw}"

  # Grafana mounts mysql-credentials as a file (extraSecretMounts); must be in
  # namespace monitoring — cannot reference data/mysql-credentials cross-namespace.
  ensure_secret monitoring mysql-credentials \
    "mysql-password=${pw}" \
    "mysql-root-password=${pw}"

  # ─ EMQX dashboard (admin UI auth) ─
  ensure_secret data emqx-dashboard \
    "EMQX_DASHBOARD__DEFAULT_USERNAME=${ADMIN_USER}" \
    "EMQX_DASHBOARD__DEFAULT_PASSWORD=${pw}"
  record_secret "emqx dashboard ${ADMIN_USER}@data" "${pw}"

  # ─ EMQX MQTT bootstrap users (built-in database) ─
  # CSV format:   user_id,password    (plaintext on first import, hashed at rest)
  #   admin   — full access (backends, ops tools)
  #   device  — shared credential for all IoT devices; scoped via ACL
  #             devices publish/subscribe only to topics under their clientid
  if ! $KUBECTL get secret emqx-bootstrap-users -n data &>/dev/null; then
    local tmp_csv
    tmp_csv="$(mktemp)"
    cat >"${tmp_csv}" <<EOF
${ADMIN_USER},${pw}
device,${pw}
EOF
    $KUBECTL create secret generic emqx-bootstrap-users -n data \
      --from-file=users.csv="${tmp_csv}"
    rm -f "${tmp_csv}"
    record_secret "emqx MQTT ${ADMIN_USER}@data"  "${pw}  (full access)"
    record_secret "emqx MQTT device@data"          "${pw}  (scoped: devices/<clientid>/#)"
    log "EMQX bootstrap users secret created (admin + device)"
  else
    info "EMQX bootstrap users secret already exists — keeping"
  fi

  # ─ WordPress ─ bitnami/wordpress: wordpress-password, mariadb-password
  ensure_secret web wordpress-credentials \
    "wordpress-password=${pw}" \
    "mariadb-password=${pw}" \
    "mariadb-root-password=${pw}"
  record_secret "wordpress ${ADMIN_USER}@web" "${pw}"

  # ─ phpMyAdmin Basic Auth (Traefik middleware reads users=admin:apr1$…) ─
  local apr1; apr1="$(openssl passwd -apr1 "${pw}")"
  ensure_secret data phpmyadmin-basicauth \
    "users=${ADMIN_USER}:${apr1}"
  record_secret "phpmyadmin basic-auth ${ADMIN_USER}@data" "${pw}"

  # ─ Node-RED admin (httpAuth, bcrypt hash) ─
  local nr_hash
  nr_hash="$(htpasswd -bnBC 10 "" "${pw}" | tr -d ':\n')"
  ensure_secret carbon-credit node-red-auth \
    "username=${ADMIN_USER}" "password-bcrypt=${nr_hash}"
  record_secret "node-red ${ADMIN_USER}@carbon-credit" "${pw}"

  # ─ Mailpit UI/API basic auth (UAT mail sink) ─
  # The Deployment mounts this NON-optionally, so without it the pod sits in
  # ContainerCreating forever and UAT silently captures no mail at all. It has to
  # be a real credential, not a convenience: the captured mailbox holds live
  # password-reset tokens for the REAL customer addresses UAT shares with prod,
  # on a public nip.io host. Single htpasswd line — go-htpasswd (the library
  # Mailpit uses) reads exactly this bcrypt format.
  local mp_line
  mp_line="$(htpasswd -bnBC 10 "${ADMIN_USER}" "${pw}")"
  ensure_secret iiot-uat mailpit-auth "htpasswd=${mp_line}"
  record_secret "mailpit UI ${ADMIN_USER}@iiot-uat" "${pw}"

  log "Secrets seeded → ${SECRETS_LOG}"
}

# ── Step 7: ArgoCD + cert-manager + root App-of-Apps ─────────
install_gitops() {
  log "[7/8] Installing cert-manager + ArgoCD + root App-of-Apps…"

  # cert-manager (CRDs first; Applications can request Certificates afterwards)
  $KUBECTL apply --server-side -f \
    "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
  $KUBECTL -n cert-manager rollout status deploy/cert-manager        --timeout=180s
  $KUBECTL -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
  $KUBECTL -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=180s

  # Let's Encrypt ClusterIssuer (HTTP-01 via Traefik)
  cat <<EOF | $KUBECTL apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${LE_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod-account
    solvers:
      - http01:
          ingress:
            class: traefik
EOF

  # ArgoCD
  $KUBECTL apply -n argocd \
    -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"
  $KUBECTL -n argocd rollout status deploy/argocd-server      --timeout=300s
  $KUBECTL -n argocd rollout status deploy/argocd-repo-server --timeout=300s

  local argocd_pw
  argocd_pw="$($KUBECTL -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || echo 'N/A')"
  record_secret "argocd admin@argocd" "${argocd_pw}"
  log "ArgoCD admin password recorded"

  # ── Traefik exposure mode ──
  # Default: Traefik binds host's 80/443 directly (hostPort) — clean, fast.
  # EDGE_PROXY=caddy: Caddy on host owns 80/443; Traefik moves to NodePort
  # 32080/32443 so Caddy can reverse-proxy to it.
  if [[ "${EDGE_PROXY:-}" == "caddy" ]] || [[ "${EDGE_PROXY:-}" == "nginx" ]]; then
    info "EDGE_PROXY=${EDGE_PROXY} → Traefik moves to NodePort 32080/32443 (edge proxy owns 80/443)"
    # Remove any pre-existing hostPort patch (no-op if already absent)
    $KUBECTL -n kube-system patch deployment traefik --type=json -p='[
      {"op":"remove","path":"/spec/template/spec/containers/0/ports/0/hostPort"},
      {"op":"remove","path":"/spec/template/spec/containers/0/ports/1/hostPort"}
    ]' 2>/dev/null || true
    $KUBECTL -n kube-system patch svc traefik --type=merge -p '{
      "spec":{"type":"NodePort","ports":[
        {"name":"web","port":80,"targetPort":8000,"nodePort":32080,"protocol":"TCP"},
        {"name":"websecure","port":443,"targetPort":8443,"nodePort":32443,"protocol":"TCP"}
      ]}
    }' 2>/dev/null || warn "Traefik service patch failed (already NodePort?)"
  else
    # Classic mode — Traefik = edge on 80/443 via hostPort
    if [[ "$($KUBECTL -n kube-system get svc traefik -o jsonpath='{.spec.type}' 2>/dev/null)" == "LoadBalancer" ]]; then
      $KUBECTL -n kube-system patch deployment traefik --type=json -p='[
        {"op":"add","path":"/spec/template/spec/containers/0/ports/0/hostPort","value":80},
        {"op":"add","path":"/spec/template/spec/containers/0/ports/1/hostPort","value":443}
      ]' 2>/dev/null || warn "Traefik hostPort patch skipped (already set?)"
      $KUBECTL -n kube-system patch svc traefik -p '{"spec":{"type":"ClusterIP"}}' 2>/dev/null || true
    fi
  fi

  # Expose ArgoCD on a stable NodePort so it's reachable by IP too.
  # (Domain-based access still works via the platform's Ingress.)
  $KUBECTL -n argocd patch svc argocd-server --type=merge -p '{
    "spec": {
      "type": "NodePort",
      "ports": [
        {"name":"http","port":80,"targetPort":8080,"nodePort":30880,"protocol":"TCP"},
        {"name":"https","port":443,"targetPort":8080,"nodePort":30443,"protocol":"TCP"}
      ]
    }
  }' 2>/dev/null || warn "ArgoCD NodePort patch skipped"
  ufw allow 30880/tcp comment 'ArgoCD NodePort HTTP' >/dev/null 2>&1 || true

  # Standard MQTT/MQTTS port forwarding 1883→31883 and 8883→38883 so legacy
  # IoT clients can keep using default ports while EMQX listens on NodePorts.
  # Persists across reboots via iptables-persistent (installed if needed).
  if ! command -v netfilter-persistent &>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null
  fi
  for rule in \
      "PREROUTING -t nat -p tcp --dport 1883 -j REDIRECT --to-port 31883" \
      "PREROUTING -t nat -p tcp --dport 8883 -j REDIRECT --to-port 38883"; do
    # shellcheck disable=SC2086
    iptables -C $rule 2>/dev/null || iptables -A $rule
  done
  netfilter-persistent save >/dev/null 2>&1 || true
  log "MQTT DNAT: 1883→31883, 8883→38883 (legacy port compat)"

  # Root App-of-Apps — ArgoCD now drives everything from Git
  $KUBECTL apply -f "${REPO_DIR}/infra/argocd/root-apps/platform-stack.yaml"
  log "Root Application 'platform-stack' applied — ArgoCD reconciling"
}

# ── Step 8 (optional): aaPanel on host ───────────────────────
install_aapanel() {
  [[ "${INSTALL_AAPANEL:-0}" == "1" ]] || { info "[8/8] Skipping aaPanel (set INSTALL_AAPANEL=1 to enable)"; return; }
  if command -v bt &>/dev/null || [[ -d /www/server/panel ]]; then
    info "aaPanel already installed"
  else
    log "[8/8] Installing aaPanel on host…"
    # Official installer (Ubuntu 24.04 supported as of late-2024 builds)
    bash <(curl -fsSL https://www.aapanel.com/script/install_7.0_en.sh) aapanel <<<"y" || \
      warn "aaPanel installer returned non-zero — review output"
  fi
  local bt_port="8888"
  if [[ -f /www/server/panel/data/port.pl ]]; then
    bt_port="$(cat /www/server/panel/data/port.pl)"
    ufw allow "${bt_port}"/tcp comment 'aaPanel detected' >/dev/null 2>&1 || true
    info "aaPanel listening on port ${bt_port}"
  fi
  local ip; ip="$(hostname -I | awk '{print $1}')"

  # ── Force aaPanel admin credentials to ${ADMIN_USER} / ${ADMIN_PASSWORD} ──
  # tools.py path differs by aaPanel version — try both modern and legacy.
  local tools=""
  for f in /www/server/panel/tools.py /www/server/panel/tools.sh; do
    [[ -f "$f" ]] && { tools="$f"; break; }
  done
  if [[ -n "$tools" ]]; then
    info "Setting aaPanel admin user → ${ADMIN_USER}"
    if [[ "$tools" == *.py ]]; then
      cd /www/server/panel && python3 tools.py username "${ADMIN_USER}" >/dev/null 2>&1 \
        || warn "aaPanel username change failed (set manually with: bt 5)"
      cd /www/server/panel && python3 tools.py panel "${ADMIN_PASSWORD}" >/dev/null 2>&1 \
        || warn "aaPanel password change failed (set manually with: bt 5)"
    else
      bash "$tools" username "${ADMIN_USER}"     >/dev/null 2>&1 || true
      bash "$tools" panel    "${ADMIN_PASSWORD}" >/dev/null 2>&1 || true
    fi
    record_secret "aaPanel ${ADMIN_USER}@host" "${ADMIN_PASSWORD}"
    log "aaPanel credentials set"
  else
    warn "aaPanel tools script not found — set credentials manually:"
    warn "  bt 5    # change username"
    warn "  bt 6    # change password"
  fi

  # ── aaPanel intentionally runs OUTSIDE k3s ──
  # Rationale: separation of failure domains. If k3s/Traefik dies, you still
  # need aaPanel + SSH to recover. Don't put the admin escape hatch behind the
  # very system it's meant to recover. Access aaPanel directly at
  # http://${ip}:${bt_port:-8888}/<security-entry-path>.
  #
  # Opt-in (NOT recommended for prod): set BRIDGE_AAPANEL=1 to expose aaPanel
  # at https://aapanel.${DOMAIN} through Traefik+Let's Encrypt.
  case "${EDGE_PROXY:-}" in
    nginx)
      info "EDGE_PROXY=nginx — installing nginx as host edge (clean URLs, no port)"
      install_nginx_edge_proxy "${bt_port}" "${ip}"
      ;;
    caddy)
      info "EDGE_PROXY=caddy — installing Caddy as host edge (clean URLs, no port)"
      install_caddy_edge_proxy "${bt_port}" "${ip}"
      ;;
    *)
      if [[ "${BRIDGE_AAPANEL:-0}" == "1" ]]; then
        warn "BRIDGE_AAPANEL=1 — bridging aaPanel through k3s (not recommended)"
        expose_aapanel_via_traefik
      elif [[ "${AAPANEL_TLS:-}" == "caddy" ]]; then
        info "AAPANEL_TLS=caddy — installing host-side Caddy on port 8443 (sidecar)"
        install_aapanel_caddy_proxy "${bt_port}" "${ip}"
      else
        info "aaPanel intentionally kept separate from k3s (recommended)."
        info "  → access at  http://${ip}:${bt_port}"
        info "  → for clean HTTPS URLs (no port) on every service:"
        info "        EDGE_PROXY=nginx  ./deploy-bootstrap.sh   (recommended)"
        info "    or  EDGE_PROXY=caddy  ./deploy-bootstrap.sh"
      fi
      ;;
  esac
}

# ── Host-side Caddy reverse proxy — INDEPENDENT of k3s ───────
# Architecture (preserves failure isolation):
#
#   :80, :443  → Traefik (k3s)        ← platform plane
#   :8443      → Caddy (host)         ← admin plane HTTPS edge
#                  └─► 127.0.0.1:8888  (aaPanel)
#   :8888      → aaPanel direct       ← admin plane fallback
#
# Cert mode:
#   - Default: Caddy's `tls internal` (self-signed, browser warning once)
#   - Real LE via DNS-01: set CADDY_CF_API_TOKEN=<cloudflare-token>
#     (works without touching port 80 which Traefik owns)
install_aapanel_caddy_proxy() {
  local bt_port="$1" host_ip="$2"
  local caddy_port="${AAPANEL_CADDY_PORT:-8443}"
  local proxy_host="aapanel.${DOMAIN}"

  log "Installing Caddy as aaPanel TLS edge on :${caddy_port}…"
  if ! command -v caddy &>/dev/null; then
    # Official Caddy apt repo (https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  else
    info "Caddy already installed ($(caddy version | head -1))"
  fi

  # Write Caddyfile
  if [[ -n "${CADDY_CF_API_TOKEN:-}" ]]; then
    # Cloudflare DNS-01 — needs caddy-dns/cloudflare module. Install via xcaddy
    # only if not already bundled in the binary.
    if ! caddy list-modules 2>/dev/null | grep -q 'dns.providers.cloudflare'; then
      info "Adding caddy-dns/cloudflare module via xcaddy"
      apt-get install -y -qq golang-go >/dev/null
      go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest >/dev/null 2>&1 || true
      /root/go/bin/xcaddy build --with github.com/caddy-dns/cloudflare \
        --output /usr/bin/caddy
    fi
    cat >/etc/caddy/Caddyfile <<EOF
{
  email ${LE_EMAIL}
  # DNS-01 via Cloudflare — does NOT touch port 80 (owned by Traefik)
  acme_dns cloudflare ${CADDY_CF_API_TOKEN}
}

${proxy_host}:${caddy_port} {
  reverse_proxy 127.0.0.1:${bt_port} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip
  log {
    output file /var/log/caddy/aapanel.log
    format console
  }
}
EOF
    log "Caddyfile written with LE (Cloudflare DNS-01)"
  else
    # Self-signed via Caddy's internal CA — no external dependencies
    cat >/etc/caddy/Caddyfile <<EOF
{
  email ${LE_EMAIL}
}

${proxy_host}:${caddy_port}, ${host_ip}:${caddy_port} {
  tls internal
  reverse_proxy 127.0.0.1:${bt_port} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip
  log {
    output file /var/log/caddy/aapanel.log
    format console
  }
}
EOF
    warn "Caddyfile uses self-signed cert (tls internal)."
    warn "  → browser will warn once; accept and continue, OR re-run with"
    warn "    CADDY_CF_API_TOKEN=… for a real Let's Encrypt cert"
  fi

  mkdir -p /var/log/caddy
  chown -R caddy:caddy /var/log/caddy /etc/caddy 2>/dev/null || true

  caddy validate --config /etc/caddy/Caddyfile 2>&1 \
    | sed 's/^/    /' \
    || { err "Caddyfile invalid"; return 1; }

  systemctl enable --now caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy

  # Allow the Caddy port in UFW
  ufw allow "${caddy_port}/tcp" comment 'aaPanel HTTPS via Caddy' >/dev/null 2>&1 || true

  # Add the subdomain to aaPanel's allowed Host list
  if [[ -f /www/server/panel/data/domain.conf ]]; then
    grep -qx "${proxy_host}" /www/server/panel/data/domain.conf \
      || echo "${proxy_host}" >>/www/server/panel/data/domain.conf
  fi
  if [[ -f /www/server/panel/data/limitip.conf ]] && \
     [[ -s /www/server/panel/data/limitip.conf ]]; then
    grep -qx "127.0.0.1" /www/server/panel/data/limitip.conf \
      || echo "127.0.0.1" >>/www/server/panel/data/limitip.conf
  fi
  systemctl restart bt 2>/dev/null || /etc/init.d/bt restart 2>/dev/null || true

  log "Caddy → aaPanel ready:"
  log "  https://${proxy_host}:${caddy_port}/"
  log "  https://${host_ip}:${caddy_port}/  (also valid; same self-signed cert)"
  record_secret "aaPanel TLS edge" "https://${proxy_host}:${caddy_port} → 127.0.0.1:${bt_port}"
}

# ── nginx as EDGE proxy on :80/:443 (RECOMMENDED — no port in any URL) ──
# Architecture:
#
#   internet :80,:443 ─► nginx (host, systemd) ─┬─► aapanel.${DOMAIN}
#                                                │     → 127.0.0.1:${bt_port}
#                                                │
#                                                └─► everything else
#                                                      → 127.0.0.1:32080 (Traefik)
#
# Why nginx over Caddy here:
#   - Industry-standard config; everyone on your team can read it
#   - aaPanel uses nginx internally — same mental model
#   - certbot HTTP-01 issues real Let's Encrypt certs (nginx owns :80)
#   - Auto-renewal via certbot.timer (systemd)
#
# Failure isolation: aaPanel route does NOT touch k3s; if k3s dies, aaPanel
# stays reachable through nginx → 127.0.0.1:${bt_port}.
install_nginx_edge_proxy() {
  local bt_port="$1" host_ip="$2"

  log "Installing nginx + certbot as public edge proxy on :80/:443…"
  apt-get install -y -qq --no-install-recommends \
    nginx certbot python3-certbot-nginx >/dev/null

  # Disable default site
  rm -f /etc/nginx/sites-enabled/default

  # Common proxy snippet — re-used by every server block
  mkdir -p /etc/nginx/snippets
  cat >/etc/nginx/snippets/proxy-common.conf <<'EOF'
# Managed by deploy-bootstrap.sh
proxy_set_header   Host              $host;
proxy_set_header   X-Real-IP         $remote_addr;
proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header   X-Forwarded-Proto $scheme;
proxy_set_header   X-Forwarded-Host  $host;
proxy_http_version 1.1;
proxy_set_header   Upgrade           $http_upgrade;
proxy_set_header   Connection        "upgrade";
proxy_read_timeout 90s;
proxy_send_timeout 90s;
proxy_connect_timeout 30s;
proxy_buffering    off;            # WebSocket-friendly
client_max_body_size 256m;         # phpMyAdmin / WordPress uploads
EOF

  cat >/etc/nginx/sites-available/edge.conf <<EOF
# ============================================================
# Carbon Credit Platform — edge proxy (managed by deploy-bootstrap.sh)
#
#   aapanel.${DOMAIN}                  → 127.0.0.1:${bt_port}   (aaPanel)
#   ${DOMAIN}, www.${DOMAIN},
#   argocd|grafana|nodered|
#   pma|emqx.${DOMAIN}         → 127.0.0.1:32080         (Traefik)
# ============================================================

# ── aaPanel — routes DIRECTLY to host (not through k3s) ──
server {
    listen 80;
    listen [::]:80;
    server_name aapanel.${DOMAIN};

    access_log /var/log/nginx/aapanel.access.log;
    error_log  /var/log/nginx/aapanel.error.log warn;

    location / {
        proxy_pass http://127.0.0.1:${bt_port};
        include    /etc/nginx/snippets/proxy-common.conf;
    }
}

# ── All k3s-served apps — route through Traefik NodePort ──
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN}
                argocd.${DOMAIN}
                grafana.${DOMAIN}
                nodered.${DOMAIN}
                pma.${DOMAIN}
                emqx.${DOMAIN};

    access_log /var/log/nginx/k3s.access.log;
    error_log  /var/log/nginx/k3s.error.log warn;

    location / {
        proxy_pass http://127.0.0.1:32080;
        include    /etc/nginx/snippets/proxy-common.conf;
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/edge.conf /etc/nginx/sites-enabled/edge.conf

  nginx -t || { err "nginx config invalid — fix and re-run"; return 1; }
  systemctl enable --now nginx
  systemctl reload nginx

  # ── Issue Let's Encrypt certs via certbot HTTP-01 ──
  # certbot will edit edge.conf to add `listen 443 ssl;` and certificate paths.
  local domains=(
    "aapanel.${DOMAIN}"
    "${DOMAIN}" "www.${DOMAIN}"
    "argocd.${DOMAIN}" "grafana.${DOMAIN}"
    "nodered.${DOMAIN}" "pma.${DOMAIN}" "emqx.${DOMAIN}"
  )
  local domain_args=()
  local d
  for d in "${domains[@]}"; do domain_args+=(-d "$d"); done

  info "Requesting Let's Encrypt certificates (HTTP-01, via nginx)…"
  if certbot --nginx --non-interactive --agree-tos \
       --email "${LE_EMAIL}" \
       --redirect \
       --no-eff-email \
       "${domain_args[@]}" 2>&1 | sed 's/^/    /'; then
    log "Let's Encrypt certificates issued + nginx redirected to HTTPS"
  else
    warn "certbot did not issue all certs — probably DNS hasn't propagated yet."
    warn "  Re-run later:  certbot --nginx ${domain_args[*]}"
    warn "  Auto-renewal:  systemctl status certbot.timer"
  fi

  # ── UFW: only nginx is public; lock Traefik NodePorts to localhost only ──
  ufw allow 80/tcp  comment 'nginx HTTP/ACME' >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'nginx HTTPS'      >/dev/null 2>&1 || true
  ufw deny 32080/tcp comment 'Traefik NodePort (loopback only)' >/dev/null 2>&1 || true
  ufw deny 32443/tcp comment 'Traefik NodePort (loopback only)' >/dev/null 2>&1 || true

  # ── aaPanel must accept the new Host header ──
  if [[ -f /www/server/panel/data/domain.conf ]]; then
    grep -qx "aapanel.${DOMAIN}" /www/server/panel/data/domain.conf \
      || echo "aapanel.${DOMAIN}" >>/www/server/panel/data/domain.conf
  fi
  if [[ -f /www/server/panel/data/limitip.conf ]] && \
     [[ -s /www/server/panel/data/limitip.conf ]]; then
    grep -qx "127.0.0.1" /www/server/panel/data/limitip.conf \
      || echo "127.0.0.1" >>/www/server/panel/data/limitip.conf
  fi
  systemctl restart bt 2>/dev/null || /etc/init.d/bt restart 2>/dev/null || true

  # Ensure certbot auto-renewal timer is enabled (installed by the package).
  systemctl enable --now certbot.timer 2>/dev/null || true

  log "nginx edge proxy ready — every URL on standard :443, no port:"
  log "  https://aapanel.${DOMAIN}     → 127.0.0.1:${bt_port}"
  log "  https://argocd.${DOMAIN}      → Traefik (:32080)"
  log "  https://grafana.${DOMAIN}     → Traefik (:32080)"
  log "  https://nodered.${DOMAIN}     → Traefik (:32080)"
  log "  https://pma.${DOMAIN}  → Traefik (:32080)"
  log "  https://emqx.${DOMAIN}        → Traefik (:32080)"
  log "  https://${DOMAIN}             → Traefik (:32080)"
  record_secret "nginx edge proxy" "owns :80/:443; Traefik → :32080 (loopback)"
}

# ── Caddy as EDGE proxy on :80/:443 (no port in any URL) ─────
# Routes:
#   aapanel.${DOMAIN}      → 127.0.0.1:${bt_port}   (aaPanel on host)
#   <every-other-host>     → 127.0.0.1:32080        (Traefik NodePort)
#
# Caddy handles TLS for every subdomain via HTTP-01 ACME (it owns :80 now).
# Traefik no longer terminates TLS — it serves plain HTTP behind Caddy.
# Failure isolation: if k3s dies, aapanel.${DOMAIN} still works because Caddy
# routes it directly to 127.0.0.1:${bt_port} without going through k3s.
install_caddy_edge_proxy() {
  local bt_port="$1" host_ip="$2"

  log "Installing Caddy as public edge proxy on :80/:443…"
  if ! command -v caddy &>/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi

  # Explicit per-subdomain blocks (HTTP-01 can't issue wildcards; need DNS-01
  # for that). Each subdomain gets its own LE cert auto-managed by Caddy.
  cat >/etc/caddy/Caddyfile <<EOF
{
  email ${LE_EMAIL}
  # HTTP-01 challenge works now because Caddy owns :80 (Traefik moved to :32080)
}

# ── aaPanel: routes directly to host service (NOT through k3s) ──
aapanel.${DOMAIN} {
  reverse_proxy 127.0.0.1:${bt_port} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip
  log { output file /var/log/caddy/aapanel.log }
}

# ── All k3s-served apps go through Traefik NodePort 32080 ──
# Traefik will re-route by Host header to the correct Ingress/Service.
${DOMAIN},
www.${DOMAIN},
argocd.${DOMAIN},
grafana.${DOMAIN},
nodered.${DOMAIN},
pma.${DOMAIN},
emqx.${DOMAIN} {
  reverse_proxy 127.0.0.1:32080 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip
  log { output file /var/log/caddy/k3s.log }
}
EOF

  mkdir -p /var/log/caddy
  chown -R caddy:caddy /var/log/caddy /etc/caddy 2>/dev/null || true

  caddy validate --config /etc/caddy/Caddyfile 2>&1 | sed 's/^/    /' \
    || { err "Caddyfile invalid — fix and re-run"; return 1; }

  systemctl enable --now caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy

  # Caddy owns 80/443. Traefik NodePorts 32080/32443 should NOT be reachable
  # from the outside — limit them to localhost so the only public entry is Caddy.
  ufw allow 80/tcp  comment 'Caddy HTTP/ACME'    >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'Caddy HTTPS'         >/dev/null 2>&1 || true
  # Explicitly DENY external traffic to Traefik NodePorts; only loopback OK.
  ufw deny 32080/tcp comment 'Traefik NodePort — Caddy only' >/dev/null 2>&1 || true
  ufw deny 32443/tcp comment 'Traefik NodePort — Caddy only' >/dev/null 2>&1 || true

  # Add the subdomain to aaPanel's allowed Host list
  if [[ -f /www/server/panel/data/domain.conf ]]; then
    grep -qx "aapanel.${DOMAIN}" /www/server/panel/data/domain.conf \
      || echo "aapanel.${DOMAIN}" >>/www/server/panel/data/domain.conf
  fi
  if [[ -f /www/server/panel/data/limitip.conf ]] && \
     [[ -s /www/server/panel/data/limitip.conf ]]; then
    grep -qx "127.0.0.1" /www/server/panel/data/limitip.conf \
      || echo "127.0.0.1" >>/www/server/panel/data/limitip.conf
  fi
  systemctl restart bt 2>/dev/null || /etc/init.d/bt restart 2>/dev/null || true

  log "Caddy edge proxy ready — every service on standard :443, no port in URL"
  log "  https://aapanel.${DOMAIN}   → 127.0.0.1:${bt_port}"
  log "  https://*.${DOMAIN}         → 127.0.0.1:32080 (Traefik)"
  record_secret "Caddy edge proxy" "owns :80/:443 on host; Traefik → :32080"
}

# Creates a headless Service + EndpointSlice that points the cluster at the
# host's aaPanel port, then an Ingress for https://aapanel.${DOMAIN}.
# Idempotent — re-runs safely with the latest detected port.
expose_aapanel_via_traefik() {
  local bt_port host_ip
  bt_port="$(cat /www/server/panel/data/port.pl 2>/dev/null || echo 8888)"
  # Pick the primary outbound IP (the one pods will reach via the default GW).
  host_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
  [[ -z "$host_ip" ]] && host_ip="$(hostname -I | awk '{print $1}')"
  info "Wiring https://aapanel.${DOMAIN} → ${host_ip}:${bt_port}"

  $KUBECTL apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: host-proxies
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
    tier: host-bridges
---
apiVersion: v1
kind: Service
metadata:
  name: aapanel
  namespace: host-proxies
spec:
  ports:
    - name: http
      port: 80
      targetPort: ${bt_port}
      protocol: TCP
  # No selector — endpoints are managed manually (next resource).
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aapanel
  namespace: host-proxies
  labels:
    kubernetes.io/service-name: aapanel
addressType: IPv4
ports:
  - name: http
    port: ${bt_port}
    protocol: TCP
endpoints:
  - addresses: ["${host_ip}"]
    conditions:
      ready: true
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aapanel
  namespace: host-proxies
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  ingressClassName: traefik
  rules:
    - host: aapanel.${DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: aapanel
                port:
                  number: 80
  tls:
    - hosts: [aapanel.${DOMAIN}]
      secretName: aapanel-tls
EOF

  # Make sure aaPanel does NOT reject requests with the new Host header.
  # /www/server/panel/data/domain.conf — if present, only listed hostnames work.
  if [[ -f /www/server/panel/data/domain.conf ]]; then
    if ! grep -qx "aapanel.${DOMAIN}" /www/server/panel/data/domain.conf; then
      echo "aapanel.${DOMAIN}" >>/www/server/panel/data/domain.conf
      info "Added aapanel.${DOMAIN} to /www/server/panel/data/domain.conf"
    fi
  fi
  # Likewise lift IP restrictions if any are set (cluster pod IPs are 10.42.x.x).
  if [[ -f /www/server/panel/data/limitip.conf ]] && \
     [[ -s /www/server/panel/data/limitip.conf ]]; then
    grep -qx "10.42.0.0/16" /www/server/panel/data/limitip.conf \
      || echo "10.42.0.0/16" >>/www/server/panel/data/limitip.conf
  fi
  # Restart aaPanel to pick up domain.conf changes (idempotent no-op if running)
  systemctl restart bt 2>/dev/null || /etc/init.d/bt restart 2>/dev/null || true
  log "aaPanel bridge ready → https://aapanel.${DOMAIN}"
}

# ── Final summary ────────────────────────────────────────────
summary() {
  echo
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║                  ✅  Bootstrap complete                   ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo
  local ip; ip="$(hostname -I | awk '{print $1}')"
  local bt_port=""; [[ -f /www/server/panel/data/port.pl ]] && bt_port="$(cat /www/server/panel/data/port.pl)"
  local edge_url="" edge_mode="off (direct IP only)"
  if [[ "${EDGE_PROXY:-}" == "nginx" ]] && systemctl is-active --quiet nginx 2>/dev/null; then
    edge_mode="nginx :80/:443 (recommended)"
    edge_url="https://aapanel.${DOMAIN}  (no port)"
  elif [[ "${EDGE_PROXY:-}" == "caddy" ]] && systemctl is-active --quiet caddy 2>/dev/null; then
    edge_mode="caddy :80/:443"
    edge_url="https://aapanel.${DOMAIN}  (no port)"
  elif systemctl is-active --quiet caddy 2>/dev/null; then
    local cp="${AAPANEL_CADDY_PORT:-8443}"
    edge_mode="caddy sidecar :${cp}"
    edge_url="https://aapanel.${DOMAIN}:${cp}"
  fi

  cat <<EOF
 GitOps state:
   ArgoCD UI       https://argocd.${DOMAIN}
   (or local)      kubectl -n argocd port-forward svc/argocd-server 8080:443

 Reconciled by ArgoCD — accessible via DOMAIN *and* direct IP:
   ┌─────────────────┬────────────────────────────────────┬───────────────────────────┐
   │ Service         │ Domain URL                         │ Direct IP URL             │
   ├─────────────────┼────────────────────────────────────┼───────────────────────────┤
   │ Edge proxy      │ mode: ${edge_mode}
   │ ArgoCD          │ https://argocd.${DOMAIN}           │ http://${ip}:30880        │
   │ aaPanel (TLS)   │ ${edge_url:-(off; EDGE_PROXY=nginx to enable)}
   │ aaPanel (HTTP)  │ (off-cluster, by design)           │ http://${ip}:${bt_port:-8888}        │
   │ EMQX Dashboard  │ https://emqx.${DOMAIN}             │ http://${ip}:18083        │
   │ EMQX MQTT       │ —                                  │ tcp://${ip}:1883  (DNAT)  │
   │                 │                                    │ tcp://${ip}:31883 (direct)│
   │ EMQX MQTTS      │ —                                  │ tls://${ip}:8883  (DNAT)  │
   │                 │                                    │ tls://${ip}:38883 (direct)│
   │ Grafana         │ https://grafana.${DOMAIN}          │ http://${ip}:3000         │
   │ Node-RED        │ https://nodered.${DOMAIN}          │ http://${ip}:1880         │
   │ phpMyAdmin      │ https://pma.${DOMAIN}       │ http://${ip}:30808        │
   │ WordPress       │ https://${DOMAIN}                  │ http://${ip}:30088        │
   │ MySQL           │ — (in-cluster only by default)     │ kubectl -n data port-fwd  │
   └─────────────────┴────────────────────────────────────┴───────────────────────────┘

 Host services:
   • aaPanel                  http://${ip}:${bt_port:-8888}

 Unified admin login   user: ${ADMIN_USER}   password: ${ADMIN_PASSWORD}
   (applies to: aaPanel, EMQX, Node-RED, Grafana, phpMyAdmin, MySQL, WordPress)

 Secrets (chmod 600):  ${SECRETS_LOG}

 Next:
   1. Point DNS A records → ${ip}:
        ${DOMAIN}, argocd.${DOMAIN}, grafana.${DOMAIN},
        nodered.${DOMAIN}, pma.${DOMAIN}, emqx.${DOMAIN}
   2. Watch reconciliation:
        kubectl get app -n argocd -w
   3. Anything you change in Git under infra/argocd/platform-stack/
      will auto-sync within ~3 minutes.
EOF
}

# ── Main ─────────────────────────────────────────────────────
main() {
  preflight
  system_setup
  setup_firewall
  free_web_ports
  install_k3s
  sync_repo
  seed_cluster
  install_gitops
  install_aapanel
  summary
}

main "$@"
