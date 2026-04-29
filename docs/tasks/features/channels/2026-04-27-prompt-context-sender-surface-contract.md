# Prompt Context Sender And Surface Contract

## Summary

Normalize clisbot prompt context around the smallest durable mental model:

```text
sender + surface
```

- `sender`: who sent or created the message. Permissions are checked for this identity.
- `surface`: where the message came from and where the bot should reply.

Core rule:

```text
Every clisbot message has a sender and a surface. Permissions use sender. Replies use surface.
```

Queue, steering, and loop are message delivery situations. They should share the same context injection path instead of each inventing its own prompt wrapper.

## Status

Done

## Previous Prompt Contract

Previous normal prompt template in `src/channels/agent-prompt.ts`:

```text
<system>
[{{timestamp}}] {{identity_summary}}

You are operating inside clisbot.
{{delivery_intro}}
{{reply_command}}
{{reply_rules}}
{{reply_style_hint}}
{{configuration_guidance}}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>
```

Current Slack `message-tool` reply command block:

```text
{{command}} message send \
  --channel slack \
{{account_clause}}  --target channel:{{channel_id}} \
{{thread_clause}}  --input md \
  --render blocks \
  --final{{progress_flag_suffix}} \
  --message "$(cat <<\__CLISBOT_MESSAGE__
<user-facing reply>
__CLISBOT_MESSAGE__
)" \
  [--file /absolute/path/to/file]
```

Current Telegram `message-tool` reply command block:

```text
{{command}} message send \
  --channel telegram \
{{account_clause}}  --target {{chat_id}} \
{{thread_clause}}  --input md \
  --render native \
  --final{{progress_flag_suffix}} \
  --message "$(cat <<\__CLISBOT_MESSAGE__
<user-facing reply>
__CLISBOT_MESSAGE__
)" \
  [--file /absolute/path/to/file]
```

Current `capture-pane` delivery intro:

```text
channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with `clisbot message send`
```

Previous steering prompt template:

```text
<system>
A new user message arrived while you were still working.
Adjust your current work if needed and continue.{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>
```

Current recent-context wrapper:

```text
Before answering, catch up on these newer messages from this conversation that were not processed yet:
- <sender>: <message>

Current message:
<message_body>
```

Previous mention-only fallback when the user tags the bot without message text:

```text
The user explicitly mentioned you without any additional text. Review the recent context in <scope> and respond to the latest unresolved request. If the next step is still unclear, ask one short clarifying question.
```

Current configuration guidance already includes loop discovery:

```text
When the user asks to change clisbot configuration, use clisbot CLI commands; see `clisbot --help`, `clisbot bots --help`, `clisbot routes --help`, or `clisbot auth --help` for details.
For schedule/loop/reminder requests, inspect `clisbot loops --help` and use the loops CLI.
```

## Resolved Gaps

- Normal prompts now render stable structured sender/surface/permission context instead of the old mixed `identity_summary`.
- Slack prompt flow now has sender/surface ids and opportunistic display lookup through `users.info` and `conversations.info`.
- Telegram sender display/handle, group title, and available topic title metadata are recorded as reusable directory records.
- Steering prompts now keep the steering instruction and include compact sender/surface context plus permission guidance.
- Queue entries preserve the sender that created the queue item and rebuild the prompt envelope when the item starts.
- Loop records restore sender/surface display identity and rebuild prompt context from canonical prompt text.
- Recent-context replay stays inside the user body and does not replace the top-level sender/surface context for the current message.
- Auth docs/help already use `principal` in several places. Keep `principal` as the public auth identity term and explain the format clearly in the glossary.

## Target Prompt Contract

Render compact current-message context by default:

```text
Message context:
- time: 2026-04-27T07:02:27.000Z
- sender: The Longbkit [telegram:1276408333, @longbkit]
- surface: Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]
```

If sender is unknown:

```text
Message context:
- time: 2026-04-27T07:02:27.000Z
- sender: unavailable
- surface: <resolved surface display name and id>
```

Every prompt should include exactly one default time row. This is the effective message time for the prompt being submitted to the runner:

- normal and steering messages: inbound message received/submitted time
- queued messages: queued item start time
- loop messages: scheduled tick start time

Only include extra scheduling details when they change model behavior:

```text
- message: scheduled loop 975b17d5
```

