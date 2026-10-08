# Clisbot merge of rebranded upstream v0.11.1

**2026-10-08.** Paseo `v0.11.1` was transformed with the Clisbot rename and visual kit,
then merged into `main` on `sync/promotion-v0.11.1`. This records the inputs, the
conflicts and how they were resolved, the integration fixes the merge needed, and
what was and was not verified. Procedure: [upstream sync playbook](../../guides/developer-guide/upstream-sync-and-contribution.md#recurring-promotion-procedure-after-the-rebrand-cutover).

## Inputs

| Role                        | Ref / commit                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| Clisbot `main` before merge | `b30acfb7c4e0b9fce5326fbce80385d00315b7cc`                            |
| Rename-script fix (on main) | `2b5917bba` — README and landing-page anchors for upstream v0.11      |
| Raw upstream v0.11.1        | `ab10a6694ccf068959d1a6b67b6c915e21a9fe91` (`refs/upstream-releases`) |
| Transformed upstream        | `sync/rebranded-v0.11.1`, `cf6183be8c81e9336da48dcaf682a2363eae209a`  |
| Actual Git merge base       | raw v0.10.0, `c481ecf3e101326e3758d419341bc4faaf5b4f98`               |

Upstream carries 244 commits after the base (1342 files). Main themes: the plugin
registry, built-in provider plugins (Antigravity, Muse Code), Usage (sidebar footer,
dialog, per-account sources), host confirmation before pairing, content width,
sidebar header/footer sections, Speed menu, Explorer tabs as workspace tabs,
Claude Haiku 5.5.

## Transform

The rename script stopped twice on upstream copy changes and was updated first
(`2b5917bba`): the README now lists Antigravity and Muse Code as built in, and the
landing page's testimonial wall no longer ends at `PROVIDER_ICON_CLASS`. The
README counts stay "40+": 7 built-in providers plus 38 ACP catalog presets.

- Rename `--check` and visual `--check`: 0 pending changes on the snapshot.
- 14 rename-script tests pass.
- File completeness: every raw path is present after renaming except the two
  archived blog posts (moved to `posts/upstream/`, intentional); four branding
  images were added. 15 renamed `clisbot-plugin.json` files and one plugin test
  sit under a machine-wide `plugins/` ignore and were staged with
  `core.excludesFile=/dev/null` (repository rules still applied).
- Remaining `paseo` matches in the snapshot are `getpaseo` GitHub owners in test
  fixtures, the `getpaseo/paseo-relay` and `getpaseo/plugins` repositories, and
  the archived posts.

## Conflicts

Git reported **318 files / 784 hunks** (308 content, 8 modify/delete, 2 add/add).
As in [the v0.10.2 merge](merge-v0.10.2.md), the raw base was transformed and
formatted into a temporary copy and each file compared against it:

| Classification against the normalized base | Files | Resolution                       |
| ------------------------------------------ | ----: | -------------------------------- |
| Upstream equals normalized base            |    73 | Keep Clisbot                     |
| Clisbot equals normalized base             |   102 | Take upstream                    |
| Clean three-way content merge              |    33 | Combine                          |
| Upstream deleted, Clisbot only renamed     |     8 | Delete (upstream moved the code) |
| Real overlap                               |   102 | Resolved by hand, 238 hunks      |

The 102 hand-resolved files: package manifests (version `0.11.1`, Clisbot pins
for Hub/device-access kept), the lockfile (three-way JSON merge, then
`npm install --package-lock-only`; all 28 scalar conflicts were version bumps),
the sidebar and settings shell, pairing, composer controls, i18n, providers
(ACP, Codex, Claude, OpenCode, Pi), daemon bootstrap/session/WebSocket, tests
and docs. Channel packages and the Hub only changed version pins.

### Decisions worth knowing

- **Sidebar footer.** Upstream added footer sections (Usage summary and plugin
  rows) and a fixed icon line; Clisbot has its own configurable bottom bar. Both
  stay: footer rows sit above Clisbot's bottom bar, which gains a Usage icon
  (`usage-icon`). Both models store into `sidebarFooterItems`; each keeps the
  other's keys (`sidebar-nav/footer-model.ts`). Settings › Sidebar shows the
  upstream Header and Footer cards plus "Bottom bar". Clisbot's header order and
  default-hidden Search are now a `builtinOrder` on the upstream section model.
- **Pairing.** Upstream asks before a link adds or changes a host
  (`beginLinkPairing`, host confirmation). Clisbot device-pairing invitations and
  Hub-only links are handled first, with their own one-time grant, and are not
  shown the new confirmation; v5 protected offers are refused before it. The QR
  scan model gained `hub_connected` and routes to Hub settings.
- **OpenCode event stream.** Both sides fixed the hung first-record stream.
  Clisbot's deadline design (`b424206ac`) is kept; upstream's `turns.ts`
  (permission-denied turns end) is taken whole.
- **ACP close.** Clisbot's 1 s overall shutdown budget is kept; `session/cancel`
  now gets 500 ms of it so `session/close` is still sent (upstream test).
- **Settings screen.** Clisbot's detail layout (Hub picker, wide content, title
  accessories) is kept instead of upstream's new `PageLayout`; the plugin back
  button props were added.

