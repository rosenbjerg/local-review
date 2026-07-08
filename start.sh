#!/usr/bin/env bash
# Build the frontend, embed it into the Go binary, and launch local-review
# against a folder containing one or more git repositories.
#
# Usage: ./start.sh <root-path> [extra local-review flags...]
#   ./start.sh ~/code
#   ./start.sh ~/code -port 8080 -no-open
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <root-path> [extra local-review flags...]" >&2
  exit 1
fi

ROOT="$1"
shift

if [[ ! -d "$ROOT" ]]; then
  echo "error: '$ROOT' is not a directory" >&2
  exit 1
fi

# Run from the script's own directory so relative paths resolve.
cd "$(dirname "$0")"

echo "==> Building frontend"
npm --prefix web install
npm --prefix web run build

echo "==> Building binary"
go build -o local-review .

echo "==> Starting local-review on $ROOT"
exec ./local-review -root "$ROOT" "$@"
