#!/usr/bin/env bash
# ============================================================
# Carbon Credit Platform — Full Deployment Script (v2)
# Target: Ubuntu 24 LTS single-node (thermexpertise server)
#
# This script is IDEMPOTENT — safe to re-run.
# Usage:  chmod +x deploy-all.sh && sudo ./deploy-all.sh
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
SECRETS_LOG="/root/.carbon-credit-secrets.txt"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

gen_password() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20 || true; }

# ── Detect aaPanel port from ALL sources ─────────────────────
detect_aapanel_port() {
  # Method 1: config file
  if [[ -f /www/server/panel/data/port.pl ]]; then
    cat /www/server/panel/data/port.pl
    return
  fi
  # Method 2: running process
  local port
  port=$(ss -tlnp 2>/dev/null | grep -E 'python.*BT-Panel|bt_panel|runserver' | grep -oP ':\K[0-9]+' | head -1 || true)
  if [[ -n "$port" ]]; then echo "$port"; return; fi
  # Method 3: bt command
  if command -v bt &>/dev/null; then
    port=$(bt default 2>/dev/null | grep -oP 'port:\s*\K[0-9]+' || true)
    if [[ -n "$port" ]]; then echo "$port"; return; fi
  fi
  echo ""
}

# ── Pre-flight ───────────────────────────────────────────────
preflight() {
  echo ""
  echo "=========================================="
  echo " Carbon Credit Platform — Full Deployment"
  echo "=========================================="
  echo ""
  [[ $EUID -ne 0 ]] && { err "Must be root."; exit 1; }
  grep -qi "ubuntu" /etc/os-release 2>/dev/null || warn "Not Ubuntu — proceeding anyway"

  local ram; ram=$(free -m | awk '/^Mem:/{print $2}')
  [[ $ram -lt 3500 ]] && warn "RAM: ${ram}MB (recommend 4GB+)" || log "RAM: ${ram}MB"

  local disk; disk=$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')
  [[ $disk -lt 15 ]] && { err "Disk: ${disk}GB (need 15GB+)"; exit 1; }
  log "Disk: ${disk}GB"

  info "K3s: ${INSTALL_K3S_VERSION} | ArgoCD: ${ARGOCD_VERSION} | Domain: ${DOMAIN}"
  echo ""
}

# ── Step 1: System ───────────────────────────────────────────
system_setup() {
  log "Step 1/10: System updates..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git jq ufw fail2ban unattended-upgrades \
    ca-certificates gnupg lsb-release > /dev/null 2>&1

  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  if [[ ! -f /etc/fail2ban/jail.local ]]; then
    cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
EOF
    systemctl enable fail2ban --now 2>/dev/null || true
  fi
  log "System essentials installed"
}

# ── Step 2: Firewall ─────────────────────────────────────────
setup_firewall() {
  log "Step 2/10: Configuring UFW firewall..."

  # Detect aaPanel port BEFORE resetting firewall
  local DETECTED_BT_PORT
  DETECTED_BT_PORT=$(detect_aapanel_port)

  ufw --force reset > /dev/null 2>&1
  ufw default deny incoming > /dev/null 2>&1
  ufw default allow outgoing > /dev/null 2>&1

  # Core ports
  ufw allow 22/tcp comment 'SSH' > /dev/null 2>&1
  ufw allow 80/tcp comment 'HTTP' > /dev/null 2>&1
  ufw allow 443/tcp comment 'HTTPS' > /dev/null 2>&1
  ufw allow 8883/tcp comment 'MQTTS IoT' > /dev/null 2>&1

  # K3s API (local only)
  ufw allow from 127.0.0.0/8 to any port 6443 proto tcp comment 'K3s local' > /dev/null 2>&1
  ufw allow from 10.42.0.0/16 to any port 6443 proto tcp comment 'K3s pods' > /dev/null 2>&1
  ufw allow from 10.43.0.0/16 to any port 6443 proto tcp comment 'K3s svcs' > /dev/null 2>&1

  # aaPanel — open ALL possible ports
  local ports_opened=""
  if [[ -n "$DETECTED_BT_PORT" ]]; then
    ufw allow "${DETECTED_BT_PORT}"/tcp comment 'aaPanel detected' > /dev/null 2>&1
    ports_opened="${DETECTED_BT_PORT}"
    info "Detected aaPanel on port ${DETECTED_BT_PORT}"
  fi
  # Always also open the configured fallback port
  if [[ "$DETECTED_BT_PORT" != "$AAPANEL_PORT" ]]; then
    ufw allow "${AAPANEL_PORT}"/tcp comment 'aaPanel fallback' > /dev/null 2>&1
    ports_opened="${ports_opened:+${ports_opened}, }${AAPANEL_PORT}"
  fi
  # Also scan for any bt/panel process on unusual ports
  for p in $(ss -tlnp 2>/dev/null | grep -iE 'python|bt' | grep -oP ':\K[0-9]+' || true); do
    if [[ "$p" != "22" && "$p" != "80" && "$p" != "443" ]]; then
      ufw allow "${p}"/tcp comment "aaPanel-related ${p}" > /dev/null 2>&1
      ports_opened="${ports_opened:+${ports_opened}, }${p}"
    fi
  done

  ufw --force enable > /dev/null 2>&1
  log "Firewall up — open: 22, 80, 443, 8883${ports_opened:+, ${ports_opened}}"
  echo ""
  info "UFW rules:"
  ufw status numbered 2>/dev/null | head -30
  echo ""
}

