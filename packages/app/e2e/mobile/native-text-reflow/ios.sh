#!/usr/bin/env bash
set -euo pipefail

: "${CLISBOT_NATIVE_TEXT_REFLOW_PID:?Set the PID of your task-owned Clisbot iOS simulator app}"
: "${CLISBOT_NATIVE_TEXT_REFLOW_LOG:?Set the test output log path}"

if [[ "$(ps -p "$CLISBOT_NATIVE_TEXT_REFLOW_PID" -o comm=)" != *ClisbotDebug.app/ClisbotDebug ]]; then
  echo "Expected a running ClisbotDebug simulator app" >&2
  exit 1
fi

probe_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
xcrun lldb --batch -p "$CLISBOT_NATIVE_TEXT_REFLOW_PID" \
  -o "command script import $probe_dir/ios.py" \
  -o "process detach" -o quit > "$CLISBOT_NATIVE_TEXT_REFLOW_LOG" 2>&1

grep '^NATIVE_REFLOW_' "$CLISBOT_NATIVE_TEXT_REFLOW_LOG"
grep -q '^NATIVE_REFLOW_PASS narrow=240 wide=500 selection=12:9$' "$CLISBOT_NATIVE_TEXT_REFLOW_LOG"
