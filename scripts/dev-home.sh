#!/usr/bin/env bash

default_dev_clisbot_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

seed_worktree_clisbot_home() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node "$script_dir/seed-dev-home.mjs" "${CLISBOT_DEV_SEED_HOME:-$HOME/.clisbot}" "$1"
}

configure_dev_daemon_config() {
  if [ -z "${CLISBOT_LISTEN:-}" ]; then
    return
  fi

  mkdir -p "$CLISBOT_HOME"
  node -e '
const fs = require("fs");
const [path, listen] = [process.argv[1], process.argv[2]];
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
cfg.version = cfg.version || 1;
cfg.daemon = cfg.daemon || {};
cfg.daemon.listen = listen;
cfg.daemon.cors = cfg.daemon.cors || {};
cfg.daemon.cors.allowedOrigins = ["*"];
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
' "$CLISBOT_HOME/config.json" "$CLISBOT_LISTEN"
}

resolve_dev_daemon_endpoint() {
  if [ -n "${CLISBOT_DEV_DAEMON_ENDPOINT:-}" ]; then
    echo "$CLISBOT_DEV_DAEMON_ENDPOINT"
    return
  fi

  case "${CLISBOT_LISTEN:-127.0.0.1:6869}" in
    0.0.0.0:*) echo "localhost:${CLISBOT_LISTEN#0.0.0.0:}" ;;
    127.0.0.1:*) echo "localhost:${CLISBOT_LISTEN#127.0.0.1:}" ;;
    *) echo "$CLISBOT_LISTEN" ;;
  esac
}

configure_dev_clisbot_home() {
  if [ -n "${CLISBOT_HOME:-}" ]; then
    export CLISBOT_HOME
    if [ -n "${CLISBOT_DEV_SEED_HOME:-}" ]; then
      seed_worktree_clisbot_home "$CLISBOT_HOME"
    fi
    mkdir -p "$CLISBOT_HOME"
    if [ "${CLISBOT_DEV_MANAGED_HOME:-0}" = "1" ] || [ -n "${CLISBOT_DEV_SEED_HOME:-}" ]; then
      configure_dev_daemon_config
    fi
    return
  fi

  export CLISBOT_HOME
  local dev_root
  dev_root="${CLISBOT_DEV_ROOT:-$(default_dev_clisbot_root)}"
  CLISBOT_HOME="$dev_root/.dev/clisbot-home"
  export CLISBOT_DEV_MANAGED_HOME=1

  if [ -n "${CLISBOT_DEV_SEED_HOME:-}" ]; then
    seed_worktree_clisbot_home "$CLISBOT_HOME"
  fi

  mkdir -p "$CLISBOT_HOME"
  configure_dev_daemon_config
}

configure_dev_command_env() {
  if [ -z "${CLISBOT_LISTEN:-}" ]; then
    if [ -n "${CLISBOT_SERVICE_DAEMON_PORT:-}" ]; then
      export CLISBOT_LISTEN="0.0.0.0:${CLISBOT_SERVICE_DAEMON_PORT}"
    else
      export CLISBOT_LISTEN="127.0.0.1:6869"
    fi
  fi

  configure_dev_clisbot_home
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -gt 0 ]; then
    configure_dev_command_env
    exec "$@"
  fi

  configure_dev_clisbot_home
fi
