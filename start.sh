#!/usr/bin/env bash
# Build the frontend, embed it into the Go binary, and launch local-review
# against the given repository.
#
# Usage: ./start.sh <repo-path> [extra local-review flags...]
#   ./start.sh ~/code/myproject
#   ./start.sh ~/code/myproject -port 8080 -no-open
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <repo-path> [extra local-review flags...]" >&2
  exit 1
fi

REPO="$1"
shift

if [[ ! -d "$REPO/.git" ]]; then
  echo "error: '$REPO' is not a git repository" >&2
  exit 1
fi

# Run from the script's own directory so relative paths resolve.
cd "$(dirname "$0")"

echo "==> Building frontend"
npm --prefix web install
npm --prefix web run build

echo "==> Building binary"
go build -o local-review .

echo "==> Starting local-review on $REPO"
exec ./local-review -repo "$REPO" "$@"
