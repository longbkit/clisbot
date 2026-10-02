#!/usr/bin/env bash
set -euo pipefail

relay_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$relay_dir/source.env"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/clisbot-relay-build.XXXXXX")"
trap 'rm -rf -- "$build_dir"' EXIT

git -C "$build_dir" init --quiet
git -C "$build_dir" fetch --quiet --depth=1 "$RELAY_SOURCE_REPOSITORY" "$RELAY_SOURCE_REVISION"
git -C "$build_dir" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$build_dir" rev-parse HEAD)" = "$RELAY_SOURCE_REVISION"

build_args=(--load --tag "$CLISBOT_RELAY_IMAGE" --file "$relay_dir/Dockerfile")
if [[ -n "${CLISBOT_RELAY_BUILDER:-}" ]]; then
  build_args+=(--builder "$CLISBOT_RELAY_BUILDER")
fi
docker buildx build "${build_args[@]}" "$build_dir"
