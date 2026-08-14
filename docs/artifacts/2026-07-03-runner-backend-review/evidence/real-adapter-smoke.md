# Real codex-acp Smoke

## 2026-08-11T11:27Z — adapter 1.1.14, ChatGPT auth

Command: `ACP_SMOKE_AUTH_METHOD=chat-gpt bun run scripts/acp-codex-smoke.ts`

This upgrade moves the adapter's bundled `@openai/codex` dependency from
`^0.142.4` to `^0.147.0`, resolving the rejection that said `gpt-5.6-sol`
required a newer Codex version.

```text
[smoke] adapter: @agentclientprotocol/codex-acp@1.1.14; auth: chat-gpt
[smoke] session id: 019ff094-6bfd-7e10-a2ad-a4b05d0841ba
[smoke] running: "ACP_SM"
[smoke] completed snapshot: "ACP_SMOKE_OK"
[smoke] event types: message-delta, usage
[smoke] restart + session/load resume...
[smoke] resume notes: []
[smoke] resumed transcript contains prior prompt: true
[smoke] session id preserved: true
[smoke] RESULT: PASS
```

## 2026-07-04T07:28Z — adapter 1.0.2, gateway auth

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
