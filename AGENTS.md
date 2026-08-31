# AGENTS.md — Platform Conventions & Verification Gates

## Build & Test Verification Gates

### 1. Frontend TypeScript Compilation Check (MANDATORY)
```bash
cd frontend-next && npx tsc --noEmit
```

### 2. Frontend Next.js Production Build
```bash
cd frontend-next && npm run build
```

### 3. Node-RED Backend Flow Generation & Validation
```bash
node backend/node-red/generate-nodered-backend.mjs
```

### 4. Kubernetes Node-RED Flow ConfigMap Sync
```bash
bash infra/scripts/sync-nodered-flow.sh backend/node-red/flows.nodered-backend.json
```

### 5. Automated E2E Security & Privacy Gates
```bash
node e2e/proofs/test-personal-alarm-privacy.mjs
node e2e/proofs/test-alarms-time-range.mjs
```

### 6. Production Container Images Build & Push (GitLab Registry & ArgoCD Release)
```bash
# Frontend Next.js Web App
GITLAB_REGISTRY_USER=oauth2 GITLAB_REGISTRY_TOKEN='glpat-lxTRJgWKtpwWFD9wuMjEbmM6MQpvOjEKdTpuaDlqNw8.01.171jfngrv' bash infra/scripts/build-push-frontend.sh

# Go Telemetry Ingest Worker
GITLAB_REGISTRY_USER=oauth2 GITLAB_REGISTRY_TOKEN='glpat-lxTRJgWKtpwWFD9wuMjEbmM6MQpvOjEKdTpuaDlqNw8.01.171jfngrv' bash infra/scripts/build-push-worker.sh

# Node.js Database Migration Service & Job
GITLAB_REGISTRY_USER=oauth2 GITLAB_REGISTRY_TOKEN='glpat-lxTRJgWKtpwWFD9wuMjEbmM6MQpvOjEKdTpuaDlqNw8.01.171jfngrv' bash infra/scripts/build-push-migrate.sh

# Kubernetes SQL Schema & Migration ConfigMap Sync
bash infra/scripts/sync-sql-configmap.sh
```

## Architecture & Tenancy Norms
- **Multi-Tenant Isolation**: Never query shared tables without `org_id` / `user_id` scopes.
- **Personal Alarms**: Personal alarms must write to `personal_alarm_events` (NOT `alarm_events`).
- **Product Entitlements**: Product domain selectors are filtered by `licensedDomains(orgId)` / `org_entitlements`, but an EMPTY list means "not restricted", not "restricted to nothing". `GET /api/orgs/:orgId/entitlements` is a bare `SELECT platform FROM org_entitlements WHERE org_id=?` with no default, so an org that simply has no rows yet returns `[]`; filtering on that directly renders zero chips and an unusable picker. Absence of a licensing record is not a licensing decision. These selectors are UX, not access control — report generation runs client-side over data the user can already read — so fail open and gate access server-side instead.
- **Database Timezone**: Database operations use `Asia/Bangkok` (`+07:00`).

## Loop Conventions
- Always run TypeScript check (`npx tsc --noEmit`) before committing.
- Regenerate and sync Node-RED flow whenever `generate-nodered-backend.mjs` is modified.
- Human review required for breaking schema migrations or privilege changes.