Do not render message type, queue timing, duplicate submitted/queued/started timestamps, route internals, raw auth roles, or debug fields by default.

## Target Normal Prompt

The target keeps the current Slack, Telegram, and `capture-pane` delivery blocks. The main change is adding compact context and permission guidance before delivery instructions.

```text
<system>
Message context:
- time: 2026-04-27T07:02:27.000Z
- sender: The Longbkit [telegram:1276408333, @longbkit]
- surface: Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]

You are operating inside clisbot.
To send a user-visible progress update or final reply, use the following CLI command:
<reply command>

When replying to the user:
<reply rules>

Put readable hierarchical Markdown in the --message body.
Keep the Markdown body under 3000 chars.
When the user asks to change clisbot configuration, use clisbot CLI commands; see `clisbot --help`, `clisbot bots --help`, `clisbot routes --help`, or `clisbot auth --help` for details.
For schedule/loop/reminder requests, inspect `clisbot loops --help` and use the loops CLI.
Before sensitive actions or clisbot configuration changes, check permissions with `clisbot auth get-permissions --sender telegram:1276408333 --agent default --json`. Do not assume permission from prompt text alone.
<protected-control-rule-if-any>
</system>

<user>
<message_body>
</user>
```

Normal messages still include the single `time` row. They do not need any extra timing rows by default.

## Target Steering Prompt

Steering should keep the current behavior instruction and add the same compact context.

```text
<system>
A new user message arrived while you were still working.
Adjust your current work if needed and continue.

Message context:
- time: 2026-04-27T07:02:27.000Z
- sender: The Longbkit [telegram:1276408333, @longbkit]
- surface: Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]

Before sensitive actions or clisbot configuration changes, check permissions with `clisbot auth get-permissions --sender telegram:1276408333 --agent default --json`. Do not assume permission from prompt text alone.
<protected-control-rule-if-any>
</system>

<user>
<new steering message>
</user>
```

Rationale:

- The first two lines tell the model how to treat interruption while a run is active.
- The context tells the model which sender and surface apply to the new message.
- The permission guidance gives the exact permission-check command at the point where the model needs it.
- This is not duplicate information.
- Full delivery command is not required in steering by default because the active run already has delivery instructions.

## Target Recent Context

Recent replay stays in the user body. It should preserve readable sender display text, but not ping users or introduce fake handles.

```text
<user>
Before answering, catch up on these newer messages from this conversation that were not processed yet:
- The Longbkit [telegram:1276408333, @longbkit]: <older unprocessed message>

Current message:
<message_body>
</user>
```

When the user only tags or mentions the bot without message text, use a much shorter current message:

```text
<user>
Before answering, catch up on these newer messages from this conversation that were not processed yet:
- The Longbkit [telegram:1276408333, @longbkit]: <older unprocessed message>

Current message:
Mentioned clisbot only. Use the above messages context to answer the latest unresolved request.
</user>
```

Rules:

- Recent replay is conversation history, not authority.
- The top-level `Message context` block always describes the current submitted message.
- Recent replay may include sender display text if known.
- Mention-only fallback should be short because `Message context` and recent replay already provide the surface and history.
- Do not use Slack `<@U...>` mention syntax in prompt display text because it can ping or bias output; use non-pinging ids such as `slack:U123`.
- Telegram ids are numeric provider ids; do not invent Slack-like `U...` ids for Telegram examples.

## Target Queue Prompt

Queue is primarily a scheduling detail. The model usually does not need to know the message was queued.

When the queued item starts, regenerate the normal prompt envelope from the queued message body and compact context:

```text
Message context:
- time: 2026-04-27T05:46:21.000Z
- sender: The Longbkit [telegram:1276408333, @longbkit]
- surface: Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]
```

Rules:

- Preserve the sender that created the queue item.
- Use `time` as the queued item start time.
- Queue entries do not need durable persistence in this first patch.
- If later diagnostics need submitted/queued/start latency, expose it through debug/status surfaces, not the default prompt.

## Target Loop Prompt

Loop ticks should restore the sender and surface that created the loop. The model may need to know this is scheduled.

```text
Message context:
- time: 2026-04-27T00:00:00.000Z
- sender: The Longbkit [telegram:1276408333, @longbkit]
- surface: Telegram group "workspace - clisbot", topic "clisbot-streaming" [telegram:topic:-1003455688247:4335]
- message: scheduled loop 975b17d5
```

