#!/bin/sh
set -eu

snapshot_directory="$(mktemp -d)"
trap 'rm -rf "$snapshot_directory"' EXIT

cp -R drizzle "$snapshot_directory/drizzle"
./node_modules/.bin/drizzle-kit check
./node_modules/.bin/drizzle-kit generate
diff -ru "$snapshot_directory/drizzle" drizzle
