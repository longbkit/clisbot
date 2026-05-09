# OpenClaw Zalo Paths And Official Zalo Bot Platform

## Summary

This note answers one practical question for `clisbot`:

- if we want Vietnam-ready Zalo support, what are the real integration paths
- what does OpenClaw already prove
- how close is the new official Zalo Bot Platform to Telegram

Short answer:

- there are **three** product paths, not one:
  - `zalo-bot`: the new official Zalo Bot Platform
  - `zalo-oa`: Zalo Official Account, a separate business surface
  - `zalo-personal`: personal-account automation through the unofficial ecosystem
- local OpenClaw source already proves two of those paths:
  - official `zalo` Bot API
  - unofficial `zalouser` personal automation
- the new official `zalo-bot` path is directionally much closer to Telegram than to `zalo-personal`
- it is still **not** a Telegram clone, so `clisbot` should reuse Telegram architecture patterns without pretending the channel contracts are identical

## Scope

This note covers:

- local OpenClaw Zalo source and docs
- the public official Zalo Bot Platform docs available on `2026-04-18`
- the implications for `clisbot` channel strategy

This note does **not** fully research Zalo OA implementation details yet.

## Source Baseline

### Local OpenClaw references

- official bot docs:
  - `openclaw-private/docs/channels/zalo.md`
  - `openclaw-private/extensions/zalo/README.md`
- official bot implementation:
  - `openclaw-private/extensions/zalo/src/channel.ts`
  - `openclaw-private/extensions/zalo/src/monitor.ts`
  - `openclaw-private/extensions/zalo/src/api.ts`
- personal-account docs:
  - `openclaw-private/docs/channels/zalouser.md`
  - `openclaw-private/extensions/zalouser/README.md`
- personal-account implementation:
  - `openclaw-private/extensions/zalouser/src/channel.ts`
  - `openclaw-private/extensions/zalouser/src/monitor.ts`

### Official Zalo Bot Platform references checked on `2026-04-18`

- homepage: `https://bot.zaloplatforms.com`
- create bot: `https://bot.zaloplatforms.com/docs/create-bot`
- polling: `https://bot.zaloplatforms.com/docs/apis/getUpdates`
- webhook:
  - `https://bot.zaloplatforms.com/docs/apis/setWebhook`
  - `https://bot.zaloplatforms.com/docs/apis/deleteWebhook`
  - `https://bot.zaloplatforms.com/docs/apis/getWebhookInfo`
  - `https://bot.zaloplatforms.com/docs/webhook`
- outbound:
  - `https://bot.zaloplatforms.com/docs/apis/sendMessage`
  - `https://bot.zaloplatforms.com/docs/apis/sendPhoto`
  - `https://bot.zaloplatforms.com/docs/apis/sendSticker`
  - `https://bot.zaloplatforms.com/docs/apis/sendChatAction`
- group interaction:
  - `https://bot.zaloplatforms.com/docs/build-bot-interaction-with-group`
  - `https://bot.zaloplatforms.com/docs/build-your-bot-with-webhook`

## What OpenClaw Already Proves

## 1. Official Zalo Bot exists as a real plugin path

Local OpenClaw `extensions/zalo` is an official Bot API integration, not OA and not personal-account automation.

Important signals from source:

- API base is `https://bot-api.zaloplatforms.com`
- methods implemented include:
  - `getMe`
  - `getUpdates`
  - `setWebhook`
  - `deleteWebhook`
  - `getWebhookInfo`
  - `sendMessage`
  - `sendPhoto`
- plugin capability model is:
  - direct messages: supported
  - groups: supported
  - media: supported
  - reactions: not supported
  - threads: not supported
  - native commands: not supported
- outbound text is chunked at `2000` chars
- streaming is blocked by default
- group interaction is mention-gated
- polling and webhook are mutually exclusive

This is already enough evidence that the official Zalo Bot path can fit the existing `clisbot` channel architecture.

## 2. OpenClaw personal Zalo is a different product path

Local OpenClaw `extensions/zalouser` is explicitly:

- unofficial
- based on `zca-cli`
- QR-login personal account automation
- ban-risky

Important correction:

- the local reference implementation here is **not** a direct `zca-js` adapter
- it uses `zca-cli` as the operational seam

That matters for `clisbot` planning:

- `zalo-personal` should be treated as an optional high-risk provider family
- we should not blur it together with the official Zalo Bot Platform

## 3. OpenClaw naming is already trying to keep the paths separate

OpenClaw currently uses:

- `zalo` for official Bot API
- `zalouser` for personal-account automation

That is a good signal.

For `clisbot`, where we know three Zalo families must coexist, the naming should become even more explicit.

## Official Zalo Bot Platform: What The Public Docs Say

## 1. Bot creation is personal-developer friendly

The public create-bot guide currently says:

- bot creation starts from Zalo app
- the user finds OA `Zalo Bot Manager`
- then opens `Zalo Bot Creator`
- the platform sends back a `Bot Token`

Implication:

- the new official bot path is not only an enterprise/OA story
- it is intentionally developer-friendly and self-serve

