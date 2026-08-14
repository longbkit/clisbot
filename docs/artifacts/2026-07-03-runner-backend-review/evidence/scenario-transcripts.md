# Scenario Transcripts: What The User Actually Sees

- Generated: 2026-07-04T07:25:45.723Z
- Regenerate: `bun run scripts/capture-runner-evidence.ts`
- Every block below is the real output of the real `AcpRunnerBackend` driven
  against the scripted ACP simulator (`test/fixtures/fake-acp-agent.ts`) —
  no mocks between the backend and the wire protocol.

## Tool permission denied by policy (`permissionPolicy: "deny"`)

Chat reply the user sees:
```text
Working on:

⏺ Read project files [✗]

The agent declined to continue this request.
```
Structured events emitted for capability-aware surfaces:
```json
{"type":"message-delta","role":"assistant","text":"Working on: "}
{"type":"tool-call","callId":"call-1","title":"Read project files","status":"in-progress"}
{"type":"permission-request","requestId":"call-1","title":"Read project files","options":[{"optionId":"allow-once","label":"Allow once","kind":"allow-once"},{"optionId":"reject-once","label":"Reject","kind":"reject-once"}]}
{"type":"tool-call","callId":"call-1","title":"","status":"failed"}
```

## `/steer` on ACP: interrupt-and-redirect keeps conversation context

Interrupt acknowledged: `interrupted: true` (turn settled before the redirect prompt).
The redirected follow-up proves the cancelled turn's context survived:
```text
You were asking: write the quarterly report
```

## Stored conversation cannot be resumed (agent lacks `session/load`)

Startup note posted to the chat surface:
```text
This ACP agent does not support session/load, so the stored conversation could not be resumed. Started a fresh conversation instead.
```

## Adapter crashes before initialize (bad install, broken adapter)

Error message the user/operator sees (includes adapter stderr evidence):
```text
Runner session "evidence-session" lost its ACP adapter process. Your run could not continue; resend the message to retry. If this keeps happening, verify the adapter command starts cleanly in the workspace and inspect clisbot logs. Adapter stderr: fake adapter refused to start: simulated init crash
```

## Adapter process dies mid-turn

Recovery classification: `canRecoverMidRun: true` → the monitor-owned recovery re-opens the stored session via `session/load` before failing.
If recovery is exhausted, the user sees:
```text
Runner session "evidence-session" lost its ACP adapter process. Your run could not continue; resend the message to retry. If this keeps happening, verify the adapter command starts cleanly in the workspace and inspect clisbot logs.
```

## `/stop` during an ACP turn (first-class `session/cancel`)

Turn settlement the user sees:
```text
Working on:

⏺ Read project files [✓]

The run was cancelled.
```

## Protocol drift: newer agent emits plan + unknown update types

Turn completes normally; unknown types are ignored, plans stream as events:
```text
Working on:

⏺ Read project files [✓]

done -> drift-proof work
```
Events (note the plan; the unknown type never crashes the client):
```json
{"type":"plan","entries":[{"title":"Analyze the request","status":"in-progress"},{"title":"Apply the change","status":"pending"}]}
{"type":"tool-call","callId":"call-1","title":"Read project files","status":"in-progress"}
{"type":"tool-call","callId":"call-1","title":"","status":"completed"}
```
Finding (captured while generating this transcript): the pinned
`@agentclientprotocol/sdk@1.3.0` validates `session/update` strictly and
logs a zod validation error object to the console when it drops an
unknown update type. Behavior is safe (the run is unaffected; the update
never reaches clisbot code) but a newer agent emitting new update types
would spam runtime logs. Track as an upstream SDK issue candidate and a
log-noise watch item for adapter bumps.

## Steering degradation copy (channel layer, from regression tests)

Explicit `/steer` on ACP posts this notice, then delivers the redirect:
```text
This backend cannot inject into a running turn, so clisbot interrupted the current turn and is applying your steering message as the next prompt.
Conversation context from the interrupted work is retained; in-flight output from the interrupted turn is discarded.
```
A backend with neither steer nor interrupt would instead see:
```text
This agent's runner backend cannot steer into a running turn.
Use `/queue <message>` to run it after the current turn, or `/stop` and resend a combined prompt.
```