# ── Step 3: Isolate aaPanel ──────────────────────────────────
isolate_aapanel() {
  [[ "${SKIP_AAPANEL_ISOLATE:-0}" == "1" ]] && { info "Skip aaPanel isolation"; return; }
  log "Step 3/10: aaPanel isolation..."

  # Stop aaPanel-managed web servers conflicting with Traefik 80/443
  for svc in nginx apache2 httpd; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      warn "Stopping $svc (conflicts with Traefik 80/443)..."
      systemctl stop "$svc" 2>/dev/null || true
      systemctl disable "$svc" 2>/dev/null || true
    fi
  done

  # Detect aaPanel by checking multiple paths
  if command -v bt &>/dev/null || [[ -f /etc/init.d/bt ]] || [[ -d /www/server/panel ]]; then
    info "aaPanel detected!"
    if [[ -f /www/server/panel/data/port.pl ]]; then
      local current; current=$(cat /www/server/panel/data/port.pl)
      log "aaPanel is on port ${current}"
      # Ensure UFW has it open (belt and suspenders)
      ufw allow "${current}"/tcp comment 'aaPanel confirmed' > /dev/null 2>&1
    fi

    # Stop aaPanel MySQL if it conflicts with K8s MySQL
    if [[ -f /etc/init.d/mysqld ]] || systemctl is-active --quiet mysqld 2>/dev/null; then
      warn "Stopping host MySQL (K3s runs MySQL in a pod)..."
      systemctl stop mysqld 2>/dev/null || /etc/init.d/mysqld stop 2>/dev/null || true
      systemctl disable mysqld 2>/dev/null || true
    fi
  else
    info "aaPanel not found via bt/init.d/panel dir."
    # Last resort: check if ANYTHING listens on common bt ports
    for tryport in 8888 8889 8890 14839 39471; do
      if ss -tlnp 2>/dev/null | grep -q ":${tryport} "; then
        warn "Found listener on port ${tryport} — opening UFW just in case..."
        ufw allow "${tryport}"/tcp comment "possible panel port" > /dev/null 2>&1
      fi
    done
  fi
}

# ── Step 4: Install K3s ──────────────────────────────────────
install_k3s() {
  log "Step 4/10: Installing K3s..."

  if command -v k3s &>/dev/null; then
    info "K3s already installed: $(k3s --version | head -1)"
  fi

  export INSTALL_K3S_VERSION
  export INSTALL_K3S_EXEC="--disable servicelb --write-kubeconfig-mode 644"
  curl -sfL https://get.k3s.io | sh -

  info "Waiting for node Ready..."
  local tries=0
  while ! $KUBECTL wait --for=condition=Ready nodes --all --timeout=30s 2>/dev/null; do
    tries=$((tries + 1))
    [[ $tries -ge 20 ]] && { err "K3s not ready after 10min"; exit 1; }
    sleep 30
  done
  log "K3s running"
  $KUBECTL get nodes -o wide
}

# ── Step 5: Sync Repo ────────────────────────────────────────
sync_repo() {
  log "Step 5/10: Syncing repo..."
  if [[ -d "${REPO_DIR}/.git" ]]; then
    info "Pulling latest..."
    cd "${REPO_DIR}" && git fetch origin && git reset --hard origin/main
  else
    git clone "${REPO_URL}" "${REPO_DIR}"
  fi
  cd "${REPO_DIR}"
  log "Repo: $(git log --oneline -1)"
}

