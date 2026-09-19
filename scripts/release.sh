#!/usr/bin/env bash
# Ship what main has: list the unreleased commits, then fast-forward the release
# branch to them. release.yml tags, builds and publishes from there.
#
# Usage: scripts/release.sh [ref]     # defaults to origin/main; must be a commit on it
set -euo pipefail

cd "$(dirname "$0")/.."
git fetch --quiet origin

target="${1:-origin/main}"
sha=$(git rev-parse --verify --quiet "$target^{commit}") || {
  echo "error: '$target' is not a commit" >&2
  exit 1
}
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "error: $target is not on origin/main; only main gets released" >&2
  exit 1
fi

if git rev-parse --verify --quiet origin/release >/dev/null; then
  if ! git merge-base --is-ancestor origin/release "$sha"; then
    echo "error: origin/release has a commit that $target lacks; fix that with a PR to main, never a force-push" >&2
    exit 1
  fi
  unreleased=$(git log --oneline "origin/release..$sha")
  if [[ -z "$unreleased" ]]; then
    echo "origin/release is already at $target; nothing to ship"
    exit 0
  fi
  echo "Unreleased:"
  echo "$unreleased"
else
  echo "origin/release does not exist yet; it will be created at $(git log -1 --oneline "$sha")"
fi

echo
read -r -p "Fast-forward release to $target? [y/N] " answer || answer=""
[[ "$answer" == [yY] ]] || { echo "aborted"; exit 1; }
git push origin "$sha:refs/heads/release"
