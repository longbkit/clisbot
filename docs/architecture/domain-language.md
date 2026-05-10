# Domain Language

## Status

Working architecture reference

## Purpose

Keep one canonical language for `clisbot` architecture, code, docs, prompts, CLI help, and task specs.

This file now owns the repository's shared vocabulary plus the light model-boundary rules that keep naming, ownership, lifecycle, and boundary crossings coherent. It supersedes the former architecture glossary and taxonomy docs.

Use this file before introducing a new concept name or a new cross-layer model shape. If an existing term fits, reuse it. If a new term is required, add it here before spreading it across code or docs.

## Language

### Conversation And Runtime

**sender**: The human or system identity that submitted, queued, steered, or created the message.  
_Owner_: Channels capture it; auth checks it; agents may persist it for queue or loop continuity.

**surface**: The place where a message arrives and replies render, such as a Slack thread, Telegram group or topic, DM, or a future API conversation.  
_Owner_: Channels own surface presentation and reply targeting.

**message**: One submitted user input or generated scheduled input.  
_Owner_: Channels receive messages; agents queue or run them.

**session**: One clisbot conversation continuity bucket. Users normally just keep chatting; they only need to care about native tool ids when they intentionally rotate or resume a session.  
_Owner_: Agents own session continuity.

**sessionKey**: Stable clisbot-side conversation key for one logical conversation.  
_Owner_: Agents own the continuity key.

**sessionId**: The current native tool conversation id attached to a `sessionKey`.  
_Owner_: `SessionService` owns the mapping. The native tool may create the id, `SessionService` may supply one explicitly, and runners only pass, capture, or resume it.

**storedSessionId**: Persisted copy of the current active `sessionId` for one `sessionKey`.  
_Owner_: Agents persistence and operator or status surfaces.

**run**: One active execution for one session.  
_Owner_: Agents own run lifecycle.

**runtime projection**: A persisted session-runtime record such as `idle`, `running`, or `detached`. It helps recovery, but it is not live run truth by itself.  
_Owner_: Agents persistence only.

**runner**: Backend executor boundary, such as tmux running Codex, Claude, or Gemini.  
_Owner_: Runners.

**queue**: Ordered pending messages for one session.  
_Owner_: Agents.

**queue item**: One queued prompt entry in a session queue. Pending or running queue items are durable; completed or failed queue items are removed after settlement instead of retained as history.  
_Owner_: Agents persistence and runtime queue reconciliation.

**loop**: Scheduled or repeated message tied to a session and surface.  
_Owner_: Agents own schedule state; channels supply surface context for delivery.

**steering**: A new user message injected while a run is still active.  
_Owner_: Channels detect it; agents or runners submit it to the active run.

### Identity

**principal**: Canonical clisbot auth identity string for a user or identity that can receive roles or permissions.  
_Avoid_: display text, provider display name, CLI route target, `principle`

**senderId**: The message-context field that stores the sender's `principal`. Use this only when the identity is specifically the sender of a message, queue item, steering input, or loop.  
_Avoid_: general auth identity wording when sender-specific context is not the point

**providerId**: Raw provider-local id.  
_Avoid_: auth principal, canonical `surfaceId`

**displayName**: Human-readable name from provider or config.  
_Avoid_: CLI target, auth principal, formatted prompt text

**handle**: Provider username or handle without mention formatting.  
_Avoid_: auth principal, display name, Slack mention syntax

**sender display text**: Prompt-rendered text assembled from sender fields.  
_Avoid_: stored directory fields, auth principal

**principal** format:

```text
<platform>:<provider-user-id>
```

Rules:

- Telegram principal ids are numeric user ids, not handles.
- Slack principal ids are Slack user ids such as `U...` or `W...`, not display names or mention syntax.
- Principal strings are platform-scoped. `telegram:1276408333` and `slack:U123ABC456` are different identities unless explicitly linked later.
- Use `principal` for auth identity values in public docs and CLI help.
- Use `senderId` only when that principal is specifically the sender in a message context.

### Surface

**surfaceId**: Canonical clisbot surface identity.  
_Avoid_: human display text, CLI target syntax

**surfaceKind**: Canonical shared surface shape.  
_Avoid_: provider-local type names unless they are being mapped

**parentSurfaceId**: Canonical parent surface for nested surfaces such as topics or threads.  
_Avoid_: reply target by itself when child targeting is required

**surface display text**: Prompt-rendered text assembled from surface fields.  
_Avoid_: stored directory fields, CLI target

**provider capability**: Truth about which canonical concepts one provider variant supports.  
_Avoid_: pretending every provider supports the full shared vocabulary

Surface rules:

- `dm`, `group`, and `topic` are the canonical shared surface concepts.
- Provider-local labels such as Slack `channel` stay inside provider adapters and map into canonical concepts.
- `topic` is a child surface of `group`, not a top-level peer concept.
- Unsupported concepts do not need fake persisted shape just to mirror the full shared vocabulary.

### Update And Release

**update**: Preferred public term for installing a newer `clisbot` package and restarting the runtime.  
_Owner_: Control CLI and release docs.

**manual migration**: Operator action required during an update beyond install, restart, status, and release-note review.  
_Owner_: Migration docs only.

