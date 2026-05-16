# Channel Happy Path Matrix

## Purpose

This matrix is the minimum happy-path validation suite for every supported
channel.

Run it when:

- adding or refactoring a channel
- changing channel routing, pairing, owner claim, or auth
- changing shared queue, loop, slash-command, attachment, streaming, final
  settlement, or processing-indicator behavior
- testing a new provider bot before release

The goal is not exhaustive provider QA. The goal is to prove that one real user
can start from a fresh dev bot, get admitted, receive truthful guidance,
exercise normal prompt handling, and use the shared control paths consistently.

## Dev Runtime

Use repo-local dev mode for these tests. Do not wait for an npm release just to
validate a channel fix.

```bash
export CLISBOT_HOME=~/.clisbot-dev
bun run restart
bun run status
```

After startup, use the generated wrapper for operator actions so message-tool
replies and runtime state use the same dev home:

```bash
~/.clisbot-dev/bin/clisbot-dev status
~/.clisbot-dev/bin/clisbot-dev logs --lines 120
```

If the wrapper does not exist yet, start or restart the dev runtime once from
the repo. The wrapper must preserve both `CLISBOT_HOME` and
`CLISBOT_WRAPPER_PATH`.

## Channel Rows

Run every row that applies to the channel:

- Slack: DM, routed shared channel or group, threaded follow-up, attachments,
  live reply editing, assistant status or processing status cleanup.
- Telegram: DM, routed group, routed topic, attachments and media groups,
  typing feedback, topic targeting, streaming on/off.
- Zalo Bot: admitted DM, pairing, inbound media, append-only rendering,
  unsupported streaming-on rejection, typing or equivalent processing feedback.

If a capability is unsupported by a channel, the expected result is a truthful
rejection or omission, not silent mutation. For example, Zalo Bot is append-only
today, so `/streaming on`, `/streaming latest`, and `/streaming all` must not
persist as enabled streaming modes.

## Test 1: Fresh Bot Auto-Claims Owner

Preconditions:

- `CLISBOT_HOME=~/.clisbot-dev`.
- The dev config has no app owner, or a throwaway dev home is used.
- Exactly one channel is enabled with one provider bot.
- The first DM arrives inside `app.auth.ownerClaimWindowMinutes`, default 30
  minutes.

Steps:

1. Start the dev runtime for one channel.
2. DM the bot from the intended owner account with `hi`.
3. Run:

```bash
~/.clisbot-dev/bin/clisbot-dev auth get-permissions --sender <principal> --agent default --json
```

Expected:

- The first DM receives the owner-claim message.
- The owner principal uses the provider user id, not a display name or handle.
- The same DM is admitted normally after the claim.
- `auth get-permissions` shows owner-level permissions for that principal.
- No pairing code is required for the first owner claim path.

## Test 2: Unrouted Guidance Is Useful

Preconditions:

- The bot is present on a supported surface that has not been routed yet.
- For shared surfaces, the provider actually delivers the `/start`, `/status`,
  or `/whoami` event to the bot.

Steps:

1. Send `/start` on the unrouted surface.
2. Send `/status`.
3. Send `/whoami`.

Expected:

- The bot responds with safe setup guidance instead of starting a runner.
- The guidance includes an exact `clisbot-dev routes add ...` command for the
  current surface.
- Surface ids are concrete and provider-truthful:
  - Slack shared surface: `group:<channel-id>`
  - Telegram group: `group:<chat-id>`
  - Telegram topic: `topic:<chat-id>:<topic-id>`
  - Zalo Bot DM: `dm:<provider-user-id>`
- Sensitive commands such as `/bash`, `/transcript`, `/stop`, `/queue`, and
  `/loop` are not advertised as usable on an unrouted surface.

## Test 3: Add A Second Channel Bot With Default Agent

Preconditions:

- One dev runtime is already working for channel A.
- Credentials for channel B are available in env vars or credential files.
- Agent `default` exists.

Steps:

1. Add a second provider bot on channel B and bind it to `default`:

```bash
~/.clisbot-dev/bin/clisbot-dev bots add --channel <channel-b> --bot smoke-b --bot-token <ENV_OR_TOKEN> --agent default --persist
```

For Slack, include both token flags:

```bash
~/.clisbot-dev/bin/clisbot-dev bots add --channel slack --bot smoke-b --app-token <ENV_OR_TOKEN> --bot-token <ENV_OR_TOKEN> --agent default --persist
```

2. Add the route needed for the channel B test surface.
3. Restart the dev runtime.
4. Send `Reply with exactly B-OK and nothing else.` through channel B.

Expected:

- `bots list` shows both provider bots.
- Channel B uses agent `default` unless the route overrides it.
- Channel B creates or reuses a channel-B session key, not a channel-A session.
- The final user-visible answer contains `B-OK`.

## Test 4: Queues Match Normal Prompt Settlement

Preconditions:

- One routed surface is working.
- The channel supports the shared queue path.

Steps:

1. Start a prompt that keeps the runner busy.
2. While it is busy, create a queue item from the CLI:

```bash
~/.clisbot-dev/bin/clisbot-dev queues create --channel <channel> --target <route> --sender <principal> queued cli check
```

3. While it is busy, create a queue item from chat:

```text
/queue queued slash check
```

4. Run queue list and status for the same route.
5. Wait for both queued prompts to settle.

Expected:

- CLI-created and slash-created queue items enter the same durable session
  queue.
