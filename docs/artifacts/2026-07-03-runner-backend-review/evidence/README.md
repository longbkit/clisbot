# Evidence Snapshots

Captured outputs backing the review claims. Regenerate any of them with the
listed command; live-adapter runs consume real model quota and are kept as
recorded transcripts.

## 1. Real codex-acp smoke — PASS (2026-07-02)

`AcpRunnerBackend` against pinned `@agentclientprotocol/codex-acp@1.0.2` and a
real Codex model (local machine, gateway auth via `runner.env.OPENAI_API_KEY`):

```text
[smoke] session id: 019f2173-9ef9-7f91-a7e1-1c5cb6e878f3
[smoke] running: "ACP"
[smoke] completed snapshot: "ACP_SMOKE_OK"
[smoke] event types: message-delta, usage
[smoke] restart + session/load resume...
[smoke] resume notes: []
[smoke] resumed transcript contains prior prompt: true
[smoke] session id preserved: true
[smoke] RESULT: PASS
```

## 2. ACP steering experiments — D4 evidence (2026-07-03)

Experiment 1 — concurrent `session/prompt` while a turn is active (real
adapter): prompt B **hung indefinitely** (no error, no steer, unresolved even
after prompt A settled `end_turn`). Conclusion: the `AcpTurnAlreadyActiveError`
guard is mandatory; concurrent prompt is not a steering path.

Experiment 2 — cancel then reprompt (real adapter):

```text
[exp2] cancelling mid-turn (chars streamed so far: 0 )
[exp2] promptC settle: stopReason=cancelled
[exp2] promptD settle: stopReason=end_turn
[exp2] promptD answer: "The history of Vietnamese coffee."
[exp2] CONTEXT RETAINED: YES
```

Conclusion: cancel is first-class and retains conversation context →
interrupt-and-redirect steering shipped on this foundation.

## 3. Simulator regression run

`bun test test/acp-backend.test.ts test/capability-matrix.test.ts
test/resolved-target-backend.test.ts` → see
[acp-simulator-test-run.txt](acp-simulator-test-run.txt) (24 pass / 0 fail):
prompt, streaming, permission allow+deny, plans, protocol drift, cancel,
steer-redirect settle, context retention, resume, load-fallback, auth ok+
mismatch, adapter crash at init, session rotation, catalog resolution, and
capability-matrix drift guard.

## 4. Capability matrix

Generated doc: [capability-matrix.md](../../../features/runners/capability-matrix.md)
(`bun run docs:capability-matrix`; drift-guarded by `test/capability-matrix.test.ts`).

## 5. Failure-mode matrix

[failure-mode-matrix.md](../../../tests/features/runners/failure-mode-matrix.md)
maps every known failure scenario → detection → handling → user-facing outcome
→ solved / fails-well / open, each row anchored to a simulator-backed test.
