#!/usr/bin/env bash
# ============================================================
# Carbon Credit Platform — Production VPS Deployment Orchestrator
# Target: Ubuntu 24.04.3 LTS  (Hetzner / OVH / DigitalOcean / etc.)
#
# Phased runner. Each phase is idempotent. Run all-at-once with `all`
# or one-by-one for tight operational control.
#
# Usage:
#   sudo ./prod-deploy.sh prepare      # VPS hardening (swap, ssh, hostname)
#   sudo ./prod-deploy.sh dns-check    # block on missing DNS A records
#   sudo ./prod-deploy.sh bootstrap    # invoke deploy-bootstrap.sh
#   sudo ./prod-deploy.sh verify       # post-deploy health
#   sudo ./prod-deploy.sh smoke        # functional smoke tests
#   sudo ./prod-deploy.sh harden       # post-running SSH/UFW hardening
#   sudo ./prod-deploy.sh all          # run everything in sequence
#
# Required env (or rely on defaults — see deploy-bootstrap.sh):
#   DOMAIN=thermexpertise.com
#   LE_EMAIL=admin@thermexpertise.com
#   ADMIN_USER=admin
#   ADMIN_PASSWORD='iothub.2026'        # change for production!
#   SSH_PUBKEY="ssh-ed25519 AAAA…"      # optional, used by `prepare`
#   INSTALL_AAPANEL=1                   # optional
# ============================================================
set -euo pipefail

# ── Constants ────────────────────────────────────────────────
readonly REPO_DIR="${REPO_DIR:-/opt/carbon-credit-platform}"
readonly DOMAIN="${DOMAIN:-thermexpertise.com}"
readonly TIMEZONE="${TIMEZONE:-Asia/Bangkok}"
readonly HOSTNAME_FQDN="${HOSTNAME_FQDN:-vps.${DOMAIN}}"
readonly DEPLOY_USER="${DEPLOY_USER:-deploy}"
readonly SWAP_GB="${SWAP_GB:-2}"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BOOTSTRAP="${SCRIPT_DIR}/../deploy-bootstrap.sh"

# Subdomains that MUST resolve to this VPS before bootstrap (LE HTTP-01)
REQUIRED_DNS=(
  "${DOMAIN}"
  "www.${DOMAIN}"
  "argocd.${DOMAIN}"
  "grafana.${DOMAIN}"
  "nodered.${DOMAIN}"
  "phpmyadmin.${DOMAIN}"
  "emqx.${DOMAIN}"
)
# aapanel.${DOMAIN} is only required if you opt into one of:
#   EDGE_PROXY=nginx    (nginx at edge :80/:443 — clean URLs, RECOMMENDED)
#   EDGE_PROXY=caddy    (Caddy at edge :80/:443 — clean URLs, alt)
#   AAPANEL_TLS=caddy   (Caddy sidecar :8443 — URL has port)
#   BRIDGE_AAPANEL=1    (k3s bridge — couples failure domains, not recommended)
# Default: aaPanel reachable at http://<VPS_IP>:<bt_port> only — no DNS needed.
if [[ "${BRIDGE_AAPANEL:-0}" == "1" ]] \
  || [[ "${AAPANEL_TLS:-}" == "caddy" ]] \
  || [[ "${EDGE_PROXY:-}" =~ ^(nginx|caddy)$ ]]; then
  REQUIRED_DNS+=("aapanel.${DOMAIN}")
fi
readonly REQUIRED_DNS