### Integration fixes (no text conflict, broken by the merge)

Typecheck after the merge found 50 app errors and 3 server errors; tests found 3
more. Each is a Clisbot feature using an API upstream changed:

| Change upstream                                    | Fix                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `toDaemonServerInfo` replaces Clisbot's replay     | It now carries `botCreationAllowed` and `permissions`; without this a reconnect dropped them |
| `getProviderIcon` became `useProviderIcon`         | Four Clisbot components moved to the hook                                                    |
| `menu-anchor`, `use-compact-time-ago` moved        | Imports updated (`ui/anchor`, `use-time-ago`)                                                |
| `MAX_CONTENT_WIDTH` removed                        | Bots/Chats and actor rows follow `theme.contentMaxWidth` (the new setting)                   |
| Status labels translated                           | Session grouping passes `t` to `getStatusBucketLabel`                                        |
| `ForwardedAgentSession` forwards every member      | `isIdleForRelease` and `setSkillsOff` are forwarded for custom providers (latent bug)        |
| `providerParams` became `providerOptions`          | Custom ACP `exactMcpPreapproval` is passed to the client explicitly                          |
| Pending sends hold a closure                       | The queue keeps the message so an aborted request is removed (`wire.message`)                |
| Launcher `toggleTarget` removed                    | Clisbot's `scopeTarget` (only used for toggles) removed                                      |
| Panel manifest requires close/singleton flags      | Declared for Conversation (no close) and User profile                                        |
| `upsertRelayConnection` private, `clearInput` gone | Tests use a typed helper; the add-host form remounts instead                                 |
| New i18n keys                                      | 73 Vietnamese strings added (`vi.ts`, `plugin-settings.ts`)                                  |
| New Content width input                            | Uses `colors.input` like the other settings inputs ([light palette](../../design.md))        |

## Verification

- `npm ci` (3,600 packages), `npm ls --workspaces`: pass.
- Builds: server stack, 11 channel packages, app deps, daemon web UI: pass.
- `npm run typecheck` (all workspaces): **0 errors**.
- `npm run lint`: 36 errors / 8 warnings, the **same files as `main`** before
  the merge; none in merged code.
- `npm run format`: clean.
- Focused tests (files touched by conflicts or fixes):
  - app: 17 files, **368 passed** (one new footer-order expectation corrected);
  - server: 12 files, 735 run; after the ACP and OpenCode-test fixes those two
    files pass (159); `agent-manager.test.ts` **216 passed**;
  - client `daemon-client.test.ts` **194 passed**; protocol 818 of 819.
  - Two failures also fail on `main` before the merge and are not regressions:
    `daemon-executions` "failed Hub create cleans durable state…" (carried from
    v0.10.2) and protocol `text-match` "keeps subsequences within a word…".
- Runtime: an isolated daemon from this tree (`0.11.1`, web UI on) started
  healthy, loaded the built-in provider plugins, ran a real Codex
  (`gpt-5.6-luna`) turn that answered `MERGE-OK-0111`, and the web app showed it
  with **0 page errors** on desktop, mobile width and dark mode. Bots, Projects
  grouping, Automations, Connectors, the bottom bar with Usage, Usage dialog and
  Settings › Appearance › Content width were exercised.
  [Desktop](images/merge-v0.11.1-desktop.png),
  [chat](images/merge-v0.11.1-chat.png),
  [mobile](images/merge-v0.11.1-mobile.png),
  [dark](images/merge-v0.11.1-dark.png),
  [mobile sidebar](images/merge-v0.11.1-mobile-sidebar.png),
  [sidebar settings](images/merge-v0.11.1-sidebar-settings.png),
  [appearance](images/merge-v0.11.1-appearance.png). The Usage dialog was checked but not
  kept: it shows real account emails.
- Muse Code shows **Error** and Antigravity **Not installed** on this machine: `muse`
  is not installed and the test daemon's `PATH` lacked `~/.local/bin` (`agy`). The
  provider-plugin code is byte-identical to upstream.

