#!/usr/bin/env bash
# Channel E2E dev loop — one command per step of the fix/restart/verify cycle
# (2026-08-26 review: stop hand-typing env). Encodes the fixed dev state:
#
#   home     ~/.clisbot-dev   (CLISBOT_HOME — never ~/.paseo, never .dev/paseo-home)
#   hub      127.0.0.1:6868   via `node packages/cli/bin/paseo hub start`
#   daemon   127.0.0.1:6867   PASEO_PASSWORD sourced from ~/.clisbot-dev/.daemon-password (0600)
#   log      ~/.clisbot-dev/hub.log
#
# Usage:
#   scripts/e2e-dev.sh build        stop the hub (vite build OOMs with it running), then build:hub
#   scripts/e2e-dev.sh restart      stop --force + detached start (use only when green)
#   scripts/e2e-dev.sh foreground   stop --force + run in foreground, tee'd to hub.log (debugging)
#   scripts/e2e-dev.sh status       channels status (per-account pin/integrity/load/transport/detail)
#   scripts/e2e-dev.sh logs [n]     last n lines of hub.log (default 40); `logs -f` to follow
#   scripts/e2e-dev.sh stop         stop the hub (--force)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DEV="${CLISBOT_HOME:-$HOME/.clisbot-dev}"
PW_FILE="$HOME_DEV/.daemon-password"
LOG_FILE="$HOME_DEV/hub.log"
CLI=(node "$REPO_ROOT/packages/cli/bin/paseo")

source_password() {
  # PASEO_PASSWORD (daemon WS subprotocol auth) — never hand-typed.
  if [ -f "$PW_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$PW_FILE"
    set +a
  else
    echo "warn: $PW_FILE not found — hub will start without PASEO_PASSWORD" >&2
  fi
}

hub_stop_force() {
  # `"${CLI[@]}"`, not `"$CLI"`: in bash, the latter expands only element 0.
  "${CLI[@]}" hub stop --home "$HOME_DEV" --force
}

case "${1:-}" in
  build)
    # The vite build is OOM-killed (exit 137) while the detached hub runs — stop first.
    hub_stop_force
    source_password
    (cd "$REPO_ROOT" && npm run build:hub)
    ;;
  restart)
    source_password
    hub_stop_force
    export CLISBOT_HOME="$HOME_DEV"
    # Verbose OpenClaw file log (<openclaw-tmp-dir>/openclaw.log): the channel
    # verticals' native drop gates (mention policy, allowlist, debounce, ACP
    # binding) only log at debug — the E2E loop needs them visible.
    export OPENCLAW_LOG_LEVEL=debug
    "${CLI[@]}" hub start --home "$HOME_DEV"
    ;;
  foreground)
    # Debugging: visible output, tee'd to the same log, Ctrl-C stops it.
    source_password
    hub_stop_force
    export CLISBOT_HOME="$HOME_DEV"
    export OPENCLAW_LOG_LEVEL=debug
    "${CLI[@]}" hub start --home "$HOME_DEV" --foreground 2>&1 | tee -a "$LOG_FILE"
    ;;
  status)
    export CLISBOT_HOME="$HOME_DEV"
    "${CLI[@]}" channels status --home "$HOME_DEV"
    ;;
  logs)
    shift
    if [ "${1:-}" = "-f" ]; then
      tail -n 40 -f "$LOG_FILE"
    else
      tail -n "${1:-40}" "$LOG_FILE"
    fi
    ;;
  stop)
    hub_stop_force
    ;;
  *)
    echo "usage: $0 {build|restart|foreground|status|logs [-f|n]|stop}" >&2
    exit 2
    ;;
esac