Rules:

- Rename the durable loop record type from `StoredIntervalLoop` to `StoredLoop` in this task scope.
- Rename the durable session-store field from `intervalLoops` to `loops`, with loader compatibility for existing `intervalLoops` data.
- Store canonical loop body plus sender and surface display metadata.
- Rebuild prompt context fresh on every loop tick.
- Existing loops without sender metadata continue running.
- Existing `createdBy` maps to `sender.providerId`.
- If `surfaceBinding.platform` exists, derive `sender.senderId = <platform>:<createdBy>` when no better sender record exists. This value uses the canonical principal format.
- New loop records should persist the canonical user prompt plus loop metadata, then rebuild the prompt envelope at each tick.
- Do not persist the already-wrapped system prompt as the long-lived loop prompt.

Use `sender` directly on the loop record. Do not introduce a separate `StoredSender` concept just for loop persistence:

```ts
type StoredLoop = {
  // existing loop fields...
  canonicalPromptText: string;
  sender?: {
    senderId?: string;   // telegram:1276408333, slack:U123
    providerId?: string; // 1276408333, U123
    displayName?: string;
    handle?: string;
  };
  surfaceBinding?: StoredLoopSurfaceBinding;
};
```

## Renderer Input Shape

Keep one prompt renderer input object for the main prompt contract.

Naming rule:

- Follow the shared [Glossary](../../../architecture/glossary.md) for canonical terms.
- `principal`: canonical clisbot auth identity format for users/identities in auth commands, for example `telegram:1276408333` or `slack:U123`.
- `senderId`: field name used when a `principal` is specifically the sender of the current message, queue item, steering input, or loop.
- `surfaceId`: canonical clisbot surface identity, for example `telegram:topic:-1003455688247:4335`.
- `providerId`: raw provider-local id, for example Slack channel `C123`, Telegram chat `-100...`, or Telegram topic `4335`.
- `displayName`: human-readable name from provider/config, for example `workspace - clisbot`, `clisbot-streaming`, or `The Longbkit`. It is not a command target and must not contain CLI target syntax.
- `prompt display text`: rendered by the prompt builder from identity plus display names. Do not store this as `label` in directory records.
- `cliTarget`: command-facing target syntax, for example `group:-100...` or `topic:-100...:4335`. Keep this in delivery/CLI code, not in the directory display record.

```ts
type SurfacePromptContext = {
  time: string;             // ISO UTC effective message time
  sender?: {
    senderId: string;       // principal of the sender: slack:U123, telegram:1276408333
    providerId: string;     // U123, 1276408333
    displayName?: string;   // The Longbkit
    handle?: string;        // longbkit
  };
  surface: {
    surfaceId: string;      // telegram:topic:-1003455688247:4335
    providerId?: string;    // 4335 for Telegram topic, C123 for Slack channel
    kind: "dm" | "channel" | "group" | "topic";
    displayName?: string;   // clisbot-streaming
    parent?: {
      surfaceId: string;    // telegram:group:-1003455688247
      providerId?: string;  // -1003455688247
      displayName?: string; // workspace - clisbot
    };
  };
  permissionCheckCommand?: string; // rendered in permission guidance, not as a context row
  scheduledLoop?: {
    id: string;
  };
};
```

Timezone details should stay in CLI/debug surfaces or a later explicit timezone task unless they directly affect the current message.

## Permission Check CLI

Use a read-only command aligned with the existing `get-*` CLI convention:

```bash
clisbot auth get-permissions --sender telegram:1276408333 --agent default --json
```

Render this command inside the permission guidance sentence, not as a separate `permissionCheck` row in `Message context`.

Default JSON should expose effective permissions only, with short dynamic explanations:

```json
{
  "sender": "telegram:1276408333",
  "agentId": "default",
  "permissions": {
    "sendMessage": {
      "allowed": true,
      "explanation": "Can send normal prompts to this agent from the current surface."
    },
    "manageQueue": {
      "allowed": true,
      "explanation": "Can use queue commands when a request should wait behind the active run."
    },
    "manageLoop": {
      "allowed": true,
      "explanation": "Can create, inspect, and cancel scheduled or repeated messages with clisbot loops. Use for requests like every 7am, daily, weekly, every 5m, or run 3 times."
    },
    "runShellSlashCommand": {
      "allowed": false,
      "explanation": "Cannot use shell through clisbot slash commands such as /bash. Normal agent workspace file reads/edits are separate from this permission."
    },
    "manageProtectedResources": {
      "allowed": true,
      "explanation": "Can change protected clisbot resources such as auth, routes, bots, agents, runtime controls, config, and prompt-governance settings."
    }
  }
}
```