# ── Step 6: Namespaces ───────────────────────────────────────
apply_namespaces() {
  log "Step 6/10: Applying namespaces..."
  $KUBECTL apply -f "${REPO_DIR}/infra/k3s/namespaces.yaml"
  for ns in argocd carbon-credit cert-manager; do
    $KUBECTL create namespace "$ns" --dry-run=client -o yaml | $KUBECTL apply -f -
  done
  log "Namespaces ready"
}

# ── Step 7: Secrets ──────────────────────────────────────────
create_secrets() {
  log "Step 7/10: Creating secrets..."

  # MySQL
  if ! $KUBECTL get secret mysql-auth -n carbon-credit &>/dev/null; then
    local pw; pw=$(gen_password)
    $KUBECTL create secret generic mysql-auth -n carbon-credit \
      --from-literal=root-password="${pw}" \
      --from-literal=exporter-dsn="root:${pw}@(127.0.0.1:3306)/"
    echo "[$(date -Iseconds)] mysql-auth root-password=${pw}" >> "${SECRETS_LOG}"
    log "MySQL secret created"
  else info "MySQL secret exists"; fi

  # Mosquitto
  if ! $KUBECTL get secret mosquitto-auth -n carbon-credit &>/dev/null; then
    local pw; pw=$(gen_password)
    $KUBECTL create secret generic mosquitto-auth -n carbon-credit \
      --from-literal=username=admin --from-literal=password="${pw}"
    echo "[$(date -Iseconds)] mosquitto-auth admin/${pw}" >> "${SECRETS_LOG}"
    log "Mosquitto secret created"
  else info "Mosquitto secret exists"; fi

  # Grafana
  if ! $KUBECTL get secret grafana-admin-credentials -n monitoring &>/dev/null; then
    local pw; pw=$(gen_password)
    $KUBECTL create secret generic grafana-admin-credentials -n monitoring \
      --from-literal=admin-user=admin --from-literal=admin-password="${pw}"
    echo "[$(date -Iseconds)] grafana admin/${pw}" >> "${SECRETS_LOG}"
    log "Grafana secret created"
  else info "Grafana secret exists"; fi

  # Backend
  if ! $KUBECTL get secret backend-secrets -n app &>/dev/null; then
    local pw; pw=$(gen_password)
    $KUBECTL create secret generic backend-secrets -n app \
      --from-literal=database-url="mysql://root:${pw}@mysql.carbon-credit.svc.cluster.local:3306/carbon_credit"
    echo "[$(date -Iseconds)] backend db-pw=${pw}" >> "${SECRETS_LOG}"
    log "Backend secret created"
  else info "Backend secret exists"; fi

  chmod 600 "${SECRETS_LOG}" 2>/dev/null || true
  warn "Secrets → ${SECRETS_LOG}"
}

# ── Step 8: ArgoCD + Bootstrap ───────────────────────────────
install_argocd() {
  log "Step 8/10: ArgoCD & bootstrap..."

  $KUBECTL apply -n argocd \
    -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

  info "Waiting for ArgoCD..."
  $KUBECTL wait --for=condition=Available deployment/argocd-server -n argocd --timeout=300s
  log "ArgoCD running"

  local argocd_pw
  argocd_pw=$($KUBECTL -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath="{.data.password}" 2>/dev/null | base64 -d || echo "N/A")
  info "ArgoCD password: ${argocd_pw}"
  echo "[$(date -Iseconds)] argocd admin/${argocd_pw}" >> "${SECRETS_LOG}"

  # Root App-of-Apps
  $KUBECTL apply -f "${REPO_DIR}/infra/k8s/argocd/application.yaml"

  # Bootstrap core apps via kubectl
  info "Bootstrapping apps..."
  $KUBECTL apply -k "${REPO_DIR}/infra/k8s/apps/base/" 2>/dev/null || \
    warn "Some resources need ArgoCD — OK"

  # cert-manager
  info "Installing cert-manager..."
  $KUBECTL apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml 2>/dev/null || true
  sleep 15
  $KUBECTL wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=180s 2>/dev/null || true
  $KUBECTL wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=180s 2>/dev/null || true

  # Traefik ingress
  sleep 10
  $KUBECTL apply -f "${REPO_DIR}/infra/traefik/thermexpertise-single-node.yaml" 2>/dev/null || \
    warn "Traefik CRDs not ready — will retry in fix step"

  log "ArgoCD bootstrap complete"
}

