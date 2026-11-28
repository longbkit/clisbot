# Paseo v0.17.4 promotion

Status: **candidate under acceptance** — not merged to `main`, not released. This file is
updated as gates complete; an unrun gate is never reported as passing.

Procedure: [upstream sync playbook](../../guides/developer-guide/upstream-sync-and-contribution.md).
Evidence (logs, batch decisions, screenshots): CTO workspace
`artifacts/evidence/paseo-v0.17.4-20261126/`.

## Inputs

| Role                       | Revision                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| Clisbot pre-merge (`main`) | `55398093e9564c1736f3d939c1423bb7127b2844` (2.2.5)                            |
| Previous sync merge        | `7c4446ad7d416374d6a84d26b8105e31e386d363` (Paseo v0.13.0)                    |
| Raw merge base             | `d34d17a9072149320ace35ec2a2e5c7dcd992cb3` (v0.13.0)                          |
| Paseo release              | `v0.17.4`, tag `a583aec72`, commit `2b3559b107243306986176b80beb0e779f9fe53e` |
| Transformed snapshot       | `c52e33823` on `sync/rebranded-v0.17.4`                                       |
| Promotion branch           | `sync/promotion-v0.17.4`                                                      |

694 upstream commits since v0.13.0; 432 Clisbot commits since the previous sync merge, including
the 11 private-Mac fixes (`a6f958a57..55398093e`). `packages/hub` (getpaseo/hub) is synced
separately and is not part of this promotion.

## Transform

The rename and branding scripts were adapted on the promotion branch first (`94933b49b`,
`ecf50198e`), then three more adjustments were made while the merge was in progress and land
with the merge commit:

1. **Hosted Hub docs** — v0.17.4 rewrote the English and Chinese CLI/Hub guides with a hosted
   default origin. Reviewed rules port them to the self-hosted contract (no hosted default; the
   CLI stops and asks for a Hub URL). `CLISBOT_REBRAND_COMPARISON_BASE=1` lets
   `normalized-base.sh` transform an older base that predates these rules; it is never used on a
   published snapshot.
2. **Canonical brand folder** — upstream v0.17 added `assets/brand/` (stroked butterfly and
   flower marks; lockups with outlined "Paseo" wordmarks) and renders the website header, Hub
   page and mockups from it. `scripts/branding/brand-assets.mjs` regenerates the folder from the
   Flow / Ocean 02 kit (filled Flow mark, lowercase Manrope lockups `clisbot`, `clisbot hub`,
   `hub`), switches the website brand component and its test to filled marks, and makes
   `assets/brand/build.mjs` regenerate through that generator. Consumers that only exist from
   v0.17 are skipped on older (normalized-base) trees. Parent accepted the visuals.
3. **Licenses** — upstream now ships byte copies of the root `LICENSE` in published packages.
   A copy gets the root treatment (scoped Clisbot notice + upstream text verbatim); every other
   `LICENSE` stays byte-for-byte. Previously the copies were renamed like prose.

Snapshot gates: rename `--check` and branding `--check` clean; oxfmt/oxlint 0/0; completeness
7,818 raw paths → 7,822 index paths, every missing/extra path explained (archived upstream blog
posts and divergent zh-CN guides, branding assets).

## Merge

Raw merge: 893 conflicts in 874 files. Against the normalized base: keep-Clisbot 105,
take-upstream 290, clean three-way 85, real conflicts 351 (3,147 hunks; 1,809 in
`package-lock.json`), one-sided 43. Conflicts were resolved in disjoint batches with per-file
decision logs; every batch was reviewed before staging.

Key decisions:

- **Versions and release path** — Clisbot 2.2.5 lineage kept; `scripts/npm-release.mjs` stays
  the release path. Upstream's release tooling (`publish-release-packages.mjs`, `release:ship`,
  reconcile) is present but not wired into root scripts.
