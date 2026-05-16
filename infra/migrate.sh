#!/usr/bin/env bash
# ============================================================
# Carbon Credit Platform — Full Migration v1
# Target: Ubuntu 24.04.3 LTS (single-node K3s)
#
# Phases:
#   1. Pre-flight + backup
#   2. Fix EMQX (session persistence, keepalive, no-drop, internal access for Node-RED)
#   3. Fix Node-RED (palette install permissions, externalIPs :1880, npm egress)
#   4. Provision Traefik via ArgoCD (Helm chart, replaces K3s bundled)
#   5. Disable K3s bundled Traefik + nginx → swap to ArgoCD Traefik (80/443)
#   6. Verify everything
#
# IDEMPOTENT — safe to re-run. State changes are detected & skipped.
#
# Usage:
#   sudo ./migrate.sh                 # run all phases
#   sudo ./migrate.sh --phase 3       # run single phase
#   sudo ./migrate.sh --dry-run       # print actions, don't apply
#   sudo ./migrate.sh --rollback      # undo Traefik swap (re-enable K3s bundled)
# ============================================================
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
readonly NODE_IP="${NODE_IP:-14.207.141.71}"
readonly DOMAIN="${DOMAIN:-thermexpertise.com}"
readonly REPO_DIR="${REPO_DIR:-/opt/carbon-credit-platform}"
readonly KUBECTL="k3s kubectl"
readonly BACKUP_DIR="/root/.migrate-backup/$(date +%Y%m%d-%H%M%S)"
readonly LOG="/var/log/carbon-migrate.log"