Use `update` in public CLI help, folder names, release docs, and operator-facing wording. Avoid `upgrade` for this product concept unless quoting old history or external tooling.

### Model Suffixes

**Record**: Durable serialized storage shape.

**State**: Owned lifecycle state.

**Input**: Caller-provided payload.

**Context**: Prompt or rendering input assembled for one use case.

**Binding**: Stored link to an external surface or runner target needed later.

**Result**: Stable returned outcome.

## Relationships

- A **message** always has one **sender** and one **surface**.
- A **surface** normally maps to one **sessionKey**.
- A **storedSessionId** is the persisted copy of the current **sessionId** for one **sessionKey**.
- A **run** executes against one **session**.
- A **queue** orders **queue items** for one **session**.
- A **loop** delivers into one **session** and one **surface**.
- A **topic** belongs to exactly one **group** and inherits group config by default before topic-specific override.
- Provider-local nouns map into canonical **surfaceKind** values, for example Slack `channel` to **group**.
- Provider capability truth lives at the provider-variant level, not only the broad platform-family label.

## Example Dialogue

> **Dev:** "For Slack should we model `channel` as its own top-level shared concept?"
>
> **Domain expert:** "No. In shared language it is a **group**. `channel` stays provider-local."
>
> **Dev:** "Then what about Telegram topics?"
>
> **Domain expert:** "A **topic** is a child of one **group**. It inherits group config unless it overrides it."
>
> **Dev:** "If the native CLI rotates conversation ids, does that create a new shared session?"
>
> **Domain expert:** "Not necessarily. The shared continuity key is **sessionKey**. The native id is the current **sessionId** attached to that key."

## Flagged Ambiguities

- `target` is too generic to stand alone as a core concept. It only says "points somewhere", not what relation or domain it belongs to.
- `binding` also should not stand alone. Use domain-qualified terms such as `bot binding` or `session binding`.
- `scope` is a different control dimension from `binding`; do not mix the two into one concept name.
- `group` is the canonical shared concept. Do not leak provider-local nouns such as Slack `channel`, and do not promote `supergroup` into shared vocabulary.
- `topic` is not a peer top-level surface beside `group`; it is a nested child surface.

## Model And Boundary Rules

### Core Rule

Do not define a model only by its attributes.

Every significant model must be defined by all of the following:

1. role
2. ownership
3. lifecycle
4. invariants
5. allowed boundaries

### Model Families

**Agent entity**: Canonical operating truth of the system, such as how agents, sessions, workspaces, tools, skills, memory, and subagents relate.

**Persistence model**: What the backend stores durably. It should be deterministic, versioned when needed, migration-friendly, and explicit about canonical ownership.

**Surface contract**: What crosses a channel or control boundary. It does not need to mirror persistence shape exactly.

**Projection**: A read-oriented shape derived from canonical data for a specific use case. It is not canonical truth and must not silently replace the underlying entity model.

**Runner runtime state**: Local execution state required to make a runner usable, such as snapshot cache, inflight stream state, backend connection state, or transient trust-prompt state. It must stay separate from persistence shape and channel DTOs.

**Surface view model**: Render-oriented shape prepared for a channel or control surface. It may simplify rendering, but it stays local to presentation concerns.

### Boundary Rules

**Auth and agents**: Auth policy must not leak into agent entity shape unless the agent layer truly owns that policy.

**Runners and channels**: Runner output must not become user-facing payload automatically. Runners emit normalized backend truth; channels render surface-specific contracts.

**Control and product surfaces**: Operator-facing control payloads must not silently reuse user-facing channel payloads just because they look similar.

### Naming Rules

- Prefer the terms in this file over synonyms.
- Use `principal` for canonical auth identity values in public docs, prompt contracts, and CLI help.
- Do not use `label` for stored identity or surface fields.
- Do not store formatted prompt text in directory records.
- Do not store CLI target syntax in directory records.
- Do not store mention syntax such as Slack `<@U...>` in prompt context or directory records.
- If a field stores the canonical auth identity format generally, prefer `principal`.
- If a field stores the identity of the current message sender, prefer `senderId`.
- If a field is a raw platform id, prefer `providerId`.
- If a field is a canonical clisbot route or surface id, prefer `surfaceId`.
- If a field is only for a human to read, prefer `displayName`.

Recommended model name patterns:

- `AgentEntity`
- `SessionEntity`
- `WorkspaceEntity`
- `RunnerSnapshot`
- `ChannelMessageDto`
- `ControlViewModel`
- `RuntimeState`
- `SelectionState`

### Model Change Review

Before introducing or changing a model, answer these questions:

1. What layer does it belong to?
2. What truth is it representing?
3. Who owns this field canonically?
4. Is this field stored, derived, projected, or transient?
5. Can this object exist in partial form?
6. If partial, how is that state represented in the type system?
7. Which system is allowed to emit it?
8. Which code is responsible for mapping it into another layer?

When a model needs to change:

1. identify which model family it belongs to
2. identify the real owner boundary
3. decide whether the change belongs to the entity, persistence model, surface contract, projection, or runtime state
4. only then change fields or names

### Invariant Discipline

Every major model family should document at least:

- identity invariants
- parent-child or ownership invariants
- derived-field invariants
- mutation ownership invariants
- serialization invariants
