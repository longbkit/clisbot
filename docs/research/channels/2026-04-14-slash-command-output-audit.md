# Slash Command Output Audit

## Status

Draft review artifact.

For wording and UX review, not implementation-ready copy yet.

## Goal

Aggregate the current slash-command output surface into one place so it can be reviewed quickly for:

- user-friendliness
- conversion
- frictionless operator flow
- alignment with the planned `auth` direction

## Scope

This audit covers current output text and response patterns coming from:

- `src/agents/commands.ts`
- `src/channels/interaction-processing.ts`
- `src/agents/loop-command.ts`
- `src/shared/transcript-rendering.ts`
- `src/agents/active-run-manager.ts`
- `src/channels/telegram/route-guidance.ts`

It includes:

- slash-command help text
- slash-command success and denial messages
- empty-state and usage-error messages
- shared runtime notices that are directly exposed through slash-command flows

It does not yet include:

- operator CLI output outside chat surfaces
- pairing CLI output
- config file comments or README copy

## Topline Findings

### 1. The current surface is still debug-first

The current outputs are useful for developers and operators who already know the architecture, but many messages read like raw config inspection rather than a clean product surface.

Examples:

- `activeRoute.responseMode`
- `config.target`
- `privilegeCommands.allowUsers`
- `activeLoops.global`
- `policy: skip-if-busy`

### 2. The command set mixes three layers of copy

The same chat surface currently mixes:

- end-user control copy
- operator mutation copy
- low-level debug or config inspection copy

That makes `/help` and `/status` feel heavier than they need to be.

### 3. Several outputs still expose the old privilege model

This is the biggest upcoming content conflict.

Current user-visible strings still teach:

- `privilegeCommands.enabled`
- `privilegeCommands.allowUsers`
- `clisbot channels privilege ...`

If the repo is moving toward app-level and agent-level `auth`, these strings should be treated as transitional and likely replaced, not polished in place.

### 4. Success messages are usually precise but not always outcome-led

A lot of replies say what config or runtime field changed, but not always:

- why the user should care
- whether the change is immediate
- whether it affects only this conversation, this route, or the whole app

### 5. `/loop` is powerful but currently too dense for chat UX

The feature is strong, but the help and error surface is carrying too much syntax, too many modes, and too much internal policy detail in one message.

## Recommended Review Lens

For each command, the main review question should be:

1. what was the user trying to do
2. did the reply confirm the outcome in plain language
3. did it clearly tell them the next useful action
4. did it avoid leaking architecture terms unless the user explicitly asked for debug detail

## Audit By Surface

### `/start` and unrouted Telegram onboarding

Current output patterns:

```text
clisbot: this Telegram group is not configured yet.

Ask the bot owner to choose one of these:

Add the whole group with the default agent:
`clisbot channels add telegram-group <chatId>`

Add the whole group with a specific agent:
`clisbot channels add telegram-group <chatId> --agent <id>`
```

Topic routes also add:

```text
Add only this topic with a specific agent:
`clisbot channels add telegram-group <chatId> --topic <topicId> --agent <id>`
```

When not showing config-path detail, it ends with:

```text
After that, routed commands such as `/status`, `/stop`, `/nudge`, `/followup`, and `/bash` will work here.
```

What works:

- Concrete next steps exist.
- The route shape is explicit for group versus topic.

Friction:

- `bot owner` is not defined.
- The message assumes the reader is an operator.
- It jumps straight into CLI without first clarifying what is happening in product terms.
- It does not yet reflect the upcoming owner-claim or `auth` model.

Suggested direction:

- Start with a product-facing sentence first:
  `This chat is not connected to clisbot yet.`
- Then split the flow:
  `If you manage this bot...`
  `If you do not manage this bot...`
- Replace `bot owner` with the future auth term once that model is real.

### `/help`

Current output pattern:

- one long flat list
- mixes onboarding, runtime control, queueing, automation, and privileged shell access
- ends with `Other slash commands are forwarded to the agent unchanged.`

What works:

