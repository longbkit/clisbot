#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

unset CLISBOT_CONFIG_PATH
unset CLISBOT_PID_PATH
unset CLISBOT_LOG_PATH
unset CLISBOT_RUNTIME_MONITOR_STATE_PATH
unset CLISBOT_RUNTIME_CREDENTIALS_PATH

exec bun run src/main.ts "$@"
