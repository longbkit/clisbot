#!/usr/bin/env bash
# B3 mid-turn stop drive: send a long counting marker, wait until the codex
# turn starts, cancel ~5s in, capture the cancel output. All timestamps UTC.
cd /home/node/projects/clisbot-paseoclaw-fusion
set -a && . .env && set +a
LOG=/tmp/b3-drive.log
: > "$LOG"
{
echo "=== [$(date -u +%H:%M:%S.%3N)Z] sending B3 marker (1..1000) ==="
node .writer-progress/master-driver.mjs send "E2E-TG-B3R-$(date +%H%M) @longluong3bot — counting task:
Enumerate the numbers 1 through 1000, one number per line, in order.
When you reach 1000, make your very last line exactly: B3-DONE
Do not stop early, do not summarize, just keep listing one number per line until B3-DONE." 2>&1

MARKER_TS=$(date +%s); export MARKER_TS
echo "=== [$(date -u +%H:%M:%S.%3N)Z] waiting for new 'Starting Codex app-server turn' (after $MARKER_TS) ==="
for i in $(seq 1 60); do
  NEWLINE=$(node -e '
    const lines = require("fs").readFileSync("/home/node/.clisbot-dev/daemon.log","utf8").trim().split("\n");
    let found = null;
    for (const l of lines) {
      try { const j = JSON.parse(l);
        if (j.msg==="Starting Codex app-server turn" && String(j.agentId||"").startsWith("66ffaf49") && j.time>=Number(process.env.MARKER_TS)*1000) found = j.turnId + " @ " + new Date(j.time).toISOString();
      } catch {}
    }
    console.log(found || "");
  ')
  if [ -n "$NEWLINE" ]; then echo "TURN STARTED: $NEWLINE"; break; fi
  sleep 1
done

sleep 5
echo "=== [$(date -u +%H:%M:%S.%3N)Z] CANCEL mid-turn ==="
node .writer-progress/trusted-cancel.mjs --agent 66ffaf49-d5a2-434a-9b33-9fc882c78822 --watch 120 2>&1
echo "=== [$(date -u +%H:%M:%S.%3N)Z] B3 drive script done ==="
} >> "$LOG" 2>&1
