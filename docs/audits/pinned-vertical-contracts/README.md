# Pinned vertical contracts

Dist-verified contracts for the Hub channel verticals against the pinned OpenClaw supply (`openclaw@2026.7.1-2`, `@openclaw/slack@2026.7.1` — the pins in `packages/hub/channel-pins.json`). Every fact was read out of the pinned dist (scout checkout `/tmp/openclaw-scout`). Paths below the install roots: `slack/…` = `@openclaw/slack@2026.7.1`, `main/…` = `openclaw@2026.7.1-2`. Hashed chunk names are part of the pin; **file:line refs are valid for `2026.7.1-2` / `2026.7.1` only** — on a re-pin, re-verify the touched files before trusting stale refs.

Writer rule: read the topic file before writing the matching loader / supervisor / monitor / test code; do not re-derive facts that are here. If code disagrees with a file, stop and re-verify against the dist before touching either.

## Topics

| File                        | Topic                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry-and-plugin.md`       | The entry object vs the plugin object; which chunk the Hub drives; why `entry.loadChannelPlugin()` is forbidden                                |
| `start-account.md`          | `gateway.startAccount(ctx)` — the flat account shape, token source, `cfg` requirements, promise lifetime, stop = abort                         |
| `outbound.md`               | `plugin.outbound.sendText` — the exact call shape for both channels, result shape, failure modes, the config-writeback guard                   |
| `inbound.md`                | The flat `ctxPayload` (`FinalizedMsgContext`) fields; native conversation kinds; the native → plane mapping; the two-pass route-match decision |
| `telegram-monitor.md`       | The bundled-Telegram host-monitor decision (option A) + the native monitor's contract + the host-override read sites                           |
| `loader-routing.md`         | The aliased `openclaw/plugin-sdk/*` seam matrix and its process-lifetime routing                                                               |
| `seam-and-limits.md`        | No double-post (the seam result shape) + one account per channel per process                                                                   |
| `install-supply.md`         | The two tarballs are self-contained; install is unchanged                                                                                      |
| `state-store-namespaces.md` | The keyed-store seam's real namespaces: telegram + slack, key/value shapes, TTLs, and the dedup-vs-record split                                |

Maintain: when a fact changes (re-pin, new seam, a drive-time miss found in live E2E), edit the owning topic file and update its refs — do not append a second copy elsewhere. The implementation doc's §4.8 links here and carries no fact of its own.