- Coverage is broad.
- The list is precise.

Friction:

- Too long for chat scanning.
- Too much jargon in a first-help surface.
- Advanced config commands sit next to everyday commands with equal weight.
- `/streaming`, `/responsemode`, and `/additionalmessagemode` look more like internal operator controls than common end-user controls.

Suggested direction:

- Group by intent:
  `Basics`
  `Run control`
  `Message handling`
  `Automation`
  `Admin / operator`
- Keep default `/help` shorter.
- Move full expert detail into either `/help admin`, `/help advanced`, or a separate operator guide.

### `/status`

Current output pattern includes:

```text
clisbot status

platform: `...`
conversationKind: `...`
agentId: `...`
sessionKey: `...`
streaming: `...`
response: `...`
responseMode: `...`
additionalMessageMode: `...`
verbose: `...`
timezone: `...`
followUp.mode: `...`
followUp.windowMinutes: `...`
run.state: `...`
privilegeCommands.enabled: `...`
privilegeCommands.allowUsers: `...`
activeLoops.session: `...`
activeLoops.global: `...`
```

It then appends a `Useful commands:` section and operator commands for privilege setup.

What works:

- Very good as a raw debug dump.
- Useful for developers and operators.

Friction:

- Too much internal state for a default status surface.
- Important information is not prioritized.
- Old privilege-model wording is embedded directly in the reply.
- `Useful commands` duplicates `/help`.
- The current shape does not separate:
  conversational status
  route config
  auth state
  debug identity

Suggested direction:

- Split into layers:
  `Status summary` by default
  `Debug details` only when requested later
- Put user-visible outcome first:
  which agent
  whether the route is active
  whether a run is active
  whether transcript and admin actions are allowed
- Remove or replace `privilegeCommands.*` wording as part of the `auth` rollout.

### `/whoami`

Current output pattern:

```text
Who am I

platform: `...`
conversationKind: `...`
agentId: `...`
sessionKey: `...`
senderId: `...`
channelId: `...`
chatId: `...`
threadTs: `...`
topicId: `...`
privilegeCommands.enabled: `...`
privilegeCommands.allowUsers: `...`
verbose: `...`
```

For unrouted Telegram chats it also shows:

```text
routed: `no`
```

plus the route setup guidance block.

What works:

- Useful for debugging route identity.
- Helpful for operators collecting ids.

Friction:

- The title sounds user-facing, but the content is almost entirely debug-facing.
- It leaks old privilege terminology.
- The core user question is usually:
  `Which bot/agent am I talking to, in which route?`
  The current reply buries that answer among raw ids.

Suggested direction:

- Keep this command, but make the default message more compact.
- Start with:
  current agent
  route type
  whether the route is configured
- Put raw identifiers under a `Debug ids` subsection.

### `/transcript`

Current deny output:

```text
Transcript inspection is disabled for this route.
Set `verbose: "minimal"` on the route or channel to allow `/transcript`.
```

Current success output pattern:

```text
clisbot
agent: <agentId>
session: <sessionName>
workspace: <workspacePath>
status: completed
note: transcript command

[snapshot body rendered in a fenced code block]
```

What works:

- The command is explicit.
- The snapshot is useful for debugging or inspecting long-running work.

Friction:

- `Transcript inspection` sounds formal and slightly awkward.
- The denial message teaches internal config shape instead of user outcome.
- The success header is verbose and machine-like for a chat surface.

Suggested direction:

- Prefer `Current session snapshot` over `transcript inspection`.
- Denial copy should eventually reference auth and route policy in product terms, not `verbose: "minimal"`.
- Keep a compact header and only show deeper fields when really needed.

### `/attach`, `/detach`, `/watch`

Current related output patterns:

```text
Detached this thread from live updates. clisbot will still post the final settlement here when the run completes.
```

```text
This thread was not attached to an active run.
```

Shared busy-session guidance:

```text
This session already has an active run. Use `/attach`, `/watch every 30s`, or `/stop` before sending a new prompt.
```

Shared long-run detached guidance:

