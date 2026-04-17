#!/bin/bash
set -e

echo "=========================================="
echo " Starting K3s + ArgoCD Installation"
echo "=========================================="

# 1. Ensure system updates and essentials
sudo apt update && sudo apt install -y curl ufw

# 2. Allow Firewall Ports for Cosmos & K8s & IoT Service
echo "Configuring Firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 6443/tcp  # K8s API
sudo ufw allow 8080/tcp  # ArgoCD Port Forward
sudo ufw allow 1883/tcp  # Mosquitto MQTT
sudo ufw allow 8883/tcp  # Mosquitto MQTTS

# 3. Install K3s (No Traefik)
echo "Installing K3s (Lightweight Kubernetes)..."
export INSTALL_K3S_EXEC="--disable traefik --disable servicelb"
curl -sfL https://get.k3s.io | sh -

# Wait for K3s to be ready
echo "Waiting for K3s nodes to become ready..."
sleep 15
sudo k3s kubectl wait --for=condition=Ready nodes --all --timeout=600s

# 4. Install ArgoCD
echo "Installing ArgoCD..."
sudo k3s kubectl create namespace argocd
sudo k3s kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.10.4/manifests/install.yaml

echo "Waiting for ArgoCD Server to be ready..."
sudo k3s kubectl wait --for=condition=Available deployment/argocd-server -n argocd --timeout=300s

# 5. Extract ArgoCD Initial Password
echo "=========================================="
echo " ArgoCD is Ready!"
echo " Initial Admin Password:"
sudo k3s kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d && echo
echo "=========================================="
echo " Next Steps:"
echo " 1. Run 'docker-compose up -d' in the cosmos folder."
echo " 2. Connect Cosmos Reverse Proxy to K3s services."
