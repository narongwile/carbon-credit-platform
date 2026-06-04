# ThermExpertise — WordPress 7.0 on k3s via Argo CD

GitOps deployment of the migrated [ThermExpertise](https://thermexpertisethex.wixsite.com/thermexpertise)
website. WordPress 7.0 (custom image, theme baked in) + MariaDB, packaged as
**raw Kubernetes manifests under a Kustomize base**, continuously synced by
**Argo CD** onto a **k3s** cluster.

```
deploy/
├── argocd/
│   └── application.yaml        # Argo CD Application → syncs deploy/k8s
├── docker/
│   ├── Dockerfile             # WordPress 7.0 + ThermExpertise theme
│   └── activate-theme.sh      # auto-activate theme on first install
└── k8s/                        # Kustomize base (raw manifests)
    ├── kustomization.yaml
    ├── namespace.yaml
    ├── secret.yaml            # ⚠ demo only — seal/encrypt for production
    ├── mariadb.yaml           # StatefulSet + headless Service + PVC
    ├── wordpress.yaml         # Deployment + Service + uploads PVC
    ├── ingress.yaml           # Traefik (k3s default)
    └── config/uploads.ini     # PHP upload limits (ConfigMap source)
```

## 1. Build & push the custom image

> WordPress 7.0 may not yet be on Docker Hub. If `wordpress:7.0-php8.3-apache`
> does not resolve, build with the newest available tag — the theme is
> forward-compatible: `--build-arg WORDPRESS_VERSION=6.8`.

```bash
docker build -f deploy/docker/Dockerfile \
  --build-arg WORDPRESS_VERSION=7.0 \
  -t ghcr.io/narongwile/thermexpertise-wordpress:7.0 .
docker push ghcr.io/narongwile/thermexpertise-wordpress:7.0
```

The image name/tag is pinned in `deploy/k8s/kustomization.yaml` (`images:`).

## 2. Validate the manifests locally

```bash
kubectl kustomize deploy/k8s            # render
kubectl apply -k deploy/k8s --dry-run=server
```

## 3. Bootstrap on the cluster (GitOps)

```bash
# Argo CD watches Git and applies deploy/k8s for you:
kubectl apply -n argocd -f deploy/argocd/application.yaml
argocd app sync thermexpertise-wordpress
```

Or apply directly without Argo CD (evaluation only):

```bash
kubectl apply -k deploy/k8s
```

## 4. Before production

- [ ] Replace `deploy/k8s/secret.yaml` with a **Sealed Secret / SOPS / External Secret** (never commit plaintext).
- [ ] Set the real hostname in `ingress.yaml` **and** `WORDPRESS_SITE_URL` in `wordpress.yaml`.
- [ ] Enable TLS (cert-manager `ClusterIssuer` + the `tls:` block in `ingress.yaml`).
- [ ] Point `deploy/argocd/application.yaml` `repoURL`/`targetRevision` at your repo/branch.
- [ ] Fill the theme with real content — see [`MIGRATION.md`](./MIGRATION.md).

## Cluster assumptions (k3s defaults)

| Concern        | Value           |
| -------------- | --------------- |
| Storage class  | `local-path`    |
| Ingress        | `traefik`       |
| DB DNS         | `mariadb-0.mariadb:3306` (headless StatefulSet) |
