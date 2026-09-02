# `gateway.startAccount(ctx)`

> Host integration update, 2026-09-01: the pinned vertical's token entry contract below remains
> supply evidence, but the active Hub host no longer resolves `secretRef`. It injects credentials
> decrypted from canonical Hub Connections. See
> [the credential/Application/Connection audit](../2026-09-01-hub-credential-application-connection-gaps.md).

## The flat account

Slack (`slack/dist/channel-BjlsaGHn.js:1050-1068`) reads off `ctx.account`: `accountId`, `botToken?.trim()`, `appToken?.trim()`, `config.mediaMaxMb`, `config.slashCommand`. Telegram (`main/dist/channel-DP5CkqKN.js:1148-1228`) reads `accountId`, `token` (via `resolveTelegramAccount`'s merge + `findTelegramTokenOwnerAccountId`), and `config.{timeoutSeconds, proxy, network, apiRoot, webhook*}`. Both read off `ctx`: `log?.info`, `cfg`, `runtime`, `channelRuntime`, `abortSignal`, `setStatus`, `getStatus`. `ctx.cfg` must be truthy — `requireRuntimeConfig` throws on a falsy cfg (`main/dist/plugin-config-runtime-DqLEI0ep.js`).

So `ctx.account` is the flat token carrier (`{accountId, botToken, appToken}` for Slack; `{accountId, token}` for Telegram; `config: {}` is enough for P0), **and** `cfg.channels.<ch>.accounts.<id>` must carry the token strings too, because the outbound send path and Telegram's account resolution read tokens from `cfg`, not from `ctx.account` (Slack `resolveSlackAccount` → `configBot = resolveSlackBotToken(merged.botToken, …)`, `slack/dist/accounts-BOJJiHSr.js`; Telegram `resolveTelegramToken` → `accountCfg?.botToken`, `main/dist/token-STZofCO6.js`).

## Token source

The `TELEGRAM_BOT_TOKEN` / `SLACK_*` env fallbacks apply only to the account id `default` (Telegram `:560`); P0 account ids are non-default, and a non-default Telegram id with a missing entry in a non-empty `accounts` object refuses the channel-level fallback (`token: ""`, source `"none"`). So tokens come exclusively from the 0600 mirror-secret file at the account's `secretRef` path (`http/operations.ts` `mirrorOperatorSecret` writes the operator secret verbatim): JSON `{botToken, appToken}` for Slack, `{botToken}` for Telegram (impl doc §2 / §4.3.5 table). Read it at drive time, never from process env.

## `cfg` requirements

- `cfg.channels.<ch>.accounts.<id>` holds **exactly one** account entry. Telegram's `findTelegramTokenOwnerAccountId` (`main/dist/channel.setup-CPOcyH3J.js`) scans every account (`listTelegramAccountIds` + `inspectTelegramAccount` each) and **throws** on a duplicate token — a stray second entry fails the account at drive time.
- The token strings: `botToken` (both channels; the key name is `botToken` in the config even though the flat ctx field is `token` for Telegram).

## Promise lifetime

Both startAccount promises resolve only when `abortSignal` fires (the native monitors `waitForAbortSignal`), so "start" is the transport lifetime; stop = abort. Telegram `stopAccount` (`channel-DP5CkqKN.js:1232-1238`) and `probeAccount` (`:1071`) also read `account.token`.

## Telegram pre-monitor flow (runs before the host monitor)

`startAccount` → `findTelegramTokenOwnerAccountId` (the duplicate-token guard above) → probe `resolveTelegramProbe()(token, timeout, {accountId, proxyUrl, network, apiRoot, includeWebhookInfo: false})` → `writeStartupBotInfoCache({accountId, token, botInfo})` → `resolveTelegramMonitor()({token, accountId, config: ctx.cfg, runtime: ctx.runtime, channelRuntime: ctx.channelRuntime, abortSignal: ctx.abortSignal, useWebhook, webhook*, botInfo, setStatus})` (`:1213-1228`). `resolveTelegramMonitor()` is the host-override read site (`:555-556`, see `telegram-monitor.md`). `writeStartupBotInfoCache` writes through the keyed-store seam (`telegram.bot-info-cache` namespace, TTL 86400000, `main/dist/state-migrations-DYbWXxuv.js:42-48, 78-93`), not to a native path.
