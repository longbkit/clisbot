#!/usr/bin/env bash
# Build the normalized merge base: the actual Git merge base, run through the same
# text rename, visual kit and formatter as the incoming upstream snapshot. Conflict
# classification compares both sides against it, so rename noise drops out.
#
# Usage: scripts/upstream-sync/normalized-base.sh <merge-base-sha> <empty-directory>
# Run from the Clisbot checkout whose scripts and node_modules should be used.
set -euo pipefail

base_sha="$1"
target="$2"
repo="$(git rev-parse --show-toplevel)"

git -C "$repo" worktree add --detach "$target" "$base_sha" >/dev/null
# The rename stops after moving files when Git ignores a destination; that only
# matters for committed snapshots, not this throwaway comparison copy.
node "$repo/scripts/rebrand-clisbot.mjs" --root "$target" --apply \
  --expo-owner lbk-company --expo-project-id 9314cc2c-4abe-4637-b1cf-647fbbfbd807 ||
  echo "normalized-base: rename reported ignored destinations (expected); continuing" >&2
node "$repo/scripts/branding/apply.mjs" --root "$target" --apply >/dev/null
(cd "$target" && "$repo/node_modules/.bin/oxfmt" . >/dev/null)
git -c core.excludesFile=/dev/null -C "$target" add -A
echo "normalized base ready: $target"