```text
This session has been running for over <label>. clisbot will keep monitoring it and will post the final result here when it completes. Use `/attach` to resume live updates, `/watch every 30s` for interval updates, or `/stop` to interrupt it.
```

Optional extension:

```text
You can also use `/transcript` to inspect the current session snapshot.
```

What works:

- The next-step guidance is strong.
- `/attach`, `/watch`, and `/stop` are presented as a coherent set.

Friction:

- The phrase `final settlement` is accurate internally but not natural product copy.
- The surface assumes users understand the distinction between live updates and final result delivery.
- `/watch every 30s` is hard-coded into multiple messages.

Suggested direction:

- Replace `final settlement` with `final reply` or `final result`.
- Standardize the trio as:
  `resume live updates`
  `check in periodically`
  `stop the run`
- Consider whether the hard-coded `30s` example should remain copy or become runtime-config-aware later.

### `/stop`

Current outputs:

```text
Interrupted agent `<agentId>` session `<sessionName>`.
```

```text
Agent `<agentId>` session `<sessionName>` was not running.
```

What works:

- Clear and direct.

Friction:

- Slightly too session-internal for a common chat action.
- Does not clarify whether this affects only this conversation or a shared route.

Suggested direction:

- Keep it short, but bias toward the user outcome:
  `Stopped the current run for this conversation.`
- Leave agent and session identifiers for optional debug detail.

### `/nudge`

Current outputs:

```text
Sent one extra Enter to agent `<agentId>` session `<sessionName>`.
```

```text
No active or resumable session to nudge for agent `<agentId>`.
```

What works:

- Technically precise.

Friction:

- The action is not self-explanatory to most users.
- `nudge` is product-facing, but the response explains only the terminal primitive.

Suggested direction:

- Keep the command name.
- Improve the outcome text:
  `Sent one extra Enter to the current run in case it was waiting for confirmation.`
- For the empty case:
  `There is no active run to nudge in this conversation.`

### `/followup`

Current status output pattern:

```text
Follow-up policy

- mode: `...`
- runtime override: `...`
- default mode: `...`
- follow-up window: `... minutes`
- last bot reply: `<timestamp or never>`
```

Current mutation outputs:

```text
Follow-up policy reset to route defaults for this conversation.
```

```text
Follow-up paused for this conversation until the next explicit mention.
```

```text
Follow-up mode set to `<mode>` for this conversation.
```

What works:

- The command family is coherent.
- The per-conversation scope is explicit.

Friction:

- `policy`, `override`, and `defaults` are still operator-ish terms.
- `mention-only` and `paused` are not explained in conversational language.

Suggested direction:

- Keep the state model, but rewrite status in plain behavior terms:
  whether reply-in-thread works
  whether a mention is required
  how long the follow-up window stays open
- Add one short example line per mode.

### `/streaming`

Current status output pattern:

```text
clisbot streaming mode: `<mode>`

config.target: `<label>`

Available values:
- `off`: do not show live surface preview updates
- `on`: slash-command shorthand that persists as `all`
- `all`: keep streaming enabled with the current full preview behavior
- `latest`: keep streaming enabled; current runtime behavior still matches `all` until preview shaping is refined
```

Current mutation output pattern:

```text
Updated streaming mode for `<label>`.
config.streaming: `<value>`
config: `<path>`
`/streaming on` persists as `all` until `latest` and `all` diverge in runtime behavior.
```

What works:

- Honest about current behavior.
- Good for implementers.

Friction:

- This is deeply implementation-facing.
- `all` versus `latest` is not yet user-meaningful.
- `config.target` is not intuitive.

Suggested direction:

- If this remains a chat command, it should read as an expert operator command.
- Otherwise, hide it from default `/help`.
- Use a short operator framing:
  `This controls preview updates while the agent is working.`

### `/responsemode`

Current status output pattern:

```text
clisbot response mode

activeRoute.responseMode: `<value>`
config.target: `<label>`
config.responseMode: `<value>`

Available values:
- `capture-pane`: clisbot posts pane-derived progress and final settlement
- `message-tool`: clisbot still monitors the pane, but the agent should reply with `clisbot message send`
```

