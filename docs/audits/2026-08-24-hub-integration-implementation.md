# Hub integration: build, publish, onboarding, and source changes

Implementation companion to [2026-08-23-openclaw-channel-reuse-plan.md](2026-08-23-openclaw-channel-reuse-plan.md). The plan owns *what* and *why* (control plane in the Hub, in-process verticals §14.5; **P0: the Hub reaches the daemon as an ordinary client — both forms: embedded pairs over loopback, team/remote over the relay, `scopes: ["*"]`, existing RPCs — zero daemon diff; P1: a flag-gated per-resource grant engine in the daemon** — plan §4-S3/§14.6/§14.7). This doc owns *how it is built, shipped, installed, and where every source change lands*. Verified against both codebases 2026-08-24/25.

## 1. Building process and package publish

### 1.1 Repo topology

One new workspace package, `packages/hub` — a copy of the `getpaseo/hub` source tree with the channel control plane added. Since the §14.5 decision (in-process verticals), **there is no separate vertical package**: the channel loader, alias seam, per-channel install, and load-trace check live inside the Hub package (`src/channels/loader/`), because the verticals run in the Hub process. One package owns the whole channel capability; the monorepo changes are the additive CLI groups and, at P1, the flag-gated grant engine — P0 has zero daemon diff (§3, plan §4-S3/§14.6).

```
packages/
  protocol/ client/ server/ cli/ ...   # upstream @getpaseo/* — modified additively (§3.2)
  hub/                               # NEW — @clisbot/hub, server package (no bin at publish, §1.4)
    package.json                     # name @clisbot/hub, files [dist, .output, drizzle]; upstream bin key kept in source, dropped at publish
    bin/paseo-hub.js                 # upstream bin, UNCHANGED in source
    src/                             # upstream Hub source, UNCHANGED except §3.2 hub-side deltas
    src/channels/                    # NEW — the channel control plane (self-contained modules)
      config/                        # authored files under .paseo/channels/, on the existing compiler (§4.3)
      connections/                   # multi-account per provider
      bindings/                      # thread bindings + continuous execution
      relay/                         # outbound relay + delivery ledger
      approvals/                     # approval rules + prompts
      policy/                        # RBAC / privilege algebra
      ingress/                       # per-account webhook routes
      loader/                        # vertical loader: module hooks, alias table, load-trace
      install/                       # per-channel install (pin manifest, integrity, install dir)
    channel-pins.json                # pin manifest (main + channels: version, dist.integrity, gitHead)
    seam-matrix/                     # generated subpath classification (CI artifact, committed)
```

Upstream tracking: `packages/hub` tracks the Hub mainline (`getpaseo/hub`) the same way the repo root tracks `getpaseo/paseo` — a dedicated upstream ref + periodic merge. The Clisbot diff inside the Hub package is bounded to: `src/channels/**`, `package.json` (name/version, bin entry dropped), `channel-pins.json`, `seam-matrix/`, and the additive compiler/DB deltas below. Everything else merges from upstream untouched.

### 1.2 Build

Both codebases use the same tooling family (TypeScript via `tsgo`, Biome-adjacent lint via `oxlint`, `oxfmt`), so no toolchain conflict. Differences that matter:

| | Monorepo (Paseo) | `packages/hub` |
| --- | --- | --- |
| Node | 22.20.0 (`.tool-versions`) | same (module customization hooks need ≥20.6; 22 is the floor) |
| Build | `npm run build:server` (protocol→relay→client→server→cli) | `npm run build --workspace=@clisbot/hub` = `tsgo` (node runtime → `dist/`) + `vite build` (web UI → `.output/`) |
| DB | JSON files, no migrations | Drizzle + PGlite/Postgres; migrations in `packages/hub/drizzle/` |
| Wire schema | `packages/protocol/src/messages.ts` (incl. `hub.execution.*`) | Hub's own copies: `src/hub/protocol.ts`, `src/daemons/protocol.ts` |