## Change-survival review (2026-10-09)

After the merge, every Clisbot commit since the v0.10.2 merge was checked with
[`scripts/upstream-sync/clisbot-change-survival.py`](../../../scripts/upstream-sync/clisbot-change-survival.py):
68 commits (`48676c64a..b30acfb7c`, excluding the retired clisbot v1 history
joined at the cutover). For each commit it takes the lines the commit added that
were still present before the merge and reports those missing after it.

- 54 commits survived line for line. No Clisbot file was lost, no file Clisbot
  had deleted came back, and every binary asset (icons, images) is unchanged.
- 14 commits had 134 lines that no longer appear verbatim. All but two groups
  are the adaptations listed above (sidebar footer, pairing, provider icons,
  moved modules, version pins, `bottomTitle` renamed to "Bottom bar").
- **Two losses, fixed in `5209c0b18`:**
  - The temporary hosted Hub origin `hub.paseo.sh` became `hub.clisbot.com`
    (no such host) in the CLI default, the website plans URL and the Hub docs;
    two CLI tests failed. Clisbot kept upstream's raw text on those lines, so Git
    saw that side as unchanged and took the renamed upstream line without a
    conflict. The normalized-base comparison cannot see this case; the
    survival check does. Follow-up the same day: Clisbot does not use
    upstream's hosted Hub, so the default was removed instead (see the
    [playbook row](../../guides/developer-guide/upstream-sync-and-contribution.md)
    for `hub.paseo.sh`).
  - The sidebar empty states lost the lifted settings card from `35ab81200`.
    Upstream's new actions stay; the card, centring and inset are restored. [Empty state](images/merge-v0.11.1-empty-light.png).

Behaviour of the Clisbot areas was checked with their own tests:

| Area                                                                                               | Result                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------- |
| App `src/clisbot`, device access, sidebar nav, hosts, contexts, i18n                               | 1341 of 1342 tests; 4 files fail |
| Server connectors, chats, managed access, device access, network, bots, schedules, session storage | 1256 of 1259; 3 fail             |
| Hub daemons (PostgreSQL in Docker)                                                                 | 84 of 97; 13 fail                |
| Hub channel loader and vertical contract                                                           | pass (9 contract cases)          |
| Channel plane against simulated Slack and Telegram                                                 | 11 of 11                         |
| CLI Hub commands                                                                                   | 22 of 22 after the origin fix    |

Every remaining failure fails identically on `b30acfb7c` before the merge
(checked in a separate worktree with the same dependencies and Docker), so none
is a merge regression. They are existing Clisbot issues worth their own fixes:
the app's `chat-options-activity` sheet case and three suites that do not load
in the unit/browser runner; the server's worktree auto-archive and Project
worktree e2e cases; `bot.template.preview.request` having no managed-access
target (a `workspace.manage` RPC left unscoped); and 13 Hub daemon enrollment
and fan-out cases.

## Not verified / follow-ups

- **Plugin registry install (open, accepted for now).** `clisbot plugin add
owner/slug` is new in v0.11.1 and fails. Built-in plugins and `npm:`/`git:`/
  directory sources that ship `clisbot-plugin.json` still install. Two causes,
  both must be fixed:
  - The rename made the default registry `https://plugins.clisbot.com`
    (`packages/protocol/src/plugin-registry.ts`), which has no DNS yet. The
    host is the website Worker (`packages/website/wrangler.toml`,
    `src/plugins/published.ts`, deployed by `deploy-website.yml`), which
    proxies upstream's data at `getpaseo.github.io/plugins`. The next website
    deploy may bring the domain up.
  - Pointing at `plugins.paseo.sh` instead still fails: the registry lookup
    and clone succeed (the bare host 301s, but `/plugins/<id>.json` answers
    200), then install stops with `Plugin manifest is missing:
…/clisbot-plugin.json`. Third-party plugins ship `paseo-plugin.json`, and
    the daemon has read only `clisbot-plugin.json` since the earlier rebrand.
    Accepting both names reopens the
    [no-Paseo-interop decision](../2026-09-29-clisbot-rebrand-upstream-sync-decision.md#wire-contracts-follow-the-rename).
    Checked live 2026-10-09 with `3ae3ae/agy-provider`.
- New upstream copy (README bullets, plugin directory pages, Orca/registry
  links) has not had the [publication review](publication-review.md).
- No live Slack/Telegram round trip: channel and Hub code are unchanged apart
  from version pins.
- No native iOS/Android, Electron desktop or Docker image build; no Nix hash.
- Device-pairing invitations skip upstream's new host confirmation (see above);
  decide whether invitations should also show it.
