# Real codex-acp Smoke (2026-07-04T07:28Z)

Command: `OPENAI_API_KEY=<key> bun run scripts/acp-codex-smoke.ts` (real adapter 1.0.2, real model via local gateway)

```text
[smoke] starting adapter + session...
[smoke] session id: 019f2c07-ce6e-7711-b412-5e5f74da60f1
[smoke] running: "Reconnecting... 2/5"
[smoke] running: "Reconnecting... 2/5\n\nReconnecting... 3/5"
[smoke] running: "Reconnecting... 2/5\n\nReconnecting... 3/5\n\nACP_SMOKE_OK"
[smoke] completed snapshot: "Reconnecting... 2/5\n\nReconnecting... 3/5\n\nACP_SMOKE_OK"
[smoke] event types: message-delta, usage
[smoke] restart + session/load resume...
[smoke] resume notes: []
[smoke] resumed transcript contains prior prompt: true
[smoke] session id preserved: true
[smoke] RESULT: PASS
```
