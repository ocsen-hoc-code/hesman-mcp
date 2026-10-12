#!/usr/bin/env bash
# Bash fixture of the language conformance suite.
set -euo pipefail

# Largest number of upload attempts.
readonly MAX_ATTEMPTS=3
RELEASE_DIR="${RELEASE_DIR:-dist}"

# Prints a message to stderr.
log() {
  echo "[deploy] $*" >&2
}

# Fails unless a command is installed.
function require_command {
  command -v "$1" >/dev/null || { log "missing: $1"; exit 1; }
}

# Uploads one file, retrying on failure.
_upload_file() {
  local file="$1" attempt
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    if curl -fsS -T "$file" "$UPLOAD_URL"; then
      return 0
    fi
    log "attempt $attempt failed"
  done
  return 1
}

main() {
  require_command curl
  for file in "$RELEASE_DIR"/*; do
    _upload_file "$file"
  done
}

main "$@"