- **CI** — Clisbot keeps pinned macOS images (macos-15 arm64; upstream's macos-26-intel for x64)
  and its Android module tests (upstream removed them in #8102).
- **Reanimated** — Clisbot's 4.5.1 stale-tag patch is retired for upstream's 4.5.5 backport of
  the official fix (Reanimated #10435); the install still fails on an unreviewed version.
- **Whole-turn timeline pages** — Clisbot's durable session storage and in-memory fallback now
  honor upstream's `wholeTurns` through `session-storage/timeline-page.ts` (upstream's retained
  projection), with bounded reads; `wholeTurnTimeline` is advertised.
- **Idle collectors** — Clisbot's idle-session reaper and upstream's idle runtime cleanup both
  run with one shared protection set (viewed timeline, pending delivery, steer) and separate close
  ownership; a race where the second collector threw instead of declining was fixed.
- **Managed Access** — reload keeps the managed-access mode; create/apply/set requests are judged
  on their effective provider options (legacy `featureValues`, `providerOptions`, apply `options`);
  agent-created children asking for auto-accept are refused.
- **Fork checkpoints** — Clisbot's refusal is kept for a copied row (message or tool call) that
  spans the fork checkpoint. Upstream #9627 copies such a tool call "as still running" from its
  latest payload, which carries output, metadata and status produced after the reply. That breaks
  Clisbot's integrity rule that nothing later than the reply reaches its fork. The bounded paged
  reader cannot prove the state at the checkpoint either. The in-memory store hands over
  already-projected rows, and older history may be unread. So #9627 is declined: forking from such a
  reply is refused, and the later completed reply forks. Upstream #8746 is adopted, because a fork
  never copies plugin cards and a later plugin update cannot reach it; both the full builder and
  the paged reader ignore plugin rows for the check. One Clisbot test changed its expected outcome
  for this, from refuse to accept-with-parity, deliberately. The other three fork-history tests
  keep their main expectations. New tests cover: no later result, log, metadata or text in a fork
  from an earlier reply; full/paged verdict parity under plugin noise; and bounded page sizes on a
  5,000-row scan. `itemCount` now counts only copied rows, which keeps the full and paged results
  equal. Supporting #9627 later needs the checkpoint-time state: canonical rows
  folded up to the checkpoint, and refusal when they are incomplete.
- **Sub-agent logs** — Upstream #8276 stopped curating `sub_agent.log`, since producers now send
  it empty. Clisbot keeps the log line (`COMPAT(subagent-log)`) so sessions stored by 2.2.x still
  show the child's activity in forks, schedule run output and MCP wait-timeout activity. Current
  producers send `log: ""`, so new sessions are unchanged.
- **Hub documentation** — upstream guides describing getpaseo/hub features that Clisbot's Hub
  does not have were not imported as Clisbot facts (details in the batch logs).

### Regressions found in acceptance and fixed

Each was reproduced first, fixed in this merge, and replayed. Parent logs are in the evidence
directory.

- **P0: a fresh Bot Chat crashed on desktop web at first render** ("No panel registration for kind:
  conversation"). Upstream #8093 moved panel registration out of every registry reader into the
  workspace screen, the only route upstream has that renders a reader. A Clisbot Chat
  (`ConversationWorkspace`) is a second such route and now registers the panels before its tab
  rows, panel hosts and sheet tabs render. A unit test fails without the call. Parent replay: cold
  direct and group Chats open (`parent-product-chat-closure.log`).
- **P0: configured Bot launch options were dropped.** Bot launch records keep `featureValues` on
  disk, on the wire and in the current Bot form. `BotSessions` passed them as `features`, which
  upstream renamed to `providerOptions` on agent creation. A conditional spread hid the rename from
  typecheck, so options like a provider mode stopped reaching new sessions. It now passes
  `providerOptions` as a plain property, so a future rename fails typecheck. New tests send a saved
  Bot's launch, and a 2.2.x per-chat launch read back from `chat.json` after restart and after
  `/new`, through the real create command; they fail on the old code. Parent replay: busy DM and
  group Chat browser runs pass from cold URLs (`parent-product-chat-closure.log`).
- **Hub owner-setup scan pointed at a removed route.** Upstream deleted `/pair-scan` for the add-host
  flow. Hub settings (owner setup and Connect) open that flow's scan step instead. A scanned Hub link
  now closes the add-host sheet before showing the Hub, where it previously stayed open over it.
- **Server test files are outside typecheck** (`tsconfig.server.json` excludes `*.test.ts`, as
  upstream does), so fakes written against renamed upstream APIs fail only when run (for example
  `agentStorage.list` → `listAll`). Focused suites are the check; renamed-API fakes found in this
  merge were updated.

### Compatibility points and behavior changes from the baseline gate

- **Observed agents for Clisbot lists.** Upstream changed `useAggregatedAgents({ demand: false })`
  to return no agents. Clisbot's Home inbox, Chat list and navigation lists read agents other
  screens already loaded through it, so Home showed "Nothing here yet". Those callers now pass
  `observe` (`hooks/use-aggregated-agents.ts`); upstream callers are unchanged. Covered by
  `use-aggregated-agents-observe.test.tsx` and the live Home check.
- **Per-tab sources in sheets.** Upstream moved sheet content into
  `screens/workspace/sheet-pane/` and dropped Clisbot's per-tab source, so a Bot Chat's file sheet
  read from the caller's Host. Each sheet tab uses its own source again; revoked targets are still
  denied before anything mounts.
- **Gateway recovery sweep.** A reconnect sweep started by a recovering Host no longer pings
  online Hosts (upstream contract); network and foreground sweeps still verify them.
- **Unseen errors only (upstream #8831).** Work and Chat rows show "failed" only for an error the
  user has not seen. Home's "Needs you" filter still counts an error the user has seen while its
  status dot shows done; this is left for a product decision rather than changed in the merge.
- **Chat slash commands.** A Chat's bare "/" lists `/new` (and provider commands when the Chat
  has a session) with nothing selected, so Enter and Tab on "/" run nothing; exact `/new` + Enter
  runs once and Tab only completes. A sessionless Chat does not wait on provider commands. The
  popover opens without a selection for that case only (`selectionOptional`); agent tabs keep
  upstream's search-first list.

### Rename check on the product tree

`rebrand-clisbot.mjs --check` on a product tree is compared by path and edit with the same check
on pre-merge `main` (each revision with its own transform), not by count. Intentional differences:

- `packages/channels/whatsapp/LICENSE` (main only): licenses are no longer renamed like prose.
- Legacy plugin SDK guard: upstream moved the unknown-SDK check from `compiler.ts` to
  `plugins/compiler-build.ts`. The candidate keeps the deliberate legacy `@paseo/plugin` scope in
  that check, so a plugin importing the old scope still gets "Unknown SDK". The rename would
  collapse it into a duplicate `@clisbot/plugin` test; do not apply it.
- The website registry fixture differs because upstream changed the fixture.
- In-flight wording that only named the upstream product was rephrased.

The final exact candidate is compared again before submission.

### Survival notes

Tracked separately from the rename check. Verified on this tree:
`eb74b578e` (client slash-command coverage) — the flagged lines are its fixtures moving from
`features` to option controls and expected `featureValues` to `providerOptions`, with the same
values; the eight client-slash-command tests pass. `d5175d574` autocomplete selection and
`d7c3dee71` Claude model pin survive in upstream's restructured code (render-time selection tied to
query and side; `modelPin` in the flag-settings update). Full classification is attached to the
final candidate.

## Product review

Judged against [product vision](../../overview/product-vision.md): an incoming Paseo capability
counts as a gain when someone can reach it from where they started, keep their session and
permission choices, and continue on the right Host or channel. Journeys below were observed on
isolated loopback daemons built from this candidate and from pre-merge `main` (evidence:
`live/`, `parent-product-*`, `parent-channel-*` in the CTO evidence directory). Nothing was sent
to an external service.

### What users gain from Paseo v0.13 → v0.17.4

- **Turn and session stats** under each reply (time, tokens, cost) and **fork from a reply** into a
  new tab or workspace, carrying the chat history. Observed: a forked Work session answered from
  the earlier conversation.
- **Background tasks and heartbeats** above the composer, **agent-to-agent steering**, and agent
  messages that wait for the current turn.
- **Plugin gallery**, plugin sidebar views and composer controls; **command center tabs**;
  **provider update/status** in Settings; **quota forecasts**; **watch PRs/MRs**.
- **Rebuilt native chat (LegendList).** An older message stayed in the same place while a reply
  streamed on the iPhone simulator and Android emulator. Leaving and reopening that session
  returned both devices to the latest reply. Pre-merge Android behaved the same way.
  In a separate test with 200 synthetic question/answer pairs, each device loaded 20 older rows
  above a stationary reader. Across two insertions per device, the measured reply moved at most
  1 physical pixel on Android and less than 1 point on iOS. A fixture-only pause in the Debug
  client allowed the native accessibility measurements to bracket each insertion.
- **Keyboard shortcuts on tablets**, touch-sized controls, existing-worktree workspaces and
  undo for workspace archive.
- **Chat display** choices (full, collapse tool calls, collapse turns) beside Clisbot's
  latest-call grouping, which stays the default.

### Clisbot workflows that survived

| Workflow                                                        | Observed                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a Bot (template, role, provider) and chat in its DM      | UI create → first message → real Codex reply; options reach the session (saved, reloaded and `/new` cases tested)                                   |
| Group and direct Chats in order while a turn runs               | Parent browser replays pass from cold URLs                                                                                                          |
| Home inbox of sessions that need attention or changed           | Lists CLI, Bot and fork sessions; opens the right workspace                                                                                         |
| Bot Chat `/new` and safe slash behavior                         | Sessionless and Codex-bound Chats; Enter/Tab on bare `/` inert                                                                                      |
| Schedules                                                       | Created from the Schedules page; active with next run                                                                                               |
| Channel message → Bot → approval → reply in the same thread     | Real Hub channel plane + password-authenticated Host, loopback Slack/Telegram; approval card resolved by the authorized initiator, one final answer |
| Managed Access, Hub docs truth, Clisbot branding, Vietnamese UI | Security tests; docs reconciled; tour screenshots                                                                                                   |
| Fork-checkpoint integrity                                       | Later results never enter a fork from an earlier reply                                                                                              |

The packed CLI also completed operator login with a disposable organization owner. A fresh CLI
process reported the enrolled Host as connected, disconnected it through the Hub, and read back
the disconnected state. The loopback E2E fixture needed its canonical browser origin and the
management API used by the production Host ticket flow. Evidence for this working-tree run is
in `parent-packed-operator/results.json` and `http-stages.json`.

### Friction where the two meet, and decisions

| Item                                                                                                                                                                                                                                       | Decision                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Forking from a reply that background work outlives (upstream #9627)                                                                                                                                                                        | **Deferred**: refused with guidance until checkpoint-time state exists                                            |
| Plugin cards updated after a fork checkpoint (#8746)                                                                                                                                                                                       | **Retained** from upstream                                                                                        |
| Hub schedules, webhooks, `run.tools` in upstream docs and marketing                                                                                                                                                                        | **Adapted**: unavailable in Clisbot Hub; pages archived and redirected, site lists GitHub, Linear, Slack, Discord |
| Bot Chat `/` discovery vs upstream's search-first menu                                                                                                                                                                                     | **Adapted** for Chats only; agent tabs keep upstream                                                              |
| Unseen-error status (#8831) vs Home "Needs you"                                                                                                                                                                                            | **Retained** upstream status; Home filter left for a product decision                                             |
| Button `xs` removed                                                                                                                                                                                                                        | **Adapted** to `sm`; checked at 320/375 pt, no layout break                                                       |
| `/new` placement in long provider lists                                                                                                                                                                                                    | **Retained** upstream ordering; reachable by typing `/n`                                                          |
| Pre-existing on `main` (not merge regressions): New bot model picker clipped by the viewport; empty Bot DM labelled Done; page title keeps the previous session's title after navigating to Chats; Automations copy mentions Hub schedules | **Follow-ups**, unchanged by this merge                                                                           |

Roadmap ideas raised during review (not part of this merge): checkpoint-time fork state so
background-work forks can be accepted; pinning `/new` in Chat menus; a Clisbot Hub schedules
source.

## Validation

_Updated as gates run; see the evidence directory for logs._

| Gate                                                     | Result                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` + postinstall patches                           | pass (all 12 patches applied)                                                                                                                                               |
| Script suites (ci-workflow; rebrand, hub-docs, branding) | 31/31; 28/28                                                                                                                                                                |
| Server build/typecheck                                   | pass                                                                                                                                                                        |
| App typecheck                                            | Passed within the full workspace typecheck on 28 November.                                                                                                                  |
| Survival                                                 | Reviewed 77 text differences across 399 commits on the combined preview. Both newer main commits survived in full. Repeat on the integrated commit.                         |
| Lint / format                                            | Pre-merge lint passed with zero diagnostics. Repo format passed and the three lint fixes were formatted.                                                                    |
| Focused suites                                           | Combined preview passed the seven previously failing server files (102 tests), provider controls (328), app retention (229), and packed Hub foundation and attachments (6). |
| Live local acceptance and web tour                       | Isolated web tour passed 14/14. The manual Hub run and both denials passed after real operator revocation on the disposable Host.                                           |
| Native (Android/iOS)                                     | Stream, jump and older-row insertion checked on Android emulator and iOS simulator.                                                                                         |

## Not run

Listed when the candidate is submitted.

### Independent closure checks on 28 November

The combined checkout includes the current main revisions of all 27 paths changed by Hub PRs 79 and 82.
Review of the retained Clisbot behavior found two production regressions. Removing a directory entry
had erased an unsent draft and its attachment. Offline-cache eviction could also retain an arbitrary
number of legacy rows without a known turn boundary. Both are fixed and the combined regression
suite passes. Provider tests now wait for the real turn-start event before asserting resumability.

Packed Hub tests run with a private home, isolated executable path and synthetic provider catalog.
Previously the test process inherited the operator's personal provider configuration, and process
diagnostics could include credential-bearing arguments. Process diagnostics now retain executable
names only. Six real packed enrollment and attachment cases passed. All five foundation cases
passed the existing shutdown deadline and leak check.

Fourteen upstream paths are absent from the tracked promotion tree. Two routes live in the
Clisbot tabs route group; nine Chinese fallback or unsupported Hub documentation pages are
archived or redirected. Clisbot keeps the runtime client identifier and the two previously removed
Chinese legal pages out of source. Full path reconciliation and review decisions are recorded in
the promotion evidence directory.
