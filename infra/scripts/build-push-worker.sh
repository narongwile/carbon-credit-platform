#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build + push ingest-worker locally — the same GitLab-runner-minutes stand-in
# as build-push-frontend.sh, for the same reason. See that script's header for
# the full rationale; this one is deliberately identical in shape.
#
# Mirrors build_ingest_worker in .gitlab-ci.yml:
#   - tag = git rev-parse --short=8 HEAD (never typed by hand)
#   - manifest pin = infra/k8s/custom-apps/base/ingest-worker.yaml, same sed
#     pattern deploy_images uses
#
# Unlike frontend-next this is a plain Go binary — no build-args to forget.
#
# Usage:
#   infra/scripts/build-push-worker.sh
#   infra/scripts/build-push-worker.sh --tag mytag   # override (rare)
#
# Requires: docker logged in to registry.gitlab.com already, OR
#   GITLAB_REGISTRY_USER + GITLAB_REGISTRY_TOKEN set (write_registry scope).
# ---------------------------------------------------------------------------
set -euo pipefail

# Docker CLI 29.3.1 defaults to API v1.54 which fails with 500 on /v1.54/auth in Docker Desktop.
# Pinning to v1.45 ensures stable auth and build across all environments.
export DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.45}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
MANIFEST="$REPO_ROOT/infra/k8s/custom-apps/base/ingest-worker.yaml"
IMAGE="registry.gitlab.com/narongwile/carbon-credit-platform/ingest-worker"

info() { echo "[build-push-worker] $*"; }
die()  { echo "[build-push-worker] FATAL: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -f "$WORKER_DIR/Dockerfile" ] || die "expected $WORKER_DIR/Dockerfile — run this from a checkout of the repo"
[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

cd "$REPO_ROOT"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository: $REPO_ROOT"

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    *) die "unknown argument: $1 (only --tag <value> is accepted)" ;;
  esac
done

if [ -z "$TAG" ]; then
  TAG="$(git rev-parse --short=8 HEAD)"
else
  info "using explicit --tag ${TAG} — prefer the default (git rev-parse) unless you have a specific reason; it is what makes an image tag traceable back to a commit."
fi

if ! git diff --quiet -- worker 2>/dev/null || ! git diff --cached --quiet -- worker 2>/dev/null; then
  info "WARNING: worker/ has uncommitted changes. The image built now will not match what 'git show ${TAG}:worker' shows later. Commit first unless intentional."
fi

if [ -n "${GITLAB_REGISTRY_USER:-}" ] && [ -n "${GITLAB_REGISTRY_TOKEN:-}" ]; then
  info "logging in to registry.gitlab.com as ${GITLAB_REGISTRY_USER}"
  echo "$GITLAB_REGISTRY_TOKEN" | docker login registry.gitlab.com -u "$GITLAB_REGISTRY_USER" --password-stdin
else
  info "GITLAB_REGISTRY_USER/GITLAB_REGISTRY_TOKEN not set — assuming 'docker login registry.gitlab.com' was already run"
fi

# `go mod tidy` in the builder stage needs real network access. On a sandboxed
# host that routes egress through a local HTTP(S) proxy, --network=host is
# what makes that proxy (which listens on the HOST's loopback) reachable at
# all from inside the build container's RUN steps — a bare 127.0.0.1 inside an
# isolated build container is the CONTAINER's own loopback, nothing is
# listening there, and every module fetch fails (either connection-refused or,
# worse, a confusing x509 error if some no_proxy-excluded domain gets routed
# through an unrelated transparent interception instead). Only passed when
# the environment actually sets a proxy — forcing it unconditionally would
# point a plain, unproxied machine's build at a proxy that does not exist there.
BUILD_NET_ARGS=()
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}" ]; then
  PROXY_URL="${HTTPS_PROXY:-$https_proxy}"
  info "proxy detected (${PROXY_URL}) — building with --network=host so the builder stage can reach it"
  BUILD_NET_ARGS=(--network=host --build-arg "http_proxy=${PROXY_URL}" --build-arg "https_proxy=${PROXY_URL}" --build-arg "no_proxy=" --build-arg "NO_PROXY=")
fi

info "building ${IMAGE}:${TAG}"
docker build ${BUILD_NET_ARGS[@]+"${BUILD_NET_ARGS[@]}"} -t "${IMAGE}:latest" -t "${IMAGE}:${TAG}" "$WORKER_DIR"

info "pushing ${IMAGE}:latest"
docker push "${IMAGE}:latest"
info "pushing ${IMAGE}:${TAG}"
docker push "${IMAGE}:${TAG}"

info "pinning manifest: $MANIFEST -> ${TAG}"
sed -i.bak -E "s|(image: registry\.gitlab\.com/.*/ingest-worker:).*|\1${TAG}|" "$MANIFEST"
rm -f "${MANIFEST}.bak"

info "done. ${IMAGE}:${TAG} is pushed and pinned in the working tree (not committed)."
info "next: git diff -- infra/k8s/custom-apps/base/ingest-worker.yaml   # review"
info "      git add infra/k8s/custom-apps/base/ingest-worker.yaml"
info "      git commit -m 'ci(deploy): ingest-worker -> ${TAG}'"
info "      git push <remote> HEAD:<branch>   # ArgoCD rolls the pod on the next sync"