## 2. The API model is Telegram-like

The public docs currently expose an API set very similar in shape to Telegram Bot API:

- `getMe`
- `getUpdates`
- `setWebhook`
- `deleteWebhook`
- `getWebhookInfo`
- `sendMessage`
- `sendPhoto`
- `sendSticker`
- `sendChatAction`

The docs also say:

- `getUpdates` uses long polling
- `setWebhook` enables webhook delivery
- polling and webhook are mutually exclusive

This is why the right mental model for `zalo-bot` is:

- reuse the **Telegram architectural playbook**
- do **not** reuse Telegram contracts blindly

## 3. Group interaction exists, but is still earlier-stage than Telegram

The public group guide currently says:

- group interaction is still marked with an internal-trial warning
- the bot must first be added to a group
- the bot receives group events when:
  - a user replies directly to a bot message
  - a user mentions the bot
- group reply routing should use `chat.id`

Implication:

- group support is real
- but it should be treated as gated and capability-limited until live validation proves otherwise

## 4. Webhook auth differs from Telegram details

The public docs and OpenClaw source together indicate webhook handling uses:

- `secret_token` during webhook setup
- request verification through header `X-Bot-Api-Secret-Token`

That is close to Telegram in spirit, but still provider-specific in detail.

## 5. Commercial positioning is different from OA

Current public product copy on the Bot Platform site positions it for:

- individuals
- small teams
- business experimentation

A prior source pass on the homepage found public pricing copy indicating:

- a free tier
- up to `3` bots
- up to `50` users per bot
- up to `3000` messages per month
- a stronger enterprise path that points larger business use cases toward Zalo OA

Treat those limits as **product-copy facts, not architecture facts**:

- useful for prioritization
- must be rechecked before launch because pricing text can change without API changes

## Is Official `zalo-bot` Basically Telegram?

## Yes, in the parts that matter for channel architecture

`zalo-bot` is Telegram-like in these important ways:

- token-based bot identity
- one HTTP Bot API base
- long polling path
- webhook path
- simple outbound methods like `sendMessage` and `sendPhoto`
- DM and group chat model

Those similarities strongly suggest:

- `clisbot` should build `zalo-bot` from the same general playbook as Telegram
- the first implementation should start from chat-channel reuse, not from OA abstractions and not from personal-account automation

## No, if we are talking about exact contract parity

Known differences from the current public docs and OpenClaw source:

- OpenClaw types `getUpdates` as returning one update object per call, not a Telegram-style array
- outbound text limit is `2000` chars
- no native thread/topic model is documented
- no reaction model is exposed
- native slash-command style affordances do not exist
- group interaction is mention/reply driven and still looks earlier-stage

So the right conclusion is:

- **Telegram-shaped architecture**
- **Zalo-specific channel contract**

## Implications For `clisbot`

## 1. `clisbot` should model three separate Zalo families

Recommended canonical channel ids:

- `zalo-bot`
- `zalo-oa`
- `zalo-personal`

Why:

- plain `zalo` is ambiguous once three families coexist
- OA, Bot Platform, and Personal have different auth, compliance, event, and growth assumptions
- explicit ids make CLI help, config, docs, and operator debugging much easier to reason about

## 2. Recommended implementation order

Recommended order:

1. `zalo-bot`
2. `zalo-oa`
3. `zalo-personal`

Why:

- `zalo-bot` is the closest to existing Telegram mental models
- `zalo-bot` is official and self-serve
- `zalo-oa` is official but belongs to a different business/compliance track
- `zalo-personal` is unofficial and should stay optional

## 3. `zalo-bot` should be treated as the main Vietnam-ready official path

The current evidence suggests:

- `zalo-bot` is likely the easiest official Zalo path for `clisbot` to ship first
- `zalo-oa` should still exist in the roadmap for enterprise/business distribution
- `zalo-personal` should be clearly labeled as risky and non-default

## 4. `zalo-personal` should start from a seam, not from a dependency bet

Because the local OpenClaw reference uses `zca-cli`, not `zca-js`, the safest `clisbot` recommendation is:

- define a `zalo-personal` adapter seam first
- allow the implementation to start with `zca-cli` parity if that is the fastest truthful path
- leave room to swap to `zca-js` later if library maturity or richer events justify it

This avoids freezing the product plan to one unofficial library too early.

## Working Recommendation

If `clisbot` wants a clean Zalo strategy, the high-level decision should be:

- ship `zalo-bot` first as the main official path
- keep `zalo-oa` as a separate official enterprise/business provider
- keep `zalo-personal` as an optional unofficial provider with explicit risk labeling
- never collapse the three into one fake-common `zalo` config before the differences are proven small enough

## Related Tasks

- [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](../../tasks/features/channels/2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
- [Vietnam Channel Launch Package](../../tasks/features/channels/2026-04-13-vietnam-channel-launch-package.md)

Related research follow-up:

- [Telegram, Zalo Bot, zca-js, And Discord Channel Interface Matrix](./2026-05-08-telegram-zalo-discord-channel-interface-matrix.md)