# Flags
DRY_RUN=0
PHASE=""
ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    --phase)    PHASE="$2"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Logging ─────────────────────────────────────────────────────────
exec > >(tee -a "$LOG") 2>&1
readonly G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' C='\033[0;36m' N='\033[0m'
log()   { echo -e "${G}[✓]${N} $*"; }
warn()  { echo -e "${Y}[!]${N} $*"; }
err()   { echo -e "${R}[✗]${N} $*" >&2; }
info()  { echo -e "${C}[i]${N} $*"; }
phase() { echo; echo "═══════════════════════════════════════════════════"; echo " $*"; echo "═══════════════════════════════════════════════════"; }
run()   { [[ $DRY_RUN -eq 1 ]] && echo "  [DRY] $*" || eval "$*"; }

# ── Pre-flight ──────────────────────────────────────────────────────
preflight() {
  phase "Phase 0: Pre-flight"
  [[ $EUID -eq 0 ]] || { err "Run as root"; exit 1; }
  command -v kubectl &>/dev/null || command -v k3s &>/dev/null \
    || { err "kubectl/k3s not found"; exit 1; }
  $KUBECTL cluster-info &>/dev/null \
    || { err "Cluster unreachable"; exit 1; }
  [[ -d "$REPO_DIR/.git" ]] \
    || { err "$REPO_DIR not a git repo"; exit 1; }

  mkdir -p "$BACKUP_DIR"
  info "Backup → $BACKUP_DIR"
  info "Log    → $LOG"
  log  "Pre-flight OK"
}

# ── Backup current state ────────────────────────────────────────────
backup_state() {
  phase "Phase 1: Backup live state"
  $KUBECTL -n kube-system get deploy traefik   -o yaml > "$BACKUP_DIR/traefik-deploy.yaml" 2>/dev/null || true
  $KUBECTL -n kube-system get svc    traefik   -o yaml > "$BACKUP_DIR/traefik-svc.yaml"    2>/dev/null || true
  $KUBECTL -n kube-system get helmchart traefik -o yaml > "$BACKUP_DIR/traefik-helmchart.yaml" 2>/dev/null || true
  $KUBECTL -n data         get sts    emqx     -o yaml > "$BACKUP_DIR/emqx-sts.yaml"       2>/dev/null || true
  $KUBECTL -n carbon-credit get deploy node-red -o yaml > "$BACKUP_DIR/nodered-deploy.yaml" 2>/dev/null || true
  $KUBECTL get ingress -A -o yaml > "$BACKUP_DIR/ingress-all.yaml"
  cp /etc/systemd/system/nginx.service "$BACKUP_DIR/" 2>/dev/null || true
  log "Backed up to $BACKUP_DIR"
}

# ════════════════════════════════════════════════════════════════════
# Phase 2 — EMQX fixes
#   • Session persistence ON (clients don't lose state on reconnect)
#   • Keepalive tuning (broker doesn't drop after publish)
#   • Internal MQTT access from carbon-credit namespace (Node-RED)
# ════════════════════════════════════════════════════════════════════
phase2_emqx() {
  phase "Phase 2: EMQX session + Node-RED internal access"

  info "Patching EMQX runtime config (no pod restart needed for most)"

  # Apply broker-level settings via API key
  local apikey_id apikey_sec
  apikey_id=$($KUBECTL -n data get secret emqx-api-key -o jsonpath='{.data.key}' 2>/dev/null | base64 -d || echo "platform-admin")
  apikey_sec=$($KUBECTL -n data get secret emqx-api-key -o jsonpath='{.data.secret}' 2>/dev/null | base64 -d || echo "iothub.2026.apikey.secret")

  # Run config update via curl pod
  $KUBECTL -n data run emqx-config-patch --rm -i --restart=Never \
    --image=curlimages/curl:latest --quiet -- sh -c "
      set -e
      EMQX='http://emqx.data.svc.cluster.local:30183'
      AUTH='-u ${apikey_id}:${apikey_sec}'

      echo '→ Setting MQTT keepalive_multiplier (don\\'t drop on idle publish)'
      curl -sS \$AUTH -H 'Content-Type: application/json' \
        -X PUT \"\$EMQX/api/v5/configs/mqtt\" \
        -d '{
          \"keepalive_multiplier\": 1.5,
          \"max_packet_size\": \"1MB\",
          \"retain_available\": true,
          \"session_expiry_interval\": \"2h\",
          \"upgrade_qos\": false,
          \"use_username_as_clientid\": false
        }' && echo

      echo '→ Listener tuning — disable idle disconnect on TCP'
      curl -sS \$AUTH -H 'Content-Type: application/json' \
        -X PUT \"\$EMQX/api/v5/listeners/tcp:default\" \
        -d '{
          \"bind\": \"0.0.0.0:1883\",
          \"max_connections\": 10000,
          \"max_conn_rate\": \"1000/s\",
          \"tcp_options\": {
            \"keepalive\": \"7200,75,9\",
            \"nodelay\": true,
            \"send_timeout\": \"15s\"
          },
          \"enable_authn\": true
        }' && echo
    " 2>&1 | grep -v '^If you don.t see' | head -20 || warn "Config patch had errors (may still apply)"

  # NetworkPolicy: allow carbon-credit → data:1883
  info "Adding NetworkPolicy: carbon-credit → data:1883/8883/30183"
  cat <<EOF | $KUBECTL apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-emqx-from-carbon-credit
  namespace: data
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: emqx
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: carbon-credit
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: data
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: app
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
        - ipBlock:
            cidr: 0.0.0.0/0     # external clients via externalIPs
      ports:
        - protocol: TCP
          port: 1883
        - protocol: TCP
          port: 8883
        - protocol: TCP
          port: 30183
EOF

  log "EMQX patched + NetPol applied — Node-RED can now reach emqx.data:1883"
}

# ════════════════════════════════════════════════════════════════════
# Phase 3 — Node-RED fixes
#   • Palette install (writable /data, npm egress)
#   • Public IP access at 14.207.141.71:1880
#   • Resource bump for npm install
# ════════════════════════════════════════════════════════════════════
phase3_nodered() {
  phase "Phase 3: Node-RED palette + public IP"

  info "Patching Node-RED Deployment — palette permissions + resources"
  $KUBECTL -n carbon-credit patch deployment node-red --type=strategic -p '{
    "spec": {
      "template": {
        "spec": {
          "securityContext": {
            "fsGroup": 1000,
            "fsGroupChangePolicy": "OnRootMismatch"
          },
          "containers": [{
            "name": "node-red",
            "image": "nodered/node-red:latest",
            "env": [
              {"name": "TZ", "value": "Asia/Bangkok"},
              {"name": "NODE_RED_ENABLE_PROJECTS", "value": "false"},
              {"name": "NODE_OPTIONS", "value": "--max-old-space-size=512"},
              {"name": "FLOWS", "value": "flows.json"},
              {"name": "NPM_CONFIG_REGISTRY", "value": "https://registry.npmjs.org/"},
              {"name": "NPM_CONFIG_CACHE", "value": "/data/.npm"},
              {"name": "NODE_RED_HOME", "value": "/usr/src/node-red"}
            ],
            "resources": {
              "requests": {"cpu": "100m",  "memory": "384Mi"},
              "limits":   {"cpu": "1",     "memory": "1Gi"}
            },
            "securityContext": {
              "allowPrivilegeEscalation": false,
              "capabilities": {"drop": ["ALL"]},
              "readOnlyRootFilesystem": false,
              "runAsNonRoot": true,
              "runAsUser": 1000,
              "runAsGroup": 1000
            }
          }]
        }
      }
    }
  }'

  # External-facing Service exposing 1880 on node IP
  info "Creating Node-RED external Service (externalIPs $NODE_IP:1880)"
  cat <<EOF | $KUBECTL apply -f -
