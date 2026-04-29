# Official Zalo Bot Platform Channel MVP

## Summary

Implement `zalo-bot` as the first official Zalo provider in `clisbot`.

This slice should feel architecturally similar to Telegram:

- token-based bot credentials
- polling-first startup
- optional webhook mode
- DM and group routing

But it must preserve Zalo-specific limits and behavior:

- `2000`-character outbound limit
- no topic/thread model
- group triggers gated by mention or reply rules

## Status

Ready

## Why

`zalo-bot` is the cleanest Vietnam-ready official path:

- official platform
- self-serve onboarding
- closest fit with the current `clisbot` channel architecture
- lower risk than `zalo-personal`

## Scope

- add a first-class `zalo-bot` provider family
- support one or many bots under `bots.zaloBot`
- support DM routing
- support group routing with explicit policy and trigger gates
- support text send
- support photo send
- support polling by default
- support webhook as an optional mode
- support operator `clisbot message --channel zalo-bot ...`
- update status, startup, help, template, docs, and tests

## Non-Goals

- Zalo OA
- unofficial personal-account automation
- streaming-on-by-default
- fake Telegram parity for features Zalo does not expose

## Product Rules

- canonical provider id: `zalo-bot`
- default transport: polling
- optional transport: webhook
- default DM safety posture: pairing or allowlist, not open
- default group posture: fail closed
- default streaming posture: `off`

## Config Shape

Add a new root:

```jsonc
{
  "bots": {
    "zaloBot": {
      "defaults": {
        "enabled": false,
        "defaultBotId": "default",
        "mode": "polling",
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "requireMention": false,
            "policy": "pairing"
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "requireMention": true,
            "policy": "open"
          }
        }
      },
      "default": {
        "enabled": true,
        "name": "default",
        "botToken": "${ZALO_BOT_TOKEN}",
        "directMessages": {},
        "groups": {}
      }
    }
  }
}
```

Per-bot fields should include:

- `botToken`
- `credentialType`
- `mode: polling|webhook`
- `webhookUrl`
- `webhookSecret`
- `webhookPath`
- `directMessages`
- `groups`

## File Plan

## Cross-cutting files

- `src/config/schema.ts`
  - add `bots.zaloBot.defaults`
  - add `ZaloBotConfig` schema
  - add route defaults and webhook settings
- `src/config/channel-bots.ts`
  - add `ResolvedZaloBotConfig`
  - add `ZaloBotCredentialConfig`
  - add:
    - `listZaloBotBots(...)`
    - `resolveZaloBotBotId(...)`
    - `getZaloBotRecord(...)`
    - `resolveZaloBotConfig(...)`
    - `resolveZaloBotDirectMessageConfig(...)`
- `src/config/template.ts`
  - add commented `bots.zaloBot` template
- `src/config/load-config.ts`
  - extend `materializeChannels` and runtime loading to include `zalo-bot`
- `src/channels/channel-plugin.ts`
  - extend runtime channel typing if needed for `zalo-bot`
- `src/channels/registry.ts`
  - register `zaloBotChannelPlugin`
- `src/control/runtime-health-store.ts`
  - add `zalo-bot` channel key
  - add `markZaloBotFailure(...)`
  - add Zalo-specific startup diagnostics
- `src/control/message-cli.ts`
  - allow `--channel zalo-bot`
  - update help and examples
- `src/control/bots-cli.ts`
  - allow `--channel zalo-bot`
  - support add/get/set-default/set-credentials/get-dm-policy/get-group-policy

## Provider files

- `src/channels/zalo-bot/plugin.ts`
  - `zaloBotChannelPlugin`
  - `resolveZaloBotReplyTarget(...)`
- `src/channels/zalo-bot/api.ts`
  - `callZaloBotApi(...)`
  - `getZaloBotMe(...)`
  - `getZaloBotUpdates(...)`
  - `setZaloBotWebhook(...)`
  - `deleteZaloBotWebhook(...)`
  - `getZaloBotWebhookInfo(...)`
  - `sendZaloBotMessage(...)`
  - `sendZaloBotPhoto(...)`
