# packages/channels/slack SYNC (reference: @openclaw/slack@2026.7.1, OpenClaw source `extensions/slack/src/`)

Sync reference is the OpenClaw **TypeScript source** (the pinned compiled dist
under `~/.clisbot-dev/channels/work/` is a secondary reference only). The two
pinned npm deps are kept as pinned deps of the in-repo package — the tarball's
bundled `node_modules` (~80 packages) are NOT vendored (blueprint §6.5,
decisions §7.1).

## npm deps (pinned in package.json — do NOT vendor)

- `@slack/web-api` `7.18.0` — L1 Web API client (read + write paths).
- `@slack/socket-mode` `2.0.7` — L2 Socket Mode client (the socket loop's
  transport).

## Module → OpenClaw source manifest

| In-repo module                         | OpenClaw source (extensions/slack/src)                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/web-api.ts`                | `client.ts` / `client-options.ts` (client options, write-client LRU cache, `SLACK_TEXT_LIMIT`, retry policies) + `probe.ts` (auth.test probe, user-token warning) + `token.ts` (`formatSlackBotTokenIdentityWarning`) + `errors.ts` (error shaping) + `limits.ts` (`SLACK_TEXT_LIMIT`) |
| `src/transport/socket-mode.ts`         | `monitor/provider.ts` (socket branch: handler wiring, ack-first dispatch, im/mpim app_mention dedup) + `monitor/provider-support.ts` (SocketModeClient wrapper: autoReconnect, ping timeout, socket logger)                                                                            |
| `src/transport/socket-reconnect.ts`    | `monitor/reconnect-policy.ts` (backoff policy, auth-error classifier, disconnect waiter) + `monitor/provider.ts` (the reconnect loop)                                                                                                                                                  |
| `src/transport/socket-event-filter.ts` | `monitor/channel-type.ts` (`inferSlackChannelType` / `normalizeSlackChannelType` / `resolveSlackChatType`) + `monitor/events/messages.ts` (ts→ms, mention fact, own-message, payload → inbound event, the `to` fact = `channel:${channelId}`)                                          |
| `src/lifecycle/start-account.ts`       | `channel.ts` (`startAccount`, flat account read) + `probe.ts` (auth.test) + `accounts.ts` / `accounts.runtime.ts` (token source, duplicate-token guard) + `token.ts`                                                                                                                   |
| `src/outbound.ts`                      | `outbound-adapter.ts` (`sendText` subset: post text + thread, `NO_REPLY` silent token) + `send.ts` (write client) + `sent-thread-cache.ts` (`recordSlackSentMessage` → keyed-store seam, D-001)                                                                                        |
| `src/plugin.ts`                        | `channel.ts` (`startAccount` + `outbound.sendText` drive surface) — pinned export name `slackPlugin`                                                                                                                                                                                   |
| `src/entry.ts`                         | the `defineBundledChannelEntry`-shaped entry (id `slack`, name `Slack`)                                                                                                                                                                                                                |
| `src/runtime.ts`                       | the `setSlackChannelRuntime` runtime sidecar (HostRuntime store)                                                                                                                                                                                                                       |
| `src/index.ts`                         | package entry (default = entry, named `slackPlugin`)                                                                                                                                                                                                                                   |

## OUT OF SCOPE (group E)

pairing, exec-approvals, thread-bindings, doctor, security-audit, directory,
setup-wizard, interactive-dispatch, allow-from, secret contracts, the Bolt
`App`/HTTP receiver path (in-repo is Socket Mode only), presentation/blocks
rendering, media delivery.
