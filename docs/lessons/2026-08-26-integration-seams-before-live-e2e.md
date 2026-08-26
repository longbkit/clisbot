# Lesson: test the integration seams before you go live

Date: 2026-08-26. Context: landing P0 of the channel plan (Slack + Telegram on the Hub, live E2E against the real test surfaces). Source transcript: the `/goal` session that produced `docs/audits/pinned-vertical-contracts/` and the supervisor/loader/install conform work.

## What happened

All channel code was unit-tested green (16 vitest suites, 2 native-ESM suites) against fakes on both sides of every seam: fake daemon, fake fetch, fake entry object, fake logger. The first time two real components met was when the real Hub booted with the real pinned supply against the real dev daemon.

Each boot surfaced exactly one failure, because the plane is fail-closed and three sinks swallowed the detail. Twelve boot cycles, 5–15 minutes each, found — in order:

1. Stale `dist/` (Hub loading pre-conform code)
2. `kill(pid, 0)` succeeds on a zombie → `hub stop` waits 15s, `hub start` refuses (CLI)
3. Same bug in the Hub's data-directory lock → boot refused after every crash
4. `hubDataDir` never forwarded from `application-runtime.ts` to `createHubApplication`
5. Vite cannot inline a dynamic import with a variable specifier → `ERR_MODULE_NOT_FOUND` inside the bundle only
6. `supervisor.startAll()` never wired at boot
7. Main `openclaw` tarball ships no `node_modules` → `Cannot find package 'typebox'`
8. `TrustedDaemonClient.call` throws synchronously on a closed socket → teardown inside `catch` escaped as `server.startup.fatal`
9. Dev daemon has `PASEO_PASSWORD`; the trusted client never sent the `paseo.bearer.<password>` subprotocol → 15s connect timeout
10. `hub start` spawned with `stdio: ignore` → the promised `hub.log` never existed
11. `channelLogger` seam exposed only `warn` → `logger.error?.()` silently no-op
12. Host child logger had only `warn` → vertical's `ctx.log?.info()` threw

None of these is a logic bug. Every one is a seam between two real components that no test had ever exercised together.

Self-inflicted on top: starting the Hub without `CLISBOT_HOME` created a PGlite cluster in `~/.clisbot` (the old production home); invoking `dist/cli.js` (a library module) instead of `bin/paseo` produced a silent no-op; `source .env` for the whole file set `SLACK_APP_TOKEN`, which the Hub's provider-app reader rejects at startup. Three different hand-typed command variants, three different mistakes.

A second, earlier failure mode in the same session: the supervisor was written against `entry.gateway` / `entry.outbound`, keys that do not exist on `defineBundledChannelEntry`. The plan doc described the third-party contract; nobody had run `import(entry)` and printed the keys. See `docs/audits/pinned-vertical-contracts/README.md` for the record that fixed this.

## Rules

**1. Spike the external contract before building on it.** Any time code depends on a third-party artifact (pinned dist, SDK, registry tarball) or on a plan-doc description of one, load the artifact and print the keys, call shapes, and import specifiers first. Record the result as `file:line` facts in the matching topic file under `docs/audits/pinned-vertical-contracts/`. A plan doc is a hypothesis about third-party code, not a fact. Verify against the same bytes you pin (the registry tarball), not a provisioned scratch copy — the "main tarball ships 581 packages" claim came from a scout dir that had been `npm ci`'d.

**2. Add the missing test tier: real-both-sides boot.** Unit tests with fakes on both sides do not cover seams. Before the first live run, write one integration test that boots the real composition (`application-runtime` → supervisor → loader hooks → real pinned install dir) against the one thing you cannot run in-process (the daemon), using the existing `FakeDaemon` from `channels/daemon/client.test.ts`. Assert every account reaches `started`. This single test would have caught items 4, 6, 8, 11, and 12 above in one run with stack traces. Then extend it: replay one **captured real** inbound payload through `onInboundReply` and assert the `create_agent_request` reaching the fake daemon. Only the daemon leg is then left for live.

