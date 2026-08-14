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

info "building ${IMAGE}:${TAG}"
docker build -t "${IMAGE}:latest" -t "${IMAGE}:${TAG}" "$WORKER_DIR"

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
