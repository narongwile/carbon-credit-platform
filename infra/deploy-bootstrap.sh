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

  # Ingress
  ufw allow 22/tcp    comment 'SSH'             >/dev/null
  ufw allow 80/tcp    comment 'HTTP/Traefik'    >/dev/null
  ufw allow 443/tcp   comment 'HTTPS/Traefik'   >/dev/null
  # MQTT
  ufw allow 1883/tcp  comment 'EMQX MQTT'       >/dev/null
  ufw allow 8883/tcp  comment 'EMQX MQTTS'      >/dev/null
  # aaPanel admin (default 8888 — re-detected after install)
  ufw allow 8888/tcp  comment 'aaPanel'         >/dev/null

  # K3s API only from local + cluster CIDRs
  ufw allow from 127.0.0.0/8 to any port 6443 proto tcp comment 'K3s local'  >/dev/null
  ufw allow from 10.42.0.0/16 to any port 6443 proto tcp comment 'K3s pods'  >/dev/null
  ufw allow from 10.43.0.0/16 to any port 6443 proto tcp comment 'K3s svcs'  >/dev/null

  ufw --force enable >/dev/null
  log "UFW enabled"
}

# ── Step 3: Pre-empt host services that bind 80/443 ──────────
free_web_ports() {
  log "[3/8] Freeing host ports 80/443 for Traefik…"
  if [[ "${PRESERVE_AAPANEL_WEB:-0}" == "1" ]]; then
    warn "PRESERVE_AAPANEL_WEB=1 — leaving host nginx/apache running"
    warn "  → You MUST remap Traefik or aaPanel to non-conflicting ports."
    return
  fi
  local svc
  for svc in nginx apache2 httpd; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      warn "Stopping $svc (conflicts with Traefik 80/443)"
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
  if command -v k3s &>/dev/null && systemctl is-active --quiet k3s; then
    info "K3s already installed and running ($(k3s --version | head -1))"
  else
    # ServiceLB disabled — Traefik uses hostPort directly on this single node.
    # Disable Traefik temporarily? NO — we want bundled Traefik for ingress.
    curl -sfL https://get.k3s.io | \
      INSTALL_K3S_VERSION="${INSTALL_K3S_VERSION}" \
      INSTALL_K3S_EXEC="--disable servicelb --write-kubeconfig-mode 644" \
      sh -
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
  for ns in argocd cert-manager monitoring data app web carbon-credit; do
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

  # ─ EMQX dashboard ─
  ensure_secret data emqx-dashboard \
    "EMQX_DASHBOARD__DEFAULT_USERNAME=${ADMIN_USER}" \
    "EMQX_DASHBOARD__DEFAULT_PASSWORD=${pw}"
  record_secret "emqx dashboard ${ADMIN_USER}@data" "${pw}"

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

  # Patch Traefik to bind hostPorts (single-node, no external LB)
  if [[ "$($KUBECTL -n kube-system get svc traefik -o jsonpath='{.spec.type}' 2>/dev/null)" == "LoadBalancer" ]]; then
    $KUBECTL -n kube-system patch deployment traefik --type=json -p='[
      {"op":"add","path":"/spec/template/spec/containers/0/ports/0/hostPort","value":80},
      {"op":"add","path":"/spec/template/spec/containers/0/ports/1/hostPort","value":443}
    ]' 2>/dev/null || warn "Traefik hostPort patch skipped (already set?)"
    $KUBECTL -n kube-system patch svc traefik -p '{"spec":{"type":"ClusterIP"}}' 2>/dev/null || true
  fi

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
  if [[ -f /www/server/panel/data/port.pl ]]; then
    local port; port="$(cat /www/server/panel/data/port.pl)"
    ufw allow "${port}"/tcp comment 'aaPanel detected' >/dev/null 2>&1 || true
    info "aaPanel listening on port ${port}"
  fi

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

  cat <<EOF
 GitOps state:
   ArgoCD UI       https://argocd.${DOMAIN}
   (or local)      kubectl -n argocd port-forward svc/argocd-server 8080:443

 Reconciled by ArgoCD (watch with: kubectl get app -n argocd):
   • EMQX MQTT broker         tcp://${ip}:1883  tls://${ip}:8883  https://emqx.${DOMAIN}
   • Node-RED                 https://nodered.${DOMAIN}    (cluster: 1880)
   • MySQL                    mysql://${ip}:3306            (cluster: 3306)
   • phpMyAdmin               https://phpmyadmin.${DOMAIN}
   • Grafana                  https://grafana.${DOMAIN}    (cluster: 3000)
   • WordPress                https://${DOMAIN}            (cluster: 80)

 Host services:
   • aaPanel                  http://${ip}:${bt_port:-8888}

 Unified admin login   user: ${ADMIN_USER}   password: ${ADMIN_PASSWORD}
   (applies to: aaPanel, EMQX, Node-RED, Grafana, phpMyAdmin, MySQL, WordPress)

 Secrets (chmod 600):  ${SECRETS_LOG}

 Next:
   1. Point DNS A records → ${ip}:
        ${DOMAIN}, argocd.${DOMAIN}, grafana.${DOMAIN},
        nodered.${DOMAIN}, phpmyadmin.${DOMAIN}, emqx.${DOMAIN}
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