Current mutation output pattern:

```text
Updated response mode for `<label>`.
config.responseMode: `<value>`
config: `<path>`
If config reload is enabled, the new mode should apply automatically shortly.
```

What works:

- Accurate and transparent.

Friction:

- Strongly implementation-specific.
- `capture-pane` and `message-tool` are architecture terms, not user goals.
- This feels like operator config, not a common in-channel action.

Suggested direction:

- Treat this as expert operator surface.
- Keep exact terms if needed, but present them as advanced modes.
- Do not let this dominate normal `/help`.

### `/additionalmessagemode`

Current status output pattern:

```text
clisbot additional message mode

activeRoute.additionalMessageMode: `<value>`
config.target: `<label>`
config.additionalMessageMode: `<value>`

Available values:
- `steer`: send later user messages straight into the already-running session
- `queue`: enqueue later user messages behind the active run and settle them one by one

Per-message override:
- `/queue <message>` always uses queued delivery for that one message
```

Current mutation output pattern:

```text
Updated additional message mode for `<label>`.
config.additionalMessageMode: `<value>`
config: `<path>`
If config reload is enabled, the new mode should apply automatically shortly.
```

What works:

- The actual behavioral distinction is meaningful.

Friction:

- The command name is long and low-conversion.
- The output still leads with config fields instead of user behavior.

Suggested direction:

- Center the explanation on the user outcome while the bot is busy.
- Preserve `queue` and `steer` as the key decision.
- Consider whether the long command name needs an alias later, even if the config key stays verbose.

### `/queue`, `/steer`, `/queue-list`, `/queue-clear`

Current usage-error outputs:

```text
Usage: `/queue <message>` or `\q <message>`
```

```text
Usage: `/steer <message>` or `\s <message>`
```

Current list and empty-state outputs:

```text
Queue is empty.
```

```text
Queued messages

1. <message>
queuedAt: `<timestamp>`
```

Current clear outputs:

```text
Cleared 2 queued messages.
```

```text
Queue was already empty.
```

Shared queued runtime output:

```text
Queued.
```

or:

```text
Queued: 2 ahead.
```

What works:

- The runtime acknowledgment is compact.
- The command family is fairly intuitive.

Friction:

- `/queue-list` is functional but dry.
- `queuedAt` is precise but not very review-friendly in chat.
- `/queue-clear` does not remind the user it only affects the current session queue.

Suggested direction:

- Keep the short queued acknowledgment.
- Make list and clear replies more scope-aware:
  `for this conversation`
- Consider humanizing timestamps later if that becomes important.

### `/loop`

Current output surface includes:

- long help lines in `/help`
- parse errors
- usage block
- started messages
- status list
- cancellation replies
- maintenance-mode errors for missing `LOOP.md`

Representative parse-error copy:

```text
Loop requires an interval, count, or schedule. Try `/loop 5m check CI`, `/loop 3 check CI`, `/loop every day at 07:00 check CI`, or `/loop 3` for maintenance mode.
```

```text
For interval loops, `--force` must appear immediately after the interval, for example `/loop 1m --force check CI`.
```

Representative started reply:

```text
Started loop `loop123` every 2h.
prompt: custom
maxRuns: `...`
policy: `skip-if-busy`
activeLoops.session: `...`
activeLoops.global: `...`
cancel: `/loop cancel loop123`
The first run starts now.
```

Representative status reply:

```text
Active loops

activeLoops.session: `1`
activeLoops.global: `3`

- id: `loop123` interval: `2h` remaining: `...` nextRunAt: `<timestamp>` prompt: `...`
```

Representative cancellation replies:

```text
Cancelled loop `loop123`.
```

```text
Cancelled 2 active loops across the whole app.
```

```text
Multiple active loops exist for this session. Use `/loop cancel <id>` or `/loop cancel --all`.
```

What works:

