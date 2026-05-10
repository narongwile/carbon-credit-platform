# Carbon Credit Platform Infra

This folder already contains the right production primitives for a 24/7 system:

- `Ubuntu 24` host
- `K3s` for the single-node control plane
- `Argo CD` for GitOps delivery
- `Traefik` for edge ingress
- `cert-manager` for TLS
- `Prometheus/Grafana` for monitoring
- `Vault` for secret lifecycle

The attached Thermexpertise diagram should not be implemented literally because it exposes root and admin credentials, public raw admin ports, and stateful services without production guardrails.

Use [docs/thermexpertise-single-node-architecture.md](/Users/wine/Downloads/carbon-credit-platform/infra/docs/thermexpertise-single-node-architecture.md) as the target design for the Ubuntu 24 single-server deployment.

## Design Rules

- Keep `80/443` public and route apps through Traefik.
- Keep `3306`, `1880`, Grafana admin, phpMyAdmin, and the Kubernetes API private or IP-restricted.
- Prefer `EMQX` or `MQTTS` for public device traffic; do not expose an unauthenticated plain `1883` broker to the Internet.
- Store secrets outside Git using Vault, SOPS, or one-time `kubectl create secret` flows.
- Persist Node-RED, MySQL, broker state, Prometheus, and Grafana data on PVCs.
- Pin image versions or digests before production rollout.

## Bootstrap Order

1. Run [k3s/install.sh](/Users/wine/Downloads/carbon-credit-platform/infra/k3s/install.sh).
2. Apply [k8s/argocd/application.yaml](/Users/wine/Downloads/carbon-credit-platform/infra/k8s/argocd/application.yaml).
3. Create production secrets outside Git.
   MySQL example shape: [k8s/apps/base/mysql-auth.example.yaml](/Users/wine/Downloads/carbon-credit-platform/infra/k8s/apps/base/mysql-auth.example.yaml)
4. Adapt and apply [traefik/thermexpertise-single-node.yaml](/Users/wine/Downloads/carbon-credit-platform/infra/traefik/thermexpertise-single-node.yaml).
