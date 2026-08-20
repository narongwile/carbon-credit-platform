#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build + push frontend-next locally, as a stand-in for build_frontend_next
# in .gitlab-ci.yml when CI runner minutes are unavailable.
#
# Mirrors that job exactly, on purpose — not "close enough":
#   - same build-args (NEXT_PUBLIC_API_URL/WS_URL="relative": the pod's nginx
#     reverse-proxies /api,/ws to Node-RED, so the bundle must ship with NO
#     fixed backend host baked in)
#   - same tag source ($(git rev-parse --short=8 HEAD), never typed by hand)
#   - same manifest pin (infra/k8s/custom-apps/base/frontend-next.yaml, same
#     sed pattern deploy_images uses)
#
# This exists because of two real incidents in this repo:
#   1. A build without --build-arg silently ships apiEnabled=false — the app
#      looks fine and every API call becomes a no-op. See
#      frontend-next/src/lib/api.ts: `const RAW_URL = process.env.NEXT_PUBLIC_API_URL
#      || ''` / `export const apiEnabled = !!RAW_URL`.
#   2. A hand-typed tag once ended up as f1fbf6f6 — not a commit, but the first
#      8 hex characters of an unrelated sha256 checksum, pasted into the wrong
#      field. `git rev-parse` cannot make that mistake.
#
# Usage:
#   infra/scripts/build-push-frontend.sh
#   infra/scripts/build-push-frontend.sh --tag mytag   # override (rare; see below)
#
# Requires: docker logged in to registry.gitlab.com already, OR
#   GITLAB_REGISTRY_USER + GITLAB_REGISTRY_TOKEN set (a Personal/Deploy token
#   with write_registry scope) — the script logs in with them if present.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend-next"
MANIFEST="$REPO_ROOT/infra/k8s/custom-apps/base/frontend-next.yaml"
IMAGE="registry.gitlab.com/narongwile/carbon-credit-platform/frontend-next"

info() { echo "[build-push-frontend] $*"; }
die()  { echo "[build-push-frontend] FATAL: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -f "$FRONTEND_DIR/Dockerfile" ] || die "expected $FRONTEND_DIR/Dockerfile — run this from a checkout of the repo"
[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

cd "$REPO_ROOT"
command -v git >/dev/null 2>&1 || die "git not found on PATH"
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
  info "using explicit --tag ${TAG} — the deployed image will NOT be traceable to a commit via 'git cat-file -t <tag>' the way the default is. Prefer the default unless you have a specific reason."
fi

# A dirty frontend-next/ means the image being built does not match what HEAD
# says it should be — the exact ambiguity that makes an image tag meaningful
# in the first place. Warn, don't block: a deliberate uncommitted test build
# is a legitimate use of this script.
if ! git diff --quiet -- frontend-next 2>/dev/null || ! git diff --cached --quiet -- frontend-next 2>/dev/null; then
  info "WARNING: frontend-next/ has uncommitted changes. The image built now will not match what 'git show ${TAG}:frontend-next' shows later. Commit first unless this is intentional."
fi

if [ -n "${GITLAB_REGISTRY_USER:-}" ] && [ -n "${GITLAB_REGISTRY_TOKEN:-}" ]; then
  info "logging in to registry.gitlab.com as ${GITLAB_REGISTRY_USER}"
  echo "$GITLAB_REGISTRY_TOKEN" | docker login registry.gitlab.com -u "$GITLAB_REGISTRY_USER" --password-stdin || true
else
  info "GITLAB_REGISTRY_USER/GITLAB_REGISTRY_TOKEN not set — assuming 'docker login registry.gitlab.com' was already run"
fi

info "building ${IMAGE}:${TAG} (same-origin build: NEXT_PUBLIC_API_URL/WS_URL=relative)"
docker build \
  --build-arg NEXT_PUBLIC_API_URL="relative" \
  --build-arg NEXT_PUBLIC_WS_URL="relative" \
  -t "${IMAGE}:latest" -t "${IMAGE}:${TAG}" \
  "$FRONTEND_DIR"

info "pushing ${IMAGE}:latest"
docker push "${IMAGE}:latest"
info "pushing ${IMAGE}:${TAG}"
docker push "${IMAGE}:${TAG}"

info "pinning manifest: $MANIFEST -> ${TAG}"
# Same sed pattern deploy_images uses in .gitlab-ci.yml, so a local build and a
# CI build leave the manifest in an identical shape either way.
sed -i.bak -E "s|(image: registry\.gitlab\.com/.*/frontend-next:).*|\1${TAG}|" "$MANIFEST"
rm -f "${MANIFEST}.bak"

info "done. ${IMAGE}:${TAG} is pushed and pinned in the working tree (not committed)."
info "next: git diff -- infra/k8s/custom-apps/base/frontend-next.yaml   # review"
info "      git add infra/k8s/custom-apps/base/frontend-next.yaml"
info "      git commit -m 'ci(deploy): frontend-next -> ${TAG}'"
info "      git push <remote> HEAD:<branch>   # ArgoCD rolls the pod on the next sync"
