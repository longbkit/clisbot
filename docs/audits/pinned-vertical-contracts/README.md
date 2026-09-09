# Pinned vertical contracts

Dist-verified contracts against the pinned OpenClaw supply (`openclaw@2026.7.1-2`, `@openclaw/slack@2026.7.1` — the pins in `packages/hub/channel-pins.json`). Every fact was read out of the pinned dist (scout checkout `/tmp/openclaw-scout`). Paths below the install roots: `slack/…` = `@openclaw/slack@2026.7.1`, `main/…` = `openclaw@2026.7.1-2`. Hashed chunk names are part of the pin; **file:line refs are valid for `2026.7.1-2` / `2026.7.1` only** — on a re-pin, re-verify the touched files before trusting stale refs.

**Post-pull status (2026-08-26).** Slack and Telegram are now in-repo verticals (`packages/channels/slack`, `packages/channels/telegram`); for those two channels the pinned dists are the **upstream sync reference** — the bytes each package's `SYNC.md` / `DEVIATIONS.md` ported from — not the live supply (`loadMode: "in-repo"` in `channel-pins.json`, no tarball fetch). The live behavior of a pulled channel lives in its in-repo package; these files are the dist baseline that stays for the re-sync loop. zalouser is not in this hub's pins and was untouched by the pull. Blueprint: [2026-08-26-in-repo-channel-verticals.md §6.5](../2026-08-26-in-repo-channel-verticals.md#65-the-pull-blueprint-implementation-contract-for-the-agent-doing-the-pull).

Writer rule: read the topic file before writing the matching loader / supervisor / monitor / test code; do not re-derive facts that are here. If code disagrees with a file, stop and re-verify against the dist before touching either.

## Topics

| File                        | Topic                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry-and-plugin.md`       | The entry object vs the plugin object; which chunk the Hub drives; why `entry.loadChannelPlugin()` is forbidden                                          |
| `start-account.md`          | `gateway.startAccount(ctx)` — the flat account shape, token source, `cfg` requirements, promise lifetime, stop = abort                                   |
| `outbound.md`               | `plugin.outbound.sendText` — the exact call shape for both channels, result shape, failure modes, the config-writeback guard                             |
| `typing.md`                 | The `sync.progress` liveness surface — native typing status vs inbound reaction, per-channel expiry and repeat cost, keepalive/breaker/TTL, the scopes   |
| `inbound.md`                | The flat `ctxPayload` (`FinalizedMsgContext`) fields; native conversation kinds; the native → plane mapping; the two-pass route-match decision           |
| `ingress-gates.md`          | The verticals' own ingress gate stack (allowBots / owner-presence / mention gating) runs before the Hub seam; bot-stamped markers are dropped by default |
| `telegram-monitor.md`       | The bundled-Telegram host-monitor decision (option A) + the native monitor's contract + the host-override read sites                                     |
| `loader-routing.md`         | The aliased `openclaw/plugin-sdk/*` seam matrix and its process-lifetime routing                                                                         |
| `seam-and-limits.md`        | No double-post (the seam result shape) + one account per channel per process                                                                             |
| `install-supply.md`         | The two tarballs' supply shape; shrinkwrap-backed main-dir provisioning and its tree-completeness idempotence                                            |
| `state-store-namespaces.md` | The keyed-store seam's real namespaces: telegram + slack, key/value shapes, TTLs, and the dedup-vs-record split                                          |

Maintain: when a fact changes (re-pin, new seam, a drive-time miss found in live E2E), edit the owning topic file and update its refs — do not append a second copy elsewhere. The implementation doc's §4.8 links here and carries no fact of its own.