**3. Make failures loud before you loop.** When the plane is fail-closed by design, the first task before any live iteration is to confirm every error path lands in a log you can read: child process stdio → file, every logger seam forwards every level, status endpoints return the failure `detail`. Discovering the same silent sink three times (items 10–12) cost three boot cycles.

**4. One script for the live loop.** Encode home, password, port, bin path, and log path once (`scripts/e2e-dev.sh {build|restart|status|logs}` or equivalent). Never hand-type env for a live process. Always set `CLISBOT_HOME` explicitly — the fork's default is `~/.clisbot`, which is the old production home on this machine. Read the `.env` keys you need individually; do not `source` the whole file into a Hub process.

**5. Shrink the cycle.** A Vite rebuild plus a detached restart plus a health wait is too slow for one-bug-per-cycle discovery, and the bundle build OOMs when the dev Hub is also resident in the 5 GiB cgroup. Run the Hub in the foreground with `tee` while debugging; stop the Hub before building; keep a source-run path that skips the bundle where the composition root allows it.

**6. Stop rule.** If three consecutive live restarts each surface one new seam bug and no message has crossed the channel, stop restarting and write the integration test from rule 2 instead. Serial discovery does not converge.

**7. Fix root causes, keep the tests.** The part that went right: every bug above was fixed at its source with a regression test and a doc update (zombie-aware `isProcessRunning`, `call`/`send` reject-on-closed, shrinkwrap-driven `provision-main.ts`, secret mirror, logger seams). No patch-arounds. Keep that bar; only the discovery order was wrong.

## Follow-up: the stop rule worked — the fast tier found the first logic bug

The stop rule (6) fired after three live restarts with no reply; back in the rule-2 in-process tier, the boot test's intermittent flake turned out to be a real production bug, not connect timing. `TrustedDaemonClient.onServerInfo` left the hello watchdog armed, so every healthy hub↔daemon socket was terminated 20 s after open and any RPC landing in the reconnect gap failed closed with "daemon client is not connected". The live marker drop and the flake were the same bug. Regression: `packages/hub/src/channels/daemon/client.test.ts` "keeps the trusted session alive past the hello-watchdog window"; operator surface: the supervisor now logs `channel daemon connected` / `channel daemon disconnected` per account via the facade's `onStateChange`.

Two generalizations:

- A success path disarms the watchdog armed for its failure path. A timer armed at socket open to force reconnect when the daemon never answers the hello must clear at the moment the answer arrives.
- When an integration test flakes inside a timing window, suspect a production timer before the test's sequencing. The flake reproduced the production bug exactly; a shared `[t+ms]` clock on hub log lines plus fake-daemon close events made the diagnosis arithmetic instead of guessing.

Also found while looping: `OPENCLAW_LOG_LEVEL=debug` makes the vertical's inbound drop gates log to OpenClaw's file log. The file never materializing in a live drop was itself evidence — the drop was hub-side, before the vertical's gates. The full gate-stack map (allowBots / owner-presence / mention gating, and why a marker posted by the bot under test itself is dropped by default) is [pinned-vertical-contracts/ingress-gates.md](../audits/pinned-vertical-contracts/ingress-gates.md).

## Known open items carried out of the session

- Hub does not exit on SIGTERM (`hub stop` needs `--force`). Real bug; affects the restart/resume acceptance case, not message flow.
- `channels add` writes the account with `fallback: deny` and no routes, and there is no `channels route` verb — E2E needs a hand-authored bundle installed through the public API.
- Two daemons exist on this machine: `0.0.0.0:6767` (production-style, untouched) and the dev one at `127.0.0.1:6867` whose pid lock lives in `~/.clisbot-dev/paseo.pid`. Discovery targets the pid lock; do not "fix" a connect failure by pointing at 6767.
