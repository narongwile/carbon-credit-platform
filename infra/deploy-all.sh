#!/usr/bin/env bash
# ============================================================
# Carbon Credit Platform — Full Deployment Script
# Target: Ubuntu 24 LTS single-node (thermexpertise server)
#
# This script is IDEMPOTENT — safe to re-run.
# It bootstraps K3s, ArgoCD, secrets, and all platform services.
#
# Usage:
#   chmod +x deploy-all.sh
#   sudo ./deploy-all.sh
#
# Environment overrides:
#   INSTALL_K3S_VERSION  — K3s version (default: v1.31.6+k3s1)
#   ARGOCD_VERSION       — Argo CD version (default: v2.10.4)
#   DOMAIN               — Primary domain (default: thermexpertise.com)
#   AAPANEL_PORT         — aaPanel listen port (default: 8888)
#   SKIP_AAPANEL_ISOLATE — Set to 1 to skip aaPanel isolation
# ============================================================
set -euo pipefail

# ── Constants ────────────────────────────────────────────────
INSTALL_K3S_VERSION="${INSTALL_K3S_VERSION:-v1.31.6+k3s1}"
ARGOCD_VERSION="${ARGOCD_VERSION:-v2.10.4}"
DOMAIN="${DOMAIN:-thermexpertise.com}"
AAPANEL_PORT="${AAPANEL_PORT:-8888}"
REPO_URL="https://gitlab.com/narongwile/carbon-credit-platform.git"
REPO_DIR="/opt/carbon-credit-platform"
KUBECTL="k3s kubectl"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# Generate a random password (20 chars, alphanumeric + symbols)
gen_password() {
  tr -dc 'A-Za-z0-9!@#%^&*()-_=+' < /dev/urandom | head -c 20 || true
}

# ── Pre-flight Checks ───────────────────────────────────────
preflight() {
  echo ""
  echo "=========================================="
  echo " Carbon Credit Platform — Full Deployment"
  echo "=========================================="
  echo ""

  # Must be root
  if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root (sudo)."
    exit 1
  fi

  # Check OS
  if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
    warn "This script is designed for Ubuntu. Proceeding anyway..."
  fi

  # Check minimum resources
  local total_ram_mb
  total_ram_mb=$(free -m | awk '/^Mem:/{print $2}')
  if [[ $total_ram_mb -lt 3500 ]]; then
    warn "Server has ${total_ram_mb}MB RAM. Recommended minimum is 4GB."
    warn "Some services may fail to schedule. Continuing anyway..."
  else
    log "RAM check passed: ${total_ram_mb}MB available"
  fi

  local disk_avail_gb
  disk_avail_gb=$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')
  if [[ $disk_avail_gb -lt 15 ]]; then
    err "Only ${disk_avail_gb}GB disk space available. Need at least 15GB."
    exit 1
  fi
  log "Disk check passed: ${disk_avail_gb}GB available"

  info "K3s version:    ${INSTALL_K3S_VERSION}"
  info "ArgoCD version: ${ARGOCD_VERSION}"
  info "Domain:         ${DOMAIN}"
  echo ""
}

# ── Step 1: System Updates & Essentials ──────────────────────
system_setup() {
  log "Step 1/9: System updates & essentials..."
  export DEBIAN_FRONTEND=noninteractive

  apt-get update -qq
  apt-get install -y -qq curl git jq ufw fail2ban unattended-upgrades apt-transport-https \
    ca-certificates gnupg lsb-release > /dev/null 2>&1

  # Enable automatic security updates
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  # Configure fail2ban for SSH
  if [[ ! -f /etc/fail2ban/jail.local ]]; then
    cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime  = 3600
findtime = 600
EOF
    systemctl enable fail2ban --now 2>/dev/null || true
  fi

  log "System essentials installed"
}

