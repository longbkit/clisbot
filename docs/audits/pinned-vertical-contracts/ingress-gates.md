# Ingress gate stack — bot-stamped markers are dropped before the Hub seam

The pinned verticals admit inbound messages through **their own gate stack, inside the vendor dist, before the Hub seam is reached**. The stack is bot-stamping gates (`allowBots` / self-bot), sender-allowlist gates (owner presence in the conversation config), and mention gating. A marker message stamped by the bot under test itself is dropped by that stack **by default** on both channels — it never reaches `onInboundReply`, the Hub's inbound pipeline. Live E2E must therefore drive inbound with a _different_ sender (a user credential on Slack, the master bot on Telegram — see CLAUDE.md "Required Slack and Telegram E2E roles").

## Slack (pinned `@openclaw/slack@2026.7.1`)

The whole stack runs inside `slack/dist/pipeline.runtime-rpVpay59.js` in `prepareSlackMessage` and only after it passes does the message become the seam payload:

- **Bot-stamping gate.** `isBotMessage = Boolean(message.bot_id)`; `allowBotsMode` resolves `channelConfig?.allowBots ?? account.config?.allowBots ?? cfg.channels?.slack?.allowBots ?? false` → `"off"` by default (`:2928, :2938`). `authorizeSlackInboundMessage` (`:2942-2951`): a bot-stamped message with `allowBotsMode === "off"` is dropped (`slack: drop bot message … (allowBots=false)`) and the message returns `null` out of `prepareSlackMessage` (`:3004-3008`) — before `buildChannelInboundEventContext` (`:3480`). So `chat.postMessage` with the bot token is dropped by default; even with `allowBots` enabled the sender must additionally pass the room users allowlist (`authorizeSlackBotRoomMessage`, `slack/dist/provider-C1-DFSpw.js:952`, call site `:3256`) and, in `mentions` mode, explicitly mention the bot (`:3264-3269`).
- **Sender-allowlist gate (owner presence).** DMs: `authorizeSlackDirectMessage` against the resolved `allowFrom` (`:2969, :2976`). Rooms: `ctx.isChannelAllowed` (`:2961`). A bot-stamped marker whose sender is not in the configured allowlists is dropped here regardless of `allowBots`.
- **Mention gate.** `channelRequireMention` defaults to true (`:3052`); when `activationAccess.shouldSkip` the room message is skipped (`:3305-3311`). Unmentioned `slack-cli` traffic is ignored — the plane sees nothing.

Only after all of this does the vertical call `dispatchChannelInboundReply` (`:1792`, imported from `openclaw/plugin-sdk/channel-inbound`, `:29`) — the aliased seam the Hub routes to `hostRuntime.onInboundReply` (`loader-routing.md`).

## Telegram (pinned `openclaw@2026.7.1-2`)

The native gate stack lives in `main/dist/telegram-ingress-spool-Dd3cDhXe.js`:

- **Self-bot drop.** `normalizedMsg.from.id === ctx.me.id` → the update is discarded (`:4281`), same for channel-post senders (`:4319`).
- **Sender-allowlist gate (owner presence).** `shouldSkipGroupMessage` (`:2860`) enforces the per-group/topic policy via `evaluateTelegramGroupPolicyAccess` — `groupPolicy: allowlist` drops any sender id not in the allowlist (`:2906-2918`).
- **Mention gate.** `resolveInboundMentionDecision` (`main/dist/mention-gating-3P8aSD7o.js`, call site `:4504`); `requireMention` defaults to true in groups (`:5425-5427`) and an unaddressed group message is skipped (`:4532-4535`).

**The spool never loads in the Hub.** Pinned Telegram runs the host-owned monitor instead (`telegram-monitor.md`, option A), so the vendor stack above is inert for the Hub. The effective pinned-Telegram admission is the host monitor's own stack: `packages/hub/src/channels/loader/hosts/telegram-monitor.ts` drops the bot-under-test's own updates by id (`:249`) and empty-body updates (`:256`) before building the `ctxPayload` and before `hostRuntime.onInboundReply` (`:263`). Net effect is the same on both pinned verticals: **a marker posted by the bot under test itself is never inbound to the Hub.**

## The in-repo gate stack (live since the 2026-08-26 pull)

With the pull (`packages/channels/*`, `docs/audits/2026-08-26-in-repo-channel-verticals.md` §3 + §6.5) the gate stack is **re-implemented in Hub-owned code**; the pinned dists are sync references, not supply, and no loader alias-route is applied to the pulled verticals (§6.5 rule 1). The stack now splits across three owners:

- **L3, shared** (`packages/channels/shared/src/monitor.ts`): own-message drop (`isOwnMessage` or sender === botId), empty-body drop, in-flight + durable-ledger dedupe, then the `onInboundReply` handoff.
- **L2, per-channel transports**: Slack (`packages/channels/slack/src/transport/socket-event-filter.ts`) drops app/team-mismatched envelopes and computes the mention / own-message facts; Telegram (`packages/channels/telegram/src/transport/poll.ts`) flags own messages (sender id = the bot under test's id) and computes the mention fact.
- **Mention gating is NOT in L2/L3.** `WasMentioned` is a fact the L3 passes through in the `ctxPayload`; the policy is the Hub plane's route matching + fallback (`packages/hub/src/channels/bindings/index.ts`, `requireMention` / `mentionedBot`). One policy layer, on the Hub side.

**What gets dropped is a Hub design decision, not vendor-pinned behavior** — the self-drop of the bot under test's own messages is a Hub-written invariant instead of a dist gate. The live-E2E rule (external sender ≠ bot under test) carries over unchanged, because it is a property of the channels, not of the gates. The pinned-dist line refs above remain the historical reference for the vendor-pinned behavior this replaced.