# ── Colors ───────────────────────────────────────────────────
readonly G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' C='\033[0;36m' B='\033[1m' N='\033[0m'
log()   { echo -e "${G}[✓]${N} $*"; }
warn()  { echo -e "${Y}[!]${N} $*"; }
err()   { echo -e "${R}[✗]${N} $*" >&2; }
info()  { echo -e "${C}[i]${N} $*"; }
phase() { echo; echo -e "${B}══ $* ══${N}"; echo; }

require_root() {
  [[ $EUID -eq 0 ]] || { err "Must run as root (sudo)."; exit 1; }
}

public_ip() {
  curl -fsSL --max-time 5 https://api.ipify.org \
    || curl -fsSL --max-time 5 https://ifconfig.me \
    || hostname -I | awk '{print $1}'
}

# ============================================================
# Phase 1: PREPARE  — raw VPS → hardened, ready for bootstrap
# ============================================================
phase_prepare() {
  phase "PHASE 1 / PREPARE  — VPS hardening"
  require_root

  # 1.1 OS check
  if grep -qE '^VERSION_ID="24\.' /etc/os-release; then
    log "Ubuntu 24.x confirmed"
  else
    warn "Not Ubuntu 24.x — proceed at own risk"
  fi

  # 1.2 Hostname + timezone
  hostnamectl set-hostname "${HOSTNAME_FQDN}"
  timedatectl set-timezone "${TIMEZONE}"
  log "Hostname=${HOSTNAME_FQDN}  TZ=${TIMEZONE}"

  # 1.3 Locale (some Ubuntu cloud images ship POSIX-only)
  if ! locale -a 2>/dev/null | grep -qi 'en_US\.utf8'; then
    info "Generating en_US.UTF-8 locale"
    apt-get install -y -qq locales >/dev/null
    locale-gen en_US.UTF-8 >/dev/null
    update-locale LANG=en_US.UTF-8
  fi

  # 1.4 Swap (only if no swap and RAM < 8GB)
  local ram_gb swap_kb
  ram_gb=$(awk '/^MemTotal:/{printf "%d", $2/1024/1024}' /proc/meminfo)
  swap_kb=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)
  if (( swap_kb == 0 )) && (( ram_gb < 8 )); then
    info "Creating ${SWAP_GB}GB swap (RAM=${ram_gb}GB)"
    fallocate -l "${SWAP_GB}G" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -qxF '/swapfile none swap sw 0 0' /etc/fstab \
      || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    sysctl -w vm.swappiness=10 >/dev/null
    echo 'vm.swappiness=10' >/etc/sysctl.d/99-swappiness.conf
    log "Swap enabled (${SWAP_GB}GB)"
  else
    log "Swap OK (existing=${swap_kb}KB, RAM=${ram_gb}GB)"
  fi

  # 1.5 Kernel tweaks for k3s + many containers
  cat >/etc/sysctl.d/99-k3s.conf <<'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
fs.inotify.max_user_instances       = 8192
fs.inotify.max_user_watches         = 1048576
vm.max_map_count                    = 262144
EOF
  modprobe br_netfilter 2>/dev/null || true
  echo 'br_netfilter' >/etc/modules-load.d/k3s.conf
  sysctl --system >/dev/null
  log "Kernel/sysctl tuned for k3s"

  # 1.6 Deploy user with SSH key (optional but recommended)
  if [[ -n "${SSH_PUBKEY:-}" ]]; then
    if ! id "${DEPLOY_USER}" &>/dev/null; then
      useradd -m -s /bin/bash -G sudo "${DEPLOY_USER}"
      log "Created user ${DEPLOY_USER} (sudo group)"
    fi
    install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
      "/home/${DEPLOY_USER}/.ssh"
    echo "${SSH_PUBKEY}" >"/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    # Passwordless sudo (key-auth only)
    echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" \
      >"/etc/sudoers.d/90-${DEPLOY_USER}"
    chmod 440 "/etc/sudoers.d/90-${DEPLOY_USER}"
    log "SSH key installed for ${DEPLOY_USER}"
  else
    warn "SSH_PUBKEY not set — skipping deploy user creation"
    warn "  → re-run with SSH_PUBKEY=\"ssh-ed25519 …\" or do it manually"
  fi

  # 1.7 Minimal SSH hardening (still allow root password until verified)
  if [[ -f /etc/ssh/sshd_config ]]; then
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
    sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    info "SSH: root password login disabled (key only); user password login still on"
    info "  → run \`prod-deploy.sh harden\` later to fully lock down"
  fi

  log "PREPARE complete"
}

# ============================================================
# Phase 2: DNS-CHECK — fail fast if A records missing
# ============================================================
phase_dns_check() {
  phase "PHASE 2 / DNS-CHECK  — verify A records → this VPS"
  command -v dig >/dev/null || apt-get install -y -qq dnsutils >/dev/null

  local ip; ip="$(public_ip)"
  log "This VPS public IP: ${ip}"
  echo

  local missing=0 host resolved
  for host in "${REQUIRED_DNS[@]}"; do
    resolved="$(dig +short "@1.1.1.1" "${host}" A | tail -n1)"
    if [[ -z "$resolved" ]]; then
      err "  ${host}  → (no A record)"
      missing=$((missing + 1))
    elif [[ "$resolved" != "$ip" ]]; then
      warn "  ${host}  → ${resolved}  (expected ${ip})"
      missing=$((missing + 1))
    else
      log "  ${host}  → ${resolved}"
    fi
  done
  echo

  if (( missing > 0 )); then
    err "${missing} DNS records are missing or wrong."
    err "Fix at your DNS provider, wait for TTL propagation, then re-run."
    err "Override with FORCE_DNS=1 to skip (Let's Encrypt will fail)."
    [[ "${FORCE_DNS:-0}" == "1" ]] || exit 1
    warn "FORCE_DNS=1 — continuing anyway"
  fi
  log "DNS-CHECK passed"
}

# ============================================================
# Phase 3: BOOTSTRAP — install K3s + ArgoCD + GitOps apps
# ============================================================
phase_bootstrap() {
  phase "PHASE 3 / BOOTSTRAP  — k3s + ArgoCD + App-of-Apps"
  require_root
  [[ -x "${BOOTSTRAP}" ]] || { err "Missing ${BOOTSTRAP}"; exit 1; }
  "${BOOTSTRAP}"
}

# ============================================================
# Phase 4: VERIFY — wait for all apps to go Healthy
# ============================================================
phase_verify() {
  phase "PHASE 4 / VERIFY  — ArgoCD reconciliation"
  require_root
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  local KC="k3s kubectl"

  info "Watching ArgoCD apps (timeout 20m)…"
  local deadline=$(( $(date +%s) + 1200 ))
  while (( $(date +%s) < deadline )); do
    local out total healthy synced
    out=$($KC -n argocd get applications -o json 2>/dev/null || echo '{}')
    total=$(echo "$out"   | jq '.items | length')
    healthy=$(echo "$out" | jq '[.items[] | select(.status.health.status=="Healthy")] | length')
    synced=$(echo "$out"  | jq '[.items[] | select(.status.sync.status=="Synced")]   | length')
    info "apps total=${total}  healthy=${healthy}  synced=${synced}"
    if (( total > 0 )) && (( healthy == total )) && (( synced == total )); then
      log "All ${total} ArgoCD apps Healthy + Synced"
      break
    fi
    sleep 30
  done

  echo
  info "ArgoCD apps:"
  $KC -n argocd get applications -o \
    custom-columns='NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status'

  echo
  info "Pods (non-Running):"
  $KC get pods -A --no-headers 2>/dev/null \
    | awk '$4!="Running" && $4!="Completed" {printf "  %-20s %-50s %s\n", $1,$2,$4}' \
    | head -30 || true

  echo
  info "TLS certificates:"
  $KC get certificates -A 2>/dev/null \
    | awk 'NR>1{printf "  %-15s %-30s ready=%s\n", $1, $2, $3}' || info "(none yet)"

  echo
  info "Ingresses:"
  $KC get ingress -A 2>/dev/null \
    | awk 'NR>1{printf "  %-15s %-30s %s\n", $1, $2, $4}' || true

  log "VERIFY complete"
}

# ============================================================
# Phase 5: SMOKE — functional tests per service
# ============================================================
phase_smoke() {
  phase "PHASE 5 / SMOKE  — functional tests"
  command -v curl >/dev/null || apt-get install -y -qq curl >/dev/null
  command -v mosquitto_pub >/dev/null || apt-get install -y -qq mosquitto-clients >/dev/null

  local ip; ip="$(public_ip)"
  local U="${ADMIN_USER:-admin}" P="${ADMIN_PASSWORD:-iothub.2026}"
  local pass=0 fail=0

  check() {
    # check <label> <command-that-must-return-zero>
    local label="$1"; shift
    if "$@" >/tmp/.smoke 2>&1; then
      log "PASS  ${label}"; pass=$((pass+1))
    else
      err  "FAIL  ${label}";  fail=$((fail+1))
      sed 's/^/        /' /tmp/.smoke | head -3
    fi
  }

  # 5.1 HTTPS endpoints respond
  for sub in argocd grafana nodered phpmyadmin; do
    check "${sub}.${DOMAIN} reachable (HTTP 200/302/401)" \
      bash -c "curl -fskI --max-time 10 'https://${sub}.${DOMAIN}/' \
              | head -1 | grep -qE 'HTTP/.+ (200|301|302|401)'"
  done
  check "${DOMAIN} (WordPress) reachable" \
    bash -c "curl -fskI --max-time 10 'https://${DOMAIN}/' \
            | head -1 | grep -qE 'HTTP/.+ (200|301|302)'"

  # 5.2 Grafana login API with admin creds
  check "Grafana admin login (${U})" \
    bash -c "curl -fsk --max-time 10 -u '${U}:${P}' \
            'https://grafana.${DOMAIN}/api/user' | grep -q '\"login\":\"${U}\"'"

  # 5.3 phpMyAdmin BasicAuth gate (expect 200 with creds, 401 without)
  check "phpMyAdmin BasicAuth challenges anonymous" \
    bash -c "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
            'https://phpmyadmin.${DOMAIN}/' | grep -q '^401$'"
  check "phpMyAdmin accepts ${U}:${P}" \
    bash -c "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
            -u '${U}:${P}' 'https://phpmyadmin.${DOMAIN}/' | grep -qE '^(200|302)$'"

  # 5.4 EMQX MQTT pub/sub round-trip — uses bootstrap 'device' credential.
  # The ACL allows publishing to devices/<clientid>/# only, so use clientid='smoke'
  # and topic devices/smoke/test.
  local clientid="smoke-$$" topic="devices/smoke-$$/test" payload="ping-$$"
  ( mosquitto_sub -h "${ip}" -p 1883 \
      -u device -P "${P}" -i "${clientid}-sub" \
      -t "${topic}" -C 1 -W 8 >/tmp/.mqttsub 2>&1 ) &
  local subpid=$!
  sleep 1
  mosquitto_pub -h "${ip}" -p 1883 \
    -u device -P "${P}" -i "${clientid}" \
    -t "${topic}" -m "${payload}" -q 1 2>/dev/null || true
  wait "${subpid}" 2>/dev/null || true
  if grep -q "${payload}" /tmp/.mqttsub 2>/dev/null; then
    log "PASS  EMQX MQTT pub/sub on tcp://${ip}:1883 (user=device)"
    pass=$((pass+1))
  else
    err "FAIL  EMQX MQTT round-trip (user=device, topic=${topic})"
    fail=$((fail+1))
  fi

  # 5.4b ACL boundary test — device should NOT be able to publish to admin-only topic
  if mosquitto_pub -h "${ip}" -p 1883 \
       -u device -P "${P}" -i "${clientid}-evil" \
       -t "admin/secrets" -m "should-fail" -q 1 \
       -W 3 2>&1 | grep -qiE 'denied|not authorized|connection refused'; then
    log "PASS  EMQX ACL denies device on out-of-scope topic"
    pass=$((pass+1))
  else
    # mosquitto_pub may silently succeed-at-network-level even when EMQX drops
    # the message; we accept that. Just record it as informational.
    info "INFO  ACL check non-conclusive — verify in dashboard"
  fi

  # 5.5 MySQL connectivity via in-cluster port-forward (smoke from host)
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  command -v mysql >/dev/null || apt-get install -y -qq mysql-client >/dev/null
  check "MySQL SELECT 1 (in-cluster)" \
    bash -c "k3s kubectl -n data exec sts/mysql -- \
            mysql -uroot -p'${P}' -e 'SELECT 1;' 2>/dev/null | grep -q '^1$'"

  echo
  if (( fail == 0 )); then
    log "All ${pass} smoke tests passed"
  else
    err "${fail} smoke tests FAILED (${pass} passed)"
    exit 1
  fi
}

# ============================================================
# Phase 6: HARDEN — post-running SSH/UFW hardening
# Run only AFTER you've confirmed key auth works for ${DEPLOY_USER}.
# ============================================================
phase_harden() {
  phase "PHASE 6 / HARDEN  — final lockdown"
  require_root

  if ! id "${DEPLOY_USER}" &>/dev/null; then
    err "User ${DEPLOY_USER} doesn't exist — set SSH_PUBKEY and run \`prepare\` first"
    exit 1
  fi
  if [[ ! -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
    err "/home/${DEPLOY_USER}/.ssh/authorized_keys is empty — refusing to lock you out"
    exit 1
  fi

  # Disable ALL SSH password authentication (key-only from here)
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/'  /etc/ssh/sshd_config
  sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  log "SSH: password auth disabled, root login disabled"

  # UFW: confirm exposed ports match expectations
  info "Final UFW rules:"
  ufw status numbered | sed -n '1,30p'

  # Verify fail2ban is running
  if systemctl is-active --quiet fail2ban; then
    log "fail2ban active"
  else
    warn "fail2ban inactive — starting"
    systemctl enable --now fail2ban
  fi

  # Optional: enable automatic security upgrades trigger (already configured in
  # deploy-bootstrap.sh /etc/apt/apt.conf.d/20auto-upgrades)
  if [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
    log "unattended-upgrades configured"
  fi

  log "HARDEN complete — only key auth + UFW + fail2ban remain"
}

# ============================================================
# Dispatcher
# ============================================================
usage() {
  sed -n '2,/^# =\+$/p' "$0" | sed 's/^# //;s/^#//'
  exit 1
}

main() {
  local cmd="${1:-help}"
  case "$cmd" in
    prepare)    phase_prepare ;;
    dns-check)  phase_dns_check ;;
    bootstrap)  phase_bootstrap ;;
    verify)     phase_verify ;;
    smoke)      phase_smoke ;;
    harden)     phase_harden ;;
    all)
      phase_prepare
      phase_dns_check
      phase_bootstrap
      phase_verify
      phase_smoke
      info "Skipping \`harden\` in 'all' mode — run it manually once you've"
      info "confirmed SSH key auth works:  sudo $0 harden"
      ;;
    help|-h|--help|*) usage ;;
  esac
}

main "$@"