# ── Step 2: Firewall ─────────────────────────────────────────
setup_firewall() {
  log "Step 2/9: Configuring UFW firewall..."

  ufw --force reset > /dev/null 2>&1
  ufw default deny incoming > /dev/null 2>&1
  ufw default allow outgoing > /dev/null 2>&1

  # Essential ports
  ufw allow 22/tcp comment 'SSH' > /dev/null 2>&1
  ufw allow 80/tcp comment 'HTTP' > /dev/null 2>&1
  ufw allow 443/tcp comment 'HTTPS' > /dev/null 2>&1

  # K3s API — restrict to loopback + local subnet
  ufw allow from 127.0.0.0/8 to any port 6443 proto tcp comment 'K3s API local' > /dev/null 2>&1
  ufw allow from 10.42.0.0/16 to any port 6443 proto tcp comment 'K3s pod network' > /dev/null 2>&1
  ufw allow from 10.43.0.0/16 to any port 6443 proto tcp comment 'K3s svc network' > /dev/null 2>&1

  # aaPanel admin (if kept)
  ufw allow "${AAPANEL_PORT}"/tcp comment 'aaPanel admin' > /dev/null 2>&1

  # MQTTS for IoT devices (public TLS-encrypted MQTT)
  ufw allow 8883/tcp comment 'MQTTS IoT' > /dev/null 2>&1

  ufw --force enable > /dev/null 2>&1
  log "Firewall configured (22, 80, 443, ${AAPANEL_PORT}, 8883 open)"
}

# ── Step 3: Isolate aaPanel ──────────────────────────────────
isolate_aapanel() {
  if [[ "${SKIP_AAPANEL_ISOLATE:-0}" == "1" ]]; then
    info "Skipping aaPanel isolation (SKIP_AAPANEL_ISOLATE=1)"
    return
  fi

  log "Step 3/9: Isolating aaPanel..."

  # Stop aaPanel-managed web servers that conflict with ports 80/443
  local services_to_stop=("nginx" "apache2" "httpd")
  for svc in "${services_to_stop[@]}"; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      warn "Stopping system $svc (conflicts with Traefik on 80/443)..."
      systemctl stop "$svc" 2>/dev/null || true
      systemctl disable "$svc" 2>/dev/null || true
    fi
  done

  # If aaPanel is installed, change its port to avoid conflict
  if command -v bt &>/dev/null || [[ -f /etc/init.d/bt ]]; then
    info "aaPanel detected. Ensuring it listens on port ${AAPANEL_PORT}..."
    # aaPanel stores port in /www/server/panel/data/port.pl
    if [[ -f /www/server/panel/data/port.pl ]]; then
      echo "${AAPANEL_PORT}" > /www/server/panel/data/port.pl
      /etc/init.d/bt restart 2>/dev/null || true
      log "aaPanel port set to ${AAPANEL_PORT}"
    fi

    # Stop aaPanel-managed MySQL if it conflicts
    if [[ -f /etc/init.d/mysqld ]]; then
      local bt_mysql_port
      bt_mysql_port=$(grep -oP 'port\s*=\s*\K\d+' /etc/my.cnf 2>/dev/null || echo "3306")
      if [[ "$bt_mysql_port" == "3306" ]]; then
        warn "aaPanel MySQL on 3306 — stopping to avoid K8s conflict..."
        /etc/init.d/mysqld stop 2>/dev/null || true
        info "K3s will run MySQL inside a pod with its own PVC."
      fi
    fi
  else
    info "aaPanel not detected, skipping isolation."
  fi
}

# ── Step 4: Install K3s ──────────────────────────────────────
install_k3s() {
  log "Step 4/9: Installing K3s..."

  if command -v k3s &>/dev/null; then
    info "K3s already installed, checking version..."
    local current_ver
    current_ver=$(k3s --version | head -1 | awk '{print $3}')
    info "Current K3s version: ${current_ver}"
  fi

  export INSTALL_K3S_VERSION
  # Keep Traefik enabled (the repo depends on Traefik CRDs).
  # Disable ServiceLB — we route everything through Traefik IngressRoutes.
  export INSTALL_K3S_EXEC="--disable servicelb --write-kubeconfig-mode 644"
  curl -sfL https://get.k3s.io | sh -

  info "Waiting for K3s node to become Ready..."
  local tries=0
  while ! $KUBECTL wait --for=condition=Ready nodes --all --timeout=30s 2>/dev/null; do
    tries=$((tries + 1))
    if [[ $tries -ge 20 ]]; then
      err "K3s node not ready after 10 minutes. Check: journalctl -u k3s"
      exit 1
    fi
    sleep 30
  done

  log "K3s is running"
  $KUBECTL get nodes -o wide
}

# ── Step 5: Clone / Update Repo ──────────────────────────────
sync_repo() {
  log "Step 5/9: Syncing repository..."

  if [[ -d "${REPO_DIR}/.git" ]]; then
    info "Repo exists at ${REPO_DIR}, pulling latest..."
    cd "${REPO_DIR}" && git fetch origin && git reset --hard origin/main
  else
    info "Cloning repo to ${REPO_DIR}..."
    git clone "${REPO_URL}" "${REPO_DIR}"
  fi

  cd "${REPO_DIR}"
  log "Repo synced at $(git log --oneline -1)"
}

