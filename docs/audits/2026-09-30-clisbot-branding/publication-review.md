# Publication identity and inherited marketing review

2026-09-30 — follow-up to the [baseline inventory](inventory.md).
Original scope: Fusion rebrand test branch. That reviewed branch was promoted
to `main` on 2026-10-01; historical verification sections below describe their
own checkpoints.

## Decisions and changes

| Surface                                  | Finding                                                                                                        | Action                                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub container                            | Compose pulled `ghcr.io/getpaseo/hub`                                                                          | Use shared `ghcr.io/longbkit/clisbot`; see [service modes](../../docker.md#service-modes).                                                                                                                |
| Legal identity, privacy, terms (3 files) | Upstream operator, email, Spanish address and VAT number appeared as Clisbot identity                          | Long Luong / `clisbot@gmail.com`; remove inherited address and VAT. Terms no longer claim Clisbot operates upstream service domains.                                                                      |
| Landing-page social proof                | 9 upstream quotations; Arnold Gamboa and Dong explicitly named Paseo before rename                             | Remove the wall and its data. Preserve original quotations in Git history; never rename a quoted product to imply a Clisbot endorsement.                                                                  |
| Blog (2 articles)                        | `hello-world` and `i-was-wrong-about-electron` were upstream announcements/personal history renamed to Clisbot | Archive under `packages/website/posts/upstream/`, restore Paseo and credit Mo Boudra. Exclude from blog imports, direct routes and draft previews. Top-level sitemap discovery also excludes the archive. |
| Blog byline                              | Every article inherited Mo Boudra’s name, portrait and X link                                                  | Read per-post `author`; default new Clisbot posts to Clisbot.                                                                                                                                             |
| Hub demo                                 | 2 fictional chat messages used `moboudra`                                                                      | Use `long`.                                                                                                                                                                                               |

The 9 quoted authors were Cam, Erik Sherman, Aman Kumar Jagdev, RUI, Jason
Torres, A9, boris evstratov, Arnold Gamboa, and Dong. Evidence: upstream v0.10.1
landing-page source and the baseline audit. Ten inherited portrait assets remain
unreferenced; none is displayed as a Clisbot testimonial or author.

`scripts/rebrand-templates/publication.mjs` carries the contextual transform.
Archived posts are protected from general rename. Unknown testimonial structure
stops the transform before writes.

## Default ports

| Service            | Upstream / previous Fusion      | Clisbot |
| ------------------ | ------------------------------- | ------- |
| Daemon and web UI  | Paseo `6767`                    | `6868`  |
| Development daemon | Paseo `6768`                    | `6869`  |
| Hub backend        | Paseo `3000`; Fusion CLI `6868` | `6870`  |

Apply the same defaults to source fallbacks, add-host form, SSH transport, Hub
loopback discovery, CLI, dev scripts, Docker/Compose/Fly, Nix and current usage
examples. Existing saved ports and explicit `CLISBOT_LISTEN`, Hub `PORT`, and
CLI `--port` settings retain precedence. No installed settings are rewritten.
E2E guards reject both old and new daemon ports.

The scoped transform lives in `scripts/rebrand-templates/ports.mjs`. It skips
historical audit records, generated assets and user-state paths; Hub `3000`
changes are limited to known port settings and port-only example files. Timer
values remain unchanged. [Raw upstream port replay](evidence/ports-replay.json)
transforms nine real v0.10.1 files and makes zero changes on a second pass.

## One UI and a backend-only Hub

**CURRENT, 2026-09-30:** the shared app owns Hub management. Port `6868` serves
that app and the daemon; `6870` serves Hub APIs and its Host WebSocket endpoint.
Docker `all` mode publishes a usable app with only `6868` exposed.

The isolated daemon adapter `packages/server/src/server/hub/http-proxy.ts` is
enabled by `CLISBOT_HUB_PROXY_URL`; no URL means no proxy. Docker `all` supplies
the local Hub URL, plus a default public app origin of `http://localhost:6868`.
An injected browser runtime flag enables the existing app Hub configuration.
Native clients retain their existing configuration path. The shared route list
in `packages/protocol/src/hub-http.ts` separates Hub namespaces from daemon APIs.
Hub owns cookies, account access and Host admission; daemon routes retain bearer
auth. Starting both services does not enroll the Host or grant Hub authority.

Hub's inherited dashboard is disabled by default in `src/server/backend.ts`.
Its source remains for upstream reconciliation. The explicit
`CLISBOT_HUB_WEB_UI_ENABLED=true` escape hatch is used by inherited dashboard
tests; it is not part of the supported Clisbot management flow.

Future upstream merges must retain the optional upgrade predicate in
`websocket-server.ts`, the small bootstrap adapter hooks, runtime page hint and
configuration environment allowlist entry. Recheck both daemon `/ws` and Hub
`/api/daemons/socket`, cookie forwarding, public origin and authentication
boundaries. The main upstream worktree has not been merged in this iteration.

## Remaining publication decisions

- Terms still select Spanish law; privacy still names the Spanish Data Protection
  Agency. No replacement jurisdiction has been supplied.
- Privacy/terms retain claims about Fly.io hosting, Stripe billing, transfer
  safeguards, retention and subscriptions. Match them to actual Clisbot operations
  before publishing.
- Hub pricing can still fetch `hub.paseo.sh/api/billing/plans`; hosted CTAs and
  web-app links retain approved temporary upstream endpoints. Do not publish
  these as a Clisbot paid offer.
- Store links and the App Store submission ID remain separate release tasks.
- The homepage still emphasizes coding-agent control. The broader workspace,
  personal Bot and group-Bot concept lives in the README. A website rewrite and
  verification of every provider/comparison claim are outside this correction.

Keep upstream copyright, README attribution and source-credit comments such as
the adapted blog CSS attribution. They record provenance.

## Verification

- Whole-workspace typecheck passed; targeted runtime/transform lint passed with
  zero errors/warnings. Commit verification also required seven syntax-only lint
  corrections in the inherited `packages/hub/e2e/app.ts` fixture: explicit
  branches in place of ternaries and `toReversed()` on drained arrays. Its
  dashboard tests explicitly opt into the legacy UI.
- Rename suite: 11 passed, including editorial archival, repeat application,
  legal notice preservation, and stopping before writes on unknown markup.
- Blog suite: 3 passed; archives are absent from public/draft lists and direct URLs.
- Container supervisor: 7 passed (three modes, both service-failure paths,
  invalid mode, missing entry); CI contract suite: 9 passed.
- Hub release metadata suite: 5 passed; dev runner suite: 8 passed.
- Port behavior: 108 tests passed across daemon config, persisted config, SSH,
  and CLI Hub lifecycle; Hub loopback fallback test passed. App connection-hint
  tests: 5 passed.
- [Raw upstream website replay](evidence/publication-replay.json): 9 paths
  transformed, 2 articles archived, zero changes on repeat.
- Current text and visual transform checks: zero pending changes.
- Shared UI integration: 82 focused tests passed across proxy, Hub backend
  filter, runtime page hint, daemon config, SSH and CLI Hub lifecycle. Browser
  Hub configuration: 5 passed. Final environment-allowlist and WebSocket-origin
  checks: 15 passed (some overlap with the earlier config suite).

### Container runtime

[Recorded evidence](evidence/container-runtime.json): local image
`clisbot:rebrand-unified-test`, Linux arm64, built successfully with the final
`6868` / `6870` defaults. All three modes passed selected-service healthchecks,
UI ownership, restart and shutdown checks. Inactive service ports stayed closed.

In `all` mode, a real account claim and session cookie round trip passed through
`6868`, while a Hub cookie alone still received `401` on daemon `/api/status`.
Daemon WebSocket `hello` rejected missing/wrong passwords with close code `4401`
and returned `server_info` with the correct password. The Hub WebSocket route
reached Hub and rejected unauthenticated admission. Killing Hub failed the
combined container and stopped its sibling. Hub-only mode also passed a separate
PostgreSQL 17 boot/health smoke. All test containers were removed.

These checks do not establish browser rendering, live channel/agent behavior or
Linux amd64 runtime behavior. No image has been published, and no upstream merge
or `main` promotion was performed.

### Review fixes: malformed upgrades, login origin, client-IP quotas

The first image missed three cases. Each was reproduced before correction:

| Finding                                                                                     | Fix                                                                                                                                                                                                       | Runtime verification                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A WebSocket upgrade targeting `//` threw `ERR_INVALID_URL` and restarted the daemon worker. | Reject invalid request targets with `400`; consume that upgrade so the daemon listener cannot handle the same socket.                                                                                     | `400`, followed by daemon health `200`; authenticated daemon WebSocket still works.                                                                                                 |
| Backend-only Hub generated `/cli-login` links on `6870`, which returned `404`.              | Default browser links to the shared UI on `6868`; local onboarding derives the selected daemon port and persists the UI proxy before launching a fresh daemon. Explicit `CLISBOT_HUB_APP_URL` still wins. | CLI link and account setup work through the shared UI, including a fresh local CLI onboarding on custom port `7181`; Hub root remains `404`.                                        |
| Proxied clients shared the daemon proxy's IP quota.                                         | Daemon overwrites the reserved client-IP header; Hub accepts it only from configured proxy peers. The validated address is also used by Better Auth.                                                      | Six distinct source IPs all receive `201`. A single source receives five `201` then `429`, even when spoofing the header; the same spoofing attempt against the backend also fails. |

Docker `all` and local CLI Hub startup configure the loopback trust boundary.
Separate deployments must configure their actual proxy peers; see
[Docker client-IP configuration](../../docker.md#service-modes).
Daemon proxy settings may also live in `features.webUi.hubProxyUrl`; the
environment override takes precedence. Onboarding does not restart an existing
daemon when shared UI configuration needs changing.

[Fix verification evidence](evidence/review-fixes.json) records the rebuilt
`clisbot:rebrand-review-fixed` Linux arm64 image. All three service modes,
custom-port local onboarding and a separate PostgreSQL 17 boot smoke passed.
The focused proxy/backend tests (20), CLI/config tests (62), production cold-start
tests (4) and rename tests (11) passed. Workspace typecheck and targeted lint
passed. The rename check with the configured Expo identity reports no changes.

One additional inherited test, `index.bootstrap.test.ts` → “starts the manual
source”, returns `400 invalid_request`: its unchanged `HubHarness.runManual`
sends `projectSlug`, but the unchanged strict `DispatchManualRunRequestSchema`
does not accept that field. The fixture and schema have no diff from HEAD.
This separate test-contract mismatch remains open; the four production
cold-start tests in that file passed independently. No full test suite was run.

## 2026-10-01 — personal identifiers in examples

Anonymized personal names, employee emails, Slack user/bot/channel IDs, personal
Telegram bot usernames, a workstation name and a private tailnet hostname in
UI examples, public/internal docs, comments and test fixtures. Synthetic IDs
remain distinct, Vietnamese names retain Unicode coverage, and Telegram bot
fixtures retain their original username length so entity offsets stay valid.
The security-reporting contact is now `clisbot@gmail.com`.

Historical live-test notes explicitly identify anonymized examples. Live-run
instructions resolve the actual bot identity from the configured environment;
they must not use the synthetic IDs as real destinations. No credentials,
user data, deployed services or saved connections were changed.

Deliberately retained: public author/company biography, copyright and upstream
attribution, repository and Expo ownership metadata, approved temporary
upstream service endpoints, and low-impact local paths in historical audits.
This is a scoped cleanup of current files, not a Git-history rewrite or a
claim that every identity in all historical artifacts has been removed.

For future syncs, review newly introduced examples and copied live-test output
for personal identifiers. Use synthetic fixtures or environment references;
do not apply a global replacement to copyright, credits or public ownership.

Verification: 193 tests passed across 21 affected test files, including two
browser suites. An exact-token scan of tracked text found no remaining values
from the scoped identifier list. That list and raw scan results stay in ignored
local scratch storage.
