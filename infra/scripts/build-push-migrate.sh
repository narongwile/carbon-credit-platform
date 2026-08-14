#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build + push migrate-service locally — the third of the trio alongside
# build-push-frontend.sh and build-push-worker.sh. See those scripts' headers
# for the shared rationale; this one is deliberately identical in shape.
#
# This script exists because its ABSENCE caused a real outage-shaped bug:
# frontend and worker each had a local build script and were rebuilt
# routinely, while migrate-service had none and was only ever built by CI.
# Its manifest sat pinned at an old commit whose image predated
# migrate-v46.sql, so the file physically was not inside the running
# container — "Run migrations" completed successfully and applied nothing,
# and every database (control included) sat permanently at 46/47 with no
# error anywhere to explain why.
#
# Mirrors build_migrate_service in .gitlab-ci.yml:
#   - build context is backend/ (dist/migrate.js and backend/sql/*.sql travel
#     together, so the schema a run applies always matches the code shipped
#     beside it)
#   - tag = git rev-parse --short=8 HEAD (never typed by hand)
#
# Pins BOTH manifests, exactly like deploy_images does. migrate-service
# appears twice — the long-running provisioning Deployment and the
# deploy-time migration Job — and they run the same image on purpose, so the
# Job and the service can never disagree about the schema. Missing the Job
# means it migrates with the PREVIOUS release's sql/, which is the exact
# drift the Job exists to prevent.
#
# Usage:
#   infra/scripts/build-push-migrate.sh
#   infra/scripts/build-push-migrate.sh --tag mytag   # override (rare)
#
# Requires: docker logged in to registry.gitlab.com already, OR
#   GITLAB_REGISTRY_USER + GITLAB_REGISTRY_TOKEN set (write_registry scope).
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$REPO_ROOT/backend"
MANIFEST_SVC="$REPO_ROOT/infra/k8s/custom-apps/base/migrate-service.yaml"
MANIFEST_JOB="$REPO_ROOT/infra/k8s/custom-apps/overlays/uat/mysql-migrate-job.yaml"
IMAGE="registry.gitlab.com/narongwile/carbon-credit-platform/migrate-service"

info() { echo "[build-push-migrate] $*"; }
die()  { echo "[build-push-migrate] FATAL: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -f "$BUILD_DIR/Dockerfile" ] || die "expected $BUILD_DIR/Dockerfile — run this from a checkout of the repo"
[ -f "$MANIFEST_SVC" ] || die "manifest not found: $MANIFEST_SVC"
[ -f "$MANIFEST_JOB" ] || die "manifest not found: $MANIFEST_JOB"

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

if ! git diff --quiet -- backend 2>/dev/null || ! git diff --cached --quiet -- backend 2>/dev/null; then
  info "WARNING: backend/ has uncommitted changes. The image built now will not match what 'git show ${TAG}:backend' shows later. Commit first unless intentional."
fi

# What this image will actually ship — the whole point of the rebuild, and the
# one number worth reading back before pinning it.
SQL_COUNT="$(ls -1 "$BUILD_DIR/sql"/migrate-v*.sql 2>/dev/null | wc -l | tr -d ' ')"
NEWEST_SQL="$(ls -1 "$BUILD_DIR/sql"/migrate-v*.sql 2>/dev/null | sort -V | tail -1 | xargs -r basename)"
info "shipping ${SQL_COUNT} migrate-v*.sql file(s), newest ${NEWEST_SQL:-<none>}"

if [ -n "${GITLAB_REGISTRY_USER:-}" ] && [ -n "${GITLAB_REGISTRY_TOKEN:-}" ]; then
  info "logging in to registry.gitlab.com as ${GITLAB_REGISTRY_USER}"
  echo "$GITLAB_REGISTRY_TOKEN" | docker login registry.gitlab.com -u "$GITLAB_REGISTRY_USER" --password-stdin
else
  info "GITLAB_REGISTRY_USER/GITLAB_REGISTRY_TOKEN not set — assuming 'docker login registry.gitlab.com' was already run"
fi

# Same proxy handling as build-push-worker.sh — see that script's comment for
# why --network=host is what makes a sandboxed host's proxy reachable from
# inside the builder's RUN steps (npm install here).
BUILD_NET_ARGS=()
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}" ]; then
  PROXY_URL="${HTTPS_PROXY:-$https_proxy}"
  info "proxy detected (${PROXY_URL}) — building with --network=host so the builder stage can reach it"
  BUILD_NET_ARGS=(--network=host --build-arg "http_proxy=${PROXY_URL}" --build-arg "https_proxy=${PROXY_URL}" --build-arg "no_proxy=" --build-arg "NO_PROXY=")
fi

info "building ${IMAGE}:${TAG}"
docker build "${BUILD_NET_ARGS[@]}" -t "${IMAGE}:latest" -t "${IMAGE}:${TAG}" "$BUILD_DIR"

info "pushing ${IMAGE}:latest"
docker push "${IMAGE}:latest"
info "pushing ${IMAGE}:${TAG}"
docker push "${IMAGE}:${TAG}"

info "pinning both manifests -> ${TAG}"
for m in "$MANIFEST_SVC" "$MANIFEST_JOB"; do
  sed -i.bak -E "s|(image: registry\.gitlab\.com/.*/migrate-service:).*|\1${TAG}|" "$m"
  rm -f "${m}.bak"
  info "  pinned $(basename "$m")"
done

info "done. ${IMAGE}:${TAG} is pushed and pinned in the working tree (not committed)."
info "next: git diff -- infra/k8s/custom-apps/base/migrate-service.yaml infra/k8s/custom-apps/overlays/uat/mysql-migrate-job.yaml   # review"
info "      git add -- infra/k8s/custom-apps/base/migrate-service.yaml infra/k8s/custom-apps/overlays/uat/mysql-migrate-job.yaml"
info "      git commit -m 'ci(deploy): migrate-service -> ${TAG}'"
info "      git push <remote> HEAD:<branch>   # ArgoCD rolls the pod on the next sync"
