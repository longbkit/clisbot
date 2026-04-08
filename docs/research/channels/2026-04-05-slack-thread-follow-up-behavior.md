# Slack Thread Follow-Up Behavior

## Summary

This research captures what Slack actually does for threaded follow-up messages and why that matters for OpenClaw-compatible mention behavior in `muxbot`.

The main verified result from live testing on April 5, 2026 is:

- in a Slack thread started by a human, `parent_user_id` on later replies points to the thread root author, not to the bot that replied later in the thread
- because of that, any Slack implementation that relies only on `parent_user_id === botUserId` is narrower than the user-facing doc claim
- OpenClaw `main` now includes a participant-based fallback cache for Slack thread continuation, while the older `develop` checkout previously inspected did not
- in the current live Slack app setup for `muxbot`, no-mention thread follow-up still does not arrive as a routed inbound `message` event, so delivery is also a separate blocker

## Why This Matters

The product goal is to let Slack threads continue naturally after a bot reply.

That behavior depends on two different truths:

1. what Slack actually sends in event payloads
2. what rule `muxbot` chooses to use for "implicit follow-up" once those events are delivered

If those two are confused, the product can appear correct in docs while behaving differently in the live app.

## Sources

- [OpenClaw Groups Concept](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/groups.md)
- [OpenClaw Slack prepare logic](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/message-handler/prepare.ts)
- [OpenClaw Slack thread resolution](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/thread-resolution.ts)
- [OpenClaw implicit thread-follow-up test](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor.tool-result.sends-tool-summaries-responseprefix.test.ts)
- [muxbot Slack service](../../../src/slack/service.ts)
- [muxbot Slack message helpers](../../../src/slack/message.ts)
- [Slack retrieving messages docs](https://docs.slack.dev/messaging/retrieving-messages/)

## OpenClaw Doc Claim

OpenClaw's group behavior docs say:

- replying to a bot message counts as an implicit mention on Slack

That is the user-facing claim in [groups.md](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/groups.md).

## Historical Note About Source Version

The first pass of this research used a local OpenClaw checkout on `develop`, not the latest `main`.

That older checkout used a narrower Slack rule:

- not a direct message
- `message.thread_ts` exists
- `message.parent_user_id === ctx.botUserId`

That older result is still useful as history, but it is not the latest OpenClaw truth.

## Latest OpenClaw Main Behavior

On latest `main`, OpenClaw's Slack code now computes implicit mention like this:

- not a direct message
- `message.thread_ts` exists
- and either:
  - `message.parent_user_id === ctx.botUserId`
  - or `hasSlackThreadParticipation(account.accountId, message.channel, message.thread_ts)`

This logic was verified against `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09` in `extensions/slack/src/monitor/message-handler/prepare.ts`.

That means current `main` uses a hybrid rule:

- root-author shortcut when the bot started the thread
- participant-cache fallback once OpenClaw has already replied in that thread

So the latest `main` behavior is broader than the older `develop` checkout.

## Second-Pass Source Audit

After switching safely to a separate `origin/main` worktree, the OpenClaw Slack source was checked again to see whether any separate "bot already participated in this thread" path exists outside the `parent_user_id` gate.

The result is:

- there is now a participant-based mention fallback in the OpenClaw Slack path
- it does not scan Slack thread participants from the API at inbound time
- instead, it uses an in-memory sent-thread participation cache keyed by `accountId + channelId + threadTs`
- no `reply_users`-based rule is used
- the cache is explicit and shared across module instances

## What Actually Creates OpenClaw's Current Slack Thread Behavior

The current behavior is created by these separate pieces:

1. event delivery
2. thread classification
3. missing `thread_ts` recovery
4. mention gate
5. session routing
6. reply placement

Those pieces should not be conflated.

### 1. Event Delivery

OpenClaw listens to:

- `app_mention`
- generic `message`

Explicit mentions arrive through `app_mention`.

No-mention thread follow-up can only work if Slack also delivers the routed `message` event for that conversation kind.

Source:

- [OpenClaw Slack event registration](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/events/messages.ts)

### 2. Thread Classification

OpenClaw treats a message as a thread reply when:

- `thread_ts` exists
- and either `thread_ts !== ts`
- or `parent_user_id` exists

So `parent_user_id` is used as a thread-shape hint.

Source:

- [OpenClaw Slack threading helpers](https://github.com/openclaw/openclaw/blob/develop/src/slack/threading.ts)

### 3. Missing `thread_ts` Recovery

If Slack provides `parent_user_id` but omits `thread_ts`, OpenClaw uses `conversations.history` to recover `thread_ts`.

This is only a thread-shape recovery step.

It is not:

- a bot-participant lookup
- an implicit-mention lookup

Source:

- [OpenClaw Slack thread resolution](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/thread-resolution.ts)

### 4. Mention Gate

For Slack channels, OpenClaw computes effective mention from:

- explicit mention
- implicit mention
- authorized control-command bypass

For Slack thread follow-up on latest `main`, implicit mention is:

- not direct message
- `thread_ts` exists
- and either:
  - `parent_user_id === botUserId`
  - or the thread exists in OpenClaw's sent-thread participation cache

This is the actual no-mention unlock rule in the latest mainline source.

Source:

- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/monitor/message-handler/prepare.ts`
- [OpenClaw mention gating helpers](https://github.com/openclaw/openclaw/blob/develop/src/channels/mention-gating.ts)

### 4a. Sent-Thread Participation Cache

Latest `main` records Slack thread participation in an in-memory TTL cache:

- TTL: 24 hours
- max entries: 5000
- key: `accountId:channelId:threadTs`

The cache is written when OpenClaw actually delivers a reply into a Slack thread.

It is then read later by the inbound mention gate so no-mention follow-up can continue in that thread without requiring a fresh `@mention`.

Sources:

- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/sent-thread-cache.ts`
- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/monitor/message-handler/dispatch.ts`
- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/action-runtime.ts`

### 5. Session Routing

Once a message is accepted, OpenClaw gives a thread reply its own thread session key.

Settings such as:

- `thread.historyScope`
- `thread.inheritParent`

affect history and parent-session linkage only.

They do not make no-mention follow-up more permissive.

Sources:

- [OpenClaw Slack prepare logic](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/message-handler/prepare.ts)
- [OpenClaw thread session key logic](https://github.com/openclaw/openclaw/blob/develop/src/routing/session-key.ts)

### 6. Reply Placement

`replyToMode` controls where OpenClaw posts replies:

- root
- first reply in thread
- all replies in thread

This does not affect whether the inbound no-mention follow-up passes mention gating.

Sources:

- [OpenClaw Slack reply dispatch](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/message-handler/dispatch.ts)
- [OpenClaw Slack reply delivery plan](https://github.com/openclaw/openclaw/blob/develop/src/slack/monitor/replies.ts)

## What `conversations.replies` Is Used For In OpenClaw

OpenClaw does use `conversations.replies`, but not for participant-based mention gating.

It is used for:

- loading the thread starter/root message for model context
- reading thread messages in Slack read actions

It is not used for:

- checking live Slack thread participants on inbound delivery
- checking whether the thread has any bot participant via Slack Web API at mention-gate time
- enabling a participant-based no-mention continuation rule

Sources:

- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/monitor/media.ts`
- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/actions.ts`

## Test Coverage Gap In OpenClaw

The current OpenClaw Slack tests do include:

- explicit mention in channels
- thread follow-up where `parent_user_id` is explicitly set to the bot
- sent-thread cache unit coverage

The tests do not appear to include the more important real Slack case:

- human starts thread
- bot replies later in that thread
- human follows up without mention

So even on latest `main`, the test suite still does not appear to prove the real Slack case directly end to end. It proves the cache primitive and the root-author shortcut separately.

Sources:

- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/monitor.tool-result.test.ts`
- OpenClaw `origin/main` commit `acd8966ff054511b541ab1020377055b2694de09`, file `extensions/slack/src/sent-thread-cache.test.ts`

## Live Slack Experiment

Date:

- April 5, 2026

Workspace channel used:

- `SLACK_TEST_CHANNEL = C07U0LDK6ER`

Bot user:

- `U08N4UZM8CF`

Test thread:

- root `ts = 1775370179.069129`

Thread shape:

1. human root message: `TRACE_ROOT_20260405_1 hello`
2. human threaded mention: `<@U08N4UZM8CF> TRACE_MENTION_20260405_1 em`
3. bot threaded reply
4. human threaded follow-up without mention: `TRACE_FOLLOWUP_20260405_1 thời tiết hnay thế nào`

## Verified Slack Data

Using `conversations.replies` against the live thread:

- the root message had `user = U08JJEMUK41`
- the mention reply had `parent_user_id = U08JJEMUK41`
- the bot reply had `parent_user_id = U08JJEMUK41`
- the no-mention follow-up had `parent_user_id = U08JJEMUK41`

This shows that for this real Slack thread:

- `parent_user_id` was the thread root author
- `parent_user_id` was not the bot user even after the bot replied inside the thread

## Conclusion About Slack Payload Semantics

For the tested Slack thread shape, the practical meaning of `parent_user_id` is:

- author of the thread parent/root message

It is not:

- the last visible message above in the UI
- the bot that most recently replied in the thread
- a general "thread already includes bot" signal

## Consequence For OpenClaw

Because latest OpenClaw `main` now includes the sent-thread participation fallback, the current Slack implementation is closer to the user-facing docs than the earlier `develop` checkout suggested.

More specifically:

- if the bot started the thread root, the root-author shortcut can work immediately
- if a human started the thread root and the bot replied later in that thread, the sent-thread participation cache is intended to unlock later no-mention follow-up

However, that behavior is cache-based, not Slack-payload-based.

So the latest OpenClaw `main` does not solve this by proving that `parent_user_id` points to the bot. It solves it by remembering that OpenClaw itself already replied in that thread.

## Consequence For muxbot

`muxbot` should not treat `parent_user_id === botUserId` as the canonical Slack rule for natural thread follow-up.

If `muxbot` wants the product behavior to be:

- once the bot has replied in a thread, later no-mention follow-up in that thread can continue naturally

then the decision rule should be closer to:

- the bot has already participated in this thread

not:

- the bot authored the thread root

That is now aligned with latest OpenClaw `main`, though the mechanisms differ:

- OpenClaw `main`: in-memory sent-thread participation cache
- current `muxbot`: Slack thread participant lookup

## Separate Delivery Finding

The same live experiment also showed a second blocker:

- the explicit mention thread reply reached the app
- the later no-mention thread follow-up did not arrive as a routed inbound `message` event in the current live setup

So there are two separate issues:

1. payload semantics
2. Slack event delivery / subscription setup

Even a correct mention rule cannot work in production if the app never receives the no-mention thread reply event.

## Current Project Guidance

For `muxbot`, the truthful current guidance is:

- keep documenting that implicit no-mention follow-up depends on routed Slack `message.*` delivery
- do not claim that `parent_user_id === botUserId` is the right Slack rule for general thread continuation
- note clearly that the earlier local OpenClaw `develop` checkout was stale for this question
- align discussion with latest OpenClaw `main`, which now uses sent-thread participation caching for Slack follow-up

## Open Questions

- Which exact Slack event subscription combination is still missing in the live app, given that the explicit mention reached the app but the no-mention follow-up did not?
- Should `muxbot` define its product rule as:
  - bot participated anywhere in thread
  - or only bot-authored visible reply anchor
- If the product uses "bot participated in thread", should the thread-participation check be cached exactly once per thread and then trusted until reset?