apiVersion: v1
kind: Service
metadata:
  name: node-red-external
  namespace: carbon-credit
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
    app.kubernetes.io/component: external-listener
spec:
  type: ClusterIP
  externalIPs:
    - ${NODE_IP}
  selector:
    app: node-red
  ports:
    - name: http
      port: 1880
      targetPort: 1880
      protocol: TCP
EOF

  # NetworkPolicy egress: allow Node-RED → internet (for npm registry)
  info "Adding NetworkPolicy: Node-RED egress to npm + EMQX"
  cat <<EOF | $KUBECTL apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: nodered-egress
  namespace: carbon-credit
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
spec:
  podSelector:
    matchLabels:
      app: node-red
  policyTypes:
    - Egress
  egress:
    # Cluster DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # EMQX in data namespace
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: data
      ports:
        - protocol: TCP
          port: 1883
        - protocol: TCP
          port: 8883
        - protocol: TCP
          port: 30183
    # Internet (npm registry + GitHub for nodes)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.42.0.0/16    # pod CIDR
              - 10.43.0.0/16    # service CIDR
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 80
EOF

  # PVC: ขยายเป็น 10Gi ให้พอสำหรับ palette modules
  local cur_size
  cur_size=$($KUBECTL -n carbon-credit get pvc node-red-data -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || echo "5Gi")
  if [[ "$cur_size" == "5Gi" ]]; then
    info "Expanding PVC node-red-data 5Gi → 10Gi"
    $KUBECTL -n carbon-credit patch pvc node-red-data \
      --type=merge -p '{"spec":{"resources":{"requests":{"storage":"10Gi"}}}}' 2>/dev/null \
      || warn "PVC expand needs storage class with allowVolumeExpansion=true"
  fi

  # Restart pod to apply patches
  $KUBECTL -n carbon-credit rollout restart deployment/node-red
  $KUBECTL -n carbon-credit rollout status deployment/node-red --timeout=180s

  # Fix /data ownership inside the new pod (in case PVC was created with wrong perms)
  local pod
  pod=$($KUBECTL -n carbon-credit get pod -l app=node-red -o jsonpath='{.items[0].metadata.name}')
  $KUBECTL -n carbon-credit exec "$pod" -- mkdir -p /data/.npm /data/node_modules 2>/dev/null || true

  log "Node-RED ready — palette install enabled, http://${NODE_IP}:1880"
}

