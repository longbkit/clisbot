# Typing — the `sync.progress` liveness surface

The "the bot is working" signal, distinct from the relayed text. Two surfaces, and the pinned supply treats them as different things with different lifecycles — read this before writing vertical typing code.

Paths below the install roots: `slack/…` = `@openclaw/slack@2026.7.1`, `main/…` = `openclaw@2026.7.1-2`.

## The two surfaces

|                  | Native typing status                                                                           | Inbound-message reaction                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Slack            | `assistant.threads.setStatus` — "is typing..." + rotating `loading_messages`                   | `reactions.add` / `reactions.remove` on the sender's message |
| Telegram         | `sendChatAction(chat_id, "typing")`                                                            | none                                                         |
| Scope            | Slack: a `thread_ts` only — and a root message's own `ts` is one                               | the message that triggered the turn                          |
| Expiry           | Slack: "until cleared, 2-min cap"; Telegram: ~5s                                               | persists until removed                                       |
| Who refreshes it | Slack: nobody (one set holds past a whole turn); Telegram: the VERTICAL, on its own 4.5s timer | Slack answers `already_reacted` to a re-add                  |

Because the expiry differs per channel, the refresh cannot live in the config or in one Hub-side heartbeat: the Hub drives `start` once per surface and each vertical keeps its own wire alive. Slack's status needs nothing further after the set; Telegram's action lapses in ~5s, so `packages/channels/telegram/src/typing.ts` re-sends on `TELEGRAM_TYPING_REFRESH_MS` until `stop` cancels the timer. The pinned references split the same way: `createTypingCallbacks` beats every 3s for both channels (`main/dist/typing-DnYJejsM.js:10`), which is a wasted call on Slack and the wrong cadence on Telegram.

## Pinned machinery

`createTypingCallbacks` (`main/dist/typing-DnYJejsM.js:15-40`): keepalive `3e3` ms (`:10`), breaker `DEFAULT_MAX_CONSECUTIVE_TYPING_FAILURES = 2` (`:4,18`) whose trip stops the keepalive loop (`:26-28`), TTL `6e4` ms auto-stop (`:19`). The in-repo mirror of the lifecycle half is `packages/hub/src/channels/plane/processing.ts` (`PROCESSING_TTL_MS`, the per-surface refcount, the failure release); the refresh half belongs to each vertical.

The lifecycle the pinned host drives from its ingress pipeline, the Hub drives from the ACCEPTED INBOUND (`bindings/index.ts` opens the lease, `relay/index.ts` keeps it alive and releases it). It is NOT driven from `turn_started`: the plane delivers the prompt before the daemon can report anything, and a fresh session's stream is only subscribed after the create returns, so a surface waiting on that event opens late or never — the bug that made the indicator invisible on both channels.

Telegram's own breaker is looser: `TELEGRAM_MAX_CONSECUTIVE_TYPING_FAILURES = 5` (`main/dist/telegram-ingress-spool-Dd3cDhXe.js:6471`, applied at `:7670`). In-repo a failing drive releases the surface and logs once, so a refused chat is not called again until a new inbound arrives.

## Slack

`setSlackThreadStatus` (`slack/dist/provider-C1-DFSpw.js:278-292`): returns early with no call when there is no `threadTs`; otherwise `assistant.threads.setStatus({channel_id, thread_ts, status, loading_messages})`, `loading_messages` capped at 10. Stop is the same call with `status: ""`. The status text is `"is typing..."` (`slack/dist/channel-BjlsaGHn.js:966`, `slack/dist/pipeline.runtime-rpVpay59.js:927-928`) and the rotation list is `SLACK_TYPING_LOADING_MESSAGES` (`pipeline.runtime-rpVpay59.js:620-625`).

The vendor SWALLOWS failures here (`logVerbose`, `provider-C1-DFSpw.js:293-295`). In-repo does not: a wire fault throws so the Hub's breaker counts it, and a `missing_scope` logs once per account with both ways out. A silently-failing typing call is how a misconfigured app stays misconfigured.

**Scope.** `assistant.threads.setStatus` is served by `chat:write`, which the Hub already requires; `assistant:write` is the compatibility scope Slack still accepts for the assistant surface and what the vendor asks for in its own manifest (`slack/dist/setup-core-fGd6Gquy.js:51-53`). In-repo `assistant:write` is SOFT: `SLACK_OPTIONAL_BOT_SCOPES` (`packages/hub/src/providers/slack/client.ts`) puts it in the generated manifest but keeps it out of `SLACK_REQUIRED_BOT_SCOPES`, because `verifyInstallation` failing an app over a cosmetic surface is worse than the surface being off. `reactions:write` (the reaction) is already required. A `missing_scope` is a setup fact, not a transient fault: it logs once per account naming both ways out (add the scope, or set `sync.progress.typingIndicator: false`) and throws so the surface is released instead of retried.

**Reaction config in the vendor** is a separate key from the status: `channels.slack.typingReaction` / per-account (`docs/channels/slack.md:1204-1215`), an emoji-name string, applied OUTSIDE threads because threads already show the status. In-repo the value is `sync.progress.messageReaction` (`off` | emoji name) and the two leaves are independent rather than mutually exclusive: the indicator answers every turn that has an anchor (thread or not), the reaction is the receipt on the sender's own message.

**The anchor differs from the vendor.** The pinned path derives `threadTs` from the reply thread and returns early without it, so an unthreaded ask gets no status. In-repo falls back to the sender's own message `ts` (`typing.ts` `statusAnchor`), because that is a valid `thread_ts` and it is where Slack renders liveness for a root message — the "bot is working…" line under the ask. A marker id that is not a `ts` (a slash command's synthetic `slash:<ts>:<user>`) has no anchor and stays on the reaction surface.

## Telegram

`sendChatAction(chatId, "typing", buildTypingThreadParams(replyThreadId))` (`main/dist/telegram-ingress-spool-Dd3cDhXe.js:5351-5355`), plus a `record_voice` cue for audio answers (`:5357-5363`).

**The General-topic asymmetry.** `buildTypingThreadParams` (`main/dist/sent-message-cache-BGcQC26h.js:1784-1790`) carries the vendor's own comment: "Empirically, General topic (id=1) needs message_thread_id for typing to appear." A SEND to the forum's General topic must OMIT `message_thread_id` (the Bot API rejects `sendMessage` with `thread_id=1` — `outbound.md`); a TYPING action must INCLUDE it. The two builders are deliberately different functions; do not unify them.

Vendor calls are bounded and retry once on timeout (`docs/channels/telegram.md:820`), and the configured API timeout is clamped below the 60s outbound text/typing guard (`:716`).

## Where the config lives

`defaults.sync.progress` — the group is `{progressMessage, typingIndicator, messageReaction}`, folded per leaf org < account < route, floor `{true, true, "off"}`. It is a `defaults` key, not a `transport` key: `transport` is account-scoped and how the account talks to the provider, while typing is turn behavior that a route must be able to mute. An authored bare boolean (`progress: true`) normalizes to `progressMessage` only, so pre-group revisions keep compiling and gain the indicator from the floor rather than from the legacy leaf.

The group shape also carries a real distinction the old boolean could not express: `outbound.path: tool` folds the relayed TEXT leaves off and leaves the liveness leaves alone (`compile.ts` `toolPathSyncFold`) — a tool turn has less visible text, so the indicator matters more there, not less.
