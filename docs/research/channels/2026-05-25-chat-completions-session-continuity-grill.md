# Chat Completions Session Continuity Grill

## Context

This note is deliberately separate from the generic API channel events/actions
grill.

API bots model third-party systems that push events into `clisbot`, poll
results, and may optionally receive provider HTTP actions. The Chat Completions
API is a request/response compatibility surface: an OpenAI-compatible client
sends `messages`, waits for an OpenAI-shaped response, and may not have a
provider-side "send message" API at all.

OpenAI Chat Completions does not expose a first-class conversation session id
in the request contract. The request carries a `messages` array, and the API
also supports custom `metadata` on stored chat completion objects. OpenAI's
current docs also point new stateful work toward the Responses and
Conversations APIs rather than treating Chat Completions as the preferred
server-side state API.

Reference:

- https://platform.openai.com/docs/api-reference/chat/create
- https://platform.openai.com/docs/guides/responses-vs-chat-completions

## Hermes Evidence

Hermes' `gateway/platforms/api_server.py` is useful prior art, but its terms do
not map 1:1 onto `clisbot`:

- `POST /v1/chat/completions` is OpenAI Chat Completions compatible.
- `X-Hermes-Session-Id` opts into short-term transcript continuation.
- `X-Hermes-Session-Key` scopes long-term memory independently from transcript
  id.
- If no session id is supplied, Hermes derives a stable id from the system
  prompt plus first user message so Open WebUI-style full-history requests can
  reuse the same server-side session.
- Hermes returns `X-Hermes-Session-Id` and, when present, `X-Hermes-Session-Key`
  on the response.
- Hermes requires API-key authentication before accepting caller-supplied
  session headers because those headers can expose prior conversation context.

`clisbot` should borrow the shape of "client-supplied continuity metadata", not
the names directly. In `clisbot`, `sessionKey` is the logical conversation key
owned by agents, while `sessionId` is the native runner id captured from Codex,
Claude, Gemini, or another runner.

## Recommendation

Support Chat Completions session continuity through a small compatibility
extension that accepts both headers and request-body metadata.

Preferred client request:

```json
{
  "model": "clisbot/default",
  "messages": [
    { "role": "user", "content": "continue the plan" }
  ],
  "metadata": {
    "clisbot_session_key": "openwebui:conversation:abc123"
  }
}
```

Equivalent header form:

```http
X-Clisbot-Session-Key: openwebui:conversation:abc123
```

Response:

```json
{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 1779660000,
  "model": "clisbot/default",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  },
  "metadata": {
    "clisbot_session_key": "openwebui:conversation:abc123"
  }
}
```

Response headers should also include:

```http
X-Clisbot-Session-Key: openwebui:conversation:abc123
```

Do not expose or accept the native runner `sessionId` in the first slice. The
API client's stable conversation key should map to a `clisbot` `sessionKey`;
`clisbot` then privately persists `sessionKey -> sessionId` through the
existing `SessionService`.

## Continuity Key Precedence

Resolve the API request's external continuity key in this order:

1. `X-Clisbot-Session-Key`
2. `metadata.clisbot_session_key`
3. `metadata.conversation_id`
4. `user`
5. per-request key if no stable input exists

The first two are explicit `clisbot`-aware contracts. `conversation_id` and
`user` are compatibility fallbacks for clients that already have those fields
but cannot be configured to send custom names. If none is present, do not infer
continuity from the message body by default.

Do not accept `metadata.clisbot_session_id`, `metadata.session_id`, or
`X-Clisbot-Session-Id` in the first slice. Those names invite confusion with
native runner `sessionId`; Hermes-style clients should adapt to
`clisbot_session_key` or `X-Clisbot-Session-Key`.

Recommended `sessionKey` shape:

```text
agent:<agentId>:completion-api:openai:<normalizedExternalKey>
```

This preserves the existing clisbot convention that session keys include the
agent id and surface family.

## Message History Semantics

Chat Completions clients normally resend full message history. `clisbot`
runners already preserve conversation context through native runner sessions.
Mixing those two state models can duplicate context if not handled explicitly.

Recommended behavior:

- No continuity key: treat `messages` as the complete one-shot prompt context.
- New continuity key: use the supplied history for the first turn, then persist
  the mapped `sessionKey`.
- Existing continuity key: submit only the latest user message to the existing
  `clisbot` session by default.
- Existing continuity key with explicit full-replay mode: allow a later
  metadata flag only after there is a concrete client that needs it.

This makes metadata-backed continuity useful for tool workspace continuity and
native runner resume without replaying the whole transcript on every turn.

## Security

Caller-supplied continuity keys can route a request into prior conversation
state. Treat them as sensitive routing inputs.

First-slice rules:

- accept explicit continuity metadata only when the request is authenticated
  with the API Bearer token
- reject control characters and overlong keys
- normalize to a safe storage segment before composing `sessionKey`
- never store API keys or auth headers in metadata
- never let client-supplied metadata overwrite native runner `sessionId`
- reject `session_id`-named continuity aliases in the first slice
- avoid logging raw continuity keys at info level

If the listener is local-only and no API key is configured, the API can still
handle stateless requests, but explicit `clisbot_session_key` should be
rejected until auth is configured.

## Non-Streaming Output

For non-streaming Chat Completions, the HTTP response waits for the clisbot run
to settle and then returns one OpenAI-shaped `chat.completion` object.

There are no progress updates, no queue lifecycle messages, and no partial
assistant chunks in the HTTP body. Any clisbot processing feedback stays outside
this endpoint unless a later streaming/SSE contract is added.

If the session is already running, first slice should return a clear conflict:

```json
{
  "error": {
    "message": "Session is already running",
    "type": "invalid_request_error",
    "code": "session_busy"
  }
}
```

Queueing or steering a busy API session should be a later explicit decision
because OpenAI-compatible clients usually expect one request to produce one
direct response.

## Streaming

Session continuity and streaming are separate decisions.

The first slice can still reject `stream: true`. When streaming is added, it
must use OpenAI Chat Completions SSE chunk semantics. `clisbot` channel
observers and message-tool streaming are useful internal sources, but the API
response must emit OpenAI-compatible chunks, not chat-channel progress text.

The same `X-Clisbot-Session-Key` / `metadata.clisbot_session_key` resolution
should apply to streaming and non-streaming requests.

## Decision Points

- Preferred continuity field: `metadata.clisbot_session_key`.
- Header equivalent: `X-Clisbot-Session-Key`.
- Do not expose native runner `sessionId` as public API continuity in first
  slice.
- Reject `metadata.clisbot_session_id`, `metadata.session_id`, and
  `X-Clisbot-Session-Id` in the first slice.
- Return the resolved key in response metadata and `X-Clisbot-Session-Key`.
- Require Bearer auth for explicit continuity keys.
- Requests without an external continuity key should be stateless/per-request
  by default.
- Existing continuity key should submit the latest user message, not replay the
  whole history by default.
- Busy session behavior should be `409 session_busy` in first slice.
- Responses API can later add first-class state with `previous_response_id`;
  that should not block the Chat Completions compatibility slice.

## Validation Bundle

- parser tests for header and metadata precedence
- parser tests for invalid, overlong, and control-character keys
- auth tests proving explicit continuity is rejected without Bearer auth
- session-key tests for `agent:<agentId>:completion-api:openai:<key>`
- request tests proving no native runner `sessionId` is accepted from metadata
- request tests proving `session_id` aliases are rejected
- non-streaming response tests for OpenAI-shaped body plus metadata echo
- existing-session tests proving only the latest user message is submitted
- busy-session test returning `409 session_busy`
