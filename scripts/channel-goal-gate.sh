#!/usr/bin/env bash
# Channel platform gate: builds every channel package, typechecks Hub/CLI,
# runs the manifest + format + script checks and the targeted vitest set.
# Sequential on purpose (8 GB box, never two tsgo at once). Output goes to
# $GATE_OUT (default /tmp/channel-goal-gate) with one file per step; the
# summary line per step is printed here. Exit 1 if any step failed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${GATE_OUT:-/tmp/channel-goal-gate}"
mkdir -p "$OUT"
fail=0
step() {
  local name="$1"; shift
  if ( cd "$ROOT" && "$@" ) > "$OUT/$name.txt" 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name  (see $OUT/$name.txt)"; fail=1
  fi
}
for pkg in core markdown-core shared slack telegram discord googlechat feishu zalo zalouser; do
  step "build-$pkg" npm run build --workspace="@getpaseo/channels-$pkg"
done
step typecheck-hub npm run typecheck:node --workspace=@getpaseo/hub
step typecheck-cli npm run typecheck --workspace=@getpaseo/cli
step sync-check node scripts/channel-upstream-sync.mjs check
step fixtures-check node --import tsx scripts/channel-differential-fixtures.mjs check
step format-check npm run format:check
step script-tests node --test scripts/channel-upstream-sync.test.mjs scripts/slack-live-assert.test.mjs scripts/ci-workflow.test.mjs
run_vitest() {
  local name="$1" dir="$2"; shift 2
  step "vitest-$name" bash -c "cd '$ROOT/$dir' && npx vitest run $* --maxWorkers=1 --no-file-parallelism"
}
for pkg in shared slack telegram discord googlechat feishu zalo zalouser core markdown-core; do
  run_vitest "$pkg" "packages/channels/$pkg" src
done
run_vitest hub-channels packages/hub \
  src/channels/channel-reply.test.ts src/channels/message-actions.test.ts \
  src/channels/channel-reply-capabilities.test.ts src/channels/channel-agent-tools.test.ts src/channels/command-buttons.test.ts \
  src/channels/streaming/producer.test.ts src/channels/ingress src/channels/policy src/channels/plane \
  src/channels/supervisor/supervisor.test.ts src/channels/supervisor/account-carriers.test.ts src/channels/supervisor/needs-login.test.ts \
  src/channels/loader src/channels/execution src/channels/bindings src/channels/relay src/channels/config \
  src/channels/connections src/channels/channel-flag.test.ts src/channels/catalog.test.ts src/channels/http/control-plane.test.ts
run_vitest hub-db packages/hub src/db/channels.test.ts src/db/migrations.test.ts src/db/channel-connections.integration.test.ts
run_vitest hub-mgmt packages/hub src/management-api src/state src/shutdown.test.ts src/credentials src/daemons/lifecycle.test.ts
run_vitest cli packages/cli src/commands/channels
step loader-native npm run test:loader:native --workspace=@getpaseo/hub
step contract-native npm run test:contract:native --workspace=@getpaseo/hub
exit $fail
