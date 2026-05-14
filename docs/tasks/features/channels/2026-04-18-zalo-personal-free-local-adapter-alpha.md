# Zalo Personal Free Local Adapter Alpha

## Summary

Implement `zalo-personal` as an optional unofficial alpha provider using only free local dependencies.

This task should start with an adapter seam, not with a hard dependency bet on one library.

## Status

Planned

## Why

`zalo-personal` is still useful for power users and edge cases, but it must stay:

- clearly unofficial
- clearly separated from official Zalo providers
- free to run locally

## Hard Constraint

`zalo-personal` must not depend on paid third-party packages or paid relay services.

Disallowed:

- paid SDKs
- paid SaaS browser/session relays
- paid device farms
- any required vendor subscription for normal operation

Allowed:

- free open-source libraries
- free local binaries such as `zca-cli` if license and maintenance are acceptable
- local Playwright/Puppeteer flows if ever needed
- local QR-login and local session persistence

## Scope

- define a free local adapter seam for personal Zalo automation
- ship one alpha backend behind that seam
- support login/session readiness
- support DM and group routing
- support text send
- support one truthful operator setup flow
- document risk and recovery clearly

## Non-Goals

- pretending this path is official or low-risk
- requiring a paid dependency
- baking one unofficial backend choice so deeply that it cannot be replaced

## Recommended backend stance

Phase 1 should prefer a free local backend such as `zca-cli`, because:

- local OpenClaw reference already proves it
- it avoids inventing a new unsupported stack immediately
- it keeps the first alpha concrete and reviewable

But the architecture should preserve backend replacement.

## Config Shape

Add a new root:

```jsonc
{
  "bots": {
    "zaloPersonal": {
      "defaults": {
        "enabled": false,
        "defaultBotId": "default",
        "backend": "zca-cli"
      },
      "default": {
        "enabled": true,
        "name": "default",
        "backend": "zca-cli",
        "profile": "default",
        "directMessages": {},
        "groups": {}
      }
    }
  }
}
```

## File Plan

## Cross-cutting files

- `src/config/core/schema.ts`
  - add `bots.zaloPersonal.defaults`
  - add backend/profile config
- `src/config/channels/channel-bots.ts`
  - add `ResolvedZaloPersonalConfig`
  - add:
    - `listZaloPersonalBots(...)`
    - `resolveZaloPersonalBotId(...)`
    - `getZaloPersonalRecord(...)`
    - `resolveZaloPersonalConfig(...)`
- `src/config/core/template.ts`
  - add `bots.zaloPersonal` template section
- `src/config/core/load-config.ts`
  - extend runtime loading for `zalo-personal`
- `src/channels/catalog/registry.ts`
  - register `zaloPersonalChannelPlugin`
- `src/control/runtime/runtime-health-store.ts`
  - add `zalo-personal` channel key
  - add `markZaloPersonalFailure(...)`
- `src/control/commands/message-cli.ts`
  - allow `--channel zalo-personal`
- `src/control/commands/bots-cli.ts`
  - allow `--channel zalo-personal`
  - if login flow needs CLI support, add a dedicated login/status sub-surface

## Provider files

- `src/channels/zalo-personal/plugin.ts`
  - `zaloPersonalChannelPlugin`
  - `resolveZaloPersonalReplyTarget(...)`
- `src/channels/zalo-personal/adapter.ts`
  - `ZaloPersonalAdapter` interface
  - `createZaloPersonalAdapter(...)`
- `src/channels/zalo-personal/adapters/zca-cli.ts`
  - `ZcaCliZaloPersonalAdapter`
  - `checkReady(...)`
  - `startListener(...)`
  - `sendText(...)`
  - `sendPhoto(...)`
  - `listGroups(...)`
- `src/channels/zalo-personal/service.ts`
  - `ZaloPersonalService`
  - start/stop lifecycle
  - listener subscription
  - reconnect and session-state checks
- `src/channels/zalo-personal/message.ts`
  - `parseZaloPersonalEvent(...)`
  - `getZaloPersonalSkipReason(...)`
- `src/channels/zalo-personal/route-config.ts`
  - `resolveZaloPersonalConversationRoute(...)`
- `src/channels/zalo-personal/session-routing.ts`
  - `resolveZaloPersonalConversationTarget(...)`
- `src/channels/zalo-personal/content.ts`
  - `resolveZaloPersonalMessageContent(...)`
- `src/channels/zalo-personal/transport.ts`
  - `postZaloPersonalText(...)`
  - `postZaloPersonalPhoto(...)`
- `src/channels/zalo-personal/login.ts`
  - `checkZaloPersonalLoginState(...)`
  - `beginZaloPersonalLogin(...)`
  - `renderZaloPersonalLoginInstructions(...)`

## Test and doc files

- `test/zalo-personal-plugin.test.ts`
- `test/zalo-personal-route-config.test.ts`
- `test/zalo-personal-session-routing.test.ts`
- `test/zalo-personal-service.test.ts`
- `docs/user-guide/zalo-personal-setup.md`
- `docs/tests/features/channels/zalo-personal-alpha.md`

## Code Flow

## Startup flow

1. `loadConfig()` loads `bots.zaloPersonal`
2. plugin creates `ZaloPersonalService`
3. service builds adapter from `adapter.ts`
4. adapter checks local readiness:
   - binary present
   - profile/session present
   - login state valid
5. service starts the local listener
6. runtime health reports either:
   - active
   - login required
   - missing dependency

## Inbound flow

1. adapter emits raw personal-account event
2. `message.ts` parses normalized event
3. dedupe runs on event id
4. `route-config.ts` resolves DM/group route
5. pairing/allowlist/group rules apply
6. `session-routing.ts` produces `AgentSessionTarget`
7. `processChannelInteraction(...)` handles the run
8. transport sends reply through adapter

## Login/recovery flow

1. operator requests login or runtime detects login missing
2. `login.ts` renders QR or local instructions
3. local backend stores session under configured profile
4. next startup/readiness check clears the login-required state

## Definition Of Done

- `zalo-personal` is documented as unofficial and alpha
- no paid dependency is required
- one free local backend works end to end
- startup health clearly distinguishes:
  - missing binary
  - login required
  - runtime active
- DM round-trip works
- at least one group flow works if supported by the backend
- setup, troubleshooting, and risk docs are honest

## Test Contract

Required automated tests:

- config schema and backend defaulting
- adapter selection
- readiness state mapping
- listener event normalization
- route/session mapping
- operator login-state messaging
- runtime health summaries

Required live validation:

- prove backend install and readiness check
- prove QR/local login flow
- prove DM round-trip
- prove restart still sees the stored session

## Risks

- unofficial automation can break without notice
- account-ban risk must stay explicit
- backend stability may vary across OS and local environments
- the wrong abstraction would make future backend replacement harder

## Related Docs

- [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)
