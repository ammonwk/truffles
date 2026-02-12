#!/bin/bash
# Deploy the Truffles presentation site to truffles.ammonkunzler.com
# Usage: ./deploy.sh

KEY=~/Documents/keys/production.pem
HOST=34.238.113.27
REMOTE_DIR=/home/ubuntu/services/truffles
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

printf "\n----> Deploying Truffles presentation to $HOST\n"

printf "\n----> Syncing files\n"
rsync -avz --delete \
  -e "ssh -i $KEY" \
  "$LOCAL_DIR/index.html" \
  "$LOCAL_DIR/screenshots" \
  "ubuntu@$HOST:$REMOTE_DIR/"

printf "\n----> Done. Live at https://truffles.ammonkunzler.com\n"
