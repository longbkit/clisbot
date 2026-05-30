# Chat Completions External Continuity Key

## Status

Accepted

## Date

2026-05-25

## Context

`clisbot` is adding an OpenAI-compatible Chat Completions surface.

Chat Completions requests carry a `messages` array but do not expose a
first-class conversation session id. Some compatible clients can send custom
metadata or headers; some resend the whole transcript each turn.

`clisbot` already has two distinct session concepts:

- `sessionKey`: the clisbot logical conversation key owned by agents
- `sessionId`: the native runner conversation id for Codex, Claude, Gemini, or
  another runner

Hermes' API server is useful prior art: it accepts `X-Hermes-Session-Id` and
`X-Hermes-Session-Key`. Copying those names directly would be misleading in
`clisbot` because `sessionId` already has runner-specific meaning.

## Decision

Chat Completions session continuity must use an external continuity key that
maps into clisbot `sessionKey`.

Accepted first-slice inputs, in precedence order:

1. `X-Clisbot-Session-Key`
2. `metadata.clisbot_session_key`
3. `metadata.conversation_id`
4. `user`

If none is supplied, the request is stateless/per-request for clisbot
continuity purposes. Do not infer continuity from the message body by default.

The resolved clisbot session key should use this shape:

```text
agent:<agentId>:completion-api:openai:<normalizedExternalKey>
```

The response should echo the external key in:

- `X-Clisbot-Session-Key`
- `metadata.clisbot_session_key`

Do not accept `metadata.clisbot_session_id`, `metadata.session_id`, or
`X-Clisbot-Session-Id` in the first slice. Those names invite confusion with
native runner `sessionId`.

`SessionService` remains the only owner of `sessionKey -> sessionId` mapping.
The Chat Completions API must not expose, accept, or let clients overwrite the
native runner `sessionId`.

## Consequences

Good:

- public API language matches the existing domain model
- clients can get session continuity without learning native runner ids
- the private runner session id remains protected from client input
- accidental cross-client session sharing is avoided when no explicit key is
  supplied
- the design still leaves room for Responses API `previous_response_id` later

Tradeoffs:

- clients that cannot send headers, metadata, `conversation_id`, or `user` get
  stateless Chat Completions behavior
- Hermes-style `X-Hermes-Session-Id` clients need a small adapter or config
  change instead of passing the same header to `clisbot`
- best-effort fingerprint continuity can be added later, but it is not the
  default because common first prompts such as "hi" can collide across
  unrelated clients

## Links

- [Chat Completions Session Continuity Grill](../../research/channels/2026-05-25-chat-completions-session-continuity-grill.md)
- [OpenAI-Compatible Completion API Research](../../research/channels/2026-05-23-openai-compatible-completion-api.md)