# ── Step 6: Apply Namespaces ─────────────────────────────────
apply_namespaces() {
  log "Step 6/9: Applying Kubernetes namespaces..."

  $KUBECTL apply -f "${REPO_DIR}/infra/k3s/namespaces.yaml"

  # Also ensure argocd and carbon-credit namespaces exist
  $KUBECTL create namespace argocd --dry-run=client -o yaml | $KUBECTL apply -f -
  $KUBECTL create namespace carbon-credit --dry-run=client -o yaml | $KUBECTL apply -f -
  $KUBECTL create namespace cert-manager --dry-run=client -o yaml | $KUBECTL apply -f -

  log "Namespaces ready"
  $KUBECTL get namespaces --no-headers | awk '{print "  - "$1}'
}

# ── Step 7: Create Production Secrets ────────────────────────
create_secrets() {
  log "Step 7/9: Creating production secrets..."

  local secrets_log="/root/.carbon-credit-secrets.txt"

  # ── MySQL Auth ──
  if ! $KUBECTL get secret mysql-auth -n carbon-credit &>/dev/null; then
    local mysql_root_pw mysql_exporter_pw
    mysql_root_pw=$(gen_password)
    mysql_exporter_pw=$(gen_password)

    $KUBECTL create secret generic mysql-auth \
      -n carbon-credit \
      --from-literal=root-password="${mysql_root_pw}" \
      --from-literal=exporter-dsn="root:${mysql_root_pw}@(127.0.0.1:3306)/"

    echo "[$(date -Iseconds)] mysql-auth root-password=${mysql_root_pw}" >> "${secrets_log}"
    log "MySQL secret created"
  else
    info "MySQL secret already exists, skipping"
  fi

  # ── Mosquitto Auth ──
  if ! $KUBECTL get secret mosquitto-auth -n carbon-credit &>/dev/null; then
    local mqtt_pw
    mqtt_pw=$(gen_password)

    $KUBECTL create secret generic mosquitto-auth \
      -n carbon-credit \
      --from-literal=username=admin \
      --from-literal=password="${mqtt_pw}"

    echo "[$(date -Iseconds)] mosquitto-auth username=admin password=${mqtt_pw}" >> "${secrets_log}"
    log "Mosquitto secret created"
  else
    info "Mosquitto secret already exists, skipping"
  fi

  # ── Grafana Admin ──
  if ! $KUBECTL get secret grafana-admin-credentials -n monitoring &>/dev/null; then
    local grafana_pw
    grafana_pw=$(gen_password)

    $KUBECTL create secret generic grafana-admin-credentials \
      -n monitoring \
      --from-literal=admin-user=admin \
      --from-literal=admin-password="${grafana_pw}"

    echo "[$(date -Iseconds)] grafana-admin admin-user=admin admin-password=${grafana_pw}" >> "${secrets_log}"
    log "Grafana secret created"
  else
    info "Grafana secret already exists, skipping"
  fi

  # ── Backend Secrets ──
  if ! $KUBECTL get secret backend-secrets -n app &>/dev/null; then
    local backend_db_pw
    backend_db_pw=$(gen_password)

    $KUBECTL create secret generic backend-secrets \
      -n app \
      --from-literal=database-url="mysql://root:${backend_db_pw}@mysql.carbon-credit.svc.cluster.local:3306/carbon_credit"

    echo "[$(date -Iseconds)] backend-secrets database-url password=${backend_db_pw}" >> "${secrets_log}"
    log "Backend secret created"
  else
    info "Backend secret already exists, skipping"
  fi

  chmod 600 "${secrets_log}" 2>/dev/null || true
  warn "Secrets saved to ${secrets_log} — back this up securely, then delete it."
}