- `src/channels/zalo-bot/message.ts`
  - `parseZaloBotUpdate(...)`
  - `getZaloBotUpdateSkipReason(...)`
  - `hasZaloBotMention(...)`
  - `isReplyToZaloBot(...)`
  - `isZaloBotOriginatedMessage(...)`
- `src/channels/zalo-bot/route-config.ts`
  - `resolveZaloBotConversationRoute(...)`
- `src/channels/zalo-bot/session-routing.ts`
  - `resolveZaloBotConversationTarget(...)`
- `src/channels/zalo-bot/content.ts`
  - `resolveZaloBotMessageContent(...)`
  - MVP target: safe plain/native text, not rich formatting promises
- `src/channels/zalo-bot/transport.ts`
  - `chunkZaloBotText(...)`
  - `postZaloBotText(...)`
  - `postZaloBotPhoto(...)`
  - `reconcileZaloBotText(...)`
- `src/channels/zalo-bot/service.ts`
  - `ZaloBotPollingService`
  - `start()`
  - `stop()`
  - `pollLoop()`
  - `handleUpdate(...)`
  - `handleInboundMessage(...)`
  - `runWebhookHandshakeIfNeeded(...)`
- `src/channels/zalo-bot/webhook.ts`
  - `registerZaloBotWebhookHandler(...)`
  - `verifyZaloBotWebhookRequest(...)`
  - `handleZaloBotWebhook(...)`

## Test and doc files

- `test/zalo-bot-plugin.test.ts`
- `test/zalo-bot-route-config.test.ts`
- `test/zalo-bot-session-routing.test.ts`
- `test/zalo-bot-service.test.ts`
- `test/zalo-bot-message-actions.test.ts`
- `test/message-cli.test.ts`
- `test/runtime-summary.test.ts`
- `docs/user-guide/zalo-bot-setup.md`
- `docs/tests/features/channels/zalo-bot-channel-mvp.md`

## Code Flow

## Startup flow

1. `loadConfig()` loads `bots.zaloBot`
2. `registry.ts` returns `zaloBotChannelPlugin`
3. `runtime-monitor` asks plugin `listBots(...)`
4. plugin creates `ZaloBotPollingService`
5. service validates token with `getZaloBotMe(...)`
6. service either:
   - starts long polling
   - or registers webhook mode
7. runtime health reports `active` or `failed`

## Inbound DM/group flow

1. polling or webhook yields raw update
2. `message.ts` parses update and skip reasons
3. dedupe by provider event id
4. `route-config.ts` resolves route for DM or group
5. pairing/allowlist gate runs
6. group trigger gate checks mention or reply-to-bot
7. `session-routing.ts` produces `AgentSessionTarget`
8. prompt text is built and passed to `processChannelInteraction(...)`
9. `transport.ts` posts final chunks back to the same chat

## Outbound operator message flow

1. `clisbot message send --channel zalo-bot ...`
2. `message-cli.ts` calls `zaloBotChannelPlugin.runMessageCommand(...)`
3. plugin resolves bot credentials
4. `transport.ts` sends text or photo
5. `resolveZaloBotReplyTarget(...)` records reply continuity when applicable

## Definition Of Done

- `clisbot start` can boot `zalo-bot`
- one real bot token is validated successfully
- DM inbound and outbound work end to end
- group routing works under the documented trigger rule
- `clisbot message --channel zalo-bot send ...` works
- status and startup health are truthful
- docs, help, and template are updated
- automated coverage exists for config, routing, transport, and startup errors

## Test Contract

Required automated tests:

- config schema and defaulting
- bot resolution and credential source reporting
- polling update parsing
- webhook verification
- DM policy gating
- group trigger gating
- `2000`-char chunking
- photo send request shape
- runtime health failure summary
- message CLI send path

Required live validation:

- create one real bot via the official Bot Platform
- prove DM round-trip
- prove group trigger by mention or reply
- prove photo send
- prove polling mode
- prove webhook mode or explicitly document why it is deferred

## Risks

- official docs still look newer and less mature than Telegram docs
- group interaction may have edge-case rules not obvious from static docs
- webhook payloads and retries must be validated from real traffic, not inferred only from docs

## Related Docs

- [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)
