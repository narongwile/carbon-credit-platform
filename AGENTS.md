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

## Architecture & Tenancy Norms
- **Multi-Tenant Isolation**: Never query shared tables without `org_id` / `user_id` scopes.
- **Personal Alarms**: Personal alarms must write to `personal_alarm_events` (NOT `alarm_events`).
- **Product Entitlements**: All product domain selectors must be filtered by `licensedDomains(orgId)` or `org_entitlements`.
- **Database Timezone**: Database operations use `Asia/Bangkok` (`+07:00`).

## Loop Conventions
- Always run TypeScript check (`npx tsc --noEmit`) before committing.
- Regenerate and sync Node-RED flow whenever `generate-nodered-backend.mjs` is modified.
- Human review required for breaking schema migrations or privilege changes.

