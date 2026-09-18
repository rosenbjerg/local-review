#!/usr/bin/env bash
# Build the frontend, embed it into the Go binary, and launch local-review
# against a git repository, or a folder containing one or more of them.
#
# Usage: ./start.sh [root-path] [extra local-review flags...]
#   ./start.sh                     # the current directory
#   ./start.sh ~/code/myproject
#   ./start.sh ~/code -port 8080 -no-open
set -euo pipefail

ROOT="."
# A leading flag means the root was left out, not that a flag is the root.
if [[ $# -gt 0 && "$1" != -* ]]; then
  ROOT="$1"
  shift
fi

if [[ ! -d "$ROOT" ]]; then
  echo "error: '$ROOT' is not a directory" >&2
  exit 1
fi
# Must resolve before the cd below, or a relative root lands under the script's directory.
ROOT="$(cd "$ROOT" && pwd)"

# Run from the script's own directory so relative paths resolve.
cd "$(dirname "$0")"

echo "==> Building frontend"
bun install --cwd web
bun run --cwd web build

echo "==> Building binary"
go build -o local-review .

echo "==> Starting local-review on $ROOT"
exec ./local-review -root "$ROOT" "$@"