- Queue-start notifications are standalone channel messages.
- Queue-start notifications do not become the editable streaming draft.
- Final settlement uses the same rules as normal prompt handling:
  - a fresh message-tool final after prompt execution start wins
  - progress-only message-tool replies do not suppress pane-derived final
    fallback
  - no extra `Done` or runner chrome appears after a canonical final reply
- Append-only channels do not post duplicate progress bubbles while a queued
  prompt runs.

## Test 5: Loops Work From CLI And Slash Command

Preconditions:

- One routed surface is working.
- The sender principal has permission to manage loops for the target route.

Steps:

1. Create an interval loop from CLI:

```bash
~/.clisbot-dev/bin/clisbot-dev loops create --channel <channel> --target <route> --sender <principal> 5m smoke loop
```

2. In chat, send `/loop status`.
3. In chat, send `/loop 3 loop slash smoke`.
4. Run scoped CLI status.
5. Cancel the test loop from chat or CLI.

Expected:

- CLI and slash commands use the same parser semantics where their syntax
  overlaps.
- Loop-start notifications are standalone and obey `--loop-start` or route
  defaults.
- Loop-created prompts inherit normal prompt rendering and final settlement.
- Count loops reserve durable queue items for the same routed session.
- Cancellation output includes a usable exact cancel command or confirms the
  matching scoped cancel.

## Test 6: Slash Command Inventory

Preconditions:

- One routed surface is working.
- The sender has the permissions needed for the commands under test, or the
  expected result is an auth denial.

Steps:

1. Send `/help`, `/status`, and `/whoami`.
2. Send `/followup status`, `/mention`, `/pause`, and `/resume`.
3. Send `/streaming status`, `/streaming off`, and the channel-supported
   streaming-on variant.
4. Send `/responsemode status` and `/additionalmessagemode status`.
5. Send `/transcript`, `/stop`, `/new`, `/attach`, `/detach`, `/watch`, and
   `/nudge` where the channel and route support visible validation.
6. Send `/bash pwd` only when the test principal has `shellExecute`.

Expected:

- Reserved clisbot slash commands are handled by clisbot, not forwarded to the
  native agent CLI.
- Unsupported or unauthorized commands fail with a clear user-visible message.
- Non-reserved native CLI slash commands still pass through to the agent.
- Slack slash-like commands remain reachable with the documented leading-space
  or backslash workaround when native Slack slash command routing would steal
  `/...`.

## Test 7: Messages And Attachments Across Surface Kinds

Preconditions:

- Each supported surface kind for the channel is routed:
  - DM
  - group or shared channel when supported
  - topic or thread when supported
- The mapped workspace is writable.

Steps:

1. Send a text-only message.
2. Send one attachment with caption text.
3. Send one attachment without text.
4. Send multiple attachments in one user action when the provider supports it.
5. Repeat in each surface kind.

Expected:

- Every admitted message reaches the intended session key for its surface kind.
- Attachments are saved under `.attachments/<sessionKey>/<messageId>/...`.
- The prompt includes `@/absolute/path` mentions before user text.
- File-only messages still produce a usable prompt.
- Slash commands with attachments preserve command semantics. For `/queue`, the
  queued prompt includes the attachment path mentions.
- Multiple provider messages that belong to one user media group become one
  interaction when the provider exposes reliable grouping metadata.

## Test 8: Streaming Modes

Preconditions:

- One routed surface is working.
- The channel capability for live reply update is known.

Steps:

1. Set streaming off through chat and route CLI, then run a prompt.
2. Set streaming on, latest, or all when supported, then run a prompt that
   produces visible progress.
3. Return streaming to the route's desired default.

Expected:

- `off` produces no intermediate visible draft before the final answer.
- Edit-capable channels keep one live reply updated instead of posting a new
  progress reply for every update.
- Append-only channels reject unsupported live update modes without mutating
  route config.
- The final answer remains chat-first and uses the same settlement rules as
  non-streaming prompt handling.

## Test 9: Processing Indicator Lifecycle

Preconditions:

- One routed surface is working.
- The channel has at least one processing indicator surface:
  - Slack reaction, assistant status, or live reply status
  - Telegram typing
  - Zalo Bot typing or equivalent feedback

Steps:

1. Send a prompt that runs long enough for the indicator to appear.
2. Observe indicator state while the run is active.
3. Let the run complete.
4. Repeat with `/detach` or an interaction that enters detached sparse-follow
   mode.
5. Restart the dev runtime and confirm stale indicators are cleared where the
   provider exposes a clear API.

Expected:

- Indicator activation never blocks prompt execution.
- Indicator send/edit/clear failures are logged as channel-local failures, not
  runner failures.
- Indicators clear on terminal completion and on detached sparse-follow.
- Restart cleanup clears stale provider-visible status when supported.
- The channel does not leave `Working...`, typing, reactions, or assistant
  status visible after `Active runs: none`.

## Completion Criteria

For a channel happy-path pass:

- `bun run status` or `clisbot-dev status` shows the channel active.
- The routed smoke prompt has a clean final reply.
- Owner claim or pairing/admission is verified for at least one DM.
- Unrouted guidance has been verified for at least one shared or unknown
  surface where the provider supports it.
- CLI and slash queue paths both settle with the same final-rendering rules.
- CLI and slash loop paths both use the same session target.
- Attachments work for every supported surface kind.
- Streaming and processing-indicator behavior matches the provider capability.