# ── Step 8: Install ArgoCD + Bootstrap ───────────────────────
install_argocd() {
  log "Step 8/9: Installing ArgoCD & bootstrapping platform..."

  # Install ArgoCD
  $KUBECTL apply -n argocd \
    -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

  info "Waiting for ArgoCD server..."
  $KUBECTL wait --for=condition=Available deployment/argocd-server \
    -n argocd --timeout=300s

  log "ArgoCD is running"

  # Extract initial admin password
  local argocd_pw
  argocd_pw=$($KUBECTL -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath="{.data.password}" 2>/dev/null | base64 -d || echo "N/A")
  info "ArgoCD admin password: ${argocd_pw}"
  echo "[$(date -Iseconds)] argocd admin-password=${argocd_pw}" >> /root/.carbon-credit-secrets.txt

  # ── Apply Root Application (App-of-Apps) ──
  info "Applying ArgoCD root application..."
  $KUBECTL apply -f "${REPO_DIR}/infra/k8s/argocd/application.yaml"

  # ── Apply custom apps kustomization directly for bootstrap ──
  info "Bootstrapping core apps via kubectl (ArgoCD will take over)..."
  $KUBECTL apply -k "${REPO_DIR}/infra/k8s/apps/base/" 2>/dev/null || \
    warn "Some kustomize resources may need ArgoCD to resolve. This is OK."

  # ── Apply cert-manager ──
  info "Installing cert-manager..."
  $KUBECTL apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml 2>/dev/null || true

  info "Waiting for cert-manager..."
  sleep 15
  $KUBECTL wait --for=condition=Available deployment/cert-manager \
    -n cert-manager --timeout=180s 2>/dev/null || warn "cert-manager still starting..."
  $KUBECTL wait --for=condition=Available deployment/cert-manager-webhook \
    -n cert-manager --timeout=180s 2>/dev/null || warn "cert-manager-webhook still starting..."

  # ── Apply Traefik ingress routes + TLS ──
  info "Applying Traefik ingress routes & TLS certificates..."
  # Wait briefly for cert-manager CRDs to be ready
  sleep 10
  $KUBECTL apply -f "${REPO_DIR}/infra/traefik/thermexpertise-single-node.yaml" 2>/dev/null || \
    warn "Some Traefik CRDs may not be ready yet. Re-apply after a minute."

  log "ArgoCD bootstrap complete — it will now auto-sync all applications"
}

# ── Step 9: Health Checks ────────────────────────────────────
health_check() {
  log "Step 9/9: Running health checks..."
  echo ""

  # Wait for pods to settle
  info "Waiting 60 seconds for pods to schedule..."
  sleep 60

  echo "── All Pods ──"
  $KUBECTL get pods --all-namespaces --no-headers 2>/dev/null | \
    awk '{printf "  %-20s %-40s %s\n", $1, $2, $4}'

  echo ""
  echo "── ArgoCD Applications ──"
  $KUBECTL get applications -n argocd --no-headers 2>/dev/null | \
    awk '{printf "  %-30s %s\n", $1, $3}' || info "No ArgoCD applications yet (syncing...)"

  echo ""
  echo "── PersistentVolumeClaims ──"
  $KUBECTL get pvc --all-namespaces --no-headers 2>/dev/null | \
    awk '{printf "  %-20s %-30s %-10s %s\n", $1, $2, $4, $5}'

  echo ""
  echo "── Services (ClusterIP/NodePort/LoadBalancer) ──"
  $KUBECTL get svc --all-namespaces --no-headers 2>/dev/null | \
    awk '{printf "  %-20s %-30s %-12s %s\n", $1, $2, $3, $5}'

  echo ""
  echo "── Certificates ──"
  $KUBECTL get certificates --all-namespaces --no-headers 2>/dev/null || info "No certificates yet"

  echo ""
  echo "── Node Resources ──"
  $KUBECTL top nodes 2>/dev/null || info "Metrics server not ready yet"

  echo ""
  echo "=========================================="
  echo " Deployment Complete!"
  echo "=========================================="
  echo ""
  echo " Domain:     https://${DOMAIN}"
  echo " API:        https://api.${DOMAIN}"
  echo " Grafana:    https://grafana.${DOMAIN}"
  echo " Node-RED:   https://nodered.${DOMAIN}"
  echo " ArgoCD:     kubectl port-forward svc/argocd-server -n argocd 8080:443"
  echo " aaPanel:    http://$(hostname -I | awk '{print $1}'):${AAPANEL_PORT}"
  echo ""
  echo " Secrets:    /root/.carbon-credit-secrets.txt"
  echo "             (back up securely, then delete)"
  echo ""
  echo " Next Steps:"
  echo "   1. Point DNS A records for ${DOMAIN}, api/grafana/nodered.${DOMAIN}"
  echo "      to this server's public IP."
  echo "   2. Check ArgoCD sync status: kubectl get app -n argocd"
  echo "   3. Restrict admin IP allowlist in Traefik middleware."
  echo "   4. Set up SSH key auth and disable password login."
  echo "=========================================="
}

# ── Main ─────────────────────────────────────────────────────
main() {
  preflight
  system_setup
  setup_firewall
  isolate_aapanel
  install_k3s
  sync_repo
  apply_namespaces
  create_secrets
  install_argocd
  health_check
}

main "$@"
