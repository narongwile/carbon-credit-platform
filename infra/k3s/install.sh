#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo " Starting K3s + ArgoCD Installation"
echo "=========================================="

INSTALL_K3S_VERSION="${INSTALL_K3S_VERSION:-v1.31.6+k3s1}"
ARGOCD_VERSION="${ARGOCD_VERSION:-v2.10.4}"
ADMIN_API_CIDR="${ADMIN_API_CIDR:-0.0.0.0/0}"

echo "Using K3s version: ${INSTALL_K3S_VERSION}"
echo "Using Argo CD version: ${ARGOCD_VERSION}"

# 1. Ensure system updates and essentials
sudo apt update
sudo apt install -y curl ufw jq

# 2. Lock down the host first.
# Public traffic should enter through 80/443 only. Keep the K8s API scoped to
# trusted admin networks via ADMIN_API_CIDR whenever possible.
echo "Configuring Firewall..."
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from "${ADMIN_API_CIDR}" to any port 6443 proto tcp
sudo ufw --force enable

# 3. Install K3s with Traefik enabled because this repo relies on Traefik CRDs.
# ServiceLB stays disabled because the deployment is designed around Ingress and
# explicit TCP entrypoints instead of ad-hoc public NodePorts.
echo "Installing K3s (Lightweight Kubernetes)..."
export INSTALL_K3S_VERSION
export INSTALL_K3S_EXEC="--disable servicelb --write-kubeconfig-mode 644"
curl -sfL https://get.k3s.io | sh -

echo "Waiting for K3s nodes to become ready..."
sleep 15
sudo k3s kubectl wait --for=condition=Ready nodes --all --timeout=600s

# 4. Install ArgoCD
echo "Installing ArgoCD..."
sudo k3s kubectl create namespace argocd --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl apply -n argocd -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

echo "Waiting for ArgoCD Server to be ready..."
sudo k3s kubectl wait --for=condition=Available deployment/argocd-server -n argocd --timeout=300s

# 5. Extract ArgoCD Initial Password
echo "=========================================="
echo " ArgoCD is Ready!"
echo " Initial Admin Password:"
sudo k3s kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d && echo
echo "=========================================="
echo " Next Steps:"
echo " 1. Install the root app from k8s/argocd/application.yaml."
echo " 2. Create production secrets outside Git (Vault, SOPS, or kubectl secret)."
echo " 3. Apply the thermexpertise Traefik template after setting the real domain and email."
