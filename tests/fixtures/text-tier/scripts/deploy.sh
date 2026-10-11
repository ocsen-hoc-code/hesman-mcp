#!/usr/bin/env bash
set -euo pipefail

# Upload the release archive to the staging bucket.
upload_release() {
  aws s3 cp "build/release.tar.gz" "s3://staging-releases/$1.tar.gz"
}

# Restart the web service after a deployment.
restart_service() {
  systemctl restart webapp.service
}

upload_release "$1"
restart_service