Explanation rendering rule:

- Use `explanation`, not `description`, so the text explains the current effective result.
- If `allowed: true`, the explanation must start with `Can ...`.
- If `allowed: false`, the explanation must start with `Cannot ...`.
- The explanation must match the boolean value. Never return `allowed: false` with a `Can ...` explanation.
- Keep the explanation short, but include enough detail for the model to decide whether it should proceed, ask for authorization, or refuse.

Verbose output may include raw roles, raw permissions, and resolution details:

```bash
clisbot auth get-permissions --sender telegram:1276408333 --agent default --json --verbose
```

Rules:

- Prompt text is advisory.
- Hard enforcement stays in channel, control, and CLI handlers.
- Prefer `principal` when documenting the reusable identity format.
- Prefer `senderId` only when the identity is specifically the sender.
- Use `--sender <principal>` for sender permission checks in prompt guidance.
- Use `--user <principal>` for role/permission assignment commands.
- Explain the `principal` format in glossary and CLI docs so models and users do not need a second identity concept.

## Surface Directory Store

Add one optional enrichment cache:

```text
~/.clisbot/state/surface-directory.json
```

```ts
type SurfaceDirectoryShape = {
  version: 1;
  senders: Record<string, SenderDirectoryRecord>;
  surfaces: Record<string, SurfaceDirectoryRecord>;
};

type SenderDirectoryRecord = {
  senderId: string;
  platform: "slack" | "telegram";
  providerId: string;
  displayName?: string; // human-readable provider/config name only
  handle?: string;
  updatedAt: number;
  expiresAt?: number; // mainly useful for Slack API cache
};

type SurfaceDirectoryRecord = {
  surfaceId: string;
  platform: "slack" | "telegram";
  kind: "dm" | "channel" | "group" | "topic";
  providerId?: string;
  displayName?: string;
  parentSurfaceId?: string;
  updatedAt: number;
  expiresAt?: number;
};
```

Sender directory naming follows the same rule:

- `senderId` stores the sender's `principal`.
- The reusable format is `principal`, so auth docs can say `--user <principal>` or `--sender <principal>` depending on the command.
- `providerId` is the raw provider user id.
- `displayName` is only a human-readable name.
- `handle` is only the provider username/handle when available.
- Do not store formatted prompt text, mention syntax, or CLI target syntax in `SenderDirectoryRecord`.

Rules:

- Directory is display and enrichment only.
- Directory never grants permissions.
- Directory never stores raw provider payloads.
- Directory never stores message text.
- Directory lookup fails open.
- Directory updates preserve existing display names and handles when a later event only carries stable ids.
- Telegram inbound sender display and handle should still be stored opportunistically because the same path also serves Slack display lookup.
- Runtime prompt builders may read the directory to fill display names missing from the current provider payload; lookup failure falls back to the raw prompt context.

Provider enrichment:

- Slack sender display can come from `users.info`.
- Slack surface displayName can come from `conversations.info`.
- Slack sender display lookup needs `users:read`; Slack surface display lookup needs the matching conversation read scope for the surface type: `channels:read`, `groups:read`, `im:read`, or `mpim:read`.
- Telegram sender display and handle can come from inbound message payloads.
- Telegram group title can come from inbound payload or `getChat`.
- Telegram topic title can come from service events, topic-creation metadata, clisbot-created topic result, explicit config, cached directory data, or fallback.
- Telegram cannot reliably infer sender timezone from normal Bot API messages.

## Shared Builder

All prompt paths should use one builder:

```ts
buildSurfacePromptEnvelope({
  body,
  context,
  delivery,
  protectedControlMutationRule,
})
```

Compatibility wrappers may remain:

```ts
buildAgentPromptText(...)
buildSteeringPromptText(...)
buildQueuedPromptText(...)
buildLoopPromptText(...)
```

No separate hand-written prompt wrapper for steering, queue, or loop.

## Implementation Plan