# ── Step 9: Fix Known Issues ─────────────────────────────────
fix_known_issues() {
  log "Step 9/10: Fixing known issues..."

  # ── Fix 1: Traefik LoadBalancer <pending> ──
  # ServiceLB is disabled, so Traefik svc stays <pending> as LoadBalancer.
  # Patch it to use host ports directly via DaemonSet or patch svc type.
  info "Fix: Traefik service type..."
  local traefik_type
  traefik_type=$($KUBECTL get svc traefik -n kube-system -o jsonpath='{.spec.type}' 2>/dev/null || echo "")
  if [[ "$traefik_type" == "LoadBalancer" ]]; then
    # Patch Traefik deployment to use hostPort so 80/443 bind to the node
    $KUBECTL patch deployment traefik -n kube-system --type=json -p='[
      {"op":"add","path":"/spec/template/spec/containers/0/ports/0/hostPort","value":80},
      {"op":"add","path":"/spec/template/spec/containers/0/ports/1/hostPort","value":443}
    ]' 2>/dev/null || warn "Traefik hostPort patch skipped (may already be set)"

    # Also patch service to ClusterIP since hostPort handles external traffic
    $KUBECTL patch svc traefik -n kube-system -p '{"spec":{"type":"ClusterIP"}}' 2>/dev/null || true
    log "Traefik patched to use hostPort 80/443"
  else
    info "Traefik service type is ${traefik_type} — OK"
  fi

  # ── Fix 2: ImagePullBackOff — patch images to use placeholder or nginx ──
  # The manifests reference registry.ci.svc.cluster.local which doesn't exist.
  # Until CI builds real images, use placeholder containers so pods run.
  info "Fix: ImagePullBackOff pods..."

  # Frontend → nginx with a welcome page
  $KUBECTL set image deployment/frontend-web -n app \
    frontend=nginx:1.27-alpine 2>/dev/null || true

  # Backend → simple node image (will show default page, but pod will run)
  $KUBECTL set image deployment/backend-api -n app \
    backend=nginx:1.27-alpine 2>/dev/null || true

  # AI Agents → simple python placeholder
  $KUBECTL set image deployment/ai-agents -n ai \
    ai-agents=nginx:1.27-alpine 2>/dev/null || true

  log "Pods patched with nginx:1.27-alpine placeholders (replace with real images later)"

  # ── Fix 3: MySQL pod Error ──
  info "Fix: MySQL pod..."
  local mysql_status
  mysql_status=$($KUBECTL get pod mysql-0 -n carbon-credit -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")

  if [[ "$mysql_status" != "Running" ]]; then
    info "MySQL status: ${mysql_status} — checking logs..."
    $KUBECTL logs mysql-0 -n carbon-credit --tail=20 2>/dev/null || true

    # Common fix: delete the pod so StatefulSet recreates it with correct secrets
    warn "Restarting MySQL pod..."
    $KUBECTL delete pod mysql-0 -n carbon-credit --grace-period=10 2>/dev/null || true

    info "Waiting for MySQL to come back..."
    sleep 30
    local retries=0
    while [[ $retries -lt 6 ]]; do
      mysql_status=$($KUBECTL get pod mysql-0 -n carbon-credit -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
      if [[ "$mysql_status" == "Running" ]]; then
        log "MySQL is Running!"
        break
      fi
      info "MySQL status: ${mysql_status} (attempt $((retries+1))/6)..."
      retries=$((retries + 1))
      sleep 15
    done

    if [[ "$mysql_status" != "Running" ]]; then
      warn "MySQL still not running. Checking logs:"
      $KUBECTL logs mysql-0 -n carbon-credit --tail=30 2>/dev/null || true
      warn "You may need to delete the PVC and recreate: "
      warn "  kubectl delete pvc mysql-data-mysql-0 -n carbon-credit"
      warn "  kubectl delete statefulset mysql -n carbon-credit"
      warn "  kubectl apply -k ${REPO_DIR}/infra/k8s/apps/base/"
    fi
  else
    log "MySQL already Running"
  fi

  # ── Fix 4: Re-apply Traefik routes (in case cert-manager wasn't ready) ──
  info "Re-applying Traefik ingress routes..."
  $KUBECTL apply -f "${REPO_DIR}/infra/traefik/thermexpertise-single-node.yaml" 2>/dev/null || true

  # ── Fix 5: Ensure aaPanel port is definitely open ──
  info "Final aaPanel firewall check..."
  local bt_port
  bt_port=$(detect_aapanel_port)
  if [[ -n "$bt_port" ]]; then
    ufw allow "${bt_port}"/tcp comment 'aaPanel final check' > /dev/null 2>&1
    log "aaPanel port ${bt_port} confirmed open in UFW"
  else
    # Nuclear option: scan all listening TCP ports and report
    info "Scanning all listening ports for panel processes..."
    local all_ports
    all_ports=$(ss -tlnp 2>/dev/null | grep -v "^State" | awk '{print $4}' | grep -oP ':\K[0-9]+' | sort -un)
    info "All listening ports: ${all_ports//$'\n'/, }"
    # Open common aaPanel ports just in case
    for p in 8888 8889 8890; do
      ufw allow "${p}"/tcp comment 'aaPanel common port' > /dev/null 2>&1
    done
    warn "Opened ports 8888-8890 as fallback. Check: bt default"
  fi

  log "Known issues addressed"
}

# ── Step 10: Health Check ────────────────────────────────────
health_check() {
  log "Step 10/10: Final health check..."
  echo ""

  info "Waiting 30s for pods to settle..."
  sleep 30

  echo "── All Pods ──"
  $KUBECTL get pods --all-namespaces -o wide --no-headers 2>/dev/null | \
    awk '{printf "  %-18s %-42s %-20s %s\n", $1, $2, $4, $8}'

  echo ""
  echo "── ArgoCD Apps ──"
  $KUBECTL get applications -n argocd --no-headers 2>/dev/null | \
    awk '{printf "  %-30s %s\n", $1, $3}' || info "Syncing..."

  echo ""
  echo "── PVCs ──"
  $KUBECTL get pvc --all-namespaces --no-headers 2>/dev/null | \
    awk '{printf "  %-18s %-30s %s\n", $1, $2, $4}'

  echo ""
  echo "── Traefik Check ──"
  $KUBECTL get svc traefik -n kube-system 2>/dev/null || true
  $KUBECTL get pods -n kube-system -l app.kubernetes.io/name=traefik 2>/dev/null || true

  echo ""
  echo "── Certificates ──"
  $KUBECTL get certificates --all-namespaces 2>/dev/null || info "No certs yet"

  echo ""
  echo "── UFW Status ──"
  ufw status | grep -E "ALLOW|Status" | head -20

  echo ""
  echo "── Node Resources ──"
  $KUBECTL top nodes 2>/dev/null || info "Metrics not ready"

  # Display aaPanel info
  local bt_port; bt_port=$(detect_aapanel_port)
  local server_ip; server_ip=$(hostname -I | awk '{print $1}')

  echo ""
  echo "=========================================="
  echo " ✅ Deployment Complete!"
  echo "=========================================="
  echo ""
  echo " 🌐 Domain:     https://${DOMAIN}"
  echo " 🔌 API:        https://api.${DOMAIN}"
  echo " 📊 Grafana:    https://grafana.${DOMAIN}"
  echo " 🔧 Node-RED:   https://nodered.${DOMAIN}"
  echo " 🚀 ArgoCD:     kubectl port-forward svc/argocd-server -n argocd 8080:443"
  if [[ -n "$bt_port" ]]; then
    echo " 🖥️  aaPanel:    http://${server_ip}:${bt_port}"
  else
    echo " 🖥️  aaPanel:    http://${server_ip}:${AAPANEL_PORT} (or check: bt default)"
  fi
  echo ""
  echo " 🔑 Secrets:    ${SECRETS_LOG}"
  echo ""
  echo " 📋 Next Steps:"
  echo "   1. DNS A records → ${server_ip} for:"
  echo "      ${DOMAIN}, api.${DOMAIN}, grafana.${DOMAIN}, nodered.${DOMAIN}"
  echo "   2. Build & push real Docker images to replace nginx placeholders"
  echo "   3. Set up SSH key auth: ssh-copy-id user@${server_ip}"
  echo "   4. Restrict admin IPs in Traefik middleware"
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
  fix_known_issues   # NEW: fixes aaPanel, images, MySQL, Traefik
  health_check
}

main "$@"
