# Glossary

## Status

Working architecture reference

## Purpose

Keep one shared vocabulary for clisbot architecture, code, docs, prompts, CLI help, and task specs.

Use this file before introducing a new concept name. If an existing term fits, reuse it. If a new term is required, add it here with ownership and boundaries before spreading it across code or docs.

## Core Terms

| Term | Meaning | Owner / Boundary |
| --- | --- | --- |
| `sender` | The human or system identity that submitted, queued, steered, or created the message. Permissions are checked against sender. | Channels capture it; auth consumes it; agents may persist it for queue/loop continuity. |
| `surface` | The place where a message arrives and replies render, such as Slack channel/thread, Telegram group/topic, DM, or future API conversation. | Channels own surface presentation and reply targeting. |
| `message` | One submitted user input or generated scheduled input. | Channels receive messages; agents queue or run them. |
| `session` | One durable conversation owned by clisbot. | Agents own session continuity. |
| `sessionKey` | Stable clisbot-side session identity. | Agents persistence. |
| `sessionId` | Current runner-side conversation identity. | Runners provide it; agents store it for continuity. |
| `run` | One active execution for one session. | Agents/run lifecycle. |
| `runner` | Backend executor boundary, such as tmux running Codex, Claude, or Gemini. | Runners. |
| `queue` | Ordered pending messages for one session. | Agents. |
| `loop` | Scheduled or repeated message tied to a session/surface. | Agents own schedule state; channels supply surface context for delivery. |
| `steering` | A new user message injected while a run is still active. | Channels detect it; agents/runners submit it to the active run. |

## Update Terms

| Term | Meaning | Owner / Boundary |
| --- | --- | --- |
| `update` | Preferred public term for installing a newer `clisbot` package and restarting the runtime. | Control CLI and release docs. |
| `manual migration` | Operator action required during an update beyond install, restart, status, and release-note review. | Migration docs only. |

Use `update` in public CLI help, folder names, release docs, and operator-facing wording. Avoid `upgrade` for this product concept unless quoting old history or external tooling.

## Identity Terms

| Term | Meaning | Example | Do Not Use For |
| --- | --- | --- | --- |
| `principal` | Canonical clisbot auth identity format for a user or identity that can receive roles/permissions. This is the value accepted by auth commands such as `--user`, and by sender checks such as `--sender` when that identity is the message sender. | `telegram:1276408333`, `slack:U123` | Human display text, provider display name, CLI route target, English word `principle`. |
| `senderId` | The message-context field that stores the sender's `principal`. Use this only when the identity is specifically the sender of a message, queue item, steering input, or loop. | `telegram:1276408333`, `slack:U123` | General auth command docs, non-sender role assignment concepts. |
| `providerId` | Raw provider-local id. | Slack user `U123`, Slack channel `C123`, Telegram chat `-100...`, Telegram topic `4335` | Auth principal, clisbot surface id. |
| `displayName` | Human-readable name from provider/config. | `The Longbkit`, `workspace - clisbot`, `clisbot-streaming` | CLI target, auth principal, formatted prompt text. |
| `handle` | Provider username/handle without mention formatting. | `longbkit` | Auth principal, display name, Slack mention syntax. |
| `sender display text` | Prompt-rendered text assembled from sender fields. | `The Longbkit [telegram:1276408333, @longbkit]` | Stored directory field, auth principal. |

## Principal Format

`principal` is the stable auth identity string used in config and auth CLI commands.

Format:

```text
<platform>:<provider-user-id>
```

Supported platform prefixes:

- `telegram`: Telegram user id. Example: `telegram:1276408333`.
- `slack`: Slack user id. Example: `slack:U123ABC456`.

Rules:

- Telegram principal ids are numeric user ids, not handles. Use `telegram:1276408333`, not `telegram:@longbkit`.
- Slack principal ids are Slack user ids, normally `U...` or `W...`, not display names or `<@U...>` mention syntax.
- Principal strings are platform-scoped. `telegram:1276408333` and `slack:U123ABC456` are different identities unless explicitly linked by later auth features.
- Use `principal` for auth identity values in public docs and CLI help.
- Use `senderId` only when that principal is specifically the sender in a message context.
- `principal` is the auth term; `principle` is the English word for a rule or belief and should not be used as a field/concept name.

## Surface Terms

| Term | Meaning | Example | Do Not Use For |
| --- | --- | --- | --- |
| `surfaceId` | Canonical clisbot surface identity. | `telegram:topic:-1003455688247:4335`, `slack:channel:C123` | Human display text, CLI command target syntax. |
| `surfaceKind` | Shape of the surface. | `dm`, `channel`, `group`, `topic` | Provider-specific type names unless mapped. |
| `parentSurfaceId` | Canonical parent surface for nested surfaces such as topics or threads. | `telegram:group:-1003455688247` | Reply target by itself when child targeting is required. |
| `surface display text` | Prompt-rendered text assembled from surface fields. | `Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]` | Stored directory field, CLI target. |
| `cliTarget` | Command-facing target syntax used by clisbot CLI. | `group:-100...`, `topic:-100...:4335`, `channel:C123` | Directory display fields, provider ids, auth principal. |

## Model Suffixes

| Suffix | Meaning |
| --- | --- |
| `Record` | Durable serialized storage shape. |
| `State` | Owned lifecycle state. |
| `Input` | Caller-provided payload. |
| `Context` | Prompt/rendering input assembled for a specific use. |
| `Binding` | Stored link to an external surface or runner target needed later. |
| `Result` | Stable returned outcome. |

## Naming Rules

- Prefer terms in this glossary over synonyms.
- Use `principal` for canonical auth identity values in public docs, prompt contracts, and CLI help.
- Do not use `label` for stored identity or surface fields. Use `displayName` for human-readable provider/config names, or render explicit prompt display text at the boundary.
- Do not store formatted prompt text in directory records.
- Do not store CLI target syntax in directory records.
- Do not store mention syntax such as Slack `<@U...>` in prompt context or directory records.
- If a field stores the canonical auth identity format generally, prefer `principal`.
- If a field stores the identity of the current message sender, prefer `senderId`.
- If a field is a raw platform id, prefer `providerId`.
- If a field is a clisbot canonical route/surface id, prefer `surfaceId`.
- If a field is only for a human to read, prefer `displayName`.