The Hub has **zero imports of `@getpaseo/*`** today (verified: only its own `@getpaseo/hub` self-reference and e2e harnesses that spawn the monorepo daemon as a child process). Keep it that way — the Hub package must build standalone, which is what makes it promotable (§14.3) and keeps the two build systems from tangling. (The embedded Hub's P0 connection to the daemon is a **runtime** trusted-client WebSocket, not an import — same boundary as a CLI or app client, so the rule is unchanged.)

```bash
# inside the fork checkout
npm install                  # workspaces now include packages/hub
npm run build:server         # daemon stack (unchanged command)
npm run build:hub            # new root script = npm run build --workspace=@clisbot/hub
npm run typecheck            # both trees (Hub typecheck is included via --workspaces --if-present)
```

Do not fold the Hub's `vite build` into `build:server`: the desktop/mobile stacks must not pay for it, and the Hub UI build is slow. `build:hub` stays a separate, explicit step.

### 1.3 Versioning

All fork packages publish under the **`@clisbot` scope on public npm** — not `@getpaseo`, which upstream owns (and which this repo must never impersonate). The scope rename happens **at publish time, not in source** (§1.4): the source tree keeps the upstream package names (`@getpaseo/*`) byte-for-byte, so import lines never enter the Clisbot diff and upstream merges stay conflict-free (P10, §14.1 of the plan).

- Versions track upstream: the fork of monorepo `0.5.0` ships as `@clisbot/cli@0.5.0`, and the Hub package (based on Hub `0.7.0`) ships as `@clisbot/hub@0.7.0`. No `-clisbot.N` suffix is needed — under the fork's own scope there is no upstream package to shadow. Pre-release suffixes are reserved for fork-only experimental releases that should not be stable-channel installs.
- **One user-facing binary: `clisbot`.** The fork ships a single global binary, `clisbot`, which subsumes both the operator CLI and the Hub. The name `paseo` is not part of the published Clisbot experience — that is deliberate: the fork's daemon and CLI are modified builds (at P0 the CLI carries the new `hub start|stop` + `channels`/`users` groups and the Hub package is co-shipped; at P1 the daemon carries the flag-gated grant engine), and keeping the upstream binary name would let a user mistake a fork install for a stock one. The operator verbs and the Hub/channel verbs both live under `clisbot` (e.g. `clisbot daemon start`, `clisbot hub start`, `clisbot channels add`, `clisbot run`).
- Source package names are still upstream's (`@getpaseo/*`) and `packages/cli`'s internal bin key stays `paseo` for mergeability; the publish transform renames that one bin key to `clisbot` — no second binary is ever shipped (§1.4).

### 1.4 Publish

Fork packages publish to **public npm under `@clisbot`**, as transformed copies of the upstream-named build output. The transform is one release script, not a source change:

```
scripts/publish-clisbot.mjs     # NEW — the only place the two name worlds meet
  1. builds the workspaces (build:server + build:hub)
  2. for each workspace package: stages dist/ + bin/ + README + package.json
  3. rewrites every "@getpaseo/" specifier to "@clisbot/" inside the staged
     ESM output and .d.ts files, and in the staged package.json
     (name + cross-workspace dependencies)
  4. assembles the single `clisbot` bin from the staged @clisbot/cli package
     (renames its bin key `paseo` → `clisbot`; the CLI carries the whole
     command tree, including the new hub-start/channels/users groups, and
     depends on @clisbot/hub as a server package with no bin — so a global
     install can never materialize a stray `paseo`)
  5. npm publish --folder <staging>   (access: public)
```

Why not rename in source: 632 source files import `@getpaseo/*` (app 302, server 175, cli 47, desktop 9, client 8, plus 11 `package.json` files and root scripts). Renaming them is a mechanical one-hour change, but it turns every import line into a Clisbot diff — every future `upstream/main` merge would conflict on every upstream-touched file. Publishing as a renamed copy keeps the source byte-identical to upstream on all import lines and confines the name change to the release script.

**The unified `clisbot` binary.** All CLI commands live in `packages/cli` (commander v12, ~70 verbs across 14 groups, tree assembled in the exported `createCli(): Command` — `packages/cli/src/cli.ts:50`); each group is mounted with the repo's existing factory pattern (`addXxxCommand(parent, dependencies)` + an injected environment, e.g. `packages/cli/src/commands/hub/index.ts`). The Hub package today contributes **zero** commands — it is a server binary whose `runHubCommandLine()` only starts the server. The CLI already carries a `hub` group (8 verbs: connect, init, status, deploy, …) implemented as thin HTTP clients to a running Hub (`HubHttpClient` → `/api/v1/...`), and `paseo start` already *spawns* the daemon (`local-daemon.ts` → `spawnProcess` from `@getpaseo/server`). The unified binary reuses that exact model:

- **`@clisbot/cli` owns the `clisbot` bin** (the publish transform renames the bin key; source keeps the upstream key). It gains new groups on the same factory pattern: `hub start|stop` (spawn/detach the Hub server process — the `daemon start` pattern applied to the Hub's already-exported `runHubCommandLine` entry), `channels add|list|status`, `users list|show|add|edit` (+ `users pairing`, §4-S4) as **thin HTTP clients** to the running Hub's control-plane API (`/api/v1/channels/...`) — the `hub deploy` pattern applied to the new endpoints — and the `bot start|init|stop|status` group (§2.1), which composes the daemon/Hub spawn + starter config + those same control-plane calls into the one-line bootstrap. `users add|edit` mutate the `users:` section of the active revision and deploy it (§4.3.2).
- **`@clisbot/hub` is a server package with no bin** (analog of `@getpaseo/server`): it contributes a spawn-able server entry and the control-plane HTTP API, nothing else. Its source keeps the upstream Hub shape, so merges against `getpaseo/hub` stay clean.
- Dependency direction: CLI → Hub (workspace dep), matching the existing CLI → server dependency.

Rejected alternative: `@clisbot/hub` owning the bin and re-hosting the CLI's ~70 operator verbs as a dependency. It keeps the CLI source untouched, but it moves the whole command tree into the Hub package — more new code, a dependency in the wrong direction (server hosting the operator CLI), and a Hub diff that can no longer merge cleanly against the Hub mainline. The CLI-owns-the-binary model adds a small additive diff to the upstream-shaped `packages/cli` (new group directories + one workspace dependency + wiring in `createCli()`); the new verbs are inert against a stock Hub (`/api/v1/channels/...` simply 404s) and the daemon is untouched.

User-side install is then just:

```bash
npm i -g @clisbot/cli           # -> single binary: clisbot
                                # (@clisbot/hub and the other @clisbot/* packages come as dependencies)
```

CI gates before any publish: the existing monorepo CI (typecheck/lint/targeted tests), the Hub's own test suite, the channel conformance suite (fake-transport per channel, plan §9), the pin-manifest integrity check, and — specific to the transform — a staging smoke test that runs `node --check` on the rewritten ESM, imports every cross-workspace specifier from the staged output, and runs `clisbot --help` + `clisbot daemon status` + `clisbot channels status` against the staged bin (a missed rewrite or a dropped verb is a runtime crash for the user, so the script fails closed on any surviving `@getpaseo/` specifier or a missing verb).

The OpenClaw supply stays on public npm under its own names (`openclaw`, `@openclaw/*`), pinned by `channel-pins.json` — untouched by the scope rename (plan §14.4).

Dev workflow (no publish needed): in a fork checkout the source bin keys are still upstream's (mergeability) — `packages/cli`'s `paseo` and `packages/hub`'s `paseo-hub` (the publish transform renames the former and drops the latter, §1.4). `npm link packages/cli packages/hub` gives you both: `paseo` carries the whole command tree including the new `hub start|stop` / `channels` / `users` groups, and `paseo-hub` starts the Hub directly. One dev step stands in for the publish-time rename: symlink the CLI's source bin under its public name (`ln -s "$(npm prefix -g)/bin/paseo" "$(npm prefix -g)/bin/clisbot"`), or just type `paseo` during development.

## 2. User onboarding: from zero to an agent in a channel

Target: the fewest steps that get a channel-driven agent running, reusing everything upstream already provides. Two paths: the full multi-command path below (steps 0–7: machine setup, channel wiring, first mention) for the general case, and §2.1 — the one-line `clisbot bot start` bootstrap — for the common "one assistant on Slack/Telegram now" case.

```bash
# 0. prerequisites: Node 22, outbound internet (Socket Mode + polling need no public URL)

# 1. install (public npm, @clisbot scope) — one binary, one name
npm i -g @clisbot/cli                   # -> binary: clisbot
                                        # (@clisbot/hub arrives as its dependency; no bin of its own)

# 2. start the daemon (home $CLISBOT_HOME, default ~/.clisbot, port 6767)
clisbot daemon start

# 3. start the embedded Hub (PGlite; data dir $CLISBOT_HUB_DATA_DIR, default the shared home ~/.clisbot)
clisbot hub start
#    -> spawns + detaches the Hub server (daemon-start pattern); binds loopback :6868 (the fork's default port,
#       distinct from upstream's 3000); writes a hub-local.json state file (url, pid); prints http://localhost:6868;
#       open it and create the operator account. --foreground keeps it attached; `clisbot hub stop` kills it

# 4. point the Hub at the daemon + starter config
clisbot hub init
#    -> local verbs auto-discover the running Hub from hub-local.json — no CLISBOT_HUB_URL / CLISBOT_HUB_API_KEY
#       to set; the embedded control plane trusts loopback (the Hub binds loopback, so only local clients reach it)
#    -> writes the default project + starter workflow, records the daemon target (loopback), validates and deploys
#    P0: the embedded Hub then connects to the daemon as a TRUSTED loopback client
#       (the local CLI/app model, scopes ["*"], existing RPCs) — NOT the upstream
#       enrollment / hub.execution.* scoped path. No enrollment token, no credential.
#       (clisbot hub init is config + deploy only at P0, not daemon enrollment.)

# 5. add the channels — installs pinned OpenClaw supply, loads the verticals in-process
clisbot channels add slack   --account work \
     --secret-file ~/.config/clisbot/secrets/slack-work.json
clisbot channels add telegram --account personal \
     --secret-file ~/.config/clisbot/secrets/telegram-bot-token.json
#    -> Hub verifies dist.integrity, installs to its per-channel dir, applies the channels:
#       revision, starts Socket Mode (Slack) + polling (Telegram)

# 6. verify
clisbot channels status

# 7. use it: mention the bot in Slack, or message the Telegram bot
#    -> first message: thread binding + agent session created (approval-required posture)
#    -> follow-ups in the same thread resume that session
#    -> the session shows in any paired Paseo client as an ordinary agent session
```

Pairing the phone/desktop to the daemon is the upstream flow, unchanged: pair to the daemon as you always do, and channel-originated sessions appear in the client like any other agent (transparency property, plan §4-S3). At P0 pairing is **tier-2 only** — the daemon does not act on any embedded grant (plan §4-S4); the Hub can already mint grant-bearing links, but the daemon verifies them from P1 (the grant engine), and a link paired to a stock daemon behaves byte-for-byte as today.

**The team/remote form onboards the same way, one difference in how the Hub reaches the daemon (plan §14.7).** The flow above is the single-machine form: the embedded Hub connects over loopback. The team form (Postgres, deployed Hub, §3) connects to the daemon **as an ordinary relay client** — the operator pairs the Hub to the daemon with a standard pairing link, exactly like pairing a phone. A paired socket is `scopes: ["*"]`, `kind: "trusted"` (`websocket-server.ts` `attachExternalSocket` → `createSessionConnection`), so the team form has the same channel capability (steer + approval) at P0, with the same zero daemon diff. The daemon does not distinguish "this is the Hub" from "this is a phone" — both are ordinary clients; what makes the Hub the control plane is its own config + RBAC, not the wire. The P1 grant engine is what later binds a principal + grants to the Hub's session on the daemon side (narrowing the full-trust pairing, plan §4-S3/§14.7). The upstream `hub.execution.*` scoped/enrollment path is **not** this flow — it is frozen legacy-compat for daemons already enrolled upstream, expected to sunset (plan §14.7).

Step count reality check: four user-typed commands after install (`clisbot daemon start`, `clisbot hub start`, `clisbot hub init`, two `clisbot channels add`), one browser account creation, one bot mention. Nothing in the onboarding path requires a public URL, a Postgres instance, or a hand-written config file — the guided `clisbot hub init` writes the starter config, and `channels add` writes the account file under `.paseo/channels/` (§4.3).

### 2.1 One-line bootstrap: `clisbot bot start`

The steps above are the general case (machine setup + arbitrary channel wiring). The common case — "one assistant on Slack or Telegram now, provider of my choice" — is one command, and it must work **from a cold machine with no prior `hub init`**:

```bash
clisbot bot start --provider codex --bot-type team \
     --telegram-bot-token xoxb-... --persist
```

That single line does, in order: (1) start the daemon if not running (`daemon start` pattern, `$CLISBOT_HOME`); (2) start the embedded Hub if not running (`hub start` pattern, §3.2); (3) run the starter `hub init` config + deploy if the Hub has no active revision yet; (4) create the **bot** (below); (5) print the agent id + channel + "mention the bot in …" next step. Idempotent: re-running with the same flags reuses the existing bot; only a changed flag (new provider, new `--bot-type`) re-creates.

**`bot` is a composite, not a new agent kind.** A bot bundles four existing things the operator would otherwise wire by hand: a **workspace** (seeded with agent instruction templates), a named **agent** in it (a provider + model, created with no prompt — it waits to be triggered), a **channel account**, and a **route** pointing that account at the agent. Nothing about a bot reaches the daemon as a new concept: the daemon sees an ordinary workspace + ordinary agent; the Hub sees an ordinary channel account + route. The bot is the operator's name for the bundle, and the only new artifact is a small manifest that ties the four ids together so `bot status`/`bot stop`/idempotency work.

**Seeding + agent creation, learned from `run` and Clisbot.**

- **Workspace:** default `$CLISBOT_HOME/workspaces/default/` (overridable with `--workspace`/`--cwd`, and `--new-workspace <local|worktree>` behaves as in `run`). At seed time the matching template set is copied in; existing files are **skipped and listed** (the command prints which files it left alone) and `--force` overwrites. This is the `--bot-type` choice: `personal` → `personal-assistant` template, `team` → `team-assistant` template (Clisbot's `SUPPORTED_BOOTSTRAP_MODES`; the fork ships both under a Clisbot-owned templates dir, additive).
- **Agent:** created via the trusted `create_agent_request` with `--provider` (+ optional `--model`/`--mode`, same vocabulary as `run`). `create_agent_request`'s `firstAgentContext.prompt` is optional (`packages/protocol/src/messages.ts:1593`, `FirstAgentContextSchema` at `:2352`), so a bot is created **idle** — it has no first turn until a channel message arrives. This is the load-bearing fact that makes one line possible: `run` requires a prompt only at the CLI layer (`agent/run.ts:377`), not the wire.
- **Naming:** `--bot-name` is the composite's name (default: `<bot-type>-assistant`); it also becomes the default agent title and channel account id unless overridden. `--agent-name` overrides only the agent's title. `--bot-type` stays Clisbot's `personal|team` spelling.

**Channel credentials, learned from Clisbot's `start`/`init`.** `--slack-bot-token`/`--slack-app-token` (+ optional `--slack-account <id>`, default `default`) and `--telegram-bot-token` (+ optional `--telegram-account <id>`) accept a literal value, an `${ENV_REF}`, or a secret-file path — the same three kinds Clisbot's `parseTokenInput` uses. Without `--persist` the token is **runtime-only** (in-memory for this Hub run); with `--persist` it is written to the Hub-owned secrets file (`secretRef`, 0600, §4.3.9) so a later plain `bot start`/`hub start` reuses it. At least one channel credential is required on first create.

**`start` vs `init` vs `stop` (the hub/daemon split, made explicit).** The user-visible split is by *what the verb owns*, which removes the "is `hub init` a Hub thing or a daemon thing?" ambiguity:

- `clisbot bot start` — owns the whole bundle; may spawn the daemon and the Hub; runs the starter config if absent. **No prior `hub init` required** — this is the one-line path.
- `clisbot bot init` — same bundle creation but **requires a running Hub** (it will not spawn one); use it when the Hub is already up and you only want to add/reconfigure a bot. Fails with "run `clisbot bot start` first" if the Hub is down.
- `clisbot bot stop` — stops the Hub process **and** discards runtime-only (non-`--persist`) channel credentials, mirroring Clisbot's `stop` → `removeRuntimeCredentials()` (`clisbot` `src/control/runtime/runtime-process.ts:530`). `--persist`-ed credential files survive. Because the channel verticals run **in the Hub process** (§14.5), stopping the Hub stops every channel — there is no separate `channels stop` at P0. `bot stop` does not stop the daemon or the agent sessions; they belong to the daemon and keep running, and their thread bindings/ledger resume when the Hub restarts (no double-post).

**Provider note (grok).** Builtin providers are `claude codex copilot opencode pi omp` (`AGENT_PROVIDER_DEFINITIONS`). ACP providers (`cursor`, `kimi`, `kiro`, `traecli`) and **custom ACP providers** are added as `extends: "acp"` + `command` in daemon `config.json` (`docs/custom-providers.md`). Grok is not builtin here: on this machine it is a custom ACP provider (`extends: "acp"`, command `["grok","agent","stdio"]`, binary `grok` 1.0.5). `bot start --provider grok` therefore requires that custom provider to be registered in the daemon config first; the command reports the exact config to add if the provider id is unknown, rather than guessing.

**Naming record (proposed; glossary entries land when the module does).**

| Concept | Name | Rejected |
| --- | --- | --- |
| The composite bundle | **bot** | "assistant" (too generic, collides with `--bot-type`'s `*-assistant` template names); "agent-bot" (redundant) |
| Template choice flag | `--bot-type` (`personal` \| `team`) | kept from Clisbot unchanged |
| Composite name flag | `--bot-name` | — |
| Agent-title override | `--agent-name` | not `--title` (that is `run`'s word for the bare agent) |
| Per-channel credential | `--slack-bot-token` / `--telegram-bot-token` | kept from Clisbot's per-channel `tokenFlags` |

The bot manifest (new artifact) lives at `$CLISBOT_HOME/bots/<bot-name>.json` (bot name → workspace path + agent id + channel account id + route id + credential kind); it is Clisbot-owned, additive, and the only new persistence this feature introduces.

**One binary, not two.** The published fork exposes a single global name, `clisbot`; there is no `paseo` binary in the Clisbot experience. The reasons:

1. **It is a modified build, so it should not impersonate upstream.** At P0 the CLI is modified (new `hub start|stop` + `channels`/`users` groups, co-shipped Hub package) and at P1 the daemon carries the flag-gated grant engine (plan §4-S3/§14.6). A binary still called `paseo` invites the "is this stock Paseo or the fork?" question on every machine; `clisbot` makes the fork legible at the command line, and `clisbot --version`/diagnostics report `@clisbot/*` scope + version (notice 8).
2. **The product is Clisbot.** Per the product vision, this is "a new generation of Clisbot" — one binary named after the product is the natural UX, and users learn one name instead of two.
3. **The server package ships no bin of its own.** `@clisbot/hub` is server-pure by construction (§1.4, analog of `@getpaseo/server`): it contributes a spawn-able entry and the control-plane API, not verbs. So every user-facing verb — operator, hub, channel — already lives under one binary; there is nothing to merge.

Verb layout: the operator verbs keep their upstream groups (`clisbot daemon start|status`, `clisbot run|ls|logs|…`); the channel capability adds `clisbot hub start|stop` (spawn/detach the Hub server — the `daemon start` pattern) and `clisbot hub init|status|deploy` (the upstream guided flow; at P0 `init` is config + deploy only — the embedded Hub is not a daemon enrollment, plan §4-S3), plus `clisbot channels add|list|status` and `clisbot users list|show|add|edit|pairing` as thin HTTP clients to the running Hub's control-plane API. On top of those, `clisbot bot start|init|stop|status` is the one-line bootstrap (§2.1): it composes the daemon/Hub spawn + starter config + the same control-plane calls, so the operator can go from cold machine to a channel-ready assistant in one command instead of the §2 sequence. Note the deliberate difference from upstream's bare `paseo-hub` = start: in the unified binary, starting the Hub is an explicit verb under the `hub` group, and bare `clisbot` prints help for the whole command tree.

**Supervisor notice (plan §14.5 condition 2):** in P0 the embedded Hub has no built-in supervisor. For anything left unattended, run the Hub under the operator's process supervisor before relying on it:

```bash
pm2 start "clisbot" --name clisbot-hub -- hub start --foreground   # or a systemd unit; kill -9 the Hub and watch it come back
```

(`--foreground` keeps the Hub inside the process the supervisor watches — `hub start` without it detaches, and the supervisor would only be tracking the short-lived CLI invocation.)

## 3. Source changes: new and modified, blast radius, upstream compatibility

The whole change splits into **one new package** and **a small additive diff in the monorepo**. The direction of dependency is fixed: the Hub talks to the daemon over the wire; **the daemon never imports `@clisbot/hub`**. That single rule is what keeps P10 structural.

### 3.1 New (Clisbot-owned, zero upstream surface)

| Location | What |
| --- | --- |
| `packages/hub/src/channels/**` | Channel control plane: config block, multi-account connections, thread bindings + continuous execution, outbound relay + delivery ledger, approval rules, RBAC policy (user records + assignments, §4.3.2), per-account ingress routes, resource grants + pairing-link minting |
| `packages/hub/src/channels/loader/**` | Vertical loader: Node module customization hooks (resolve/load), the alias seam table, load-trace check at load (§6 of the plan), the two loading modes (published with alias surface, bundled Telegram with none) |
| `packages/hub/src/channels/install/**` | Per-channel install: reads `channel-pins.json`, fetches the pinned tarball from public npm, verifies `dist.integrity`, installs to `<CLISBOT_HUB_DATA_DIR>/channels/<accountId>/` (default `~/.clisbot`) |
| `packages/hub/drizzle/*` (new migrations) | Additive tables: channel accounts, thread bindings, delivery ledger, resource grants (user records live in the config bundle, not the DB — §4.3.2) |
| `packages/hub/channel-pins.json`, `seam-matrix/` | Pin manifest + generated subpath classification |
| `packages/hub/src/env-alias.ts` (new module) | the `CLISBOT_*` → `PASEO_*` alias shim (§4.5): a fixed table applied at process entry — copies each `CLISBOT_X` into `PASEO_X` when `PASEO_X` is unset; explicit `PASEO_X` always wins. Fork-owned; the internal code keeps reading upstream `PASEO_*` names, so no upstream merge re-fights a rename |
| `THIRD_PARTY_NOTICES` entry | OpenClaw bundled deps, per channel (plan §9 step 7) |

All of it is flag-gated: the `CLISBOT_HUB_CHANNELS_ENABLED` env (read by the Hub at startup; set in the supervisor's environment — it is a process-level "load the channel code at all" switch, so changing it needs a restart) + `channels/policy.yml` `enabled: false` in the active config revision (plan S7; §4.6). The config levels below it are live-reloaded with the revision. Flag off, the Hub loads no channel code, ingests no channel events, opens no per-account routes — byte-equivalent to today's Hub.

### 3.2 Modified (upstream files — additive hunks only, all `COMPAT`-tagged)

**Monorepo — daemon stack — P0: no changes.** Both forms of the Hub drive the daemon through the **existing trusted-client RPCs** (`create_agent_request`, `send_agent_message_request` + `activeTurnBehavior: "steer"`, `agent_permission_response`) over an ordinary trusted session — `scopes: ["*"]`, the same path the local CLI, app, and phone already use (embedded form: loopback WS; team/remote form: relay-paired, `attachExternalSocket` → `createSessionConnection`, same scope set — plan §14.7). No new RPC, no schema, no `server_info.features` flag, no handshake message, no handler. The upstream `hub.execution.*` scoped channel is untouched and is **frozen legacy-compat for existing enrolled daemons — no form rides it by design at P0; expected to sunset with the P1 grant engine** (plan §14.7). The only P0-visible daemon-side difference is the **absence of any channel code** — flag-off byte-equivalence is vacuously true.

**Monorepo — daemon stack — P1: the per-resource grant engine** (the daemon's only channel-related addition; plan §4-S3/§14.6; the fork's largest upstream surface):

| File | Change | Gate |
| --- | --- | --- |
| `packages/protocol/src/messages.ts` | + optional pairing-grant field on the offer; + optional grant-binding handshake message; + `server_info.features.grants` flag. No new steer/permission RPCs: both Hub forms use the existing trusted-client RPCs (§14.7), so the grant engine only binds a principal + grants to a session that is already calling `send_agent_message_request`/`agent_permission_response` | optional fields only, pure wire schemas (`docs/protocol-compatibility.md`); `COMPAT(grant-engine)` tags; no semantic narrowing for ungranted sessions |
| new `packages/server/src/server/grants/` (dedicated module) | grant store + principal binding + enforcement helpers: verify Hub signature + nonce + TTL, bind principal + grants to the session; per-resource checks over daemon→project→agent-session→surfaces | flag-gated + capability-gated; sessions without a bound principal keep today's trust semantics; off-by-default = byte-equivalent to upstream (verified per CLAUDE.md "verify both states") |
| additive hunks at upstream hook sites | `websocket-server.ts` / `session.ts` (bind principal on the grant handshake; consult the grant module at resource boundaries); `agent-manager.ts`, workspace registry, terminal manager, file service, config store, checkout (thread the session principal through the resource ops) | additive cases only; each hunk stays a minimal extractable change so the module stays liftable (plan §14.1) |
| new `packages/server/src/server/managed-processes/supervisor.ts` (optional) | spawn + restart-with-backoff + crash-loop-breaker for a daemon-managed embedded Hub (registry reuse: `createManagedProcessRegistry` records; the new module supervises) | off by default; plan §14.5 condition 2's built-in form; independent of the grant engine |

> Obsolete (pre-pivot plan): this section previously listed the P0 daemon diff as two new `hub.execution.*` RPCs (`agent.steer`, `agent.permission.respond`) + `pairing-grant.ts` + the managed-process slot + a `server_info.features` flag. All of that is superseded by plan §14.6: the two RPCs are no longer needed (existing trusted-client RPCs cover steer + permission-respond), and the pairing-grant verification moves into the P1 grant engine.

**Monorepo — CLI** (new additive groups under `packages/cli`, §1.4):

| File | Change | Gate |
| --- | --- | --- |
| new `packages/cli/src/commands/hub/start.ts` + `stop.ts` | `hub start|stop`: spawn/detach the Hub server via `spawnProcess` from `@getpaseo/server` — the existing `daemon start` pattern (`local-daemon.ts`) applied to the Hub's exported `runHubCommandLine` entry. The spawned Hub binds loopback `:6868` (the fork's default port, distinct from upstream `:3000`) and `start` writes a `hub-local.json` state file in `$CLISBOT_HOME` (url, pid) that the local verbs read; the `CLISBOT_*` → `PASEO_*` alias shim (§4.5) is applied at spawn. `hub stop` kills the Hub (which, since the verticals run in-process, stops every channel too) **and discards runtime-only channel credentials** — the non-`--persist` tokens, mirroring Clisbot's `stop` → `removeRuntimeCredentials()`; `--persist`-ed secret files survive. `bot stop` (§2.1) is `hub stop` plus the bot-manifest cleanup, so the two never diverge | `COMPAT` tag at the mount site |
| new `packages/cli/src/commands/channels/` + `users/` groups | `channels add|list|status`, `users`, `pairing` — thin HTTP clients to the running Hub's control-plane API (`/api/v1/channels/...`), the `hub deploy`/`HubHttpClient` pattern. Local verbs auto-discover the Hub from `hub-local.json` — no `CLISBOT_HUB_URL`/`CLISBOT_HUB_API_KEY` to set; the embedded control plane trusts loopback | inert against a stock Hub: the endpoints 404 with a clear message; zero daemon impact |
| new `packages/cli/src/commands/bot/` group (+ `templates/` seed set shipped with the CLI, §2.1) | `bot start|init|stop|status` — the one-line bootstrap: spawns daemon + Hub as needed (`daemon start` / `hub start` patterns, reused, not forked), runs the starter config if absent, seeds the bot workspace, creates the idle agent via trusted `create_agent_request` (no prompt — `FirstAgentContextSchema.prompt` is optional), adds the channel account + route through the same control-plane API `channels add` uses, and writes the bot manifest (`$CLISBOT_HOME/bots/<bot-name>.json`). Flags: `--provider`/`--model`/`--mode` (run vocabulary), `--bot-type <personal\|team>`, `--bot-name`, `--agent-name`, `--workspace`/`--new-workspace`, per-channel token flags + `--persist` (§2.1). `bot stop` discards runtime-only credentials (Clisbot `removeRuntimeCredentials` analog) | reuses the daemon/Hub spawn + control-plane paths; zero new wire; zero daemon impact; inert against a stock Hub (the control-plane endpoints 404 with a clear message) |
| `packages/cli/src/commands/hub/index.ts` + `cli.ts` | mount the new sub-verbs + groups in the existing factory wiring (`addHubCommand` et al.) | additive cases only |
| `packages/cli/package.json` | + `@getpaseo/hub` workspace dependency | inert: the Hub server is only ever spawned as a child process, never imported at runtime |

**Root:**

| File | Change | Gate |
| --- | --- | --- |
| root `package.json` | `workspaces += "packages/hub"`; + `build:hub` script | zero runtime effect on existing packages |
| `CLAUDE.md` | docs-table row for this doc | docs only |

**Inside `packages/hub`** (the Hub-side half of the same seams; the Hub fork is where most new code lives, deliberately):

| Location | Change |
| --- | --- |
| `src/config/compiler.ts` + bundle | the `.paseo/channels/` authored directory on the existing compiler (validation, revision, audit hash reused — plan S2; §4.3) |
| `src/db/schema.ts` + `drizzle/` | additive tables (§3.1); the one global-unique index relaxation for multi-account (plan P4) is a migration, additive |
| `src/daemons/lifecycle.ts` + new channel session consumers | Relay + approval input, **one code path for both forms** (plan §14.7): the Hub's ordinary trusted session (loopback for embedded, relay-paired for team/remote) receives the ordinary client agent-update / timeline events — including `permission_requested`/`permission_resolved` — for its bound `agentId` (the same events the app renders, gated by the same per-agent subscription), and drives `create_agent_request` / `send_agent_message_request` (`activeTurnBehavior: "steer"`) / `agent_permission_response` — existing RPCs, no new wire (plan §4-S3 P0). The legacy `hub.execution.agent.stream` consumer (today it only refreshes the idle deadline — plan P5/P6) is kept only for the frozen legacy-compat scoped path; it is not a P0 relay or approval input |
| `src/provider-applications/internal/runtime-owner.ts` + routes | per-account channel ingress routes generalize the existing named-request ingress (plan gap 11) |
| `src/triggers/manual/` dispatch path | channel-originated turns ride the existing `manual.run`-shaped dispatch as another event source (generalized entrypoint, not a new invoke API) |

**The two wire-schema sources** — notice, not a change: the `hub.execution.*` schemas exist in both the monorepo (`packages/protocol/src/messages.ts`) and the Hub (`src/hub/protocol.ts`), and upstream keeps them in sync by hand. At **P0 there is no new RPC on either side, and no form uses the `hub.execution.*` schemas** — both forms use the existing trusted-client schemas (plan §14.7), so lockstep is vacuously satisfied. The `hub.execution.*` lockstep discipline applies only to the frozen legacy-compat scoped path. When the **P1 grant engine** adds wire (the optional handshake message, the optional offer field), each addition lands in **both** sources with matching `COMPAT` tags, and the conformance tests assert the two copies agree.

### 3.3 Blast radius, by construction

1. **One new package carries the feature.** All channel code (control plane + verticals + loader + install) is inside `@clisbot/hub`. Deleting `packages/hub` from the workspace deletes the entire channel capability; the monorepo diff is what remains.
2. **The monorepo diff is additive and thin — and zero in the daemon at P0.** P0: the daemon is **untouched** (the embedded Hub's trusted-client path is the stock local-client path, plan §14.6); the only monorepo diff is the CLI — new group directories + a workspace dependency + wiring in `createCli()`, inert against a stock Hub (the endpoints 404 clearly). P1 adds the grant engine: optional wire fields, one dedicated `server/grants/` module, additive hunks at upstream hook sites, and an optional supervisor module. `rg "COMPAT\("` is the complete list of sites that can differ from upstream in either phase.
3. **No dependency edge daemon → Hub package.** The daemon sees channel traffic only as stock client traffic — ordinary trusted-client RPCs from an ordinary trusted session, both forms (loopback for embedded, relay-paired for team/remote; plan §14.7). It cannot know or care that the Hub is running third-party channel code (plan §4-S3: "the daemon never learns *why* a call arrived"). A channel fault (including an event-loop hang) can take down the Hub; it can never reach the daemon or any agent session (plan §14.5, P13).
4. **Kill switches, split by phase, both verified in acceptance** (plan S7, §10): **P0** — Hub-side, three config levels plus the env flag: global env `CLISBOT_HUB_CHANNELS_ENABLED` > org-level `channels/policy.yml` `enabled` > per-channel `channels.<channel>.enabled` > per-account `enabled` (§4.3.2); the daemon needs none because it has no channel code (flag-off byte-equivalence is vacuously true). **P1** adds the daemon side: the grant engine is off-by-default and flag-gated; off, the daemon is byte-equivalent to upstream.
5. **Third-party bytes stay bounded even in-process** (plan §14.5 condition 1): per-channel install dir, integrity-pinned, own tokens only, load-trace-checked at load; the loader's resolve hook refuses anything outside the matrix allowlist, so a pinned channel cannot pull extra `openclaw/*` modules into the Hub process.

### 3.4 Upstream mergeability posture

- **Monorepo**: merge `upstream/main` as usual; the Clisbot diff is the `COMPAT`-tagged sites + `packages/hub` (a new directory upstream has no opinion about). At P0 the only monorepo diff is the additive CLI groups — the daemon is byte-identical to upstream. The P1 grant engine is promotion-ready per plan §14.1: dotted namespaces, `.request`/`.response` pairs, pure schemas, self-contained per-RPC diffs.
- **Hub package**: merge `getpaseo/hub` mainline into `packages/hub` on a cadence; the Clisbot diff is `src/channels/**` + the additive seams in §3.2. The modules are written to be liftable whole (plan §14.3 promotion order: `channels:` config block + multi-account → thread bindings + continuous execution → relay + ledger → approval engine).
- **Naming stays upstream's.** No renames of upstream concepts inside shared files. The only renames are package-level: `@clisbot/hub` (a new package's own `package.json` name) and the publish-time bin-key rename in the `@clisbot/cli` transform (§1.4) — both happen in files the upstream merge does not carry, so no import line or upstream-owned identifier ever enters the Clisbot diff.

## 4. Implementation details and notices

### 4.1 The vertical loader (in-process seam)

- Mechanism: `node:module` `register()` customization hooks (stable ≥20.6), one hook set per Hub process. All P0 channels pin the same main package (`openclaw@2026.7.1-2` in the initial pin manifest), so one alias table covers them.
- Resolve hook: `openclaw/plugin-sdk/<subpath>` → **bound** subpaths map to the `src/channels/loader/hosts/**` modules (inbound/outbound/state/gateway per the seam table, plan §7); **passthrough** subpaths resolve to the pinned main package inside the channel's install dir; anything else is a typed throw (T3Claw's unsupported pattern) — it fails the channel's account at load, never mid-conversation.
- Load hook: records every `openclaw/*` / `@openclaw/*` module loaded for that channel; at load completion the loader asserts the set ⊆ {channel's own dist + bundled `node_modules` + allowlisted pure subpaths} (plan §6 load-trace check). Telegram (bundled, inlined SDK, zero `plugin-sdk` imports) loads by `file://` URL against the installed main package and skips the alias surface entirely — the loader still records its load-trace (allowlist = its own dist dir).
- Host contract: each channel entry injects its runtime via its setter (`setSlackRuntime`, `setChannelRuntime` — verified on both). The "host runtime" object is the loader's bound-subpath provider; it exposes nothing but the seam surfaces.

### 4.2 Per-channel install and state layout

```
CLISBOT_HUB_DATA_DIR/          # default ~/.clisbot (the shared home; internal PASEO_HUB_DATA_DIR, §4.5)
  hub.db                       # PGlite (or Postgres via CLISBOT_HUB_DATABASE_URL, team form)
  secrets/                     # 0600 files referenced by secretRef
  channels/
    <accountId>/               # one dir per channel account
      openclaw@…/              # pinned main package (shared content-addressed, hardlinked)
      @openclaw/<channel>@…/   # the channel tarball, integrity-verified
      install.lock             # pin + integrity + install timestamp
```

The Hub's data dir is the shared home `~/.clisbot` by default (§4.5): the daemon and the Hub coexist in it without top-level entry collisions. Install is idempotent: re-running `channels add` for the same pin is a no-op; a pin bump is a fresh dir + cutover on the next Hub restart (module cache). `channels status` reports pin, integrity check, load-trace result, and transport state per account.

### 4.3 Configuration surface (review section — full shape + enums)

Channel configuration is a **directory, not a block**: authored files under `.paseo/channels/`, compiled by the fork's pass over the existing Hub compiler (plan S8). `hub.yml` and `workflows/` stay byte-identical to upstream: the upstream compiler rejects any unknown top-level key in `hub.yml` (`rejectResourceKeys`, hub `src/config/bundle.ts:238`) and one trigger per `workflows/<name>.yml` file — so there is no other compatible shape, and this keeps the Clisbot diff inside its own scope (P10).

```
.paseo/
  hub.yml                        # upstream, UNTOUCHED: name + environments + agents
  workflows/
    <name>.yml                   # upstream, UNTOUCHED: trigger/workflow executions
    partials/*.md
  channels/                      # Clisbot scope, NEW directory
    policy.yml                   # org scope: roles + assignments + defaults
    slack/
      work.yml                   # one file per bot account: channels/<channel>/<accountId>.yml
      personal.yml               # multi-account: a second Slack app on the same Hub
      ops.yml                    # (P0.5) webhook-transport variant
    telegram/
      personal.yml
```

Rules: an account file must live at `channels/<channel>/<accountId>.yml` and its `channel:`/`accountId:` keys must match the path (mismatch = compile error). `policy.yml` is a reserved filename, not a channel (precedent: `workflows/partials/` — the compiler treats it separately, it is not scanned as an account).

**Chat channels do not carry trigger blocks in account files.** A chat conversation either runs a *continuous agent session* (create + steer, plan §S2 execution model) or hands off to an existing upstream `workflows/<name>.yml`. A route expresses that with two mutually-exclusive keys — `agent` + `environment` for a continuous session, or `workflow` for a hand-off — never an inline trigger, which avoids duplicating the trigger block across accounts. §4.3.4 shows both, including how messages map to sessions and where replies land.

#### 4.3.1 `hub.yml` — all workspaces + all agents, defined once

```yaml
name: clisbot-hub
environments:                        # = workspaces
  repo-app:
    kind: daemon
    daemon: local
    cwd: /home/node/projects/shop-app
    worktree: { mode: branch-off, base: origin/main, newBranch: hub-app }
  repo-infra:
    kind: daemon
    daemon: local
    cwd: /home/node/projects/infra
  personal-lab:
    kind: daemon
    daemon: local
    cwd: /home/node/lab

agents:                              # = named agent profiles (upstream AgentSchema:
                                     #   provider, model?, mode?, thinkingOptionId?, options?)
  classifier:
    provider: codex
    options:
      approval_policy: never
      sandbox_mode: read-only
      web_search: disabled
  worker-app:
    provider: codex
    options:
      approval_policy: on-request
      sandbox_mode: workspace-write
      sandbox_workspace_write: { network_access: false }
  worker-infra:
    provider: codex
    mode: auto                       # preset ≈ on-request + workspace-write
  assistant-personal:
    provider: claude
    mode: acceptEdits                # Claude has NO approval_policy/sandbox_mode — it has mode
  telegram-butler:
    provider: claude
    mode: default                    # "Always Ask" — fits the approval-required posture
```

Channel files only **reference** these names (`routes[].agent`, `routes[].environment`) — one definition, many references. P0 does not support per-route inline agent overrides: the upstream compiler already forbids dynamic inline agent config in steps ("dynamic inline agent configurations are not allowed"), and a P1 override would extend the route schema, not redefine agents.

**The common channel case: one bot, one fixed folder, read-only or writable.** Most channel bots work a single checkout the whole time. That is just `environment` (the `cwd` + optional worktree in `hub.yml`) plus the agent profile's permissions — no channel-specific key:

- **read-only reviewer**: `environment` at the repo + a profile with `codex` `sandbox_mode: read-only` (or `mode: read-only`), so the session can inspect but not write;
- **writable coder**: `sandbox_mode: workspace-write` (or the Claude/Codex equivalent — §4.3.8 table). The session writes inside its `cwd` only; anything outside needs the provider's own permission prompt, which surfaces in the bound thread per S6.

The boundary is the provider's sandbox, not a channel switch: the channel config names the environment and the profile, and the profile's sandbox decides what the session may do in it.

#### 4.3.2 `channels/policy.yml` — org scope (roles, who holds them, defaults)

```yaml
enabled: true                    # org-level kill switch: false → this revision disables the
                                 # whole channel control plane (live reload, no restart)

channels:                        # per-channel kill switches; omitted = true
  slack: { enabled: true }
  telegram: { enabled: false }   # this revision stops every telegram account's transport,
                                 # ingress routes, and relay — without touching slack

# Roles: named privilege sets, no rank. Names are free; grants/deny/extends may only
# reference the privilege catalog (closed). Unknown role name in an assignment
# contributes nothing (fail-closed).
roles:
  user:
    grants: [bot.interact]
  approver:
    extends: [user]
    grants: [approval.*]              # may approve; may also trigger (extends user)
  operator:
    extends: [user]
    grants: [tool.*, approval.file, approval.command, "channel.tool.*"]
    deny: [approval.command.destructive]   # subtracts within this role only, never across extends
  admin:
    grants: [*]

# Users: one record per person; the username is the principal key.
# Each identity belongs to exactly one user (duplicate → compile error).
# Email is just another channel namespace: email:<address>.
users:
  long.luong:
    name: Long Luong
    identities: [slack:U0ALICE, telegram:123456789, email:long@acme.dev]
  minh.pham:
    name: Minh Pham
    identities: [slack:U0BOB, telegram:987654321]

# Assignments: org scope (all channels, all accounts).
# A value is either "user:<username>" (all of that user's identities) or a raw
# channel identity "<channel>:<provider-id>" (Slack "U…", Telegram numeric chat id);
# a raw identity that belongs to a user resolves to that user, so both forms
# grant the same principal. An identity in no user's list is its own
# (anonymous) principal.
assignments:
  - identities: [user:long.luong]     # = slack:U0ALICE + telegram:123456789 + email:…
    roles: [admin]
  - identities: [slack:U0BOB]         # mapped → user:minh.pham (all of Minh's identities)
    roles: [operator]
  - identities: [slack:U0CAROL]       # in no user's list → anonymous principal
    roles: [approver]

# Defaults: inherited by every account/route unless overridden
# (org defaults < account defaults < route overrides).
defaults:
  defaultRoles: [user]        # mapped identity with no assignment → these roles.
                              # [] = deny-by-default: only assigned identities may trigger.
  interaction:
    requireMention: true
    followUp: { mode: auto, ttlMinutes: 60 }
  binding: { key: thread }    # default: each native thread/topic → its own session (§4.3.4)
  reply: { anchor: thread }   # default: replies land in the thread the turn started in
  sync:
    finalAnswers: true
    progress: false
    toolCalls: false
    threadLink: final-only
  approval:                   # first-match rules; account/route rules are PREPENDED to this list
    - { match: command.destructive, mode: require, initiatorOnly: true }
    - { match: file, mode: auto-allow }
    - { match: "*", mode: require }
```

#### 4.3.3 Account file, full shape — `channels/slack/work.yml`

The file reads top-to-bottom in the order the Hub uses it: **identity** (what this bot is) → **`transport`** (how it talks to the provider) → **`policy`** (who holds which roles here) → **`defaults`** (how it behaves, inherited by every route) → **`routes`** (per-conversation overrides + target) → **`fallback`**.

```yaml
channel: slack                    # must match the directory
accountId: work                   # must match the filename
enabled: true                     # kill switch; false → new revision stops this transport
secretRef: ~/.config/clisbot/secrets/slack-work.json   # 0600: { botToken, appToken }

transport:                        # channel-native block, passed to the pinned vertical
                                  # (equivalent of OpenClaw channels.slack.accounts.work.*).
                                  # `channels add` materializes the vertical's full default
                                  # block here, so the file shows every knob — review it.
  mode: socket                    # socket | webhook (P0.5)
  errorPolicy: once               # delivery errors → chat: always | once | silent
  inlineButtons: dm               # P0.5 approval cards; P0 prompts are text + command

policy:                           # who holds which role in this account
  defaultRoles: [user]            # [] = deny-by-default; [user] = all mapped members may trigger
  assignments:                    # account scope: roles that apply ONLY in this bot;
    - identities: [user:minh.pham]  # values = user:<username> or a raw identity (§4.3.2)
      roles: [operator]

defaults:                         # account baseline for every route; inherits the
                                  # policy.yml defaults above. Every knob is restated so
                                  # the file is self-reviewable; values equal to the org
                                  # default are just spelled out, not overrides.
  interaction:                    # how the bot engages
    requireMention: true          # (org default) channel messages without a mention ignored
    followUp:
      mode: auto                  # auto: unmentioned follow-ups in a bound conversation
                                  #   keep steering the same session until it idles out;
                                  #   mention-only: every message must mention the bot again
      ttlMinutes: 60              # "idles out" = no turn for this long
  binding: { key: thread }        # which level gets its own agent session (§4.3.4);
                                  # thread is the org default — shown here so the file
                                  # reads as a full, reviewable config
  reply: { anchor: thread }       # where the bot's posts land (§4.3.4)
  sync: { threadLink: full }      # account override; other keys inherit policy defaults
  approval:                       # account rules, prepended to defaults (first-match)
    - { match: command.destructive, mode: require, initiatorOnly: true }

routes:                           # ORDERED; first match wins
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app             # → continuous agent session (the default target, §4.3.4)
    environment: repo-app         # the fixed folder the session works in (hub.yml)
    template: team                # workspace template applied at first-mention mint
    policy:
      assignments:                # route scope — narrowest, additive
        - identities: [slack:U0CAROL]
          roles: [approver]
  - match: { kind: channel, ids: [C0INFRA] }
    agent: worker-infra
    environment: repo-infra
    binding: { key: channel }     # whole #infra = one session, incl. all its threads
    reply: { anchor: channel }    # ... and the bot posts at channel level, no threads
  - match: { kind: thread, ids: [C0THREAD] }
    workflow: infra-runbook       # → hand off to workflows/infra-runbook.yml
  - match: { kind: dm }
    agent: assistant-personal
    environment: personal-lab
    template: personal

fallback: { deny: true }          # conversation matches no route → silent
                                  # (or: fallback: { agent: ..., environment: ... })
```

Rules for `routes[]`: exactly one of `agent` (+ `environment`) or `workflow` — a route either drives a continuous agent session or hands off to an existing workflow; on a workflow route the session keys are absent. Every `defaults:` key (`binding`, `reply`, `interaction`, `sync`, `approval`) may be overridden per route; route `policy.assignments` add to the account's. A message admitted into a running session is **steered** into the active turn (the daemon's `activeTurnBehavior: "steer"`); queueing behind a turn is not a P0 behavior.

#### 4.3.4 Mapping messages to sessions — `binding` and `reply`

The two keys that decide "how many sessions does this conversation create, and where does the bot post" are `binding.key` and `reply.anchor`, both in `defaults` (overridable per route).

This is a distillation of the two reference implementations, each of which bakes the thread/topic into the session key **per channel, by that channel's own native mapping** — i.e. the native thread is the unit by default, on every channel. OpenClaw computes an agent session key per conversation: Telegram forum group → peer id `<chatId>:topic:<topicId>`, so every topic (including General, id 1) is its own session; Slack thread reply → `…:channel:<id>:thread:<ts>` (a top-level channel message stays on the per-channel session, and Slack DM threads are *not* a boundary); Discord thread → its own channel id; Telegram plain-group reply → the replied-to root message. The split is structural — the thread/topic id is in the key, and there is **no config that collapses a conversation's threads into one session** (its `dmScope` knob only reshapes DM keys). Replies land back in the originating thread/topic (`message_thread_id` for Telegram topics; General is sent as a plain chat message because Telegram rejects `thread_id=1`; Slack `thread_ts`; Discord thread channel), and a different axis, `replyToMode` (`off`/`first`/`all`/`batched`), only decides whether the reply additionally *quotes* the triggering message. T3Claw's host keeps the same two axes as runtime objects: an `external_thread_key` built from the conversation (the topic id for Telegram topics, the thread root `ts` for Slack threads, the peer id for DMs) and a `thread_binding` row — one external thread ↔ one agent thread, the outbound reply reconstructed from the stored row so it posts back into that same thread. The fusion keeps the same per-channel native mapping but lifts the decision into two **channel-generic config keys**: `binding.key` is the granularity axis (where OpenClaw and T3Claw are fixed per-thread, the fusion makes it selectable so `channel` can collapse a whole conversation into one session) and `reply.anchor` is the reply-location axis (both references default to "the thread"; `channel` is the new option). Each channel's vertical translates the generic values to its native structures (the mapping table below); both default to "the thread is the unit," the shape every channel-native use case wants.

**`binding.key` — the level at which one agent session is kept.** The Hub records one durable **thread binding** per key; a follow-up message resumes the bound session instead of starting one (plan P3). The key is built from the native conversation shape. The values are channel-generic: `thread` and `channel` are the channel's two native conversation levels, and each channel maps them to its own structure:

| Channel | `thread` means | `channel` means |
| --- | --- | --- |
| Slack | a message thread (thread root `ts`) | the channel / MPIM |
| Telegram | a forum topic (`message_thread_id`) | the group / supergroup |
| Google Chat | a message thread | the space |
| Discord | a thread channel (its own id under the parent channel) | the parent channel / category |
| Zalo | — (no thread level) | the conversation (`thread` behaves as `channel`) |
| DMs on any channel | — (no thread level) | the DM peer |

| `binding.key` | Sessions | The binding key is | Use when |
| --- | --- | --- | --- |
| `thread` (default) | one per native thread/topic | conversation id **plus** native thread id | each conversation thread is its own unit of work (the default; matches OpenClaw's per-topic session keys and T3Claw's `thread_binding`) |
| `channel` | one per conversation | conversation id only — threads collapse into it | one running session per Slack channel / Telegram group regardless of which thread a message arrives in |
| `dm` | one per peer | the DM peer (no thread level on DMs; `thread` and `dm` behave the same there) | stated explicitly to document intent |

**`reply.anchor` — where the bot's outbound posts land.** The inbound side (which session a message reaches) and the outbound side (where replies are posted) are independent, and channel-generic in the same sense: `thread` is "the native thread the turn started in" and `channel` is "the conversation root", each resolved by the channel's own posting API:

| `reply.anchor` | Outbound posts go to |
| --- | --- |
| `thread` (default) | the native thread of the message that started the turn — Slack thread reply (`thread_ts`), Telegram `message_thread_id`, Google Chat reply-in-thread, Discord thread channel |
| `channel` | the conversation root / channel level — replies never open or use threads |

Four working configurations, each a `defaults:` block:

| `binding.key` | `reply.anchor` | Effect |
| --- | --- | --- |
| `thread` | `thread` | **Default.** One session per thread/topic; replies stay in the thread. The Telegram-group-with-topics / Slack-thread use case. |
| `channel` | `channel` | **One session per whole channel**; every thread in it (and channel-level messages) is one continuous session; replies post at channel level. The "bot owns this channel" use case. |
| `channel` | `thread` | One session per channel, but the bot answers in the thread the message came from. Memory is shared across the channel's threads; the reply follows the asker. |
| `thread` | `channel` | One session per thread, but replies post at channel level. Rare; kept so both axes are independently configurable. |

Worked example — Telegram forum group where each topic is a separate task but the bot answers at the top of the group:

```yaml
# channels/telegram/support.yml
defaults:
  binding: { key: thread }   # topic -100245 → session A, topic -100377 → session B, …
  reply:   { anchor: channel }
```

Worked example — Slack `#infra` where the operator wants one long-running session for the whole channel, no threads:

```yaml
routes:
  - match: { kind: channel, ids: [C0INFRA] }
    agent: worker-infra
    environment: repo-infra
    binding: { key: channel }
    reply:   { anchor: channel }
```

Interaction with `target`: a route's `workflow` target is unaffected — the workflow execution owns its own session lifecycle, so `binding`/`reply` apply only to `agent` routes. `interaction.followUp.mode` still gates *whether* an unmentioned follow-up is admitted into the bound session; `binding` decides *which* session it lands in.

#### 4.3.5 Variants — the rest of the cases

`channels/slack/personal.yml` — **multi-account on one channel** (a second Slack app; `channels add` verifies the app/team identity against the API and refuses an `appId` that already belongs to another account — one app driving two Socket Mode sessions delivers events non-deterministically):

```yaml
channel: slack
accountId: personal
enabled: true
secretRef: ~/.config/clisbot/secrets/slack-personal.json
transport: { mode: socket }
policy:
  defaultRoles: []              # deny-all: only assigned identities may trigger
  assignments:
    - identities: [slack:U0PERSONAL]
      roles: [admin]
defaults:
  binding: { key: dm }          # one session per DM peer; reply.anchor is a no-op for DMs
routes:
  - match: { kind: dm }
    agent: assistant-personal
    environment: personal-lab
    template: personal
fallback: { deny: true }
```

`channels/slack/ops.yml` — **webhook transport (P0.5)**; secret file = `{ clientId, clientSecret, signingSecret }`:

```yaml
channel: slack
accountId: ops
enabled: true
secretRef: ~/.config/clisbot/secrets/slack-ops.json
transport:
  mode: webhook
  webhookPath: /channels/slack/ops/webhook     # per-account ingress route (§4.4), auto-registered
# ... policy / defaults / routes as above
```

`channels/telegram/support.yml` — **Telegram, polling, multi-surface** (forum topics = their own sessions; the bot answers at the top of the group):

```yaml
channel: telegram
accountId: support
enabled: true
secretRef: ~/.config/clisbot/secrets/telegram-bot-token.json   # { botToken }
transport:
  mode: polling                # polling (P0) | webhook (P0.5)
  errorPolicy: once
policy:
  defaultRoles: [user]
defaults:
  interaction: { requireMention: false, followUp: { mode: auto, ttlMinutes: 120 } }
  binding: { key: thread }     # each topic -100… → its own agent session (§4.3.4)
  reply: { anchor: channel }   # ... but replies post at the group root, not in-topic
routes:
  - match: { kind: dm, ids: [123456789] }
    agent: telegram-butler
    environment: personal-lab
    template: personal
  - match: { kind: group, ids: [-1001234567890] }
    agent: worker-app
    environment: repo-app
fallback: { deny: true }
```

*(P0.5 Google Chat / Zalo: same shape; secret = the whole service-account JSON file; `transport.mode: webhook`. Google Chat spaces have message threads → `binding.key: thread`; Zalo has no threads → `binding.key: channel` is a no-op.)*

**Secret-file contents per channel/transport** (0600 JSON object, channel-native field names):

| Channel / transport | Fields |
| --- | --- |
| Slack socket | `botToken`, `appToken` |
| Slack webhook | `clientId`, `clientSecret`, `signingSecret` |
| Telegram polling | `botToken` |
| Telegram webhook | `botToken`, `webhookSecret` |
| GitHub App | `appId`, `clientId`, `clientSecret`, `privateKey`, `webhookSecret` |
| Discord | `applicationId`, `clientSecret`, `botToken` |

Operator-managed location is XDG (`~/.config/clisbot/secrets/`, `channels add --secret-file`); the Hub mirrors into `<CLISBOT_HUB_DATA_DIR>/secrets/` under its ownership. No token ever appears in any yml.

#### 4.3.6 Enums, per file (closed sets)

`hub.yml` (upstream schemas, verbatim):

| Key | Values | Meaning |
| --- | --- | --- |
| `environments.*.worktree.mode` | `branch-off` \| `checkout-branch` \| `checkout-pr` | run in a worktree: new branch from `base` (`newBranch`, supports expressions) / existing branch / a PR |
| `agents.*.provider` | `claude`, `codex`, `copilot`, `opencode`, `pi`, … | Paseo provider (see §4.3.8 options table) |
| `agents.*.mode` | provider-specific (see §4.3.8) | provider operational mode |

`channels/policy.yml`:

| Key | Values | Meaning |
| --- | --- | --- |
| `enabled` | bool | org-level kill switch; `false` disables the whole channel control plane on the next revision |
| `channels.<channel>.enabled` | bool (default `true`) | per-channel kill switch; `false` stops every account of that channel (transports, ingress routes, relay) |
| `users.<username>` | `{ name?, identities[] }` | one user record; the username is the principal key; each identity belongs to exactly one user |
| `assignments[].identities` | `user:<username>` or raw `<channel>:<id>` | raw identities resolve to their user when mapped; unmapped ones stay anonymous principals |
| `roles.*.grants` / `deny` | privilege names + wildcards `*`, `<family>.*` | from the privilege catalog (§4.3.7) |
| `roles.*.extends` | role names | compose privileges; no rank |
| `defaults.defaultRoles` | role list | roles for a mapped identity with no assignment; `[]` = deny-by-default |
| `defaults.interaction.requireMention` | bool (default `true`) | org default: ignore channel messages without a mention |
| `defaults.interaction.followUp.mode` | `auto` \| `mention-only` (default `auto`) | org default follow-up behavior (§4.3.4) |
| `defaults.interaction.followUp.ttlMinutes` | int (default `60`) | org default idle window |
| `defaults.binding.key` | `thread` \| `channel` \| `dm` (default `thread`) | org default session granularity (§4.3.4) |
| `defaults.reply.anchor` | `thread` \| `channel` (default `thread`) | org default reply location (§4.3.4) |
| `defaults.sync.finalAnswers/progress/toolCalls` | bool | which timeline slices relay into the thread |
| `defaults.sync.threadLink` | `full` \| `final-only` \| `none` | link that opens the session in the client / link with the final answer only / no link |
| `approval[] .match` | tool class / privilege + `*` wildcards | first-match; a `match: "*"` fallback rule is required |
| `approval[] .mode` | `auto-allow` \| `auto-deny` \| `require` | run without asking / always refuse / prompt in the bound thread (two authority checks) |
| `approval[] .initiatorOnly` | bool | only the thread's initiator may approve |

Account files (`channels/<channel>/<accountId>.yml`):

| Key | Values | Meaning |
| --- | --- | --- |
| `enabled` | bool | kill switch; false stops the transport on the next revision |
| `transport` — slack `mode` | `socket` \| `webhook` | Socket Mode (P0) / HTTP events (P0.5, plus `webhookPath`) |
| `transport` — telegram `mode` | `polling` \| `webhook` | long-polling (P0) / webhook (P0.5) |
| `transport` — `errorPolicy` | `always` \| `once` \| `silent` | (+`errorCooldownMs`) how delivery errors surface in the chat |
| `transport` — `inlineButtons` | `off` \| `dm` \| `group` \| `all` \| `allowlist` | P0.5: where native approval cards may appear |
| `policy.defaultRoles` | role list | account-level roles; `[]` = deny-by-default |
| `policy.assignments` | `{ identities, roles }` list | roles that apply only in this account |
| `defaults.interaction.requireMention` | bool (default `true`) | ignore channel messages without a mention |
| `defaults.interaction.followUp.mode` | `auto` \| `mention-only` | `auto`: unmentioned follow-ups steer the bound session until it idles; `mention-only`: every message re-mentions |
| `defaults.interaction.followUp.ttlMinutes` | int | idle window for `followUp.mode: auto` |
| `defaults.binding.key` | `thread` \| `channel` \| `dm` | level that gets its own agent session (§4.3.4) |
| `defaults.reply.anchor` | `thread` \| `channel` | where the bot's outbound posts land (§4.3.4) |
| `defaults.sync.*` / `defaults.approval` | same as `policy.yml` defaults | account overrides |
| `routes[].match.kind` | `dm` \| `channel` \| `thread` \| `group` \| `topic` | conversation kind; `ids` = native provider ids |
| `routes[].agent` + `environment` | names into `hub.yml` | the route runs a **continuous agent session** (the default target, §4.3.4) |
| `routes[].workflow` | name under `workflows/` | the route hands off to that workflow; mutually exclusive with `agent` |
| `routes[].binding` / `reply` | same as `defaults` | per-route override of session mapping / reply location |
| `fallback` | `{ deny: true }` \| route object | no route matched → silent / catch-all route |

#### 4.3.7 Open vocabulary (referential, not enum)

| Key | Validation |
| --- | --- |
| role names | free; grants/extends checked against the privilege catalog; unknown → contributes nothing |
| `users.<username>` | free (lowercase, dot-separated); the principal key |
| `users.*.identities` | `<channel>:<provider-id>` — email is `email:<address>`; each identity belongs to exactly one user |
| `assignments[].identities` values | `user:<username>` (must exist) or raw `<channel>:<id>` (a mapped one resolves to its user; unmapped → anonymous principal) |
| `agent` / `environment` | must exist in `hub.yml` |
| `template` | built-in catalog (`coding`, `assistant`, `team-assistant`) or `$CLISBOT_HOME/templates/<id>` |
| `routes[].workflow` | must exist under `workflows/` |
| `channel` / `accountId` | must match the file path; unique pair; one Slack app ↔ one account (socket) |
| `secretRef` | 0600 file; Hub-owned after mirror |

**Privilege catalog** (closed): `bot.interact` (may start/take part in a conversation) · `approval.file` / `approval.config` / `approval.command` / `approval.command.destructive` / `approval.channel` (may approve that tool class) · `tool.*`, `channel.tool.<name>` (P1 channel agent tools) · `*`. Algebra: `extends` composes without rank; `*` and `<family>.*` wildcards; `deny`/`!x` subtract within the same role only; unknown role names contribute nothing (fail-closed); effective privileges are **recomputed on every message**, so an edit is effective from the next message, no reload.

**Decision flow (precedence):** the sender's channel identity first resolves to a principal — its user when mapped, otherwise itself — then effective roles = union of assignments (org ⊕ account ⊕ route, additive) + inherited `defaultRoles` (policy < account < route). Trigger requires effective `bot.interact`. Approving a prompt requires the responder's effective `approval.<class>` AND the merged rule list (route prepended → account prepended → defaults) not auto-denying the class, plus `initiatorOnly` when set. `binding`, `reply`, `interaction`, and `sync` deep-merge with the same precedence (defaults < account < route); `approval` rules merge by prepending. Routes: declaration order, first match; `fallback` last.

**Invariants (not configurable):** channel-originated sessions are `approval-required` (plan S10) — routes may relax per tool, never lift the posture. RBAC is the single "who may trigger/approve" gate; transport-level allowlists (`allowFrom`-style) are not a second axis. `hub.yml` and `workflows/` gain no keys. Kill switches: four levels, any one of which stops the rest — global env flag (disables the whole control plane) > org-level `channels/policy.yml` `enabled: false` > per-channel `channels.<channel>.enabled: false` (stops every account of that channel) > per-account `enabled: false`. The three config levels are revision changes, no restart; the env flag needs a restart.

#### 4.3.8 Agent `options` by provider — centralized

`options` is the provider's native contract (Hub passes it through; the daemon validates against the provider's strict schema — `docs/providers.md`). The table below is what each profile in `hub.yml` may set. "Mode" values are what `agents.*.mode` may take; "Options" what `agents.*.options` may contain.

| Provider | `mode` values (plain meaning) | `options` (keys a Hub profile uses) |
| --- | --- | --- |
| **codex** | presets: `read-only` (ask + read-only sandbox) · `auto` (ask + workspace-write) · `auto-review` (ask + workspace-write, reviewer subagent) · `full-access` (never ask, full sandbox) | `approval_policy`: `never` (ask nothing — agent runs unattended) · `on-request` (ask whenever the agent wants to act; this is what a human-in-the-loop session needs) · `untrusted` (stricter asks on untrusted repos) · or `{ granular: { sandbox_approval?, rules?, mcp_elicitations?, request_permissions?, skill_approval? } }` (toggle asking per category). `sandbox_mode`: `read-only` / `workspace-write` / `danger-full-access`. `sandbox_workspace_write.{writable_roots, network_access, …}`. `web_search`: `disabled`/`cached`/`indexed`/`live`. `features.multi_agent_v2` |
| **claude** | `plan` (analyze, no edits) · `default` ("Always Ask" — prompts on first use of each tool) · `acceptEdits` (auto-approve file edits, ask for the rest) · `auto` (a model classifier answers permission prompts) · `bypassPermissions` (no prompts — use with caution) | NO `approval_policy`/`sandbox_mode`. Instead: `allowedTools`/`disallowedTools`, `additionalDirectories`, `sandbox` (filesystem read/write + network domain allow/deny lists), `settings` (native `permissions.{allow,ask,deny}` + sandbox settings) |
| **opencode** | `build` (edits + tool execution) · `plan` (read-only planning) — provider may discover more modes at runtime | `permission`: one `ask`/`allow`/`deny` action, or the native per-tool rule object over `read, edit, bash, task, webfetch, websearch, codesearch, repo_clone, …`. OpenCode permissions are application policy, not an OS sandbox |
| **copilot** (ACP) | `agent` (conversational default) · `plan` (multi-step plans) · `allow-all` (auto-approve every tool/path/URL request) | provider features via config options (e.g. custom agent profile `agent`); no options schema beyond ACP config |
| **cursor** (ACP, generic) | no static mode list — modes come from the ACP session at runtime | none in `hub.yml`; the only first-class feature today is `fast` (Cursor fast mode) as a provider feature, not a profile option |
| **grok** (xAI, custom ACP) | not a built-in provider — add via `config.json` `extends: "acp"` (see note under the table); modes come from the CLI at runtime through ACP | none in `hub.yml`; auth lives in `~/.grok/auth.json` (quota fetcher reads it) |
| **pi** | no permission modes (model-centric provider) | model + reasoning effort only (reasoning: `off/minimal/low/medium/high/xhigh/max`) — no approval/sandbox surface of its own |

*Grok (xAI) is not a built-in provider — it is configured like any ACP-capable coding CLI via `docs/custom-providers.md`: a `grok` entry under `agents.providers` in `$CLISBOT_HOME/config.json` with `extends: "acp"` + the CLI `command` (Hub's `provider:` is a free string, `AgentSchema`; the daemon resolves built-in and custom providers alike). In-repo evidence that the toolchain expects the Grok CLI on the machine: the quota fetcher reads `~/.grok/auth.json` (`services/quota-fetcher/providers/grok.ts`), so the usage badge works once the CLI is installed and authenticated. Modes/options: surfaced by the binary at runtime through ACP, none declared statically in `hub.yml` — same posture as cursor. All custom/ACP providers follow their binary's own contract (`docs/custom-providers.md`).*

**Hub's unattended-execution rule** (`docs/providers.md`): a provider must fail closed for unattended runs until it can pre-approve one exact injected MCP server + tool without approving native tools — the `approval.*` privileges above are the channel-side expression of that boundary.

#### 4.3.9 Live reload + secrets

- Live reload: policy/routes/accounts reload on a new compiled revision without restart; adding/removing/bumping a channel install requires a Hub restart (module cache) — the supervisor's job (§2 notice).
- Secrets never enter the bundle: `secretRef` → 0600 file, Hub-owned after mirror (§4.2 `secrets/`). Rotating a token keeps the same app identity → hot via new revision; replacing the app (new `appId`) → restart, because the transport session is per-app.

### 4.4 Ingress (webhook channels, P0.5)

Per-account routes on the Hub's existing web server (the surface that already serves `/webhook` and `/api/integrations/slack/events`): `POST /channels/<channel>/<accountId>/webhook`. The route hands the raw payload to the channel's own signing checks (`webhook-request-guards`, in the loader's bound-subpath path) **before** the verified typed event reaches the trigger-run dispatch — the check boundary is a function boundary now, but it is the same ordering the child-process design enforced across IPC. Socket Mode / polling channels open no port; only webhook channels add routes. Team form: the Hub is already publicly reachable; single-machine: operator reverse-proxy/tunnel in front (plan §14.2).

### 4.5 Environment namespace and homes (fork defaults)

The fork changes two things operators actually type: the env prefix is `CLISBOT_` (not `PASEO_`), and the default home is `~/.clisbot`. Both are fork-owned, both stay mergeable, and neither requires the operator to remember a new variable for the local path.

**The `CLISBOT_` → `PASEO_` alias shim.** Operators set `CLISBOT_*`; the internal code keeps reading upstream `PASEO_*` names. Renaming every `process.env["PASEO_…"]` read across the forked Hub and the upstream daemon would be a large diff that re-fights on every `upstream/main` / `getpaseo` merge, so the namespace is aliased at the boundary instead of renamed in place. One small module (a fixed table, applied at each process entry — the `clisbot` CLI at every spawn and local verb, and the Hub's own entry for the deployed form) copies `CLISBOT_X` into `PASEO_X` when `PASEO_X` is unset. `PASEO_X` set explicitly always wins; `CLISBOT_X` only fills the gap. The table:

| Operator sets | Maps to (internal) | Default | Meaning |
| --- | --- | --- | --- |
| `CLISBOT_HOME` | `PASEO_HOME` | `~/.clisbot` | daemon home |
| `CLISBOT_HUB_DATA_DIR` | `PASEO_HUB_DATA_DIR` | `~/.clisbot` (the shared home) | Hub data dir |
| `CLISBOT_HUB_DATABASE_URL` | `DATABASE_URL` | unset (embedded PGlite) | team-form Postgres |
| `CLISBOT_HUB_CHANNELS_ENABLED` | `PASEO_HUB_CHANNELS_ENABLED` | on | channel kill switch (supervisor env, restart) |
| `CLISBOT_HUB_BIND` | `PASEO_HUB_BIND` | `127.0.0.1` (loopback, not upstream `0.0.0.0`) | Hub listen address |
| `CLISBOT_HUB_URL` / `CLISBOT_HUB_API_KEY` | `PASEO_HUB_URL` / `PASEO_HUB_API_KEY` | — | team/remote Hub target (local verbs auto-discover, below) |

**Shared home `~/.clisbot`.** The daemon (`CLISBOT_HOME`) and the Hub (`CLISBOT_HUB_DATA_DIR`) both default to `~/.clisbot` — one directory, two writers, no conflict (verified: the daemon writes `agents/`, `projects/`, `worktrees/`, `config.json`, `daemon.log`, …; the Hub writes `hub.db`, `secrets/`, `channels/`, `.paseo-hub.lock` — no top-level entry overlaps). Upstream kept them separate (`~/.paseo` and `$XDG_DATA_HOME/paseo-hub`); the fork merges them so there is one mental home and one place to back up. The **project-local** `.paseo/` config dir (CWD-relative, upstream-defined: `hub.yml` + `workflows/` + `channels/`, `bundle-contract.ts`) is a different thing — it lives in the operator's project repo, not the machine home, and keeps the `.paseo` name. Do not conflate the machine home with the project config dir.

**Local Hub auto-discovery — no `CLISBOT_HUB_URL` / `CLISBOT_HUB_API_KEY` to set.** `clisbot hub start` binds loopback on port **6868** (the fork's default port, distinct from upstream's 3000) and writes a `hub-local.json` state file in the home recording the URL and pid. The local verbs (`hub init`, `channels …`, `users …`) read that file to find the Hub — the operator types no URL and no key. The name is distinct from the daemon's `hub-relationship.json` (the daemon-side enrolled-hub record), so both can live in the shared home without confusion. Auth: the embedded control plane trusts loopback clients (the Hub binds loopback, so only local clients reach it — the Hub's existing `resolveClientAddress`/`trustedClientIpHeader` loopback-trust mechanism), so the local state file carries no secret. The Hub still auto-generates and persists its auth secret in `hub.db` (`runtime_configuration`), and that secret is the credential for the **team/remote (non-loopback)** form, where the operator points the CLI at the Hub with `CLISBOT_HUB_URL` (+ `CLISBOT_HUB_API_KEY`) — the same flag → env → stored-login precedence as upstream, `CLISBOT_`-prefixed.

**`CLISBOT_HUB_DATABASE_URL` keeps a leaked shell `DATABASE_URL` out of the embedded form.** The embedded `hub start` runs PGlite unless `CLISBOT_HUB_DATABASE_URL` is set, and it controls `DATABASE_URL` in the spawned Hub explicitly (set from `CLISBOT_HUB_DATABASE_URL` when present, else unset) — so an ambient shell `DATABASE_URL` pointing at an unrelated dev Postgres cannot silently switch the embedded Hub into team mode. The deployed/team form reads `DATABASE_URL` from its own controlled env as usual.

**Kill switch + team-form env.** `CLISBOT_HUB_CHANNELS_ENABLED` is read by the Hub at startup and belongs in the supervisor's environment (systemd/`pm2`); it is a process-level "load the channel code at all" switch, so changing it needs a restart. The three config levels under it (§4.3.2) live-reload with the revision. Precedence, any one of which stops the rest: global env flag > org-level `channels/policy.yml` `enabled` > per-channel `channels.<channel>.enabled` > per-account `enabled`. Team-form bootstrap vars (registration / organization creation) may be set in the embedded form without harm — the embedded P0 defaults (registration closed, one operator account) are just the single-machine setup, and no embedded-only gating is needed.

### 4.6 Notices

1. **`@clisbot` is the only public face of this fork, and `@getpaseo` is never it.** This repo publishes exclusively under the `@clisbot` scope (publish-time rename, §1.4). A `@getpaseo/*` package that is not published by upstream Paseo is impersonation — treat any such resolution as a supply-chain incident. Equally, only `scripts/publish-clisbot.mjs` may rename packages for publishing; a hand-published `@clisbot/*` that skipped the staging smoke test is unverified output.
2. **The supervisor is part of P0 acceptance, not a nicety** (plan §14.5 condition 2): in-process means a channel hang kills the Hub and nothing inside it can restart it. Acceptance (§10 of the plan) includes the demonstrated kill/restart/resume case with no double-post.
3. **Two wire-schema sources must stay in lockstep** (§3.2): vacuous at P0 (no new RPC on either side, and no form uses the `hub.execution.*` schemas — both forms reuse the existing trusted-client schemas, plan §14.7); every **P1** grant-engine wire addition is a two-sided change (monorepo `packages/protocol` + Hub `src/hub/protocol.ts`) with matching `COMPAT` tags; the conformance test fails CI on drift.
4. **Node floor is 22** for the whole onboarding path: module customization hooks need ≥20.6, and the monorepo pins 22.20.0 — one version for the daemon and the Hub.
5. **Data-dir separation from an upstream Hub.** The Clisbot Hub defaults to `~/.clisbot` (internal `CLISBOT_HUB_DATA_DIR` → `PASEO_HUB_DATA_DIR`, §4.5) and port 6868; an upstream `paseo-hub` defaults to `$XDG_DATA_HOME/paseo-hub` and port 3000. The fork's defaults are disjoint, so an upgrade (one Hub, data dir moved to `~/.clisbot`) is clean. Pointing two Hub instances at the *same* data dir is not supported — one Hub owns a data dir; parallel instances need distinct `CLISBOT_HUB_DATA_DIR` (and the one-owner-per-account rule, plan §11, still applies across instances).
6. **The Hub build is not in `build:server`.** Desktop/mobile/daemon builds do not pay for the Hub's `vite build`; `build:hub` is explicit (§1.2).
7. **e2e tests are cross-repo by design.** The Hub's e2e harness (`src/e2e/harness/`) spawns a real monorepo daemon; fork CI must build the monorepo stack before Hub e2e. At P0 the harness exercises the stock daemon — **both forms** connect through the existing trusted-client path (embedded over loopback, team/remote relay-paired, plan §14.7), so the harness pins no fork-added wire. From P1, any grant-engine daemon-side behavior the e2e asserts is pinned by the conformance test, not by the harness.
8. **Fork artifacts are identifiable by scope, not suffix.** Everything this repo publishes is `@clisbot/*` (upstream names survive only inside the fork's source tree and `npm link` dev installs). Diagnostics and support triage should report the installed scope + version (`@clisbot/cli@0.5.0`), so "is this machine running the fork or upstream" is a one-line answer. (The P1 grant engine's pairing-grant verification reports through the same channel: grant checks and their outcomes are daemon diagnostics, not a separate surface.)
9. **Third-party notices ship with the pin manifest.** Each channel's bundled `node_modules` licenses land in `THIRD_PARTY_NOTICES` at channel-add time (plan §9 step 7); the install step refuses a channel whose notices are missing.
10. **The OpenClaw supply stays public and pinned** (plan §14.4): no mirroring, no private registry for `openclaw`/`@openclaw/*`; the integrity pin is the trust boundary, and the fallback for a vanished pin is re-pin (CI proves it) or the public git repo at the recorded `gitHead`.