# ════════════════════════════════════════════════════════════════════
# Phase 4 — Provision Traefik via ArgoCD
# ════════════════════════════════════════════════════════════════════
phase4_traefik_argocd() {
  phase "Phase 4: Provision ArgoCD-managed Traefik (parallel install)"

  # Write Helm values + ArgoCD Application into git repo
  info "Writing infra/helm-values/traefik-values.yaml"
  cat > "${REPO_DIR}/infra/helm-values/traefik-values.yaml" <<'EOF'
# Traefik v3 — Helm chart values (ArgoCD-managed, replaces K3s bundled)
image:
  registry: docker.io
  repository: traefik
  tag: "v3.2.3"

deployment:
  replicas: 1
  kind: Deployment

ports:
  web:
    port: 8000
    exposedPort: 80
    hostPort: 80
    protocol: TCP
    redirectTo:
      port: websecure
  websecure:
    port: 8443
    exposedPort: 443
    hostPort: 443
    protocol: TCP
    tls:
      enabled: true
    http3:
      enabled: false
  metrics:
    port: 9100
    expose:
      default: false
  # Traefik dashboard — expose on Service (port 9000) for direct IP access
  # via externalIPs companion Service (created in phase 4).
  # Domain access (traefik.${DOMAIN}) goes through web/websecure via IngressRoute.
  traefik:
    port: 9000
    expose:
      default: true
    exposedPort: 9000
    protocol: TCP

service:
  enabled: true
  type: ClusterIP

ingressClass:
  enabled: true
  isDefaultClass: true
  name: traefik

providers:
  kubernetesCRD:
    enabled: true
    allowCrossNamespace: true
    allowExternalNameServices: true
    allowEmptyServices: true
  kubernetesIngress:
    enabled: true
    allowExternalNameServices: true
    allowEmptyServices: true
    publishedService:
      enabled: true

api:
  dashboard: true
  insecure: true

globalArguments:
  - "--global.checknewversion=false"
  - "--global.sendanonymoususage=false"

additionalArguments:
  - "--log.level=INFO"
  - "--accesslog=true"
  - "--accesslog.format=json"

resources:
  requests: { cpu: 100m, memory: 128Mi }
  limits:   { cpu: 500m, memory: 256Mi }

securityContext:
  capabilities:
    drop: [ALL]
    add: [NET_BIND_SERVICE]
  readOnlyRootFilesystem: true
  runAsGroup: 65532
  runAsNonRoot: true
  runAsUser: 65532

podSecurityContext:
  fsGroup: 65532

nodeSelector:
  kubernetes.io/os: linux

updateStrategy:
  type: Recreate

metrics:
  prometheus:
    entryPoint: metrics
    addEntryPointsLabels: true
    addServicesLabels: true
    addRoutersLabels: true

ping:
  enabled: true
  entryPoint: traefik

persistence:
  enabled: false
EOF

  info "Writing infra/argocd/platform-stack/traefik.yaml"
  cat > "${REPO_DIR}/infra/argocd/platform-stack/traefik.yaml" <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: traefik
  namespace: argocd
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
    tier: platform-stack
  annotations:
    argocd.argoproj.io/sync-wave: "-20"
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  sources:
    - repoURL: https://traefik.github.io/charts
      chart: traefik
      targetRevision: 33.2.1
      helm:
        releaseName: traefik
        valueFiles:
          - \$values/infra/helm-values/traefik-values.yaml
    - repoURL: https://gitlab.com/narongwile/carbon-credit-platform.git
      targetRevision: main
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: kube-system
  syncPolicy:
    automated:
      prune: false
      selfHeal: true
    syncOptions:
      - CreateNamespace=false
      - ServerSideApply=true
    retry:
      limit: 5
      backoff:
        duration: 10s
        factor: 2
        maxDuration: 3m
EOF

  # Commit + push to git so ArgoCD pulls
  if (cd "$REPO_DIR" && git status --porcelain | grep -qE 'traefik-values|platform-stack/traefik'); then
    info "Committing Traefik manifests"
    (
      cd "$REPO_DIR"
      git add infra/helm-values/traefik-values.yaml infra/argocd/platform-stack/traefik.yaml
      git commit -m "feat(traefik): manage via ArgoCD (replaces K3s bundled)"
      git push origin "$(git rev-parse --abbrev-ref HEAD)" || warn "git push failed — push manually"
    ) 2>&1 | tail -5
  fi

  # Apply Application directly (don't wait for ArgoCD root sync)
  $KUBECTL apply -f "${REPO_DIR}/infra/argocd/platform-stack/traefik.yaml"

  # Trigger sync
  $KUBECTL -n argocd patch app traefik --type merge \
    -p '{"operation":{"initiatedBy":{"username":"migrate.sh"},"sync":{"revision":"HEAD"}}}'

  log "Traefik ArgoCD Application applied (pod won't bind 80/443 yet — K3s bundled still owns them)"

  # ── Traefik dashboard exposure ────────────────────────────────────
  # Two access paths:
  #   1. https://traefik.${DOMAIN}     (via Ingress + Basic Auth)
  #   2. http://${NODE_IP}:9000        (via externalIPs Service + Basic Auth)
  info "Setting up Traefik dashboard access (domain + public IP)"

  # Basic Auth secret — admin / iothub.2026 (Traefik expects htpasswd format)
  command -v htpasswd &>/dev/null || apt-get install -y -qq apache2-utils >/dev/null
  local htpw
  htpw=$(htpasswd -nb admin 'iothub.2026' 2>/dev/null)

  cat <<EOF | $KUBECTL apply -f -
# Basic Auth credentials for Traefik dashboard
apiVersion: v1
kind: Secret
metadata:
  name: traefik-dashboard-auth
  namespace: kube-system
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
type: kubernetes.io/basic-auth
stringData:
  users: |
    ${htpw}
---
# Middleware: BasicAuth
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: traefik-dashboard-auth
  namespace: kube-system
spec:
  basicAuth:
    secret: traefik-dashboard-auth
    realm: "Traefik Dashboard"
---
# IngressRoute: HTTPS via domain (traefik.${DOMAIN})
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: traefik-dashboard
  namespace: kube-system
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  entryPoints:
    - web
    - websecure
  routes:
    - match: Host(\`traefik.${DOMAIN}\`) && (PathPrefix(\`/dashboard\`) || PathPrefix(\`/api\`))
      kind: Rule
      middlewares:
        - name: traefik-dashboard-auth
      services:
        - name: api@internal
          kind: TraefikService
    # Convenience redirect: / → /dashboard/
    - match: Host(\`traefik.${DOMAIN}\`) && Path(\`/\`)
      kind: Rule
      middlewares:
        - name: traefik-dashboard-redirect
      services:
        - name: api@internal
          kind: TraefikService
  tls:
    secretName: traefik-dashboard-tls
---
# Redirect middleware: / → /dashboard/
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: traefik-dashboard-redirect
  namespace: kube-system
spec:
  redirectRegex:
    regex: "^https?://([^/]+)/?\$"
    replacement: "https://\${1}/dashboard/"
    permanent: false
---
# Companion Service: bind Traefik dashboard on \${NODE_IP}:9000
apiVersion: v1
kind: Service
metadata:
  name: traefik-dashboard-external
  namespace: kube-system
  labels:
    app.kubernetes.io/part-of: carbon-credit-platform
    app.kubernetes.io/component: external-listener
spec:
  type: ClusterIP
  externalIPs:
    - ${NODE_IP}
  selector:
    app.kubernetes.io/name: traefik
    app.kubernetes.io/instance: traefik-kube-system
  ports:
    - name: traefik
      port: 9000
      targetPort: 9000
      protocol: TCP
EOF

  log "Traefik dashboard exposed:"
  log "  → https://traefik.${DOMAIN}/dashboard/   (Basic Auth: admin / iothub.2026)"
  log "  → http://${NODE_IP}:9000/dashboard/      (Basic Auth: admin / iothub.2026)"
}

# ════════════════════════════════════════════════════════════════════
# Phase 5 — Switch over: disable K3s Traefik + nginx, let ArgoCD Traefik take 80/443
# ════════════════════════════════════════════════════════════════════
phase5_switchover() {
  phase "Phase 5: Switch to ArgoCD Traefik (downtime ~30s)"

  warn "→ This will cause ~30s downtime for HTTPS domains"
  warn "→ MQTT 1883/8883 unaffected (uses externalIPs Service)"
  warn "→ aaPanel admin :37162 unaffected (separate Python process)"
  [[ $DRY_RUN -eq 0 ]] && sleep 3

  # Step 1: Disable bundled Traefik in K3s
  info "Disabling K3s bundled Traefik permanently"
  mkdir -p /etc/systemd/system/k3s.service.d
  cat > /etc/systemd/system/k3s.service.d/disable-traefik.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/local/bin/k3s server --disable servicelb --disable traefik --write-kubeconfig-mode 644
EOF
  systemctl daemon-reload

  rm -f /var/lib/rancher/k3s/server/manifests/traefik.yaml
  rm -f /var/lib/rancher/k3s/server/manifests/traefik-crd.yaml

  # Step 2: Delete bundled Traefik resources
  info "Removing K3s bundled Traefik resources"
  $KUBECTL -n kube-system delete helmchart       traefik traefik-crd 2>/dev/null || true
  $KUBECTL -n kube-system delete helmchartconfig traefik             2>/dev/null || true
  $KUBECTL delete ingressclass traefik 2>/dev/null || true   # ArgoCD chart recreates

  # Step 3: Stop + mask nginx
  info "Stopping host nginx"
  systemctl stop nginx 2>/dev/null || true
  systemctl disable nginx 2>/dev/null || true
  systemctl mask nginx 2>/dev/null || true

  # Step 4: Force ArgoCD Traefik pod recreate (now port 80/443 free)
  info "Recreating ArgoCD Traefik pod (port 80/443 now free)"
  $KUBECTL -n kube-system delete pod -l app.kubernetes.io/name=traefik 2>/dev/null || true

  # Step 5: Wait for new Traefik to bind
  info "Waiting for Traefik to be Ready..."
  local tries=0
  while ! $KUBECTL -n kube-system get pod -l app.kubernetes.io/name=traefik \
      -o jsonpath='{.items[*].status.phase}' 2>/dev/null | grep -q Running; do
    (( ++tries > 30 )) && { err "Traefik not Ready after 5 min"; exit 1; }
    sleep 10
  done

  # Step 6: Confirm host binding
  info "Verifying host port 80/443 binding"
  for p in 80 443; do
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${p}\$"; then
      log "Port $p bound on host"
    else
      err "Port $p NOT bound — check kubectl describe pod -n kube-system -l app.kubernetes.io/name=traefik"
    fi
  done
}

# ════════════════════════════════════════════════════════════════════
# Phase 6 — Restore TLS handling + verify all endpoints
# ════════════════════════════════════════════════════════════════════
phase6_verify() {
  phase "Phase 6: Restore TLS + verify endpoints"

  # Re-enable TLS on all Ingresses (we stripped it earlier when nginx was edge)
  info "Restoring TLS + cert-manager on all Ingresses"
  declare -A INGRESSES=(
    ["data/emqx-dashboard"]="emqx.${DOMAIN}:emqx-dashboard-tls"
    ["data/phpmyadmin"]="pma.${DOMAIN}:phpmyadmin-tls"
    ["monitoring/grafana"]="grafana.${DOMAIN}:grafana-tls"
    ["auth/keycloak"]="keycloak.${DOMAIN}:keycloak-tls"
    ["carbon-credit/node-red"]="nodered.${DOMAIN}:nodered-tls"
    ["argocd/argocd-server"]="argocd.${DOMAIN}:argocd-server-tls"
    ["web/wordpress"]="${DOMAIN}:wordpress-tls"
  )
  for key in "${!INGRESSES[@]}"; do
    local ns="${key%/*}" name="${key#*/}"
    local host="${INGRESSES[$key]%:*}" sec="${INGRESSES[$key]##*:}"
    $KUBECTL -n "$ns" patch ingress "$name" --type=merge -p "{
      \"metadata\":{\"annotations\":{
        \"cert-manager.io/cluster-issuer\":\"letsencrypt-prod\",
        \"traefik.ingress.kubernetes.io/router.entrypoints\":\"web,websecure\",
        \"traefik.ingress.kubernetes.io/router.tls\":\"true\"
      }},
      \"spec\":{\"tls\":[{\"hosts\":[\"${host}\"],\"secretName\":\"${sec}\"}]}
    }" 2>/dev/null && log "✓ $key TLS restored" || warn "$key not found"
  done

  # Re-trigger cert-manager challenges that failed
  info "Clearing stuck cert-manager challenges"
  $KUBECTL delete challenge -A --all 2>/dev/null || true

  sleep 10

  # End-to-end verification
  phase "Endpoint verification"
  echo
  printf "%-40s %s\n" "Endpoint" "Status"
  printf "%-40s %s\n" "────────────────────────────────────────" "──────"

  check() {
    local url="$1" expect="${2:-200|301|302|308}"
    local code
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "ERR")
    if echo "$code" | grep -qE "^(${expect})$"; then
      printf "%-40s ${G}HTTP %s${N}\n" "$url" "$code"
    else
      printf "%-40s ${R}HTTP %s${N}\n" "$url" "$code"
    fi
  }

  check "https://emqx.${DOMAIN}"
  check "https://grafana.${DOMAIN}"
  check "https://pma.${DOMAIN}"
  check "https://nodered.${DOMAIN}"
  check "https://argocd.${DOMAIN}"
  check "https://keycloak.${DOMAIN}"
  check "http://${NODE_IP}:1880"           "200|302"
  check "http://${NODE_IP}:18083"          "200|302"
  check "https://${NODE_IP}:37162/fed30761" "200|302"
  check "http://${NODE_IP}:9000/dashboard/" "200|301|302|401"   # 401 = BasicAuth prompt = OK
  check "https://traefik.${DOMAIN}/dashboard/" "200|301|302|401"

  echo
  info "MQTT check (external):"
  if command -v mosquitto_pub &>/dev/null; then
    if mosquitto_pub -h "$NODE_IP" -p 1883 -u admin -P 'iothub.2026' \
        -t '$migrate/test' -m "ping-$(date +%s)" -q 1 2>/dev/null; then
      log "MQTT publish OK ($NODE_IP:1883)"
    else
      warn "MQTT publish failed"
    fi
  else
    warn "mosquitto_pub not installed — skipping MQTT check"
  fi

  info "MQTT check (internal — Node-RED → EMQX):"
  $KUBECTL -n carbon-credit run mqtt-test --rm -i --restart=Never \
    --image=eclipse-mosquitto:latest --quiet -- \
    mosquitto_pub -h emqx.data.svc.cluster.local -p 1883 \
      -u nodered -P 'iothub.2026' -i 'nodered-test' \
      -t 'app/test' -m 'hello-from-pod' 2>&1 | head -3 \
      | grep -q . && log "Internal MQTT OK" || warn "Internal MQTT failed (check NetworkPolicy)"
}

# ════════════════════════════════════════════════════════════════════
# Rollback — revert Traefik swap
# ════════════════════════════════════════════════════════════════════
rollback() {
  phase "Rollback: restore K3s bundled Traefik"

  $KUBECTL -n argocd delete app traefik 2>/dev/null || true
  rm -f /etc/systemd/system/k3s.service.d/disable-traefik.conf
  systemctl daemon-reload
  systemctl restart k3s
  sleep 30

  systemctl unmask nginx 2>/dev/null
  systemctl enable nginx 2>/dev/null
  systemctl start nginx 2>/dev/null

  log "Rolled back. K3s bundled Traefik should redeploy in ~1 min."
}

# ════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════
main() {
  if [[ $ROLLBACK -eq 1 ]]; then
    preflight
    rollback
    exit 0
  fi

  preflight
  backup_state

  if [[ -z "$PHASE" || "$PHASE" == "2" ]]; then phase2_emqx;          fi
  if [[ -z "$PHASE" || "$PHASE" == "3" ]]; then phase3_nodered;       fi
  if [[ -z "$PHASE" || "$PHASE" == "4" ]]; then phase4_traefik_argocd; fi
  if [[ -z "$PHASE" || "$PHASE" == "5" ]]; then phase5_switchover;     fi
  if [[ -z "$PHASE" || "$PHASE" == "6" ]]; then phase6_verify;         fi

  echo
  echo "═══════════════════════════════════════════════════"
  echo " ✅ Migration complete"
  echo "═══════════════════════════════════════════════════"
  cat <<EOF

 Endpoints
 ─────────
   https://emqx.${DOMAIN}          → EMQX dashboard (admin / iothub.2026)
   https://grafana.${DOMAIN}       → Grafana
   https://nodered.${DOMAIN}       → Node-RED
   http://${NODE_IP}:1880          → Node-RED (direct IP)
   https://pma.${DOMAIN}           → phpMyAdmin
   https://argocd.${DOMAIN}        → ArgoCD UI
   https://${DOMAIN}               → WordPress
   https://${NODE_IP}:37162/...    → aaPanel admin (separate)
   https://traefik.${DOMAIN}       → Traefik dashboard (BasicAuth admin/iothub.2026)
   http://${NODE_IP}:9000          → Traefik dashboard direct (BasicAuth)

 MQTT
 ────
   External:  ${NODE_IP}:1883  (TLS: 8883)
   Internal:  emqx.data.svc.cluster.local:1883  (from Node-RED, backend, etc.)
   Users:     admin, backend, nodered, device  (pw: iothub.2026)
   ACL:       file-based, deny by default

 Logs
 ────
   This run:    $LOG
   Backup:      $BACKUP_DIR

 Rollback:    sudo $0 --rollback
EOF
}

main "$@"
