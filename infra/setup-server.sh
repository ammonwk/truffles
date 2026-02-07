#!/bin/bash
# One-time server setup for truffles primary EC2.
# Run this once after launching the instance.
set -euo pipefail

echo "=== Truffles Server Setup ==="

# System updates
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# Install Node 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install nginx, certbot, and bubblewrap (needed for Claude Agent SDK sandbox)
sudo apt-get install -y nginx certbot python3-certbot-nginx bubblewrap

# Install MongoDB 8
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update -y
sudo apt-get install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod

# Install pm2 globally
sudo npm install -g pm2

# Install gh CLI
(type -p wget >/dev/null || sudo apt-get install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt-get update \
  && sudo apt-get install gh -y

# Create app directory
sudo mkdir -p /opt/truffles
sudo chown ubuntu:ubuntu /opt/truffles

# Create worktree directory for agent runner
sudo mkdir -p /home/ubuntu/worktrees
sudo chown ubuntu:ubuntu /home/ubuntu/worktrees

# Nginx config (will be updated by deploy script after certbot)
sudo tee /etc/nginx/sites-available/truffles > /dev/null <<'NGINX'
server {
    listen 80;
    server_name truffles.ammonkunzler.com;

    # Frontend (static files)
    root /opt/truffles/apps/web/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket proxy
    location /ws/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/truffles /etc/nginx/sites-enabled/truffles
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== Setup complete ==="
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo "MongoDB: $(mongosh --eval 'db.version()' --quiet 2>/dev/null || echo 'starting...')"
echo "nginx: $(nginx -v 2>&1)"
echo "pm2: $(pm2 --version)"
echo ""
echo "Next: run deploy.sh to deploy the app, then run certbot for SSL:"
echo "  sudo certbot --nginx -d truffles.ammonkunzler.com --non-interactive --agree-tos -m admin@ammonkunzler.com"
