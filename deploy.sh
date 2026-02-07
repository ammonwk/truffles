#!/bin/bash
# Deploy truffles to EC2.
# Usage: ./deploy.sh [--setup]
#   --setup  Run one-time server setup first (only needed once)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="ubuntu@3.233.77.154"
KEY="${HOME}/.ssh/chatterbox-key.pem"
REMOTE_DIR="/opt/truffles"
SSH_OPTS="-o StrictHostKeyChecking=no -i ${KEY}"

echo "=== Truffles Deploy ==="

# One-time setup if requested
if [[ "${1:-}" == "--setup" ]]; then
  echo "[0/5] Running one-time server setup..."
  scp ${SSH_OPTS} "${SCRIPT_DIR}/infra/setup-server.sh" "${HOST}:/tmp/setup-server.sh"
  ssh ${SSH_OPTS} ${HOST} "chmod +x /tmp/setup-server.sh && /tmp/setup-server.sh"
  shift
fi

# Build locally
echo "[1/5] Building locally..."
cd "${SCRIPT_DIR}"
npx turbo build

# Sync files to server
echo "[2/5] Syncing to server..."
rsync -azP --delete \
  -e "ssh ${SSH_OPTS}" \
  --exclude='node_modules' \
  --exclude='.turbo' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.local' \
  "${SCRIPT_DIR}/" "${HOST}:${REMOTE_DIR}/"

# Install production dependencies on server
echo "[3/5] Installing dependencies on server..."
ssh ${SSH_OPTS} ${HOST} "cd ${REMOTE_DIR} && npm install --omit=dev 2>&1 | tail -5"

# Restart services
echo "[4/5] Restarting services..."
ssh ${SSH_OPTS} ${HOST} "cd ${REMOTE_DIR} && pm2 restart all 2>/dev/null || pm2 start infra/ecosystem.config.cjs && pm2 save"

# Reload nginx
echo "[5/5] Reloading nginx..."
ssh ${SSH_OPTS} ${HOST} "sudo nginx -t && sudo systemctl reload nginx"

echo ""
echo "=== Deploy complete ==="
echo "Site: https://truffles.ammonkunzler.com"
