# OpenAI-Compatible Completion API Research

## Context

a Long wants `clisbot start` to expose an OpenAI-compatible completion API first, then add Anthropic compatibility later. The API should be reachable through configurable `--host` and `--port`, persist those values into `clisbot.json`, restart cleanly when the endpoint changes, and stop with the rest of clisbot.

This is not a separate product system. The existing architecture already names future API endpoints as channel surfaces, so the implementation should stay isolated under `channels` and be wired into `control` only for lifecycle and start flags.

## Current Architecture Fit

- `channels` owns inbound surfaces, including future API.
- `control` owns `start`, `stop`, runtime process lifecycle, and operator flags.
- `configuration` owns persisted `clisbot.json` settings.
- `agents` owns session continuity and run lifecycle.
- `runners` owns native CLI execution and should not know about HTTP or OpenAI compatibility.

## Problem

OpenAI-compatible clients expect a local HTTP server with endpoints such as:

- `GET /v1/models`
- `POST /v1/chat/completions`

clisbot currently exposes chat surfaces through Slack, Telegram, Zalo, and CLI control commands, but not through a local HTTP completion API. The new API needs to reuse the same durable agents without leaking HTTP concepts into agent or runner internals.

## Grill Questions And Recommended Answers

### 1. Is the completion API a channel or control surface?

Recommended answer: treat it as a channel-like user-facing ingress surface, not control. `control` only parses `start --host/--port`, persists endpoint config, and starts/stops the runtime. Request handling belongs under `src/channels/completion-api`.

### 2. Should the API start by default?

Recommended answer: yes, but bind to `127.0.0.1` by default. That satisfies "expose thêm" while preserving safe local behavior. Non-local bind should require Bearer auth.

### 3. Where should host/port live?

Recommended answer: `app.completionApi.host` and `app.completionApi.port`. These are app-wide runtime listener settings, not bot credentials or route settings.

### 4. What should `clisbot start --host/--port` do while already running?

Recommended answer: if the requested host/port differ from persisted config, write the new config, stop the current detached runtime, and start a fresh one. If they are the same, keep the existing "already running" behavior.

### 5. How does `clisbot stop` stop the API?

Recommended answer: the API server is owned by the runtime supervisor and stopped inside the same lifecycle as channel services and `AgentService`.

### 6. How should API auth work?

Recommended answer: local bind can run without a token. Non-local bind requires a Bearer token read from `app.completionApi.auth.apiKeyEnv`, defaulting to `CLISBOT_COMPLETION_API_KEY`. The config stores only the env var name, never the secret value.

### 7. How should OpenAI `model` map to clisbot agents?

Recommended answer: expose configured agent ids through `/v1/models`. If `model` equals an agent id or `clisbot/<agentId>`, route to that agent. Otherwise route to the configured default agent while preserving the requested model in the response for client compatibility.

### 8. How should request session continuity work?

Recommended answer: derive `sessionKey` from `x-clisbot-session-key`, then `metadata.clisbot_session_key`, then `user`, then the target agent id. Prefix with `api:openai:` so API sessions do not collide with Slack or Telegram sessions.

### 9. Should OpenAI streaming be supported now?

Recommended answer: no. Return a clear `400` for `stream: true` in the first slice. Streaming needs a separate design because clisbot currently has channel observer semantics but OpenAI expects Server-Sent Events chunk semantics.

### 10. Should Anthropic compatibility share the same server?

Recommended answer: yes. Keep the service as `completion-api`, with provider adapters below it. OpenAI starts first; Anthropic can add `/v1/messages` later without changing the lifecycle model.

## Proposed First Slice

- Add `app.completionApi` schema and config template defaults.
- Add `clisbot start --host <host> --port <port>` parsing, persistence, and endpoint-change restart behavior.
- Add `CompletionApiService` under `src/channels/completion-api`.
- Add `GET /health`.
- Add `GET /v1/models`.
- Add `POST /v1/chat/completions` non-streaming.
- Reject `stream: true` explicitly until SSE behavior is designed.
- Require Bearer auth when the configured API key env exists, and always require it for non-local binds.

## Proposed File Boundaries

- `src/channels/completion-api/`: OpenAI and future Anthropic HTTP compatibility, request parsing, response rendering, and listener service.
- `src/control/commands/runtime-bootstrap-cli.ts`: start flag parsing and persisted config update only.
- `src/control/runtime/runtime-supervisor.ts`: lifecycle wiring so start/reload/stop include the API service.
- `src/config/core/schema.ts`: persisted app-wide listener config.
- `test/completion-api-*.test.ts`: parser, auth, model mapping, and non-streaming request behavior.

## Acceptance Criteria

- Plain `clisbot start` persists or uses default local API listener settings without requiring extra flags.
- `clisbot start --host <host> --port <port>` writes the endpoint to `clisbot.json`.
- Restarting with a different host/port stops the old runtime and starts the new endpoint.
- `clisbot stop` stops the API listener together with the rest of runtime.
- `/v1/models` returns configured agent ids.
- `/v1/chat/completions` routes to the default or selected agent and returns an OpenAI-shaped non-streaming response.
- Non-local binds fail fast without a configured API key env.
- No secret values are written to config, docs, logs, or CLI output.

## Known Limitations

- Streaming response is intentionally deferred.
- Anthropic-compatible `/v1/messages` is intentionally deferred.
- Route-level API auth roles are deferred; first slice should use one listener-level Bearer token.
- Token usage is approximate because native CLI runners do not return OpenAI token accounting.
- Final answer extraction would likely reuse transcript heuristics, so exact output quality still depends on runner transcript cleanliness.

## Review Questions For a Long

- Should non-local bind always require auth, or should Tailnet-only host be allowed without Bearer token?
- Should `model` names be raw agent ids, `clisbot/<agentId>`, or both?
- Should the API default session be shared (`api:openai:<agent>`) or stateless per request unless a session key is supplied?
- Should `start --host/--port` be named generic `--host/--port`, or more explicit `--api-host/--api-port` before release hardening?
- Should Anthropic compatibility use the same auth key and session mapping, or separate `anthropic:` session prefixes?
