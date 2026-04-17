#!/usr/bin/env bash
# ============================================================
# HashiCorp Vault — Init, Unseal, Configure
# Run once after Vault Helm deployment
# ============================================================
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://vault.infra.svc.cluster.local:8200}"
export VAULT_ADDR

echo "=== Step 1: Initialize Vault ==="
INIT_OUTPUT=$(vault operator init \
  -key-shares=5 \
  -key-threshold=3 \
  -format=json)

echo "$INIT_OUTPUT" > /tmp/vault-init-keys.json
echo "⚠️  SAVE vault-init-keys.json SECURELY — these keys cannot be recovered!"

UNSEAL_KEY_1=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
UNSEAL_KEY_2=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[1]')
UNSEAL_KEY_3=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[2]')
ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')

echo "=== Step 2: Unseal Vault ==="
vault operator unseal "$UNSEAL_KEY_1"
vault operator unseal "$UNSEAL_KEY_2"
vault operator unseal "$UNSEAL_KEY_3"

export VAULT_TOKEN="$ROOT_TOKEN"

echo "=== Step 3: Enable KV Secrets Engine ==="
vault secrets enable -path=secret kv-v2

echo "=== Step 4: Store Initial Secrets ==="

# Database secrets
vault kv put secret/database \
  postgres_host=postgresql.infra.svc.cluster.local \
  postgres_port=5432 \
  postgres_db=carbon_credit \
  postgres_user="${PG_USER:-carbon_admin}" \
  postgres_password="${PG_PASSWORD}" \
  timescaledb_enabled=true

# MinIO secrets
vault kv put secret/minio \
  endpoint=http://minio.infra.svc.cluster.local:9000 \
  access_key="${MINIO_ACCESS_KEY}" \
  secret_key="${MINIO_SECRET_KEY}" \
  encryption_key="${MINIO_ENCRYPTION_KEY}"

# Kafka secrets
vault kv put secret/kafka \
  bootstrap_servers=kafka.infra.svc.cluster.local:9092

# EMQX secrets
vault kv put secret/emqx \
  host=emqx.infra.svc.cluster.local \
  mqtt_port=1883 \
  mqtts_port=8883 \
  admin_password="${EMQX_ADMIN_PASSWORD}"

# Keycloak secrets
vault kv put secret/keycloak \
  url=http://keycloak.auth.svc.cluster.local:8080 \
  admin_user=admin \
  admin_password="${KEYCLOAK_ADMIN_PASSWORD}" \
  api_client_secret="${API_CLIENT_SECRET}"

# Ollama
vault kv put secret/ollama \
  url=http://ollama.ai.svc.cluster.local:11434

# Milvus
vault kv put secret/milvus \
  host=milvus.data.svc.cluster.local \
  port=19530

# Grafana
vault kv put secret/grafana \
  admin_password="${GRAFANA_ADMIN_PASSWORD}" \
  pg_reader_password="${GRAFANA_PG_PASSWORD}"

echo "=== Step 5: Enable Kubernetes Auth ==="
vault auth enable kubernetes

vault write auth/kubernetes/config \
  kubernetes_host="https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}" \
  token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token \
  kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt

echo "=== Step 6: Create Policies ==="

# Backend API policy
vault policy write backend-api - <<EOF
path "secret/data/database" {
  capabilities = ["read"]
}
path "secret/data/keycloak" {
  capabilities = ["read"]
}
path "secret/data/kafka" {
  capabilities = ["read"]
}
path "secret/data/minio" {
  capabilities = ["read"]
}
path "secret/data/ollama" {
  capabilities = ["read"]
}
path "secret/data/milvus" {
  capabilities = ["read"]
}
EOF

# Data pipeline policy
vault policy write data-pipeline - <<EOF
path "secret/data/database" {
  capabilities = ["read"]
}
path "secret/data/kafka" {
  capabilities = ["read"]
}
path "secret/data/minio" {
  capabilities = ["read"]
}
EOF

# AI agents policy
vault policy write ai-agents - <<EOF
path "secret/data/ollama" {
  capabilities = ["read"]
}
path "secret/data/milvus" {
  capabilities = ["read"]
}
path "secret/data/database" {
  capabilities = ["read"]
}
path "secret/data/minio" {
  capabilities = ["read"]
}
EOF

echo "=== Step 7: Bind K8s Service Accounts ==="

# Backend API
vault write auth/kubernetes/role/backend-api \
  bound_service_account_names=backend-api \
  bound_service_account_namespaces=app \
  policies=backend-api \
  ttl=1h

# Data pipeline (Airflow workers + Spark)
vault write auth/kubernetes/role/data-pipeline \
  bound_service_account_names=airflow-worker,spark-operator \
  bound_service_account_namespaces=data \
  policies=data-pipeline \
  ttl=1h

# AI agents
vault write auth/kubernetes/role/ai-agents \
  bound_service_account_names=ai-agents \
  bound_service_account_namespaces=ai \
  policies=ai-agents \
  ttl=1h

echo "=== Vault Setup Complete ==="
echo "Root Token: $ROOT_TOKEN"
echo "⚠️  Revoke root token after setup: vault token revoke \$ROOT_TOKEN"
