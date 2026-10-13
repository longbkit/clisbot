#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export CLISBOT_LISTEN="${CLISBOT_LISTEN:-127.0.0.1:6869}"
configure_dev_clisbot_home

if [ -z "${CLISBOT_LOCAL_MODELS_DIR}" ]; then
  export CLISBOT_LOCAL_MODELS_DIR="$HOME/.clisbot/models/local-speech"
  mkdir -p "$CLISBOT_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Clisbot Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${CLISBOT_HOME}"
echo "  Models:  ${CLISBOT_LOCAL_MODELS_DIR}"
echo "  Listen:  ${CLISBOT_LISTEN}"
echo "══════════════════════════════════════════════════════"

export CLISBOT_CORS_ORIGINS="${CLISBOT_CORS_ORIGINS:-*}"
export CLISBOT_NODE_INSPECT="${CLISBOT_NODE_INSPECT:---inspect=0}"

if [ "${CLISBOT_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