- Very explicit.
- Good coverage across many modes.
- Error messages usually include a next action.

Friction:

- Too much syntax density for a chat-first command.
- `policy: skip-if-busy`, `activeLoops.global`, and raw timestamps skew operator/debug-heavy.
- The app-wide cancel path is especially sensitive and deserves stronger wording once auth exists.

Suggested direction:

- Split `quick usage` from `full syntax`.
- Keep start replies short by default:
  what was scheduled
  when it runs
  how to cancel
- Relegate counters and global totals to debug detail.
- Make app-wide cancellation copy clearly privileged once auth lands.

### `/bash`

Current usage-error output:

```text
Usage: `/bash <command>` or a configured bash shortcut such as `!<command>`
```

Current denial output:

```text
Privilege commands are not allowed for this route or user.
Enable `privilegeCommands.enabled` on the route to allow bash commands. Use `privilegeCommands.allowUsers` to restrict access to specific user ids.
```

It then appends operator commands such as:

```text
clisbot channels privilege enable ...
clisbot channels privilege allow-user ...
clisbot channels privilege disable ...
clisbot channels privilege remove-user ...
```

Current success output pattern:

```text
Bash in `<workspacePath>`
command: `<command>`
exit: `<code>`

[command output rendered in a fenced text block]
```

What works:

- The execution reply is straightforward.
- The denial message is actionable for the current legacy model.

Friction:

- This is the clearest place where old privilege copy will conflict with future `auth`.
- The denial path assumes the viewer is allowed to see operator remediation commands.
- The success header is fine, but it still reads like a raw tool dump.

Suggested direction:

- Treat `/bash` as an explicitly privileged action in docs and output.
- Replace legacy `privilegeCommands` wording once auth exists.
- Consider different denial copy for:
  regular user
  operator lacking the right role
  route not enabled

## Cross-Cutting Runtime Notices

These are not standalone slash commands, but they materially affect slash-command UX.

Current patterns:

```text
Working...
```

```text
Timed out waiting for visible output.
```

```text
Completed with no new visible output.
```

```text
Queued.
```

```text
Queued: 2 ahead.
```

What works:

- Short.
- Consistent across platforms.

Friction:

- The copy is neutral but not especially helpful.
- `Completed with no new visible output.` is truthful, but not particularly friendly.

Suggested direction:

- Keep truthfulness first.
- Slightly improve tone and actionability where possible.

## Main Convergence Recommendation

The cleanest long-term path is not to polish every current string in place.

Instead, converge the slash-command surface into three intentional layers:

### 1. Default user-facing chat control

Focus on:

- what happened
- what the bot will do next
- what the user can do next

Avoid raw config keys here.

### 2. Operator chat control

Focus on:

- route-level settings
- conversation-level overrides
- add or remove access
- guided remediation

This is where advanced commands such as `/streaming`, `/responsemode`, `/additionalmessagemode`, and privileged `/loop` operations belong if kept in chat.

### 3. Debug and architecture detail

Focus on:

- ids
- config paths
- raw state fields
- implementation terms

This should be opt-in rather than the default tone of `/status`, `/whoami`, and deny flows.

## Priority Rewrite Order

### P0

- Replace old `privilegeCommands` wording in user-facing slash output as part of the `auth` rollout.
- Rework unrouted onboarding and privileged denial flows first.

### P1

- Refactor `/help`, `/status`, and `/whoami` to separate summary from debug detail.
- Rewrite `/loop` replies to reduce syntax and policy density.

### P2

- Reword `/followup`, `/streaming`, `/responsemode`, and `/additionalmessagemode` into clearer operator language.
- Polish empty states and low-signal replies such as queue lists and no-output settlements.

## Bottom Line

The current slash-command output surface is already functional and fairly truthful, but it is still closer to an internal operator shell than a polished chat product surface.

The main next step is not just wording cleanup. It is to decide which messages are:

- normal user guidance
- operator control
- debug detail

Once that boundary is clear, the copy can become much more user-friendly, conversion-focused, and low-friction without losing truthfulness.