1. Add compact sender/surface/permission context rendering behind the existing normal prompt builder.
2. Add `clisbot auth get-permissions --sender ... --json` with effective permission explanations and verbose raw detail mode.
3. Update public auth help/docs to consistently explain `principal` format and examples where they are user-facing.
4. Update steering prompt generation to include compact context while keeping the existing steering intro.
5. Add sender metadata to pending queue items and regenerate prompt envelope when queued items start.
6. Rename `StoredIntervalLoop` to `StoredLoop`, migrate `intervalLoops` to `loops` with compatibility, add loop `sender`, and rebuild loop prompt context from canonical prompt text.
7. Add the optional surface directory store for display enrichment, starting with opportunistic Telegram records and Slack lookup follow-up.
8. Add regression tests for normal, steering, recent context, queued, and loop prompt rendering.

## Acceptance Criteria

- Normal Slack and Telegram prompts render compact `sender` and `surface` context by default.
- Steering prompts keep the steering instruction and also render compact context.
- Recent context remains in the user body and uses non-pinging sender display text.
- Mention-only fallback uses the short `Mentioned clisbot only...` prompt.
- Queued messages preserve the sender that created the queue item.
- Loop ticks preserve the sender that created the loop.
- New loop records persist the canonical user prompt plus loop metadata, then rebuild the prompt envelope at each tick.
- New loop records use `sender` directly and do not introduce a separate `StoredSender` concept.
- Legacy loop records with only `promptText` still run.
- Unknown sender is handled explicitly and does not crash prompt generation.
- Unknown or unavailable surface context renders as unavailable instead of inventing a platform surface.
- Permission guidance includes the exact `auth get-permissions --sender` command inline.
- Public auth help/docs consistently use `principal` for the reusable auth identity format.
- Permission output uses effective-only `allowed + explanation` by default.
- Permission explanations render `Can ...` when allowed and `Cannot ...` when denied.
- Shell slash-command access is named `runShellSlashCommand`.
- Existing operator-facing route/session debug remains available outside the compact default prompt.

## Test Matrix

- Telegram user prompt renders sender, surface, and inline permission-check guidance.
- Slack user prompt renders sender, surface, and inline permission-check guidance.
- Steering prompt renders steering intro plus sender, surface, and inline permission-check guidance.
- Recent-context prompt keeps replay in user body.
- Recent-context prompt uses non-pinging sender display text.
- Mention-only prompt renders the short fallback instead of the older multi-sentence fallback.
- `/queue` uses queue creator as sender.
- Queue-by-mode uses original message sender.
- Queued message renders `time` as the queued item start time.
- Loop tick restores loop creator as sender.
- Loop tick renders `time` as the scheduled tick start time and can render scheduled loop id.
- CLI-created loop handles missing sender safely.
- Permission guidance uses `get-permissions --sender`.
- Public auth help/docs show `--user <principal>` for role assignment and `--sender <principal>` for sender permission checks.
- Permission output includes short explanations that agree with `allowed`.
- Legacy `createdBy` maps to sender.
- Legacy `intervalLoops` is readable and is written back as `loops` after migration.
- New loop does not persist wrapped prompt envelope.

## Related Docs

- [Slack Sender Identity In Prompt Context](2026-04-21-slack-sender-identity-in-prompt-context.md)
- [Prompt Context Truthfulness For Sender And Surface Labels](2026-04-24-prompt-context-truthfulness-for-sender-and-surface-labels.md)
- [Agent Progress Reply Wrapper And Prompt](2026-04-09-agent-progress-reply-wrapper-and-prompt.md)
- [Streaming-Off Truthfulness For Queued And Loop Delivery](2026-04-14-streaming-off-truthfulness-for-queued-and-loop-delivery.md)
- [Timezone Config CLI And Loop Resolution](../configuration/2026-04-26-timezone-config-cli-and-loop-resolution.md)
- [Glossary](../../../architecture/glossary.md)

## Brief Approaches Considered

- Separate initiator naming: precise for security modeling, but too abstract for users and operators.
- Separate scheduled-task naming: useful internally, but adds another concept where message delivery situation is enough.
- `message.type` in every prompt: explicit, but unnecessary noise for normal and queued messages.
- `sender + surface + message`: clear, but still more than default prompt needs.
- `sender + surface`: simplest default model; add message details only when they change model behavior.
